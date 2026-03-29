# Annotask Critical Analysis

## Summary

Annotask solves a real problem well: it gives developers a visual way to describe UI changes, then hands structured intent to an LLM that can apply them. The same-origin iframe architecture is the right call. The interaction breadth is impressive for a young project. The design spec and task pipeline show product thinking, not just engineering tinkering.

The project's main weakness is not vision or feature scope. It is that the core contract — "I will tell you exactly what changed, where it is in your source, and what it was before" — has correctness bugs that make the output unreliable. Fix those and you have a genuinely useful tool. Ship them and you have a tool that guesses.

---

## What is strong

### The architecture earns its complexity

The single-Vite-plugin model is the best available choice for this problem. Compared to browser extensions, separate servers, or injected overlays, it offers same-origin DOM access, zero extra processes, native HMR, and one-line setup. The team clearly studied prior art (Vue DevTools, Nuxt DevTools) and picked the right tradeoffs.

The iframe-based shell at `/__annotask/` is particularly smart: the user's app runs unmodified at `/`, the shell has full `contentDocument` access without cross-origin restrictions, and the two never contaminate each other's DOM or styles. This is the strongest architectural decision in the project.

### The interaction surface is genuinely broad

This is not a CSS tweaker. Six interaction modes (select, interact, pin, arrow, draw, highlight), a full annotation system, a task review pipeline, a CLI tool, WebSocket broadcasting, a design token system, and a theme editor all exist and mostly work. That surface area demonstrates the team can ship real features, not just scaffolding.

The task lifecycle deserves specific credit: `pending → applied → review → accepted/denied` with feedback round-trips is the right model for AI-assisted editing. The fact that denied tasks carry feedback text, and the apply skill reads it to retry, shows mature product thinking.

### Schema-first design pays forward

`src/schema.ts` defines contracts before behavior. The change types anticipate real editing needs: style updates, class changes, scoped CSS, prop updates, component insertion/moving/deletion, spatial section requests, and free-form annotations. Even where the runtime doesn't yet emit all these types, having the schema means AI consumers can be built against a stable interface.

The `DesignSpecToken` type with `cssVar`, `source`, `sourceFile`, and `sourceLine` fields is well-designed for the LLM consumption case. It tells an agent both *what* a token is semantically and *where* to find it in code.

### The CLI and WebSocket layer are clean

`src/cli/index.ts` is tight and well-structured: four commands, clear error messages, proper exit codes. The WebSocket server in `ws-server.ts` handles connection lifecycle, message routing, and client tracking correctly. The broadcast/relay pattern (shell → server → other clients) is the right approach.

---

## What is broken

### 1. Style baseline capture is wrong

`src/shell/composables/useStyleEditor.ts:197` sets the inline style *before* reading the "before" value from computed styles:

```typescript
htmlEl.style.setProperty(property, value)  // mutates DOM
// ...
const before = win.getComputedStyle(el).getPropertyValue(property)  // reads AFTER mutation
```

Every first style change for a given property records the *new* value as the "before" value. This corrupts the change report, breaks undo (reverting to an incorrect baseline), and gives an AI agent wrong information about what it's changing from.

The project partially knows this — `applyStyleWithBefore` exists specifically for resize operations where the caller captures the baseline first. But the primary `applyStyle` path, used for all property panel edits, doesn't.

**Fix**: Read computed style before calling `setProperty`. One line reorder.

### 2. Line numbers are template-relative, not file-relative

`src/plugin/transform.ts:156`:

```typescript
const lineInTemplate = template.slice(0, tagStart).split('\n').length
```

This counts lines within the `<template>` content, not the `.vue` file. A `<script setup>` block of 20 lines pushes every element's actual file line up by ~22 (script + template open tag), but the emitted `data-annotask-line` attribute doesn't account for this. The `templateOffset` parameter is passed to `injectAttributes` and never used.

This means every file location in every report, every task, and every annotation points to the wrong line. An AI agent applying changes will look at the wrong place in the file. For small SFCs the error is manageable. For components with substantial script blocks, the offset could be 50+ lines off.

**Fix**: Add `templateOffset` to the line calculation. One arithmetic change.

### 3. The tag scanner doesn't handle template expressions

