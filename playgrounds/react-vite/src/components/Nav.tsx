import { Link, NavLink } from 'react-router-dom'
import styles from './Nav.module.css'

interface NavProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export default function Nav({ theme, onToggleTheme }: NavProps) {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link to="/" className={styles.brand}>
          <span className={styles.logoMark} aria-hidden="true">
            <img src="/annotask-logo.svg" alt="" className={styles.logoImage} />
          </span>
          <span className={styles.logoText}>annotask</span>
        </Link>

        <nav className={styles.links} aria-label="Primary">
          <a href="/#features" className={styles.link}>Features</a>
          <a href="/#pricing" className={styles.link}>Pricing</a>
          <NavLink to="/integrations" className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}>
            Integrations
          </NavLink>
          <NavLink to="/changelog" className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ''}`}>
            Changelog
          </NavLink>
        </nav>

        <div className={styles.actions}>
          <button
            className={styles.themeToggle}
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <a href="#waitlist" className={styles.cta}>Get started</a>
          <a href="https://github.com/kurtstohrer/annotask" className={styles.ghostBtn} target="_blank" rel="noreferrer">
            Star on GitHub
          </a>
        </div>
      </div>
    </header>
  )
}
