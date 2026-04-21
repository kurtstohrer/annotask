import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

interface MatrixKey {
  app: string
  group: string
  feature: string
}

interface MatrixEntry {
  key: MatrixKey
  status: TestResult['status']
  title: string
  errorMessage?: string
  errorStack?: string
  durationMs: number
  retry: number
}

function parseMatrixTag(text: string): MatrixKey | null {
  const parts = text.split('/')
  if (parts.length < 3) return null
  const [app, group, ...rest] = parts
  return { app, group, feature: rest.join('/') }
}

function symbol(status: TestResult['status']): string {
  if (status === 'passed') return '✓'
  if (status === 'failed' || status === 'timedOut' || status === 'interrupted') return '✗'
  if (status === 'skipped') return '—'
  return '?'
}

export default class AnnotaskMatrixReporter implements Reporter {
  private entries: MatrixEntry[] = []
  private outDir: string

  constructor(options: { outputDir?: string } = {}) {
    this.outDir = options.outputDir ?? join(__dirname, '..', 'reports')
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const matrixAnnotation = test.annotations.find(a => a.type === 'matrix')
    if (!matrixAnnotation?.description) return
    const key = parseMatrixTag(matrixAnnotation.description)
    if (!key) return
    this.entries.push({
      key,
      status: result.status,
      title: test.title,
      errorMessage: result.error?.message,
      errorStack: result.error?.stack,
      durationMs: result.duration,
      retry: result.retry,
    })
  }

  onEnd(_result: FullResult): void {
    this.ensureDir(this.outDir)
    this.writeMatrix()
    this.writeIssues()
    // eslint-disable-next-line no-console
    console.log(`\n[annotask reporter] wrote ${this.entries.length} matrix entries to ${this.outDir}`)
  }

  private ensureDir(path: string): void {
    mkdirSync(path, { recursive: true })
  }

  private writeMatrix(): void {
    const byKey = new Map<string, MatrixEntry>()
    for (const e of this.entries) {
      const k = `${e.key.app}|${e.key.group}|${e.key.feature}`
      const existing = byKey.get(k)
      if (!existing || (e.status === 'failed' && existing.status !== 'failed')) byKey.set(k, e)
    }

    const apps = [...new Set(this.entries.map(e => e.key.app))].sort()
    const features = [...new Set(this.entries.map(e => `${e.key.group}/${e.key.feature}`))].sort()

    const lines: string[] = []
    lines.push('# Annotask × MFE Matrix Report')
    lines.push('')
    lines.push(`Generated: ${new Date().toISOString()}`)
    lines.push('')
    lines.push('Legend: `✓` pass · `✗` fail · `—` skipped · `?` no result')
    lines.push('')

    const header = ['Feature', ...apps]
    lines.push(`| ${header.join(' | ')} |`)
    lines.push(`| ${header.map(() => '---').join(' | ')} |`)

    for (const feature of features) {
      const [group, ...featureRest] = feature.split('/')
      const featureName = featureRest.join('/')
      const row = [`${group} · ${featureName}`]
      for (const app of apps) {
        const entry = byKey.get(`${app}|${group}|${featureName}`)
        row.push(entry ? symbol(entry.status) : '?')
      }
      lines.push(`| ${row.join(' | ')} |`)
    }

    const totals = { pass: 0, fail: 0, skip: 0 }
    for (const e of byKey.values()) {
      if (e.status === 'passed') totals.pass++
      else if (e.status === 'skipped') totals.skip++
      else totals.fail++
    }
    lines.push('')
    lines.push('## Totals')
    lines.push(`- Passed: ${totals.pass}`)
    lines.push(`- Failed: ${totals.fail}`)
    lines.push(`- Skipped: ${totals.skip}`)

    writeFileSync(join(this.outDir, 'annotask-matrix.md'), lines.join('\n') + '\n')
  }

  private writeIssues(): void {
    const failures = this.entries.filter(e => e.status === 'failed' || e.status === 'timedOut')
    const lines: string[] = []
    lines.push('# Annotask Matrix Issues')
    lines.push('')
    lines.push(`Generated: ${new Date().toISOString()}`)
    lines.push(`Total failures: ${failures.length}`)
    lines.push('')

    if (failures.length === 0) {
      lines.push('_No failures recorded._')
    }

    const byApp = new Map<string, MatrixEntry[]>()
    for (const f of failures) {
      const list = byApp.get(f.key.app) ?? []
      list.push(f)
      byApp.set(f.key.app, list)
    }

    for (const [app, list] of [...byApp.entries()].sort()) {
      lines.push(`## App: \`${app}\``)
      lines.push('')
      for (const f of list) {
        lines.push(`### ${f.key.group} · ${f.key.feature}`)
        lines.push('')
        lines.push(`- Test: **${f.title}**`)
        lines.push(`- Status: \`${f.status}\``)
        lines.push(`- Duration: ${f.durationMs}ms`)
        if (f.retry > 0) lines.push(`- Retry: ${f.retry}`)
        if (f.errorMessage) {
          lines.push('')
          lines.push('**Error:**')
          lines.push('```')
          lines.push(f.errorMessage)
          lines.push('```')
        }
        if (f.errorStack) {
          lines.push('')
          lines.push('<details><summary>Stack trace</summary>')
          lines.push('')
          lines.push('```')
          lines.push(f.errorStack)
          lines.push('```')
          lines.push('</details>')
        }
        lines.push('')
      }
    }

    writeFileSync(join(this.outDir, 'annotask-issues.md'), lines.join('\n') + '\n')
  }
}
