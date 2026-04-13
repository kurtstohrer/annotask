/** DOM event handlers: hover, click, selection, context menu, keyboard, user action tracking, route tracking. */
export function bridgeEvents(): string {
  return `
  // ── Performance State (declared early so event handlers can access) ──
  var PERF_THRESHOLDS = {
    LCP:  { good: 2500, poor: 4000 },
    FCP:  { good: 1800, poor: 3000 },
    CLS:  { good: 0.1,  poor: 0.25 },
    INP:  { good: 200,  poor: 500 },
    TTFB: { good: 800,  poor: 1800 }
  };

  function ratePerfVital(name, value) {
    var t = PERF_THRESHOLDS[name];
    if (!t) return 'good';
    if (value <= t.good) return 'good';
    if (value <= t.poor) return 'needs-improvement';
    return 'poor';
  }

  var perfVitals = {};
  var perfRecording = false;
  var perfRecordStart = 0;
  var perfRecordEvents = [];

  function perfRecordEvent(evtType, label, duration, value) {
    if (!perfRecording) return;
    var t = performance.now() - perfRecordStart;
    var evt = { time: Math.round(t), type: evtType, label: label };
    if (duration !== undefined) evt.duration = Math.round(duration);
    if (value !== undefined) evt.value = value;
    if (perfRecordEvents.length < 500) perfRecordEvents.push(evt);
  }

  // ── Interaction Mode ──────────────────────────────────
  var insideIframe = false;
  try { insideIframe = window.self !== window.top; } catch(e) { insideIframe = true; }

  var storedMode = '';
  try { storedMode = localStorage.getItem('annotask:mode') || ''; } catch(e) {}
  var currentMode = insideIframe ? (storedMode || 'interact') : 'interact';
  var inspectModes = { select: true, pin: true };

  var styleEl = document.createElement('style');
  styleEl.textContent = '.annotask-no-select { -webkit-user-select: none !important; user-select: none !important; }';
  document.head.appendChild(styleEl);
  if (currentMode !== 'interact' && currentMode !== 'highlight') {
    document.body.classList.add('annotask-no-select');
  }

  // ── Event Handlers ────────────────────────────────────
  var lastHoverEid = null;
  var rafPending = false;
  var pendingHoverData = null;

  function onMouseOver(e) {
    if (!inspectModes[currentMode]) return;
    var el = e.target;
    if (!el || el === document.documentElement || el === document.body) return;
    var eid = getEid(el);
    if (eid === lastHoverEid) return;
    lastHoverEid = eid;

    var source = findSourceElement(el);
    var data = getSourceData(source.sourceEl);

    pendingHoverData = {
      eid: eid,
      tag: el.tagName.toLowerCase(),
      file: data.file,
      component: data.component,
      rect: getRect(el)
    };

    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(function() {
        rafPending = false;
        if (pendingHoverData) sendToShell('hover:enter', pendingHoverData);
      });
    }
  }

  function onMouseOut(e) {
    if (!inspectModes[currentMode]) return;
    if (e.relatedTarget && e.relatedTarget !== document.documentElement) return;
    lastHoverEid = null;
    pendingHoverData = null;
    sendToShell('hover:leave', {});
  }

  function onClick(e) {
    if (!inspectModes[currentMode]) return;
    e.preventDefault();
    e.stopPropagation();

    var el = e.target;
    if (!el) return;

    var source = findSourceElement(el);
    var data = getSourceData(source.sourceEl);
    var targetEl = source.targetEl;
    var classes = typeof targetEl.className === 'string' ? targetEl.className : '';

    sendToShell('click:element', {
      eid: getEid(targetEl),
      sourceEid: getEid(source.sourceEl),
      file: data.file,
      line: data.line,
      component: data.component,
      mfe: data.mfe,
      tag: targetEl.tagName.toLowerCase(),
      classes: classes,
      rect: getRect(targetEl),
      shiftKey: e.shiftKey,
      clientX: e.clientX,
      clientY: e.clientY
    });
  }

  function onMouseDown(e) {
    if (!inspectModes[currentMode]) return;
    e.stopPropagation();
  }

  function onMouseUp(e) {
    if (currentMode !== 'highlight') return;
    var sel = document.getSelection();
    var text = sel ? sel.toString().trim() : '';
    if (!text || text.length < 2) return;
    var anchorEl = sel.anchorNode ? sel.anchorNode.parentElement : null;
    if (!anchorEl) return;
    var source = findSourceElement(anchorEl);
    var data = getSourceData(source.sourceEl);

    var selRect = null;
    try {
      var range = sel.getRangeAt(0);
      var br = range.getBoundingClientRect();
      if (br.width > 0 && br.height > 0) selRect = { x: br.x, y: br.y, width: br.width, height: br.height };
    } catch (_e) {}
    sendToShell('selection:text', {
      text: text,
      eid: getEid(anchorEl),
      file: data.file,
      line: parseInt(data.line) || 0,
      component: data.component,
      mfe: data.mfe,
      tag: anchorEl.tagName.toLowerCase(),
      rect: selRect
    });
  }

  function onContextMenu(e) {
    if (currentMode === 'interact') return;
    e.preventDefault();
    var el = e.target;
    if (!el) return;
    var source = findSourceElement(el);
    var data = getSourceData(source.sourceEl);
    var targetEl = source.targetEl;
    var classes = typeof targetEl.className === 'string' ? targetEl.className : '';

    sendToShell('contextmenu:element', {
      eid: getEid(targetEl),
      sourceEid: getEid(source.sourceEl),
      file: data.file,
      line: data.line,
      component: data.component,
      mfe: data.mfe,
      tag: targetEl.tagName.toLowerCase(),
      classes: classes,
      rect: getRect(targetEl),
      shiftKey: false,
      clientX: e.clientX,
      clientY: e.clientY
    });
  }

  function onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      sendToShell('keydown', { key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey });
    }
  }

  document.addEventListener('mouseover', onMouseOver, { capture: true });
  document.addEventListener('mouseout', onMouseOut, { capture: true });
  document.addEventListener('mousedown', onMouseDown, { capture: true });
  document.addEventListener('click', onClick, { capture: true });
  document.addEventListener('mouseup', onMouseUp, { capture: true });
  document.addEventListener('keydown', onKeyDown, { capture: true });
  document.addEventListener('contextmenu', onContextMenu, { capture: true });

  // ── User Action Tracking (interact mode) ───────────────
  var lastActionTs = 0;
  function onUserAction(e) {
    var el = e.target;
    if (!el || !el.closest) return;

    var now = Date.now();
    if (now - lastActionTs < 50) return;
    lastActionTs = now;

    var actionEl = el.closest('a, button, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [type="submit"], tr[class*="row"], [data-pc-section="bodyrow"]');
    var descEl = actionEl || el;

    var tag = descEl.tagName.toLowerCase();
    var text = '';
    if (el.innerText) text = el.innerText.trim();
    if (!text && descEl.innerText) text = descEl.innerText.trim();
    text = text.split(String.fromCharCode(10))[0].substring(0, 60);

    var href = '';
    if (tag === 'a') href = descEl.getAttribute('href') || '';
    else if (el.closest('a')) href = el.closest('a').getAttribute('href') || '';

    var source = findSourceElement(descEl);
    var data = getSourceData(source.sourceEl);

    sendToShell('user:action', {
      tag: tag,
      text: text,
      href: href,
      component: data.component || '',
    });

    var actionLabel = tag + (text ? ' "' + text.substring(0, 40) + '"' : '') + (href ? ' \\u2192 ' + href : '');
    perfRecordEvent('action', 'Click ' + actionLabel);
  }

  document.addEventListener('click', onUserAction, { capture: true });

  // ── Console / Error Monitor ────────────────────────────
  var errorCounts = {};
  var errorCountKeys = 0;
  var MAX_ERROR_KEYS = 500;
  var MAX_ERROR_MESSAGE_LEN = 2000;
  var MAX_ERROR_STACK_LEN = 4000;
  var errorSending = false;  // re-entrancy guard

  function errorKey(msg, stack) {
    var first = '';
    if (stack) {
      var lines = stack.split(String.fromCharCode(10));
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (l && l !== msg && (l.indexOf('at ') === 0 || l.indexOf('@') !== -1)) { first = l; break; }
      }
    }
    return msg + '||' + first;
  }

  function patchConsole(level) {
    var orig = console[level];
    if (typeof orig !== 'function') return;
    console[level] = function() {
      orig.apply(console, arguments);
      if (errorSending) return;
      errorSending = true;
      try {
        var parts = [];
        for (var i = 0; i < arguments.length; i++) {
          try { parts.push(typeof arguments[i] === 'string' ? arguments[i] : JSON.stringify(arguments[i])); }
          catch(e) { parts.push(String(arguments[i])); }
        }
        var msg = parts.join(' ');
        if (msg.length > MAX_ERROR_MESSAGE_LEN) msg = msg.slice(0, MAX_ERROR_MESSAGE_LEN) + '...';
        var stack = '';
        try { stack = new Error().stack || ''; } catch(e) {}
        var slines = stack.split(String.fromCharCode(10));
        stack = slines.slice(3).join(String.fromCharCode(10));
        if (stack.length > MAX_ERROR_STACK_LEN) stack = stack.slice(0, MAX_ERROR_STACK_LEN) + '...';

        var key = errorKey(msg, stack);
        if (!errorCounts[key] && errorCountKeys < MAX_ERROR_KEYS) {
          errorCounts[key] = 0;
          errorCountKeys++;
        }
        var tracked = Object.prototype.hasOwnProperty.call(errorCounts, key);
        var count = tracked ? (errorCounts[key] + 1) : 1;
        if (tracked) errorCounts[key] = count;
        sendToShell('error:console', { level: level, message: msg, stack: stack, count: count, timestamp: Date.now() });
      } catch(e) {}
      errorSending = false;
    };
  }
  patchConsole('error');
  patchConsole('warn');

  window.addEventListener('error', function(e) {
    try {
      var msg = e.message || String(e);
      var stack = e.error && e.error.stack ? e.error.stack : (e.filename ? e.filename + ':' + e.lineno + ':' + e.colno : '');
      if (msg.length > MAX_ERROR_MESSAGE_LEN) msg = msg.slice(0, MAX_ERROR_MESSAGE_LEN) + '...';
      if (stack.length > MAX_ERROR_STACK_LEN) stack = stack.slice(0, MAX_ERROR_STACK_LEN) + '...';
      sendToShell('error:unhandled', { type: 'error', message: msg, stack: stack, timestamp: Date.now() });
    } catch(err) {}
  });

  window.addEventListener('unhandledrejection', function(e) {
    try {
      var msg = '';
      var stack = '';
      if (e.reason) {
        msg = e.reason.message || String(e.reason);
        stack = e.reason.stack || '';
      } else {
        msg = 'Unhandled promise rejection';
      }
      if (msg.length > MAX_ERROR_MESSAGE_LEN) msg = msg.slice(0, MAX_ERROR_MESSAGE_LEN) + '...';
      if (stack.length > MAX_ERROR_STACK_LEN) stack = stack.slice(0, MAX_ERROR_STACK_LEN) + '...';
      sendToShell('error:unhandled', { type: 'rejection', message: msg, stack: stack, timestamp: Date.now() });
    } catch(err) {}
  });

  // ── Route Tracking ────────────────────────────────────
  var lastRoute = window.location.pathname;

  function checkRoute() {
    var path = window.location.pathname;
    if (path !== lastRoute) {
      lastRoute = path;
      sendToShell('route:changed', { path: path });
      perfRecordEvent('navigation', 'Navigate ' + path);
    }
  }

  window.addEventListener('popstate', checkRoute);
  window.addEventListener('hashchange', checkRoute);
  setInterval(checkRoute, 2000);
`
}
