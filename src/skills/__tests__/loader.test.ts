import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import {
  loadSkill,
  listSkills,
  getSystemPrompt,
  clearSkillsCache,
} from '../loader'

function mkTmpSkills(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'annotask-skills-test-'))
  fs.mkdirSync(path.join(root, 'annotask-apply'), { recursive: true })
  fs.writeFileSync(path.join(root, 'annotask-apply', 'SKILL.md'), '# annotask-apply\n\nBody.\n')
  fs.writeFileSync(path.join(root, 'annotask-apply', 'A11Y_RULES.md'), '# A11Y\n\nRules.\n')
  fs.writeFileSync(path.join(root, 'annotask-apply', 'THEME_UPDATE.md'), '# Theme\n\nUpdate.\n')
  fs.writeFileSync(path.join(root, 'annotask-apply', 'WIREFRAME_APPLY.md'), '# Wireframe Apply\n\nPlace.\n')
  fs.writeFileSync(path.join(root, 'annotask-apply', 'notes.txt'), 'ignored')
  fs.mkdirSync(path.join(root, 'annotask-init'), { recursive: true })
  fs.writeFileSync(path.join(root, 'annotask-init', 'SKILL.md'), '# annotask-init\n')
  // A directory without SKILL.md must be ignored by listSkills.
  fs.mkdirSync(path.join(root, 'orphan'), { recursive: true })
  fs.writeFileSync(path.join(root, 'orphan', 'something.md'), 'no skill here')
  return root
}

describe('skills/loader', () => {
  let root: string
  beforeEach(() => {
    root = mkTmpSkills()
    clearSkillsCache()
  })
  afterEach(async () => {
    clearSkillsCache()
    await fsp.rm(root, { recursive: true, force: true })
  })

  it('loadSkill returns body + companion markdown', () => {
    const skill = loadSkill('annotask-apply', { root })
    expect(skill.name).toBe('annotask-apply')
    expect(skill.body).toContain('# annotask-apply')
    expect(skill.files['SKILL.md']).toBe(skill.body)
    expect(skill.files['A11Y_RULES.md']).toContain('# A11Y')
    expect(skill.files['THEME_UPDATE.md']).toContain('# Theme')
    expect(skill.files['notes.txt']).toBeUndefined()
  })

  it('loadSkill is idempotent — repeat calls return the same cached instance', () => {
    const a = loadSkill('annotask-apply', { root })
    const b = loadSkill('annotask-apply', { root })
    expect(b).toBe(a)
  })

  it('loadSkill throws when the skill is missing', () => {
    expect(() => loadSkill('does-not-exist', { root })).toThrow(/Skill not found/)
  })

  it('listSkills returns only directories containing SKILL.md', () => {
    expect(listSkills({ root })).toEqual(['annotask-apply', 'annotask-init'])
  })

  it('getSystemPrompt without taskType returns just the SKILL.md body', () => {
    const prompt = getSystemPrompt({ root })
    expect(prompt).toContain('# annotask-apply')
    expect(prompt).not.toContain('# A11Y')
    expect(prompt).not.toContain('# Theme')
  })

  it('getSystemPrompt appends the companion playbook for a11y_fix', () => {
    const prompt = getSystemPrompt({ root, taskType: 'a11y_fix' })
    expect(prompt).toContain('# annotask-apply')
    expect(prompt).toContain('# A11Y')
    // Sections are separated by a horizontal rule so token boundaries stay
    // explicit — the embedded runner cache-marks the whole block.
    expect(prompt).toMatch(/# annotask-apply[\s\S]*\n\n---\n\n[\s\S]*# A11Y/)
  })

  it('getSystemPrompt appends THEME_UPDATE for theme_update', () => {
    const prompt = getSystemPrompt({ root, taskType: 'theme_update' })
    expect(prompt).toContain('# Theme')
  })

  it('getSystemPrompt appends WIREFRAME_APPLY for wireframe_apply', () => {
    const prompt = getSystemPrompt({ root, taskType: 'wireframe_apply' })
    expect(prompt).toContain('# Wireframe Apply')
  })

  it('getSystemPrompt ignores unknown task types', () => {
    const prompt = getSystemPrompt({ root, taskType: 'something_else' })
    expect(prompt).not.toContain('# A11Y')
    expect(prompt).not.toContain('# Theme')
  })

  it('getSystemPrompt is idempotent (cached)', () => {
    const a = getSystemPrompt({ root, taskType: 'a11y_fix' })
    const b = getSystemPrompt({ root, taskType: 'a11y_fix' })
    expect(b).toBe(a)
  })

  it('clearSkillsCache forces a fresh read', () => {
    const before = loadSkill('annotask-apply', { root })
    fs.writeFileSync(path.join(root, 'annotask-apply', 'SKILL.md'), '# changed\n')
    const stillCached = loadSkill('annotask-apply', { root })
    expect(stillCached).toBe(before)
    clearSkillsCache()
    const fresh = loadSkill('annotask-apply', { root })
    expect(fresh.body).toContain('# changed')
  })

  it('resolves the real bundled skills/ root when no override is passed', () => {
    // Smoke-check: production callers (MCP server, embedded runner) rely on
    // this default working without any options.
    const prompt = getSystemPrompt()
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt).toMatch(/annotask-apply/i)
  })

  it('ships the real WIREFRAME_APPLY playbook for wireframe_apply (no override)', () => {
    // Proves the TASK_TYPE_COMPANIONS registration + the bundled file ship
    // together end-to-end via the same path the embedded runner uses.
    const prompt = getSystemPrompt({ taskType: 'wireframe_apply' })
    expect(prompt).toContain('# Wireframe Apply')
    expect(prompt).toContain('annotask_get_component_examples')
  })
})
