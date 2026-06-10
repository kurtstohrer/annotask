/** Utility functions: isColor, createPlaceholder, tryMount* for Vue/React/Svelte components. */
export function bridgeHelpers(): string {
  return `
  // ── Helpers ───────────────────────────────────────────
  /** Extract an element's visible label text for agent disambiguation.
   *  Normalizes whitespace, trims, and caps length — agents need "Sign In",
   *  not the whole text subtree of a large container. */
  function getVisibleText(el, limit) {
    if (!el) return '';
    limit = limit || 200;
    try {
      var aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title'));
      if (aria) {
        var a = String(aria).replace(/\\s+/g, ' ').trim();
        if (a) return a.length > limit ? a.slice(0, limit) : a;
      }
      var raw = el.textContent || '';
      var t = raw.replace(/\\s+/g, ' ').trim();
      if (!t) return '';
      return t.length > limit ? t.slice(0, limit) : t;
    } catch (e) { return ''; }
  }

  function isColor(val) {
    if (val.startsWith('#') || val.startsWith('rgb') || val.startsWith('hsl')) return true;
    try {
      var ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillStyle = val;
      return ctx.fillStyle !== '#000000' || val === 'black' || val === '#000000';
    } catch(e) { return false; }
  }

  function createPlaceholder(payload) {
    var el = document.createElement(payload.tag);
    el.setAttribute('data-annotask-placeholder', 'true');
    if (payload.classes) el.className = payload.classes;
    var tag = payload.tag.toLowerCase();
    var isComponent = payload.tag.includes('-') || (payload.tag[0] === payload.tag[0].toUpperCase() && payload.tag[0] !== payload.tag[0].toLowerCase());

    if (tag === 'button') {
      el.textContent = payload.textContent || 'Button';
      el.style.cssText = 'padding:8px 16px;border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;border:1px solid currentColor;background:var(--accent,#3b82f6);color:white;';
    } else if (tag === 'input') {
      el.type = 'text'; el.placeholder = 'Input field...';
      el.style.cssText = 'padding:8px 12px;border:1px solid #ccc;border-radius:6px;font-size:14px;width:100%;max-width:300px;background:white;color:#333;';
    } else if (tag === 'textarea') {
      el.placeholder = 'Text area...';
      el.style.cssText = 'padding:8px 12px;border:1px solid #ccc;border-radius:6px;font-size:14px;width:100%;min-height:60px;background:white;color:#333;resize:vertical;';
    } else if (tag === 'img') {
      el.style.cssText = 'width:200px;height:120px;background:#e5e7eb;border-radius:8px;display:flex;align-items:center;justify-content:center;';
    } else if (['h1','h2','h3','h4','h5','h6'].indexOf(tag) >= 0) {
      el.textContent = payload.textContent || 'Heading';
      var sizes = { h1:'2em', h2:'1.5em', h3:'1.25em', h4:'1.1em', h5:'1em', h6:'0.9em' };
      el.style.cssText = 'font-size:' + (sizes[tag]||'1em') + ';font-weight:700;margin:0.5em 0;';
    } else if (tag === 'p') {
      el.textContent = payload.textContent || 'Paragraph text goes here.';
      el.style.cssText = 'margin:0.5em 0;line-height:1.5;';
    } else if (tag === 'a') {
      el.textContent = payload.textContent || 'Link';
      el.style.cssText = 'color:var(--accent,#3b82f6);text-decoration:underline;cursor:pointer;';
    } else if (tag === 'section' || tag === 'div' || tag === 'nav' || tag === 'header' || tag === 'footer' || tag === 'aside' || tag === 'main') {
      if (!payload.classes && !payload.textContent) {
        el.style.cssText = 'min-height:40px;padding:12px;border:1.5px dashed rgba(59,130,246,0.3);border-radius:6px;background:rgba(59,130,246,0.03);';
      } else if (payload.textContent) {
        el.textContent = payload.textContent;
      }
      if (payload.category === 'layout-preset') {
        el.style.minHeight = '60px';
        el.style.padding = el.style.padding || '12px';
        el.style.border = '1.5px dashed rgba(34,197,94,0.3)';
        el.style.borderRadius = '6px';
        el.style.background = 'rgba(34,197,94,0.03)';
      }
    } else if (isComponent) {
      var vcMounted = tryMountComponent(el, payload.tag, payload.defaultProps);
      el.setAttribute('data-annotask-fidelity', vcMounted.fidelity);
      if (vcMounted.reason) el.setAttribute('data-annotask-mount-reason', vcMounted.reason);
      if (!vcMounted.mounted) {
        renderUnmountedBadge(el, payload.tag, vcMounted.reason);
      } else if (vcMounted.fidelity !== 'live') {
        renderFidelityPill(el, vcMounted.fidelity);
      }
    } else {
      el.textContent = payload.textContent || '';
    }
    return el;
  }

  // ── Mount results (honest fidelity) ──────────────────
  // Every tryMount* returns a structured result instead of a bare boolean so the
  // canvas can render a VISIBLY different, honest state per outcome — never a
  // silent empty box. reason: 'not-registered'|'threw'|'rendered-empty'|
  // 'no-runtime'|'async-pending'. fidelity: 'live' (Vue in-context) |
  // 'isolated-preview' (detached React/Svelte/Solid, no provider tree) |
  // 'placeholder' (could not render).
  function mountResult(mounted, reason, fidelity, detail) {
    return { mounted: mounted, reason: reason || null, fidelity: fidelity || (mounted ? 'live' : 'placeholder'), detail: detail || null };
  }

  function errMsg(e) {
    try { return String((e && (e.message || e.toString())) || e).slice(0, 300); } catch (x) { return 'error'; }
  }

  // A mount is empty only when it produced neither element children nor text —
  // a text-only render (e.g. {{ msg }}) is still a real render, not 'empty'.
  function isEmptyMount(mp) {
    return mp.childElementCount === 0 && !(mp.textContent && mp.textContent.replace(/\\s+/g, ''));
  }

  function reasonText(reason) {
    if (reason === 'not-registered') return 'not in registry';
    if (reason === 'threw') return 'render error';
    if (reason === 'rendered-empty') return 'rendered empty';
    if (reason === 'no-runtime') return 'no runtime';
    if (reason === 'async-pending') return 'pending';
    return reason || '';
  }

  // Labeled "couldn't render" box (purple dashed) so a failed mount is never an
  // invisible empty div. Shared by createPlaceholder + the insert:component handler.
  function renderUnmountedBadge(el, label, reason) {
    el.style.cssText = 'position:relative;min-height:80px;padding:16px;border:1px solid rgba(168,85,247,0.2);border-radius:8px;background:rgba(168,85,247,0.03);display:flex;flex-direction:column;gap:8px;overflow:hidden;';
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
    var dot = document.createElement('span');
    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#a855f7;';
    hdr.appendChild(dot);
    var tagLabel = document.createElement('span');
    tagLabel.style.cssText = 'font-size:11px;font-weight:600;color:#a855f7;';
    tagLabel.textContent = label;
    hdr.appendChild(tagLabel);
    if (reason) {
      var reasonLabel = document.createElement('span');
      reasonLabel.style.cssText = 'font-size:10px;font-weight:500;color:#a855f7;opacity:0.7;margin-left:auto;';
      reasonLabel.textContent = reasonText(reason);
      hdr.appendChild(reasonLabel);
    }
    el.appendChild(hdr);
  }

  // A small corner pill marking a non-live fidelity (isolated preview) so the
  // user knows the render is detached from the app's real provider tree.
  function renderFidelityPill(el, fidelity) {
    if (fidelity === 'live') return;
    try {
      var cs = window.getComputedStyle(el);
      if (cs.position === 'static') el.style.position = 'relative';
    } catch(e) {}
    var pill = document.createElement('span');
    pill.setAttribute('data-annotask-fidelity-pill', 'true');
    var color = fidelity === 'isolated-preview' ? '#f59e0b' : '#9ca3af';
    pill.textContent = fidelity === 'isolated-preview' ? 'preview' : 'placeholder';
    pill.style.cssText = 'position:absolute;top:2px;right:2px;z-index:2;font-size:9px;font-weight:600;line-height:1;padding:2px 5px;border-radius:6px;color:#fff;background:' + color + ';pointer-events:none;opacity:0.85;';
    el.appendChild(pill);
  }

  // React/Svelte/Solid mount asynchronously, so a synchronous emptiness check is
  // a false negative. Defer two frames, then flip the container to an honest
  // placeholder ONLY if nothing rendered.
  function scheduleEmptyCheck(container, mountPoint, label) {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        if (!isEmptyMount(mountPoint)) return;
        try { mountPoint.remove(); } catch(e) {}
        var pill = container.querySelector('[data-annotask-fidelity-pill]');
        if (pill) { try { pill.remove(); } catch(e) {} }
        container.removeAttribute('data-annotask-mounted');
        container.setAttribute('data-annotask-fidelity', 'placeholder');
        container.setAttribute('data-annotask-mount-reason', 'rendered-empty');
        renderUnmountedBadge(container, label, 'rendered-empty');
      });
    });
  }

  // On-demand component load: when a component isn't registered on the current
  // route, ask the dev server for its raw module URL, dynamically import it, and
  // register it — so the palette can preview/drop ANY catalog component. Raw
  // (not optimized-dep) import avoids a Vite re-optimization page reload.
  function ensureComponentLoaded(name, module) {
    if (window.__ANNOTASK_COMPONENTS__ && window.__ANNOTASK_COMPONENTS__[name]) return Promise.resolve(true);
    if (!module) return Promise.resolve(false);
    return fetch('/__annotask/preview-module?spec=' + encodeURIComponent(module))
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(j) {
        if (!j || !j.url) return false;
        return import(/* @vite-ignore */ j.url).then(function(mod) {
          var comp = mod && (mod.default || mod[name] || mod);
          if (comp && (typeof comp === 'object' || typeof comp === 'function')) {
            window.__ANNOTASK_COMPONENTS__ = window.__ANNOTASK_COMPONENTS__ || {};
            window.__ANNOTASK_COMPONENTS__[name] = comp;
            return true;
          }
          return false;
        });
      })
      .catch(function() { return false; });
  }

  // ── Per-framework live-mount registry ──────────────────
  // Each framework has a mount strategy with a documented fidelity ceiling. We
  // lift frameworks one at a time toward 'live' (renders inside the app's REAL
  // provider tree) so dropped/previewed components look like the running app:
  //
  //   Framework | Strategy                                    | Fidelity ceiling
  //   ----------|---------------------------------------------|------------------
  //   Vue       | mini-app sharing the parent app's _context  | live  (reference)
  //   React     | detached root re-wrapped in the app's       | live  (best-effort
  //             |   discovered Context.Providers (fiber walk);|   fiber walk; falls
  //             |   bare detached root otherwise              |   back to isolated)
  //   Svelte    | detached mount()                            | isolated-preview
  //   Solid     | detached render()                           | isolated-preview
  //
  // To improve a framework: give it a provider-discovery step like React's and
  // raise its returned fidelity to 'live' when the app context is reachable.
  // tryMountComponent tries each present runtime in order, returning the first
  // success (or the most informative failure).
  function tryMountComponent(container, componentName, props) {
    var runtimes = [
      ['__ANNOTASK_VUE__', tryMountVueComponent],
      ['__ANNOTASK_REACT__', tryMountReactComponent],
      ['__ANNOTASK_SOLID__', tryMountSolidComponent],
      ['__ANNOTASK_SVELTE__', tryMountSvelteComponent]
    ];
    var best = null;
    for (var i = 0; i < runtimes.length; i++) {
      if (!window[runtimes[i][0]]) continue;
      var r = runtimes[i][1](container, componentName, props);
      if (r.mounted) return r;
      // Keep the most informative failure: a definitive reason (threw/empty)
      // beats 'not-registered'/'no-runtime' from a framework that didn't own it.
      if (!best || best.reason === 'not-registered' || best.reason === 'no-runtime') best = r;
    }
    return best || mountResult(false, 'no-runtime', 'placeholder');
  }

  function tryMountVueComponent(container, componentName, props) {
    try {
      var appEl = document.querySelector('#app');
      var vueApp = appEl && appEl.__vue_app__;
      if (!vueApp) return mountResult(false, 'no-runtime', 'placeholder');
      var annotaskVue = window.__ANNOTASK_VUE__;
      if (!annotaskVue || !annotaskVue.createApp || !annotaskVue.h) return mountResult(false, 'no-runtime', 'placeholder');
      var component = vueApp._context.components[componentName] || (window.__ANNOTASK_COMPONENTS__ && window.__ANNOTASK_COMPONENTS__[componentName]);
      if (!component) return mountResult(false, 'not-registered', 'placeholder');
      var mountPoint = document.createElement('div');
      container.appendChild(mountPoint);
      var caught = null;
      var miniApp = annotaskVue.createApp({
        render: function() { return annotaskVue.h(component, props || {}); }
      });
      // Share the parent app's provides, components, directives, and config
      // (by reference) so the dropped component renders in real app context.
      var parentCtx = vueApp._context;
      miniApp._context.components = parentCtx.components;
      miniApp._context.directives = parentCtx.directives;
      miniApp._context.provides = parentCtx.provides;
      miniApp._context.config.globalProperties = parentCtx.config.globalProperties;
      // Capture render errors (instead of the old no-op handlers) so we can
      // report an honest 'threw' reason. warnHandler stays silent.
      miniApp.config.errorHandler = function(err) { caught = err; };
      miniApp.config.warnHandler = function() {};
      miniApp.mount(mountPoint);
      if (caught || isEmptyMount(mountPoint)) {
        try { miniApp.unmount(); } catch(e) {}
        try { mountPoint.remove(); } catch(e) {}
        return mountResult(false, caught ? 'threw' : 'rendered-empty', 'placeholder', caught ? errMsg(caught) : null);
      }
      container.setAttribute('data-annotask-mounted', 'true');
      container.__annotask_unmount = function() { try { miniApp.unmount(); } catch(e) {} };
      return mountResult(true, null, 'live');
    } catch(e) { return mountResult(false, 'threw', 'placeholder', errMsg(e)); }
  }

  // Collect the value of every Context.Provider currently mounted above the app
  // content, so a detached React mount can be re-wrapped in the same providers
  // (theme, router, query, …) and render in real app context instead of an
  // isolated root. Best-effort: it reads React fiber internals (version-
  // sensitive), so any failure returns null and the caller mounts bare.
  function collectReactProviders() {
    try {
      var rootEl = document.querySelector('#root') || document.querySelector('#app') || document.body.firstElementChild;
      if (!rootEl) return null;
      var fiber = null, rk = Object.keys(rootEl);
      for (var ri = 0; ri < rk.length; ri++) {
        if (rk[ri].indexOf('__reactContainer$') === 0 || rk[ri].indexOf('__reactFiber$') === 0) { fiber = rootEl[rk[ri]]; break; }
      }
      if (!fiber) return null;
      var providerSym = (typeof Symbol === 'function' && Symbol.for) ? Symbol.for('react.provider') : null;
      var ctxSym = (typeof Symbol === 'function' && Symbol.for) ? Symbol.for('react.context') : null;
      var found = [], seen = 0, node = fiber.child || fiber;
      // Depth-first down the spine; providers live near the top, so cap the walk.
      while (node && seen < 2000) {
        seen++;
        var t = node.type;
        if (t && t.$$typeof) {
          var ctx = null;
          if (providerSym && t.$$typeof === providerSym && t._context) ctx = t._context;       // React 18: <Ctx.Provider>
          else if (ctxSym && t.$$typeof === ctxSym && t.Provider) ctx = t;                       // React 19: <Ctx> is the provider
          if (ctx && node.memoizedProps && Object.prototype.hasOwnProperty.call(node.memoizedProps, 'value')) {
            found.push({ context: ctx, value: node.memoizedProps.value });
          }
        }
        if (node.child) { node = node.child; continue; }
        while (node && !node.sibling && node !== fiber) node = node.return;
        if (!node || node === fiber) break;
        node = node.sibling;
      }
      return found.length ? found : null;
    } catch(e) { return null; }
  }

  function tryMountReactComponent(container, componentName, props) {
    try {
      var annotaskReact = window.__ANNOTASK_REACT__;
      if (!annotaskReact || !annotaskReact.createElement || !annotaskReact.createRoot) return mountResult(false, 'no-runtime', 'placeholder');
      var component = window.__ANNOTASK_COMPONENTS__ && window.__ANNOTASK_COMPONENTS__[componentName];
      if (!component) return mountResult(false, 'not-registered', 'placeholder');
      var mountPoint = document.createElement('div');
      container.appendChild(mountPoint);
      // Re-wrap the component in the app's discovered providers when reachable so
      // it renders 'live'; fall back to a bare detached root ('isolated-preview').
      var element = annotaskReact.createElement(component, props || {});
      var fidelity = 'isolated-preview';
      var providers = collectReactProviders();
      if (providers && providers.length) {
        try {
          for (var pi = providers.length - 1; pi >= 0; pi--) {
            var Provider = providers[pi].context.Provider || providers[pi].context;
            element = annotaskReact.createElement(Provider, { value: providers[pi].value }, element);
          }
          fidelity = 'live';
        } catch(e) {
          element = annotaskReact.createElement(component, props || {});
          fidelity = 'isolated-preview';
        }
      }
      var root = annotaskReact.createRoot(mountPoint);
      root.render(element);
      container.setAttribute('data-annotask-mounted', 'true');
      container.__annotask_unmount = function() { try { root.unmount(); } catch(e) {} };
      // Confirm it actually rendered on the next frame (may flip to placeholder).
      scheduleEmptyCheck(container, mountPoint, componentName);
      return mountResult(true, null, fidelity);
    } catch(e) { return mountResult(false, 'threw', 'placeholder', errMsg(e)); }
  }

  function tryMountSvelteComponent(container, componentName, props) {
    try {
      var annotaskSvelte = window.__ANNOTASK_SVELTE__;
      if (!annotaskSvelte || !annotaskSvelte.mount) return mountResult(false, 'no-runtime', 'placeholder');
      var component = window.__ANNOTASK_COMPONENTS__ && window.__ANNOTASK_COMPONENTS__[componentName];
      if (!component) return mountResult(false, 'not-registered', 'placeholder');
      var mountPoint = document.createElement('div');
      container.appendChild(mountPoint);
      var instance = annotaskSvelte.mount(component, { target: mountPoint, props: props || {} });
      container.setAttribute('data-annotask-mounted', 'true');
      container.__annotask_unmount = function() {
        try {
          if (annotaskSvelte.unmount) annotaskSvelte.unmount(instance);
        } catch(e) {}
      };
      scheduleEmptyCheck(container, mountPoint, componentName);
      return mountResult(true, null, 'isolated-preview');
    } catch(e) { return mountResult(false, 'threw', 'placeholder'); }
  }

  function tryMountSolidComponent(container, componentName, props) {
    try {
      var annotaskSolid = window.__ANNOTASK_SOLID__;
      if (!annotaskSolid || !annotaskSolid.render) return mountResult(false, 'no-runtime', 'placeholder');
      var component = window.__ANNOTASK_COMPONENTS__ && window.__ANNOTASK_COMPONENTS__[componentName];
      if (!component) return mountResult(false, 'not-registered', 'placeholder');
      var mountPoint = document.createElement('div');
      container.appendChild(mountPoint);
      // solid-js/web render(code, element) returns a dispose function.
      var dispose = annotaskSolid.render(function() { return component(props || {}); }, mountPoint);
      container.setAttribute('data-annotask-mounted', 'true');
      container.__annotask_unmount = function() { try { dispose(); } catch(e) {} };
      scheduleEmptyCheck(container, mountPoint, componentName);
      return mountResult(true, null, 'isolated-preview');
    } catch(e) { return mountResult(false, 'threw', 'placeholder'); }
  }
`
}
