# Annotask — Visual UI Design Tool for AI-Assisted Web Development

## Vision

A Vite plugin that adds a visual UI design tool to any Vue/React project. Run `npm run dev` as normal, open `localhost:5173/__annotask/`, and get a full design tool — click elements, drag in components, adjust layout/styling, and emit structured JSON change reports that an LLM agent (Claude Code, Copilot, etc.) consumes via MCP to update source code.

---

## Decisions Locked In

| Decision | Choice | Notes |
|---|---|---|
| Primary user | Developer running local dev server | Not designers, not staging URLs |
| **Architecture** | **Single Vite plugin** | Serves shell UI + transforms SFCs + handles file ops — all from one package on the same Vite server |
| Distribution | `npm install -D @annotask/vite-plugin` + one line in vite config | No separate server, no extra process |
| Access model | Same-origin iframe | Shell at `/__annotask/` embeds user's app at `/` — same port, direct `iframe.contentDocument` DOM access |
| Framework priority | **Vue first**, then React | Vue is priority; React second |
| Repo scanner scope | Explicit tokens only (Tailwind config, CSS vars, theme objects) | No implicit pattern inference in v1 |
| Source mapping | Vite plugin injects `data-annotask-file`/`data-annotask-line` attrs | SFC template transform at compile time |
| Report format | Structured JSON | Consumed via MCP server + skills |
| Agent integration | MCP server (Claude Code primary target) | File export for Copilot/Cursor |
| Component libraries | **Tiered: workspace source → .d.ts → pre-built catalogs** | AST parse local/workspace libs; .d.ts extraction for compiled npm packages; ship catalogs for popular libs |
| API awareness | **OpenAPI/Swagger schema integration** | Parse specs to understand routes, data shapes, and available fields for data-bound components |
| Styling support | Must handle Tailwind classes AND scoped `<style>` AND CSS vars | Auto-detect per project/component |
| License | Open-source | Specific license TBD |
| Monorepo | pnpm workspaces | `packages/vite-plugin` (core), `packages/shell` (pre-built UI), `packages/mcp`, `packages/catalogs`, `packages/schema` |
| Shell UI tech | Pre-built static assets served by the plugin | Built with any framework; bundled into the npm package |
| Dogfood project | `/home/kurt/code/antenna` | Vue 3 MFE app with custom component library |

---

## Architecture Deep Dive

### Single Vite Plugin — Same-Origin Shell + iframe

Annotask is a single Vite plugin. It does two things:
1. **Transforms SFCs** to inject source-location attributes (compile-time)
2. **Serves the design tool UI** at `/__annotask/` on the same Vite dev server (runtime)

The shell at `localhost:5173/__annotask/` embeds the user's app at `localhost:5173/` in an iframe. **Same origin = direct `iframe.contentDocument` access.** No agent injection, no postMessage protocol, no separate server.

