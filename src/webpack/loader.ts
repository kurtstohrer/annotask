/**
 * Webpack loader for Annotask source file transform.
 * Injects data-annotask-* attributes into Vue, React, Svelte, and SolidJS templates.
 * Must run BEFORE framework-specific loaders (enforce: 'pre').
 */
import { transformFile, injectComponentRegistry } from '../plugin/transform.js'

export default function annotaskLoader(this: any, source: string): string {
  const options = this.getOptions?.() || {}
  const filePath = this.resourcePath
  const projectRoot = options.projectRoot || process.cwd()
  const mfe: string | undefined = options.mfe

  // Expose framework runtime on main entry files
  if (filePath.endsWith('/main.ts') || filePath.endsWith('/main.js') || filePath.endsWith('/main.tsx') || filePath.endsWith('/main.jsx')) {
    if (source.includes("from 'vue'") || source.includes('from "vue"')) {
      return source + `\n;import { createApp as __uf_createApp, h as __uf_h } from 'vue';\nwindow.__ANNOTASK_VUE__ = { createApp: __uf_createApp, h: __uf_h };\n`
    }
    if (source.includes("from 'react'") || source.includes('from "react"')) {
      return source + `\n;import { createElement as __uf_createElement } from 'react';\nimport { createRoot as __uf_createRoot } from 'react-dom/client';\nwindow.__ANNOTASK_REACT__ = { createElement: __uf_createElement, createRoot: __uf_createRoot };\n`
    }
    if (source.includes("from 'svelte'") || source.includes('from "svelte"')) {
      return source + `\n;import { mount as __uf_mount, unmount as __uf_unmount } from 'svelte';\nwindow.__ANNOTASK_SVELTE__ = { mount: __uf_mount, unmount: __uf_unmount };\n`
    }
    if (source.includes("from 'solid-js") || source.includes('from "solid-js')) {
      return source + `\n;import { render as __uf_render } from 'solid-js/web';\nwindow.__ANNOTASK_SOLID__ = { render: __uf_render };\n`
    }
  }

  // Transform source files
  if (!filePath.endsWith('.vue') && !filePath.endsWith('.svelte') && !/\.[jt]sx$/.test(filePath)) return source

  const result = transformFile(source, filePath, projectRoot, mfe)
  if (!result) return source

  // Register this file's imported components into window.__ANNOTASK_COMPONENTS__
  // via the shared helper (covers named/aliased/relative imports — the old
  // inline version here only handled default, non-relative imports).
  return injectComponentRegistry(result, filePath)
}
