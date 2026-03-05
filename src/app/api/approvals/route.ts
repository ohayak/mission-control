/**
 * Approvals API — Human-in-the-loop governance queue
 *
 * GET  /api/approvals        — list approvals (filterable by status, task_id)
 * POST /api/approvals        — create a new approval request
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/event-bus'
import { z } from 'zod'

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const createApprovalSchema = z.object({
  task_id: z.number().int().positive().optional().nullable(),
  agent_name: z.string().min(1).max(255).optional().nullable(),
  action_type: z.string().min(1).max(255),
  reason: z.string().min(1).max(4096),
  payload: z.record(z.string(), z.unknown()).optional().nullable(),
  confidence: z.number().int().min(0).max(100).default(50),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
})

// ---------------------------------------------------------------------------
// GET /api/approvals
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { searchParams } = new URL(request.url)

    const status = searchParams.get('status')
    const taskId = searchParams.get('task_id')
    const limitParam = parseInt(searchParams.get('limit') ?? '50')
    const offsetParam = parseInt(searchParams.get('offset') ?? '0')
    const limit = isNaN(limitParam) || limitParam < 1 ? 50 : Math.min(limitParam, 200)
    const offset = isNaN(offsetParam) || offsetParam < 0 ? 0 : offsetParam

    // Build WHERE clauses
    const conditions: string[] = ['a.workspace_id = ?']
    const params: (string | number)[] = [workspaceId]

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      conditions.push('a.status = ?')
      params.push(status)
    }
    if (taskId) {
      const tid = parseInt(taskId)
      if (!isNaN(tid)) {
        conditions.push('a.task_id = ?')
        params.push(tid)
      }
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    const countRow = db
      .prepare(`SELECT COUNT(*) as total FROM approvals a ${where}`)
      .get(...params) as { total: number }

    const rows = db
      .prepare(
        `SELECT
           a.*,
           t.title as task_title,
           t.status as task_status
         FROM approvals a
         LEFT JOIN tasks t ON t.id = a.task_id AND t.workspace_id = a.workspace_id
         ${where}
         ORDER BY a.created_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset) as any[]

    const approvals = rows.map((row) => ({
      ...row,
      payload: row.payload ? JSON.parse(row.payload) : null,
    }))

    return NextResponse.json({
      approvals,
      total: countRow.total,
      limit,
      offset,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/approvals error')
    return NextResponse.json({ error: 'Failed to fetch approvals' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/approvals
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  // Agents (operator role) and human admins can create approvals
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const body = await request.json()
    const parsed = createApprovalSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const data = parsed.data

    // Validate task_id exists in this workspace if provided
    if (data.task_id) {
      const task = db
        .prepare('SELECT id FROM tasks WHERE id = ? AND workspace_id = ?')
        .get(data.task_id, workspaceId) as { id: number } | undefined
      if (!task) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }

      // Enforce one pending approval per task
      if (data.status === 'pending') {
        const existing = db
          .prepare(
            `SELECT id FROM approvals
             WHERE task_id = ? AND workspace_id = ? AND status = 'pending'
             LIMIT 1`
          )
          .get(data.task_id, workspaceId) as { id: number } | undefined

        if (existing) {
          return NextResponse.json(
            {
              error: 'A pending approval already exists for this task.',
              existing_approval_id: existing.id,
            },
            { status: 409 }
          )
        }
      }
    }

    const result = db
      .prepare(
        `INSERT INTO approvals
           (workspace_id, task_id, agent_name, action_type, reason, payload, confidence, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        workspaceId,
        data.task_id ?? null,
        data.agent_name ?? null,
        data.action_type,
        data.reason,
        data.payload ? JSON.stringify(data.payload) : null,
        data.confidence,
        data.status
      )

    const approval = db
      .prepare('SELECT * FROM approvals WHERE id = ?')
      .get(result.lastInsertRowid) as any

    const approvalOut = { ...approval, payload: approval.payload ? JSON.parse(approval.payload) : null }

    // Broadcast to SSE subscribers
    eventBus.broadcast('approval.created', approvalOut)

    logger.info(
      { approvalId: approval.id, taskId: data.task_id, actionType: data.action_type },
      'Approval request created'
    )

    return NextResponse.json({ approval: approvalOut }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/approvals error')
    return NextResponse.json({ error: 'Failed to create approval' }, { status: 500 })
  }
}