This is the same pattern used by [Vue DevTools Vite plugin](https://devtools.vuejs.org/guide/vite-plugin) and [Nuxt DevTools](https://devtools.nuxt.com/).

### Why Single Plugin Works

| Concern | Injection overlay (original) | Separate server + hybrid | **Single Vite plugin** |
|---|---|---|---|
| Packages | 1 | 4 | **1** |
| Extra processes | 0 | 1 (separate server) | **0** |
| DOM access | Direct | Via agent + postMessage | **Direct** (`iframe.contentDocument`) |
| UI richness | Limited (Shadow DOM) | Full (own app) | **Full** (served as static assets) |
| Risk to user's app | High | Low | **None** (nothing injected except source attrs) |
| HMR | Native | Native (iframe) | **Native** (iframe loads real dev server) |
| Setup | 1 line in vite config | 1 line + separate `npx` command | **1 line in vite config** |
| Communication | WebSocket | postMessage + WS | **Direct JS** — `iframe.contentDocument`, `iframe.contentWindow` |

### How It Works

```
User's vite.config.ts                        Browser
┌──────────────────────────┐                ┌───────────────────────────────────┐
│ import { annotask } from   │                │ localhost:5173/__annotask/          │
│   '@annotask/vite-plugin'  │                │                                   │
│                          │                │ ┌───────────────────────────────┐ │
│ export default {         │   serves both  │ │ Annotask Shell (pre-built app)  │ │
│   plugins: [             │ ──────────────►│ │                               │ │
│     vue(),               │                │ │ Toolbar / Component Catalog / │ │
│     annotask()             │                │ │ Property Panel / Tokens /     │ │
│   ]                      │                │ │ OpenAPI / Change Report       │ │
│ }                        │                │ │                               │ │
│                          │                │ │ ┌───────────────────────────┐ │ │
│ Plugin does:             │                │ │ │ iframe (localhost:5173/)  │ │ │
│ 1. Transform SFCs        │                │ │ │                           │ │ │
│    (data-annotask-* attrs) │                │ │ │  User's Real App          │ │ │
│ 2. Serve shell UI at     │                │ │ │  with data-annotask-*       │ │ │
│    /__annotask/            │                │ │ │  attributes on all        │ │ │
│ 3. API middleware for     │                │ │ │  elements                 │ │ │
│    file ops, scanning,   │                │ │ │                           │ │ │
│    reports               │                │ │ └───────────────────────────┘ │ │
│ 4. MCP server for AI     │                │ │           ▲                   │ │
│    agents                │                │ │           │ iframe.content-   │ │
│                          │                │ │           │ Document (direct) │ │
│                          │                │ │           ▼                   │ │
│                          │                │ │ Shell reads/writes DOM,       │ │
│                          │                │ │ styles, component tree        │ │
│                          │                │ │ directly — same origin        │ │
│                          │                │ └───────────────────────────────┘ │
│                          │                │                                   │
│ ┌──────────────────────┐ │                │  fetch('/__annotask/api/...')       │
│ │ Server-side APIs     │◄├────────────────│  (scan tokens, read files,        │
│ │ (Vite middleware)    │ │                │   write patches, get catalog)     │
│ │ - Token scanner      │ │                │                                   │
│ │ - Catalog builder    │ │                └───────────────────────────────────┘
│ │ - OpenAPI parser     │ │
│ │ - Source patcher     │ │                ┌───────────────────────────────────┐
│ │ - Report generator   │ │                │ MCP Server (same process)         │
│ │ - MCP server         │◄├───────────────►│ Claude Code / Copilot / Cursor    │
│ └──────────────────────┘ │                └───────────────────────────────────┘
└──────────────────────────┘
```

### Interaction Flow: User Clicks an Element

1. User navigates to `localhost:5173/__annotask/` (or clicks the floating Annotask toggle on their page)
2. Shell loads with the user's app in an iframe at `localhost:5173/`
3. Shell attaches capture-phase event listeners to `iframe.contentDocument`:
   ```js
   const doc = iframe.contentDocument
   doc.addEventListener('click', onElementClick, { capture: true })
   doc.addEventListener('mouseover', onElementHover, { capture: true })
   ```
4. User hovers over an element → shell reads its `getBoundingClientRect()` and renders a highlight overlay
5. User clicks → shell reads `data-annotask-file`, `data-annotask-line`, `data-annotask-component` directly from the element
6. Shell reads computed styles via `getComputedStyle(element)` and component props via `iframe.contentWindow.__VUE_DEVTOOLS_GLOBAL_HOOK__` (optional)
7. Property panel updates with editable fields

All of this is plain JavaScript — no message passing, no serialization, no agent.

### Interaction Flow: User Drags a Component from Catalog

1. User drags `<DataTable>` from the component catalog panel in the shell
2. User drags over the iframe — shell translates coordinates to iframe-relative position
3. Shell inspects `iframe.contentDocument` at those coordinates via `elementFromPoint()` to find the drop target
4. Shell renders drop-zone indicators (positioned absolutely over the iframe)
5. User drops → shell sends insertion command to plugin server-side via `fetch('/__annotask/api/patch', ...)`
6. Server generates a source patch (adds `<DataTable .../>` to the template at the right line)
7. Server writes the patched file → Vite HMR picks it up → iframe hot-reloads
8. The component renders with real app context (stores, router, provide/inject all intact)
9. Change is recorded in the change tracker

### Activation UX

Two ways to open Annotask:

1. **Navigate directly** to `localhost:5173/__annotask/`
2. **Floating toggle button** — the plugin injects a tiny (~1KB) fixed-position button in the corner of the user's page (like Nuxt DevTools). Clicking it opens `/__annotask/` in a new tab or navigates to it. This is the only thing injected into the user's page besides the source-location attributes.

### Source Location Injection (Vue SFCs)

The Vite plugin transforms templates at compile time. Given:

```vue
<!-- src/components/Header.vue -->
<template>
  <header class="flex items-center gap-4">
    <Logo />
    <nav>...</nav>
  </header>
</template>
```

The plugin transforms the compiled output so each element carries:
```html
<header class="flex items-center gap-4"
  data-annotask-file="src/components/Header.vue"
  data-annotask-line="3"
  data-annotask-component="Header">
```

This gives the overlay UI everything it needs to map a clicked element back to source.

**Setup guidance UX:** When the plugin detects it's running but source attributes are missing on elements (e.g., a component wasn't processed), it shows a yellow warning badge in the toolbar: *"Source mapping unavailable for 12 elements — check that annotask() is first in your Vite plugins array."*

### Component-to-Source Mapping for Vue

Vue has unique advantages here:
- **SFCs are self-contained** — template, script, and styles in one file. The source location points to the whole component.
- **Vue DevTools exposes `__VUE_DEVTOOLS_GLOBAL_HOOK__`** — gives access to the component instance tree at runtime, including component names, props, and state.
- **Vite processes all `.vue` files** — the plugin sees every component at build time.

