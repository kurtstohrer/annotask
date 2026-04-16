export type PlanetType = 'Terrestrial' | 'Gas Giant' | 'Ice Giant'

export interface Planet {
  id: number
  name: string
  type: PlanetType
  radius_km: number
  gravity_ms2: number
  avg_temp_c: number
  moons: number
  distance_from_sun_mkm: number
  orbital_period_days: number
  day_length_hours: number
  discovered_by: string | null
  description: string
  color: string
}

export interface PlanetListResponse {
  planets: Planet[]
  total: number
}

export interface Moon {
  id: number
  name: string
  planet: string
  radius_km: number
  distance_km: number
  orbital_period_days: number
  discovered_by: string | null
  year_discovered: number | null
  description: string
  color: string
}

export interface MoonListResponse {
  moons: Moon[]
  total: number
}

export interface SunLayer {
  name: string
  depth: string
  temp: string
  color: string
}

export interface Sun {
  type: string
  age_years: number
  radius_km: number
  surface_temp_c: number
  core_temp_c: number
  mass_kg: number
  luminosity_w: number
  composition: { hydrogen_pct: number; helium_pct: number; other_pct: number }
  layers: SunLayer[]
}

export interface SolarStats {
  total_planets: number
  total_moons: number
  largest_planet: string
  smallest_planet: string
  hottest_planet: string
  coldest_planet: string
  planet_with_most_moons: string
}
