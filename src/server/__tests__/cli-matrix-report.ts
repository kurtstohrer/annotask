/**
 * MDX report writer for the CLI matrix init suite.
 *
 * Pure string assembly — no MDX runtime needed. The output is hand-rolled
 * markdown with YAML frontmatter that any MDX-aware viewer renders fine.
 *
 * Consumed by `init-cli-matrix-stress.test.ts`; unit-tested by
 * `cli-matrix-report.test.ts` so the formatting stays stable without
 * needing a live CLI run.
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import type { LiveProviderKey } from '../../embedded/__tests__/live-cli-helpers.js'

export type RunStatus = 'pass' | 'fail' | 'skip'

export interface AssertionResult {
  name: string
  ok: boolean
  detail?: string
}

export interface DesignSpecExcerpt {
  colorCount: number
  colors: Array<{ name?: string; value?: string }>
  themes: Array<{ id?: string; name?: string }>
}

export interface AgentDirectionsSummary {
  id: string
  firstSentence: string
}

export interface PerCliRun {
  key: LiveProviderKey
  model: string
  status: RunStatus
  reason?: string
  elapsedMs: number
  tokens: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
  }
  assertions: AssertionResult[]
  designSpec?: DesignSpecExcerpt
  styleGuideExcerpt?: string
  agents?: AgentDirectionsSummary[]
  agentLinesTail?: string[]
  workspacePath?: string
}

export interface ReportInput {
  timestamp: string
  totalWallMs: number
  suiteVersion: string
  runs: PerCliRun[]
  workspaceKept: boolean
}

const CLI_ORDER: LiveProviderKey[] = [
  'claude-local',
  'codex-local',
  'opencode-local',
  'copilot-local',
]

export async function writeMdxReport(input: ReportInput, outPath: string): Promise<void> {
  await fsp.mkdir(path.dirname(outPath), { recursive: true })
  await fsp.writeFile(outPath, renderMdxReport(input), 'utf-8')
}

export function renderMdxReport(input: ReportInput): string {
  const ordered = orderRuns(input.runs)
  const sections = [
    renderFrontmatter(input, ordered),
    `# Annotask CLI matrix — stress-test init`,
    ``,
    `Generated ${input.timestamp}. Total wall time: ${formatSeconds(input.totalWallMs)}s.`,
    ``,
    renderSummaryTable(ordered),
    ...ordered.map(renderCliSection),
    renderArtifactsFooter(input, ordered),
  ]
  return sections.filter((s) => s.length > 0).join('\n') + '\n'
}

function orderRuns(runs: PerCliRun[]): PerCliRun[] {
  const byKey = new Map(runs.map((r) => [r.key, r] as const))
  const ordered: PerCliRun[] = []
  for (const k of CLI_ORDER) {
    const r = byKey.get(k)
    if (r) ordered.push(r)
  }
  return ordered
}

function renderFrontmatter(input: ReportInput, ordered: PerCliRun[]): string {
  const lines = [
    '---',
    `timestamp: ${JSON.stringify(input.timestamp)}`,
    `suiteVersion: ${JSON.stringify(input.suiteVersion)}`,
    `totalWallMs: ${input.totalWallMs}`,
    `workspaceKept: ${input.workspaceKept}`,
    `matrix:`,
    ...ordered.map((r) => `  - { key: ${JSON.stringify(r.key)}, model: ${JSON.stringify(r.model)}, status: ${JSON.stringify(r.status)} }`),
    '---',
    '',
  ]
  return lines.join('\n')
}

function renderSummaryTable(runs: PerCliRun[]): string {
  const header = [
    '## Summary',
    '',
    '| CLI | model | status | elapsed (s) | input | output | cache R | cache W | note |',
    '|-----|-------|--------|-------------|-------|--------|---------|---------|------|',
  ]
  const rows = runs.map((r) => {
    const icon = statusIcon(r.status)
    return `| ${r.key} | ${r.model || '—'} | ${icon} ${r.status} | ${formatSeconds(r.elapsedMs)} | ${r.tokens.inputTokens} | ${r.tokens.outputTokens} | ${r.tokens.cacheReadTokens} | ${r.tokens.cacheCreationTokens} | ${escapeCell(r.reason ?? '')} |`
  })
  return [...header, ...rows, ''].join('\n')
}

function renderCliSection(run: PerCliRun): string {
  const lines: string[] = [
    `## ${statusIcon(run.status)} ${run.key}`,
    '',
    '| key | value |',
    '|-----|-------|',
    `| model | \`${escapeCell(run.model || '—')}\` |`,
    `| status | ${run.status} |`,
    `| elapsed | ${formatSeconds(run.elapsedMs)}s |`,
    `| input tokens | ${run.tokens.inputTokens} |`,
    `| output tokens | ${run.tokens.outputTokens} |`,
    `| cache read | ${run.tokens.cacheReadTokens} |`,
    `| cache write | ${run.tokens.cacheCreationTokens} |`,
  ]
  if (run.reason) lines.push(`| reason | ${escapeCell(run.reason)} |`)
  if (run.workspacePath) lines.push(`| workspace | \`${run.workspacePath}\` |`)
  lines.push('')

  if (run.assertions.length > 0) {
    lines.push('### Assertions', '')
    for (const a of run.assertions) {
      const tick = a.ok ? '✓' : '✗'
      const detail = a.detail ? ` — ${a.detail}` : ''
      lines.push(`- ${tick} ${a.name}${detail}`)
    }
    lines.push('')
  }

  if (run.designSpec) {
    lines.push('### Design spec excerpt', '')
    const compact = {
      colorCount: run.designSpec.colorCount,
      colors: run.designSpec.colors.slice(0, 5),
      themes: run.designSpec.themes,
    }
    lines.push('```json', JSON.stringify(compact, null, 2), '```', '')
  }

  if (run.styleGuideExcerpt) {
    lines.push('### STYLE_GUIDE.md excerpt', '')
    lines.push('```markdown', run.styleGuideExcerpt, '```', '')
  }

  if (run.agents && run.agents.length > 0) {
    lines.push('### Agent directions', '')
    for (const a of run.agents) {
      lines.push(`- **${a.id}** — ${a.firstSentence}`)
    }
    lines.push('')
  }

  if (run.agentLinesTail && run.agentLinesTail.length > 0) {
    lines.push('### Agent transcript tail', '')
    lines.push('```text', ...run.agentLinesTail, '```', '')
  }

  return lines.join('\n')
}

function renderArtifactsFooter(input: ReportInput, ordered: PerCliRun[]): string {
  if (!input.workspaceKept) return ''
  const lines = ['## Workspaces kept on disk', '']
  for (const r of ordered) {
    if (r.workspacePath) lines.push(`- ${r.key}: \`${r.workspacePath}\``)
  }
  lines.push('')
  return lines.join('\n')
}

function statusIcon(s: RunStatus): string {
  if (s === 'pass') return '✓'
  if (s === 'fail') return '✗'
  return '○'
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(1)
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200)
}
