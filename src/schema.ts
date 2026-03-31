export interface ViewportInfo {
  width: number | null
  height: number | null
}

export interface InteractionEntry {
  event: string
  route?: string
  data: Record<string, unknown>
}

export interface InteractionSnapshot {
  current_route: string
  navigation_path: string[]
  recent_actions: InteractionEntry[]
}

export interface AnnotaskReport {
  version: '1.0'
  project: {
    framework: 'vue' | 'react' | 'svelte'
    styling: string[]
    root: string
  }
  viewport?: ViewportInfo
  interaction_history?: InteractionSnapshot
  changes: AnnotaskChange[]
}

export type AnnotaskChange =
  | StyleUpdateChange
  | ClassUpdateChange
  | ScopedStyleUpdateChange
  | PropUpdateChange
  | ComponentInsertChange
  | ComponentMoveChange
  | ComponentDeleteChange
  | AnnotationChange
  | SectionRequestChange

interface BaseChange {
  id: string
  description: string
  file: string
  section: 'template' | 'style' | 'script'
  line: number
  component?: string
  mfe?: string
  viewport?: ViewportInfo
}

/** Direct inline style change on an element (from visual editing) */
export interface StyleUpdateChange extends BaseChange {
  type: 'style_update'
  element: string
  property: string
  before: string
  after: string
}

/** Tailwind/utility class changes */
export interface ClassUpdateChange extends BaseChange {
  type: 'class_update'
  element: string
  before: { classes: string }
  after: { classes: string }
}

/** @experimental Not yet emitted at runtime. CSS rules in <style scoped> */
export interface ScopedStyleUpdateChange extends BaseChange {
  type: 'scoped_style_update'
  selector: string
  before: Record<string, string> | null
  after: Record<string, string>
}

/** @experimental Not yet emitted at runtime. Component prop value changes */
export interface PropUpdateChange extends BaseChange {
  type: 'prop_update'
  component: string
  before: Record<string, unknown>
  after: Record<string, unknown>
}

/** Insert a new element/component */
export interface ComponentInsertChange extends BaseChange {
  type: 'component_insert'
  insert_inside?: { component?: string; element?: string; slot?: string }
  insert_position: 'append' | 'prepend' | 'before' | 'after'
  component: {
    tag: string
    library?: string
    props?: Record<string, unknown>
    classes?: string
    text_content?: string
  }
  data_context?: {
    endpoint: string
    response_schema: Record<string, unknown>
  }
}

/** Move/reorder an element */
export interface ComponentMoveChange extends BaseChange {
  type: 'component_move'
  element: {
    tag: string
    component?: string
    from_file: string
    from_line: number
  }
  move_to: {
    target_file: string
    target_line: number
    position: 'before' | 'after' | 'append' | 'prepend'
  }
}

/** @experimental Not yet emitted at runtime. Remove an element */
export interface ComponentDeleteChange extends BaseChange {
  type: 'component_delete'
  element: { component: string }
}

/** Annotation — user intent for AI agent */
export interface AnnotationChange extends BaseChange {
  type: 'annotation'
  intent: string
  action?: string
  context?: {
    element_tag?: string
    element_classes?: string
    parent_layout?: string
    siblings_count?: number
  }
}

/** Section request — drawn rectangle with prompt for new content */
export interface SectionRequestChange extends BaseChange {
  type: 'section_request'
  position: {
    near_element?: string
    placement?: 'above' | 'below' | 'left' | 'right'
  }
  dimensions: {
    width: string
    height: string
  }
  prompt: string
}

/** Simplified DOM node for element context */
export interface ElementNode {
  tag: string
  classes?: string
  text?: string
  children?: ElementNode[]
  childrenTruncated?: number
}

/** Ancestor layout info */
export interface AncestorInfo {
  tag: string
  display: string
  classes?: string
  component?: string
  flexDirection?: string
  gridTemplateColumns?: string
  gridTemplateRows?: string
  gap?: string
  overflow?: string
  childCount?: number
}

/** Element context: parent layout chain + child structure */
export interface ElementContext {
  ancestors: AncestorInfo[]
  subtree: ElementNode
}

/** Task in the review pipeline */
export interface AnnotaskTask {
  id: string
  type: string              // annotation, style_update, text_edit, section_request, etc.
  description: string
  file: string
  line: number
  component?: string
  mfe?: string              // MFE identity (e.g. '@myorg/my-mfe') for multi-project setups
  status: 'pending' | 'applied' | 'review' | 'accepted' | 'denied'
  intent?: string
  action?: string
  context?: Record<string, unknown>
  viewport?: ViewportInfo
  interaction_history?: InteractionSnapshot
  element_context?: ElementContext
  feedback?: string         // denial notes from reviewer
  createdAt: number
  updatedAt: number
}

export interface AnnotaskTaskList {
  version: '1.0'
  tasks: AnnotaskTask[]
}

/** A single design token with semantic role and source tracking */
export interface DesignSpecToken {
  role: string          // semantic: 'primary', 'background', 'heading-font', 'base-size', etc.
  value: string         // resolved: '#3b82f6', 'Inter, sans-serif', '16px'
  cssVar?: string       // '--color-primary' (enables live preview when present)
  source: string        // human-readable: 'var(--color-primary)', 'tailwind.config:colors.primary'
  sourceFile?: string   // 'src/assets/main.css'
  sourceLine?: number   // 12
}

/** Design spec generated by /annotask-init skill */
export interface AnnotaskDesignSpec {
  version: '1.0'
  framework: {
    name: string
    version: string
    styling: string[]
  }
  colors: DesignSpecToken[]
  typography: {
    families: DesignSpecToken[]
    scale: DesignSpecToken[]
    weights: string[]
  }
  spacing: DesignSpecToken[]
  borders: {
    radius: DesignSpecToken[]
  }
  breakpoints?: Record<string, string>
  icons: {
    library: string
    version?: string
  } | null
  components: {
    library: string
    version?: string
    used: string[]
  } | null
}

/** @deprecated Use AnnotaskDesignSpec instead */
export interface AnnotaskConfig {
  version: '1.0'
  framework: {
    name: string
    version: string
    styling: string[]
  }
  tokens: {
    colors: Record<string, string>
    spacing: Record<string, string>
    fonts: Record<string, string>
  }
  layouts: Array<{
    name: string
    classes: string
    description: string
  }>
  componentUnits: Array<{
    selector: string
    elements: string[]
    description: string
  }>
  library: {
    name: string
    version?: string
    components: string[]
  } | null
}