Vue-specific challenges:
- **`<script setup>` macros** — `defineProps`, `defineEmits` are compile-time; the plugin needs to extract prop types from the AST for the property panel.
- **Scoped styles** — `<style scoped>` generates hashed selectors. The change report must reference the original scoped selector, not the compiled hash.
- **Dynamic components** — `<component :is="x">` makes source mapping non-deterministic at compile time. Fall back to runtime detection.

### The Change Report Schema (Canonical v1)

One canonical schema. This is the contract between Annotask and any consuming LLM agent.

See the **Minimum Useful Report** section below for the full annotated example. The schema lives in `packages/schema/annotask-report.schema.json` and is formally validated.

**Change types:**
| Type | What it modifies | SFC section |
|---|---|---|
| `class_update` | Tailwind/utility classes on an element | `template` |
| `scoped_style_update` | CSS rules in `<style scoped>` | `style` |
| `prop_update` | Component prop values | `template` |
| `component_insert` | Add a new component/element | `template` |
| `component_move` | Reorder an element within or across parents | `template` |
| `component_delete` | Remove an element | `template` |

**Every change has:**
- `id` — unique identifier for tracking
- `type` — one of the above
- `description` — natural language intent
- `file` — source file path (relative to project root)
- `section` — which SFC section (`template`, `style`, `script`)
- `line` — line number in source for anchoring
- `before` / `after` — source-editable values only (classes, props, selectors — NOT computed CSS)
- `data_context` (optional) — OpenAPI endpoint and response schema, when the change involves data-bound components

**MCP tools:**
```
annotask://get-pending-changes     → returns the full report
annotask://mark-applied { id }     → marks a change as applied
annotask://get-design-tokens       → project's token palette
annotask://get-component-catalog   → available components with props/slots
annotask://get-openapi-context     → data schemas for current route
annotask://preview-screenshot      → visual state capture
```

---

## What You're Missing (Things Figma Does)

### Must-have by Phase 2 (required for a usable product)
- **Undo/redo** — users will experiment; they need to revert. Non-negotiable. *(Phase 1)*
- **Selection and multi-selection** — click to select, shift-click for multi, drag to marquee select. Highlight with bounding boxes and handles. *(Phase 0: single select; Phase 1: multi-select)*
- **Property panel** — sidebar showing all editable properties of the selected element (not just CSS — component props too). *(Phase 0: CSS only; Phase 1: + props)*
- **Responsive breakpoint editing** — web design is inherently responsive. Need to show/switch between viewport sizes and make per-breakpoint changes. *(Phase 2)*
- **Visual box model editing** — padding, margin, border as draggable handles, not just number inputs. *(Phase 2)*
- **Layout tools** — visual flexbox/grid controls (direction, alignment, gap, wrap). This is 80% of what people adjust. *(Phase 2)*

### Important for v2
- **Design token management** — not just scanning tokens, but editing/creating them and propagating changes across all usages.
- **Component state visualization** — toggle hover/active/disabled/loading states to design all variants.
- **Spacing and alignment guides** — snap lines, measurement overlays ("this element is 16px from that one").
- **Asset management** — icons, images, SVGs. At minimum, icon picker for common icon libraries.
- **Accessibility overlay** — contrast ratio checking, heading hierarchy visualization, focus order.
- **Typography scale** — visual type scale editor tied to design tokens.

### Nice to have / v3+
- **Interaction/animation design** — define transitions, hover effects visually.
- **Prototyping** — link pages together, define click-through flows.
- **Version history** — visual diffing of design states over time.
- **Collaboration** — multi-user editing (extremely complex, defer).
- **Component variant editor** — create/edit component variants visually (maps to Storybook-like functionality).

### Things Figma does that you should NOT do
- **Pixel-perfect vector drawing tools** — you're working with real DOM elements, not vectors. Don't build a drawing app.
- **Custom font management** — the web page already has its fonts. Just expose what's there.
- **Offline-first** — your tool needs a running web page. Offline doesn't apply.

---

## System Components

Everything lives in one npm package (`@annotask/vite-plugin`) with two distinct runtime contexts:

### Browser-side: Shell App (pre-built, served at `/__annotask/`)
The design tool UI. Pre-built into static assets during Annotask's own build, bundled into the npm package, served by the plugin via Vite's `configureServer` middleware.

**Responsibilities:**
- All design tool UI: toolbar, component catalog, property panel, design token browser, OpenAPI data panel, change report viewer
- Direct DOM access into iframe (`iframe.contentDocument`, `iframe.contentWindow`)
- Event listeners on iframe content (capture-phase click/hover for element selection)
- SVG overlay rendering for selection highlights, drop zones, measurement guides
- Undo/redo management (command pattern)
- Communicates with server-side via `fetch('/__annotask/api/...')` for file operations

