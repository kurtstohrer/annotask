import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { joinWaitlist } from '../lib/api'
import styles from './Footer.module.css'

export default function Footer() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setState('submitting')
    try {
      const res = await joinWaitlist(email)
      setMessage(`You're #${res.position} on the list — talk soon.`)
      setState('success')
      setEmail('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Something went wrong')
      setState('error')
    }
  }

  return (
    <footer className={styles.footer} id="waitlist">
      <div className={styles.inner}>
        <section className={styles.cta}>
          <h2 className={styles.ctaTitle}>Ready to ship visual changes faster?</h2>
          <p className={styles.ctaLede}>
            Join the early-access list. We'll send install instructions and a 5-minute walkthrough.
          </p>
          <form className={styles.form} onSubmit={onSubmit}>
            <input
              type="email"
              required
              placeholder="you@yourcompany.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={state === 'submitting'}
              className={styles.input}
              aria-label="Email address"
            />
            <button type="submit" className={styles.submit} disabled={state === 'submitting'}>
              {state === 'submitting' ? 'Joining…' : 'Join waitlist'}
            </button>
          </form>
          {message && (
            <p className={state === 'error' ? styles.errorMsg : styles.successMsg}>{message}</p>
          )}
        </section>

        <div className={styles.linksGrid}>
          <div className={styles.linkCol}>
            <h4 className={styles.colTitle}>Product</h4>
            <ul className={styles.colList}>
              <li><a href="/#features">Features</a></li>
              <li><a href="/#pricing">Pricing</a></li>
              <li><Link to="/integrations">Integrations</Link></li>
              <li><Link to="/changelog">Changelog</Link></li>
            </ul>
          </div>
          <div className={styles.linkCol}>
            <h4 className={styles.colTitle}>Resources</h4>
            <ul className={styles.colList}>
              <li><a href="https://github.com">GitHub</a></li>
              <li><a href="#">Documentation</a></li>
              <li><a href="#">MCP guide</a></li>
              <li><a href="#">Examples</a></li>
            </ul>
          </div>
          <div className={styles.linkCol}>
            <h4 className={styles.colTitle}>Company</h4>
            <ul className={styles.colList}>
              <li><a href="#">About</a></li>
              <li><a href="#">Blog</a></li>
              <li><a href="#">Privacy</a></li>
              <li><a href="#">Terms</a></li>
            </ul>
          </div>
        </div>

        <div className={styles.legal}>
          <span>© 2026 annotask. All rights reserved.</span>
          <span>Local-first. Open core. Built with care.</span>
        </div>
      </div>
    </footer>
  )
}
