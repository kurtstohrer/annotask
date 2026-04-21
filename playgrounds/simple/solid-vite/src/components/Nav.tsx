import styles from './Nav.module.css'

interface NavProps {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export default function Nav(props: NavProps) {
  return (
    <header class={styles.header}>
      <div class={styles.inner}>
        <a href="/" class={styles.brand}>
          <span class={styles.logoText}>annotask</span>
        </a>

        <nav class={styles.links} aria-label="Primary">
          <a href="#features" class={styles.link}>Features</a>
          <a href="#pricing" class={styles.link}>Pricing</a>
        </nav>

        <div class={styles.actions}>
          <button
            class={styles.themeToggle}
            onClick={props.onToggleTheme}
            aria-label={`Switch to ${props.theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {props.theme === 'dark' ? '\u2600' : '\u263E'}
          </button>
          <a href="#waitlist" class={styles.cta}>Get started</a>
        </div>
      </div>
    </header>
  )
}
