import styles from './Hero.module.css'

export default function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.gradient} aria-hidden="true" />
      <div className={styles.inner}>
        <span className={styles.eyebrow}>v0.0.22 — now with richer task summaries</span>

        <h1 className={styles.headline}>
          Visual tasking <br />
          for AI-coded apps.
        </h1>

        <p className={styles.subhead}>
          Click any element in your dev server. Edit it. Annotate it. Annotask captures the
          intent and your coding agent applies the change.
        </p>

        <div className={styles.ctaRow}>
          <a href="#waitlist" className={styles.primary}>
            Get started — it's free
          </a>
          <a href="#features" className={styles.secondary}>
            See how it works →
          </a>
        </div>

        <ul className={styles.statRow} aria-label="Adoption stats">
          <li>
            <strong>0</strong>
            <span>installs</span>
          </li>
          <li>
            <strong>2</strong>
            <span>GitHub stars</span>
          </li>
          <li>
            <strong>1</strong>
            <span>contributors</span>
          </li>
          <li>
            <strong>4</strong>
            <span>frameworks</span>
          </li>
        </ul>

      </div>
    </section>
  )
}
