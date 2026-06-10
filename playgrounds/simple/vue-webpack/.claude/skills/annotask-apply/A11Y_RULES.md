# A11Y Rules

Read this file for `a11y_fix` tasks. If you are applying a batch of a11y tasks, read it once for the batch, not once per task.

## Task context

The `a11y_fix` task `context` contains:

- `rule`: axe rule ID, or Annotask's synthetic `tab-order` rule
- `impact`, `help`, `helpUrl`
- `elements[]`: offending elements with `html`, `selector`, `fix`, source `file` / `line` / `component`
- `elements[i].a11y`: computed accessibility metadata for the specific element

```text
elements[i].a11y = {
  accessible_name, name_source,
  role, role_source,
  tabindex, focusable,
  focus_indicator,
  contrast,
  aria_attrs,
}
```

If `screenshot_meta` is present, retrieve it via `annotask_get_screenshot` before proposing visual changes such as contrast or focus-ring fixes.

## Rule playbook

Match on `context.rule`.

| Rule(s) | Fix layer | What to do |
|---|---|---|
| `color-contrast`, `color-contrast-enhanced` | Design tokens first | See **Color contrast playbook** below. |
| `label`, `form-field-multiple-labels` | Markup | Wrap input in `<label>` or add `aria-labelledby` that points at visible text. If `name_source === 'placeholder'`, the input still has no real label. |
| `button-name`, `link-name`, `input-button-name` | Markup | Add visible text or `aria-label`. For icon-only buttons, add a visually hidden label (`sr-only` or the project equivalent). Do not rely on `title`. |
| `image-alt`, `role-img-alt`, `svg-img-alt` | Markup | Use `alt=""` for decorative imagery and descriptive `alt` for informational imagery. For SVG icons paired with visible text, use `aria-hidden="true"`. |
| `landmark-one-main`, `region`, `landmark-no-duplicate-banner`, `landmark-no-duplicate-contentinfo` | Layout component | Wrap the page's primary content in `<main>`. Add `role="region"` + `aria-label` to top-level layout containers. These usually live in layout/root files, not leaf components. |
| `heading-order`, `page-has-heading-one`, `empty-heading` | Content/layout | Insert or promote `<h1>`, then renumber subsequent heading levels so the outline is contiguous. Usually a layout or section change. |
| `aria-allowed-attr`, `aria-required-attr`, `aria-valid-attr-value`, `aria-roles`, `aria-required-children`, `aria-required-parent` | Markup | Read `elements[i].a11y.role` and `aria_attrs` to see exactly what is set. Use `helpUrl` to confirm the role's allowed and required attributes, then remove or add attributes accordingly. |
| `aria-hidden-focus`, `aria-hidden-body` | Markup | An element with `aria-hidden="true"` cannot contain focusable descendants. Remove `aria-hidden`, move the focusable elements out, or make them unfocusable with `tabindex="-1"` if appropriate. |
| `tabindex`, `tab-order` | Markup | Remove positive `tabindex`; use `0` for normal DOM-order focus or `-1` for programmatic focus only. For synthetic `tab-order`, inspect `context.tab_order.flag` (`positive`, `unreachable`, `reorder`) and make DOM order match visual order. |
| `meta-viewport`, `html-has-lang`, `html-lang-valid`, `document-title`, `meta-refresh` | Document head | Fix the framework's document-level source of truth: `index.html`, `app/layout.tsx`, `src/routes/+layout.svelte`, or the equivalent root document. |
| `focus-order-semantics`, `nested-interactive` | Markup | Use semantic interactive elements (`<button>`, `<a href>`, `<input>`) instead of clickable `<div>` or `<span>`. Do not nest interactive elements. |
| `bypass`, `skip-link` | Layout component | Add a "Skip to main content" link as the first focusable element in the layout. Use the project's visually-hidden pattern that becomes visible on `:focus`. |
| `duplicate-id`, `duplicate-id-active`, `duplicate-id-aria` | Markup | Search the codebase for hardcoded `id="..."` values and rename one. If the id is generated, make the generation key unique per instance. |
| `frame-title`, `iframe-title` | Markup | Add `title="..."` describing the iframe's purpose. |

