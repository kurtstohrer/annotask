# Component Discovery

Annotask automatically detects component libraries installed in your project and extracts their component names, props, types, defaults, **slots, events, category, and component-level descriptions**. The data drives the shell's Libraries page (with live component previews) and is available to agents via the `annotask_get_components` / `annotask_get_component` MCP tools.

## Discovered fields

Every component entry contains:

```ts
{
  name: string                // 'Button'
  module: string              // 'primevue/button' — what agents import from
  description: string | null  // Component-level JSDoc, one-line
  category: string | null     // Heuristic: 'button' | 'form' | 'overlay' | 'layout' | ...
  tags: string[]              // Reserved for future heuristics
  deprecated: boolean
  props: { name, type, required, default, description }[]
  slots: { name, description, scoped }[]  // 'default' for the default slot
  events: { name, payloadType, description }[]
  sourceFile: string | null   // Populated only for local components
}
```

Slots and events are extracted from `.vue` source files alongside the existing `.d.ts` prop extraction — so PrimeVue components show up with 0–10 slots and 0–40 events without any config.

## Category heuristic

The scanner assigns a rough category based on the component name + module path. Matching is first-hit-wins against these patterns:

| Category | Matches |
|----------|---------|
| `button` | `button`, `btn` |
| `form` | `input`, `textfield`, `textarea`, `select`, `radio`, `checkbox`, `switch`, `slider`, `form`, `picker` |
| `overlay` | `dialog`, `modal`, `drawer`, `popover`, `tooltip`, `menu`, `dropdown`, `overlay`, `sheet` |
| `data` | `table`, `datatable`, `datagrid`, `list`, `tree` |
| `container` | `card`, `panel`, `tab`, `accordion`, `collapse`, `splitter` |
| `navigation` | `nav`, `breadcrumb`, `sidebar`, `menubar`, `pagination`, `stepper` |
| `feedback` | `alert`, `toast`, `banner`, `notification`, `message`, `badge`, `tag`, `chip` |
| `display` | `avatar`, `icon`, `image`, `img`, `skeleton`, `spinner`, `progress`, `loader` |
| `layout` | `grid`, `flex`, `stack`, `row`, `col`, `column`, `container`, `layout`, `section` |
| `chart` | `chart`, `graph`, `plot`, `sparkline` |

Agents use `category` to narrow "find me a button-ish thing" down to just button-ish components without scanning the full library.

## How it works

When the API or MCP tool is called, Annotask reads your project's `package.json`, iterates every dependency, and runs three detection strategies in order. The first strategy that finds components wins.

### Strategy 1: Subdirectory scan

For libraries like **PrimeVue** that expose each component as a top-level subdirectory with its own entry point:

```
node_modules/primevue/
  button/
    index.mjs       ← importable entry
    index.d.ts      ← props extracted from *Props interface
  datatable/
    index.mjs
    index.d.ts
  ...
```

The scanner walks each subdirectory looking for `index.mjs`, `index.js`, or `.vue` files. Props are extracted from `index.d.ts` (TypeScript interface) or from the `.vue` file directly.

**Skipped directories:** `src`, `dist`, `lib`, `es`, `cjs`, `esm`, `node_modules`, `utils`, `helpers`, `types`, `core`, `icons`, `themes`, `locale`, `config`, `passthrough`, `examples`, `tests`, `test`, `docs`, `stories`, `storybook-static`, `__tests__`, `__mocks__`, and anything starting with `.`.

### Strategy 2: Barrel `.d.ts` exports

For libraries like **Radix Vue** that export all components from a single TypeScript declaration barrel:

```
node_modules/@radix-ui/themes/
  dist/esm/components/
    index.d.ts              ← export { Button } from './button.js'
    button.d.ts             ← ButtonProps interface
    button.props.d.ts       ← propDefs object (Radix pattern)
```

The scanner checks these barrel paths in order:
1. `dist/esm/components/index.d.ts`
2. `dist/components/index.d.ts`
3. `src/components/index.d.ts`
4. `components/index.d.ts`

It parses `export { Name } from './file'` lines, then reads per-component `.d.ts` files for `*Props` interfaces or `.props.d.ts` files for Radix-style `propDefs` objects.

### Strategy 3: Entry-point-driven scan

