/** Check if an Origin header is from localhost (or absent, i.e. same-origin / non-browser client) */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true // same-origin requests or non-browser clients (no Origin header)
  try {
    const url = new URL(origin)
    const host = url.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}
