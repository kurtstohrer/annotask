import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

export interface ScannedProp {
  name: string
  type: string | null
  required: boolean
  description: string | null
  default: string | null
}

export interface ScannedComponent {
  name: string
  module: string          // e.g. "primevue/button"
  props: ScannedProp[]
}

export interface ScannedLibrary {
  name: string
  version: string
  components: ScannedComponent[]
}

export interface ComponentCatalog {
  libraries: ScannedLibrary[]
  scannedAt: number
}

export interface ComponentManifestEntry {
  name: string
  module: string
}

let cachedCatalog: ComponentCatalog | null = null
let cachedManifest: ComponentManifestEntry[] | null = null

/**
 * Generate a flat manifest of all importable components — both library and local.
 * Used by the Vite plugin to generate a bootstrap module that pre-loads everything.
 */
export async function generateComponentManifest(projectRoot: string): Promise<ComponentManifestEntry[]> {
  if (cachedManifest) return cachedManifest

  const entries: ComponentManifestEntry[] = []
  const seen = new Set<string>()

  // 1. Library components from node_modules
  const catalog = await scanComponentLibraries(projectRoot)
  for (const lib of catalog.libraries) {
    for (const comp of lib.components) {
      if (!seen.has(comp.name)) {
        entries.push({ name: comp.name, module: comp.module })
        seen.add(comp.name)
      }
    }
  }

  // 2. Local project components from src/
  const srcDir = path.join(projectRoot, 'src')
  try {
    const localFiles = await findVueFilesRecursive(srcDir)
    for (const filePath of localFiles) {
      const name = extractComponentName(filePath)
      // Only PascalCase names (skip files like main.ts, router.ts, etc.)
      if (name[0] !== name[0].toUpperCase() || name[0] === name[0].toLowerCase()) continue
      if (seen.has(name)) continue
      // Use relative path from project root for Vite resolution
      const relPath = './' + path.relative(projectRoot, filePath).replace(/\\/g, '/')
      entries.push({ name, module: relPath })
      seen.add(name)
    }
  } catch { /* src/ might not exist */ }

  cachedManifest = entries
  return entries
}

export function clearComponentCache() {
  cachedCatalog = null
  cachedManifest = null
}

async function findVueFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = []
  let entries: fs.Dirent[]
  try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return results }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.annotask') continue
      results.push(...await findVueFilesRecursive(fullPath))
    } else if (entry.name.endsWith('.vue')) {
      results.push(fullPath)
    }
  }
  return results
}

function extractComponentName(filePath: string): string {
  const fileName = path.basename(filePath)
  return fileName.replace(/\.(vue|svelte|astro|html|[jt]sx?)$/, '')
}

export async function scanComponentLibraries(projectRoot: string): Promise<ComponentCatalog> {
  if (cachedCatalog) return cachedCatalog

  const libraries: ScannedLibrary[] = []

  // Read project's package.json to find dependencies
  const pkgPath = path.join(projectRoot, 'package.json')
  let deps: Record<string, string> = {}
  try {
    const pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf-8'))
    deps = { ...pkg.dependencies, ...pkg.devDependencies }
  } catch { return { libraries: [], scannedAt: Date.now() } }

  // Check each dependency for component library patterns
  for (const depName of Object.keys(deps)) {
    // Skip obvious non-component packages
    if (depName.startsWith('@types/') || depName.startsWith('@vitejs/')) continue
    if (['vue', 'react', 'react-dom', 'react-router-dom', 'svelte', 'vite', 'typescript', 'annotask', 'vue-router', 'pinia'].includes(depName)) continue

    const depDir = resolvePackageDir(projectRoot, depName)
    if (!depDir) continue

    const library = await scanLibrary(depName, depDir)
    if (library && library.components.length >= 3 && library.components.some(c => c.props.length > 0)) {
      libraries.push(library)
    }
  }

  cachedCatalog = { libraries, scannedAt: Date.now() }
  return cachedCatalog
}



