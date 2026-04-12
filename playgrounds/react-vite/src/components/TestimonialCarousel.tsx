import { useEffect, useState } from 'react'
import { getTestimonials, type Testimonial } from '../lib/api'
import styles from './TestimonialCarousel.module.css'

export default function TestimonialCarousel() {
  const [items, setItems] = useState<Testimonial[]>([])
  const [activeIdx, setActiveIdx] = useState(0)

  useEffect(() => {
    getTestimonials().then(setItems).catch(() => {})
  }, [])

  useEffect(() => {
    if (items.length === 0) return
    const id = setInterval(() => setActiveIdx((i) => (i + 1) % items.length), 6000)
    return () => clearInterval(id)
  }, [items.length])

  return (
    <section className={styles.section}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <span className={styles.eyebrow}>What people say</span>
          <h2 className={styles.title}>Loved by designers and engineers alike.</h2>
        </header>

        <div className={styles.grid}>
          {items.map((t, i) => (
            <article
              key={t.id}
              className={`${styles.card} ${i === activeIdx ? styles.featured : ''}`}
            >
              <div className={styles.stars} aria-label={`${t.rating} out of 5 stars`}>
                {'★'.repeat(t.rating)}
                {'☆'.repeat(5 - t.rating)}
              </div>
              <p className={styles.quote}>"{t.quote}"</p>
              <div className={styles.who}>
                <img src={t.avatar_url} alt="" className={styles.avatar} />
                <div>
                  <div className={styles.name}>{t.name}</div>
                  <div className={styles.role}>
                    {t.role} · {t.company}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className={styles.dots}>
          {items.map((_, i) => (
            <button
              key={i}
              className={`${styles.dot} ${i === activeIdx ? styles.dotActive : ''}`}
              onClick={() => setActiveIdx(i)}
              aria-label={`Show testimonial ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
