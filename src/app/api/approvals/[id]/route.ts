/**
 * Approval detail & resolution — PATCH/GET/DELETE for a single approval
 *
 * GET    /api/approvals/[id]  — fetch one approval
 * PATCH  /api/approvals/[id]  — approve / reject / reopen
 * DELETE /api/approvals/[id]  — remove (admin only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { eventBus } from '@/lib/event-bus'
import { z } from 'zod'

const patchApprovalSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  resolution_note: z.string().max(4096).optional().nullable(),
})

// ---------------------------------------------------------------------------
// GET /api/approvals/[id]
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { id } = await params
    const approvalId = parseInt(id)

    if (isNaN(approvalId)) {
      return NextResponse.json({ error: 'Invalid approval ID' }, { status: 400 })
    }

    const row = db
      .prepare(
        `SELECT a.*, t.title as task_title, t.status as task_status
         FROM approvals a
         LEFT JOIN tasks t ON t.id = a.task_id AND t.workspace_id = a.workspace_id
         WHERE a.id = ? AND a.workspace_id = ?`
      )
      .get(approvalId, workspaceId) as any

    if (!row) {
      return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
    }

    return NextResponse.json({
      approval: { ...row, payload: row.payload ? JSON.parse(row.payload) : null },
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/approvals/[id] error')
    return NextResponse.json({ error: 'Failed to fetch approval' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/approvals/[id]  — resolve (approve/reject) or reopen
// ---------------------------------------------------------------------------
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Only admins / operators can approve/reject
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { id } = await params
    const approvalId = parseInt(id)

    if (isNaN(approvalId)) {
      return NextResponse.json({ error: 'Invalid approval ID' }, { status: 400 })
    }

    const body = await request.json()
    const parsed = patchApprovalSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      )
    }

    const { status, resolution_note } = parsed.data

    const current = db
      .prepare('SELECT * FROM approvals WHERE id = ? AND workspace_id = ?')
      .get(approvalId, workspaceId) as any

    if (!current) {
      return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
    }

    const now = Math.floor(Date.now() / 1000)
    const isResolving = status !== 'pending'

    // Check pending conflicts when re-opening
    if (status === 'pending' && current.status !== 'pending' && current.task_id) {
      const conflict = db
        .prepare(
          `SELECT id FROM approvals
           WHERE task_id = ? AND workspace_id = ? AND status = 'pending' AND id != ?
           LIMIT 1`
        )
        .get(current.task_id, workspaceId, approvalId) as { id: number } | undefined

      if (conflict) {
        return NextResponse.json(
          { error: 'Another pending approval already exists for this task.', conflict_id: conflict.id },
          { status: 409 }
        )
      }
    }

    db.prepare(
      `UPDATE approvals
       SET status = ?,
           resolved_by = ?,
           resolution_note = ?,
           resolved_at = ?
       WHERE id = ? AND workspace_id = ?`
    ).run(
      status,
      isResolving ? auth.user.username : null,
      resolution_note ?? null,
      isResolving ? now : null,
      approvalId,
      workspaceId
    )

    const updated = db
      .prepare(
        `SELECT a.*, t.title as task_title, t.status as task_status
         FROM approvals a
         LEFT JOIN tasks t ON t.id = a.task_id AND t.workspace_id = a.workspace_id
         WHERE a.id = ? AND a.workspace_id = ?`
      )
      .get(approvalId, workspaceId) as any

    const approvalOut = { ...updated, payload: updated.payload ? JSON.parse(updated.payload) : null }

    // Broadcast resolution to SSE listeners (agents polling can react)
    eventBus.broadcast('approval.updated', approvalOut)

    logger.info(
      { approvalId, status, resolvedBy: auth.user.username },
      'Approval updated'
    )

    return NextResponse.json({ approval: approvalOut })
  } catch (error) {
    logger.error({ err: error }, 'PATCH /api/approvals/[id] error')
    return NextResponse.json({ error: 'Failed to update approval' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/approvals/[id]  — admin-only hard delete
// ---------------------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = requireRole(request, 'admin')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const db = getDatabase()
    const workspaceId = auth.user.workspace_id ?? 1
    const { id } = await params
    const approvalId = parseInt(id)

    if (isNaN(approvalId)) {
      return NextResponse.json({ error: 'Invalid approval ID' }, { status: 400 })
    }

    const row = db
      .prepare('SELECT id FROM approvals WHERE id = ? AND workspace_id = ?')
      .get(approvalId, workspaceId)

    if (!row) {
      return NextResponse.json({ error: 'Approval not found' }, { status: 404 })
    }

    db.prepare('DELETE FROM approvals WHERE id = ? AND workspace_id = ?').run(approvalId, workspaceId)

    eventBus.broadcast('approval.deleted', { id: approvalId })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error({ err: error }, 'DELETE /api/approvals/[id] error')
    return NextResponse.json({ error: 'Failed to delete approval' }, { status: 500 })
  }
}
