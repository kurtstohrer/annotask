/** Element registry, postMessage helpers, and source resolution utilities. */
export function bridgeRegistry(): string {
  return `
  // ── Element Registry ──────────────────────────────────
  var eidCounter = 0;
  var eidMap = new Map();   // eid string → WeakRef<Element>
  var elToEid = new WeakMap(); // Element → eid string

  function getEid(el) {
    if (!el) return null;
    var existing = elToEid.get(el);
    if (existing) return existing;
    eidCounter++;
    var eid = 'e-' + eidCounter;
    eidMap.set(eid, new WeakRef(el));
    elToEid.set(el, eid);
    return eid;
  }

  function getEl(eid) {
    var ref = eidMap.get(eid);
    return ref ? ref.deref() || null : null;
  }

  // ── PostMessage Helpers ───────────────────────────────
  // shellOrigin stays null until the first validated shell message locks it
  // to that exact origin (see the message handler in messages.ts). It is
  // never '*' — posting app data to a wildcard origin would let any page
  // that iframes the dev app read pushes (console error stacks, network
  // call URLs, hover/click context).
  var shellOrigin = null;

  // Bounded pre-lock queue: meaningful pushes that fire before the shell has
  // announced itself (initial network:page-load, early console errors) wait
  // here and flush to the locked origin. High-frequency transient events are
  // dropped instead — replaying stale hover state after lock would only
  // confuse the shell, and queueing them would evict the meaningful entries.
  var PRE_LOCK_QUEUE_MAX = 50;
  var preLockQueue = [];
  var PRE_LOCK_TRANSIENT = { 'hover:enter': true, 'hover:leave': true, 'data:hover': true };

  // Mirrors the server's isLocalHostname (src/server/origin.ts). Implemented
  // here because the bridge is standalone vanilla JS injected into the app
  // page — it cannot import server modules. Port-agnostic on purpose: the
  // webpack standalone topology serves the shell from a different localhost
  // port than the app, so a same-origin check would break it.
  function isLocalBridgeOrigin(origin) {
    if (!origin) return false;
    var host = '';
    try { host = new URL(origin).hostname; } catch (e) { return false; }
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  }

  function lockShellOrigin(origin) {
    shellOrigin = origin;
    var queued = preLockQueue.splice(0, preLockQueue.length);
    for (var qi = 0; qi < queued.length; qi++) {
      try { window.parent.postMessage(queued[qi], shellOrigin); } catch (e) {}
    }
  }

  function sendToShell(type, payload, id) {
    var msg = { type: type, payload: payload || {}, source: 'annotask-client' };
    if (id) msg.id = id;
    if (shellOrigin === null) {
      // bridge:ready is the one wildcard exception: it carries no app data
      // and the shell needs it to bootstrap before it has ever messaged us
      // (in the cross-origin webpack standalone topology the shell cannot
      // poll the iframe's globals to detect readiness).
      if (type === 'bridge:ready') {
        window.parent.postMessage(msg, '*');
        return;
      }
      if (PRE_LOCK_TRANSIENT[type]) return;
      if (preLockQueue.length < PRE_LOCK_QUEUE_MAX) preLockQueue.push(msg);
      return;
    }
    window.parent.postMessage(msg, shellOrigin);
  }

  function respond(id, payload) {
    sendToShell(null, payload, id);
  }

  // ── Source Element Resolution ─────────────────────────
  function hasSourceAttr(el) {
    // data-annotask-fragment-url stops the walk too: markup swapped in by
    // htmx/Turbo (stamped in events.ts) must resolve to the request that
    // produced it, not to whatever instrumented ancestor happens to contain
    // the swap target.
    return el.hasAttribute && (el.hasAttribute('data-annotask-file') || el.hasAttribute('data-astro-source-file') || el.hasAttribute('data-annotask-fragment-url'));
  }

  function findSourceElement(el) {
    var c = el;
    while (c) {
      if (hasSourceAttr(c)) return { sourceEl: c, targetEl: el };
      c = c.parentElement;
    }
    return { sourceEl: el, targetEl: el };
  }

  // ── Native Debug-Metadata Anchors ─────────────────────
  // Zero-transform fallbacks: frameworks that stamp their own dev metadata
  // anchor without our transform, the same way data-astro-source-* already
  // does. Consulted only when neither our stamps nor Astro's resolved a
  // file — our own stamps always win.

  /** Cut an absolute React _debugSource fileName down to a project-usable
   *  path at the LAST '/src/' segment (keeps 'src/...'). No '/src/' segment
   *  → honest-empty: an absolute path would only be rejected by the server's
   *  path-safety, so skipping the source beats emitting one. */
  function reactProjectFile(fileName) {
    if (!fileName) return '';
    var f = String(fileName).replace(/\\\\/g, '/');
    var i = f.lastIndexOf('/src/');
    return i !== -1 ? f.slice(i + 1) : '';
  }

  /** React dev builds hang the fiber off the DOM node under a randomized own
   *  key ('__reactFiber$' + hash). React <=18 fibers carry _debugSource
   *  ({ fileName, lineNumber }); React 19 removed it — then we report at
   *  most a component display name, never a fabricated file. */
  function getReactDebugSource(el) {
    var fiber = null;
    try {
      var keys = Object.keys(el);
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0) { fiber = el[keys[i]]; break; }
      }
    } catch (e) {}
    if (!fiber) return null;
    var file = '';
    var line = '';
    try {
      var ds = fiber._debugSource;
      if (ds && ds.fileName) {
        file = reactProjectFile(ds.fileName);
        if (file && ds.lineNumber) line = String(ds.lineNumber);
      }
    } catch (e) {}
    var component = '';
    try {
      var t = fiber.type;
      if (t && typeof t !== 'string') component = t.displayName || t.name || '';
      // Host fibers (type 'div') name their owning component via _debugOwner.
      if (!component && fiber._debugOwner && fiber._debugOwner.type && typeof fiber._debugOwner.type !== 'string') {
        component = fiber._debugOwner.type.displayName || fiber._debugOwner.type.name || '';
      }
    } catch (e) {}
    if (!file && !component) return null;
    return { file: file, line: line, component: component };
  }

  function getSourceData(el) {
    var file = el.getAttribute('data-annotask-file') || '';
    var line = el.getAttribute('data-annotask-line') || '';
    var component = el.getAttribute('data-annotask-component') || '';
    var sourceTag = el.getAttribute('data-annotask-source-tag') || '';

    if (!file && el.getAttribute('data-astro-source-file')) {
      var astroFile = el.getAttribute('data-astro-source-file') || '';
      var srcIdx = astroFile.indexOf('/src/');
      file = srcIdx !== -1 ? astroFile.slice(srcIdx + 1) : astroFile;
    }
    if ((!line || line === '0') && el.getAttribute('data-astro-source-loc')) {
      line = (el.getAttribute('data-astro-source-loc') || '').split(':')[0];
    }

    // Server-swapped fragment root (stamped by the htmx/Turbo listeners in
    // events.ts): the honest anchor is the request that produced the markup
    // ('POST /search'), not a file. Also skips the native-metadata fallbacks
    // — the fragment arrived over the wire, framework debug info can't apply.
    var fragmentUrl = '';
    if (!file) fragmentUrl = el.getAttribute('data-annotask-fragment-url') || '';

    // Svelte dev builds attach __svelte_meta = { loc: { file, line, column } }
    // per element; loc.file is project-relative and loc.line is 1-based —
    // both match our conventions, so they are used as-is.
    if (!file && !fragmentUrl && el.__svelte_meta && el.__svelte_meta.loc && el.__svelte_meta.loc.file) {
      file = String(el.__svelte_meta.loc.file);
      if ((!line || line === '0') && el.__svelte_meta.loc.line) line = String(el.__svelte_meta.loc.line);
    }
    // React dev fiber (_debugSource) — last in the resolver chain.
    if (!file && !fragmentUrl) {
      var rd = getReactDebugSource(el);
      if (rd) {
        if (rd.file) {
          file = rd.file;
          if ((!line || line === '0') && rd.line) line = rd.line;
        }
        if (!component && rd.component) component = rd.component;
      }
    }

    if (!component && file) {
      var parts = file.split('/');
      var fileName = parts[parts.length - 1] || '';
      component = fileName.replace(/\\.[^.]+$/, '');
    }

    var mfe = el.getAttribute('data-annotask-mfe') || '';

    var data = { file: file, line: line, component: component, source_tag: sourceTag, mfe: mfe };
    if (fragmentUrl) data.fragmentUrl = fragmentUrl;
    return data;
  }

  function getRect(el) {
    var r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  /** Find the enclosing component, but only when sourceEl is actually
   *  at a component boundary (i.e., its first instrumented ancestor
   *  belongs to a different component). Returns '' when sourceEl is
   *  interior markup of its own component — the shell uses an empty
   *  parent_component to distinguish a component root from an element
   *  nested inside one.
   *
   *  Vue's single-root attribute fallthrough overwrites a child
   *  component's template-stamped data-annotask-* attributes with the
   *  parent's values. That means the DOM root of <Header> ends up with
   *  data-annotask-component="App" and data-annotask-source-tag="Header".
   *  When walking up from an interior element (currentComponent="Header")
   *  we detect that case by matching the ancestor's source-tag against
   *  the current component name — that ancestor is the fallthrough'd
   *  root of our own component, not a true boundary. */
  function findParentComponent(sourceEl, currentComponent) {
    if (!sourceEl || !sourceEl.parentElement) return '';
    var cur = sourceEl.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var c = cur.getAttribute && cur.getAttribute('data-annotask-component');
      if (c) {
        var st = cur.getAttribute && cur.getAttribute('data-annotask-source-tag');
        if (st && st === currentComponent) return '';
        return c === currentComponent ? '' : c;
      }
      cur = cur.parentElement;
    }
    return '';
  }
`
}
