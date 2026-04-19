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
  // Tracks whether the shell currently has a highlight painted. lastHoverEid
  // is client-side intent; shellShowing is the committed shell state. They
  // diverge whenever rAF bails after onMouseOver already updated
  // lastHoverEid — without this flag those bails leak a stuck highlight of
  // the previously-painted element.
  var shellShowing = false;

  function clearHoverState() {
    lastHoverEid = null;
    pendingHoverData = null;
    if (!shellShowing) return;
    shellShowing = false;
    sendToShell('hover:leave', {});
  }

  function onMouseOver(e) {
    if (!inspectModes[currentMode]) return;
    var el = e.target;
    if (!el || el === document.documentElement || el === document.body) { clearHoverState(); return; }
    var eid = getEid(el);
    if (eid === lastHoverEid) return;

    var rect = getRect(el);
    // Skip hover on elements that cover most of the viewport — these are
    // layout wrappers (Theme, Box, outer Flex) the user rarely wants to
    // highlight. Clear any stuck prior highlight on the way out, otherwise
    // the old rect lingers after the cursor crosses into a big wrapper.
    var vw = window.innerWidth || document.documentElement.clientWidth || 1;
    var vh = window.innerHeight || document.documentElement.clientHeight || 1;
    if (rect.width * rect.height > vw * vh * 0.6) { clearHoverState(); return; }

    lastHoverEid = eid;

    var source = findSourceElement(el);
    var data = getSourceData(source.sourceEl);

    pendingHoverData = {
      eid: eid,
      tag: el.tagName.toLowerCase(),
      file: data.file,
      component: data.component,
      source_tag: data.source_tag,
      parent_component: findParentComponent(source.sourceEl, data.component),
      rect: rect
    };

    if (!rafPending) {
      rafPending = true;
      requestAnimationFrame(function() {
        rafPending = false;
        // Re-verify state at flush time. If any check fails AND the shell is
        // currently painting a stale highlight, emit leave so it clears —
        // otherwise the previously-painted rect stays stuck while
        // lastHoverEid has already moved on.
        var ok = !!pendingHoverData
          && inspectModes[currentMode]
          && pendingHoverData.eid === lastHoverEid;
        var el = ok ? getEl(pendingHoverData.eid) : null;
        if (ok && (!el || !el.isConnected)) ok = false;
        if (ok) { try { if (!el.matches(':hover')) ok = false; } catch (_e) {} }
        if (ok) {
          shellShowing = true;
          sendToShell('hover:enter', pendingHoverData);
        } else if (shellShowing) {
          shellShowing = false;
          lastHoverEid = null;
          pendingHoverData = null;
          sendToShell('hover:leave', {});
        }
      });
    }
  }

  function onMouseOut(e) {
    if (!inspectModes[currentMode]) return;
    // Only suppress the clear if relatedTarget is still a live node inside
    // this document. Transient/detached relatedTargets (common during
    // virtualized-list updates or re-renders) would otherwise swallow the
    // leave and leave the highlight stuck.
    var rt = e.relatedTarget;
    if (rt && rt.nodeType === 1 && document.documentElement.contains(rt)) return;
    clearHoverState();
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
      source_tag: data.source_tag,
      parent_component: findParentComponent(source.sourceEl, data.component),
      mfe: data.mfe,
      tag: targetEl.tagName.toLowerCase(),
      classes: classes,
      rect: getRect(targetEl),
      shiftKey: e.shiftKey,
      clientX: e.clientX,
      clientY: e.clientY,
      text: getVisibleText(targetEl, 200)
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

    // Measure the iframe's position in the shell at mouseup time so the rects
    // we send are in shell-viewport coords. The shell can't do this after the
    // fact — by the time the message arrives, panel shifts from task creation
    // may have moved the iframe, and the selection would land in the wrong spot.
    var frameOffX = 0, frameOffY = 0;
    try {
      var frame = window.frameElement;
      if (frame) {
        var fr = frame.getBoundingClientRect();
        frameOffX = fr.left; frameOffY = fr.top;
      }
    } catch (_e) {}

    var selRect = null;
    var selRects = null;
    try {
      var range = sel.getRangeAt(0);
      var br = range.getBoundingClientRect();
      if (br.width > 0 && br.height > 0) selRect = { x: br.x + frameOffX, y: br.y + frameOffY, width: br.width, height: br.height };
      var crs = range.getClientRects();
      if (crs && crs.length > 0) {
        selRects = [];
        for (var i = 0; i < crs.length; i++) {
          var cr = crs[i];
          if (cr.width > 0 && cr.height > 0) selRects.push({ x: cr.x + frameOffX, y: cr.y + frameOffY, width: cr.width, height: cr.height });
        }
        if (selRects.length === 0) selRects = null;
      }
    } catch (_e) {}
    sendToShell('selection:text', {
      text: text,
      eid: getEid(anchorEl),
      file: data.file,
      line: parseInt(data.line) || 0,
      component: data.component,
      source_tag: data.source_tag,
      mfe: data.mfe,
      tag: anchorEl.tagName.toLowerCase(),
      rect: selRect,
      rects: selRects
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
      clientY: e.clientY,
      text: getVisibleText(targetEl, 200)
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

  // ── Data-view hover reporter ──
  // The shell toggles this via a 'data:watch' message. When active, every
  // mousemove walks up to find the nearest element with data-annotask-file,
  // then emits 'data:hover' with (file, line, clientX, clientY) to the shell.
  // Lets the shell show a tooltip over highlighted elements without needing
  // same-origin contentDocument access.
  var dataWatchActive = false;
  var dataHoverRaf = false;
  var dataHoverPending = null;

  function onDataWatchMove(e) {
    if (!dataWatchActive) return;
    var el = e.target;
    // Walk up looking for an annotated ancestor. Tag is read from the SAME
    // element as file+line — carrying tag independently across ancestors
    // mixes a component tag from one node with a call-site file from another
    // and confuses shell-side source lookup.
    //
    // React transforms every JSX opening tag (including intrinsics like
    // <div>), so the innermost hit often has a lowercase tag that will
    // never match a library source. In that case keep climbing so the
    // containing user component's call site is reported instead. Vue/Svelte
    // templates behave the same — intrinsic roots exist there too.
    var fallback = null;
    var found = null;
    while (el && el !== document && el !== document.documentElement) {
      if (el.nodeType === 1 && el.getAttribute) {
        var file = el.getAttribute('data-annotask-file');
        if (file) {
          var tag = el.getAttribute('data-annotask-source-tag') || '';
          var line = el.getAttribute('data-annotask-line') || '';
          // Remember the innermost annotated node as a fallback in case we
          // never climb into a component tag.
          if (!fallback) fallback = { file: file, line: line, tag: tag };
          // Prefer the first node whose tag looks like a user component —
          // JSX / SFC component names are uppercase by convention.
          if (tag && /^[A-Z]/.test(tag.charAt(0))) {
            found = { file: file, line: line, tag: tag };
            break;
          }
        }
      }
      el = el.parentNode;
    }
    var picked = found || fallback;
    if (picked) {
      dataHoverPending = { file: picked.file, line: picked.line, tag: picked.tag, clientX: e.clientX, clientY: e.clientY };
    } else {
      dataHoverPending = { file: '', line: '', tag: '', clientX: e.clientX, clientY: e.clientY };
    }
    if (!dataHoverRaf) {
      dataHoverRaf = true;
      requestAnimationFrame(function() {
        dataHoverRaf = false;
        if (dataWatchActive && dataHoverPending) sendToShell('data:hover', dataHoverPending);
      });
    }
  }

  function onDataWatchLeave() {
    if (!dataWatchActive) return;
    dataHoverPending = null;
    sendToShell('data:hover', { file: '', line: '', tag: '', clientX: 0, clientY: 0 });
  }

  document.addEventListener('mousemove', onDataWatchMove, { capture: true, passive: true });
  document.addEventListener('mouseleave', onDataWatchLeave);

  // Exposed so the message handler (in messages.ts, same inlined scope) can
  // flip the flag. Using a global-ish var works because both scripts share
  // the bridge-client IIFE scope.
  window.__annotaskSetDataWatch = function(on) { dataWatchActive = !!on; };

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
