import { createSignal } from 'solid-js'
import Nav from './components/Nav'
import Hero from './components/Hero'
import FeatureGrid from './components/FeatureGrid'
import Footer from './components/Footer'

type Theme = 'dark' | 'light'

export default function App() {
  const [theme, setTheme] = createSignal<Theme>(
    (localStorage.getItem('annotask-solid-theme') as Theme) ?? 'dark'
  )

  const toggleTheme = () => {
    const next = theme() === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('annotask-solid-theme', next)
  }

  // Set initial theme
  document.documentElement.setAttribute('data-theme', theme())

  return (
    <>
      <Nav theme={theme()} onToggleTheme={toggleTheme} />
      <main>
        <Hero />
        <FeatureGrid />
      </main>
      <Footer />
    </>
  )
}