function resolvePackageDir(projectRoot: string, packageName: string): string | null {
  // Walk up from projectRoot looking for node_modules/{packageName}
  let dir = projectRoot
  while (true) {
    const candidate = path.join(dir, 'node_modules', packageName)
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

async function scanLibrary(name: string, pkgDir: string): Promise<ScannedLibrary | null> {
  // Read package version
  let version = '0.0.0'
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(pkgDir, 'package.json'), 'utf-8'))
    version = pkg.version || version
  } catch { return null }

  // Strategy: scan subdirectories for component modules
  const components: ScannedComponent[] = []

  let entries: string[]
  try {
    entries = await fsp.readdir(pkgDir)
  } catch { return null }

  for (const entry of entries) {
    // Skip non-component directories
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'style' || entry === 'styles') continue
    if (['config', 'utils', 'helpers', 'types', 'core', 'icons', 'themes', 'locale',
         'passthrough', 'src', 'dist', 'es', 'lib', 'cjs', 'esm'].includes(entry)) continue

    const subdir = path.join(pkgDir, entry)
    let stat: fs.Stats
    try { stat = await fsp.stat(subdir) } catch { continue }
    if (!stat.isDirectory()) continue

    // Check if this subdir has component indicators
    const hasVue = await fileExists(subdir, `${pascalCase(entry)}.vue`) || await hasVueFile(subdir)
    const hasDts = await fileExists(subdir, 'index.d.ts')
    const hasIndex = await fileExists(subdir, 'index.mjs') || await fileExists(subdir, 'index.js')

    // Must have an importable module (not type-only)
    if (!hasIndex && !hasVue) continue

    // Skip directories that are clearly not components (services, directives, composables, etc.)
    if (entry.endsWith('service') || entry.endsWith('directive') || entry.endsWith('options') ||
        entry.endsWith('eventbus') || entry.endsWith('icon') ||
        entry.startsWith('use')) continue

    // Read the index file for further checks
    let indexContent: string | null = null
    if (hasIndex) {
      try {
        const indexName = fs.existsSync(path.join(subdir, 'index.mjs')) ? 'index.mjs' : 'index.js'
        indexContent = await fsp.readFile(path.join(subdir, indexName), 'utf-8')
      } catch { /* proceed */ }
    }

    // Skip Vue directives (they extend BaseDirective, not components)
    if (indexContent && indexContent.includes('BaseDirective') && !indexContent.includes('defineComponent') && !indexContent.includes('.vue')) continue

    // Skip components with unresolvable optional peer deps (e.g. chart.js, quill)
    if (indexContent) {
      const dynamicImports = [...indexContent.matchAll(/import\(['"]([^'"]+)['"]\)/g)].map(m => m[1])
      const externalDeps = dynamicImports.filter(d => !d.startsWith('.') && !d.startsWith('/') && !d.startsWith(name) && !d.startsWith('@primevue') && !d.startsWith('@primeuix'))
      if (externalDeps.length > 0) {
        // Check if these deps are installed
        let hasMissingDep = false
        for (const dep of externalDeps) {
          const depPkg = dep.split('/')[0].startsWith('@') ? dep.split('/').slice(0, 2).join('/') : dep.split('/')[0]
          // Check from the package's own node_modules or parent
          const pkgRoot = pkgDir.replace(/\/node_modules\/.*$/, '')
          if (!resolvePackageDir(pkgRoot, depPkg)) { hasMissingDep = true; break }
        }
        if (hasMissingDep) continue
      }
    }

    let componentName = pascalCase(entry)
    let props: ScannedProp[] = []

    // Try to extract props from .d.ts first (most reliable)
    if (hasDts) {
      const dtsResult = await extractPropsFromDts(path.join(subdir, 'index.d.ts'), componentName)
      props = dtsResult.props
      if (dtsResult.resolvedName) componentName = dtsResult.resolvedName
    }

    // Fallback: try .vue file
    if (props.length === 0 && hasVue) {
      const vueFile = await findVueFile(subdir, componentName)
      if (vueFile) {
        props = await extractPropsFromVue(vueFile)
      }
    }

    components.push({
      name: componentName,
      module: `${name}/${entry}`,
      props,
    })
  }

  // Strategy 2: Barrel-exported packages (e.g. @radix-ui/themes, @mantine/core)
  // If no top-level subdirectory components found, check for a component index .d.ts
  if (components.length === 0) {
    const barrelComponents = await scanBarrelExports(name, pkgDir)
    components.push(...barrelComponents)
  }

  if (components.length === 0) return null

  components.sort((a, b) => a.name.localeCompare(b.name))
  return { name, version, components }
}

