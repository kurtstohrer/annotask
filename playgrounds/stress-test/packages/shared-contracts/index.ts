// Cross-MFE, cross-service contracts. Every MFE imports its data types from
// here so annotask can ground a task against a known shape regardless of
// which frontend or backend stack it runs in.

export type HealthStatus = 'ok' | 'degraded' | 'down'

export interface Health {
  status: HealthStatus
  service: string
  port: number
  version: string
}

export type WorkflowStatus = 'pending' | 'in_progress' | 'review' | 'accepted' | 'denied'

export interface Workflow {
  id: string
  title: string
  status: WorkflowStatus
  owner: string
  created_at: string
}

export interface Product {
  id: string
  name: string
  category: string
  price_cents: number
  in_stock: boolean
}

export interface MetricPoint {
  t: string
  value: number
}

export interface MetricSeries {
  name: string
  unit: string
  points: MetricPoint[]
}

export interface ComponentUsage {
  id: string
  name: string
  framework: string
  library: string
  uses: number
}
