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

export interface ScannedSlot {
  name: string                // 'default' for the default slot
  description: string | null
  scoped: boolean             // true if the slot exposes props
}

export interface ScannedEvent {
  name: string
  payloadType: string | null
  description: string | null
}

export interface ScannedComponent {
  name: string
  module: string              // e.g. "primevue/button"
  description: string | null  // component-level JSDoc
  category: string | null     // heuristic: 'form' | 'overlay' | 'layout' | ...
  tags: string[]              // heuristic: ['button', 'input']
  deprecated: boolean
  props: ScannedProp[]
  slots: ScannedSlot[]
  events: ScannedEvent[]
  sourceFile: string | null   // absolute path — only populated for local components
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

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 min — dev-loop friendly but picks up new deps eventually
let cachedCatalog: ComponentCatalog | null = null
let cachedCatalogAt = 0
let cachedManifest: ComponentManifestEntry[] | null = null
let cachedManifestAt = 0
let inflightCatalog: Promise<ComponentCatalog> | null = null

/**
 * Generate a flat manifest of all importable components — both library and local.
 * Used by the Vite plugin to generate a bootstrap module that pre-loads everything.
 */
export async function generateComponentManifest(projectRoot: string): Promise<ComponentManifestEntry[]> {
  if (cachedManifest && (Date.now() - cachedManifestAt) < CACHE_TTL_MS) return cachedManifest

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
  cachedManifestAt = Date.now()
  return entries
}

export function clearComponentCache() {
  cachedCatalog = null
  cachedCatalogAt = 0
  cachedManifest = null
  cachedManifestAt = 0
  inflightCatalog = null
}

/** Build a ScannedComponent with sensible empty defaults for optional enrichment fields. */
function makeComponent(fields: {
  name: string
  module: string
  props?: ScannedProp[]
  slots?: ScannedSlot[]
  events?: ScannedEvent[]
  description?: string | null
  category?: string | null
  tags?: string[]
  deprecated?: boolean
  sourceFile?: string | null
}): ScannedComponent {
  return {
    name: fields.name,
    module: fields.module,
    description: fields.description ?? null,
    category: fields.category ?? categorizeComponent(fields.name, fields.module),
    tags: fields.tags ?? [],
    deprecated: fields.deprecated ?? false,
    props: fields.props ?? [],
    slots: fields.slots ?? [],
    events: fields.events ?? [],
    sourceFile: fields.sourceFile ?? null,
  }
}

/** Heuristic category from component name/module path. Returns null when nothing matches. */
function categorizeComponent(name: string, module: string): string | null {
  const haystack = (name + ' ' + module).toLowerCase()
  const rules: Array<[RegExp, string]> = [
    [/button|btn/, 'button'],
    [/input|textfield|textarea|select|radio|checkbox|switch|slider|form|picker/, 'form'],
    [/dialog|modal|drawer|popover|tooltip|menu|dropdown|overlay|sheet/, 'overlay'],
    [/table|datatable|datagrid|list|tree/, 'data'],
    [/card|panel|tabs?|accordion|collapse|splitter/, 'container'],
    [/nav|breadcrumb|sidebar|menubar|pagination|stepper/, 'navigation'],
    [/alert|toast|banner|notification|message|badge|tag|chip/, 'feedback'],
    [/avatar|icon|image|img|skeleton|spinner|progress|loader/, 'display'],
    [/grid|flex|stack|row|col|column|container|layout|section/, 'layout'],
    [/chart|graph|plot|sparkline/, 'chart'],
  ]
  for (const [re, category] of rules) if (re.test(haystack)) return category
  return null
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
  if (cachedCatalog && (Date.now() - cachedCatalogAt) < CACHE_TTL_MS) return cachedCatalog
  // Coalesce concurrent scans — node_modules walks are expensive and should run once at most.
  if (inflightCatalog) return inflightCatalog
  inflightCatalog = scanComponentLibrariesUncached(projectRoot).finally(() => { inflightCatalog = null })
  const result = await inflightCatalog
  cachedCatalog = result
  cachedCatalogAt = Date.now()
  return result
}

async function scanComponentLibrariesUncached(projectRoot: string): Promise<ComponentCatalog> {
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

    // For file: dependencies, resolve the original source directory
    // (pnpm respects "files" field, so node_modules may only have dist/)
    const depVersion = deps[depName]
    let sourceDir: string | undefined
    if (typeof depVersion === 'string' && depVersion.startsWith('file:')) {
      const resolved = path.resolve(projectRoot, depVersion.replace('file:', ''))
      if (fs.existsSync(resolved)) sourceDir = resolved
    }

    const library = await scanLibrary(depName, depDir, sourceDir)
    if (library && library.components.length >= 3) {
      // Require at least one component with props OR a framework peer dependency
      // (bundled libraries won't have props but are still valid if they depend on vue/react/svelte)
      const hasProps = library.components.some(c => c.props.length > 0)
      const hasFrameworkPeer = isFrameworkLibrary(depDir)
      if (hasProps || hasFrameworkPeer) {
        libraries.push(library)
      }
    }
  }

  cachedCatalog = { libraries, scannedAt: Date.now() }
  return cachedCatalog
}



/** Check if a package has vue/react/svelte as a peer or dependency — signals it's a UI component library */
function isFrameworkLibrary(pkgDir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
    const allDeps = { ...pkg.dependencies, ...pkg.peerDependencies }
    return ['vue', 'react', 'react-dom', 'svelte', 'solid-js', '@angular/core'].some(fw => fw in allDeps)
  } catch { return false }
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

