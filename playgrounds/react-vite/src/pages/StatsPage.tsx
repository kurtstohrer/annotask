import { useState, useEffect } from 'react'
import LoadingOrbit from '../components/LoadingOrbit'

interface Stats {
  total_planets: number
  total_moons: number
  largest_planet: string
  smallest_planet: string
  hottest_planet: string
  coldest_planet: string
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

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
  gap: '20px',
}

const cardStyle: React.CSSProperties = {
  backgroundColor: '#111827',
  border: '1px solid #1e293b',
  borderRadius: '10px',
  padding: '28px',
}

const cardLabelStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#64748b',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '8px',
}

const cardValueStyle: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 700,
  color: '#e0e6f0',
}

const cardValueSmallStyle: React.CSSProperties = {
  fontSize: '22px',
  fontWeight: 700,
  color: '#e0e6f0',
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

function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/stats')
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch stats (${res.status})`)
        return res.json()
      })
      .then((data) => {
        setStats(data)
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
        <h1 style={headingStyle}>Stats</h1>
        <LoadingOrbit />
      </div>
    )
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <h1 style={headingStyle}>Stats</h1>
        <div style={errorStyle}>Error: {error}</div>
      </div>
    )
  }

  if (!stats) return null

  const statCards = [
    { label: 'Total Planets', value: stats.total_planets, large: true },
    { label: 'Total Moons', value: stats.total_moons, large: true },
    { label: 'Largest Planet', value: stats.largest_planet, large: false },
    { label: 'Smallest Planet', value: stats.smallest_planet, large: false },
    { label: 'Hottest Planet', value: stats.hottest_planet, large: false },
    { label: 'Coldest Planet', value: stats.coldest_planet, large: false },
  ]

  return (
    <div style={containerStyle}>
      <h1 style={headingStyle}>Stats</h1>
      <p style={subtitleStyle}>Solar system at a glance</p>

      <div style={gridStyle}>
        {statCards.map((card) => (
          <div key={card.label} style={cardStyle}>
            <div style={cardLabelStyle}>{card.label}</div>
            <div style={card.large ? cardValueStyle : cardValueSmallStyle}>
              {card.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default StatsPage
