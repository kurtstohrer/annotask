import { useEffect, useMemo, useState } from 'react'
import { getIntegrations, type Integration } from '../lib/api'
import styles from './Integrations.module.css'

type Tab = 'all' | 'stable' | 'beta' | 'experimental'

const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stable', label: 'Stable' },
  { id: 'beta', label: 'Beta' },
]

export default function Integrations() {
  const [items, setItems] = useState<Integration[]>([])
  const [tab, setTab] = useState<Tab>('all')
  const allowedIntegrations = useMemo(() => new Set(['Vue', 'React', 'Svelte', 'htmx']), [])

  useEffect(() => {
    getIntegrations().then(setItems).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    const visible = items.filter((i) => allowedIntegrations.has(i.name))
    return tab === 'all' ? visible : visible.filter((i) => i.status === tab)
  }, [items, tab, allowedIntegrations])

  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Integrations</span>
          <h1 className={styles.title}>Plays well with the tools you already use.</h1>
          <p className={styles.lede}>
            Annotask ships with first-class support for the major frameworks, agents, and CI providers.
          </p>
        </header>

        <div className={styles.tabs} role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.grid}>
          {filtered.map((i) => (
            <article key={i.id} className={styles.card}>
              <div className={styles.logoBadge}>{i.name[0]}</div>
              <div className={styles.cardBody}>
                <h3 className={styles.cardName}>{i.name === 'htmx' ? 'HTML' : i.name}</h3>
                <p className={styles.cardCategory}>{i.name === 'htmx' ? 'framework' : i.category}</p>
              </div>
              <span className={`${styles.status} ${styles[`status_${i.status}`]}`}>
                {i.status}
              </span>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