## Color contrast playbook

Use this when `context.rule` is `color-contrast` or `color-contrast-enhanced`. The goal is to land **one token-level edit** that fixes the violation on the first try, without spraying inline overrides or hardcoded hex into component CSS.

1. **Read the structured contrast block first.** `elements[i].a11y.contrast` gives you `foreground`, `background`, and `ratio` as actual computed hex. Treat these as facts; do not re-derive from screenshots.
2. **Open the source at `elements[i].file:line` and locate the failing CSS rule.** Identify how `color` and `background`/`background-color` are set:
   - `var(--token-name)` → token-level fix (preferred).
   - hardcoded hex / `rgb()` / `hsl()` → component-level fix.
   - inline `style={…}` / `style="…"` → component-level fix on that one instance.
   - Tailwind / utility class (e.g. `bg-blue-500 text-white`) → swap utility classes or extend the project's theme config; do not add ad-hoc inline overrides.
3. **For the token path** — the common case in design-system playgrounds:
   - Find the variable's definition (typically a `:root` / `:root[data-theme="*"]` block in `tokens.css`, `globals.css`, `theme.css`, or equivalent). Use `grep` for `--token-name:` if you have to.
   - Edit the variable **at its definition**, inside the theme block that matches the current `color_scheme` on the task (`dark` vs `light`). Do not redefine the variable on the component selector — that bypasses the design system and breaks every other consumer.
   - If both themes look like they fail, fix the variable in each theme block separately, computing per-theme.
4. **Pick which token to move.** When both `color` and `background` are tokens, default to:
   - **Brand background + white/near-white text (`--accent` + `--text-on-accent`):** keep the white text token, darken the brand token. Brand tokens earn their lightness; light text on brand is almost always the intended pattern, and darkening the brand by ~10–20% luminance is usually the smallest visible change.
   - **Muted text on neutral surface (`--text-muted`, `--text-subtle` on `--surface*`):** lighten the text token, do not darken the surface. Surface tokens drive layout perception and many components consume them.
   - **Disabled/placeholder text:** if the project intentionally uses a low-contrast token, keep the rule failure scoped to that pattern and fix only the offending public-facing instance, not the token.
5. **Choose the new value by luminance, not by eye.** For text vs. opaque background, target ≥4.5:1 (normal text) or ≥3:1 (large/bold ≥18pt or 14pt+700). Move the token in **one direction only** (darken bg *or* lighten fg) — do not split the fix across both ends. After editing, the diff should be one line in the tokens file.
6. **Sanity-check sibling tokens.** If you darken `--accent`, glance at `--accent-strong` (the hover/pressed variant) and `--accent-soft` (low-opacity surfaces). If `--accent-strong` is already darker than your new `--accent` value, leave it. If it's now lighter, slide it darker by the same delta so the brand ramp stays monotonic.
7. **Do not touch the component CSS.** A clean token fix has no edits in the component file. If you find yourself opening the component to override the variable, stop — you are about to re-introduce the instance-level pattern the playbook is trying to prevent.

The agent should also confirm the re-render passes after applying: the user's a11y panel re-scans automatically once the file saves, and the violation should drop off. If it doesn't, the wrong token was moved or the change landed in the wrong theme block.

## General rules

- Prefer pattern fixes over instance fixes. If many entries point at the same file or component, fix the source component once.
- For synthetic `tab-order`, the offending element is in `elements[0].a11y.eid` and the failure type is in `context.tab_order.flag`. There is no axe `helpUrl`; use the WCAG page in `context.helpUrl`.
- When `a11y.accessible_name` is empty and `a11y.focusable` is true, naming is usually the highest-priority fix.
- Layout and document-head rules usually belong in root or layout files, not the selected leaf component.
