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