async function scanLibrary(name: string, pkgDir: string, sourceDir?: string): Promise<ScannedLibrary | null> {
  // Read package version + optional custom-elements-manifest pointer
  let version = '0.0.0'
  let cemField: string | undefined
  try {
    const pkg = JSON.parse(await fsp.readFile(path.join(pkgDir, 'package.json'), 'utf-8'))
    version = pkg.version || version
    cemField = typeof pkg.customElements === 'string' ? pkg.customElements : undefined
  } catch { return null }

  // Strategy 0 — Custom Elements Manifest (CEM) for web component libraries
  // (Shoelace, Fluent UI, Lit-based libs). Standardized JSON: no regex, no AST. Very reliable.
  {
    const cemComponents = await scanFromCem(name, pkgDir, cemField)
    if (cemComponents.length > 0) {
      return { name, version, components: cemComponents.sort((a, b) => a.name.localeCompare(b.name)) }
    }
  }

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
         'passthrough', 'src', 'dist', 'es', 'lib', 'cjs', 'esm',
         'examples', 'tests', 'test', 'docs', 'stories', 'storybook-static', '__tests__', '__mocks__'].includes(entry)) continue

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
    let slots: ScannedSlot[] = []
    let events: ScannedEvent[] = []
    let description: string | null = null

    // Try to extract props from .d.ts first (most reliable)
    let dtsDescription: string | null = null
    if (hasDts) {
      const dtsPath = path.join(subdir, 'index.d.ts')
      const dtsResult = await extractPropsFromDts(dtsPath, componentName)
      props = dtsResult.props
      if (dtsResult.resolvedName) componentName = dtsResult.resolvedName
      try {
        dtsDescription = extractComponentJsDoc(await fsp.readFile(dtsPath, 'utf-8'))
      } catch { /* ignore */ }
    }

    // Always look for a .vue file (for slots/events) even when .d.ts gave us props
    if (hasVue) {
      const vueFile = await findVueFile(subdir, componentName)
      if (vueFile) {
        const vueDetails = await extractComponentDetails(vueFile)
        if (props.length === 0) props = vueDetails.props
        slots = vueDetails.slots
        events = vueDetails.events
        description = vueDetails.description ?? dtsDescription
      }
    }
    if (!description) description = dtsDescription

    components.push(makeComponent({
      name: componentName,
      module: `${name}/${entry}`,
      props,
      slots,
      events,
      description,
    }))
  }

  // Strategy 2: Barrel-exported packages (e.g. @radix-ui/themes, @mantine/core)
  // If no top-level subdirectory components found, check for a component index .d.ts
  if (components.length === 0) {
    const barrelComponents = await scanBarrelExports(name, pkgDir)
    components.push(...barrelComponents)
  }

  // Strategy 3: Follow package entry point — handles any library structure
  // Reads package.json to find entry, follows re-export chains, discovers component files
  if (components.length === 0) {
    const entryComponents = await scanFromEntryPoint(name, pkgDir, sourceDir)
    components.push(...entryComponents)
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
/**
 * Strategy 0: Custom Elements Manifest (CEM) — web component libraries.
 *
 * Reads `<pkgDir>/custom-elements.json` (or the path in package.json `customElements`) and
 * extracts each class declaration that registers a custom element. CEM is the standardized
 * schema produced by @custom-elements-manifest/analyzer; used by Shoelace, Fluent UI, Ionic,
 * and most Lit-based libraries. No regex or AST needed — just JSON.
 */
async function scanFromCem(pkgName: string, pkgDir: string, cemField?: string): Promise<ScannedComponent[]> {
  const candidates = [
    cemField ? path.resolve(pkgDir, cemField) : null,
    path.join(pkgDir, 'custom-elements.json'),
    path.join(pkgDir, 'dist', 'custom-elements.json'),
  ].filter((p): p is string => !!p)

  let cemPath: string | null = null
  for (const p of candidates) {
    if (fs.existsSync(p)) { cemPath = p; break }
  }
  if (!cemPath) return []

  let manifest: unknown
  try { manifest = JSON.parse(await fsp.readFile(cemPath, 'utf-8')) } catch { return [] }
  if (!manifest || typeof manifest !== 'object') return []

  const modules = (manifest as { modules?: unknown }).modules
  if (!Array.isArray(modules)) return []

  const components: ScannedComponent[] = []
  const seen = new Set<string>()

  for (const mod of modules) {
    if (!mod || typeof mod !== 'object') continue
    const declarations = (mod as { declarations?: unknown[] }).declarations
    const modulePath = (mod as { path?: string }).path
    if (!Array.isArray(declarations)) continue

    for (const decl of declarations) {
      if (!decl || typeof decl !== 'object') continue
      const d = decl as {
        kind?: string
        name?: string
        tagName?: string
        description?: string
        summary?: string
        deprecated?: unknown
        attributes?: Array<{ name?: string; type?: { text?: string }; description?: string; default?: string; required?: boolean; fieldName?: string }>
        members?: Array<{ kind?: string; name?: string; type?: { text?: string }; description?: string; default?: string; privacy?: string; static?: boolean; readonly?: boolean; reactive?: boolean }>
        slots?: Array<{ name?: string; description?: string }>
        events?: Array<{ name?: string; type?: { text?: string }; description?: string }>
      }
      if (d.kind !== 'class') continue
      if (!d.tagName && !d.name) continue // CEM may list plain classes — skip non-elements

      // Prefer the class name; fall back to PascalCasing the tag name.
      const name = d.name || pascalCase(d.tagName || '')
      if (!name || seen.has(name)) continue
      seen.add(name)

      // Build props: merge attributes + reactive/public fields. De-dupe by name — attributes
      // and fields often mirror each other (field `variant` ↔ attribute `variant`).
      const propMap = new Map<string, ScannedProp>()
      for (const a of d.attributes ?? []) {
        if (!a.name) continue
        propMap.set(a.name, {
          name: a.name,
          type: simplifyCemType(a.type?.text ?? null),
          required: a.required === true,
          description: a.description ?? null,
          default: a.default ?? null,
        })
      }
      for (const m of d.members ?? []) {
        if (m.kind !== 'field') continue
        if (!m.name || m.privacy === 'private' || m.privacy === 'protected') continue
        if (m.static) continue
        if (propMap.has(m.name)) continue
        propMap.set(m.name, {
          name: m.name,
          type: simplifyCemType(m.type?.text ?? null),
          required: false,
          description: m.description ?? null,
          default: m.default ?? null,
        })
      }

      const slots: ScannedSlot[] = (d.slots ?? [])
        .filter(s => s && typeof s === 'object')
        .map(s => ({ name: s.name || 'default', description: s.description ?? null, scoped: false }))

      const events: ScannedEvent[] = (d.events ?? [])
        .filter(e => e && e.name)
        .map(e => ({ name: e.name!, payloadType: simplifyCemType(e.type?.text ?? null), description: e.description ?? null }))

      components.push(makeComponent({
        name,
        // For web components, the package root is the import path — loading it side-effect
        // registers the custom element. Per-component sub-paths exist but are library-specific.
        module: pkgName,
        props: [...propMap.values()],
        slots,
        events,
        description: d.description ?? d.summary ?? null,
        deprecated: !!d.deprecated,
        sourceFile: modulePath ? path.resolve(pkgDir, modulePath) : null,
      }))
    }
  }

  return components
}

/** CEM `type.text` fields are usually already reasonable TS strings; just truncate long ones. */
function simplifyCemType(raw: string | null): string | null {
  if (!raw) return null
  let t = raw.trim()
  if (t.length > 400) t = t.slice(0, 397) + '...'
  return t || null
}

async function scanBarrelExports(name: string, pkgDir: string): Promise<ScannedComponent[]> {
  // Find the component index — try common paths
  const candidatePaths = [
    path.join(pkgDir, 'dist', 'esm', 'components', 'index.d.ts'),
    path.join(pkgDir, 'dist', 'components', 'index.d.ts'),
    path.join(pkgDir, 'src', 'components', 'index.d.ts'),
    path.join(pkgDir, 'components', 'index.d.ts'),
  ]

  // Also check the `types` field from package.json as a fallback
  // (handles single-barrel packages like @va-bip/bip-ui-components)
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
    const typesField: string | undefined =
      pkg.exports?.['.']?.types ?? pkg.types ?? pkg.typings
    if (typeof typesField === 'string' && typesField.endsWith('.d.ts')) {
      candidatePaths.push(path.join(pkgDir, typesField))
    }
  } catch { /* no package.json */ }

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

      components.push(makeComponent({ name: componentName, module: name, props }))
    }
  }

  // Fallback: single-barrel .d.ts with inline declarations (no per-file re-exports).
  // Parse `export { Name1, Name2, ... };` lines and match to `interface NameProps` in the same file.
  if (components.length === 0) {
    const inlineExportRe = /export\s*\{([^}]+)\}\s*;/g
    let m: RegExpExecArray | null
    while ((m = inlineExportRe.exec(indexContent)) !== null) {
      for (const token of m[1].split(',')) {
        const trimmed = token.trim().replace(/^type\s+/, '')
        if (!trimmed) continue
        const exportName = trimmed.split(/\s+as\s+/).pop()!.trim()
        // Only PascalCase component names
        if (exportName[0] !== exportName[0].toUpperCase() || exportName[0] === exportName[0].toLowerCase()) continue
        if (exportName.endsWith('Props') || exportName.endsWith('Emits') || exportName.endsWith('Icon')) continue
        if (exportName === exportName.toUpperCase()) continue
        if (/^(use|create|get|set|is|has|with|to|from)[A-Z]/.test(exportName)) continue
        if (seen.has(exportName)) continue
        seen.add(exportName)

        // Extract props from inline interface in the same file
        const dtsResult = await extractPropsFromDts(indexPath!, exportName)
        components.push(makeComponent({ name: exportName, module: name, props: dtsResult.props }))
      }
    }
  }

  return components
}

