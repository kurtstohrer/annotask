export interface CatalogItem {
  tag: string
  label: string
  category: 'layout-preset' | 'html-layout' | 'html-content' | 'html-form' | 'workspace' | 'library'
  library?: string
  defaultProps?: Record<string, unknown>
  defaultClasses?: string
  defaultTextContent?: string
}

export interface DropTarget {
  element: Element
  file: string
  line: string
  component: string
  position: 'before' | 'after' | 'append' | 'prepend'
}

export interface DropIndicatorRect {
  x: number
  y: number
  width: number
  height: number
  position: 'before' | 'after' | 'append' | 'prepend'
}

export const HTML_CATALOG: CatalogItem[] = [
  // Layout
  { tag: 'div', label: 'Div', category: 'html-layout' },
  { tag: 'section', label: 'Section', category: 'html-layout' },
  { tag: 'header', label: 'Header', category: 'html-layout' },
  { tag: 'footer', label: 'Footer', category: 'html-layout' },
  { tag: 'nav', label: 'Nav', category: 'html-layout' },
  { tag: 'main', label: 'Main', category: 'html-layout' },
  { tag: 'aside', label: 'Aside', category: 'html-layout' },
  // Content
  { tag: 'h1', label: 'Heading 1', category: 'html-content', defaultTextContent: 'Heading' },
  { tag: 'h2', label: 'Heading 2', category: 'html-content', defaultTextContent: 'Heading' },
  { tag: 'h3', label: 'Heading 3', category: 'html-content', defaultTextContent: 'Heading' },
  { tag: 'p', label: 'Paragraph', category: 'html-content', defaultTextContent: 'Text content' },
  { tag: 'span', label: 'Span', category: 'html-content', defaultTextContent: 'Text' },
  { tag: 'a', label: 'Link', category: 'html-content', defaultTextContent: 'Link', defaultProps: { href: '#' } },
  { tag: 'img', label: 'Image', category: 'html-content', defaultProps: { src: '', alt: '' } },
  { tag: 'ul', label: 'Unordered List', category: 'html-content' },
  { tag: 'li', label: 'List Item', category: 'html-content', defaultTextContent: 'Item' },
  // Forms
  { tag: 'button', label: 'Button', category: 'html-form', defaultTextContent: 'Button' },
  { tag: 'input', label: 'Input', category: 'html-form', defaultProps: { type: 'text', placeholder: '' } },
  { tag: 'textarea', label: 'Textarea', category: 'html-form' },
  { tag: 'select', label: 'Select', category: 'html-form' },
  { tag: 'label', label: 'Label', category: 'html-form', defaultTextContent: 'Label' },
]

export const LAYOUT_PRESETS: CatalogItem[] = [
  { tag: 'div', label: 'Flex Row', category: 'layout-preset', defaultClasses: 'flex flex-row gap-4' },
  { tag: 'div', label: 'Flex Column', category: 'layout-preset', defaultClasses: 'flex flex-col gap-4' },
  { tag: 'div', label: '2-Column Grid', category: 'layout-preset', defaultClasses: 'grid grid-cols-2 gap-4' },
  { tag: 'div', label: '3-Column Grid', category: 'layout-preset', defaultClasses: 'grid grid-cols-3 gap-4' },
  { tag: 'section', label: 'Section', category: 'layout-preset', defaultClasses: 'py-8' },
  { tag: 'div', label: 'Container', category: 'layout-preset', defaultClasses: 'w-full max-w-7xl mx-auto px-4' },
]
