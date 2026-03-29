import { Routes, Route } from 'react-router-dom'
import Header from './components/Header'
import PlanetsPage from './pages/PlanetsPage'
import MoonsPage from './pages/MoonsPage'
import StatsPage from './pages/StatsPage'

const appStyle: React.CSSProperties = {
  minHeight: '100vh',
  backgroundColor: '#0a0e1a',
  color: '#e0e6f0',
  fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif",
  margin: 0,
  padding: 0,
}

const mainStyle: React.CSSProperties = {
  maxWidth: '1100px',
  margin: '0 auto',
  padding: '32px 24px',
}

function App() {
  return (
    <div style={appStyle}>
      <Header />
      <main style={mainStyle}>
        <Routes>
          <Route path="/" element={<PlanetsPage />} />
          <Route path="/planets" element={<PlanetsPage />} />
          <Route path="/moons" element={<MoonsPage />} />
          <Route path="/stats" element={<StatsPage />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
