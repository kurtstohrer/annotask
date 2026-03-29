export interface Planet {
  id: number
  name: string
  type: 'Terrestrial' | 'Gas Giant' | 'Ice Giant'
  radius_km: number
  gravity_ms2: number
  avg_temp_c: number
  moons: number
  distance_from_sun_mkm: number
  orbital_period_days: number
  discovered_by: string | null
  description: string
  color: string
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

export interface Stats {
  total_planets: number
  total_moons: number
  largest_planet: string
  smallest_planet: string
  hottest_planet: string
  coldest_planet: string
}
