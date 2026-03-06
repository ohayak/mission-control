/**
 * Runtime config endpoint — serves NEXT_PUBLIC_* env vars to the browser at runtime.
 *
 * Next.js inlines NEXT_PUBLIC_* at build time, which means Docker containers
 * cannot override them via environment variables.  This endpoint reads them
 * server-side (where process.env is live) and exposes a safe subset to the client.
 *
 * GET /api/config/public  — requires authentication (viewer role minimum)
 *
 * Sensitive values (GATEWAY_TOKEN) are only served to authenticated users.
 * Non-sensitive values (host, port, protocol, client ID) are always returned.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export function GET(request: NextRequest) {
  const auth = requireRole(request, 'viewer')
  const isAuthenticated = !('error' in auth)

  // Non-sensitive config — safe for anyone
  const config: Record<string, string> = {
    GATEWAY_HOST: process.env.NEXT_PUBLIC_GATEWAY_HOST || '',
    GATEWAY_PORT: process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789',
    GATEWAY_PROTOCOL: process.env.NEXT_PUBLIC_GATEWAY_PROTOCOL || '',
    GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL || '',
    GATEWAY_CLIENT_ID:
      process.env.NEXT_PUBLIC_GATEWAY_CLIENT_ID || 'openclaw-control-ui',
    COORDINATOR_AGENT: (
      process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator'
    ).toLowerCase(),
    GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
  }

  // Sensitive config — only for authenticated users
  if (isAuthenticated) {
    config.GATEWAY_TOKEN =
      process.env.NEXT_PUBLIC_GATEWAY_TOKEN ||
      process.env.NEXT_PUBLIC_WS_TOKEN ||
      ''
  }

  return NextResponse.json(config, {
    headers: {
      'Cache-Control': isAuthenticated
        ? 'private, max-age=300'
        : 'public, max-age=300, stale-while-revalidate=60',
    },
  })
}