/**
 * Scan a package that exports all components from a barrel (index.d.ts).
 * Parses re-export lines like: export { Button, type ButtonProps } from './button.js'
 * Then reads per-component .d.ts and .props.d.ts files for prop metadata.
 */
async function scanBarrelExports(name: string, pkgDir: string): Promise<ScannedComponent[]> {
  // Find the component index — try common paths
  const candidatePaths = [
    path.join(pkgDir, 'dist', 'esm', 'components', 'index.d.ts'),
    path.join(pkgDir, 'dist', 'components', 'index.d.ts'),
    path.join(pkgDir, 'src', 'components', 'index.d.ts'),
    path.join(pkgDir, 'components', 'index.d.ts'),
  ]

  let indexPath: string | null = null
  let componentsDir: string | null = null
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      indexPath = p
      componentsDir = path.dirname(p)
      break
    }
  }
  if (!indexPath || !componentsDir) return []

  let indexContent: string
  try { indexContent = await fsp.readFile(indexPath, 'utf-8') } catch { return [] }

  const components: ScannedComponent[] = []

  // Parse export lines: export { ComponentName, type ComponentNameProps } from './file.js'
  const exportRegex = /export\s+\{[^}]*?\b(\w+)\b[^}]*\}\s+from\s+['"]\.\/([^'"]+)['"]/g
  const namespaceExportRegex = /export\s+\*\s+as\s+(\w+)\s+from\s+['"]\.\/([^'"]+)['"]/g

  const seen = new Set<string>()

  for (const regex of [exportRegex, namespaceExportRegex]) {
    let match: RegExpExecArray | null
    // Reset lastIndex for reuse
    regex.lastIndex = 0
    while ((match = regex.exec(indexContent)) !== null) {
      const componentName = match[1]
      const fileStem = match[2].replace(/\.js$/, '')

      // Skip internal helpers, icons, non-PascalCase
      if (componentName[0] !== componentName[0].toUpperCase() || componentName[0] === componentName[0].toLowerCase()) continue
      if (componentName.endsWith('Props') || componentName.endsWith('Icon') || componentName === 'Portal' || componentName === 'Reset') continue
      if (seen.has(componentName)) continue
      seen.add(componentName)

      let props: ScannedProp[] = []

      // Try .props.d.ts file first (Radix pattern: badge.props.d.ts)
      const propDefsPath = path.join(componentsDir, `${fileStem}.props.d.ts`)
      if (fs.existsSync(propDefsPath)) {
        props = await extractPropsFromPropDefs(propDefsPath)
      }

      // Fallback: try the component .d.ts for *Props interface
      if (props.length === 0) {
        const compDtsPath = path.join(componentsDir, `${fileStem}.d.ts`)
        if (fs.existsSync(compDtsPath)) {
          const dtsResult = await extractPropsFromDts(compDtsPath, componentName)
          props = dtsResult.props
        }
      }

      components.push({ name: componentName, module: name, props })
    }
  }

  return components
}

/**
 * Extract props from a Radix-style propDefs declaration file.
 * Format: const fooBarPropDefs = { propName: { type: "enum"|"boolean", values?: [...], default?: ... } }
 */