`findTagEnd` in `transform.ts` tracks single/double quotes to avoid `>` inside attribute strings. But Vue template expressions use backtick strings and bare JavaScript:

```vue
<div :class="{ active: count > 5 }">       <!-- > inside binding, but in quotes: OK -->
<div :class="`item-${count > 5 ? 'a' : 'b'}`">  <!-- backtick: NOT tracked -->
<Component v-if="x > 3" />                 <!-- > inside quotes: OK -->
```

The backtick case is a real risk for dynamic class expressions. The comment mentions this is "quote-aware," which is true for `"` and `'` but not for `` ` ``. If a template uses backtick expressions in attributes (rare but valid in some preprocessors and custom setups), tags will be split at the wrong point, corrupting the output.

More practically, the scanner will also break on HTML comments containing `>` that don't match the `<!--` prefix exactly, and on any edge case where attribute values contain unescaped angle brackets outside of quotes.

**Fix**: Either add backtick tracking to `findTagEnd`, or switch to `@vue/compiler-sfc` AST parsing for robustness. The file's own header comments claim it uses the compiler — making the code match the comments would resolve this.

### 4. Report hardcodes project metadata

`src/shell/composables/useStyleEditor.ts:543`:

```typescript
return {
  version: '1.0' as const,
  project: { framework: 'vue', styling: ['tailwind', 'scoped-css'], root: '' },
  changes: reportChanges,
}
```

Every report claims the project uses Tailwind and scoped CSS, regardless of the actual project. The design spec system now detects the real framework and styling, but the report emitter doesn't read it. This means a scoped-CSS-only project (like the playground) gets reports telling agents to use Tailwind patterns.

**Fix**: Read the design spec or config to populate `project` fields dynamically.

### 5. Class edits don't generate change records

`src/shell/App.vue:367` lets users edit CSS classes via a textarea, but the handler directly mutates `el.className` without creating a `class_update` change record. The report never includes class changes. An AI agent will never know the user changed classes.

This is the most visible gap between what the UI lets you do and what the report captures.

---

## What is weak but not broken

### Dev-only boundary is unclear

The `annotask:transform` plugin doesn't guard against production builds. The `apply: 'serve'` restriction is only on the serve plugin (middleware, API, WebSocket), not the transform plugin (attribute injection, Vue globals, component registration, toggle button). In a production `vite build`, the transform still runs and injects `data-annotask-*` attributes, `window.__ANNOTASK_VUE__`, `window.__ANNOTASK_COMPONENTS__`, and the floating toggle button into the output.

Whether this is a real problem depends on how users configure their Vite setup. Most will only include `annotask()` in dev mode. But the plugin doesn't enforce this, and there's no warning if it runs during build.

### The shell is too monolithic for what it does

`App.vue` handles selection, route tracking, iframe events, coordinate transforms, six overlay types, task creation, keyboard shortcuts, context menus, annotation restoration, and 300+ lines of CSS. It works, but adding features here means understanding all the state interactions.

The composables help but create their own problem: module-level singletons with side-effectful initialization on first import. `useStyleEditor`, `useTasks`, and `useDesignSpec` all start WebSocket connections or fetch data as a side effect of being imported. This makes the initialization order implicit and hard to test.

### API validation is absent

`src/plugin/api.ts` parses request bodies with `JSON.parse` and passes them directly to `addTask` or `updateTask` with no validation. Malformed JSON crashes the middleware. Valid JSON with wrong shapes silently corrupts task storage. This is acceptable for local dev tools, but it makes debugging mysterious — a bad task payload will produce a corrupt `tasks.json` that causes silent failures later.

### WebSocket setup is duplicated

Three composables (`useStyleEditor`, `useTasks`, `useDesignSpec`) each independently create WebSocket connections to the same endpoint. They each handle connection, reconnection, and message parsing separately. This is three connections to the same server, three reconnection timers, and three JSON parse paths that could diverge.

### Schema types exceed runtime emission

The schema defines `class_update`, `scoped_style_update`, `prop_update`, and `component_delete`. None of these are emitted by the shell. The schema is aspirational, which is fine for a roadmap, but consumers building against these types today will get nothing.

### Route tracking polls at 500ms

`App.vue` polls `iframe.contentWindow.location.pathname` every 500ms to detect SPA navigation. This works but is wasteful and introduces up to 500ms latency on route detection. Listening to `popstate` events on the iframe window or using a `MutationObserver` on the iframe's location would be more responsive.

---

## Design spec and theme system

The recently added design spec system (`DesignSpecToken`, `AnnotaskDesignSpec`, `ThemePage.vue`) is well-designed for its purpose:

- Tokens carry semantic roles, resolved values, CSS variable names, and source locations
- The theme page provides inline editing with live CSS variable preview in the iframe
- Task creation generates one task per token change with full context for LLM application
- The init skill has a clear fixed vocabulary for color roles

One issue: the theme preview mechanism (`useThemePreview.ts`) only works for tokens backed by CSS variables. For hardcoded values (like the playground's font sizes and border radii), there's no preview. The UI shows "no preview" for colors without `cssVar`, but doesn't indicate this for typography/spacing/border tokens. Users might edit a value, see no change in the iframe, and think it's broken.

The design spec also doesn't round-trip: when the LLM applies a `theme_update` task, it's told to update `design-spec.json`, but there's no automated mechanism to regenerate the spec from source truth. The spec could drift from reality between `/init-annotask` runs.

---

## Things nobody else mentioned

### The `insertPlaceholder` innerHTML is an XSS surface

`src/shell/composables/useStyleEditor.ts:353` uses `innerHTML` with interpolated values:

```typescript
el.innerHTML = `...${item.tag}...${item.library || 'component'}...`
```

`item.tag` and `item.library` come from `CatalogItem` which is currently hardcoded. But if component catalog items are ever populated from scanned code or user input, this becomes an XSS vector in the iframe context. Since the iframe runs the user's own app, the risk is self-XSS rather than cross-site, but it's still worth sanitizing.

### The change collapse key is element-blind

Changes are collapsed by `file:line:property`, not by element identity. If two sibling elements share the same source line (possible with single-line template patterns like `<div><span>A</span><span>B</span></div>`), editing one will update the other's change record. The change report will show one change instead of two, with the second edit's value but the first edit's baseline.

### Task-annotation cleanup uses coordinate matching, not IDs

`App.vue:72-81` removes visual annotations when tasks are accepted by matching x/y coordinates within a 5-pixel tolerance:

```typescript
const arrow = annotations.arrows.value.find(a =>
  Math.abs(a.fromX - v.fromX) < 5 && Math.abs(a.fromY - v.fromY) < 5
)
```

If two arrows start near the same point, accepting one task could remove the wrong arrow. This is fragile — annotations should carry task IDs, not rely on spatial proximity.

### The CLI exits on disconnect with no retry

`src/cli/index.ts:72` exits the process when the WebSocket closes. If Vite's HMR causes a brief server restart, the CLI dies and the user has to restart it. The shell's composables all implement reconnection (3-second retry). The CLI should do the same.

### `ws` is a runtime dependency but should be dev-only

`package.json` lists `ws` in `dependencies`, not `devDependencies`. Since the plugin only runs as a Vite dev server middleware, `ws` should be a dev dependency. Users who install the plugin in production will pull in the `ws` package unnecessarily.

---

## What I would do next

The project has enough surface area. It doesn't need more features. It needs the existing features to be trustworthy.

1. **Fix the four correctness bugs**: style baseline capture, line number offset, report project metadata, class edit recording. These are all small fixes with outsized impact on trust.
2. **Add tests for the transform and style editor**. These are the most load-bearing code paths and both have known bugs. Even 10-15 targeted unit tests would catch regressions.
3. **Consolidate WebSocket connections**. One shared connection composable, three listeners. This eliminates duplicated reconnection logic and reduces server load.
4. **Guard the transform plugin against production builds**. Check `config.command === 'serve'` in the transform plugin, not just the serve plugin.

After those: refactor `App.vue` into an editor view component, add input validation to the API, and consider replacing the character scanner with `@vue/compiler-sfc` AST walking.

The project is in a good position. The architecture is sound, the product vision is clear, and the interaction model works. The gap between "prototype that demonstrates the idea" and "tool you can trust" is smaller than it looks — it's mostly about making the data pipeline honest.
