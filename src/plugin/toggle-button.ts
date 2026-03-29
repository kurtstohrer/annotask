/**
 * Tiny script injected into the user's page that renders a floating
 * Annotask toggle button in the bottom-right corner.
 * Clicking it opens /__annotask/ in a new tab.
 */
export function toggleButtonScript(serverUrl?: string): string {
  const annotaskUrl = serverUrl ? `${serverUrl}/__annotask/` : '/__annotask/'
  return `
(function() {
  // Don't inject inside the Annotask shell itself
  if (window.location.pathname.startsWith('/__annotask')) return;

  const btn = document.createElement('button');
  btn.innerHTML = \`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>\`;
  btn.title = 'Open Annotask';
  btn.setAttribute('aria-label', 'Open Annotask design tool');

  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    zIndex: '2147483647',
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    border: 'none',
    background: '#18181b',
    color: '#fafafa',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    transition: 'transform 0.15s, box-shadow 0.15s',
    opacity: '0.8',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.transform = 'scale(1.1)';
    btn.style.opacity = '1';
    btn.style.boxShadow = '0 4px 16px rgba(0,0,0,0.4)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.transform = 'scale(1)';
    btn.style.opacity = '0.8';
    btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
  });

  btn.addEventListener('click', () => {
    var appOrigin = window.location.origin;
    var url = '${annotaskUrl}' + '?appUrl=' + encodeURIComponent(appOrigin + '/');
    window.open(url, '_blank');
  });

  document.body.appendChild(btn);
})();
`.trim()
}
