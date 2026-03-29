import { useState, useEffect } from 'react'
import LoadingOrbit from '../components/LoadingOrbit'

interface Planet {
  id: number
  name: string
  type: string
  radius_km: number
  gravity_ms2: number
  avg_temp_c: number
  moons: number
  distance_from_sun_mkm: number
  orbital_period_days: number
  discovered_by: string
  description: string
  color: string
}

const containerStyle: React.CSSProperties = {}

const headingStyle: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  marginBottom: '8px',
  color: '#e0e6f0',
}

const subtitleStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#64748b',
  marginBottom: '32px',
}

const tableWrapperStyle: React.CSSProperties = {
  overflowX: 'auto',
  borderRadius: '10px',
  border: '1px solid #1e293b',
  backgroundColor: '#111827',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '14px',
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '14px 20px',
  borderBottom: '1px solid #1e293b',
  color: '#94a3b8',
  fontWeight: 600,
  fontSize: '12px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const tdStyle: React.CSSProperties = {
  padding: '14px 20px',
  borderBottom: '1px solid #1e293b',
  color: '#cbd5e1',
}

const nameStyle: React.CSSProperties = {
  ...tdStyle,
  fontWeight: 600,
  color: '#e0e6f0',
}

const nameCellStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
}

const typeBadgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: '9999px',
  fontSize: '12px',
  fontWeight: 500,
}

const loadingStyle: React.CSSProperties = {
  fontSize: '16px',
  color: '#94a3b8',
  padding: '40px 0',
  textAlign: 'center',
}

const errorStyle: React.CSSProperties = {
  fontSize: '15px',
  color: '#f87171',
  backgroundColor: '#1c1017',
  border: '1px solid #7f1d1d',
  borderRadius: '10px',
  padding: '20px 24px',
}

function getTypeBadgeStyle(type: string): React.CSSProperties {
  switch (type) {
    case 'Terrestrial':
      return { ...typeBadgeBase, backgroundColor: '#064e3b', color: '#6ee7b7' }
    case 'Gas Giant':
      return { ...typeBadgeBase, backgroundColor: '#4c1d95', color: '#c4b5fd' }
    case 'Ice Giant':
      return { ...typeBadgeBase, backgroundColor: '#1e3a5f', color: '#7dd3fc' }
    case 'Dwarf':
      return { ...typeBadgeBase, backgroundColor: '#3b1a00', color: '#fdba74' }
    default:
      return { ...typeBadgeBase, backgroundColor: '#1e293b', color: '#94a3b8' }
  }
}

function formatDistance(mkm: number): string {
  if (mkm >= 1000) {
    return `${(mkm / 1000).toFixed(1)}B km`
  }
  return `${mkm.toFixed(1)}M km`
}

function PlanetsPage() {
  const [planets, setPlanets] = useState<Planet[]>([])
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/planets')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch planets (${res.status})`)
        return res.json()
      })
      .then((data) => {
        setPlanets(data.planets)
        setTotal(data.total)
        setLoading(false)
      })
      .catch((err) => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  if (loading) {
    return (
      <div style={containerStyle}>
        <h1 style={headingStyle}>Planets</h1>
        <LoadingOrbit />
      </div>
    )
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <h1 style={headingStyle}>Planets</h1>
        <div style={errorStyle}>Error: {error}</div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <h1 style={headingStyle}>Planets</h1>
      <p style={subtitleStyle}>{total} planets in the solar system</p>

      <div style={tableWrapperStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Distance</th>
              <th style={thStyle}>Radius</th>
              <th style={thStyle}>Moons</th>
              <th style={thStyle}>Gravity</th>
            </tr>
          </thead>
          <tbody>
            {planets.map((planet, index) => (
              <tr
                key={planet.id}
                style={{
                  backgroundColor: index % 2 === 0 ? 'transparent' : '#0d1322',
                }}
              >
                <td style={nameStyle}>
                  <div style={nameCellStyle}>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: planet.color,
                        flexShrink: 0,
                      }}
                    />
                    {planet.name}
                  </div>
                </td>
                <td style={tdStyle}>
                  <span style={getTypeBadgeStyle(planet.type)}>{planet.type}</span>
                </td>
                <td style={tdStyle}>{formatDistance(planet.distance_from_sun_mkm)}</td>
                <td style={tdStyle}>{planet.radius_km.toLocaleString()} km</td>
                <td style={tdStyle}>{planet.moons}</td>
                <td style={tdStyle}>{planet.gravity_ms2} m/s²</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default PlanetsPage
