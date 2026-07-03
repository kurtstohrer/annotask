# Component Discovery

Annotask scans installed component libraries and builds a catalog used by:

- Design > Components in the shell
- `GET /__annotask/api/components`
- `GET /__annotask/api/project-components` — the project's own `src/` components, scanned separately (see "Workspace Behavior")
- `annotask_get_components`
- `annotask_get_component`
- `annotask_get_component_examples`
- the `annotask components`, `component`, and `component-examples` CLI commands

The scanner is scoped to the **running package only** — a Vue app started directly no longer inherits a sibling React MFE's Mantine/Kobalte/Shoelace libraries just because they live in the same monorepo. This was a deliberate fix: aggregating every workspace package made a standalone app's catalog list UI kits it can never actually render. See "Workspace Behavior" below for what workspace-awareness now means in practice.

## What Gets Extracted

Each component entry can include:

```ts
{
  name: string
  module: string
  description: string | null
  category: string | null
  tags: string[]
  deprecated: boolean
  props: { name, type, required, default, description }[]
  slots: { name, description, scoped }[]
  events: { name, payloadType, description }[]
  sourceFile: string | null
  providerSignals: string[]         // useContext/inject/useRouter/useQuery/… markers found in source
  fidelityHint: 'live' | 'isolated-preview' | 'placeholder' | 'unknown'
  extraction?: 'cem' | 'dts' | 'dts-guessed' | 'source' | 'name-only'
}
```

Current scanner output covers:

- library components from dependencies
- local source-backed metadata where available
- Vue slot and emit extraction when `.vue` sources are reachable
- description and deprecation signals when they can be inferred from declarations
- native web components registered via `customElements.define(...)`, in addition to `defineComponent`/`.component(`/`createComponent` signals

### `extraction` — telling failure apart from "verified propless"

An empty `props: []` array is ambiguous on its own: it could mean the component genuinely takes no props, or it could mean extraction simply failed. `extraction` disambiguates:

| Value | Meaning |
|-------|---------|
| `cem` | Read from a Custom Elements Manifest (`custom-elements.json`) — standardized JSON, no regex/AST, very reliable |
| `dts` | Exact `<Name>Props` interface match in a `.d.ts` |
| `dts-guessed` | The barrel had no exact-named interface, so the scanner took the first `*Props` interface in that file (only used where an exact match wasn't found — see the barrel-fallback note below) |
| `source` | Parsed from the component's own source (`.vue`/`.tsx`/`.jsx`/`.svelte`/`.astro`) |
| `name-only` | The export name was confirmed, but its shape was never read — `props: []` here means **extraction failed**, not "no props" |

Treat `props: []` with `extraction: 'name-only'` as "unknown," not "propless." The shell's Components page and palette read this field to show an honest "props unknown" state instead of implying a component takes no props.

`fidelityHint` is derived, not just from whether source was read: it drops to `'unknown'` whenever `extraction` is `'name-only'` (no real confidence to assert `'live'` from), and — because `/__annotask/preview-module` is Vite-only and hard-404s under webpack — it also drops to `'unknown'` for every component when the project's bundler is detected as webpack, regardless of extraction quality.

## Current Shell UX

The Design > Components page is list-and-detail based.

Current filters:

- `All`
- `Used`
- `On page`
- free-text filter by component name or module
- MFE filter when workspace MFEs are present

Current detail pane shows:

- import path
- category
- props
- slots
- events
- in-repo usage sites from `annotask_get_component_examples`

Annotask no longer tries to render live component previews in an iframe. The product is the metadata catalog plus grounded usage examples.

## Workspace Behavior

Both `scanComponentLibraries()` (node_modules libraries) and `scanProjectComponents()` (the project's own `src/` components) read only the **running package's** own `package.json`/`src/` — they do not walk sibling workspace packages. Run an MFE directly and you see exactly that MFE's own libraries and components; you do not automatically see a sibling MFE's UI kit or components, even in a monorepo. This is intentional: aggregating every workspace package used to make a plain Vue app's catalog list React's Mantine, Solid's Kobalte, web-component Shoelace, etc. — libraries it can never actually render.

Two narrower exceptions:

- **MCP only** — `annotask_get_components` / `annotask_get_component` accept an `mfe` parameter that redirects the *project-components* scan to a specific sibling workspace package (resolved via the workspace catalog), so an agent can explicitly ask "what does package X have in its own `src/`?" This does not extend to node_modules libraries, which always reflect only the currently running package's dependencies. It also isn't available over HTTP (`GET /api/components`, `GET /api/project-components`) or the `annotask components`/`component` CLI commands, which read the plain node_modules catalog with no MFE scoping.
- **Display only** — file paths in the catalogs are relativized against the workspace root (not `projectRoot`) purely so they line up with the shell's `useWorkspace()` MFE-id mapping and the on-page "current MFE" filter; this does not widen what gets scanned.

The shell's `useWorkspace()` composable maps a component's `sourceFile` back to an MFE id (when the running package itself has an MFE-nested structure) and drives the "renderable on this surface" badge — but it cannot surface a component that was never scanned in the first place.

## Scanner Strategies

The scanner tries a few strategies, roughly in order, and merges what each one finds (deduped by name) rather than stopping at the first one that produces anything.

### 0. Custom Elements Manifest (CEM)

For web-component libraries (Shoelace, Fluent UI, Ionic, most Lit-based libraries): reads `custom-elements.json` (or the path in `package.json`'s `customElements` field) and extracts each class declaration that registers a custom element directly from the standardized JSON schema — no regex or AST needed, and the most reliable of all the strategies (`extraction: 'cem'`). When this strategy finds components for a package, the other strategies are skipped for it.

### 1. Package Subdirectory Scans

Good for libraries like PrimeVue where each component lives in its own directory with an importable entry and declaration file. Tries the per-component `.d.ts` first, falls back to parsing the `.vue` source for slots/events even when the `.d.ts` already supplied props.

### 2. Barrel Declaration Scans

Good for libraries that expose components through `index.d.ts` barrels and per-component declaration files (Radix, Mantine, naive-ui, bits-ui). Tries a `.props.d.ts` sibling first, then follows one-hop re-export forwarders (`export * from './Button'`) to reach the file that actually declares `FooProps`.

For libraries that expose everything from a single **flat** barrel with no per-file re-exports (notably icon packs like `lucide-vue-next`, which can run to thousands of exports in one multi-MB `.d.ts`), the scanner only ever accepts an *exact* `<Name>Props` interface match — it will not fall back to "the first `*Props` interface in the file," which would otherwise hand every component the same wrong props. Barrels above a size/export budget (500 KB or 300+ exports) skip prop extraction entirely and land `name-only` rather than parsing a multi-MB file per export.

### 3. Entry-Point-Driven Resolution

Fallback path for custom libraries and less structured packages. This path follows local re-export chains and can resolve `file:` dependencies back to their original source directories when package-manager installs only contain bundled output. When it bottoms out at a compiled `.mjs`/`.cjs`/`.js` module with no further exports to follow, it now also checks for a sibling `.d.ts` with the same basename before giving up to `name-only`.

### 4. Bundled Export Fallback

When only bundled dist output is available, the scanner can still recover exported component names from the entry point's export statement and then try to hydrate props from package types (`.d.ts`). Export names that aren't PascalCase to begin with are rejected outright (previously any lowercase utility export — e.g. a hooks package's `clamp`, `randomId` — could get PascalCased into a fabricated "component").

## Prop, Slot, And Event Extraction

Supported patterns include:

- Vue `defineProps<T>()`, `defineProps({ ... })`, Options API `props` (including nested-brace-safe parsing of `default: () => ({...})`-style factory defaults)
- Vue `withDefaults(defineProps<T>(), { ... })` — including generic-parameter interfaces (`defineProps<Props<T>>()`) and multi-prop single-line default blocks
- Vue `defineEmits()`, `emits`, and fallback emit-call detection
- React/Solid `.tsx`/`.jsx`: `React.FC<Props>`/`FunctionComponent<Props>` binding annotations, `forwardRef<Ref, Props>` generics and forwardRef's inline `(props: Props, ref)` form, and any function/arrow head with a typed first parameter regardless of the parameter's own name (covers Solid's `mergeProps`/renamed-param idiom, not just a parameter literally called `props`) — plus destructuring defaults (`{ count = 3 }`) layered onto the typed props
- Svelte 4 `export let`, and Svelte 5 runes (`let { a, b = 1 }: Props = $props()`, including the untyped destructuring-only form when there's no `Props` type at all)
- Astro frontmatter `interface Props { ... }` / `type Props = { ... }`, plus `<slot>` / `<slot name="...">` parsing from the template body
- native web components (`customElements.define(...)`) recognized as components in project scans; prop/slot/event *data* for these still comes from a CEM manifest when one exists, not from ad hoc source parsing
- declaration-file interface extraction, including generic-parameter interfaces (`interface FooProps<T>`) and quoted prop names (`'aria-label': string`)
- a TypeScript-compiler fallback for complex `.d.ts` prop shapes, now preferred over a structurally-incomplete regex match (not just tried when the regex found nothing) — so `extends` heritage chains and quoted names aren't silently dropped by a partial regex "success"

Coverage gaps that remain: `.mjs`/`.cjs` compiled output with no sibling `.d.ts` still yields `name-only`; a component's props are only as good as whatever strategy actually produced them — check `extraction` before treating a short prop list as complete.

## Category Heuristic

The current category heuristic maps names and module paths into buckets such as:

- `button`
- `form`
- `overlay`
- `data`
- `container`
- `navigation`
- `feedback`
- `display`
- `layout`
- `chart`

This is used heavily by agents when they need to find an existing button-ish, form-ish, or layout-ish component quickly.

## Caching

Component scans are cached in memory with a 5-minute TTL and concurrent scans are coalesced behind one in-flight promise. `GET /api/components` and `GET /api/project-components` both accept `?refresh=1` (or `?refresh=true`) to bypass the cache and force a rescan before responding — without it, a component deleted from disk keeps being served as live for the remainder of the TTL. `scannedAt` on the returned catalog is stamped at scan time, not at request time, so a fresh-looking timestamp always means the catalog was actually rebuilt then.

There is also a non-blocking cached access path used for best-effort task enrichment: if the catalog is cold, Annotask can start the scan in the background and skip the enrichment for that request.

## HTTP, MCP, And CLI Access

### HTTP

```bash
curl http://localhost:5173/__annotask/api/components
curl "http://localhost:5173/__annotask/api/components?refresh=1"
curl http://localhost:5173/__annotask/api/component-examples/Button?limit=5
curl http://localhost:5173/__annotask/api/project-components
```

`GET /api/components` and `GET /api/project-components` are separate catalogs — the former is node_modules libraries only, the latter is the project's own `src/` components (the shell's pinned "Project" palette group). Neither endpoint takes an `mfe` parameter; both always reflect the currently running package.

### MCP

- `annotask_get_components` — unlike the HTTP endpoint, this merges node_modules libraries **and** the project's own `src/` components (surfaced as library `"Project"`) into one result
- `annotask_get_component`
- `annotask_get_component_examples`

`annotask_get_components` supports:

- `search`
- `library` (pass `"Project"` to scope to local components)
- `category`
- `used_only` — backed by the live component-usage index (an actual `<Foo>`/import hit somewhere in `src/`), **not** `design-spec.components.used`, which is frequently empty and would otherwise reject every component
- `mfe` — scopes the *Project* library to one sibling workspace package by its configured MFE id; has no effect on node_modules libraries
- `detail`
- `limit`
- `offset`

`annotask_get_component` supports the same `library` and `mfe` parameters for disambiguation.

### CLI

```bash
annotask components
annotask components Button --mcp
annotask component Button --library=primevue --mcp
annotask component-examples Button --limit=5 --mcp
```

The CLI's `components`/`component` commands read `GET /api/components` directly — they do **not** include the project's own `src/` components and have no `mfe` scoping. Use the MCP tools (or `GET /api/project-components`) for those.

## When Agents Should Use It

Reach for the component catalog when a task asks to:

- add new UI
- replace raw HTML with an existing design-system component
- match project conventions for props or imports
- understand whether a component is already used on the current route or elsewhere in the repo

Prefer `used_only=true` over guessing from `design-spec.components.used` — the latter is often empty and, unlike `used_only`, gives no signal either way. When a component's `props` array is empty, check `extraction` before assuming it's genuinely propless: `name-only` means the scanner never actually read the component's shape.