// ── Strategy 3: Entry-point-driven scanner ───────────
// Follows the package's entry point, resolves re-export chains,
// and discovers component files of any type (.vue, .tsx, .jsx, .svelte).

const COMPONENT_EXTS = new Set(['.vue', '.tsx', '.jsx', '.svelte'])

/** Resolve a bare module specifier to an actual file path */
function resolveModulePath(baseDir: string, specifier: string): string | null {
  const base = path.resolve(baseDir, specifier)

  // Direct file
  if (fs.existsSync(base) && !fs.statSync(base).isDirectory()) return base

  // Try extensions
  for (const ext of ['.vue', '.tsx', '.jsx', '.ts', '.js', '.mjs', '.svelte']) {
    const candidate = base + ext
    if (fs.existsSync(candidate)) return candidate
  }

  // Directory — try index files and same-name convention (Button/Button.vue)
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    for (const ext of ['.vue', '.tsx', '.jsx', '.ts', '.js', '.svelte']) {
      const index = path.join(base, 'index' + ext)
      if (fs.existsSync(index)) return index
    }
    const dirName = path.basename(base)
    for (const ext of ['.vue', '.tsx', '.jsx', '.svelte']) {
      const convention = path.join(base, dirName + ext)
      if (fs.existsSync(convention)) return convention
    }
  }

  return null
}

function isComponentFile(filePath: string): boolean {
  return COMPONENT_EXTS.has(path.extname(filePath))
}

