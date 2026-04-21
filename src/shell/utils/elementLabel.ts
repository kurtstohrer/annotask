// Format a selected/hovered element as `{ bracket, suffix }`, preferring the
// PascalCase component invocation name (`<Button>`) over the rendered DOM
// tag (`<div>`). See App.vue hover/selection overlays and PendingTaskPanel.
export interface ElementLabelInfo {
  tag: string
  component: string
  source_tag?: string
  parent_component?: string
}

const isPascal = (s?: string) => !!s && /^[A-Z]/.test(s)

export function formatElementLabel(info: ElementLabelInfo | null): { bracket: string; suffix: string } {
  if (!info) return { bracket: '', suffix: '' }
  // Preferred: data-annotask-source-tag is the JSX/template tag name as written
  // in source — "Button", "Flex", "PlanetCard". When it's PascalCase it identifies
  // a component invocation, even in frameworks (like React) where the rendered
  // DOM element doesn't carry a distinct data-annotask-component.
  if (isPascal(info.source_tag) && info.source_tag !== info.tag) {
    return { bracket: info.source_tag as string, suffix: info.component || '' }
  }
  // Fallback: element is the root of a custom component in frameworks that
  // forward attrs across component boundaries (Vue). Recognize by a different
  // PascalCase component on the ancestor chain.
  if (isPascal(info.component) && isPascal(info.parent_component) && info.parent_component !== info.component) {
    return { bracket: info.component, suffix: info.parent_component as string }
  }
  return { bracket: info.tag, suffix: info.component || '' }
}
