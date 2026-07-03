import type { WireframeBlockFingerprint } from '../../shared/wireframe-types'

/**
 * Capture-time fingerprint auto-resolve — the shell-side client of
 * `GET /__annotask/api/resolve-fingerprint`. An anchorless captured block
 * (file '') carries a DOM fingerprint; these helpers turn it into grep
 * evidence, call the resolver, and accept ONLY a confidently-unambiguous
 * winner — a low or contested score leaves the block honestly anchorless
 * rather than stamping a guess the agent would trust.
 *
 * Pure and fetch-injected so the picker/evidence rules are unit-testable
 * without a server (see __tests__/fingerprintResolve.test.ts).
 */

/** One resolver hit — mirrors the server's FingerprintCandidate (which lives
 *  in a node-only module the shell can't import). */
export interface FingerprintCandidate {
  file: string
  line: number
  /** 0..1; the server divides ambiguous evidence down (see resolve-fingerprint.ts). */
  score: number
  excerpt?: string
}

/** Grep evidence extracted from a fingerprint — the resolver's query shape. */
export interface FingerprintEvidence {
  classes: string[]
  text: string
  tag: string
}

/** Server floor: a candidate below this matched only weak/ambiguous evidence. */
const MIN_CONFIDENT_SCORE = 0.5
/** The winner must beat the runner-up by this factor or the hit is contested. */
const AMBIGUITY_RATIO = 1.5
/**
 * Floor for a SOLE candidate. Uniqueness across the searched tree is itself
 * the signal: the server's ambiguity divisor crushes boilerplate evidence
 * ('btn' in 30 files) into MANY low candidates, so a single survivor at
 * class-tier score (0.4) is a distinctive class that appears exactly once.
 * Without this, the common real-world shape — walker textHead is
 * concatenated textContent ('Acme DashboardHomeAbout') that never matches a
 * source LINE, degrading the hit to class-only 0.4 — would reject exactly
 * the unambiguous case the feature exists for.
 */
const MIN_SOLE_CANDIDATE_SCORE = 0.3
/** Mirrors the server's MIN_TEXT_CHARS — shorter text can't drive a search. */
const MIN_TEXT_CHARS = 3
const MAX_CLASSES = 5

/** Class tokens off the fingerprint's FIRST tag (the block's own element —
 *  htmlHead is raw outerHTML, so descendants' class attrs must not leak in).
 *  The walker's selectors are nth-of-type-only, so this is the only place
 *  class evidence can come from. Up to 5 tokens; [] when the tag has none. */
export function classesFromHtmlHead(htmlHead: string): string[] {
  const tagEnd = htmlHead.indexOf('>')
  const firstTag = tagEnd === -1 ? htmlHead : htmlHead.slice(0, tagEnd + 1)
  const m = firstTag.match(/\bclass="([^"]*)"/)
  if (!m) return []
  return m[1].split(/\s+/).filter(Boolean).slice(0, MAX_CLASSES)
}

/** Usable grep evidence from a fingerprint, or null when nothing can drive a
 *  search (no class tokens AND text under 3 chars after trimming — matching
 *  the server's hasUsableEvidence gate, so we never fire a guaranteed 400).
 *  `tag` comes from the selector's last segment ('… > header:nth-of-type(1)'
 *  → 'header'); it is a weak tiebreak for the server, never evidence alone. */
export function evidenceFromFingerprint(fp: WireframeBlockFingerprint): FingerprintEvidence | null {
  const classes = classesFromHtmlHead(fp.htmlHead)
  const trimmed = fp.textHead.trim()
  const text = trimmed.length >= MIN_TEXT_CHARS ? trimmed : ''
  if (classes.length === 0 && !text) return null
  const lastSegment = fp.selector.split('>').pop() ?? ''
  const tag = lastSegment.split(':')[0].trim()
  return { classes, text, tag }
}

/** The top candidate, but only when it is confidently unambiguous: a SOLE
 *  candidate at >= 0.3 (unique in the tree — see MIN_SOLE_CANDIDATE_SCORE),
 *  or a contested list's leader at >= 0.5 with a 1.5x lead over the
 *  runner-up. Candidates are already score-descending (the server sorts);
 *  anything less confident returns null so the block stays honestly
 *  anchorless. */
export function pickConfidentCandidate<T extends { score: number }>(candidates: T[]): T | null {
  const top = candidates[0]
  if (!top) return null
  const second = candidates[1]
  if (!second) return top.score >= MIN_SOLE_CANDIDATE_SCORE ? top : null
  if (top.score < MIN_CONFIDENT_SCORE) return null
  if (top.score < AMBIGUITY_RATIO * second.score) return null
  return top
}

/**
 * Resolve a fingerprint to a source anchor via the dev-server endpoint.
 * Returns `{ file, line }` only on a confident hit; null on unusable
 * evidence, an ambiguous/low-scoring result, a non-OK response, or any
 * network error (auto-resolve is fire-and-forget — it must never throw
 * into the capture path).
 */
export async function resolveFingerprintAnchor(
  fetchImpl: typeof fetch,
  fp: WireframeBlockFingerprint,
): Promise<{ file: string; line: number } | null> {
  const evidence = evidenceFromFingerprint(fp)
  if (!evidence) return null
  const params = new URLSearchParams()
  if (evidence.classes.length) params.set('classes', evidence.classes.join(','))
  if (evidence.text) params.set('text', evidence.text)
  if (evidence.tag) params.set('tag', evidence.tag)
  params.set('limit', '5')
  try {
    const res = await fetchImpl(`/__annotask/api/resolve-fingerprint?${params.toString()}`)
    if (!res.ok) return null
    const body = (await res.json()) as { candidates?: FingerprintCandidate[] }
    const hit = pickConfidentCandidate(body.candidates ?? [])
    return hit ? { file: hit.file, line: hit.line } : null
  } catch {
    return null
  }
}
