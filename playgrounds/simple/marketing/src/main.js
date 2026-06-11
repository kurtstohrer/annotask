import './style.css'
import { fetchStats } from './api.js'

// Shoelace web components — register base path for assets
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js'
setBasePath('/node_modules/@shoelace-style/shoelace/dist')

// Live project stats in the hero strip — keep the "—" placeholders if the API is down
const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n))
fetchStats()
  .then((stats) => {
    for (const el of document.querySelectorAll('[data-stat]')) {
      const value = stats[el.dataset.stat]
      if (typeof value === 'number') el.textContent = compact(value)
    }
  })
  .catch(() => {})

// Smooth scroll for anchor links
document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="#"]')
  if (!link) return
  const target = document.querySelector(link.getAttribute('href'))
  if (target) {
    e.preventDefault()
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
})
