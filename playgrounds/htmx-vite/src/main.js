// Theme toggle (persists to localStorage, applied via data-theme on <html>)
const STORAGE_KEY = 'htmx-solar-theme'

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

// Client-side search filtering (since we don't have a backend for htmx POST)
// In a real app, htmx would fetch HTML fragments from the server.
document.body.addEventListener('htmx:configRequest', (e) => {
  if (e.detail.path === '/search') {
    e.preventDefault()
    const query = e.detail.parameters.q?.toLowerCase() || ''
    const cards = document.querySelectorAll('#search-results .card')
    cards.forEach(card => {
      const title = card.querySelector('.card-title')?.textContent?.toLowerCase() || ''
      const text = card.querySelector('.card-text')?.textContent?.toLowerCase() || ''
      card.style.display = (title.includes(query) || text.includes(query)) ? '' : 'none'
    })
  }
})
