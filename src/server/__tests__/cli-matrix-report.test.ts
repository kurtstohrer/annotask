import { describe, it, expect } from 'vitest'
import { renderMdxReport, type ReportInput } from './cli-matrix-report.js'

function fixture(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    timestamp: '2026-05-19T20:00:00.000Z',
    totalWallMs: 132_400,
    suiteVersion: '1.0',
    workspaceKept: false,
    runs: [
      {
        key: 'claude-local',
        model: 'claude-sonnet-4-6',
        status: 'pass',
        elapsedMs: 91_000,
        tokens: { inputTokens: 12_000, outputTokens: 1_400, cacheReadTokens: 8_000, cacheCreationTokens: 1_000 },
        assertions: [
          { name: 'design-spec.json exists', ok: true },
          { name: 'colors >= 3', ok: true, detail: '7 detected' },
          { name: 'style guide non-template', ok: true },
          { name: 'agents.json filled', ok: true, detail: '4/4 personas' },
          { name: 'token usage > 0', ok: true },
        ],
        designSpec: {
          colorCount: 7,
          colors: [{ name: 'primary', value: '#3366ff' }, { name: 'surface', value: '#fff' }],
          themes: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }],
        },
        styleGuideExcerpt: '# Project style guide\n\nNaming: PascalCase components.',
        agents: [{ id: 'general', firstSentence: 'Senior Vue 3 + single-spa developer.' }],
        agentLinesTail: ['Reading package.json', 'Wrote design-spec.json'],
        workspacePath: '/tmp/annotask-cli-matrix/claude-local-abc',
      },
      {
        key: 'opencode-local',
        model: 'github-copilot/gpt-5.4',
        status: 'fail',
        reason: 'colors < 3 (detected 0)',
        elapsedMs: 132_400,
        tokens: { inputTokens: 15_000, outputTokens: 800, cacheReadTokens: 0, cacheCreationTokens: 0 },
        assertions: [
          { name: 'design-spec.json exists', ok: true },
          { name: 'colors >= 3', ok: false, detail: 'got 0' },
        ],
      },
      {
        key: 'codex-local',
        model: 'gpt-5.4',
        status: 'skip',
        reason: 'codex CLI not logged in',
        elapsedMs: 0,
        tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
        assertions: [],
      },
    ],
    ...overrides,
  }
}

describe('renderMdxReport', () => {
  it('emits frontmatter with the run metadata', () => {
    const md = renderMdxReport(fixture())
    expect(md.startsWith('---\n')).toBe(true)
    expect(md).toContain('timestamp: "2026-05-19T20:00:00.000Z"')
    expect(md).toContain('totalWallMs: 132400')
    expect(md).toContain('workspaceKept: false')
  })

  it('orders the matrix claude → codex → opencode → copilot regardless of input order', () => {
    const md = renderMdxReport(fixture())
    const headings = [...md.matchAll(/^## .*(claude-local|codex-local|opencode-local|copilot-local)$/gm)]
      .map((m) => m[1])
    expect(headings).toEqual(['claude-local', 'codex-local', 'opencode-local'])
  })

  it('renders a summary table with one row per run', () => {
    const md = renderMdxReport(fixture())
    expect(md).toContain('| CLI | model | status | elapsed (s) |')
    expect(md).toMatch(/\| claude-local \| claude-sonnet-4-6 \| ✓ pass \|/)
    expect(md).toMatch(/\| opencode-local \|.*\| ✗ fail \|/)
    expect(md).toMatch(/\| codex-local \|.*\| ○ skip \|/)
  })

  it('embeds design-spec excerpt and style guide for passing runs', () => {
    const md = renderMdxReport(fixture())
    expect(md).toContain('### Design spec excerpt')
    expect(md).toContain('"colorCount": 7')
    expect(md).toContain('### STYLE_GUIDE.md excerpt')
    expect(md).toContain('# Project style guide')
  })

  it('renders assertion list with ✓/✗ icons and detail text', () => {
    const md = renderMdxReport(fixture())
    expect(md).toContain('- ✓ design-spec.json exists')
    expect(md).toContain('- ✓ colors >= 3 — 7 detected')
    expect(md).toContain('- ✗ colors >= 3 — got 0')
  })

  it('omits the workspace footer when no workspaces were kept', () => {
    const md = renderMdxReport(fixture())
    expect(md).not.toContain('## Workspaces kept on disk')
  })

  it('includes the workspace footer when ANNOTASK_CLI_MATRIX_KEEP=1', () => {
    const md = renderMdxReport(fixture({ workspaceKept: true }))
    expect(md).toContain('## Workspaces kept on disk')
    expect(md).toContain('/tmp/annotask-cli-matrix/claude-local-abc')
  })

  it('escapes pipe characters in cells so the markdown table stays valid', () => {
    const md = renderMdxReport(fixture({
      runs: [
        {
          key: 'claude-local',
          model: 'a|b',
          status: 'fail',
          reason: 'pipe | in | reason',
          elapsedMs: 1000,
          tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
          assertions: [],
        },
      ],
    }))
    expect(md).toContain('pipe \\| in \\| reason')
  })
})
