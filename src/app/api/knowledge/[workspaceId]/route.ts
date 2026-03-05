/**
 * Project Knowledge API — shared markdown wiki per workspace
 *
 * GET  /api/knowledge/[workspaceId]       — read knowledge file
 * PUT  /api/knowledge/[workspaceId]       — overwrite knowledge file
 */
import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { mutationLimiter } from '@/lib/rate-limit'
import { config, ensureDirExists } from '@/lib/config'
import { getDatabase } from '@/lib/db'
import { eventBus } from '@/lib/event-bus'
import { resolveWithin } from '@/lib/paths'

// Max file size: 512 KB — enough for a very thorough project wiki
const MAX_KNOWLEDGE_BYTES = 512 * 1024

function knowledgeDir(): string {
  return path.join(config.dataDir, 'knowledge')
}

function knowledgeFilePath(workspaceSlug: string): string {
  const base = knowledgeDir()
  return resolveWithin(base, path.join(workspaceSlug, 'PROJECT.md'))
}

async function resolveWorkspace(
  workspaceId: string,
  dbWorkspaceId: number
): Promise<{ id: number; slug: string; name: string } | null> {
  // workspaceId param can be numeric id or slug
  const db = getDatabase()

  // Restrict to the authenticated user's workspace
  const byId = !isNaN(parseInt(workspaceId))
    ? (db
        .prepare('SELECT id, slug, name FROM workspaces WHERE id = ? AND id = ?')
        .get(parseInt(workspaceId), dbWorkspaceId) as any)
    : null

  const bySlug = db
    .prepare('SELECT id, slug, name FROM workspaces WHERE slug = ? AND id = ?')
    .get(workspaceId, dbWorkspaceId) as any

  return byId ?? bySlug ?? null
}

// ---------------------------------------------------------------------------
// GET /api/knowledge/[workspaceId]
// ---------------------------------------------------------------------------
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const auth = requireRole(request, 'viewer')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const { workspaceId } = await params
    const dbWorkspaceId = auth.user.workspace_id ?? 1

    const workspace = await resolveWorkspace(workspaceId, dbWorkspaceId)
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const filePath = knowledgeFilePath(workspace.slug)

    let content = ''
    let exists = false
    try {
      content = await fs.readFile(filePath, 'utf8')
      exists = true
    } catch {
      // File not yet initialised — return empty
    }

    const stat = exists ? await fs.stat(filePath).catch(() => null) : null

    return NextResponse.json({
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      workspace_name: workspace.name,
      content,
      exists,
      path: filePath,
      size_bytes: stat?.size ?? 0,
      updated_at: stat ? Math.floor(stat.mtimeMs / 1000) : null,
    })
  } catch (error) {
    logger.error({ err: error }, 'GET /api/knowledge/[workspaceId] error')
    return NextResponse.json({ error: 'Failed to read project knowledge' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PUT /api/knowledge/[workspaceId]  — full replace or append
// ---------------------------------------------------------------------------
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const auth = requireRole(request, 'operator')
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const rateCheck = mutationLimiter(request)
  if (rateCheck) return rateCheck

  try {
    const { workspaceId } = await params
    const dbWorkspaceId = auth.user.workspace_id ?? 1

    const workspace = await resolveWorkspace(workspaceId, dbWorkspaceId)
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const body = await request.json()
    const { content, mode = 'replace' } = body as { content: string; mode?: 'replace' | 'append' }

    if (typeof content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 })
    }

    if (!['replace', 'append'].includes(mode)) {
      return NextResponse.json({ error: 'mode must be "replace" or "append"' }, { status: 400 })
    }

    const filePath = knowledgeFilePath(workspace.slug)
    ensureDirExists(path.dirname(filePath))

    let finalContent = content
    if (mode === 'append') {
      let existing = ''
      try {
        existing = await fs.readFile(filePath, 'utf8')
      } catch {
        // File doesn't exist yet — append == replace
      }
      finalContent = existing ? `${existing.trimEnd()}\n\n${content}` : content
    }

    const encoded = Buffer.from(finalContent, 'utf8')
    if (encoded.byteLength > MAX_KNOWLEDGE_BYTES) {
      return NextResponse.json(
        { error: `Knowledge file exceeds max size of ${MAX_KNOWLEDGE_BYTES / 1024} KB` },
        { status: 413 }
      )
    }

    await fs.writeFile(filePath, finalContent, 'utf8')

    const stat = await fs.stat(filePath)

    // Broadcast change event so UI can refresh
    eventBus.broadcast('knowledge.updated', {
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      updated_by: auth.user.username,
    })

    logger.info(
      { workspaceId: workspace.id, slug: workspace.slug, mode, updatedBy: auth.user.username },
      'Project knowledge updated'
    )

    return NextResponse.json({
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      workspace_name: workspace.name,
      content: finalContent,
      size_bytes: stat.size,
      updated_at: Math.floor(stat.mtimeMs / 1000),
    })
  } catch (error) {
    logger.error({ err: error }, 'PUT /api/knowledge/[workspaceId] error')
    return NextResponse.json({ error: 'Failed to update project knowledge' }, { status: 500 })
  }
}