/** Find the best source entry point for a package */
function findPackageEntry(pkgDir: string): string | null {
  let pkg: any
  try { pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8')) } catch { return null }

  // Prefer explicit source field
  if (pkg.source) {
    const resolved = resolveModulePath(pkgDir, pkg.source)
    if (resolved) return resolved
  }

  // Try to find source equivalent of the dist entry
  const rootExport = pkg.exports?.['.']
  const distEntry: string | undefined =
    (typeof rootExport === 'string' ? rootExport : null) ??
    (typeof rootExport?.import === 'string' ? rootExport.import : null) ??
    (typeof rootExport?.default === 'string' ? rootExport.default : null) ??
    pkg.module ??
    pkg.main

  if (typeof distEntry === 'string') {
    // Map dist path back to source (dist/index.js → src/index.ts, etc.)
    const normalized = distEntry.replace(/^\.\//, '')
    const stem = normalized.replace(/\.(m?js|cjs)$/, '')

    for (const prefix of ['src', 'lib']) {
      const mapped = normalized.startsWith('dist/')
        ? stem.replace(/^dist\//, `${prefix}/`)
        : `${prefix}/${stem}`

      const resolved = resolveModulePath(pkgDir, mapped)
      if (resolved) return resolved
    }
  }

  // Fallback: scan common source locations
  for (const candidate of [
    'src/components/index', 'src/lib/index', 'src/index',
    'components/index', 'lib/index', 'index',
  ]) {
    const resolved = resolveModulePath(pkgDir, candidate)
    if (resolved) return resolved
  }

  // Last resort: use the dist entry directly (for bundled export name extraction)
  if (distEntry) {
    const resolved = resolveModulePath(pkgDir, distEntry)
    if (resolved) return resolved
  }

  return null
}

interface ModuleRef {
  exportName: string   // Name as exported (or original name for default imports)
  filePath: string     // Resolved specifier relative to the file's directory
  isReExport: boolean  // true if it comes from export {...} from or export * from
}

/** Parse all local module references from a JS/TS file */
function parseModuleRefs(content: string, dir: string): ModuleRef[] {
  const refs: ModuleRef[] = []

  // 1. import X from './path'
  const defaultImportRe = /import\s+(\w+)\s+from\s+['"](\.[^'"]+)['"]/g
  const importMap = new Map<string, string>() // localName → specifier
  let m: RegExpExecArray | null
  while ((m = defaultImportRe.exec(content)) !== null) {
    importMap.set(m[1], m[2])
  }

  // 2. export { default as X } from './path'  and  export { X, Y } from './path'
  const reExportRe = /export\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g
  while ((m = reExportRe.exec(content)) !== null) {
    const specifier = m[2]
    for (const token of m[1].split(',')) {
      const trimmed = token.trim()
      if (!trimmed || trimmed.startsWith('type ')) continue
      // "default as Button" or just "Button"
      const asMatch = trimmed.match(/(?:default\s+as\s+)?(\w+)/)
      if (asMatch) {
        refs.push({ exportName: asMatch[1], filePath: specifier, isReExport: true })
      }
    }
  }

  // 3. export * from './path'
  const starExportRe = /export\s*\*\s*from\s*['"](\.[^'"]+)['"]/g
  while ((m = starExportRe.exec(content)) !== null) {
    refs.push({ exportName: '*', filePath: m[1], isReExport: true })
  }

  // 4. export { X, Y } (local — match with imports above)
  const localExportRe = /export\s*\{([^}]+)\}(?!\s*from)/g
  const exported = new Set<string>()
  while ((m = localExportRe.exec(content)) !== null) {
    for (const token of m[1].split(',')) {
      const name = token.trim()
      if (name && !name.startsWith('type ')) exported.add(name)
    }
  }
  // Link locally exported names back to their import source
  for (const [localName, specifier] of importMap) {
    if (exported.has(localName)) {
      refs.push({ exportName: localName, filePath: specifier, isReExport: false })
    }
  }

  return refs
}

/**
 * Recursively collect component exports starting from an entry file.
 * Follows re-export chains up to `maxDepth` levels deep.
 */
async function collectComponentExports(
  filePath: string,
  pkgName: string,
  components: ScannedComponent[],
  visited: Set<string>,
  maxDepth: number,
): Promise<void> {
  if (maxDepth <= 0 || visited.has(filePath)) return
  visited.add(filePath)

  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return }

  const dir = path.dirname(filePath)
  const refs = parseModuleRefs(content, dir)

  for (const ref of refs) {
    const resolved = resolveModulePath(dir, ref.filePath)
    if (!resolved) continue

    if (isComponentFile(resolved)) {
      const name = ref.exportName !== '*'
        ? pascalCase(ref.exportName)
        : pascalCase(extractComponentName(resolved))
      const details = await extractComponentDetails(resolved)
      components.push(makeComponent({
        name,
        module: pkgName,
        props: details.props,
        slots: details.slots,
        events: details.events,
        description: details.description,
        sourceFile: resolved,
      }))
    } else {
      // JS/TS file — follow the chain
      await collectComponentExports(resolved, pkgName, components, visited, maxDepth - 1)
    }
  }
}

/** Entry-point-driven component scanner */
async function scanFromEntryPoint(name: string, pkgDir: string, sourceDir?: string): Promise<ScannedComponent[]> {
  // Prefer source directory (for file: deps where node_modules only has dist/)
  const scanDir = sourceDir || pkgDir
  const entryPath = findPackageEntry(scanDir)

  if (entryPath) {
    let isBundled = false
    try {
      const stat = await fsp.stat(entryPath)
      isBundled = stat.size > 500_000
    } catch { /* proceed */ }

    if (!isBundled) {
      const components: ScannedComponent[] = []
      await collectComponentExports(entryPath, name, components, new Set(), 4)
      if (components.length > 0) return components
    }
  }

  // Fallback: parse named exports from the dist entry in the installed package.
  // Bundled ESM files end with export{internalName as exportName, ...}.
  // We can extract component names (no props) from this.
  const distEntry = findPackageEntry(pkgDir)
  if (distEntry) {
    const nameOnly = await extractExportNames(distEntry, name)
    // Try to hydrate props from the types .d.ts file
    if (nameOnly.length > 0) {
      let typesPath: string | null = null
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'))
        const typesField: string | undefined = pkg.exports?.['.']?.types ?? pkg.types ?? pkg.typings
        if (typeof typesField === 'string' && typesField.endsWith('.d.ts')) {
          const candidate = path.join(pkgDir, typesField)
          if (fs.existsSync(candidate)) typesPath = candidate
        }
      } catch { /* no package.json */ }
      if (typesPath) {
        // Exact-match only: a flat barrel .d.ts has many *Props interfaces — falling back
        // to "first *Props wins" would give every component the same wrong props.
        for (const comp of nameOnly) {
          if (comp.props.length === 0) {
            const dtsResult = await extractPropsFromDts(typesPath, comp.name, { exactMatchOnly: true })
            comp.props = dtsResult.props
          }
        }
      }
    }
    return nameOnly
  }

  return []
}

