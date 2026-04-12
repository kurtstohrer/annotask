import { Routes, Route } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Nav from './components/Nav'
import Footer from './components/Footer'
import Landing from './pages/Landing'
import Changelog from './pages/Changelog'
import Integrations from './pages/Integrations'

type Theme = 'dark' | 'light'

function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('annotask-marketing-theme')
    return stored === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('annotask-marketing-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return (
    <>
      <Nav theme={theme} onToggleTheme={toggleTheme} />
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/integrations" element={<Integrations />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}

export default App
