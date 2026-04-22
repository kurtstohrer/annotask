import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import { scanComponentUsage, clearComponentUsageCache } from '../component-usage.js'

let root: string

beforeAll(async () => {
  root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'annotask-comp-usage-'))
  const src = nodePath.join(root, 'src')
  await fsp.mkdir(src, { recursive: true })
  await fsp.writeFile(nodePath.join(root, 'package.json'), '{"name":"fixture"}')

  await fsp.writeFile(nodePath.join(src, 'pascal.tsx'), `\
import { Button, Card as Panel } from '@mantine/core'
import Modal from 'some-lib/modal'

export function Page() {
  return <Card><Button /></Card>
}
`)

  await fsp.writeFile(nodePath.join(src, 'lowercase.tsx'), `\
import { box, icon } from 'lucide'
import button from 'primevue/button'

export function Icons() { return null }
`)

  await fsp.writeFile(nodePath.join(src, 'mixed.tsx'), `\
import { box as Box, useTheme } from 'lucide'
`)
})

beforeEach(() => {
  clearComponentUsageCache()
})

afterAll(async () => {
  if (root && fs.existsSync(root)) await fsp.rm(root, { recursive: true, force: true })
})

describe('scanComponentUsage', () => {
  it('captures PascalCase named imports and default imports', async () => {
    const r = await scanComponentUsage(root)
    expect(Object.keys(r.usage)).toEqual(expect.arrayContaining(['Button', 'Card', 'Panel', 'Modal']))
    expect(r.imports['src/pascal.tsx']?.['Button']).toEqual(['@mantine/core'])
    expect(r.imports['src/pascal.tsx']?.['Modal']).toEqual(['some-lib/modal'])
  })

  it('captures lowercase named imports (e.g. Lucide box/icon)', async () => {
    const r = await scanComponentUsage(root)
    expect(r.usage['box']).toContain('src/lowercase.tsx')
    expect(r.usage['icon']).toContain('src/lowercase.tsx')
    expect(r.imports['src/lowercase.tsx']?.['box']).toEqual(['lucide'])
    expect(r.imports['src/lowercase.tsx']?.['icon']).toEqual(['lucide'])
  })

  it('captures lowercase default imports (e.g. PrimeVue-style)', async () => {
    const r = await scanComponentUsage(root)
    expect(r.usage['button']).toContain('src/lowercase.tsx')
    expect(r.imports['src/lowercase.tsx']?.['button']).toEqual(['primevue/button'])
  })

  it('records both original and aliased bindings for `as` imports', async () => {
    const r = await scanComponentUsage(root)
    expect(r.usage['box']).toContain('src/mixed.tsx')
    expect(r.usage['Box']).toContain('src/mixed.tsx')
    expect(r.usage['useTheme']).toContain('src/mixed.tsx')
  })
})
