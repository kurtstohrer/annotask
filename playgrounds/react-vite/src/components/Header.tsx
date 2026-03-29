import { Link, useLocation } from 'react-router-dom'

const PlanetIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

const StatsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
)

const headerStyle: React.CSSProperties = {
  backgroundColor: '#111827',
  borderBottom: '1px solid #1e293b',
  padding: '0 24px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: '64px',
}

const logoStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#a78bfa',
  textDecoration: 'none',
  letterSpacing: '0.5px',
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
}

const linkBase: React.CSSProperties = {
  color: '#94a3b8',
  textDecoration: 'none',
  padding: '8px 16px',
  borderRadius: '6px',
  fontSize: '14px',
  fontWeight: 500,
  transition: 'background 0.15s, color 0.15s',
}

const linkActive: React.CSSProperties = {
  ...linkBase,
  color: '#e0e6f0',
  backgroundColor: '#1e293b',
}

function Header() {
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/planets') {
      return location.pathname === '/' || location.pathname === '/planets'
    }
    return location.pathname === path
  }

  const links = [
    { to: '/planets', label: 'Planets', icon: <PlanetIcon /> },
    { to: '/moons', label: 'Moons', icon: <MoonIcon /> },
    { to: '/stats', label: 'Stats', icon: <StatsIcon /> },
  ]

  return (
    <header style={headerStyle}>
      <Link to="/" style={logoStyle}>
        Space Explorer
      </Link>
      <nav style={navStyle}>
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            style={isActive(link.to) ? linkActive : linkBase}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {link.icon}
              {link.label}
            </span>
          </Link>
        ))}
      </nav>
    </header>
  )
}

export default Header
