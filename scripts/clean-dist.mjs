#!/usr/bin/env node
/**
 * Wipe dist/ before a build.
 *
 * tsup emits content-hashed chunk filenames and runs with `clean: false` (it can't
 * safely clean the whole dist/ because `build:shell` writes dist/shell first). Without
 * an explicit pre-clean, every rebuild leaves the previous build's orphaned chunks
 * behind — they pile up locally and, since `files: ["dist"]` ships the whole directory,
 * can ride into the published tarball. Running this first makes the build output (and
 * therefore the package contents) deterministic.
 */
import { rmSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const distDir = path.join(repoRoot, 'dist')

rmSync(distDir, { recursive: true, force: true })
console.log(`[clean-dist] removed ${distDir}`)
