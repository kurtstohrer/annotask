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
  var shellOrigin = '*'; // Will be tightened on first shell message

  function sendToShell(type, payload, id) {
    var msg = { type: type, payload: payload || {}, source: 'annotask-client' };
    if (id) msg.id = id;
    window.parent.postMessage(msg, shellOrigin);
  }

  function respond(id, payload) {
    sendToShell(null, payload, id);
  }

  // ── Source Element Resolution ─────────────────────────
  function hasSourceAttr(el) {
    return el.hasAttribute && (el.hasAttribute('data-annotask-file') || el.hasAttribute('data-astro-source-file'));
  }

  function findSourceElement(el) {
    var c = el;
    while (c) {
      if (hasSourceAttr(c)) return { sourceEl: c, targetEl: el };
      c = c.parentElement;
    }
    return { sourceEl: el, targetEl: el };
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
    if (!component && file) {
      var parts = file.split('/');
      var fileName = parts[parts.length - 1] || '';
      component = fileName.replace(/\\.[^.]+$/, '');
    }

    var mfe = el.getAttribute('data-annotask-mfe') || '';

    return { file: file, line: line, component: component, source_tag: sourceTag, mfe: mfe };
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
