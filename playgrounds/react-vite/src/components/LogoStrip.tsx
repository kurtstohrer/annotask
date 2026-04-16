import { useEffect, useState } from 'react'
import { getIntegrations, type Integration } from '../lib/api'
import styles from './LogoStrip.module.css'

export default function LogoStrip() {
  const [items, setItems] = useState<Integration[]>([])

  useEffect(() => {
    getIntegrations('stable').then((data) => {
      const sorted = data.sort((a, b) => {
        const order = ['React', 'Vue']
        const aIndex = order.indexOf(a.name)
        const bIndex = order.indexOf(b.name)
        if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex
        if (aIndex !== -1) return -1
        if (bIndex !== -1) return 1
        return a.name.localeCompare(b.name)
      })
      setItems(sorted)
    }).catch(() => {})
  }, [])

  return (
    <section className={styles.strip} aria-label="Supported frameworks">
      <p className={styles.label}>Works with the stack you already have</p>
      <ul className={styles.logos}>
        {items.map((i) => (
          <li key={i.id} className={styles.logo}>
            <span className={styles.logoName}>{i.name}</span>
            <span className={styles.logoBadge}>{i.logo[0].toUpperCase()}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
