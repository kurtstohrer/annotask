export interface MetricSeries {
  value: number
  change_pct: number
  trend: number[]
}

export interface DashboardMetrics {
  active_users: MetricSeries
  mrr: MetricSeries
  error_rate: MetricSeries
  p95_latency_ms: MetricSeries
}

export interface User {
  id: number
  name: string
  email: string
  role: string
  status: 'active' | 'invited' | 'suspended'
  plan: 'Solo' | 'Team' | 'Enterprise'
  joined: string
  last_seen: string | null
}

export interface UserListResponse {
  users: User[]
  total: number
}

export interface Order {
  id: string
  customer: string
  plan: string
  seats: number
  amount_usd: number
  status: 'paid' | 'pending' | 'free' | 'refunded'
  created: string
}

export interface OrderListResponse {
  orders: Order[]
  total: number
}

export interface ActivityEntry {
  id: number
  ts: string
  actor: string
  action: string
  target: string
}

export interface AnalyticsBucket {
  day: string
  users: number
  sessions: number
  tasks: number
}

export interface AnalyticsResponse {
  range: string
  buckets: AnalyticsBucket[]
}
