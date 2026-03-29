import { defineConfig } from 'tsup'

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
    external: ['vite', 'webpack', 'html-webpack-plugin'],
  },
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    banner: { js: '#!/usr/bin/env node' },
  },
])
