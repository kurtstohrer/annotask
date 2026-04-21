// Theme toggle (persists to localStorage, applied via data-theme on <html>)
const STORAGE_KEY = 'solar-html-theme'

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try { localStorage.setItem(STORAGE_KEY, theme) } catch {}
  const btn = document.getElementById('theme-toggle')
  if (btn) btn.textContent = theme === 'dark' ? '☀' : '☾'
}

function loadTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

let currentTheme = loadTheme()
applyTheme(currentTheme)

document.getElementById('theme-toggle')?.addEventListener('click', () => {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark'
  applyTheme(currentTheme)
})

// Smooth scroll for nav links
document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => {
    const href = link.getAttribute('href')
    if (href?.startsWith('#')) {
      e.preventDefault()
      document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' })
    }
  })
})

// Card click highlight
document.querySelectorAll('.card').forEach(card => {
  card.addEventListener('click', () => {
    document.querySelectorAll('.card').forEach(c => c.style.borderColor = '')
    card.style.borderColor = 'var(--text)'
  })
})