async function extractPropsFromPropDefs(filePath: string): Promise<ScannedProp[]> {
  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return [] }

  const props: ScannedProp[] = []

  // Find the propDefs object body — skip the variable declaration
  // Pattern: declare const xxxPropDefs: { ...properties... }
  const objStart = content.indexOf('PropDefs:')
  if (objStart === -1) return []
  const braceStart = content.indexOf('{', objStart)
  if (braceStart === -1) return []

  // Extract the top-level properties (depth 1 inside the outer braces)
  let depth = 0
  let i = braceStart
  let propStart = -1
  let currentPropName = ''

  while (i < content.length) {
    if (content[i] === '{') {
      depth++
      if (depth === 2) propStart = i // Start of a property's value object
    } else if (content[i] === '}') {
      if (depth === 2 && propStart >= 0 && currentPropName) {
        // Extract this property's body
        const body = content.slice(propStart + 1, i)
        const typeMatch = body.match(/type:\s*"(\w+)"/)
        const valuesMatch = body.match(/values:\s*readonly\s*\[([^\]]+)\]/)
        const defaultMatch = body.match(/default:\s*([^;}\n]+)/)

        let type: string | null = null
        if (typeMatch) {
          if (typeMatch[1] === 'enum' && valuesMatch) {
            type = valuesMatch[1].split(',').map(v => v.trim()).filter(v => v.startsWith('"'))
              .map(v => v.replace(/"/g, "'")).join(' | ')
            if (type.length > 80) type = type.slice(0, 77) + '...'
          } else {
            type = typeMatch[1]
          }
        }

        let defaultVal: string | null = null
        if (defaultMatch) {
          const raw = defaultMatch[1].trim().replace(/[;,\s]+$/, '')
          // Skip complex union defaults like "gray" | "gold" | ...
          if (!raw.includes(' | ') && raw !== 'undefined') defaultVal = raw.replace(/"/g, '')
        }

        props.push({ name: currentPropName, type, required: false, description: null, default: defaultVal })
        currentPropName = ''
        propStart = -1
      }
      depth--
      if (depth === 0) break // End of the outer object
    } else if (depth === 1 && content[i] !== ' ' && content[i] !== '\n' && content[i] !== '\r' && content[i] !== '\t' && content[i] !== ';') {
      // At depth 1, look for property names (identifier followed by :)
      const rest = content.slice(i)
      const nameMatch = rest.match(/^(\w+)\s*:/)
      if (nameMatch) {
        currentPropName = nameMatch[1]
        i += nameMatch[0].length - 1 // Skip past the name and colon
      }
    }
    i++
  }

  return props
}

