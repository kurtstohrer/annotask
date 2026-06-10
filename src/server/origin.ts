import net from 'node:net'

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

/**
 * Host-header gate against DNS rebinding.
 *
 * Annotask's middleware registers ahead of Vite's own host-check middleware,
 * so Vite's `allowedHosts` never protects `/__annotask/*`. Without a Host
 * check, a page on `evil.example` whose DNS re-resolves to 127.0.0.1 can read
 * every GET endpoint (read-file, tasks, screenshots, transcripts) — the
 * browser sends the request straight to the dev server with
 * `Host: evil.example` and same-origin rules don't apply.
 *
 * Accepts when:
 *   - there is no Host header at all (HTTP/1.0 / non-browser clients — a
 *     browser-driven rebinding attack always carries the attacker hostname);
 *   - the hostname part is localhost / 127.0.0.1 / [::1] / ::1;
 *   - the hostname is an IP literal (a typed-in LAN address like
 *     192.168.1.5:5173 — an IP in Host can't be a rebound DNS name, which is
 *     also why Vite allows IPs by default);
 *   - it matches an entry in `extraAllowed` (the host the server announces in
 *     server.json plus any Vite `server.allowedHosts` entries — `'*'` allows
 *     everything, a leading-dot entry like `.example.com` allows the domain
 *     and all subdomains, mirroring Vite's semantics);
 *   - it is listed in the env var `ANNOTASK_ALLOWED_HOSTS` (comma-separated
 *     hostnames, e.g. `ANNOTASK_ALLOWED_HOSTS=dev.tunnel.example,myhost.local`).
 */
export function isAllowedHost(hostHeader: string | undefined, extraAllowed: readonly string[] = []): boolean {
  if (!hostHeader) return true
  const hostname = hostnameOf(hostHeader)
  if (!hostname) return false
  if (isLocalHostname(hostname)) return true
  if (isIpLiteral(hostname)) return true
  const envList = (process.env.ANNOTASK_ALLOWED_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  for (const entry of [...extraAllowed, ...envList]) {
    if (entry === '*') return true
    const allowed = hostnameOf(entry)
    if (!allowed) continue
    if (allowed.startsWith('.')) {
      // Vite-style suffix entry: `.example.com` allows example.com and any subdomain.
      if (hostname === allowed.slice(1) || hostname.endsWith(allowed)) return true
    } else if (hostname === allowed) {
      return true
    }
  }
  return false
}

/** Lowercased hostname part of a Host header value (port stripped, IPv6 kept bracketed). */
function hostnameOf(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  // Leading-dot suffix entries (`.example.com`) aren't URL-parseable — keep verbatim.
  if (trimmed.startsWith('.')) return trimmed.toLowerCase()
  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

/** True for bare IPv4/IPv6 literals (IPv6 arrives bracketed from `hostnameOf`). */
function isIpLiteral(hostname: string): boolean {
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return net.isIP(bare) !== 0
}
