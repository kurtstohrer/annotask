/**
 * Typed fetch helpers for the Annotask marketing API.
 * All endpoints are proxied via Vite to http://localhost:8888.
 */

export interface Feature {
  id: number
  icon: string
  category: 'visual' | 'agent' | 'framework' | 'integration'
  title: string
  description: string
}

export interface Testimonial {
  id: number
  name: string
  role: string
  company: string
  avatar_url: string
  quote: string
  rating: number
}

export interface PricingTier {
  id: number
  name: string
  price_monthly: number | null
  billing: string
  highlighted: boolean
  cta_label: string
  features: string[]
}

export interface Integration {
  id: number
  name: string
  logo: string
  status: 'stable' | 'beta' | 'experimental'
  category: string
}

export interface ChangelogEntry {
  version: string
  date: string
  headline: string
  highlights: string[]
}

export interface MarketingStats {
  installs: number
  github_stars: number
  contributors: number
  frameworks_supported: number
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export const getFeatures = (category?: string) =>
  getJSON<Feature[]>(`/api/marketing/features${category ? `?category=${category}` : ''}`)

export const getTestimonials = () => getJSON<Testimonial[]>('/api/marketing/testimonials')

export const getPricing = () => getJSON<PricingTier[]>('/api/marketing/pricing')

export const getIntegrations = (status?: string) =>
  getJSON<Integration[]>(`/api/marketing/integrations${status ? `?status=${status}` : ''}`)

export const getChangelog = (limit = 10) =>
  getJSON<ChangelogEntry[]>(`/api/marketing/changelog?limit=${limit}`)

export const getStats = () => getJSON<MarketingStats>('/api/marketing/stats')

export async function joinWaitlist(email: string): Promise<{ ok: boolean; position: number }> {
  const res = await fetch('/api/marketing/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    throw new Error(detail.detail || `${res.status} ${res.statusText}`)
  }
  return res.json()
}
