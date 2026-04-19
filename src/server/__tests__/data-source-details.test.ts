import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { resolveDataSourceDetails } from '../data-source-details'
import { clearDataSourceCache } from '../data-source-scanner'

function mkTmpRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-dsd-test-'))
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel)
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  await fsp.writeFile(abs, content, 'utf-8')
}

async function writePackageJson(root: string, deps: Record<string, string>): Promise<void> {
  await fsp.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: deps }, null, 2),
    'utf-8',
  )
}

describe('resolveDataSourceDetails', () => {
  let root: string
  beforeEach(() => {
    root = mkTmpRoot()
    clearDataSourceCache()
  })
  afterEach(async () => {
    clearDataSourceCache()
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('returns full details for a TS composable with return type', async () => {
    await writePackageJson(root, { '@tanstack/react-query': '^5.0.0' })
    await writeFile(root, 'src/hooks/useCats.ts', [
      "import { useQuery } from '@tanstack/react-query'",
      "import type { Cat } from '../types'",
      '',
      'export function useCatsQuery(id: string): UseCatsQueryResult {',
      '  return useQuery({ queryKey: [\'cats\', id], queryFn: () => fetch(`/api/cats/${id}`).then(r => r.json()) })',
      '}',
    ].join('\n'))

    const result = await resolveDataSourceDetails({ projectRoot: root, name: 'useCatsQuery' })
    expect('error' in result).toBe(false)
    if ('error' in result) return
    expect(result.name).toBe('useCatsQuery')
    expect(result.kind).toBe('composable')
    expect(result.file).toBe('src/hooks/useCats.ts')
    expect(result.resolved_by).toBe('regex')
    expect(result.confidence).toBe('high')
    expect(result.signature).toMatch(/export function useCatsQuery/)
    expect(result.return_type).toBe('UseCatsQueryResult')
    expect(result.body_excerpt).toContain('useQuery')
    expect(result.imports.some(i => i.includes('@tanstack/react-query'))).toBe(true)
    expect(result.referenced_types).toContain('UseCatsQueryResult')
  })

  it('returns medium confidence when signature has no return type', async () => {
    await writePackageJson(root, { '@tanstack/react-query': '^5.0.0' })
    await writeFile(root, 'src/hooks/useDogs.ts', [
      "import { useQuery } from '@tanstack/react-query'",
      '',
      'export function useDogsQuery(id: string) {',
      '  return useQuery({ queryKey: [\'dogs\', id] })',
      '}',
    ].join('\n'))

    const result = await resolveDataSourceDetails({ projectRoot: root, name: 'useDogsQuery' })
    if ('error' in result) throw new Error('expected success')
    expect(result.confidence).toBe('medium')
    expect(result.return_type).toBeUndefined()
    expect(result.signature).toMatch(/useDogsQuery/)
  })

  it('collects siblings from the same file', async () => {
    await writePackageJson(root, { '@tanstack/react-query': '^5.0.0' })
    await writeFile(root, 'src/hooks/queries.ts', [
      "import { useQuery } from '@tanstack/react-query'",
      '',
      'export function useAlpha() {',
      '  return useQuery({ queryKey: [\'alpha\'] })',
      '}',
      '',
      'export function useBeta() {',
      '  return useQuery({ queryKey: [\'beta\'] })',
      '}',
      '',
      'export function useGamma() {',
      '  return useQuery({ queryKey: [\'gamma\'] })',
      '}',
    ].join('\n'))

    const result = await resolveDataSourceDetails({ projectRoot: root, name: 'useBeta' })
    if ('error' in result) throw new Error('expected success')
    const siblingNames = result.siblings.map(s => s.name).sort()
    expect(siblingNames).toEqual(['useAlpha', 'useGamma'])
    for (const s of result.siblings) {
      expect(s.kind).toBe('composable')
      expect(typeof s.line).toBe('number')
    }
  })

  it('emits ambiguous when two files define the same name', async () => {
    await writePackageJson(root, { '@tanstack/react-query': '^5.0.0' })
    await writeFile(root, 'src/a/useOrders.ts', [
      "import { useQuery } from '@tanstack/react-query'",
      'export function useOrders() {',
      '  return useQuery({ queryKey: [\'a\'] })',
      '}',
    ].join('\n'))
    await writeFile(root, 'src/b/useOrders.ts', [
      "import { useQuery } from '@tanstack/react-query'",
      'export function useOrders() {',
      '  return useQuery({ queryKey: [\'b\'] })',
      '}',
    ].join('\n'))

    const result = await resolveDataSourceDetails({ projectRoot: root, name: 'useOrders' })
    expect('error' in result).toBe(true)
    if (!('error' in result) || result.error !== 'ambiguous') throw new Error('expected ambiguous')
    expect(result.candidates).toHaveLength(2)
    const files = result.candidates.map(c => c.file).sort()
    expect(files).toEqual(['src/a/useOrders.ts', 'src/b/useOrders.ts'])
  })

  it('narrows ambiguity when file is provided', async () => {
    await writePackageJson(root, { '@tanstack/react-query': '^5.0.0' })
    await writeFile(root, 'src/a/useOrders.ts', [
      "import { useQuery } from '@tanstack/react-query'",
      'export function useOrders() {',
      '  return useQuery({ queryKey: [\'a\'] })',
      '}',
    ].join('\n'))
    await writeFile(root, 'src/b/useOrders.ts', [
      "import { useQuery } from '@tanstack/react-query'",
      'export function useOrders() {',
      '  return useQuery({ queryKey: [\'b\'] })',
      '}',
    ].join('\n'))

    const result = await resolveDataSourceDetails({
      projectRoot: root,
      name: 'useOrders',
      file: 'src/b/useOrders.ts',
    })
    if ('error' in result) throw new Error('expected success')
    expect(result.file).toBe('src/b/useOrders.ts')
  })

  it('returns not_found for unknown names', async () => {
    await writePackageJson(root, { '@tanstack/react-query': '^5.0.0' })
    await writeFile(root, 'src/hooks/useThing.ts', [
      "import { useQuery } from '@tanstack/react-query'",
      'export function useThing() { return useQuery({ queryKey: [\'x\'] }) }',
    ].join('\n'))

    const result = await resolveDataSourceDetails({ projectRoot: root, name: 'useNotThere' })
    if (!('error' in result) || result.error !== 'not_found') throw new Error('expected not_found')
    expect(result.name).toBe('useNotThere')
  })

  it('resolves a Pinia store with signature', async () => {
    await writePackageJson(root, { pinia: '^2.0.0' })
    await writeFile(root, 'src/stores/useUserStore.ts', [
      "import { defineStore } from 'pinia'",
      '',
      "export const useUserStore = defineStore('user', {",
      '  state: () => ({ name: \'\' }),',
      '})',
    ].join('\n'))

    const result = await resolveDataSourceDetails({ projectRoot: root, name: 'useUserStore' })
    if ('error' in result) throw new Error('expected success')
    expect(result.kind).toBe('store')
    expect(result.signature).toMatch(/useUserStore/)
    expect(result.body_excerpt).toContain("defineStore('user'")
  })
})