For **custom libraries** and any package not matched by strategies 1 or 2. This is the most flexible strategy — it reads the package's own `package.json` to find the entry point and follows re-export chains to discover components.

#### Entry point resolution

The scanner reads the library's `package.json` and checks these fields in order:

1. `source` — explicit source entry (highest priority)
2. `exports["."].import` / `exports["."].default` — modern package exports
3. `module` — ESM entry
4. `main` — CJS entry

For each, it tries to map the dist path back to a source equivalent:

```
dist/index.js     →  src/index.ts, src/index.js
dist/lib/index.js →  src/lib/index.ts, lib/index.ts
```

If no source equivalent exists, it checks common fallback locations:

```
src/components/index.{ts,js}
src/index.{ts,js}
components/index.{ts,js}
lib/index.{ts,js}
index.{ts,js}
```

As a last resort, it uses the dist entry directly (for bundled export name extraction).

#### Module resolution

Bare specifiers are resolved with extension probing and directory index fallback:

```
./Button  →  ./Button.vue, ./Button.tsx, ./Button.ts, ./Button.js
          →  ./Button/index.vue, ./Button/index.ts, ./Button/index.js
          →  ./Button/Button.vue  (same-name convention)
```

Supported extensions: `.vue`, `.tsx`, `.jsx`, `.ts`, `.js`, `.mjs`, `.svelte`

#### Re-export chain following

The scanner parses these import/export patterns and follows local references up to 4 levels deep:

```js
// Direct default import + named re-export
import Button from './components/Button.vue'
export { Button }

// Named re-export
export { Button } from './components/Button'
export { default as Button } from './components/Button.vue'

// Star re-export (recurses into the target file)
export * from './components'
```

Cycle detection prevents infinite loops. External package imports are ignored.

#### `file:` dependency resolution

When a dependency is installed via `file:` protocol (local/linked packages), package managers like pnpm respect the `files` field in the library's `package.json` — so `node_modules` may only contain `dist/` even though the full source exists on disk.

The scanner detects `file:` specifiers and resolves back to the original source directory for full prop extraction:

```json
{
  "dependencies": {
    "my-lib": "file:../libs/my-component-library"
  }
}
```

This gives the scanner access to `.vue` source files for complete prop extraction, even when the installed copy only has bundled output.

#### Bundled file fallback

When only a bundled dist file is available (no source), the scanner extracts component names from the ESM export statement:

```js
// Minified bundle ending:
export{Zu as alertBanner, lu as base64Editor, Au as box, ...}
```

This provides component names and import paths but no prop definitions. The scanner filters out non-component exports by skipping:
- `default`, `install`
- Names ending in `Props` or `Emits`
- `ALL_CAPS` constants
- Utility function prefixes (`use*`, `create*`, `get*`, `set*`, `is*`, `has*`, `with*`, `to*`, `from*`)

## Props extraction

Props are extracted differently depending on the source file type.

### Vue (`.vue`)

Three patterns, tried in order:

**A. `defineProps<Interface>()` with TypeScript interface** (Composition API)

```vue
<script setup lang="ts">
interface Props {
  label?: string
  count: number
  disabled?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  label: '',
  disabled: false,
})
</script>
```

Extracts: name, type, required (from `?`), defaults (from `withDefaults`).

**B. `defineProps({...})` object literal** (Composition API)

```vue
<script setup>
defineProps({
  label: { type: String, required: true, default: '' },
  count: { type: Number },
})
</script>
```

**C. Options API `props: {...}`**

```js
export default {
  props: {
    label: { type: String, required: true },
    count: Number,  // shorthand
  }
}
```

### Vue slots and events

Alongside props, the scanner parses any `.vue` source it finds for:

- **Slots** — every `<slot>` or `<slot name="…">` in the template. Scoped slots are flagged when the slot tag carries any non-`name` attribute (e.g. `<slot name="row" :row="row">`).
- **Events** — `defineEmits<T>()`, `defineEmits(['name'])`, Options API `emits: [...]` / `emits: { name }`, and fallback detection of `emit('name')` / `this.$emit('name')` calls.

This runs even when `.d.ts` is the primary source for props — you get the full picture when both are available.

### React (`.tsx` / `.jsx`)

Looks for a TypeScript interface referenced by the component function:

