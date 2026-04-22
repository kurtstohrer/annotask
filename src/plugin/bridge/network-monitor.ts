/**
 * Client-side fetch / XHR / sendBeacon monkey-patcher. Captures every outgoing
 * HTTP request the iframe makes and batches them to the shell, which persists
 * an aggregated `RuntimeEndpoint` catalog to disk.
 *
 * The patch is always-on (not gated on a "recording" flag) because one of this
 * feature's goals is to aggregate the list of APIs the frontend actually hits
 * across every page load — something that requires capturing from first paint
 * onward, not after the user clicks a record button.
 *
 * Guardrails:
 * - Skips requests to the Annotask API (`/__annotask/*`) so shell traffic
 *   doesn't inflate the catalog.
 * - Batches every ~1s so we don't flood the bridge during request bursts.
 * - Flushes immediately on route change so per-route attribution is accurate
 *   when the next page load starts.
 * - Buffer cap of 500 pending calls — extreme request storms are dropped
 *   rather than OOMing the page.
 */
export function bridgeNetworkMonitor(): string {
  return `
  // ── Network Monitor ────────────────────────────────────
  var networkCallCounter = 0;
  var networkLoadId = 0;
  var networkPending = [];
  var NETWORK_MAX_PENDING = 500;
  var NETWORK_FLUSH_MS = 1000;
  var networkFlushTimer = null;

  function networkScheduleFlush() {
    if (networkFlushTimer) return;
    networkFlushTimer = setTimeout(function() {
      networkFlushTimer = null;
      networkFlushNow();
    }, NETWORK_FLUSH_MS);
  }

  function networkFlushNow() {
    if (networkPending.length === 0) return;
    var batch = networkPending.splice(0, networkPending.length);
    // Mirror the batch to the shell for live UI updates (no-op when the shell
    // isn't mounted — postMessage to a non-listening parent is silently dropped).
    try { sendToShell('network:calls', { calls: batch }); } catch (e) {}
    // Post directly to the server so runtime capture works on every page load
    // even when the Annotask shell isn't open — the whole point of runtime
    // endpoint aggregation is persistent discovery across sessions.
    try {
      var payload = JSON.stringify({ calls: batch });
      if (navigator && typeof navigator.sendBeacon === 'function') {
        // Beacon keeps working through unload; use our ORIGINAL beacon (bypass
        // the patch we just installed so this POST doesn't feed itself back
        // into the buffer). networkShouldSkip() would filter /__annotask/*
        // anyway, but going through the original keeps the audit trail clean.
        var beacon = (window.__annotaskOrigBeacon || (navigator.sendBeacon && navigator.sendBeacon.bind(navigator)));
        var blob;
        try { blob = new Blob([payload], { type: 'application/json' }); } catch (e) { blob = payload; }
        var ok = false;
        try { ok = beacon('/__annotask/api/runtime-endpoints', blob); } catch (e) {}
        if (ok) return;
      }
      // Fall back to fetch. Use the ORIGINAL fetch so our patch doesn't
      // observe this outgoing call (networkShouldSkip would drop it anyway).
      var rawFetch = window.__annotaskOrigFetch || window.fetch;
      rawFetch('/__annotask/api/runtime-endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        credentials: 'omit',
        keepalive: true
      }).catch(function() {});
    } catch (e) {}
  }

  function networkShouldSkip(url) {
    if (!url) return true;
    if (typeof url !== 'string') { try { url = String(url); } catch (e) { return true; } }
    // Our own API + MCP traffic would pollute the catalog.
    if (url.indexOf('/__annotask/') !== -1) return true;
    // Skip Vite HMR and dev pings.
    if (url.indexOf('/@vite/') !== -1) return true;
    if (url.indexOf('/@id/') !== -1) return true;
    if (url.indexOf('/@fs/') !== -1) return true;
    if (url.indexOf('/node_modules/.vite/') !== -1) return true;
    // Chrome extension / data URIs — not meaningful "API calls".
    if (url.indexOf('chrome-extension://') === 0) return true;
    if (url.indexOf('data:') === 0) return true;
    if (url.indexOf('blob:') === 0) return true;
    return false;
  }

  function networkParseUrl(raw) {
    var urlStr = '';
    try {
      if (typeof raw === 'string') urlStr = raw;
      else if (raw && typeof raw.url === 'string') urlStr = raw.url;   // Request object
      else if (raw && typeof raw.toString === 'function') urlStr = raw.toString();
    } catch (e) { urlStr = ''; }
    if (!urlStr) return null;
    var absolute;
    try { absolute = new URL(urlStr, window.location.href); } catch (e) { return null; }
    var origin = absolute.origin;
    // Same-origin calls report empty origin so aggregation doesn't silo identical
    // paths by whichever port the dev server happens to be bound to today.
    if (origin === window.location.origin) origin = '';
    var path = absolute.pathname + (absolute.search || '');
    var pathNoQuery = absolute.pathname;
    return { url: urlStr, origin: origin, path: path, pathNoQuery: pathNoQuery };
  }

  function networkPush(call) {
    if (networkPending.length >= NETWORK_MAX_PENDING) return;
    networkPending.push(call);
    networkScheduleFlush();
  }

  function networkNextId() {
    networkCallCounter++;
    return 'n-' + networkLoadId + '-' + networkCallCounter;
  }

  // ── fetch() ──
  if (typeof window.fetch === 'function' && !window.__annotaskFetchPatched) {
    var origFetch = window.fetch.bind(window);
    window.__annotaskOrigFetch = origFetch;
    window.__annotaskFetchPatched = true;
    window.fetch = function(input, init) {
      var parsed = networkParseUrl(input);
      if (!parsed || networkShouldSkip(parsed.url)) return origFetch(input, init);
      var method = 'GET';
      if (init && typeof init.method === 'string') method = init.method.toUpperCase();
      else if (input && typeof input === 'object' && typeof input.method === 'string') method = input.method.toUpperCase();
      var id = networkNextId();
      var startedAt = Date.now();
      var t0 = performance.now();
      var route = window.location.pathname;
      var call = {
        id: id,
        initiator: 'fetch',
        method: method,
        url: parsed.url,
        origin: parsed.origin,
        path: parsed.path,
        pathNoQuery: parsed.pathNoQuery,
        route: route,
        startedAt: startedAt
      };
      return origFetch(input, init).then(function(res) {
        call.status = res.status;
        call.durationMs = Math.round(performance.now() - t0);
        try {
          var ct = res.headers && res.headers.get && res.headers.get('content-type');
          if (ct) call.contentType = ct;
          var cl = res.headers && res.headers.get && res.headers.get('content-length');
          if (cl) {
            var n = parseInt(cl, 10);
            if (!isNaN(n)) call.contentLength = n;
          }
        } catch (e) {}
        networkPush(call);
        return res;
      }).catch(function(err) {
        call.durationMs = Math.round(performance.now() - t0);
        call.error = (err && err.message) ? String(err.message) : String(err);
        networkPush(call);
        throw err;
      });
    };
  }

  // ── XMLHttpRequest ──
  if (typeof XMLHttpRequest !== 'undefined' && !window.__annotaskXhrPatched) {
    window.__annotaskXhrPatched = true;
    var origOpen = XMLHttpRequest.prototype.open;
    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      try {
        this.__annotaskMethod = typeof method === 'string' ? method.toUpperCase() : 'GET';
        this.__annotaskUrl = url;
      } catch (e) {}
      return origOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      var self = this;
      var parsed = networkParseUrl(self.__annotaskUrl);
      if (!parsed || networkShouldSkip(parsed.url)) return origSend.apply(self, arguments);
      var id = networkNextId();
      var startedAt = Date.now();
      var t0 = performance.now();
      var route = window.location.pathname;
      var call = {
        id: id,
        initiator: 'xhr',
        method: self.__annotaskMethod || 'GET',
        url: parsed.url,
        origin: parsed.origin,
        path: parsed.path,
        pathNoQuery: parsed.pathNoQuery,
        route: route,
        startedAt: startedAt
      };
      function finalize() {
        call.durationMs = Math.round(performance.now() - t0);
        try {
          call.status = self.status || undefined;
          var ct = self.getResponseHeader && self.getResponseHeader('content-type');
          if (ct) call.contentType = ct;
          var cl = self.getResponseHeader && self.getResponseHeader('content-length');
          if (cl) {
            var n = parseInt(cl, 10);
            if (!isNaN(n)) call.contentLength = n;
          }
        } catch (e) {}
        networkPush(call);
      }
      self.addEventListener('load', finalize);
      self.addEventListener('error', function() { call.error = 'network error'; finalize(); });
      self.addEventListener('abort', function() { call.error = 'aborted'; finalize(); });
      self.addEventListener('timeout', function() { call.error = 'timeout'; finalize(); });
      return origSend.apply(self, arguments);
    };
  }

  // ── sendBeacon ──
  // Beacons can't carry a response — we still record them so the catalog reflects
  // that the endpoint was hit (analytics beacons often use dedicated endpoints).
  if (navigator && typeof navigator.sendBeacon === 'function' && !window.__annotaskBeaconPatched) {
    var origBeacon = navigator.sendBeacon.bind(navigator);
    window.__annotaskOrigBeacon = origBeacon;
    window.__annotaskBeaconPatched = true;
    navigator.sendBeacon = function(url, data) {
      var parsed = networkParseUrl(url);
      if (parsed && !networkShouldSkip(parsed.url)) {
        var call = {
          id: networkNextId(),
          initiator: 'beacon',
          method: 'POST',
          url: parsed.url,
          origin: parsed.origin,
          path: parsed.path,
          pathNoQuery: parsed.pathNoQuery,
          route: window.location.pathname,
          startedAt: Date.now()
        };
        networkPush(call);
      }
      return origBeacon(url, data);
    };
  }

  // ── Page-load signal ──
  // The events.ts route-tracker polls every 2s and fires 'route:changed' for
  // SPA navigations; here we pair each route change with a 'network:page-load'
  // push so the server aggregator can bucket calls per-load. We also emit once
  // on initial ready so the first page view is tracked.
  function networkEmitPageLoad() {
    networkLoadId++;
    networkFlushNow();
    try {
      sendToShell('network:page-load', {
        route: window.location.pathname,
        at: Date.now(),
        loadId: networkLoadId
      });
    } catch (e) {}
  }
  // Fire once for the initial load (deferred so bridge:ready posts first).
  setTimeout(networkEmitPageLoad, 0);
  window.addEventListener('popstate', networkEmitPageLoad);
  window.addEventListener('hashchange', networkEmitPageLoad);
  // Patch pushState / replaceState so framework routers also trigger a load marker.
  try {
    var origPush = history.pushState;
    var origReplace = history.replaceState;
    history.pushState = function() { var r = origPush.apply(this, arguments); networkEmitPageLoad(); return r; };
    history.replaceState = function() { var r = origReplace.apply(this, arguments); networkEmitPageLoad(); return r; };
  } catch (e) {}

  // Flush on unload so in-flight batches are not dropped when the iframe tears down.
  window.addEventListener('beforeunload', networkFlushNow);
  window.addEventListener('pagehide', networkFlushNow);
`
}
