/**
 * Origin validation for mutating requests.
 *
 * Returns true when the origin is localhost (any port) or when there is no Origin
 * header at all (same-origin browser requests and non-browser clients like curl).
 *
 * Historically this checked only the hostname, which meant a server listening on
 * port A would accept requests from a local attacker page served on port B.
 * `isLocalOrigin` keeps the same contract (port-agnostic) because users can open
 * the shell from any dev server, but `originMatchesPort` is available for the
 * stricter same-port check used on mutating endpoints.
 */
export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    return isLocalHostname(url.hostname)
  } catch {
    return false
  }
}

/** True if `origin` is localhost AND matches the given port (when port is known). */
export function originMatchesPort(origin: string | undefined, port: number | undefined): boolean {
  if (!origin) return true
  try {
    const url = new URL(origin)
    if (!isLocalHostname(url.hostname)) return false
    if (!port) return true
    const originPort = url.port ? parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80
    return originPort === port
  } catch {
    return false
  }
}

function isLocalHostname(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}
