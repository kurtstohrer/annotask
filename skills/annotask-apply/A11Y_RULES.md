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
| `color-contrast`, `color-contrast-enhanced` | Design tokens first | Read `elements[i].a11y.contrast` for the actual fg/bg hex + ratio. If the colors come from theme tokens, adjust the token. If the contrast comes from a one-off inline style or hardcoded class, fix the component instead of the shared token. |
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

## General rules

- Prefer pattern fixes over instance fixes. If many entries point at the same file or component, fix the source component once.
- For synthetic `tab-order`, the offending element is in `elements[0].a11y.eid` and the failure type is in `context.tab_order.flag`. There is no axe `helpUrl`; use the WCAG page in `context.helpUrl`.
- When `a11y.accessible_name` is empty and `a11y.focusable` is true, naming is usually the highest-priority fix.
- Layout and document-head rules usually belong in root or layout files, not the selected leaf component.
