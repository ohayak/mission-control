/**
 * Runtime config — fetches NEXT_PUBLIC_* values from the server at runtime
 * instead of relying on build-time inlining.
 *
 * Usage (React):
 *   const { config, isLoading } = useRuntimeConfig()
 *
 * Usage (non-React):
 *   const config = await fetchRuntimeConfig()
 *   // or synchronously after init:
 *   const config = getRuntimeConfig()
 */
'use client'

import { useState, useEffect } from 'react'

export interface RuntimeConfig {
  GATEWAY_HOST: string
  GATEWAY_PORT: string
  GATEWAY_PROTOCOL: string
  GATEWAY_URL: string
  GATEWAY_TOKEN: string
  GATEWAY_CLIENT_ID: string
  COORDINATOR_AGENT: string
  GOOGLE_CLIENT_ID: string
}

// Build-time fallbacks (may be empty if not set at build)
const BUILD_TIME_DEFAULTS: RuntimeConfig = {
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

// Module-level cache — fetched once, shared across all consumers
let cachedConfig: RuntimeConfig | null = null
let fetchPromise: Promise<RuntimeConfig> | null = null

/**
 * Fetch runtime config from the server. Returns cached result on subsequent calls.
 */
export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) return cachedConfig

  if (fetchPromise) return fetchPromise

  fetchPromise = (async (): Promise<RuntimeConfig> => {
    try {
      const res = await fetch('/api/config/public', {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`)
      const data = await res.json()
      const resolved: RuntimeConfig = { ...BUILD_TIME_DEFAULTS, ...data }
      // GATEWAY_TOKEN may be omitted by server if not authenticated
      if (!('GATEWAY_TOKEN' in data)) resolved.GATEWAY_TOKEN = BUILD_TIME_DEFAULTS.GATEWAY_TOKEN
      cachedConfig = resolved
      return resolved
    } catch {
      // Fall back to build-time defaults
      cachedConfig = BUILD_TIME_DEFAULTS
      return BUILD_TIME_DEFAULTS
    }
  })()

  fetchPromise.finally(() => {
    fetchPromise = null
  })

  return fetchPromise
}

/**
 * Get runtime config synchronously. Returns build-time defaults if not yet fetched.
 */
export function getRuntimeConfig(): RuntimeConfig {
  return cachedConfig || BUILD_TIME_DEFAULTS
}

/**
 * React hook for runtime config.
 */
export function useRuntimeConfig() {
  const [config, setConfig] = useState<RuntimeConfig>(
    cachedConfig || BUILD_TIME_DEFAULTS
  )
  const [isLoading, setIsLoading] = useState(!cachedConfig)

  useEffect(() => {
    if (cachedConfig) {
      setConfig(cachedConfig)
      setIsLoading(false)
      return
    }

    fetchRuntimeConfig().then((cfg) => {
      setConfig(cfg)
      setIsLoading(false)
    })
  }, [])

  return { config, isLoading }
}
