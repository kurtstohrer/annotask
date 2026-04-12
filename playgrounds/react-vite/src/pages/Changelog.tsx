import { useEffect, useState } from 'react'
import { getChangelog, type ChangelogEntry } from '../lib/api'
import styles from './Changelog.module.css'

export default function Changelog() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getChangelog(20)
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>Releases</span>
          <h1 className={styles.title}>Changelog</h1>
          <p className={styles.lede}>Everything we've shipped, in reverse chronological order.</p>
        </header>

        {loading ? (
          <p className={styles.loading}>Loading…</p>
        ) : (
          <ol className={styles.list}>
            {entries.map((e) => (
              <li key={e.version} className={styles.entry}>
                <div className={styles.entryMeta}>
                  <span className={styles.version}>v{e.version}</span>
                  <time className={styles.date}>{e.date}</time>
                </div>
                <div className={styles.entryBody}>
                  <h2 className={styles.headline}>{e.headline}</h2>
                  <ul className={styles.highlights}>
                    {e.highlights.map((h, i) => (
                      <li key={i}>{h}</li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
