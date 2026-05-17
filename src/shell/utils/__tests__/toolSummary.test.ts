import { describe, it, expect } from 'vitest'
import { summarizeToolCall, summarizeToolResult } from '../toolSummary'

describe('summarizeToolCall', () => {
  it('renders Read with offset+limit as a line range', () => {
    expect(summarizeToolCall('Read', { file_path: 'src/App.vue', offset: 42, limit: 48 }))
      .toBe('Reading src/App.vue:42-89')
  })

  it('renders Read with just offset as :42+', () => {
    expect(summarizeToolCall('Read', { file_path: 'src/App.vue', offset: 42 }))
      .toBe('Reading src/App.vue:42+')
  })

  it('renders bare Read paths', () => {
    expect(summarizeToolCall('Read', { file_path: 'package.json' }))
      .toBe('Reading package.json')
  })

  it('renders Edit and Write', () => {
    expect(summarizeToolCall('Write', { file_path: 'a.ts' })).toBe('Writing a.ts')
    expect(summarizeToolCall('Edit', { file_path: 'a.ts' })).toBe('Editing a.ts')
  })

  it('renders MultiEdit with count', () => {
    expect(summarizeToolCall('MultiEdit', { file_path: 'a.ts', edits: [{}, {}, {}] }))
      .toBe('Editing a.ts (3 edits)')
  })

  it('renders Bash with a truncated command', () => {
    expect(summarizeToolCall('Bash', { command: 'npm test' })).toBe('Running npm test')
    expect(summarizeToolCall('Bash', { command: 'a'.repeat(200) })).toMatch(/^Running a+…/)
  })

  it('renders Grep with pattern + path', () => {
    expect(summarizeToolCall('Grep', { pattern: 'TODO', path: 'src/' }))
      .toBe('Searching for "TODO" in src/')
  })

  it('renders Glob with the pattern', () => {
    expect(summarizeToolCall('Glob', { pattern: '**/*.ts' })).toBe('Listing **/*.ts')
  })

  it('renders WebFetch + WebSearch', () => {
    expect(summarizeToolCall('WebFetch', { url: 'https://x.test' }))
      .toBe('Fetching https://x.test')
    expect(summarizeToolCall('WebSearch', { query: 'vue 3 ref' }))
      .toBe('Searching the web for "vue 3 ref"')
  })

  it('renders Task delegations', () => {
    expect(summarizeToolCall('Task', { description: 'refactor color', subagent_type: 'Explore' }))
      .toBe('Delegating to Explore: refactor color')
  })

  it('falls back to name(args) for unknown tools', () => {
    expect(summarizeToolCall('UnknownTool', { key: 'value', count: 3 }))
      .toBe('UnknownTool(key="value", count=3)')
  })

  it('handles non-object inputs without throwing', () => {
    expect(summarizeToolCall('Read', null)).toBe('Reading file')
    expect(summarizeToolCall('Bash', 'literal string')).toBe('Running shell command')
  })
})

describe('summarizeToolResult', () => {
  it('returns "OK" for empty success', () => {
    expect(summarizeToolResult('')).toBe('OK')
  })

  it('returns "Error" for empty failure', () => {
    expect(summarizeToolResult('', true)).toBe('Error')
  })

  it('prefixes Error with the first line', () => {
    expect(summarizeToolResult('Module not found\nat line 5', true))
      .toBe('Error: Module not found')
  })

  it('reports line count when content is multi-line', () => {
    expect(summarizeToolResult('a\nb\nc\nd\ne')).toBe('5 lines returned')
  })

  it('returns a truncated first line for short content', () => {
    expect(summarizeToolResult('single line answer')).toBe('single line answer')
  })
})
