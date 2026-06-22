import { describe, it, expect } from 'vitest'
import {
  redact,
  redactString,
  redactValue,
  DEFAULT_REDACTION_PATTERNS,
  type RedactionPattern,
} from '../redaction.js'

describe('redact', () => {
  it('redacts Anthropic api keys', () => {
    const input = 'use sk-ant-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890 to call'
    const { output, matches } = redact(input)
    expect(output).toBe('use [REDACTED:anthropic_api_key] to call')
    expect(matches).toHaveLength(1)
    expect(matches[0].label).toBe('anthropic_api_key')
  })

  it('redacts OpenAI api keys including project-scoped form', () => {
    const a = redactString('OPENAI_KEY=sk-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')
    expect(a).toContain('[REDACTED:openai_api_key]')

    const b = redactString('key sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890 ok')
    expect(b).toContain('[REDACTED:openai_api_key]')
  })

  it('redacts GitHub PATs and classic tokens', () => {
    // Real github_pat_ format: 22 base62 + _ + 59 base62. The test fixture
    // here matches that exactly so the parser sees a valid PAT.
    const tail = 'AbCdEfGhIjKlMnOpQrStUv' // 22
    const secret = 'WxYz0123456789AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEfGhI' // 59
    const pat = redactString(`token=github_pat_${tail}_${secret}`)
    expect(pat).toContain('[REDACTED:github_pat]')

    const classic = redactString('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ab here')
    expect(classic).toContain('[REDACTED:github_token]')
  })

  it('redacts AWS access key ids and labelled secrets', () => {
    const k = redactString('AKIAIOSFODNN7EXAMPLE was leaked')
    expect(k).toContain('[REDACTED:aws_access_key_id]')

    const s = redactString('aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY rest')
    expect(s).toContain('[REDACTED:aws_secret_access_key]')
  })

  it('redacts JWT-shaped tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.dBjftJeZ4CVPMZ4Y8c0Knw5XfM5xqZx8rJk1lT0wZ7s'
    const r = redactString(`Authorization: Bearer ${jwt}`)
    // Either bearer_token or jwt label is acceptable as long as the secret
    // is gone.
    expect(r).not.toContain(jwt)
    expect(r).toMatch(/\[REDACTED:(bearer_token|jwt)\]/)
  })

  it('redacts PEM private key blocks across lines and beats inner matches', () => {
    const inner = 'sk-ant-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
    const pem = `-----BEGIN RSA PRIVATE KEY-----\nMIIBOQIBAAJAa${inner}\nABCDEF\n-----END RSA PRIVATE KEY-----`
    const r = redactString(pem)
    expect(r).toBe('[REDACTED:private_key_pem]')
    expect(r).not.toContain(inner)
  })

  it('redacts env-style assignments only by value', () => {
    const input = 'GH_TOKEN=ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ab\nAPI_KEY=mySuperSecret123'
    const r = redactString(input)
    // The variable name MUST stay so a debugger can see context.
    expect(r).toContain('GH_TOKEN=')
    expect(r).toContain('API_KEY=')
    // The value is gone.
    expect(r).not.toContain('mySuperSecret123')
    expect(r).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ab')
  })

  it('leaves benign text untouched', () => {
    const input = 'The quick brown fox jumps over the lazy dog.'
    expect(redactString(input)).toBe(input)
  })

  it('is idempotent', () => {
    const input = 'key=sk-ant-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890'
    const once = redactString(input)
    const twice = redactString(once)
    expect(twice).toBe(once)
  })

  it('returns match offsets in the original string', () => {
    const input = 'pre sk-ant-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890 post'
    const { matches } = redact(input)
    expect(matches).toHaveLength(1)
    expect(input.slice(matches[0].start, matches[0].end)).toBe(
      'sk-ant-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
    )
  })

  it('handles empty input', () => {
    expect(redactString('')).toBe('')
    expect(redact('').matches).toEqual([])
  })

  it('respects custom pattern lists', () => {
    const patterns: RedactionPattern[] = [
      { label: 'customer_id', pattern: /\bCUST-\d{6}\b/g },
    ]
    const r = redactString('order for CUST-123456 ok', patterns)
    expect(r).toBe('order for [REDACTED:customer_id] ok')
  })

  it('exports a default pattern set with the documented labels', () => {
    const labels = new Set(DEFAULT_REDACTION_PATTERNS.map((p) => p.label))
    for (const required of [
      'anthropic_api_key',
      'openai_api_key',
      'github_token',
      'aws_access_key_id',
      'private_key_pem',
      'jwt',
      'bearer_token',
    ]) {
      expect(labels.has(required)).toBe(true)
    }
  })

  it('does not match short alphanum runs in prose', () => {
    // The previous "Bearer" rule was anchored on the literal word; bare
    // tokens without the prefix should pass through.
    const input = 'I love coding in TypeScript on weekdays at home in Brooklyn'
    expect(redactString(input)).toBe(input)
  })
})

describe('redactValue', () => {
  it('walks plain objects and arrays', () => {
    const input = {
      provider: 'anthropic',
      key: 'sk-ant-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890',
      nested: {
        tokens: ['ghp_AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ab', 'safe-value'],
      },
      count: 7,
      ok: true,
    }
    const out = redactValue(input)
    expect(out.provider).toBe('anthropic')
    expect(out.key).toBe('[REDACTED:anthropic_api_key]')
    expect(out.nested.tokens[0]).toBe('[REDACTED:github_token]')
    expect(out.nested.tokens[1]).toBe('safe-value')
    expect(out.count).toBe(7)
    expect(out.ok).toBe(true)
  })

  it('returns non-plain-object values unchanged', () => {
    const date = new Date()
    expect(redactValue(date)).toBe(date)
    const map = new Map([['k', 'v']])
    expect(redactValue(map)).toBe(map)
    expect(redactValue(null)).toBe(null)
    expect(redactValue(undefined)).toBe(undefined)
  })

  it('does not mutate the input', () => {
    const input = { key: 'sk-ant-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890' }
    redactValue(input)
    expect(input.key).toBe('sk-ant-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890')
  })
})
