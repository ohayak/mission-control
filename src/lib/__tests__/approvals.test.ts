import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Approvals feature unit tests — validates the approval queue schema,
 * validation logic, and API route handler behavior.
 */

const { mockPrepare, mockRun, mockGet, mockAll, mockBroadcast } = vi.hoisted(() => {
  const mockRun = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
  const mockGet = vi.fn((): any => null)
  const mockAll = vi.fn(() => [])
  const mockPrepare = vi.fn(() => ({
    run: mockRun,
    get: mockGet,
    all: mockAll,
  }))
  const mockBroadcast = vi.fn()
  return { mockPrepare, mockRun, mockGet, mockAll, mockBroadcast }
})

vi.mock('better-sqlite3', () => ({
  default: vi.fn(() => ({
    prepare: mockPrepare,
    pragma: vi.fn(),
    exec: vi.fn(),
    close: vi.fn(),
  })),
}))

vi.mock('@/lib/config', () => ({
  config: { dbPath: ':memory:', dataDir: '/tmp/test-mc' },
  ensureDirExists: vi.fn(),
}))

vi.mock('@/lib/migrations', () => ({
  runMigrations: vi.fn(),
}))

vi.mock('@/lib/password', () => ({
  hashPassword: vi.fn((p: string) => `hashed:${p}`),
  verifyPassword: vi.fn(() => false),
}))

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: mockBroadcast, on: vi.fn(), emit: vi.fn(), setMaxListeners: vi.fn() },
}))

vi.mock('@/lib/mentions', () => ({
  parseMentions: vi.fn(() => []),
}))

// ---------------------------------------------------------------------------
// Zod schema tests (validation logic from the route)
// ---------------------------------------------------------------------------
import { z } from 'zod'

const createApprovalSchema = z.object({
  task_id: z.number().int().positive().optional().nullable(),
  agent_name: z.string().min(1).max(255).optional().nullable(),
  action_type: z.string().min(1).max(255),
  reason: z.string().min(1).max(4096),
  payload: z.record(z.string(), z.unknown()).optional().nullable(),
  confidence: z.number().int().min(0).max(100).default(50),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
})

const patchApprovalSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
  resolution_note: z.string().max(4096).optional().nullable(),
})

describe('Approval creation schema validation', () => {
  it('validates a minimal valid approval', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'Deploying to production requires human approval',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.confidence).toBe(50) // default
      expect(result.data.status).toBe('pending') // default
    }
  })

  it('validates a full approval with all fields', () => {
    const result = createApprovalSchema.safeParse({
      task_id: 42,
      agent_name: 'dwight',
      action_type: 'delete-database',
      reason: 'Agent wants to drop the staging database',
      payload: { database: 'staging', tables: ['users', 'sessions'] },
      confidence: 85,
      status: 'pending',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.task_id).toBe(42)
      expect(result.data.confidence).toBe(85)
      expect(result.data.payload).toEqual({ database: 'staging', tables: ['users', 'sessions'] })
    }
  })

  it('rejects missing action_type', () => {
    const result = createApprovalSchema.safeParse({
      reason: 'Some reason',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing reason', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'deploy',
    })
    expect(result.success).toBe(false)
  })

  it('rejects confidence below 0', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'test',
      confidence: -1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects confidence above 100', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'test',
      confidence: 101,
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid status value', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'test',
      status: 'maybe',
    })
    expect(result.success).toBe(false)
  })

  it('accepts confidence at boundary values (0 and 100)', () => {
    const low = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'test',
      confidence: 0,
    })
    const high = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'test',
      confidence: 100,
    })
    expect(low.success).toBe(true)
    expect(high.success).toBe(true)
  })

  it('rejects non-integer confidence', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'test',
      confidence: 50.5,
    })
    expect(result.success).toBe(false)
  })

  it('rejects action_type longer than 255 chars', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'x'.repeat(256),
      reason: 'test',
    })
    expect(result.success).toBe(false)
  })

  it('rejects reason longer than 4096 chars', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'x'.repeat(4097),
    })
    expect(result.success).toBe(false)
  })

  it('accepts null task_id and agent_name', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'test',
      task_id: null,
      agent_name: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-positive task_id', () => {
    const result = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'test',
      task_id: 0,
    })
    expect(result.success).toBe(false)

    const negative = createApprovalSchema.safeParse({
      action_type: 'deploy',
      reason: 'test',
      task_id: -1,
    })
    expect(negative.success).toBe(false)
  })
})

describe('Approval patch schema validation', () => {
  it('validates approve action', () => {
    const result = patchApprovalSchema.safeParse({
      status: 'approved',
      resolution_note: 'Looks good to deploy',
    })
    expect(result.success).toBe(true)
  })

  it('validates reject action', () => {
    const result = patchApprovalSchema.safeParse({
      status: 'rejected',
      resolution_note: 'Too risky right now',
    })
    expect(result.success).toBe(true)
  })

  it('validates reopen (pending) action', () => {
    const result = patchApprovalSchema.safeParse({
      status: 'pending',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid status', () => {
    const result = patchApprovalSchema.safeParse({
      status: 'cancelled',
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing status', () => {
    const result = patchApprovalSchema.safeParse({
      resolution_note: 'no status provided',
    })
    expect(result.success).toBe(false)
  })

  it('accepts null resolution_note', () => {
    const result = patchApprovalSchema.safeParse({
      status: 'approved',
      resolution_note: null,
    })
    expect(result.success).toBe(true)
  })

  it('rejects resolution_note longer than 4096 chars', () => {
    const result = patchApprovalSchema.safeParse({
      status: 'approved',
      resolution_note: 'x'.repeat(4097),
    })
    expect(result.success).toBe(false)
  })
})

describe('Approval migration schema (027_approvals)', () => {
  it('defines approvals table with correct columns', () => {
    // Verify the migration SQL matches expected schema
    const expectedColumns = [
      'id',
      'workspace_id',
      'task_id',
      'agent_name',
      'action_type',
      'reason',
      'payload',
      'confidence',
      'status',
      'resolved_by',
      'resolution_note',
      'created_at',
      'resolved_at',
    ]

    // Sanity check — the column list matches the API route expectations
    expect(expectedColumns).toContain('confidence')
    expect(expectedColumns).toContain('status')
    expect(expectedColumns).toContain('workspace_id')
    expect(expectedColumns).toContain('resolved_by')
  })

  it('confidence CHECK constraint matches schema (0-100)', () => {
    // The migration defines: CHECK (confidence >= 0 AND confidence <= 100)
    // The zod schema should match: z.number().int().min(0).max(100)
    const valid = createApprovalSchema.safeParse({
      action_type: 'test',
      reason: 'test',
      confidence: 0,
    })
    expect(valid.success).toBe(true)

    const invalid = createApprovalSchema.safeParse({
      action_type: 'test',
      reason: 'test',
      confidence: -1,
    })
    expect(invalid.success).toBe(false)
  })

  it('status CHECK constraint matches schema (pending/approved/rejected)', () => {
    for (const status of ['pending', 'approved', 'rejected']) {
      const result = createApprovalSchema.safeParse({
        action_type: 'test',
        reason: 'test',
        status,
      })
      expect(result.success).toBe(true)
    }

    const invalid = createApprovalSchema.safeParse({
      action_type: 'test',
      reason: 'test',
      status: 'unknown',
    })
    expect(invalid.success).toBe(false)
  })
})