/** Extract component names from a bundled ESM file's export statement */
async function extractExportNames(filePath: string, pkgName: string): Promise<ScannedComponent[]> {
  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return [] }

  const components: ScannedComponent[] = []
  const seen = new Set<string>()

  // Match: export{X as name, Y as name2, ...} — handles minified bundles
  const exportBlockRe = /export\s*\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = exportBlockRe.exec(content)) !== null) {
    for (const token of m[1].split(',')) {
      const trimmed = token.trim()
      if (!trimmed) continue
      // "internalName as exportName" or just "exportName"
      const asMatch = trimmed.match(/(?:\w+\s+as\s+)?(\w+)$/)
      if (!asMatch) continue
      const exportName = asMatch[1]

      // Skip non-component exports: default, type names, camelCase utils, ALL_CAPS constants
      if (exportName === 'default' || exportName === 'install') continue
      if (exportName.endsWith('Props') || exportName.endsWith('Emits')) continue
      if (exportName === exportName.toUpperCase()) continue // CONSTANTS
      if (/^(use|create|get|set|is|has|with|to|from)[A-Z]/.test(exportName)) continue // utility functions
      if (seen.has(exportName)) continue
      seen.add(exportName)

      components.push(makeComponent({ name: pascalCase(exportName), module: pkgName, props: [] }))
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
            if (type.length > 400) type = type.slice(0, 397) + '...'
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

/**
 * AST-based fallback for .d.ts prop extraction. Parses the file with the TypeScript compiler
 * (parser only — no type checker) and walks InterfaceDeclaration members. Handles multi-line
 * types, complex generics, and follows `extends` chains within the same file.
 *
 * Requires `typescript` to be resolvable. Returns empty when it isn't — the caller falls back
 * to regex-based extraction.
 */
async function extractPropsFromDtsViaTs(
  dtsPath: string,
  componentName: string,
  options: { exactMatchOnly?: boolean } = {},
): Promise<{ props: ScannedProp[]; resolvedName: string | null }> {
  let ts: typeof import('typescript')
  try {
    ts = (await import('typescript')).default ?? await import('typescript') as any
  } catch {
    return { props: [], resolvedName: null }
  }

  let content: string
  try { content = await fsp.readFile(dtsPath, 'utf-8') } catch { return { props: [], resolvedName: null } }

  const sf = ts.createSourceFile(dtsPath, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const interfaces = new Map<string, import('typescript').InterfaceDeclaration>()
  const typeAliases = new Map<string, import('typescript').TypeAliasDeclaration>()
  const collect = (node: import('typescript').Node) => {
    if (ts.isInterfaceDeclaration(node) && node.name) interfaces.set(node.name.text, node)
    else if (ts.isTypeAliasDeclaration(node) && node.name) typeAliases.set(node.name.text, node)
    ts.forEachChild(node, collect)
  }
  collect(sf)

  let target = interfaces.get(`${componentName}Props`)
  let resolvedName: string | null = null
  if (!target && !options.exactMatchOnly) {
    for (const [name, iface] of interfaces) {
      if (!name.endsWith('Props')) continue
      if (name.includes('PassThrough') || name.includes('MethodOptions')) continue
      target = iface
      resolvedName = name.replace(/Props$/, '')
      break
    }
  }
  if (!target) return { props: [], resolvedName: null }

  const props: ScannedProp[] = []
  const seen = new Set<string>()
  const fullText = sf.getFullText()

  const simplifyType = (raw: string): string | null => {
    let type = raw.replace(/\s+/g, ' ').trim()
    type = type.replace(/\s*\|\s*undefined/g, '').replace(/undefined\s*\|\s*/g, '')
    type = type.replace(/HintedString<([^>]+)>/g, '$1')
    if (type.length > 400) type = type.slice(0, 397) + '...'
    return type || null
  }

  const readJsDoc = (node: import('typescript').Node): { description: string | null; default: string | null } => {
    const ranges = ts.getLeadingCommentRanges(fullText, node.pos) || []
    for (const range of ranges) {
      const comment = fullText.slice(range.pos, range.end)
      if (!comment.startsWith('/**')) continue
      const defaultMatch = comment.match(/@defaultValue\s+(.+?)(?:\n|\*\/|$)/)
      const def = defaultMatch ? defaultMatch[1].trim().replace(/\s*\*\/$/, '').trim() : null
      const descLine = comment
        .split('\n')
        .map(l => l.replace(/^\s*\/?\*+\/?\s?/, '').trim())
        .filter(l => l && !l.startsWith('@'))[0] ?? null
      return { description: descLine, default: def }
    }
    return { description: null, default: null }
  }

  const visited = new Set<string>()
  const collectMembers = (iface: import('typescript').InterfaceDeclaration) => {
    if (iface.name && visited.has(iface.name.text)) return
    if (iface.name) visited.add(iface.name.text)

    for (const member of iface.members) {
      if (!ts.isPropertySignature(member) || !member.name) continue
      const nameNode = member.name
      const name = ts.isIdentifier(nameNode) || ts.isStringLiteral(nameNode)
        ? nameNode.text
        : null
      if (!name || seen.has(name)) continue
      if (['pt', 'ptOptions', 'unstyled', 'dt'].includes(name)) continue

      const optional = member.questionToken !== undefined
      const typeText = member.type ? simplifyType(member.type.getText(sf)) : null
      const { description, default: def } = readJsDoc(member)
      seen.add(name)
      props.push({ name, type: typeText, required: !optional, description, default: def })
    }

    if (iface.heritageClauses) {
      for (const clause of iface.heritageClauses) {
        if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue
        for (const t of clause.types) {
          const expr = t.expression
          if (!ts.isIdentifier(expr)) continue
          const parentName = expr.text
          if (parentName.includes('PassThrough') || parentName.includes('MethodOptions')) continue
          const parent = interfaces.get(parentName)
          if (parent) collectMembers(parent)
        }
      }
    }
  }
  collectMembers(target)

  return { props, resolvedName }
}

async function extractPropsFromDts(
  dtsPath: string,
  componentName: string,
  options: { exactMatchOnly?: boolean } = {},
): Promise<{ props: ScannedProp[]; resolvedName: string | null }> {
  let content: string
  try { content = await fsp.readFile(dtsPath, 'utf-8') } catch { return { props: [], resolvedName: null } }

  // `export` is optional — bundler outputs (tsup/rollup) often emit `interface FooProps {…}`
  // without `export`, relying on a single `export { … }` block at the bottom of the file.
  let propsInterfaceName = `${componentName}Props`
  let interfaceRegex = new RegExp(`(?:export\\s+)?(?:declare\\s+)?interface\\s+${propsInterfaceName}(?:<[^>]*>)?\\s*(?:extends\\s+[^{]*)?\\{`)
  let match = interfaceRegex.exec(content)

  let resolvedName: string | null = null
  if (!match && !options.exactMatchOnly) {
    // Find any *Props interface (e.g., AutoCompleteProps when dir is "autocomplete").
    // Skipped under exactMatchOnly — a flat barrel .d.ts has many *Props; picking the first is wrong.
    const genericRegex = /(?:export\s+)?(?:declare\s+)?interface\s+(\w+Props)(?:<[^>]*>)?\s*(?:extends\s+[^{]*)?\{/g
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
  }
  if (!match) {
    // Regex found nothing — AST parser is the last resort (handles exotic declarations the regex misses).
    return extractPropsFromDtsViaTs(dtsPath, componentName, options)
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
    if (type.length > 400) type = type.slice(0, 397) + '...'

    props.push({
      name: propName,
      type: type || null,
      required: optional !== '?',
      description,
      default: defaultValue,
    })
  }

  // Fallback: if regex failed to extract anything (e.g. multi-line types, complex generics),
  // try the TypeScript AST parser. Keeps the fast regex path for the 95% case.
  if (props.length === 0) {
    const astResult = await extractPropsFromDtsViaTs(dtsPath, componentName, options)
    if (astResult.props.length > 0) return astResult
  }

  return { props, resolvedName }
}

/** Route props extraction to the right parser based on file extension */
async function extractComponentProps(filePath: string): Promise<ScannedProp[]> {
  const ext = path.extname(filePath)
  if (ext === '.vue') return extractPropsFromVue(filePath)
  if (ext === '.tsx' || ext === '.jsx') return extractPropsFromTsx(filePath)
  if (ext === '.svelte') return extractPropsFromSvelte(filePath)
  return []
}

export interface ExtractedComponentDetails {
  props: ScannedProp[]
  slots: ScannedSlot[]
  events: ScannedEvent[]
  description: string | null
}

/** Extract full component metadata (props + slots + events + description) from a source file. */
async function extractComponentDetails(filePath: string): Promise<ExtractedComponentDetails> {
  const ext = path.extname(filePath)
  const empty: ExtractedComponentDetails = { props: [], slots: [], events: [], description: null }

  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return empty }

  if (ext === '.vue') {
    return {
      props: await extractPropsFromVue(filePath),
      slots: extractSlotsFromVueContent(content),
      events: extractEventsFromVueContent(content),
      description: extractComponentJsDoc(content),
    }
  }
  if (ext === '.tsx' || ext === '.jsx') {
    return {
      props: await extractPropsFromTsx(filePath),
      slots: [],
      events: [],
      description: extractComponentJsDoc(content),
    }
  }
  if (ext === '.svelte') {
    return {
      props: await extractPropsFromSvelte(filePath),
      slots: extractSlotsFromSvelteContent(content),
      events: [],
      description: extractComponentJsDoc(content),
    }
  }
  return empty
}

/** Parse `<slot>` tags from a Vue SFC template. Handles named and scoped slots. */
function extractSlotsFromVueContent(content: string): ScannedSlot[] {
  const template = extractVueTemplate(content)
  if (!template) return []
  const slots: ScannedSlot[] = []
  const seen = new Set<string>()
  const slotRe = /<slot\b([^>]*?)\/?>/g
  let m: RegExpExecArray | null
  while ((m = slotRe.exec(template)) !== null) {
    const attrs = m[1]
    const nameMatch = attrs.match(/\bname\s*=\s*["']([^"']+)["']/)
    const name = nameMatch ? nameMatch[1] : 'default'
    if (seen.has(name)) continue
    seen.add(name)
    // Scoped if there's any attr beyond `name` (e.g. :row, :item, v-bind)
    const scoped = /\s[:v-]|\s[a-z-]+\s*=/i.test(attrs.replace(/\bname\s*=\s*["'][^"']+["']/, ''))
    slots.push({ name, description: null, scoped })
  }
  return slots
}

/** Extract the <template>…</template> block from a Vue SFC. */
function extractVueTemplate(content: string): string | null {
  const m = content.match(/<template[^>]*>([\s\S]*?)<\/template>/)
  return m ? m[1] : null
}

/** Parse emitted events from a Vue SFC — defineEmits<T>(), defineEmits(['x']), Options API emits. */
function extractEventsFromVueContent(content: string): ScannedEvent[] {
  const events: ScannedEvent[] = []
  const seen = new Set<string>()
  const push = (name: string, payloadType: string | null = null, description: string | null = null) => {
    if (!name || seen.has(name)) return
    seen.add(name)
    events.push({ name, payloadType, description })
  }

  // defineEmits<{ 'name': [payload: T] }>() OR defineEmits<{ (e: 'name', payload: T): void }>()
  const genericMatch = content.match(/defineEmits\s*<\s*([\s\S]*?)\s*>\s*\(/)
  if (genericMatch) {
    const body = genericMatch[1]
    // Array-tuple form: 'name' OR bare-identifier name followed by `: [arg1: T, …]`
    const tupleRe = /(?:['"]([\w:-]+)['"]|(\w+))\s*:\s*\[([^\]]*)\]/g
    let m: RegExpExecArray | null
    while ((m = tupleRe.exec(body)) !== null) {
      const name = m[1] ?? m[2]
      push(name, (m[3] || '').trim() || null)
    }
    // Call-signature form: (e: 'name', payload: T): void
    const callRe = /\(\s*\w+\s*:\s*['"]([\w:-]+)['"]\s*(?:,\s*([^)]*))?\)\s*(?:=>|:)\s*(?:void|any)/g
    while ((m = callRe.exec(body)) !== null) push(m[1], (m[2] || '').trim() || null)
  }

  // defineEmits(['name', 'other']) — array literal
  const arrayMatch = content.match(/defineEmits\s*\(\s*\[([\s\S]*?)\]\s*\)/)
  if (arrayMatch) {
    const listRe = /['"]([\w:-]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = listRe.exec(arrayMatch[1])) !== null) push(m[1])
  }

  // Options API: emits: ['name', ...] or emits: { name: null | validator }
  const optsArray = content.match(/\bemits\s*:\s*\[([\s\S]*?)\]/)
  if (optsArray) {
    const listRe = /['"]([\w:-]+)['"]/g
    let m: RegExpExecArray | null
    while ((m = listRe.exec(optsArray[1])) !== null) push(m[1])
  }
  const optsObj = content.match(/\bemits\s*:\s*\{([\s\S]*?)\n\s*\}/)
  if (optsObj) {
    const keyRe = /^\s*['"]?([\w:-]+)['"]?\s*:/gm
    let m: RegExpExecArray | null
    while ((m = keyRe.exec(optsObj[1])) !== null) push(m[1])
  }

  // Fallback: emit('name') / this.$emit('name') calls
  const emitCallRe = /(?:this\.\$emit|\bemit)\s*\(\s*['"]([\w:-]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = emitCallRe.exec(content)) !== null) push(m[1])

  return events
}

/** Extract slot names from a Svelte file — `<slot name="..."></slot>` */
function extractSlotsFromSvelteContent(content: string): ScannedSlot[] {
  const slots: ScannedSlot[] = []
  const seen = new Set<string>()
  const slotRe = /<slot\b([^>]*?)\/?>/g
  let m: RegExpExecArray | null
  while ((m = slotRe.exec(content)) !== null) {
    const attrs = m[1]
    const nameMatch = attrs.match(/\bname\s*=\s*["']([^"']+)["']/)
    const name = nameMatch ? nameMatch[1] : 'default'
    if (seen.has(name)) continue
    seen.add(name)
    const scoped = /\s[a-z-]+\s*=\s*["']?\{/i.test(attrs)
    slots.push({ name, description: null, scoped })
  }
  return slots
}

/** Extract a component-level JSDoc description from the first JSDoc block in the source. */
function extractComponentJsDoc(content: string): string | null {
  const m = content.match(/\/\*\*\s*\n([\s\S]*?)\*\//)
  if (!m) return null
  const first = m[1]
    .split('\n')
    .map(l => l.replace(/^\s*\*\s?/, '').trim())
    .filter(l => l && !l.startsWith('@'))[0]
  return first ?? null
}

async function extractPropsFromVue(vuePath: string): Promise<ScannedProp[]> {
  let content: string
  try { content = await fsp.readFile(vuePath, 'utf-8') } catch { return [] }

  let props: ScannedProp[] = []

  // Strategy A: defineProps<InterfaceName>() with TypeScript interface
  props = extractPropsFromTsInterface(content)

  // Strategy B: defineProps({ prop: { type: String, ... } }) — object literal
  if (props.length === 0) {
    const definePropsObj = content.match(/defineProps\s*\(\s*\{([\s\S]*?)\}\s*\)/)
    if (definePropsObj) {
      props = parseObjectProps(definePropsObj[1])
    }
  }

  // Strategy C: Options API props: { ... }
  if (props.length === 0) {
    const propsMatch = content.match(/props:\s*\{([\s\S]*?)\n\s*\}/)
    if (propsMatch) {
      props = parseObjectProps(propsMatch[1])
    }
  }

  return props
}

/** Extract props from a React .tsx/.jsx component file */
async function extractPropsFromTsx(filePath: string): Promise<ScannedProp[]> {
  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return [] }

  // Look for Props/XProps interface or type used in component function
  // Pattern: function Component(props: Props) or (props: ComponentProps)
  // Pattern: const Component: React.FC<Props>
  // Pattern: export default function Component({ prop1, prop2 }: Props)
  const propsTypeMatch = content.match(
    /(?:function\s+\w+|const\s+\w+\s*(?::\s*React\.FC)?)\s*(?:<[^>]*>)?\s*\(\s*(?:\{[^}]*\}\s*:\s*|(?:props)\s*:\s*)(\w+)/
  )

  if (propsTypeMatch) {
    return extractPropsFromTsInterface(content, propsTypeMatch[1])
  }

  // Fallback: look for any exported Props-like interface
  return extractPropsFromTsInterface(content)
}

/** Extract props from a Svelte component file */
async function extractPropsFromSvelte(filePath: string): Promise<ScannedProp[]> {
  let content: string
  try { content = await fsp.readFile(filePath, 'utf-8') } catch { return [] }

  const props: ScannedProp[] = []

  // Svelte 4: optional JSDoc + export let propName: Type = default
  // The JSDoc lookbehind captures the preceding /** ... */ block so the description attaches
  // to the right prop (one comment per prop is the idiomatic pattern).
  const exportLetRe = /(\/\*\*\s*([\s\S]*?)\s*\*\/\s*)?export\s+let\s+(\w+)\s*(?::\s*([^=;\n]+))?\s*(?:=\s*([^;\n]+))?/g
  let m: RegExpExecArray | null
  while ((m = exportLetRe.exec(content)) !== null) {
    const [, , jsdocBody, propName, rawType, rawDefault] = m
    let type = rawType?.trim() ?? null
    if (type && type.length > 400) type = type.slice(0, 397) + '...'
    let def: string | null = rawDefault?.trim() ?? null
    if (def === 'undefined') def = null

    let description: string | null = null
    if (jsdocBody) {
      const descLine = jsdocBody
        .split('\n')
        .map(l => l.replace(/^\s*\*\s?/, '').trim())
        .filter(l => l && !l.startsWith('@'))[0] ?? null
      description = descLine
    }

    props.push({ name: propName, type, required: !rawDefault, description, default: def })
  }

  // Svelte 5: interface Props { ... } with $props()
  if (props.length === 0) {
    const svelte5 = extractPropsFromTsInterface(content)
    if (svelte5.length > 0) return svelte5
  }

  return props
}

/**
 * Extract props from a TypeScript interface in source code.
 * Works for: defineProps<Props>(), React FC<Props>, Svelte 5 $props<Props>().
 * If `interfaceName` is given, look for that specific interface.
 * Otherwise, find the interface referenced by defineProps<X>() or $props<X>().
 */
function extractPropsFromTsInterface(content: string, interfaceName?: string): ScannedProp[] {
  // Auto-detect interface name from defineProps<X>() or $props<X>()
  if (!interfaceName) {
    const genericMatch = content.match(/(?:defineProps|props)\s*<\s*(\w+)\s*>/)
    if (!genericMatch) return []
    interfaceName = genericMatch[1]
  }

  // Find the interface body
  const interfaceRegex = new RegExp(
    `(?:interface|type)\\s+${interfaceName}\\s*(?:=\\s*)?(?:extends\\s+[^{]*)?\\{([\\s\\S]*?)\\n\\s*\\}`
  )
  const interfaceMatch = content.match(interfaceRegex)
  if (!interfaceMatch) return []

  const body = interfaceMatch[1]
  const props: ScannedProp[] = []

  // Match: propName?: Type (one per line)
  const propLineRegex = /^\s*(\w+)(\??):\s*(.+)/gm
  let m: RegExpExecArray | null
  while ((m = propLineRegex.exec(body)) !== null) {
    let type = m[3].replace(/[;,]\s*$/, '').replace(/\/\/.*$/, '').trim()
    if (type.length > 400) type = type.slice(0, 397) + '...'
    props.push({ name: m[1], type: type || null, required: m[2] !== '?', description: null, default: null })
  }

  // Extract defaults from withDefaults(defineProps<X>(), { ... })
  const defaultsMatch = content.match(/withDefaults\s*\(\s*defineProps<\w+>\s*\(\)\s*,\s*\{([\s\S]*?)\}\s*\)/)
  if (defaultsMatch && props.length > 0) {
    const defaultLineRegex = /^\s*(\w+):\s*(.+?)(?:,\s*$|$)/gm
    let dm: RegExpExecArray | null
    while ((dm = defaultLineRegex.exec(defaultsMatch[1])) !== null) {
      const prop = props.find(p => p.name === dm![1])
      if (prop) {
        const val = dm[2].trim().replace(/,\s*$/, '')
        if (!val.startsWith('(') && val !== 'undefined') prop.default = val
      }
    }
  }

  return props
}

/** Parse Options-API-style props: { name: { type: X, required: Y, default: Z } } or shorthand { name: Type } */
function parseObjectProps(body: string): ScannedProp[] {
  const props: ScannedProp[] = []

  // Full form: propName: { type: String, required: true, default: 'x' }
  const fullPropRe = /(\w+):\s*\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = fullPropRe.exec(body)) !== null) {
    const propDef = m[2]
    const typeMatch = propDef.match(/type:\s*(\w+)/)
    const requiredMatch = propDef.match(/required:\s*(true|false)/)
    const defaultMatch = propDef.match(/default:\s*(.+?)(?:,|\s*$)/)
    props.push({
      name: m[1],
      type: typeMatch ? typeMatch[1] : null,
      required: requiredMatch ? requiredMatch[1] === 'true' : false,
      description: null,
      default: defaultMatch ? defaultMatch[1].trim() : null,
    })
  }

  // Shorthand: propName: String  (no braces)
  if (props.length === 0) {
    const shorthandRe = /(\w+):\s*(String|Number|Boolean|Array|Object|Function|Date|Symbol)/g
    while ((m = shorthandRe.exec(body)) !== null) {
      props.push({ name: m[1], type: m[2], required: false, description: null, default: null })
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
  // Try any .vue file — historically Base*.vue was skipped (assumed abstract), but that's wrong:
  // real component libs use BaseButton.vue etc. as the concrete component file.
  try {
    const files = await fsp.readdir(dir)
    const vue = files.find(f => f.endsWith('.vue'))
    return vue ? path.join(dir, vue) : null
  } catch { return null }
}

/**
 * Test-only surface. Not part of the public API — the `__` prefix signals this.
 * Consumers should use scanComponentLibraries() / generateComponentManifest() only.
 */
export const __testInternals__ = {
  extractPropsFromDts,
  extractPropsFromDtsViaTs,
  extractSlotsFromVueContent,
  extractEventsFromVueContent,
  extractComponentJsDoc,
  scanFromCem,
  categorizeComponent,
  findVueFile,
}
