/** Typed fetch helpers for the Countries API. */

export interface Country {
  cca2: string
  cca3: string
  name: string
  official_name: string
  capital: string
  region: string
  subregion: string
  population: number
  area_km2: number
  currencies: string[]
  languages: string[]
  flag_emoji: string
  neighbors: string[]
  density: number | null
}

export interface CountryListResponse {
  countries: Country[]
  total: number
}

export interface RegionsResponse {
  regions: { region: string; subregions: string[] }[]
}

export interface CompareResponse {
  countries: Country[]
  fields: string[]
}

export interface ListParams {
  region?: string
  subregion?: string
  search?: string
  sort_by?: 'name' | 'population' | 'area_km2'
  sort_desc?: boolean
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

export function getCountries(params: ListParams = {}): Promise<CountryListResponse> {
  const qs = new URLSearchParams()
  if (params.region) qs.set('region', params.region)
  if (params.subregion) qs.set('subregion', params.subregion)
  if (params.search) qs.set('search', params.search)
  if (params.sort_by) qs.set('sort_by', params.sort_by)
  if (params.sort_desc) qs.set('sort_desc', 'true')
  const query = qs.toString()
  return getJSON<CountryListResponse>(`/api/countries${query ? `?${query}` : ''}`)
}

export const getCountry = (cca2: string) => getJSON<Country>(`/api/countries/${cca2}`)

export const getRegions = () => getJSON<RegionsResponse>('/api/countries/regions')

export const compareCountries = (codes: string[]) =>
  getJSON<CompareResponse>(`/api/countries/compare?codes=${codes.join(',')}`)
