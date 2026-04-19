import { useState } from 'react'
import styles from './FAQ.module.css'

const QUESTIONS = [
  {
    q: 'Does annotask need a backend?',
    a: 'No. It runs entirely inside your dev server via the Vite or Webpack plugin. Tasks are written to .annotask/tasks.json in your project. Your repo is the source of truth.',
  },
  {
    q: 'Which agents work with annotask?',
    a: 'Any MCP-compatible agent. Claude, Cursor, and Cline are tested daily. The bundled MCP server exposes tools like annotask_get_tasks, annotask_update_task, and annotask_create_task.',
  },
  {
    q: 'How does it work with my framework?',
    a: 'First-class transforms for Vue, React, and Svelte. Astro and htmx are experimental. Webpack and Vite are both supported. Module Federation children get their own annotation scope.',
  },
  {
    q: 'Is my data sent anywhere?',
    a: 'No. Annotask is local-first. Screenshots, annotations, and design tokens stay on your machine. The only network calls go to your own dev server.',
  },
  {
    q: 'Can I self-host the team plan?',
    a: 'Enterprise customers can self-host the control plane on their own infrastructure. Get in touch for SAML/SCIM and audit log setup.',
  },
  {
    q: 'How do I install?',
    a: 'npm install annotask, then add the plugin to your vite.config.ts or webpack.config.js. The shell loads at /__annotask/. That is the entire install.',
  },
]

export default function FAQ() {
  const [open, setOpen] = useState<number | null>(0)

  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>FAQ</span>
          <h2 className={styles.title}>Questions, answered.</h2>
        </header>

        <ul className={styles.list}>
          {QUESTIONS.map((item, i) => {
            const isOpen = open === i
            return (
              <li key={i} className={`${styles.item} ${isOpen ? styles.itemOpen : ''}`}>
                <button
                  className={styles.question}
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                >
                  <span>{item.q}</span>
                  <span className={styles.icon} aria-hidden="true">
                    {isOpen ? '−' : '+'}
                  </span>
                </button>
                {isOpen && <p className={styles.answer}>{item.a}</p>}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
