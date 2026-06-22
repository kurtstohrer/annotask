/**
 * Secret redaction for prompts and tool results before they leave the
 * machine. Applied to every string that goes to a provider — system prompt,
 * conversation messages, and tool results.
 *
 * Three rules:
 * 1. Catch common provider-key and credential shapes by structure (prefix +
 *    high-entropy tail), not by exhaustive enumeration. New providers fall
 *    into one of these shapes naturally.
 * 2. Never alter byte ranges that are not a secret. Redacted output is the
 *    same string with literal `[REDACTED:<label>]` markers swapped in.
 * 3. Idempotent. Running redact twice on a payload produces the same output
 *    as running it once.
 *
 * Conservative on false positives in the bodies of natural-language prompts
 * (avoid eating short alphanum runs); aggressive on identifiable provider
 * prefixes (`sk-ant-`, `ghp_`, `xoxb-`, `AKIA…`, `-----BEGIN…PRIVATE KEY-----`).
 */

export interface RedactionPattern {
  /** Label included in the redaction marker, e.g. `anthropic_api_key`. */
  label: string
  /** Pattern to match. Should be anchored on prefix where possible. */
  pattern: RegExp
}

export interface RedactionMatch {
  label: string
  /** Index of the first character of the match in the input. */
  start: number
  /** Index past the last character of the match. */
  end: number
}

export interface RedactionResult {
  output: string
  matches: ReadonlyArray<RedactionMatch>
}

/**
 * Default redaction patterns. Ordered so that more specific patterns run
 * first; the redactor short-circuits per-byte so order matters when two
 * patterns could overlap.
 */
export const DEFAULT_REDACTION_PATTERNS: ReadonlyArray<RedactionPattern> = [
  // PEM blocks — multi-line, must run before per-line scans.
  {
    label: 'private_key_pem',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  },
  // Anthropic — `sk-ant-` followed by base64url-ish characters.
  {
    label: 'anthropic_api_key',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  },
  // OpenAI — both legacy `sk-…` and project-scoped `sk-proj-…`.
  {
    label: 'openai_api_key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  // GitHub personal-access tokens and OAuth tokens.
  {
    label: 'github_token',
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
  },
  // GitHub fine-grained PATs — `github_pat_` + 22 base62 + `_` + 59 base62.
  {
    label: 'github_pat',
    pattern: /\bgithub_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}\b/g,
  },
  // Slack bot/user/app tokens.
  {
    label: 'slack_token',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  // AWS access key ids.
  {
    label: 'aws_access_key_id',
    pattern: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g,
  },
  // AWS secret access keys when explicitly labeled. Bare 40-char b64 strings
  // are too noisy to match safely without a key cue.
  {
    label: 'aws_secret_access_key',
    pattern: /(?<=aws_?secret(?:_access)?_?key["'\s:=]+)["']?[A-Za-z0-9/+]{40}["']?/gi,
  },
  // Generic bearer tokens in Authorization headers.
  {
    label: 'bearer_token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}\b/g,
  },
  // JWT tokens — three base64url segments separated by dots.
  {
    label: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  // Google API keys — `AIza` + 35 url-safe chars.
  {
    label: 'google_api_key',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
  },
  // Stripe secret/restricted keys (live and test).
  {
    label: 'stripe_secret_key',
    pattern: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  },
  // Credentials embedded in a connection string (`proto://user:PASSWORD@host`).
  // Redact just the password via the `value` sub-group; the scheme/user stay.
  {
    label: 'connection_string_password',
    pattern: /(?<=[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)(?<value>[^@\s/]+)(?=@)/gi,
  },
  // .env-style assignments where the variable name screams secret. Match the
  // value only, so the variable name stays in context for debugging.
  {
    label: 'env_secret',
    pattern: /(?<=^|\n)(?<keyword>(?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY))\s*=\s*["']?(?<value>[^\s"'\n]{8,})["']?/g,
  },
]

/**
 * Apply the given patterns to `input` and return the redacted output plus
 * the list of match locations (against the *original* input, not the output
 * — useful for telemetry without leaking the redacted bytes).
 */
export function redact(
  input: string,
  patterns: ReadonlyArray<RedactionPattern> = DEFAULT_REDACTION_PATTERNS,
): RedactionResult {
  if (!input) return { output: input, matches: [] }

  // Collect every match across all patterns first. We compare offsets in the
  // original string and then drop matches that fully overlap an earlier one.
  type Hit = { label: string; start: number; end: number; replacement: string }
  const hits: Hit[] = []

  for (const { label, pattern } of patterns) {
    // Patterns are stateful (`g` flag); reset lastIndex before reusing.
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(input)) != null) {
      // env_secret keeps the keyword=...  prefix outside the match via a
      // lookbehind; if a sub-group `value` exists, redact just that.
      const groupValue = m.groups?.value
      let start: number
      let end: number
      if (groupValue != null) {
        // Re-anchor the match to the `value` sub-group's byte range.
        const idx = input.indexOf(groupValue, m.index)
        if (idx < 0) continue
        start = idx
        end = idx + groupValue.length
      } else {
        start = m.index
        end = m.index + m[0].length
      }
      if (end === start) {
        // Defensive: zero-width match — advance to avoid infinite loop.
        pattern.lastIndex = start + 1
        continue
      }
      hits.push({
        label,
        start,
        end,
        replacement: `[REDACTED:${label}]`,
      })
    }
  }

  if (hits.length === 0) return { output: input, matches: [] }

  // Sort by start; resolve overlaps by keeping the earliest start and the
  // widest span (so a private-key PEM block beats any anthropic-key match
  // inside it).
  hits.sort((a, b) => (a.start - b.start) || (b.end - b.start) - (a.end - a.start))
  const accepted: Hit[] = []
  let cursor = -1
  for (const hit of hits) {
    if (hit.start < cursor) continue
    accepted.push(hit)
    cursor = hit.end
  }

  let out = ''
  let last = 0
  for (const hit of accepted) {
    out += input.slice(last, hit.start)
    out += hit.replacement
    last = hit.end
  }
  out += input.slice(last)

  return {
    output: out,
    matches: accepted.map(({ label, start, end }) => ({ label, start, end })),
  }
}

/**
 * Convenience wrapper that returns just the redacted string. Use this when
 * the caller doesn't need the match-location metadata.
 */
export function redactString(
  input: string,
  patterns?: ReadonlyArray<RedactionPattern>,
): string {
  return redact(input, patterns).output
}

/**
 * Walk a structured value (e.g. a tool-call argument or tool result) and
 * redact every string in place. Non-string values are returned unchanged.
 * Arrays and plain objects are descended into; class instances and other
 * exotica are passed through untouched to avoid corrupting them.
 */
export function redactValue<T>(
  value: T,
  patterns?: ReadonlyArray<RedactionPattern>,
): T {
  if (typeof value === 'string') {
    return redactString(value, patterns) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactValue(v, patterns)) as unknown as T
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(v, patterns)
    }
    return out as unknown as T
  }
  return value
}
