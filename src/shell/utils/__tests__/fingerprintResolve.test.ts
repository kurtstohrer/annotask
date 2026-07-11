import { describe, it, expect, vi } from 'vitest'
import {
  classesFromHtmlHead,
  evidenceFromFingerprint,
  pickConfidentCandidate,
  resolveFingerprintAnchor,
  type FingerprintCandidate,
} from '../fingerprintResolve'

const FP = {
  selector: 'main:nth-of-type(1) > div:nth-of-type(2)',
  textHead: 'Remote widget',
  htmlHead: '<div class="remote-widget card">Remote widget<span class="inner">x</span></div>',
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response
}

describe('classesFromHtmlHead', () => {
  it('parses class tokens off the FIRST tag only (descendant class attrs never leak)', () => {
    expect(classesFromHtmlHead(FP.htmlHead)).toEqual(['remote-widget', 'card'])
    // The first tag has no class; the child's must not be picked up.
    expect(classesFromHtmlHead('<div><span class="inner">x</span></div>')).toEqual([])
  })

  it('caps at 5 tokens and drops empty ones', () => {
    expect(classesFromHtmlHead('<div class="a  b c d e f g">x</div>')).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(classesFromHtmlHead('<div class="">x</div>')).toEqual([])
  })

  it('handles a truncated htmlHead with no closing ">" (1000-char walker cap)', () => {
    expect(classesFromHtmlHead('<div class="big" data-x="lots-of-attrs')).toEqual(['big'])
  })

  it('returns [] when there is no class attribute at all', () => {
    expect(classesFromHtmlHead('<header id="top">x</header>')).toEqual([])
  })
})

describe('evidenceFromFingerprint', () => {
  it('extracts classes + trimmed text + the selector tail tag', () => {
    expect(evidenceFromFingerprint(FP)).toEqual({
      classes: ['remote-widget', 'card'],
      text: 'Remote widget',
      tag: 'div',
    })
  })

  it('text under 3 chars after trimming is dropped (mirrors the server gate)', () => {
    const e = evidenceFromFingerprint({ ...FP, textHead: '  ok ' })
    expect(e!.text).toBe('')
    expect(e!.classes).toEqual(['remote-widget', 'card'])
  })

  it('null when NOTHING usable remains — a bare tag is never evidence', () => {
    expect(evidenceFromFingerprint({ selector: 'div:nth-of-type(1)', textHead: ' x ', htmlHead: '<div>x</div>' })).toBeNull()
  })

  it('text alone (>= 3 chars) is usable without classes', () => {
    expect(evidenceFromFingerprint({ selector: 'header:nth-of-type(1)', textHead: 'Search results', htmlHead: '<header>Search results</header>' }))
      .toEqual({ classes: [], text: 'Search results', tag: 'header' })
  })

  it('tag comes from the LAST selector segment', () => {
    const e = evidenceFromFingerprint({ ...FP, selector: 'div:nth-of-type(2) > header:nth-of-type(1)' })
    expect(e!.tag).toBe('header')
  })
})

describe('pickConfidentCandidate', () => {
  const c = (score: number): FingerprintCandidate => ({ file: 'src/A.vue', line: 1, score })

  it('accepts a lone candidate at or above the 0.5 floor', () => {
    expect(pickConfidentCandidate([c(0.5)])).toEqual(c(0.5))
    expect(pickConfidentCandidate([c(1.0)])).toEqual(c(1.0))
  })

  it('accepts a lone candidate down to the sole-candidate floor — uniqueness IS the signal', () => {
    // A single survivor at class-tier score (0.4) is a distinctive class the
    // server found exactly once; the common concatenated-textHead miss
    // degrades real unambiguous hits to exactly this shape.
    expect(pickConfidentCandidate([c(0.4)])).not.toBeNull()
    expect(pickConfidentCandidate([c(0.3)])).not.toBeNull()
  })

  it('rejects a lone candidate below the sole-candidate floor', () => {
    expect(pickConfidentCandidate([c(0.29)])).toBeNull()
  })

  it('rejects a contested top (needs a 1.5x lead over the runner-up)', () => {
    expect(pickConfidentCandidate([c(0.8), c(0.6)])).toBeNull()
    // Exactly 1.5x is confident.
    expect(pickConfidentCandidate([c(0.9), c(0.6)])).toEqual(c(0.9))
    expect(pickConfidentCandidate([c(1.0), c(0.4)])).toEqual(c(1.0))
  })

  it('empty list → null', () => {
    expect(pickConfidentCandidate([])).toBeNull()
  })

  it('a CAPPED scan holds a lone candidate to the full 0.5 bar', () => {
    // "Sole candidate" only means "unique in the tree" when the whole tree was
    // scanned — under a truncated scan the 0.3 uniqueness floor is void.
    expect(pickConfidentCandidate([c(0.4)], { capped: true })).toBeNull()
    expect(pickConfidentCandidate([c(0.3)], { capped: true })).toBeNull()
    expect(pickConfidentCandidate([c(0.5)], { capped: true })).toEqual(c(0.5))
    // Contested-list rules are unchanged by the cap.
    expect(pickConfidentCandidate([c(0.9), c(0.6)], { capped: true })).toEqual(c(0.9))
  })
})

describe('resolveFingerprintAnchor', () => {
  it('queries the endpoint with classes/text/tag/limit and returns the confident hit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      candidates: [{ file: 'src/Widget.vue', line: 12, score: 0.9, excerpt: '<div class="remote-widget card">' }],
      searched_files: 3,
    }))
    const hit = await resolveFingerprintAnchor(fetchImpl as unknown as typeof fetch, FP)
    expect(hit).toEqual({ file: 'src/Widget.vue', line: 12 })
    const url = (fetchImpl.mock.calls[0][0]) as string
    expect(url.startsWith('/__annotask/api/resolve-fingerprint?')).toBe(true)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('classes')).toBe('remote-widget,card')
    expect(params.get('text')).toBe('Remote widget')
    expect(params.get('tag')).toBe('div')
    expect(params.get('limit')).toBe('5')
  })

  it('rejects a low-scoring lone candidate when the server scan was capped', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      candidates: [{ file: 'src/Widget.vue', line: 12, score: 0.4 }],
      searched_files: 2000,
      capped: true,
    }))
    expect(await resolveFingerprintAnchor(fetchImpl as unknown as typeof fetch, FP)).toBeNull()
  })

  it('returns null on an ambiguous result (leaves the block honestly anchorless)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      candidates: [
        { file: 'src/A.vue', line: 1, score: 0.7 },
        { file: 'src/B.vue', line: 9, score: 0.6 },
      ],
    }))
    expect(await resolveFingerprintAnchor(fetchImpl as unknown as typeof fetch, FP)).toBeNull()
  })

  it('returns null WITHOUT fetching when the fingerprint has no usable evidence', async () => {
    const fetchImpl = vi.fn()
    const bare = { selector: 'div:nth-of-type(1)', textHead: 'x', htmlHead: '<div>x</div>' }
    expect(await resolveFingerprintAnchor(fetchImpl as unknown as typeof fetch, bare)).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('swallows network errors and non-OK responses → null', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await resolveFingerprintAnchor(boom as unknown as typeof fetch, FP)).toBeNull()
    const bad = vi.fn().mockResolvedValue(jsonResponse({}, false))
    expect(await resolveFingerprintAnchor(bad as unknown as typeof fetch, FP)).toBeNull()
    const empty = vi.fn().mockResolvedValue(jsonResponse({}))
    expect(await resolveFingerprintAnchor(empty as unknown as typeof fetch, FP)).toBeNull()
  })
})
