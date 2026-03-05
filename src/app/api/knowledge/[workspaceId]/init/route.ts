/**
 * POST /api/knowledge/[workspaceId]/init
 *
 * Initialise a PROJECT.md for a workspace with a starter template.
 * Idempotent — if the file already exists and `force` is not set, returns 409.
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

function knowledgeFilePath(workspaceSlug: string): string {
  const base = path.join(config.dataDir, 'knowledge')
  return resolveWithin(base, path.join(workspaceSlug, 'PROJECT.md'))
}

function starterTemplate(workspaceName: string, workspaceSlug: string): string {
  const now = new Date().toISOString().split('T')[0]
  return `# Project Knowledge — ${workspaceName}

> **Workspace:** \`${workspaceSlug}\`
> **Initialised:** ${now}
>
> This is the shared knowledge file for all agents working in this workspace.
> Keep it updated with architecture decisions, conventions, discovered constraints,
> API contracts, and anything else the whole team needs to know.

---

## Architecture Overview

_Describe the high-level architecture here._

## Tech Stack

- **Language / Runtime:** _e.g., TypeScript / Node 22_
- **Framework:** _e.g., Next.js 15_
- **Database:** _e.g., SQLite (better-sqlite3, WAL mode)_
- **Key dependencies:** _list them_

## Coding Conventions

- _Naming conventions, file structure, patterns in use_
- _Linting / formatting rules_
- _Test strategy_

## API Contracts

_Document important API endpoints, request/response shapes, auth requirements._

## Known Constraints & Gotchas

- _Things that bit us or surprised us_
- _Third-party quirks_
- _Performance ceilings_

## Architecture Decisions (ADRs)

| Date | Decision | Rationale |
|------|----------|-----------|
| ${now} | Initialised knowledge base | Shared context for all agents |

## Ongoing Work

_Link to active tasks, open questions, or work-in-progress notes here._
`
}

export async function POST(
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
    const db = getDatabase()

    const byId = !isNaN(parseInt(workspaceId))
      ? (db
          .prepare('SELECT id, slug, name FROM workspaces WHERE id = ? AND id = ?')
          .get(parseInt(workspaceId), dbWorkspaceId) as any)
      : null
    const bySlug = db
      .prepare('SELECT id, slug, name FROM workspaces WHERE slug = ? AND id = ?')
      .get(workspaceId, dbWorkspaceId) as any

    const workspace = byId ?? bySlug
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({})) as { force?: boolean }
    const force = Boolean(body?.force)

    const filePath = knowledgeFilePath(workspace.slug)

    // Check if already exists
    const exists = await fs.access(filePath).then(() => true).catch(() => false)
    if (exists && !force) {
      return NextResponse.json(
        { error: 'Knowledge file already exists. Pass force: true to overwrite.', path: filePath },
        { status: 409 }
      )
    }

    ensureDirExists(path.dirname(filePath))
    const content = starterTemplate(workspace.name, workspace.slug)
    await fs.writeFile(filePath, content, 'utf8')

    const stat = await fs.stat(filePath)

    eventBus.broadcast('knowledge.updated', {
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      updated_by: auth.user.username,
      action: 'init',
    })

    logger.info(
      { workspaceId: workspace.id, slug: workspace.slug, force },
      'Project knowledge initialised'
    )

    return NextResponse.json({
      workspace_id: workspace.id,
      workspace_slug: workspace.slug,
      workspace_name: workspace.name,
      content,
      size_bytes: stat.size,
      updated_at: Math.floor(stat.mtimeMs / 1000),
      initialised: true,
    }, { status: 201 })
  } catch (error) {
    logger.error({ err: error }, 'POST /api/knowledge/[workspaceId]/init error')
    return NextResponse.json({ error: 'Failed to initialise project knowledge' }, { status: 500 })
  }
}
