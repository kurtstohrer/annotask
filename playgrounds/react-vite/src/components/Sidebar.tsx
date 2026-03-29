import { Link, useLocation } from 'react-router-dom'

const PlanetIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
)

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

const StatsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
)

const sidebarStyle: React.CSSProperties = {
  width: '220px',
  minHeight: '100vh',
  backgroundColor: '#111827',
  borderRight: '1px solid #1e293b',
  padding: '24px 0',
  display: 'flex',
  flexDirection: 'column',
  flexShrink: 0,
}

const logoStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  color: '#a78bfa',
  textDecoration: 'none',
  letterSpacing: '0.5px',
  padding: '0 20px',
  marginBottom: '32px',
  display: 'block',
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '0 12px',
}

const linkBase: React.CSSProperties = {
  color: '#94a3b8',
  textDecoration: 'none',
  padding: '10px 12px',
  borderRadius: '8px',
  fontSize: '14px',
  fontWeight: 500,
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  transition: 'background 0.15s, color 0.15s',
}

const linkActive: React.CSSProperties = {
  ...linkBase,
  color: '#e0e6f0',
  backgroundColor: '#1e293b',
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  padding: '0 12px',
  marginBottom: '8px',
}

function Sidebar() {
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
    <aside style={sidebarStyle}>
      <Link to="/" style={logoStyle}>
        Space Explorer
      </Link>
      <div style={sectionLabelStyle}>Navigation</div>
      <nav style={navStyle}>
        {links.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            style={isActive(link.to) ? linkActive : linkBase}
          >
            {link.icon}
            {link.label}
          </Link>
        ))}
      </nav>
    </aside>
  )
}

export default Sidebar
