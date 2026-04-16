#!/usr/bin/env node
/**
 * Copy vendored runtime assets into dist/vendor so the shell can load them without a CDN.
 *
 * Fails loudly if a source file is missing — we pin the upstream packages to exact
 * versions precisely so this script can trust the paths. If a version bump changes a
 * dist filename, this script surfaces the break immediately instead of silently
 * shipping an empty dist/vendor/ directory.
 */
import { mkdirSync, statSync, copyFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const destDir = path.join(repoRoot, 'dist', 'vendor')

const files = [
  { src: 'node_modules/axe-core/axe.min.js',                       dest: 'axe-core.min.js' },
  { src: 'node_modules/html2canvas-pro/dist/html2canvas-pro.min.js', dest: 'html2canvas.min.js' },
]

mkdirSync(destDir, { recursive: true })

let failed = false
for (const { src, dest } of files) {
  const srcPath = path.join(repoRoot, src)
  const destPath = path.join(destDir, dest)
  try {
    const stat = statSync(srcPath)
    if (!stat.isFile() || stat.size === 0) {
      console.error(`[copy-vendor] Source is not a non-empty file: ${srcPath}`)
      failed = true
      continue
    }
    copyFileSync(srcPath, destPath)
    console.log(`[copy-vendor] ${src} → dist/vendor/${dest} (${stat.size} bytes)`)
  } catch (err) {
    console.error(`[copy-vendor] Missing vendored asset ${srcPath}: ${err.message}`)
    console.error(`[copy-vendor] Check that the upstream package still ships this path.`)
    failed = true
  }
}

if (failed) process.exit(1)
