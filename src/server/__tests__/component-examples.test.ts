import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import { getComponentExamples } from '../component-examples.js'

let root: string

beforeAll(async () => {
  root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'annotask-comp-examples-'))
  const src = nodePath.join(root, 'src')
  await fsp.mkdir(src, { recursive: true })

  await fsp.writeFile(nodePath.join(src, 'mantine-page.tsx'), `\
import { Button } from '@mantine/core'
import { Card } from '@mantine/core'

export function MantinePage() {
  return (
    <Card>
      <Button color="blue">Mantine button</Button>
    </Card>
  )
}
`)

  await fsp.writeFile(nodePath.join(src, 'kobalte-page.tsx'), `\
import { Button } from '@kobalte/core/button'

export function KobaltePage() {
  return <Button class="solid">Kobalte button</Button>
}
`)
})

afterAll(async () => {
  if (root && fs.existsSync(root)) await fsp.rm(root, { recursive: true, force: true })
})

describe('getComponentExamples library filter', () => {
  it('returns examples from every library when no filter is set', async () => {
    const r = await getComponentExamples(root, 'Button', 10)
    expect(r.total_found).toBe(2)
    const fromPaths = r.examples.map(e => e.import_path).sort()
    expect(fromPaths).toEqual(['@kobalte/core/button', '@mantine/core'])
  })

  it('drops other-library examples when library filter matches package exactly', async () => {
    const r = await getComponentExamples(root, 'Button', 10, '@mantine/core')
    expect(r.total_found).toBe(1)
    expect(r.examples).toHaveLength(1)
    expect(r.examples[0].import_path).toBe('@mantine/core')
    // import_paths histogram should also be scoped — no kobalte leakage.
    for (const ip of r.import_paths) {
      expect(ip.path.startsWith('@kobalte')).toBe(false)
    }
  })

  it('matches subpath imports against the library prefix', async () => {
    // @kobalte/core/button is a subpath of @kobalte/core — must still match.
    const r = await getComponentExamples(root, 'Button', 10, '@kobalte/core')
    expect(r.total_found).toBe(1)
    expect(r.examples[0].import_path).toBe('@kobalte/core/button')
  })

  it('returns an empty result when no file matches the requested library', async () => {
    const r = await getComponentExamples(root, 'Button', 10, 'some-library-not-installed')
    expect(r.total_found).toBe(0)
    expect(r.examples).toHaveLength(0)
    expect(r.import_paths).toHaveLength(0)
  })
})