```tsx
interface ButtonProps {
  label: string
  onClick?: () => void
  disabled?: boolean
}

export function Button(props: ButtonProps) { ... }
// or: export function Button({ label, onClick }: ButtonProps) { ... }
// or: const Button: React.FC<ButtonProps> = (props) => { ... }
```

### Svelte (`.svelte`)

**Svelte 4:** `export let` declarations

```svelte
<script lang="ts">
  export let label: string
  export let count: number = 0
  export let disabled: boolean = false
</script>
```

**Svelte 5:** `$props<Interface>()` with TypeScript interface (same parser as Vue's `defineProps<Interface>()`).

## Filtering

A detected package must pass two filters to appear in the component catalog:

1. **Minimum 3 components** — packages with fewer are likely not component libraries
2. **Props or framework dependency** — at least one component must have extractable props, OR the package must list `vue`, `react`, `react-dom`, `svelte`, or `@angular/core` as a dependency or peer dependency. This prevents utility packages (lodash, ajv, marked) from appearing as component libraries when their exports happen to pass the name extraction.

## TypeScript Compiler API fallback

When the `.d.ts` regex extractor finds zero props but the file exists, the scanner falls back to a **TypeScript Compiler API parser** that walks the AST directly. This kicks in for:

- Complex generics: `DataTableProps<T extends Record<string, unknown> = any>`
- Multi-line property types: `options: Array<{ label: string; value: string }>`
- Nested intersection types and mapped types
- Interfaces that `extends` other `*Props` interfaces in the same file (inherited members are flattened in)

The TypeScript package is loaded dynamically via `await import('typescript')`. It's externalized in the Annotask bundle, so projects without TypeScript installed (rare) silently skip the fallback and continue with regex-only extraction. No install-time cost for users who already have TS.

## Shell UI

The shell's Libraries page shows each discovered component with:

- A prop table (name · type · req · default · value-editor).
- Toggle to JSON or YAML view of the same data (syntax-highlighted via the theme's `--syntax-*` vars).
- Slot and event lists.
- A generated code snippet that reflects the current prop values.
- An "Insert as task" button that creates an `annotation` task containing the snippet.

No live iframe render — component metadata is the product, not interactive preview. (An earlier version shipped a preview iframe but was removed due to framework-config brittleness; prop editing still works, it just produces snippets rather than live DOM.)

## Caching

Results are cached in memory for the lifetime of the dev server. The cache is cleared when the server restarts. There is no file-watching on `node_modules` — if you install a new component library, restart the dev server.

## API access

### HTTP

```bash
curl http://localhost:5173/__annotask/api/components
```

### MCP

```
annotask_get_components          # List (summaries by default; set detail=true for full data)
annotask_get_component           # Full detail for one component by name
```

`annotask_get_components` accepts:

| Param | Description |
|-------|-------------|
| `search` | Case-insensitive substring match on component name |
| `library` | Exact library name (e.g. `"primevue"`) |
| `category` | Heuristic category (`"button"`, `"form"`, `"overlay"`, …) |
| `used_only` | When `true`, restrict to components actually imported in this codebase (from design-spec's `components.used` list). **Highest-signal filter for agents.** |
| `detail` | Include full props/slots/events/description bodies. Default `false` returns compact summaries. |
| `limit` | Max results per library. Default 50, max 500. Was previously a silent cap of 20. |
| `offset` | Skip the first N results (pagination). |

`annotask_get_component` accepts `{ name, library? }`. If `name` matches multiple libraries and `library` isn't given, the response returns `{ ambiguous: true, candidates: [...] }` so the agent can pick.

### CLI

```bash
annotask components              # List all libraries and component counts
annotask components Button       # Filter by name
annotask component Button        # Show detailed props for one component
annotask component Button --json # Props as JSON
```

## Response format

```json
{
  "libraries": [
    {
      "name": "primevue",
      "version": "4.5.4",
      "components": [
        {
          "name": "Button",
          "module": "primevue/button",
          "props": [
            {
              "name": "label",
              "type": "string",
              "required": false,
              "description": "Text of the button",
              "default": "null"
            }
          ]
        }
      ]
    }
  ],
  "scannedAt": 1712000000000
}
```

The `module` field tells you where to import the component from. For subdirectory libraries (PrimeVue), it's `packageName/subdirectory`. For barrel-exported libraries, it's just `packageName`.
