import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import { resolveFingerprint, hasUsableEvidence } from '../resolve-fingerprint.js'
import { callTool, type McpDeps } from '../../mcp/tools.js'

let root: string

beforeAll(async () => {
  root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'annotask-fingerprint-'))
  const src = nodePath.join(root, 'src')
  await fsp.mkdir(src, { recursive: true })

  // Unique class + unique text on the same line — the strongest evidence.
  await fsp.writeFile(nodePath.join(src, 'Header.vue'), `\
<template>
  <header class="site-header">
    <h1 class="orbit-hero-title">Welcome to Orbit</h1>
    <p class="tagline">Your planets, live</p>
  </header>
</template>
`)

  // 'btn' boilerplate scattered across several lines/files. Also carries the
  // unique text WITHOUT any class token (text-only tier), and a btn-primary
  // line that must NOT count as a whole-token 'btn' match.
  await fsp.writeFile(nodePath.join(src, 'Buttons.tsx'), `\
export function Buttons() {
  return (
    <div>
      <button className="btn">One</button>
      <button className="btn">Two</button>
      <button className="btn-primary">Primary only</button>
      <span>Quarterly revenue report</span>
    </div>
  )
}
`)

  await fsp.writeFile(nodePath.join(src, 'MoreButtons.jsx'), `\
export const More = () => (
  <div>
    <a className="btn">Three</a>
    <a className="btn">Four</a>
  </div>
)
`)

  // Two lines matching the same single class — tag decides the order.
  await fsp.writeFile(nodePath.join(src, 'TagTiebreak.vue'), `\
<template>
  <div class="cta-zone">wrapper</div>
  <button class="cta-zone">click</button>
</template>
`)

  // Evidence hidden inside node_modules must never surface.
  const nm = nodePath.join(root, 'node_modules', 'some-lib')
  await fsp.mkdir(nm, { recursive: true })
  await fsp.writeFile(nodePath.join(nm, 'lib.vue'), '<h1 class="orbit-hero-title">Welcome to Orbit</h1>\n')

  // Oversized file (> 512KB) holding otherwise-unique evidence — skipped and
  // excluded from searched_files.
  const filler = '/* padding */\n'.repeat(40_000) // ~560KB
  await fsp.writeFile(nodePath.join(src, 'huge.ts'), `${filler}const x = 'giant-file-only-class'\n`)
})

afterAll(async () => {
  if (root && fs.existsSync(root)) await fsp.rm(root, { recursive: true, force: true })
})

describe('hasUsableEvidence', () => {
  it('accepts a class token or >= 3 char text, rejects everything else', () => {
    expect(hasUsableEvidence(['btn'], '')).toBe(true)
    expect(hasUsableEvidence([], 'abc')).toBe(true)
    expect(hasUsableEvidence([], 'ab')).toBe(false)
    expect(hasUsableEvidence([], '  ab  ')).toBe(false)
    expect(hasUsableEvidence(['  '], '')).toBe(false)
    expect(hasUsableEvidence([], '')).toBe(false)
  })
})

