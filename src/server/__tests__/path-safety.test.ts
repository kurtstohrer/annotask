import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { resolveProjectFile } from '../path-safety'
import { CreateTaskBody, parseWith } from '../schemas'

describe('resolveProjectFile (single-project mode)', () => {
  let root: string
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-ps-')) })
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }) })

  it('accepts in-project paths', () => {
    const r = resolveProjectFile(root, 'src/App.vue')
    expect(r).not.toBeNull()
    expect(r!.relative).toBe('src/App.vue')
  })

  it('rejects paths that escape projectRoot when no workspaceRoot is passed', () => {
    expect(resolveProjectFile(root, '../outside.ts')).toBeNull()
  })

  it('rejects absolute paths, URL schemes, UNC, null bytes', () => {
    expect(resolveProjectFile(root, 'C:\\secret')).toBeNull()
    expect(resolveProjectFile(root, '\\\\server\\share')).toBeNull()
    expect(resolveProjectFile(root, 'file:///etc/passwd')).toBeNull()
    expect(resolveProjectFile(root, 'a\0b')).toBeNull()
    expect(resolveProjectFile(root, '')).toBeNull()
  })
})

describe('resolveProjectFile (workspace mode)', () => {
  let workspace: string
  let project: string
  beforeEach(async () => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-ws-'))
    project = path.join(workspace, 'apps', 'host')
    await fsp.mkdir(project, { recursive: true })
    await fsp.mkdir(path.join(workspace, 'packages', 'shared'), { recursive: true })
  })
  afterEach(async () => {
    await fsp.rm(workspace, { recursive: true, force: true })
  })

  it('accepts sibling-package paths within the workspace', () => {
    const r = resolveProjectFile(project, '../../packages/shared/tokens.css', workspace)
    expect(r).not.toBeNull()
    expect(r!.relative).toBe('../../packages/shared/tokens.css')
    expect(r!.absolutePath).toBe(path.join(workspace, 'packages', 'shared', 'tokens.css'))
  })

  it('still rejects paths that escape the workspace root', () => {
    const r = resolveProjectFile(project, '../../../etc/passwd', workspace)
    expect(r).toBeNull()
  })

  it('accepts in-project paths unchanged', () => {
    const r = resolveProjectFile(project, 'src/App.tsx', workspace)
    expect(r).not.toBeNull()
    expect(r!.relative).toBe('src/App.tsx')
  })

  it('ignores workspaceRoot that is narrower than projectRoot (safety fallback)', () => {
    // If caller mistakenly passes a workspaceRoot that isn't an ancestor of
    // projectRoot, we fall back to projectRoot containment.
    const narrower = path.join(project, 'src')
    expect(resolveProjectFile(project, '../../packages/shared/tokens.css', narrower)).toBeNull()
  })
})

describe('CreateTaskBody.file with relaxed regex', () => {
  it('accepts workspace-sibling paths with .. segments', () => {
    const result = parseWith(CreateTaskBody, {
      type: 'theme_update',
      description: 'x',
      file: '../../packages/shared-ui-tokens/tokens.css',
    })
    expect(result.ok, result.ok ? undefined : result.error).toBe(true)
  })

  it('still rejects absolute Windows paths', () => {
    const result = parseWith(CreateTaskBody, {
      type: 'theme_update',
      description: 'x',
      file: 'C:\\Windows\\system32',
    })
    expect(result.ok).toBe(false)
  })

  it('still rejects URL-style paths', () => {
    const result = parseWith(CreateTaskBody, {
      type: 'theme_update',
      description: 'x',
      file: 'file:///etc/passwd',
    })
    expect(result.ok).toBe(false)
  })

  it('still rejects UNC paths', () => {
    const result = parseWith(CreateTaskBody, {
      type: 'theme_update',
      description: 'x',
      file: '\\\\server\\share\\secret',
    })
    expect(result.ok).toBe(false)
  })

  it('still rejects null bytes', () => {
    const result = parseWith(CreateTaskBody, {
      type: 'theme_update',
      description: 'x',
      file: 'src/App\0.vue',
    })
    expect(result.ok).toBe(false)
  })

  it('treats empty file as missing (preprocess to undefined)', () => {
    // Regression: shell tools used to send `file: ""` when the rectangle didn't
    // overlap a `data-annotask-file`-tagged element (common over external
    // library elements). `SafeSourceFile.min(1)` rejected those with
    // "file must be non-empty", 400ing legitimate Draw Section requests.
    const result = parseWith(CreateTaskBody, {
      type: 'section_request',
      description: 'add a hero',
      file: '',
      placement: 'above',
    })
    expect(result.ok, result.ok ? undefined : result.error).toBe(true)
    if (result.ok) {
      expect(result.data.file).toBeUndefined()
      expect(result.data.placement).toBe('above')
    }
  })
})
