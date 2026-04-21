# Component Discovery

Annotask scans installed component libraries and builds a catalog used by:

- Design > Components in the shell
- `GET /__annotask/api/components`
- `annotask_get_components`
- `annotask_get_component`
- `annotask_get_component_examples`
- the `annotask components`, `component`, and `component-examples` CLI commands

The scanner is workspace-aware, so in monorepos it can aggregate libraries used by sibling packages and MFEs rather than only the current package.

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
}
```

Current scanner output covers:

- library components from dependencies
- local source-backed metadata where available
- Vue slot and emit extraction when `.vue` sources are reachable
- description and deprecation signals when they can be inferred from declarations

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

`scanComponentLibraries()` uses `resolveWorkspace()` to aggregate dependencies across workspace packages. That means a root shell can expose component libraries used only by sibling MFEs.

The shell's `useWorkspace()` composable then maps workspace-relative files back to MFE ids so the Components page can filter results to the currently selected MFEs.

## Scanner Strategies

The scanner uses a few strategies, in order.

### 1. Package Subdirectory Scans

Good for libraries like PrimeVue where each component lives in its own directory with an importable entry and declaration file.

### 2. Barrel Declaration Scans

Good for libraries that expose components through `index.d.ts` barrels and per-component declaration files.

### 3. Entry-Point-Driven Resolution

Fallback path for custom libraries and less structured packages. This path follows local re-export chains and can resolve `file:` dependencies back to their original source directories when package-manager installs only contain bundled output.

### 4. Bundled Export Fallback

When only bundled dist output is available, the scanner can still recover exported component names and then try to hydrate props from package types.

## Prop, Slot, And Event Extraction

Supported patterns include:

- Vue `defineProps<T>()`
- Vue `defineProps({ ... })`
- Vue Options API `props`
- Vue `defineEmits()`, `emits`, and fallback emit-call detection
- React and Solid TS prop interfaces in `.tsx`
- Svelte `export let` and Svelte 5 `$props<T>()`
- declaration-file interface extraction
- a TypeScript-compiler fallback for complex `.d.ts` prop shapes

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

Component scans are cached in memory with a 5-minute TTL and concurrent scans are coalesced behind one in-flight promise.

There is also a non-blocking cached access path used for best-effort task enrichment: if the catalog is cold, Annotask can start the scan in the background and skip the enrichment for that request.

## HTTP, MCP, And CLI Access

### HTTP

```bash
curl http://localhost:5173/__annotask/api/components
curl http://localhost:5173/__annotask/api/component-examples/Button?limit=5
```

### MCP

- `annotask_get_components`
- `annotask_get_component`
- `annotask_get_component_examples`

`annotask_get_components` supports:

- `search`
- `library`
- `category`
- `used_only`
- `detail`
- `limit`
- `offset`

### CLI

```bash
annotask components
annotask components Button --mcp
annotask component Button --library=primevue --mcp
annotask component-examples Button --limit=5 --mcp
```

## When Agents Should Use It

Reach for the component catalog when a task asks to:

- add new UI
- replace raw HTML with an existing design-system component
- match project conventions for props or imports
- understand whether a component is already used on the current route or elsewhere in the repo