describe('resolveFingerprint', () => {
  it('ranks a unique class + text hit first with a high score', async () => {
    const r = await resolveFingerprint(root, { classes: ['orbit-hero-title'], text: 'Welcome to Orbit' })
    expect(r.candidates.length).toBeGreaterThan(0)
    const top = r.candidates[0]
    expect(top.file).toBe('src/Header.vue')
    expect(top.line).toBe(3)
    expect(top.score).toBeGreaterThanOrEqual(0.9)
    expect(top.excerpt).toContain('Welcome to Orbit')
  })

  it('scores ambiguous boilerplate classes low via the sqrt divisor', async () => {
    const r = await resolveFingerprint(root, { classes: ['btn'] })
    // 4 whole-token 'btn' lines across two files; btn-primary must not count.
    expect(r.candidates).toHaveLength(4)
    for (const c of r.candidates) {
      expect(c.score).toBeLessThanOrEqual(0.2) // 0.4 / sqrt(4)
      expect(c.excerpt).not.toContain('btn-primary')
    }
  })

  it('does not match a class token inside a longer hyphenated class', async () => {
    const r = await resolveFingerprint(root, { classes: ['btn-primary'] })
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0].file).toBe('src/Buttons.tsx')
  })

  it('resolves from text evidence alone', async () => {
    const r = await resolveFingerprint(root, { text: 'Quarterly revenue report' })
    expect(r.candidates).toHaveLength(1)
    expect(r.candidates[0].file).toBe('src/Buttons.tsx')
    expect(r.candidates[0].line).toBe(7)
    // Unique text-only hit: 0.6 / sqrt(1)
    expect(r.candidates[0].score).toBe(0.6)
  })

  it('ranks class+text above text-only and single-class hits', async () => {
    const r = await resolveFingerprint(root, { classes: ['tagline'], text: 'Your planets, live' })
    expect(r.candidates[0].file).toBe('src/Header.vue')
    expect(r.candidates[0].line).toBe(4)
    expect(r.candidates[0].score).toBe(1)
  })

  it('uses tag as a tiebreak between equal class matches', async () => {
    const r = await resolveFingerprint(root, { classes: ['cta-zone'], tag: 'button' })
    expect(r.candidates).toHaveLength(2)
    expect(r.candidates[0].excerpt).toContain('<button')
    expect(r.candidates[0].score).toBeGreaterThan(r.candidates[1].score)
  })

  it('ignores text under 3 chars and returns empty when nothing is usable', async () => {
    const r = await resolveFingerprint(root, { text: 'ab' })
    expect(r.candidates).toEqual([])
    expect(r.searched_files).toBe(0)
  })

  it('never surfaces matches from node_modules', async () => {
    const r = await resolveFingerprint(root, { classes: ['orbit-hero-title'] })
    expect(r.candidates.length).toBeGreaterThan(0)
    for (const c of r.candidates) {
      expect(c.file.includes('node_modules')).toBe(false)
    }
  })

  it('skips oversized files and keeps searched_files honest', async () => {
    const r = await resolveFingerprint(root, { classes: ['giant-file-only-class'] })
    expect(r.candidates).toEqual([])
    // 5 scannable fixture files under src/, minus the oversized one.
    expect(r.searched_files).toBe(4)
  })

  it('respects the limit parameter', async () => {
    const r = await resolveFingerprint(root, { classes: ['btn'], limit: 2 })
    expect(r.candidates).toHaveLength(2)
  })

  it('caps the walk at 2000 files and reports the capped count', async () => {
    const capRoot = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'annotask-fingerprint-cap-'))
    try {
      const src = nodePath.join(capRoot, 'src')
      await fsp.mkdir(src, { recursive: true })
      const writes: Promise<void>[] = []
      for (let i = 0; i < 2010; i++) {
        writes.push(fsp.writeFile(nodePath.join(src, `f${String(i).padStart(4, '0')}.ts`), `const c = 'cap-marker-${i}'\n`))
      }
      await Promise.all(writes)
      const r = await resolveFingerprint(capRoot, { text: 'cap-marker' })
      expect(r.searched_files).toBe(2000)
    } finally {
      await fsp.rm(capRoot, { recursive: true, force: true })
    }
  })
})

describe('annotask_resolve_fingerprint MCP tool', () => {
  const deps: McpDeps = {
    projectRoot: '',
    getDesignSpec: () => ({}),
    getTasks: () => ({ version: '1.0', tasks: [] }),
    addTask: t => t,
    updateTask: (_id, u) => u,
    deleteTask: id => ({ deleted: id }),
    readInteractionHistory: async () => null,
    readRenderedHtml: async () => null,
  }

  it('dispatches to resolveFingerprint and returns the result envelope', async () => {
    const result = await callTool('annotask_resolve_fingerprint', {
      classes: ['orbit-hero-title'],
      text: 'Welcome to Orbit',
    }, { ...deps, projectRoot: root })
    expect(result.isError).toBeUndefined()
    const payload = JSON.parse((result.content[0] as { text: string }).text)
    expect(payload.candidates[0].file).toBe('src/Header.vue')
    expect(payload.searched_files).toBeGreaterThan(0)
  })

  it('returns a tool error when no usable evidence is provided', async () => {
    const result = await callTool('annotask_resolve_fingerprint', { text: 'ab', tag: 'button' }, { ...deps, projectRoot: root })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('No usable evidence')
  })
})
