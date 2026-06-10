import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createDraftStore } from '../draft-edits'

const SRC = [
  '<script setup lang="ts">',
  "import { ref } from 'vue'",
  'const n = ref(0)',
  '</script>',
  '',
  '<template>',
  '  <main>',
  '    <h1>Planets</h1>',
  '  </main>',
  '</template>',
  '',
].join('\n')

describe('draft-edits (render-in-place)', () => {
  let root: string
  let file: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-draft-'))
    file = path.join(root, 'PlanetsPage.vue')
    fs.writeFileSync(file, SRC, 'utf-8')
  })

  afterEach(async () => {
    delete process.env.ANNOTASK_RENDER_IN_PLACE
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('is disabled (and refuses writes) unless the flag is set', async () => {
    const store = createDraftStore(root)
    expect(store.enabled).toBe(false)
    await expect(store.write({ file, line: 8, position: 'append', componentName: 'PlanetCard' })).rejects.toThrow()
  })

  it('writes a draft and reverts it byte-for-byte', async () => {
    process.env.ANNOTASK_RENDER_IN_PLACE = '1'
    const store = createDraftStore(root)
    expect(store.enabled).toBe(true)

    const { draftId } = await store.write({
      file, line: 8, position: 'after', componentName: 'PlanetCard',
      props: { count: 3, title: 'Mars' },
      importStatement: "import PlanetCard from './PlanetCard.vue'",
    })
    const modified = await fsp.readFile(file, 'utf-8')
    expect(modified).not.toBe(SRC)
    expect(modified).toContain('<PlanetCard')
    expect(modified).toContain(':count="3"')        // Vue attr syntax for numbers
    expect(modified).toContain('title="Mars"')
    expect(modified).toContain("import PlanetCard from './PlanetCard.vue'")
    // Journal exists while a draft is live.
    expect(fs.existsSync(path.join(root, '.annotask', 'draft-edits.json'))).toBe(true)

    const { reverted } = await store.revert(draftId)
    expect(reverted).toBe(true)
    expect(await fsp.readFile(file, 'utf-8')).toBe(SRC)
  })

  it('refuses to revert when the file changed under it (hash guard)', async () => {
    process.env.ANNOTASK_RENDER_IN_PLACE = 'true'
    const store = createDraftStore(root)
    const { draftId } = await store.write({ file, line: 8, position: 'append', componentName: 'PlanetCard' })
    // Simulate a concurrent user/agent edit after the draft.
    await fsp.writeFile(file, (await fsp.readFile(file, 'utf-8')) + '\n<!-- user edit -->\n', 'utf-8')
    const before = await fsp.readFile(file, 'utf-8')
    const { reverted } = await store.revert(draftId)
    expect(reverted).toBe(false)
    // The user's edit is preserved (not clobbered by the original).
    expect(await fsp.readFile(file, 'utf-8')).toBe(before)
  })

  it('rejects targets outside the project root (absolute and traversal forms)', async () => {
    process.env.ANNOTASK_RENDER_IN_PLACE = '1'
    // A sibling file outside the store's projectRoot — reachable by absolute
    // path or `../` traversal if containment were missing.
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-draft-outside-'))
    const outsideFile = path.join(outsideDir, 'Outside.vue')
    fs.writeFileSync(outsideFile, SRC, 'utf-8')
    try {
      const store = createDraftStore(root)
      await expect(store.write({ file: outsideFile, line: 8, position: 'append', componentName: 'X' }))
        .rejects.toThrow(/escapes the project root/)
      await expect(store.write({
        file: `../${path.basename(outsideDir)}/Outside.vue`, line: 8, position: 'append', componentName: 'X',
      })).rejects.toThrow(/escapes the project root/)
      // The target was never touched.
      expect(await fsp.readFile(outsideFile, 'utf-8')).toBe(SRC)
    } finally {
      await fsp.rm(outsideDir, { recursive: true, force: true })
    }
  })

  it('still accepts in-root targets in both relative and absolute form', async () => {
    process.env.ANNOTASK_RENDER_IN_PLACE = '1'
    const store = createDraftStore(root)
    const rel = await store.write({ file: 'PlanetsPage.vue', line: 8, position: 'append', componentName: 'PlanetCard' })
    await store.revert(rel.draftId)
    const abs = await store.write({ file, line: 8, position: 'append', componentName: 'PlanetCard' })
    await store.revert(abs.draftId)
    expect(await fsp.readFile(file, 'utf-8')).toBe(SRC)
  })

  it('rejects an importStatement that is not a single import line', async () => {
    process.env.ANNOTASK_RENDER_IN_PLACE = '1'
    const store = createDraftStore(root)
    // Multi-line payload — second line would be spliced into source verbatim.
    await expect(store.write({
      file, line: 8, position: 'append', componentName: 'PlanetCard',
      importStatement: "import PlanetCard from './PlanetCard.vue'\nwindow.evil()",
    })).rejects.toThrow(/single `import/)
    // Non-import payload.
    await expect(store.write({
      file, line: 8, position: 'append', componentName: 'PlanetCard',
      importStatement: "window.evil()",
    })).rejects.toThrow(/single `import/)
    // Source untouched by either rejection.
    expect(await fsp.readFile(file, 'utf-8')).toBe(SRC)
  })

  it('recovers a crashed draft from the journal on next boot', async () => {
    process.env.ANNOTASK_RENDER_IN_PLACE = '1'
    const store = createDraftStore(root)
    await store.write({ file, line: 8, position: 'append', componentName: 'PlanetCard' })
    // Simulate a crash: the modified file + journal are on disk, but the
    // in-memory store is gone. A fresh store recovers on construction.
    expect(await fsp.readFile(file, 'utf-8')).toContain('<PlanetCard')
    createDraftStore(root)
    // Recovery is fire-and-forget; give it a tick.
    await new Promise((r) => setTimeout(r, 50))
    expect(await fsp.readFile(file, 'utf-8')).toBe(SRC)
    expect(fs.existsSync(path.join(root, '.annotask', 'draft-edits.json'))).toBe(false)
  })
})
