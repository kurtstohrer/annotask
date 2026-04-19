// Deterministic seed data used by every MFE and mirrored by every service
// for offline demos. Changing these values in a single place re-styles
// what every frontend renders, which is a handy annotask cascade target.

import type {
  ComponentUsage,
  MetricSeries,
  Product,
  Workflow,
} from '@annotask/stress-contracts'

export const workflows: Workflow[] = [
  { id: 'wf-1', title: 'New lease request',   status: 'pending',      owner: 'amir',    created_at: '2026-04-18T09:12:00Z' },
  { id: 'wf-2', title: 'Invoice adjustment',  status: 'review',       owner: 'priya',   created_at: '2026-04-18T10:04:00Z' },
  { id: 'wf-3', title: 'Access revocation',   status: 'pending',      owner: 'dana',    created_at: '2026-04-18T10:22:00Z' },
  { id: 'wf-4', title: 'Vendor onboarding',   status: 'in_progress',  owner: 'jin',     created_at: '2026-04-18T11:48:00Z' },
  { id: 'wf-5', title: 'Quarterly audit',     status: 'accepted',     owner: 'amir',    created_at: '2026-04-17T14:00:00Z' },
  { id: 'wf-6', title: 'Data retention sweep', status: 'denied',      owner: 'priya',   created_at: '2026-04-17T16:10:00Z' },
]

export const products: Product[] = [
  { id: 'p-1', name: 'Field telemetry node', category: 'hardware', price_cents: 29900, in_stock: true  },
  { id: 'p-2', name: 'Edge relay gateway',   category: 'hardware', price_cents: 59900, in_stock: false },
  { id: 'p-3', name: 'Observability plan',   category: 'software', price_cents: 19900, in_stock: true  },
  { id: 'p-4', name: 'Fleet support (yr)',   category: 'service',  price_cents: 120000, in_stock: true  },
]

export const metrics: MetricSeries[] = [
  {
    name: 'requests_per_second',
    unit: 'rps',
    points: [
      { t: '2026-04-18T09:00:00Z', value: 412 },
      { t: '2026-04-18T09:05:00Z', value: 501 },
      { t: '2026-04-18T09:10:00Z', value: 478 },
      { t: '2026-04-18T09:15:00Z', value: 533 },
      { t: '2026-04-18T09:20:00Z', value: 620 },
      { t: '2026-04-18T09:25:00Z', value: 587 },
    ],
  },
  {
    name: 'p95_latency_ms',
    unit: 'ms',
    points: [
      { t: '2026-04-18T09:00:00Z', value: 82 },
      { t: '2026-04-18T09:05:00Z', value: 91 },
      { t: '2026-04-18T09:10:00Z', value: 87 },
      { t: '2026-04-18T09:15:00Z', value: 103 },
      { t: '2026-04-18T09:20:00Z', value: 118 },
      { t: '2026-04-18T09:25:00Z', value: 95 },
    ],
  },
]

export const componentUsage: ComponentUsage[] = [
  { id: 'cu-1', name: 'Button',   framework: 'React',  library: 'mantine',   uses: 42 },
  { id: 'cu-2', name: 'Card',     framework: 'React',  library: 'mantine',   uses: 28 },
  { id: 'cu-3', name: 'NButton',  framework: 'Vue',    library: 'naive-ui',  uses: 37 },
  { id: 'cu-4', name: 'NDataTable', framework: 'Vue',  library: 'naive-ui',  uses: 14 },
  { id: 'cu-5', name: 'Button',   framework: 'Solid',  library: 'kobalte',   uses: 19 },
  { id: 'cu-6', name: 'Dialog',   framework: 'Svelte', library: 'bits-ui',   uses: 11 },
]
