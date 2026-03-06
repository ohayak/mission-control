/**
 * Public runtime config endpoint — serves NEXT_PUBLIC_* env vars to the browser at runtime.
 *
 * Next.js inlines NEXT_PUBLIC_* at build time, which means Docker containers
 * cannot override them via environment variables.  This endpoint reads them
 * server-side (where process.env is live) and exposes a safe subset to the client.
 *
 * GET /api/config/public  — no auth required (values are non-secret)
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  const config = {
    GATEWAY_HOST: process.env.NEXT_PUBLIC_GATEWAY_HOST || '',
    GATEWAY_PORT: process.env.NEXT_PUBLIC_GATEWAY_PORT || '18789',
    GATEWAY_PROTOCOL: process.env.NEXT_PUBLIC_GATEWAY_PROTOCOL || '',
    GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL || '',
    GATEWAY_TOKEN:
      process.env.NEXT_PUBLIC_GATEWAY_TOKEN ||
      process.env.NEXT_PUBLIC_WS_TOKEN ||
      '',
    GATEWAY_CLIENT_ID:
      process.env.NEXT_PUBLIC_GATEWAY_CLIENT_ID || 'openclaw-control-ui',
    COORDINATOR_AGENT: (
      process.env.NEXT_PUBLIC_COORDINATOR_AGENT || 'coordinator'
    ).toLowerCase(),
    GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '',
  }

  return NextResponse.json(config, {
    headers: {
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
    },
  })
}
