import { useState, useEffect } from 'react'
import LoadingOrbit from '../components/LoadingOrbit'

interface Moon {
  id: number
  name: string
  planet: string
  radius_km: number
  distance_km: number
  orbital_period_days: number
  discovered_by: string
  year_discovered: number
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

const planetBadgeStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#a78bfa',
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

function MoonsPage() {
  const [moons, setMoons] = useState<Moon[]>([])
  const [total, setTotal] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/moons')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch moons (${res.status})`)
        return res.json()
      })
      .then((data) => {
        setMoons(data.moons)
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
        <h1 style={headingStyle}>Moons</h1>
        <LoadingOrbit />
      </div>
    )
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <h1 style={headingStyle}>Moons</h1>
        <div style={errorStyle}>Error: {error}</div>
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <h1 style={headingStyle}>Moons</h1>
      <p style={subtitleStyle}>{total} moons across the solar system</p>

      <div style={tableWrapperStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Planet</th>
              <th style={thStyle}>Radius</th>
              <th style={thStyle}>Orbital Period</th>
              <th style={thStyle}>Discovered By</th>
              <th style={thStyle}>Year</th>
            </tr>
          </thead>
          <tbody>
            {moons.map((moon, index) => (
              <tr
                key={moon.id}
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
                        backgroundColor: moon.color,
                        flexShrink: 0,
                      }}
                    />
                    {moon.name}
                  </div>
                </td>
                <td style={tdStyle}>
                  <span style={planetBadgeStyle}>{moon.planet}</span>
                </td>
                <td style={tdStyle}>{moon.radius_km.toLocaleString()} km</td>
                <td style={tdStyle}>{moon.orbital_period_days} days</td>
                <td style={tdStyle}>{moon.discovered_by}</td>
                <td style={tdStyle}>{moon.year_discovered}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default MoonsPage
