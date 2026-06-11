import { useEffect, useState } from 'react'
import PlanetCard, { type Planet } from '../components/PlanetCard'

// Minimal mirror of vue-vite's /planets page: fetches the same API and renders
// a .map() loop of PlanetCard — literal text (h1), a bound prop (planet), and
// loop rendering for the design-tool acceptance checks. No search/filter
// parity needed.
export default function Planets() {
  const [planets, setPlanets] = useState<Planet[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/solar/planets?sort_by=distance_from_sun_mkm')
      .then((res) => {
        if (!res.ok) throw new Error('api')
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setPlanets(Array.isArray(data?.planets) ? data.planets : Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setError('Could not load planets — is the API running?')
      })
    return () => { cancelled = true }
  }, [])

  return (
    <section className="planets-page" style={{ padding: '32px 24px', maxWidth: 960, margin: '0 auto' }}>
      <h1 className="title">Planets</h1>
      <p className="subtitle">{planets.length} worlds in the catalog</p>
      {error && <p className="error">{error}</p>}
      <div className="grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
        {planets.map((planet) => (
          <PlanetCard key={planet.id} planet={planet} active={false} />
        ))}
      </div>
    </section>
  )
}
