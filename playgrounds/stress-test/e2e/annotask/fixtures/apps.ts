export type Framework = 'vue' | 'react' | 'svelte' | 'solid' | 'htmx' | 'vue-host'

export interface AppTarget {
  id: string
  port: number
  framework: Framework
  headingPattern: RegExp
}

export const APPS: AppTarget[] = [
  { id: 'host',                port: 4200, framework: 'vue-host', headingPattern: /Stress Lab|Annotask/i },
  { id: 'react-sidebar',       port: 4250, framework: 'react',    headingPattern: /Sidebar|Stress Lab/i },
  { id: 'react-workflows',     port: 4210, framework: 'react',    headingPattern: /Workflows/i },
  { id: 'vue-data-lab',        port: 4220, framework: 'vue',      headingPattern: /Vue Data Lab/i },
  { id: 'svelte-streaming',    port: 4230, framework: 'svelte',   headingPattern: /Svelte Streaming/i },
  { id: 'solid-component-lab', port: 4240, framework: 'solid',    headingPattern: /Solid Component Lab/i },
  { id: 'htmx-partials',       port: 4260, framework: 'htmx',     headingPattern: /htmx Partials/i },
]

export const APP_BY_ID: Record<string, AppTarget> = Object.fromEntries(APPS.map(a => [a.id, a]))

export const SKIP_MATRIX: Record<string, string[]> = {
  'htmx-partials': ['design-components', 'audit-libraries', 'audit-data'],
  'host':          ['design-components'],
}

export function isSkipped(appId: string, featureId: string): boolean {
  return (SKIP_MATRIX[appId] || []).includes(featureId)
}

export function shellUrl(app: AppTarget): string {
  return `http://localhost:${app.port}/__annotask/`
}

export function apiUrl(app: AppTarget, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  return `http://localhost:${app.port}/__annotask/api${clean}`
}
