/** Utility functions: isColor, createPlaceholder, tryMount* for Vue/React/Svelte components. */
export function bridgeHelpers(): string {
  return `
  // ── Helpers ───────────────────────────────────────────
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
      if (!vcMounted) {
        el.style.cssText = 'min-height:80px;padding:16px;border:1px solid rgba(168,85,247,0.2);border-radius:8px;background:rgba(168,85,247,0.03);display:flex;flex-direction:column;gap:8px;overflow:hidden;';
        var hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px;';
        var dot = document.createElement('span');
        dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#a855f7;';
        hdr.appendChild(dot);
        var tagLabel = document.createElement('span');
        tagLabel.style.cssText = 'font-size:11px;font-weight:600;color:#a855f7;';
        tagLabel.textContent = payload.tag;
        hdr.appendChild(tagLabel);
        el.appendChild(hdr);
      }
    } else {
      el.textContent = payload.textContent || '';
    }
    return el;
  }

  function tryMountComponent(container, componentName, props) {
    if (window.__ANNOTASK_VUE__) {
      var mounted = tryMountVueComponent(container, componentName, props);
      if (mounted) return true;
    }
    if (window.__ANNOTASK_REACT__) {
      var mounted = tryMountReactComponent(container, componentName, props);
      if (mounted) return true;
    }
    if (window.__ANNOTASK_SVELTE__) {
      var mounted = tryMountSvelteComponent(container, componentName, props);
      if (mounted) return true;
    }
    return false;
  }

  function tryMountVueComponent(container, componentName, props) {
    try {
      var appEl = document.querySelector('#app');
      var vueApp = appEl && appEl.__vue_app__;
      if (!vueApp) return false;
      var annotaskVue = window.__ANNOTASK_VUE__;
      if (!annotaskVue || !annotaskVue.createApp || !annotaskVue.h) return false;
      var component = vueApp._context.components[componentName] || (window.__ANNOTASK_COMPONENTS__ && window.__ANNOTASK_COMPONENTS__[componentName]);
      if (!component) return false;
      var mountPoint = document.createElement('div');
      container.appendChild(mountPoint);
      var miniApp = annotaskVue.createApp({
        render: function() { return annotaskVue.h(component, props || {}); }
      });
      // Share the parent app's provides, components, directives, and config
      // but keep the mini app's own app reference intact
      var parentCtx = vueApp._context;
      miniApp._context.components = parentCtx.components;
      miniApp._context.directives = parentCtx.directives;
      miniApp._context.provides = parentCtx.provides;
      miniApp._context.config.globalProperties = parentCtx.config.globalProperties;
      // Suppress render errors so partial renders still display
      miniApp.config.errorHandler = function() {};
      miniApp.config.warnHandler = function() {};
      miniApp.mount(mountPoint);
      container.setAttribute('data-annotask-mounted', 'true');
      container.__annotask_unmount = function() { try { miniApp.unmount(); } catch(e) {} };
      return true;
    } catch(e) { return false; }
  }

  function tryMountReactComponent(container, componentName, props) {
    try {
      var annotaskReact = window.__ANNOTASK_REACT__;
      if (!annotaskReact || !annotaskReact.createElement || !annotaskReact.createRoot) return false;
      var component = window.__ANNOTASK_COMPONENTS__ && window.__ANNOTASK_COMPONENTS__[componentName];
      if (!component) return false;
      var mountPoint = document.createElement('div');
      container.appendChild(mountPoint);
      var root = annotaskReact.createRoot(mountPoint);
      root.render(annotaskReact.createElement(component, props || {}));
      container.setAttribute('data-annotask-mounted', 'true');
      container.__annotask_unmount = function() { try { root.unmount(); } catch(e) {} };
      return true;
    } catch(e) { return false; }
  }

  function tryMountSvelteComponent(container, componentName, props) {
    try {
      var annotaskSvelte = window.__ANNOTASK_SVELTE__;
      if (!annotaskSvelte || !annotaskSvelte.mount) return false;
      var component = window.__ANNOTASK_COMPONENTS__ && window.__ANNOTASK_COMPONENTS__[componentName];
      if (!component) return false;
      var mountPoint = document.createElement('div');
      container.appendChild(mountPoint);
      var instance = annotaskSvelte.mount(component, { target: mountPoint, props: props || {} });
      container.setAttribute('data-annotask-mounted', 'true');
      container.__annotask_unmount = function() {
        try {
          if (annotaskSvelte.unmount) annotaskSvelte.unmount(instance);
        } catch(e) {}
      };
      return true;
    } catch(e) { return false; }
  }
`
}
