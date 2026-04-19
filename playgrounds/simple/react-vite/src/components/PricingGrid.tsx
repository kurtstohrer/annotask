import { useEffect, useState } from 'react'
import { getPricing, type PricingTier } from '../lib/api'
import styles from './PricingGrid.module.css'

export default function PricingGrid() {
  const [tiers, setTiers] = useState<PricingTier[]>([])

  useEffect(() => {
    getPricing().then(setTiers).catch(() => {})
  }, [])

  return (
    <section id="pricing" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Pricing</span>
          <h2 className={styles.title}>Free for solo. Fair for teams.</h2>
          <p className={styles.lede}>
            Annotask is local-first. The Solo tier is free forever and includes every visual tool. Upgrade when you want shared review and SSO.
          </p>
        </header>

        <div className={styles.grid}>
          {tiers.map((t) => (
            <article
              key={t.id}
              className={`${styles.card} ${t.highlighted ? styles.highlighted : ''}`}
            >
              {t.highlighted && <span className={styles.badge}>Most popular</span>}
              <h3 className={styles.tierName}>{t.name}</h3>
              <div className={styles.priceRow}>
                {t.price_monthly === null ? (
                  <span className={styles.priceCustom}>Custom</span>
                ) : t.price_monthly === 0 ? (
                  <span className={styles.priceFree}>$0</span>
                ) : (
                  <>
                    <span className={styles.priceAmount}>${t.price_monthly}</span>
                    <span className={styles.priceUnit}>/mo</span>
                  </>
                )}
              </div>
              <p className={styles.billing}>{t.billing}</p>
              <ul className={styles.features}>
                {t.features.map((f, i) => (
                  <li key={i} className={styles.feature}>
                    <span className={styles.check} aria-hidden="true">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a href="#waitlist" className={styles.cta}>
                {t.cta_label}
              </a>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
