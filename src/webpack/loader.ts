/**
 * Webpack loader for Annotask SFC transform.
 * Injects data-annotask-* attributes into Vue SFC templates.
 * Must run BEFORE vue-loader (enforce: 'pre').
 */
import { transformSFC } from '../plugin/transform.js'

export default function annotaskLoader(this: any, source: string): string {
  const options = this.getOptions?.() || {}
  const filePath = this.resourcePath
  const projectRoot = options.projectRoot || process.cwd()

  // Expose Vue runtime on main entry files
  if ((filePath.endsWith('/main.ts') || filePath.endsWith('/main.js')) && source.includes("from 'vue'")) {
    return source + `\n;import { createApp as __uf_createApp, h as __uf_h } from 'vue';\nwindow.__ANNOTASK_VUE__ = { createApp: __uf_createApp, h: __uf_h };\n`
  }

  if (!filePath.endsWith('.vue')) return source

  const result = transformSFC(source, filePath, projectRoot)
  if (!result) return source

  // Register imported components globally
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
    output = output.replace(/<\/script>/, regCode + '</script>')
  }

  return output
}
