import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Use vi.hoisted() so mock variables are available inside vi.mock() factories
const {
  mockExec,
  mockPragma,
  mockClose,
  mockPrepare,
  mockRun,
  mockGet,
  mockAll,
  mockRunMigrations,
  mockEnsureDirExists,
  mockHashPassword,
  mockLogger,
  DatabaseConstructor,
} = vi.hoisted(() => {
  const mockRun = vi.fn(() => ({ lastInsertRowid: 1, changes: 1 }))
  const mockGet = vi.fn((): any => ({ count: 0 }))
  const mockAll = vi.fn(() => [])
  const mockPrepare = vi.fn(() => ({
    run: mockRun,
    get: mockGet,
    all: mockAll,
  }))
  const mockExec = vi.fn()
  const mockPragma = vi.fn()
  const mockClose = vi.fn()
  const mockRunMigrations = vi.fn()
  const mockEnsureDirExists = vi.fn()
  const mockHashPassword = vi.fn((p: string) => `hashed:${p}`)
  const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }

  const DatabaseConstructor = vi.fn(() => ({
    prepare: mockPrepare,
    pragma: mockPragma,
    exec: mockExec,
    close: mockClose,
  }))

  return {
    mockExec,
    mockPragma,
    mockClose,
    mockPrepare,
    mockRun,
    mockGet,
    mockAll,
    mockRunMigrations,
    mockEnsureDirExists,
    mockHashPassword,
    mockLogger,
    DatabaseConstructor,
  }
})

// Mock better-sqlite3
vi.mock('better-sqlite3', () => ({
  default: DatabaseConstructor,
}))

vi.mock('@/lib/config', () => ({
  config: { dbPath: '/tmp/test-mc/mission-control.db', dataDir: '/tmp/test-mc' },
  ensureDirExists: mockEnsureDirExists,
}))

vi.mock('@/lib/migrations', () => ({
  runMigrations: mockRunMigrations,
}))

vi.mock('@/lib/password', () => ({
  hashPassword: mockHashPassword,
  verifyPassword: vi.fn(() => false),
}))

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}))

vi.mock('@/lib/event-bus', () => ({
  eventBus: { broadcast: vi.fn(), on: vi.fn(), emit: vi.fn(), setMaxListeners: vi.fn() },
}))

// Mock dynamic imports for webhooks and scheduler (they are imported lazily)
vi.mock('@/lib/webhooks', () => ({
  initWebhookListener: vi.fn(),
}))

vi.mock('@/lib/scheduler', () => ({
  initScheduler: vi.fn(),
}))

vi.mock('@/lib/mentions', () => ({
  parseMentions: vi.fn((text: string) => {
    const matches = text.match(/@([\w.-]+)/g) || []
    return [...new Set(matches.map((m: string) => m.slice(1)))]
  }),
}))

// We need to re-import fresh modules for each test group to reset singleton state
// Use dynamic imports inside tests

describe('getDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset module registry to clear singleton db instance
    vi.resetModules()
  })

  it('creates DB connection and enables WAL mode with correct pragmas', async () => {
    const { getDatabase } = await import('@/lib/db')
    const db = getDatabase()

    expect(DatabaseConstructor).toHaveBeenCalledWith('/tmp/test-mc/mission-control.db')
    expect(mockPragma).toHaveBeenCalledWith('journal_mode = WAL')
    expect(mockPragma).toHaveBeenCalledWith('synchronous = NORMAL')
    expect(mockPragma).toHaveBeenCalledWith('cache_size = 1000')
    expect(mockPragma).toHaveBeenCalledWith('foreign_keys = ON')
    expect(db).toBeDefined()
  })

  it('calls ensureDirExists before opening DB', async () => {
    const { getDatabase } = await import('@/lib/db')
    getDatabase()

    expect(mockEnsureDirExists).toHaveBeenCalledWith('/tmp/test-mc')
  })

  it('returns same instance on repeated calls (singleton)', async () => {
    const { getDatabase } = await import('@/lib/db')
    const db1 = getDatabase()
    const db2 = getDatabase()

    expect(db1).toBe(db2)
    // Constructor should only be called once
    expect(DatabaseConstructor).toHaveBeenCalledTimes(1)
  })

  it('calls runMigrations during initialization', async () => {
    const { getDatabase } = await import('@/lib/db')
    getDatabase()

    expect(mockRunMigrations).toHaveBeenCalledTimes(1)
  })

  it('logs success after migrations', async () => {
    const { getDatabase } = await import('@/lib/db')
    getDatabase()

    expect(mockLogger.info).toHaveBeenCalledWith('Database migrations applied successfully')
  })

  it('throws and logs error when migrations fail', async () => {
    const migrationError = new Error('SQLITE_READONLY')
    mockRunMigrations.mockImplementationOnce(() => {
      throw migrationError
    })

    const { getDatabase } = await import('@/lib/db')

    expect(() => getDatabase()).toThrow('SQLITE_READONLY')
    expect(mockLogger.error).toHaveBeenCalledWith(
      { err: migrationError },
      'Failed to apply database migrations'
    )
  })
})

