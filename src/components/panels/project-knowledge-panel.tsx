'use client'

/**
 * ProjectKnowledgePanel — Shared PROJECT.md wiki per workspace
 *
 * All agents and humans can read/edit the shared project knowledge file.
 * Supports markdown with live preview. Changes are persisted server-side
 * as a flat PROJECT.md file under <dataDir>/knowledge/<slug>/PROJECT.md.
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KnowledgeResponse {
  workspace_id: number
  workspace_slug: string
  workspace_name: string
  content: string
  exists: boolean
  path: string
  size_bytes: number
  updated_at: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(unixSeconds * 1000).toLocaleDateString()
}

// ─── Toolbar Button ───────────────────────────────────────────────────────────

function ToolbarBtn({
  onClick,
  title,
  children,
  active,
}: {
  onClick: () => void
  title: string
  children: React.ReactNode
  active?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-7 h-7 flex items-center justify-center rounded text-xs transition-smooth ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function ProjectKnowledgePanel({ workspaceId = '1' }: { workspaceId?: string }) {
  const [data, setData] = useState<KnowledgeResponse | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<'replace' | 'append'>('replace')
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [initialising, setInitialising] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchKnowledge = useCallback(async () => {
    try {
      const res = await fetch(`/api/knowledge/${workspaceId}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json: KnowledgeResponse = await res.json()
      setData(json)
      setDraft(json.content)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load project knowledge')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchKnowledge()
  }, [fetchKnowledge])

  // ── Init ───────────────────────────────────────────────────────────────────

  const handleInit = useCallback(async () => {
    setInitialising(true)
    setError(null)
    try {
      const res = await fetch(`/api/knowledge/${workspaceId}/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: false }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).error ?? `HTTP ${res.status}`)
      }
      const json: KnowledgeResponse = await res.json()
      setData(json)
      setDraft(json.content)
      setEditing(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialise')
    } finally {
      setInitialising(false)
    }
  }, [workspaceId])

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/knowledge/${workspaceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft, mode }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).error ?? `HTTP ${res.status}`)
      }
      const json: KnowledgeResponse = await res.json()
      setData(json)
      setDraft(json.content)
      setEditing(false)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [workspaceId, draft, mode])

  // ── Markdown helpers ───────────────────────────────────────────────────────

  function insertMarkdown(prefix: string, suffix = '', placeholder = 'text') {
    const ta = textareaRef.current
    if (!ta) return
    const start = ta.selectionStart
    const end = ta.selectionEnd
    const selected = draft.slice(start, end) || placeholder
    const newText = draft.slice(0, start) + prefix + selected + suffix + draft.slice(end)
    setDraft(newText)
    // Restore cursor after React re-render
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length)
    }, 0)
  }

  const isDirty = editing && draft !== (data?.content ?? '')

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
          className="w-5 h-5 animate-spin mr-2">
          <path d="M14 8A6 6 0 1 1 8 2" strokeLinecap="round"/>
        </svg>
        Loading project knowledge…
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-5 h-5 text-primary">
              <rect x="2" y="1" width="12" height="14" rx="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5 5h6M5 8h6M5 11h3" strokeLinecap="round"/>
            </svg>
            Project Knowledge
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Shared markdown wiki — all agents read this before starting tasks.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {data?.exists && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-smooth"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                <path d="M11 2l3 3-8 8H3v-3L11 2z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Edit
            </button>
          )}
          {editing && (
            <>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as 'replace' | 'append')}
                className="text-xs border border-border rounded-lg px-2 py-1.5 bg-background text-muted-foreground"
                title="Save mode"
              >
                <option value="replace">Replace</option>
                <option value="append">Append</option>
              </select>
              <button
                onClick={() => { setEditing(false); setDraft(data?.content ?? '') }}
                className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-smooth"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth disabled:opacity-50"
              >
                {saving ? (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
                    className="w-3.5 h-3.5 animate-spin">
                    <path d="M14 8A6 6 0 1 1 8 2" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5">
                    <path d="M3 8l4 4 6-7" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Meta bar */}
      {data?.exists && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>📁 {data.path}</span>
          <span>·</span>
          <span>{formatBytes(data.size_bytes)}</span>
          {data.updated_at && (
            <>
              <span>·</span>
              <span>Updated {timeAgo(data.updated_at)}</span>
            </>
          )}
          {isDirty && (
            <>
              <span>·</span>
              <span className="text-yellow-600 font-medium">● Unsaved changes</span>
            </>
          )}
          {saveSuccess && (
            <>
              <span>·</span>
              <span className="text-green-600 font-medium">✓ Saved</span>
            </>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4 shrink-0">
            <circle cx="8" cy="8" r="6.5"/>
            <path d="M8 5v3.5M8 10.5v.5" strokeLinecap="round"/>
          </svg>
          {error}
        </div>
      )}

      {/* Not initialised */}
      {!data?.exists && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-xl">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-6 h-6 text-muted-foreground">
              <rect x="2" y="1" width="12" height="14" rx="1.5"/>
              <path d="M8 5v6M5 8h6" strokeLinecap="round"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-muted-foreground">No project knowledge yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-[300px]">
            Initialise a PROJECT.md to give all agents shared context about this workspace.
          </p>
          <button
            onClick={handleInit}
            disabled={initialising}
            className="mt-4 flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-smooth disabled:opacity-50"
          >
            {initialising ? 'Initialising…' : '✨ Initialise Project Knowledge'}
          </button>
        </div>
      )}

      {/* Editor / preview */}
      {data?.exists && (
        <div className="flex-1 flex flex-col gap-2 min-h-0">
          {/* View mode toggle (only in edit mode) */}
          {editing && (
            <div className="flex items-center gap-1">
              {/* Markdown toolbar */}
              <div className="flex items-center gap-0.5 mr-2 border-r border-border pr-2">
                <ToolbarBtn onClick={() => insertMarkdown('**', '**', 'bold')} title="Bold">
                  <strong>B</strong>
                </ToolbarBtn>
                <ToolbarBtn onClick={() => insertMarkdown('_', '_', 'italic')} title="Italic">
                  <em>I</em>
                </ToolbarBtn>
                <ToolbarBtn onClick={() => insertMarkdown('`', '`', 'code')} title="Inline code">
                  <span className="font-mono text-[10px]">{`</>`}</span>
                </ToolbarBtn>
                <ToolbarBtn onClick={() => insertMarkdown('## ', '', 'Heading')} title="Heading">
                  H
                </ToolbarBtn>
                <ToolbarBtn onClick={() => insertMarkdown('- ', '', 'item')} title="List item">
                  •
                </ToolbarBtn>
                <ToolbarBtn onClick={() => insertMarkdown('\n```\n', '\n```', 'code block')} title="Code block">
                  <span className="font-mono text-[10px]">{ }</span>
                </ToolbarBtn>
              </div>

              {/* View toggle */}
              <div className="flex gap-0.5 p-0.5 bg-muted rounded-md">
                {(['edit', 'split', 'preview'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setViewMode(v)}
                    className={`px-2.5 py-1 text-xs rounded transition-smooth capitalize ${
                      viewMode === v
                        ? 'bg-card text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Content area */}
          <div className={`flex-1 min-h-0 grid gap-3 ${
            editing && viewMode === 'split' ? 'grid-cols-2' : 'grid-cols-1'
          }`}>
            {/* Editor */}
            {editing && viewMode !== 'preview' && (
              <textarea
                ref={textareaRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full h-full min-h-[400px] resize-none border border-border rounded-xl p-4 text-sm font-mono bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 leading-relaxed"
                placeholder="# Project Knowledge

Write shared context, conventions, and decisions here…"
                spellCheck={false}
              />
            )}

            {/* Preview / read-only view */}
            {(!editing || viewMode !== 'edit') && (
              <div className="h-full min-h-[400px] overflow-y-auto border border-border rounded-xl p-4 bg-card">
                {(editing ? draft : data.content) ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-code:text-xs prose-pre:bg-muted/50">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {editing ? draft : data.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">No content yet.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