async function extractPropsFromDts(dtsPath: string, componentName: string): Promise<{ props: ScannedProp[]; resolvedName: string | null }> {
  let content: string
  try { content = await fsp.readFile(dtsPath, 'utf-8') } catch { return { props: [], resolvedName: null } }

  // Try exact match first, then search for any *Props interface
  let propsInterfaceName = `${componentName}Props`
  let interfaceRegex = new RegExp(`export\\s+(?:declare\\s+)?interface\\s+${propsInterfaceName}(?:<[^>]*>)?\\s*(?:extends\\s+[^{]*)?\\{`)
  let match = interfaceRegex.exec(content)

  let resolvedName: string | null = null
  if (!match) {
    // Find any exported *Props interface (e.g., AutoCompleteProps when dir is "autocomplete")
    // Handle generics: DataTableProps<T = any> extends ...
    const genericRegex = /export\s+(?:declare\s+)?interface\s+(\w+Props)(?:<[^>]*>)?\s*(?:extends\s+[^{]*)?\{/g
    let candidate: RegExpExecArray | null
    while ((candidate = genericRegex.exec(content)) !== null) {
      const name = candidate[1]
      // Skip PassThrough and internal props
      if (name.includes('PassThrough') || name.includes('MethodOptions')) continue
      match = candidate
      propsInterfaceName = name
      resolvedName = name.replace(/Props$/, '')
      break
    }
    if (!match) return { props: [], resolvedName: null }
  }

  // Extract the interface body (track brace depth)
  const start = match.index + match[0].length
  let depth = 1
  let end = start
  while (end < content.length && depth > 0) {
    if (content[end] === '{') depth++
    else if (content[end] === '}') depth--
    end++
  }

  const body = content.slice(start, end - 1)

  // Parse properties — each starts with a JSDoc comment (optional) then name?: type
  const props: ScannedProp[] = []
  // Match: optional JSDoc + property name + optional ? + : + type
  const propRegex = /(?:\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?(\w+)(\??):\s*([^;]+);/g
  let propMatch: RegExpExecArray | null

  while ((propMatch = propRegex.exec(body)) !== null) {
    const [, jsdoc, propName, optional, rawType] = propMatch

    // Skip internal/passthrough props
    if (['pt', 'ptOptions', 'unstyled', 'dt'].includes(propName)) continue

    // Extract @defaultValue from JSDoc
    let defaultValue: string | null = null
    let description: string | null = null
    if (jsdoc) {
      const defaultMatch = jsdoc.match(/@defaultValue\s+(.+?)(?:\n|$)/)
      if (defaultMatch) defaultValue = defaultMatch[1].trim()
      // First line of JSDoc is the description
      const descLine = jsdoc.split('\n').map(l => l.replace(/^\s*\*\s?/, '').trim()).filter(l => l && !l.startsWith('@'))[0]
      if (descLine) description = descLine
    }

    // Simplify complex types for display
    let type = rawType.trim()
    // Remove undefined from union
    type = type.replace(/\s*\|\s*undefined/g, '').replace(/undefined\s*\|\s*/g, '')
    // Simplify HintedString<'a' | 'b'> to 'a' | 'b'
    type = type.replace(/HintedString<([^>]+)>/g, '$1')
    // Truncate very long types
    if (type.length > 80) type = type.slice(0, 77) + '...'

    props.push({
      name: propName,
      type: type || null,
      required: optional !== '?',
      description,
      default: defaultValue,
    })
  }

  return { props, resolvedName }
}

async function extractPropsFromVue(vuePath: string): Promise<ScannedProp[]> {
  let content: string
  try { content = await fsp.readFile(vuePath, 'utf-8') } catch { return [] }

  // Try to find defineProps or props: { ... }
  const props: ScannedProp[] = []

  // Match props: { name: { type: String, required: true }, ... }
  const propsMatch = content.match(/props:\s*\{([\s\S]*?)\n\s*\}/)
  if (propsMatch) {
    const propRegex = /(\w+):\s*\{([^}]+)\}/g
    let m: RegExpExecArray | null
    while ((m = propRegex.exec(propsMatch[1])) !== null) {
      const propName = m[1]
      const propDef = m[2]
      const typeMatch = propDef.match(/type:\s*(\w+)/)
      const requiredMatch = propDef.match(/required:\s*(true|false)/)
      const defaultMatch = propDef.match(/default:\s*(.+?)(?:,|\s*$)/)
      props.push({
        name: propName,
        type: typeMatch ? typeMatch[1] : null,
        required: requiredMatch ? requiredMatch[1] === 'true' : false,
        description: null,
        default: defaultMatch ? defaultMatch[1].trim() : null,
      })
    }
  }

  return props
}

// ── Utilities ──────────────────────────────────────────

function pascalCase(str: string): string {
  return str.replace(/(^|[-_])([a-z])/g, (_, __, c) => c.toUpperCase())
    .replace(/[-_]/g, '')
}

async function fileExists(dir: string, name: string): Promise<boolean> {
  try {
    await fsp.access(path.join(dir, name))
    return true
  } catch { return false }
}

async function hasVueFile(dir: string): Promise<boolean> {
  try {
    const files = await fsp.readdir(dir)
    return files.some(f => f.endsWith('.vue'))
  } catch { return false }
}

async function findVueFile(dir: string, componentName: string): Promise<string | null> {
  // Try exact match first
  const exact = path.join(dir, `${componentName}.vue`)
  if (fs.existsSync(exact)) return exact
  // Try any .vue file
  try {
    const files = await fsp.readdir(dir)
    const vue = files.find(f => f.endsWith('.vue') && !f.startsWith('Base'))
    return vue ? path.join(dir, vue) : null
  } catch { return null }
}
