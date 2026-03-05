'use client'

/**
 * ApprovalQueuePanel — Human-in-the-loop governance queue
 *
 * Displays pending / resolved approval requests. Operators can approve or
 * reject pending items. Agents poll this endpoint to discover when their
 * actions have been cleared.
 */
import { useState, useCallback, useEffect } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Approval {
  id: number
  workspace_id: number
  task_id: number | null
  task_title: string | null
  task_status: string | null
  agent_name: string | null
  action_type: string
  reason: string
  payload: Record<string, unknown> | null
  confidence: number
  status: 'pending' | 'approved' | 'rejected'
  resolved_by: string | null
  resolution_note: string | null
  created_at: number
  resolved_at: number | null
}

interface ApprovalsResponse {
  approvals: Approval[]
  total: number
  limit: number
  offset: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(unixSeconds: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSeconds
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function confidenceBadge(confidence: number): { label: string; cls: string } {
  if (confidence >= 80) return { label: `${confidence}%`, cls: 'text-green-600 bg-green-50 border-green-200' }
  if (confidence >= 50) return { label: `${confidence}%`, cls: 'text-yellow-700 bg-yellow-50 border-yellow-200' }
  return { label: `${confidence}%`, cls: 'text-red-600 bg-red-50 border-red-200' }
}

function statusBadge(status: Approval['status']): { label: string; cls: string } {
  switch (status) {
    case 'pending':  return { label: 'Pending',  cls: 'text-yellow-700 bg-yellow-50 border-yellow-300' }
    case 'approved': return { label: 'Approved', cls: 'text-green-700 bg-green-50 border-green-300' }
    case 'rejected': return { label: 'Rejected', cls: 'text-red-700 bg-red-50 border-red-300' }
  }
}

// ─── Resolution Modal ─────────────────────────────────────────────────────────

function ResolutionModal({
  approval,
  decision,
  onConfirm,
  onCancel,
}: {
  approval: Approval
  decision: 'approved' | 'rejected'
  onConfirm: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  const isApprove = decision === 'approved'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h3 className="text-base font-semibold mb-1">
          {isApprove ? '✅ Approve request' : '❌ Reject request'}
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          <span className="font-medium">{approval.action_type}</span>
          {approval.task_title ? ` on task "${approval.task_title}"` : ''}
        </p>

        <label className="block text-xs font-medium text-muted-foreground mb-1">
          Resolution note <span className="text-muted-foreground/60">(optional)</span>
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={isApprove ? 'Reason for approval…' : 'Reason for rejection…'}
          rows={3}
          className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
        />

        <div className="flex gap-2 justify-end mt-4">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-smooth"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(note)}
            className={`px-4 py-2 text-sm rounded-lg font-medium transition-smooth ${
              isApprove
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-red-600 hover:bg-red-700 text-white'
            }`}
          >
            {isApprove ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Approval Card ────────────────────────────────────────────────────────────

function ApprovalCard({
  approval,
  onDecide,
}: {
  approval: Approval
  onDecide: (id: number, decision: 'approved' | 'rejected', note: string) => void
}) {
  const [modal, setModal] = useState<'approved' | 'rejected' | null>(null)
  const [expanded, setExpanded] = useState(false)
  const sb = statusBadge(approval.status)
  const cb = confidenceBadge(approval.confidence)
  const isPending = approval.status === 'pending'

  return (
    <>
      {modal && (
        <ResolutionModal
          approval={approval}
          decision={modal}
          onConfirm={(note) => { onDecide(approval.id, modal, note); setModal(null) }}
          onCancel={() => setModal(null)}
        />
      )}

      <div className={`border rounded-xl p-4 bg-card transition-all ${
        isPending ? 'border-yellow-300 shadow-sm' : 'border-border opacity-80'
      }`}>
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {/* Status badge */}
              <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${sb.cls}`}>
                {sb.label}
              </span>
              {/* Confidence badge */}
              <span className={`inline-flex items-center px-2 py-0.5 text-xs rounded-full border ${cb.cls}`}
                title="Agent confidence score">
                {cb.label} confidence
              </span>
              {/* Action type */}
              <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded">
                {approval.action_type}
              </span>
            </div>

            {/* Reason */}
            <p className="mt-2 text-sm text-foreground leading-relaxed line-clamp-3">
              {approval.reason}
            </p>

            {/* Meta */}
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              {approval.agent_name && (
                <span>🤖 {approval.agent_name}</span>
              )}
              {approval.task_title && (
                <span className="truncate max-w-[200px]" title={approval.task_title}>
                  📋 {approval.task_title}
                </span>
              )}
              <span title={new Date(approval.created_at * 1000).toISOString()}>
                🕐 {timeAgo(approval.created_at)}
              </span>
              {approval.resolved_by && (
                <span>👤 resolved by {approval.resolved_by}</span>
              )}
            </div>

            {/* Resolution note */}
            {approval.resolution_note && (
              <p className="mt-2 text-xs text-muted-foreground italic border-l-2 border-border pl-2">
                {approval.resolution_note}
              </p>
            )}
          </div>

          {/* Actions */}
          {isPending && (
            <div className="flex gap-1.5 shrink-0">
              <button
                onClick={() => setModal('approved')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition-smooth"
              >
                Approve
              </button>
              <button
                onClick={() => setModal('rejected')}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-smooth"
              >
                Reject
              </button>
            </div>
          )}
        </div>

        {/* Payload expander */}
        {approval.payload && Object.keys(approval.payload).length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-muted-foreground hover:text-foreground transition-smooth flex items-center gap-1"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
                className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}>
                <polyline points="5,3 11,8 5,13" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Payload details
            </button>
            {expanded && (
              <pre className="mt-2 text-xs bg-muted/50 rounded-lg p-3 overflow-x-auto max-h-48 text-foreground/80">
                {JSON.stringify(approval.payload, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function ApprovalQueuePanel() {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [total, setTotal] = useState(0)
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState<number | null>(null) // id being resolved

  const fetchApprovals = useCallback(async () => {
    try {
      const qs = statusFilter === 'all' ? '' : `?status=${statusFilter}`
      const res = await fetch(`/api/approvals${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: ApprovalsResponse = await res.json()
      setApprovals(data.approvals)
      setTotal(data.total)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approvals')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    setLoading(true)
    fetchApprovals()
  }, [fetchApprovals])

  // Auto-refresh every 10 s to catch agent-created requests
  useEffect(() => {
    const timer = setInterval(fetchApprovals, 10_000)
    return () => clearInterval(timer)
  }, [fetchApprovals])

  const handleDecide = useCallback(async (
    id: number,
    decision: 'approved' | 'rejected',
    note: string
  ) => {
    setSubmitting(id)
    try {
      const res = await fetch(`/api/approvals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: decision, resolution_note: note || null }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as any).error ?? `HTTP ${res.status}`)
      }
      // Optimistically update local state
      setApprovals((prev) =>
        prev.map((a) =>
          a.id === id
            ? { ...a, status: decision, resolution_note: note || null }
            : a
        )
      )
      // If filtered to pending, remove after short delay
      if (statusFilter === 'pending') {
        setTimeout(() => {
          setApprovals((prev) => prev.filter((a) => a.id !== id))
          setTotal((t) => Math.max(0, t - 1))
        }, 800)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update approval')
    } finally {
      setSubmitting(null)
    }
  }, [statusFilter])

  const pendingCount = approvals.filter((a) => a.status === 'pending').length

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            Approval Queue
            {pendingCount > 0 && statusFilter !== 'pending' && (
              <span className="inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-yellow-500 text-white">
                {pendingCount}
              </span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Human-in-the-loop governance — review agent action requests before they proceed.
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchApprovals() }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-secondary transition-smooth"
          disabled={loading}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
            className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`}>
            <path d="M14 8A6 6 0 1 1 8 2" strokeLinecap="round"/>
            <polyline points="14 2 14 8 8 8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Refresh
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        {(['pending', 'approved', 'rejected', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-smooth capitalize ${
              statusFilter === f
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

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

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
            className="w-5 h-5 animate-spin mr-2">
            <path d="M14 8A6 6 0 1 1 8 2" strokeLinecap="round"/>
          </svg>
          Loading approvals…
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && approvals.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
              className="w-6 h-6 text-muted-foreground">
              <path d="M8 1L2 4v4c0 4 2.5 6 6 7 3.5-1 6-3 6-7V4L8 1z" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 8l2 2 3-3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            {statusFilter === 'pending' ? 'No pending approvals' : 'Nothing to show'}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {statusFilter === 'pending'
              ? 'All clear — agents are operating without needing human sign-off.'
              : 'Try switching the filter above.'}
          </p>
        </div>
      )}

      {/* Cards */}
      {!loading && approvals.length > 0 && (
        <div className="space-y-3">
          {approvals.map((approval) => (
            <div key={approval.id} className={submitting === approval.id ? 'opacity-50 pointer-events-none' : ''}>
              <ApprovalCard approval={approval} onDecide={handleDecide} />
            </div>
          ))}

          {/* Total count */}
          {total > approvals.length && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              Showing {approvals.length} of {total} — use the API for pagination
            </p>
          )}
        </div>
      )}
    </div>
  )
}
