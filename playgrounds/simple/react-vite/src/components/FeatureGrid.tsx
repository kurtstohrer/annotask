import { useEffect, useState, type ReactNode } from 'react'
import { getFeatures, type Feature } from '../lib/api'
import styles from './FeatureGrid.module.css'

const CATEGORY_LABELS: Record<string, string> = {
  visual: 'Visual tools',
  agent: 'Agent integration',
  framework: 'Framework support',
  integration: 'Integrations',
}

export default function FeatureGrid() {
  const [features, setFeatures] = useState<Feature[]>([])

  useEffect(() => {
    getFeatures().then(setFeatures).catch(() => {})
  }, [])

  const grouped = features.reduce<Record<string, Feature[]>>((acc, f) => {
    ;(acc[f.category] ||= []).push(f)
    return acc
  }, {})

  return (
    <section id="features" className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.sectionHeader}>
          <span className={styles.eyebrow}>Features</span>
          <h2 className={styles.title}>Everything you need to ship visual changes faster.</h2>
          <p className={styles.lede}>
            Annotask sits inside your dev server and turns every browser interaction into structured, agent-ready tasks.
          </p>
        </header>

        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className={styles.group}>
            <h3 className={styles.groupTitle}>{CATEGORY_LABELS[category] || category}</h3>
            <div className={styles.grid}>
              {items.map((f) => (
                <article key={f.id} className={styles.card}>
                  <div className={styles.iconWrap}>
                    <FeatureIcon icon={f.icon} />
                  </div>
                  <h4 className={styles.cardTitle}>{f.title}</h4>
                  <p className={styles.cardDesc}>{f.description}</p>
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function FeatureIcon({ icon }: { icon: string }) {
  // Single SVG with switching paths so the inspector sees one stable element.
  const paths: Record<string, ReactNode> = {
    wand: <path d="M4 20 L20 4 M16 4 L20 4 L20 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    palette: <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" fill="none" />,
    pin: <path d="M12 3 L12 14 M8 21 L16 21 M12 14 L8 18 L16 18 Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
    scissors: <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />,
    robot: <rect x="4" y="6" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />,
    loop: <path d="M4 12 A8 8 0 1 0 12 4 M12 4 L8 4 M12 4 L12 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />,
    chip: <rect x="5" y="5" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="2" fill="none" />,
    boxes: <path d="M4 8 L12 4 L20 8 L12 12 Z M4 8 L4 16 L12 20 L12 12 M20 8 L20 16 L12 20" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none" />,
    shield: <path d="M12 3 L20 6 V12 C20 17 16 20 12 21 C8 20 4 17 4 12 V6 Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none" />,
    eye: <path d="M2 12 C5 6 9 4 12 4 C15 4 19 6 22 12 C19 18 15 20 12 20 C9 20 5 18 2 12 Z M12 9 A3 3 0 1 1 12 15 A3 3 0 1 1 12 9 Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="none" />,
    gauge: <path d="M4 16 A8 8 0 1 1 20 16 M12 16 L16 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />,
    bug: <path d="M9 4 L15 4 M12 7 L12 21 M5 11 H19 M6 16 L4 16 M18 16 L20 16 M6 21 L4 21 M18 21 L20 21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />,
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      {paths[icon] || paths.wand}
    </svg>
  )
}
