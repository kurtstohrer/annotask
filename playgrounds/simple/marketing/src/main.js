import './style.css'

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