### Server-side: Vite Plugin (runs in the Vite dev server's Node.js process)
Handles compile-time transforms and exposes API middleware.

**Responsibilities:**
- SFC template transform: inject `data-annotask-*` attributes
- Inject floating toggle button via `transformIndexHtml` (~1KB script)
- `configureServer` middleware: serve shell static assets at `/__annotask/`
- API routes at `/__annotask/api/`:
  - `GET /tokens` — scan and return design tokens
  - `GET /catalog` — scan and return component catalog
  - `GET /openapi` — parse and return OpenAPI spec
  - `POST /patch` — write source patches (class changes, component insertions)
  - `GET /report` — current change report
- MCP server (runs in same process, separate port or stdio)
- Heavy operations (file scanning, catalog building) run in worker threads to avoid blocking HMR

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| **Vite plugin** | TypeScript, Vite Plugin API | Single package: SFC transforms + shell serving + API middleware |
| **Shell app** | Vue 3 + Tailwind (pre-built) | Our own app served as static assets — no conflict with user's app |
| **Shell ↔ iframe** | Direct DOM access (`iframe.contentDocument`) | Same origin — no postMessage, no agent, just JavaScript |
| SFC transform | Vue compiler API (`@vue/compiler-sfc`) | Parse templates to inject source location attributes |
| JSX transform | Babel plugin (for React support, Phase 4) | Same source-loc injection for JSX |
| Design token extraction | PostCSS + Tailwind config reader + AST parsing | Extract explicit tokens from project config |
| Component catalog | Tiered: SFC AST → `.d.ts` parser → pre-built JSON | Covers workspace, npm, and popular libraries |
| OpenAPI parser | `@apidevtools/swagger-parser` | Parse specs for route/data awareness |
| Heavy server-side work | Node.js worker threads | Keeps file scanning off the main event loop so HMR stays fast |
| Change report format | JSON Schema (custom, versioned) | Structured, LLM-friendly, validated |
| AI agent interface — MCP | `@modelcontextprotocol/sdk` | Claude Code integration |
| AI agent interface — file | `.annotask/report.json` | Copilot/Cursor/generic LLM |
| Package format | npm monorepo (pnpm workspaces) | `packages/vite-plugin` (core), `packages/shell` (pre-built UI), `packages/mcp`, `packages/catalogs`, `packages/schema` |
| Testing | Vitest + Playwright | Unit + e2e with real browser |

---

## Phased Roadmap

### Phase 0 — Proof of Concept
**Goal:** Add `annotask()` to a Vite config, open `/__annotask/`, click elements, see source locations and styles, edit styles, copy a JSON change report.

- Monorepo scaffolding (pnpm workspaces)
- **Vite plugin**:
  - SFC template transform: inject `data-annotask-file`, `data-annotask-line`, `data-annotask-component` into all elements
  - `configureServer` middleware: serve shell static assets at `/__annotask/`
  - Inject floating toggle button via `transformIndexHtml` (~1KB, opens `/__annotask/`)
- **Shell app** (pre-built, served at `/__annotask/`):
  - Embeds user's app in iframe at `/` (same origin)
  - Capture-phase event listeners on `iframe.contentDocument` for hover highlight + click selection
  - Right panel: shows selected element's source file, line, classes, and computed styles
  - Edit CSS properties in panel → shell applies inline styles to iframe element for live preview
  - "Copy Report" button → JSON change report to clipboard
  - Warning banner when `data-annotask-*` attributes are missing (plugin not installed or wrong plugin order)
- No component libraries, no repo scanning, no drag-and-drop

**This validates: same-origin iframe access works, SFC transforms are correct, the shell UI doesn't interfere with the user's app, and the report format is useful to an LLM.**

### Phase 1 — Source Awareness, Design Tokens & Early AI Loop
- Vue DevTools hook integration (optional) — shell accesses `iframe.contentWindow.__VUE_DEVTOOLS_GLOBAL_HOOK__` for component tree, props, state
- Property panel shows component props (not just CSS)
- Prop editing → change report includes prop changes
- Server-side API routes for project scanning:
  - `GET /__annotask/api/tokens` — Tailwind config extraction (colors, spacing, fonts, breakpoints) + CSS custom properties
  - `GET /__annotask/api/report` — current change report
  - `POST /__annotask/api/patch` — write source patches (class changes, prop edits)
