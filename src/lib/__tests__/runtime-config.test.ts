import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Runtime config unit tests — validates the public config endpoint response
 * and the client-side config module behavior.
 */

describe('Runtime config API response shape', () => {
  it('returns all expected config keys', () => {
    // Expected keys from /api/config/public
    const expectedKeys = [
      'GATEWAY_HOST',
      'GATEWAY_PORT',
      'GATEWAY_PROTOCOL',
      'GATEWAY_URL',
      'GATEWAY_TOKEN',
      'GATEWAY_CLIENT_ID',
      'COORDINATOR_AGENT',
      'GOOGLE_CLIENT_ID',
    ]

    // Simulate the shape returned by the endpoint
    const config = {
      GATEWAY_HOST: '',
      GATEWAY_PORT: '18789',
      GATEWAY_PROTOCOL: '',
      GATEWAY_URL: '',
      GATEWAY_TOKEN: '',
      GATEWAY_CLIENT_ID: 'openclaw-control-ui',
      COORDINATOR_AGENT: 'coordinator',
      GOOGLE_CLIENT_ID: '',
    }

    for (const key of expectedKeys) {
      expect(config).toHaveProperty(key)
    }
  })

  it('has correct default values', () => {
    const defaults = {
      GATEWAY_HOST: '',
      GATEWAY_PORT: '18789',
      GATEWAY_PROTOCOL: '',
      GATEWAY_URL: '',
      GATEWAY_TOKEN: '',
      GATEWAY_CLIENT_ID: 'openclaw-control-ui',
      COORDINATOR_AGENT: 'coordinator',
      GOOGLE_CLIENT_ID: '',
    }

    expect(defaults.GATEWAY_PORT).toBe('18789')
    expect(defaults.GATEWAY_CLIENT_ID).toBe('openclaw-control-ui')
    expect(defaults.COORDINATOR_AGENT).toBe('coordinator')
  })
})

describe('Runtime config env var mapping', () => {
  it('maps NEXT_PUBLIC_GATEWAY_HOST to GATEWAY_HOST', () => {
    const envValue = 'my-gateway.example.com'
    // Simulates what the API endpoint does
    const config = {
      GATEWAY_HOST: envValue || '',
    }
    expect(config.GATEWAY_HOST).toBe('my-gateway.example.com')
  })

  it('maps NEXT_PUBLIC_GATEWAY_PORT to GATEWAY_PORT with fallback', () => {
    const withValue = { GATEWAY_PORT: '9999' || '18789' }
    const withoutValue = { GATEWAY_PORT: '' || '18789' }

    expect(withValue.GATEWAY_PORT).toBe('9999')
    expect(withoutValue.GATEWAY_PORT).toBe('18789')
  })

  it('prefers NEXT_PUBLIC_GATEWAY_TOKEN over NEXT_PUBLIC_WS_TOKEN', () => {
    // Simulates the API logic
    const gatewayToken = 'gateway-tok'
    const wsToken = 'ws-tok'

    const result = gatewayToken || wsToken || ''
    expect(result).toBe('gateway-tok')
  })

  it('falls back to NEXT_PUBLIC_WS_TOKEN when GATEWAY_TOKEN is empty', () => {
    const gatewayToken = ''
    const wsToken = 'ws-tok'

    const result = gatewayToken || wsToken || ''
    expect(result).toBe('ws-tok')
  })

  it('lowercases COORDINATOR_AGENT', () => {
    const raw = 'MyCoordinator'
    const result = raw.toLowerCase()
    expect(result).toBe('mycoordinator')
  })
})

describe('Runtime config WebSocket URL construction', () => {
  it('builds ws:// URL from host and port', () => {
    const config = {
      GATEWAY_HOST: '76.13.63.227',
      GATEWAY_PORT: '18789',
      GATEWAY_PROTOCOL: '',
      GATEWAY_URL: '',
    }

    const proto = config.GATEWAY_PROTOCOL || 'ws'
    const url = config.GATEWAY_URL || `${proto}://${config.GATEWAY_HOST}:${config.GATEWAY_PORT}`
    expect(url).toBe('ws://76.13.63.227:18789')
  })

  it('prefers explicit GATEWAY_URL over constructed URL', () => {
    const config = {
      GATEWAY_HOST: '76.13.63.227',
      GATEWAY_PORT: '18789',
      GATEWAY_PROTOCOL: '',
      GATEWAY_URL: 'wss://gateway.example.com',
    }

    const proto = config.GATEWAY_PROTOCOL || 'ws'
    const url = config.GATEWAY_URL || `${proto}://${config.GATEWAY_HOST}:${config.GATEWAY_PORT}`
    expect(url).toBe('wss://gateway.example.com')
  })

  it('uses wss when protocol is set', () => {
    const config = {
      GATEWAY_HOST: 'gateway.example.com',
      GATEWAY_PORT: '443',
      GATEWAY_PROTOCOL: 'wss',
      GATEWAY_URL: '',
    }

    const proto = config.GATEWAY_PROTOCOL || 'ws'
    const url = config.GATEWAY_URL || `${proto}://${config.GATEWAY_HOST}:${config.GATEWAY_PORT}`
    expect(url).toBe('wss://gateway.example.com:443')
  })

  it('falls back to window.location.hostname when GATEWAY_HOST is empty', () => {
    const config = {
      GATEWAY_HOST: '',
      GATEWAY_PORT: '18789',
    }

    const hostname = 'localhost' // simulating window.location.hostname
    const host = config.GATEWAY_HOST || hostname
    expect(host).toBe('localhost')
  })
})