describe('closeDatabase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('closes connection and allows new connection after', async () => {
    const { getDatabase, closeDatabase } = await import('@/lib/db')

    getDatabase()
    expect(DatabaseConstructor).toHaveBeenCalledTimes(1)

    closeDatabase()
    expect(mockClose).toHaveBeenCalledTimes(1)

    // Should create a new connection after close
    getDatabase()
    expect(DatabaseConstructor).toHaveBeenCalledTimes(2)
  })

  it('is safe to call when no connection exists', async () => {
    const { closeDatabase } = await import('@/lib/db')
    // Should not throw
    expect(() => closeDatabase()).not.toThrow()
    expect(mockClose).not.toHaveBeenCalled()
  })
})

describe('resolveSeedAuthPassword', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns AUTH_PASS when AUTH_PASS_B64 is not set', async () => {
    const { resolveSeedAuthPassword } = await import('@/lib/db')
    const result = resolveSeedAuthPassword({ AUTH_PASS: 'mypassword' } as any)
    expect(result).toBe('mypassword')
  })

  it('returns null when neither AUTH_PASS nor AUTH_PASS_B64 is set', async () => {
    const { resolveSeedAuthPassword } = await import('@/lib/db')
    const result = resolveSeedAuthPassword({} as any)
    expect(result).toBeNull()
  })

  it('decodes AUTH_PASS_B64 when valid base64', async () => {
    const { resolveSeedAuthPassword } = await import('@/lib/db')
    // "secretpass" in base64
    const b64 = Buffer.from('secretpass').toString('base64')
    const result = resolveSeedAuthPassword({ AUTH_PASS_B64: b64 } as any)
    expect(result).toBe('secretpass')
  })

  it('falls back to AUTH_PASS when AUTH_PASS_B64 is invalid base64', async () => {
    const { resolveSeedAuthPassword } = await import('@/lib/db')
    const result = resolveSeedAuthPassword({
      AUTH_PASS_B64: '!!!not-base64!!!',
      AUTH_PASS: 'fallback',
    } as any)
    expect(result).toBe('fallback')
  })

  it('falls back to AUTH_PASS when AUTH_PASS_B64 decodes to empty', async () => {
    const { resolveSeedAuthPassword } = await import('@/lib/db')
    const result = resolveSeedAuthPassword({
      AUTH_PASS_B64: '',
      AUTH_PASS: 'fallback',
    } as any)
    expect(result).toBe('fallback')
  })

  it('prefers AUTH_PASS_B64 over AUTH_PASS when both set and valid', async () => {
    const { resolveSeedAuthPassword } = await import('@/lib/db')
    const b64 = Buffer.from('fromb64').toString('base64')
    const result = resolveSeedAuthPassword({
      AUTH_PASS_B64: b64,
      AUTH_PASS: 'fromenv',
    } as any)
    expect(result).toBe('fromb64')
  })
})

describe('seedAdminUserFromEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    delete process.env.NEXT_PHASE
    delete process.env.AUTH_USER
    delete process.env.AUTH_PASS
  })

  afterEach(() => {
    delete process.env.NEXT_PHASE
    delete process.env.AUTH_USER
    delete process.env.AUTH_PASS
  })

  it('seeds admin user when no users exist and AUTH_PASS is set', async () => {
    process.env.AUTH_USER = 'admin'
    process.env.AUTH_PASS = 'strongpassword123'
    mockGet.mockReturnValue({ count: 0 })

    const { getDatabase } = await import('@/lib/db')
    getDatabase()

    // seedAdminUserFromEnv is called internally by initializeSchema
    // It should have called prepare + run for INSERT
    expect(mockRun).toHaveBeenCalled()
    expect(mockHashPassword).toHaveBeenCalledWith('strongpassword123')
  })

  it('skips seeding when users already exist', async () => {
    process.env.AUTH_PASS = 'strongpassword123'
    mockGet.mockReturnValue({ count: 5 })

    const { getDatabase } = await import('@/lib/db')
    getDatabase()

    // hashPassword should NOT be called since users exist
    expect(mockHashPassword).not.toHaveBeenCalled()
  })

  it('skips seeding during next build phase', async () => {
    process.env.NEXT_PHASE = 'phase-production-build'
    process.env.AUTH_PASS = 'strongpassword123'
    mockGet.mockReturnValue({ count: 0 })

    const { getDatabase } = await import('@/lib/db')
    getDatabase()

    expect(mockHashPassword).not.toHaveBeenCalled()
  })

  it('skips seeding with insecure passwords and warns', async () => {
    process.env.AUTH_PASS = 'admin'
    mockGet.mockReturnValue({ count: 0 })

    const { getDatabase } = await import('@/lib/db')
    getDatabase()

    expect(mockHashPassword).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('known insecure default')
    )
  })

  it('warns when AUTH_PASS is not set', async () => {
    delete process.env.AUTH_PASS
    mockGet.mockReturnValue({ count: 0 })

    const { getDatabase } = await import('@/lib/db')
    getDatabase()

    expect(mockHashPassword).not.toHaveBeenCalled()
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('AUTH_PASS is not set')
    )
  })
})
