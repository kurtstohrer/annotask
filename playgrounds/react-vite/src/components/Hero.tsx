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
          intent and your coding agent applies the change. No screenshots, no Slack threads,
          no guesswork.
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

        <div className={styles.mockup} aria-hidden="true">
          <div className={styles.mockupChrome}>
            <span className={styles.dot} style={{ background: '#ff5f57' }} />
            <span className={styles.dot} style={{ background: '#febc2e' }} />
            <span className={styles.dot} style={{ background: '#28c840' }} />
            <span className={styles.url}>localhost:5174</span>
          </div>
          <div className={styles.mockupBody}>
            <div className={styles.mockupSidebar}>
              <div className={styles.sidebarHeader}>Tasks</div>
              <div className={styles.sidebarItem}>
                <span className={styles.statusPin}>📌</span>
                Make hero CTA larger
              </div>
              <div className={styles.sidebarItem}>
                <span className={styles.statusReview}>✓</span>
                Soften card shadows
              </div>
              <div className={styles.sidebarItem}>
                <span className={styles.statusInProgress}>⟳</span>
                Fix focus ring contrast
              </div>
            </div>
            <div className={styles.mockupCanvas}>
              <div className={styles.canvasHero}>
                <div className={styles.canvasHeading}>Your live app</div>
                <div className={styles.canvasButton}>Click me</div>
                <div className={styles.selectionRing} />
                <div className={styles.pinNote}>
                  <span className={styles.pinDot}>1</span>
                  Make this 24px taller
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
