import styles from './HowItWorks.module.css'

const STEPS = [
  {
    n: 1,
    title: 'Open your dev server',
    body: 'Annotask runs as a Vite or Webpack plugin. The shell is served at /__annotask/ alongside your app — no separate process, no SaaS account.',
  },
  {
    n: 2,
    title: 'Click, edit, annotate',
    body: 'Inspect any element, edit its styles live, drop a pin, draw a section, or run an a11y scan. Every action becomes a structured task.',
  },
  {
    n: 3,
    title: 'Your agent applies it',
    body: 'Claude, Cursor, or any MCP-compatible agent picks up tasks via the bundled MCP server, applies them to source, and posts back for review.',
  },
]

export default function HowItWorks() {
  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>How it works</span>
          <h2 className={styles.title}>Three steps from sketch to merged PR.</h2>
        </header>

        <ol className={styles.steps}>
          {STEPS.map((s) => (
            <li key={s.n} className={styles.step}>
              <span className={styles.stepNumber}>{s.n}</span>
              <h3 className={styles.stepTitle}>{s.title}</h3>
              <p className={styles.stepBody}>{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
