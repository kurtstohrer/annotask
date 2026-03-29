/**
 * Webpack loader for Annotask source file transform.
 * Injects data-annotask-* attributes into Vue, React, and Svelte templates.
 * Must run BEFORE framework-specific loaders (enforce: 'pre').
 */
import { transformFile } from '../plugin/transform.js'

export default function annotaskLoader(this: any, source: string): string {
  const options = this.getOptions?.() || {}
  const filePath = this.resourcePath
  const projectRoot = options.projectRoot || process.cwd()

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
  }

  // Transform source files
  if (!filePath.endsWith('.vue') && !filePath.endsWith('.svelte') && !/\.[jt]sx$/.test(filePath)) return source

  const result = transformFile(source, filePath, projectRoot)
  if (!result) return source

  // Register imported PascalCase components globally
  let output = result
  const importRegex = /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g
  let match
  const registrations: string[] = []
  while ((match = importRegex.exec(result)) !== null) {
    const [, name, src] = match
    if (name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase() && !src.startsWith('.')) {
      registrations.push(`window.__ANNOTASK_COMPONENTS__['${name}'] = ${name}`)
    }
  }
  if (registrations.length > 0) {
    const regCode = `\nif (typeof window !== 'undefined') { window.__ANNOTASK_COMPONENTS__ = window.__ANNOTASK_COMPONENTS__ || {}; ${registrations.join('; ')} }\n`
    if (filePath.endsWith('.vue') && output.includes('</script>')) {
      output = output.replace(/<\/script>/, regCode + '</script>')
    } else {
      output += regCode
    }
  }

  return output
}