- Design token panel (shows project's palette, spacing scale, typography)
- Style editing suggests token values where possible (`gap-4` not `gap: 16px`)
- Undo/redo stack (command pattern on change tracker)
- **Canonical change report schema v1** (single formally documented JSON Schema)
- Multi-element selection (shift-click)
- **Minimal MCP server** — `get-pending-changes` and `mark-applied` tools only; validates the AI round-trip (Annotask → report → LLM → code edit → Vite HMR → iframe refreshes → visual verify)
- File-based export: `.annotask/report.json` auto-written on each change
- Heavy scanning runs in worker threads to avoid blocking Vite HMR

### Phase 2 — Component Library, Drag-and-Drop & Data Awareness
- **Tiered auto-catalog scanner** (server-side, worker thread):
  - Tier 0: base HTML elements with Tailwind class presets (always available)
  - Tier 1: parse project's own `src/components/` + workspace library SFCs for props/emits/slots via AST
  - Tier 2: extract component types from `.d.ts` files in compiled npm packages (Headless UI, etc.)
  - Tier 3: ship pre-built catalogs for popular libraries (Vuetify, PrimeVue, etc.)
- `GET /__annotask/api/catalog` — returns component catalog
- Scan `package.json` for all Vue component dependencies (npm, workspace, `file:` links)
- Component catalog panel in shell: searchable component tree grouped by library → category
- Component preview thumbnails (rendered via hidden iframe or cached screenshots)
- **Drag-and-drop flow:**
  - Drag component from shell catalog → drag over iframe → shell uses `iframe.contentDocument.elementFromPoint()` to find drop target
  - Shell renders drop-zone overlay (positioned absolutely over iframe)
  - Drop → `POST /__annotask/api/patch` → server writes source patch → Vite HMR → component renders in real app context
- Slot-aware insertion: shell inspects drop target for named slots, offers slot placement
- Visual flexbox/grid controls (direction, align, justify, gap, wrap)
- Responsive breakpoint switcher (resize iframe + track per-breakpoint changes)
- Box model editor (draggable padding/margin handles over iframe)
- Storybook integration (optional): if `*.stories.js` exist, parse for default args and variants
- **OpenAPI schema integration** (server-side):
  - `GET /__annotask/api/openapi` — detect and parse OpenAPI/Swagger specs (file or URL)
  - Data binding panel: show available fields per route/endpoint
  - Data-aware component insertion (auto-suggest table columns, form fields from response/request schemas)
  - Include `data_context` in change reports so LLM can wire up data fetching

### Phase 3 — Full AI Agent Integration
- Expand MCP server (basic read/apply from Phase 1) with rich tools:
  - `get-design-tokens` — project's color palette, spacing, typography
  - `get-component-catalog` — available components with prop types and slot definitions
  - `get-openapi-context` — data schemas for the current route
  - `preview-screenshot` — capture visual state via Playwright headless against `localhost:5173`
- CLI: `npx annotask export` for CI/script use
- Claude Code skill/prompt template for consuming reports
- Round-trip validation: after LLM applies changes, HMR reloads in iframe → shell diffs visual result vs. intent, flags discrepancies
- Setup wizard: `npx annotask init` detects framework, installs plugin, adds to vite config
- Vue Router awareness: parse route definitions, map routes to pages, expose route structure to LLM

### Phase 4 — React Support & Polish
- Babel plugin for JSX source location injection (same `data-annotask-*` attributes)
- React fiber tree integration via `iframe.contentWindow.__REACT_DEVTOOLS_GLOBAL_HOOK__`
- Component catalogs: shadcn/ui, Radix, MUI
- Spacing/alignment snap guides (visual ruler overlays)
- Accessibility overlay (contrast ratio, heading hierarchy, focus order)
- Design token editor (create/modify tokens, propagate to config files)
- Component state toggle (hover/active/disabled/loading visualization)

### Phase 5 — Broader Framework Support
- Svelte support (Vite plugin transforms Svelte components similarly)
- Nuxt-specific integration (auto-detection, layouts awareness)
- Next.js support (would need Webpack/Turbopack adapter)
- Angular support (highest effort — different build system)
- Community adapter API for adding framework support
- Browser extension mode: for non-Vite / non-local pages with degraded functionality

---

## Key Architecture Decisions

### 1. Tiered component library detection

Most teams use a mix of custom internal libraries, popular UI frameworks, and project-local components. Annotask needs to catalog all of them. The challenge: npm packages ship compiled JS, not parseable `.vue` SFCs. Three tiers handle this:

**Tier 1 — Workspace source libraries** (highest fidelity)
For local packages (`file:` links, monorepo workspaces, `src/components/`):
1. Follow the package's main export → parse the barrel file
2. For each exported component, parse the SFC → extract `defineProps` interface, `defineEmits`, `<slot>` usage via AST
3. Build catalog with prop types, defaults, slot definitions, and emits

This works because the source `.vue` files are available on disk.

**Tier 2 — TypeScript declaration extraction** (compiled npm packages)
For published npm packages that ship `.d.ts` files (Vuetify, PrimeVue, Quasar, etc.):
1. Read `package.json` → find Vue component dependencies
2. Locate `.d.ts` files in `node_modules/<package>/dist/`
3. Parse type declarations to extract component prop interfaces, events, and slot types
4. Most well-maintained Vue libraries export typed component definitions (e.g., `DefineComponent<Props, ...>`)

This covers the majority of the npm ecosystem without needing source access.

**Tier 3 — Pre-built catalogs** (fallback and acceleration)
For popular libraries where auto-detection is slow or unreliable:
- Ship curated catalog JSONs for Vuetify, PrimeVue, Quasar, Element Plus, Naive UI, shadcn-vue
- Community-contributed catalogs via a plugin system
- These include richer metadata: component previews, common usage patterns, slot examples

**Tier 0 — Base HTML elements** (always available)
Every project — with or without a component library — can insert native HTML elements:
- Layout: `<div>`, `<section>`, `<header>`, `<footer>`, `<main>`, `<aside>`, `<nav>`
- Content: `<h1>`–`<h6>`, `<p>`, `<span>`, `<a>`, `<img>`, `<ul>`, `<ol>`, `<li>`
- Forms: `<form>`, `<input>`, `<textarea>`, `<select>`, `<button>`, `<label>`
- Data: `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>`

When Tailwind is detected, each element comes with sensible class presets (e.g., `<button>` → `px-4 py-2 rounded bg-primary text-white`, using the project's actual token values). The user can customize before inserting.

This ensures Annotask is useful even for projects with zero component libraries — just Tailwind + raw HTML.

**Detection order:** Tier 0 (always) + Tier 1 → Tier 2 → Tier 3. If a library is detected at multiple tiers, higher tiers take priority (more accurate).

**Storybook integration** (optional, any tier): if `*.stories.js` files exist, parse for default args and component variants to enrich the catalog.

### Projects without component libraries

Many real projects don't use Vuetify/PrimeVue — they build their own components from scratch using Tailwind + native HTML, sometimes with unstyled primitives like Headless UI or Radix. Annotask handles this naturally:

1. **Project-local components are first-class.** Tier 1 scans `src/components/` (or whatever the project uses) and catalogs every `.vue` file it finds. A project with 30 local components gets a full catalog with props, slots, and emits — no external library needed.

2. **Unstyled component libraries** (Headless UI, Radix Vue) are detected via Tier 2 (`.d.ts` extraction). These are building blocks that get styled with Tailwind classes. The property panel emphasizes class editing for these, since their props control behavior (open/close, transitions) while classes control appearance.

3. **Base HTML elements** (Tier 0) fill the gap when there's no library at all. A developer starting fresh can drag `<div>`, `<button>`, `<input>` etc. with Tailwind presets.

4. **The property panel adapts.** For unstyled components, it shows Tailwind class editing prominently. For fully styled component libraries (Vuetify, etc.), it shows props prominently. Annotask detects which approach the project uses.

### 2. Multiple styling approaches in the same project

Real projects mix styling strategies — Tailwind classes in templates, scoped `<style>` blocks, CSS custom properties, CSS modules. A single component might use multiple approaches:

```vue
<template>
  <div class="flex gap-4 bg-primary">  <!-- Tailwind classes -->
    <slot />
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar { width: 6px; }  /* Scoped CSS */
</style>
```

The change report must distinguish these — each maps to a different source location and edit type:
- **Template class changes**: `"before_classes": "gap-2", "after_classes": "gap-4"` → modify the template
- **Scoped style changes**: `"selector": ".custom-scrollbar", "property": "width"` → modify the `<style>` block
- **Prop changes**: `"prop": "disabled", "value": true` → modify the template attribute

Annotask detects the project's styling approach at init (check for `tailwind.config.*`, CSS var usage, etc.) and adapts the property panel and report format accordingly.

### 3. Tailwind token awareness

When the project uses Tailwind, the property panel should:
- Parse the full theme config (including `extend`) — not just default Tailwind values
- Understand custom semantic tokens (`primary`, `success`, etc.) and their variants (`primary-hover`, `dark:primary`)
- Present tokens grouped by semantic purpose (colors, spacing, typography)
- When the user changes a visual property, suggest the matching Tailwind class, not raw CSS

### 4. Typed component props drive the property panel

Components using `defineProps<Props>()` with TypeScript interfaces give us structured metadata:

```typescript
interface Props {
  modelValue?: string
  label?: string
  disabled?: boolean
  variant?: 'primary' | 'secondary'
}
```

The property panel renders these as correctly typed fields (text input for strings, toggle for booleans, dropdown for unions) — not just raw HTML attributes.

### 5. OpenAPI schema integration for routes and data binding

If a project has an OpenAPI/Swagger spec, Annotask gains powerful data awareness:

**What the spec gives us:**
- **Available endpoints** — every route, method, and URL pattern the API exposes
- **Response schemas** — the shape of data each endpoint returns (field names, types, nesting)
- **Request schemas** — what parameters, query strings, and bodies each endpoint accepts
- **Route-to-data mapping** — connect Vue Router routes to the API endpoints they consume

**How Annotask uses this:**

1. **Data-aware component insertion** — when dragging a `DataTable` onto a page, Annotask suggests columns based on the API response schema for that page's data source. A user list page backed by `GET /api/users` → auto-suggest columns for `id`, `name`, `email`, `role`.

2. **Form generation** — dragging a `Form` component and selecting an endpoint → auto-generate form fields matching the request body schema, with correct input types (string → text, boolean → toggle, enum → dropdown).

3. **Data binding panel** — a panel showing available data fields for the current route. The user can drag fields onto components or bind them visually (e.g., drag `user.email` onto a text component).

4. **Change report includes data context** — when the LLM receives a change report, it also knows what data is available:
   ```json
   {
     "type": "component_insert",
     "data_context": {
       "endpoint": "GET /api/users",
       "response_schema": { "type": "array", "items": { "properties": { "id": "integer", "name": "string", "email": "string" } } }
     },
     "component": { "tag": "DataTable", "props": { "columns": ["name", "email"], "source": "users" } }
   }
   ```
   The LLM now knows how to wire up the data fetching, not just the template.

5. **Route scaffolding** — given a route and its associated endpoints, suggest a full page layout with appropriate data-bound components.

**Spec detection:**
- Look for `openapi.json`, `openapi.yaml`, `swagger.json` in the project root or a `docs/` folder
- Check `package.json` scripts or config for spec generation tools (e.g., `swagger-autogen`, `@nestjs/swagger`)
- Allow manual config: `annotask({ openapi: './api/openapi.yaml' })` in the Vite plugin options
- Optionally fetch from a running server: `annotask({ openapi: 'http://localhost:3000/api-docs' })`

**Relationship to routes:**
- Parse `vue-router` route definitions from the project source
- If route meta or naming conventions map to API endpoints (e.g., `/users` page → `GET /api/users`), Annotask suggests the mapping
- User can manually link routes to endpoints in the UI for cases where convention doesn't apply

### 6. Security model

Since everything runs on the same Vite server, the security model is straightforward:

- **All API routes** (`/__annotask/api/*`) only bind to the Vite dev server (localhost by default)
- **Write operations** (`POST /__annotask/api/patch`) are restricted to the project root — no path traversal
- **Dev-only** — the plugin is a `devDependency`; SFC transforms, shell serving, and API routes are all stripped/disabled in production builds (`mode !== 'serve'`)
- **No external network access** — the plugin never phones home, proxies external URLs, or opens additional ports (except MCP if configured)
- **iframe access** is inherently same-origin (both `/__annotask/` and `/` are served by the same Vite server), so no CORS or cross-origin concerns

### 7. MFE and multi-app awareness

For micro-frontend architectures (single-spa, Module Federation), the Vite plugin is added per-MFE, not globally. Annotask should:
- Work correctly when scoped to a subtree of the page (not the full document)
- Detect MFE context and scope the overlay accordingly
- Handle cases where the root shell uses a different build tool (e.g., Webpack) — Annotask won't work there, and should say so

---

## Minimum Useful Report (from the LLM's perspective)

As the LLM that would consume this report, here's what I need to confidently apply changes to source code:

```json
{
  "version": "1.0",
  "project": {
    "framework": "vue",
    "styling": ["tailwind", "scoped-css"],
    "root": "/home/user/my-project"
  },
  "changes": [
    {
      "id": "c1",
      "type": "class_update",
      "description": "Increased gap between nav items and centered vertically",
      "file": "src/components/AppHeader.vue",
      "section": "template",
      "line": 12,
      "component": "AppHeader",
      "element": "nav",
      "before": { "classes": "flex gap-2" },
      "after": { "classes": "flex items-center gap-4" }
    },
    {
      "id": "c2",
      "type": "scoped_style_update",
      "description": "Added subtle border to input wrapper on focus",
      "file": "src/components/SearchBar.vue",
      "section": "style",
      "selector": ".search-wrapper:focus-within",
      "before": null,
      "after": { "border-color": "var(--color-primary)", "box-shadow": "0 0 0 2px rgba(59, 130, 246, 0.1)" }
    },
    {
      "id": "c3",
      "type": "component_insert",
      "description": "Added export button in the page header actions slot",
      "file": "src/views/Users.vue",
      "section": "template",
      "line": 8,
      "insert_inside": { "component": "PageHeader", "slot": "actions" },
      "insert_position": "append",
      "component": {
        "tag": "AppButton",
        "library": "my-component-lib",
        "props": { "icon": "file-export", "variant": "primary" },
        "classes": "px-4 py-1",
        "text_content": "Export"
      }
    },
    {
      "id": "c4",
      "type": "prop_update",
      "description": "Made the data table paginated with 20 items per page",
      "file": "src/views/Users.vue",
      "section": "template",
      "line": 18,
      "component": "DataTable",
      "before": { "pageSize": 10 },
      "after": { "pageSize": 20 }
    },
    {
      "id": "c5",
      "type": "element_move",
      "description": "Moved breadcrumb above the page header",
      "file": "src/views/Users.vue",
      "section": "template",
      "element": { "component": "Breadcrumb", "from_line": 22 },
      "move_to": { "before_line": 3 }
    },
    {
      "id": "c6",
      "type": "component_insert",
      "description": "Added a user table bound to the users API endpoint",
      "file": "src/views/Users.vue",
      "section": "template",
      "line": 10,
      "insert_inside": { "element": "main" },
      "insert_position": "append",
      "component": {
        "tag": "DataTable",
        "library": "my-component-lib",
        "props": { "columns": ["name", "email", "role"], "searchable": true }
      },
      "data_context": {
        "endpoint": "GET /api/users",
        "response_schema": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": { "type": "integer" },
              "name": { "type": "string" },
              "email": { "type": "string" },
              "role": { "type": "string", "enum": ["admin", "user", "viewer"] }
            }
          }
        }
      }
    }
  ]
}
```

**What makes this useful to an LLM:**
- **`file` + `line` + `section`** — I know exactly where to look (template vs style vs script)
- **`before`/`after`** — I can verify the `before` matches reality (prevents stale reports), then apply the `after`
- **`classes` as strings, not parsed** — for Tailwind, class strings are the source of truth; I add/remove classes in the template
- **`component.tag` uses the actual tag name** as written in the project (matching the library's export name)
- **`insert_inside` with slot name** — I know to put it inside `<template #actions>`, not just "after line 8"
- **`description`** — natural language intent helps me handle edge cases where the mechanical diff isn't enough
- **`data_context`** — when present, I know the API endpoint and response shape, so I can wire up data fetching (composable, store, or inline fetch) without guessing the schema

**What would make a report NOT useful:**
- Computed CSS values without class/source mapping (I can't turn `gap: 16px` back into `gap-4`)
- DOM selectors without file references (`.flex.items-center > button:nth-child(2)` is meaningless in source)
- Changes relative to runtime DOM state that doesn't exist in source
- Missing `before` values (I can't verify the report is still valid) 
---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Vue SFC template transform breaks edge cases (dynamic components, render functions, JSX in Vue) | High | Extensive test suite against real Vue apps; graceful fallback when source attrs are missing |
| Change reports too ambiguous for LLMs to apply correctly | High | Design schema in Phase 0, validate AI round-trip in Phase 1 before deeper investment |
| Stale report drift — user edits code after generating report, line numbers shift | High | Include `before` content hash/snippet for each change; LLM verifies before applying; warn on HMR reload if report is stale |
| HMR race conditions — source patch + HMR reload while user is still editing in shell | High | Queue changes, debounce HMR triggers, lock shell UI during patch-apply cycle |
| iframe event interception interferes with user's app behavior | High | Use capture-phase listeners only when Annotask inspect mode is active; restore cleanly when deactivated; never `preventDefault` on user interactions outside inspect mode |
| Plugin crash takes down dev server | Medium | Run heavy work (scanning, catalog building) in worker threads; catch all errors in plugin middleware |
| npm packages ship compiled JS — Tier 2 `.d.ts` catalog extraction may miss metadata | Medium | Fall back to Tier 3 pre-built catalogs; accept partial metadata gracefully |
| Component catalog maintenance is ongoing work per library version | Medium | Tiered detection reduces manual maintenance; community-contributed catalogs for Tier 3 |
| Vue DevTools hook API is not stable/documented | Medium | Optional integration only; source-loc injection is the primary path |
| Vite plugin ordering conflicts with other plugins (Vuetify, UnoCSS) | Medium | Document required plugin order; test against common plugin combinations |
| Scope creep into React before Vue is solid | High | Strict phase gates — no React work until Phase 3 acceptance criteria are met |
| Tailwind class changes vs. CSS property changes need different report formats | Medium | Detect styling approach at plugin init, generate appropriate change format |
| SSR/SSG hydration mismatches — `data-annotask-*` attributes cause warnings | Medium | Strip attributes in production builds; in dev, suppress Vue hydration mismatch warnings for `data-annotask-*` |
| Cross-toolchain portability — tight Vite coupling makes Webpack/Turbopack support expensive | Medium | Keep core logic (scanning, patching, reports) framework-agnostic; only the SFC transform and server middleware are Vite-specific |
| SPA router or `X-Frame-Options` blocks iframe embedding | Low | Dev servers rarely set XFO; SPA routes work in iframe since same-origin; document workaround if CSP is an issue |
| OpenAPI spec not available or outdated | Low | Graceful degradation — data binding features simply don't appear; warn if spec is stale |
