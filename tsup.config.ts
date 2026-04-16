import { defineConfig } from 'tsup'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }

const sharedDefine = {
  __ANNOTASK_VERSION__: JSON.stringify(pkg.version),
}

export default defineConfig([
  {
    entry: {
      index: 'src/plugin/index.ts',
      server: 'src/server/index.ts',
      standalone: 'src/server/standalone.ts',
      webpack: 'src/webpack/index.ts',
      'webpack-loader': 'src/webpack/loader.ts',
    },
    format: ['esm'],
    dts: true,
    clean: false,
    sourcemap: true,
    external: ['vite', 'webpack', 'html-webpack-plugin', 'typescript'],
    define: sharedDefine,
  },
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
    define: sharedDefine,
  },
])
