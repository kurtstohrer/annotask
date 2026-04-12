import { useEffect, useState } from 'react'
import { getIntegrations, type Integration } from '../lib/api'
import styles from './LogoStrip.module.css'

export default function LogoStrip() {
  const [items, setItems] = useState<Integration[]>([])

  useEffect(() => {
    getIntegrations('stable').then(setItems).catch(() => {})
  }, [])

  return (
    <section className={styles.strip} aria-label="Supported frameworks">
      <p className={styles.label}>Works with the stack you already have</p>
      <ul className={styles.logos}>
        {items.map((i) => (
          <li key={i.id} className={styles.logo}>
            <span className={styles.logoBadge}>{i.logo[0].toUpperCase()}</span>
            <span className={styles.logoName}>{i.name}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
