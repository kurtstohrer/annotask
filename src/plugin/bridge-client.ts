/**
 * Client bridge script injected into the user's app.
 * Communicates with the Annotask shell via postMessage.
 * Handles all DOM interactions: hover, click, style reads/writes,
 * element resolution, layout scanning, etc.
 *
 * Returned as an inline string (same pattern as toggle-button.ts).
 */
export function bridgeClientScript(): string {
  return `
(function() {
  // Don't run inside the Annotask shell
  if (window.location.pathname.startsWith('/__annotask')) return;
  // Don't run if already initialized
  if (window.__ANNOTASK_BRIDGE__) return;
  window.__ANNOTASK_BRIDGE__ = true;

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
    // type is not needed for responses — shell matches by id
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
    // Prefer data-annotask-* attributes, fall back to data-astro-source-* (Astro framework)
    var file = el.getAttribute('data-annotask-file') || '';
    var line = el.getAttribute('data-annotask-line') || '';
    var component = el.getAttribute('data-annotask-component') || '';

    if (!file && el.getAttribute('data-astro-source-file')) {
      var astroFile = el.getAttribute('data-astro-source-file') || '';
      // Convert absolute path to project-relative by finding src/ prefix
      var srcIdx = astroFile.indexOf('/src/');
      file = srcIdx !== -1 ? astroFile.slice(srcIdx + 1) : astroFile;
    }
    if ((!line || line === '0') && el.getAttribute('data-astro-source-loc')) {
      // data-astro-source-loc format: "line:col"
      line = (el.getAttribute('data-astro-source-loc') || '').split(':')[0];
    }
    if (!component && file) {
      // Derive component name from file path
      var parts = file.split('/');
      var fileName = parts[parts.length - 1] || '';
      component = fileName.replace(/\.[^.]+$/, '');
    }

    var mfe = el.getAttribute('data-annotask-mfe') || '';

    return { file: file, line: line, component: component, mfe: mfe };
  }

  function getRect(el) {
    var r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  // ── Interaction Mode ──────────────────────────────────
  var storedMode = '';
  try { storedMode = localStorage.getItem('annotask:mode') || ''; } catch(e) {}
  var currentMode = storedMode || 'select';
  var inspectModes = { select: true, pin: true };

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
    // Only fire leave when truly leaving all elements
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

    sendToShell('selection:text', {
      text: text,
      eid: getEid(anchorEl),
      file: data.file,
      line: parseInt(data.line) || 0,
      component: data.component,
      mfe: data.mfe,
      tag: anchorEl.tagName.toLowerCase()
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

  // Install event listeners
  document.addEventListener('mouseover', onMouseOver, { capture: true });
  document.addEventListener('mouseout', onMouseOut, { capture: true });
  document.addEventListener('mousedown', onMouseDown, { capture: true });
  document.addEventListener('click', onClick, { capture: true });
  document.addEventListener('mouseup', onMouseUp, { capture: true });
  document.addEventListener('keydown', onKeyDown, { capture: true });
  document.addEventListener('contextmenu', onContextMenu, { capture: true });

  // ── User Action Tracking (interact mode) ───────────────
  // Tracks meaningful page actions (link/button clicks) so the LLM
  // can understand what the user did to reach the current state.

  var lastActionTs = 0;
  function onUserAction(e) {
    var el = e.target;
    if (!el || !el.closest) return;

    // Debounce — ignore clicks within 50ms (same gesture)
    var now = Date.now();
    if (now - lastActionTs < 50) return;
    lastActionTs = now;

    // Find the best description of what was clicked
    var actionEl = el.closest('a, button, [role="button"], [role="tab"], [role="menuitem"], [role="link"], [type="submit"], tr[class*="row"], [data-pc-section="bodyrow"]');
    var descEl = actionEl || el;

    var tag = descEl.tagName.toLowerCase();
    // Get concise text: prefer innerText of the immediate target, fall back to closest actionable
    var text = '';
    if (el.innerText) text = el.innerText.trim();
    if (!text && descEl.innerText) text = descEl.innerText.trim();
    text = text.split(String.fromCharCode(10))[0].substring(0, 60);

    var href = '';
    if (tag === 'a') href = descEl.getAttribute('href') || '';
    else if (el.closest('a')) href = el.closest('a').getAttribute('href') || '';

    // Get component context if available
    var source = findSourceElement(descEl);
    var data = getSourceData(source.sourceEl);

    sendToShell('user:action', {
      tag: tag,
      text: text,
      href: href,
      component: data.component || '',
    });
  }

  document.addEventListener('click', onUserAction, { capture: true });

  // ── Route Tracking ────────────────────────────────────
  var lastRoute = window.location.pathname;

  function checkRoute() {
    var path = window.location.pathname;
    if (path !== lastRoute) {
      lastRoute = path;
      sendToShell('route:changed', { path: path });
    }
  }

  window.addEventListener('popstate', checkRoute);
  window.addEventListener('hashchange', checkRoute);
  setInterval(checkRoute, 2000); // safety net for pushState

  // ── Message Handler ───────────────────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || msg.source !== 'annotask-shell') return;
    // Tighten origin on first shell message
    if (shellOrigin === '*' && event.origin) shellOrigin = event.origin;

    var type = msg.type;
    var payload = msg.payload || {};
    var id = msg.id;

    // ── Mode ──
    if (type === 'mode:set') {
      currentMode = payload.mode || 'select';
      try { localStorage.setItem('annotask:mode', currentMode); } catch(e) {}
      return;
    }

    // ── Ping ──
    if (type === 'bridge:ping') {
      respond(id, {});
      return;
    }

    // ── Element Resolution ──
    if (type === 'resolve:at-point') {
      var el = document.elementFromPoint(payload.x, payload.y);
      if (!el || el === document.documentElement || el === document.body) {
        respond(id, null);
        return;
      }
      var src = findSourceElement(el);
      var srcData = getSourceData(src.sourceEl);
      respond(id, {
        eid: getEid(src.targetEl),
        file: srcData.file,
        line: srcData.line,
        component: srcData.component,
        mfe: srcData.mfe,
        tag: src.sourceEl.tagName.toLowerCase(),
        rect: getRect(src.sourceEl),
        classes: typeof src.targetEl.className === 'string' ? src.targetEl.className : ''
      });
      return;
    }

    if (type === 'resolve:template-group') {
      var all = document.querySelectorAll(
        '[data-annotask-file="' + payload.file + '"][data-annotask-line="' + payload.line + '"]'
      );
      // Also check Astro source attributes
      if (all.length === 0 && payload.file && payload.line) {
        // Try matching by astro source attributes (absolute path ends with file, loc starts with line)
        var astroAll = document.querySelectorAll('[data-astro-source-file]');
        var matched = [];
        for (var ai = 0; ai < astroAll.length; ai++) {
          var af = astroAll[ai].getAttribute('data-astro-source-file') || '';
          var al = (astroAll[ai].getAttribute('data-astro-source-loc') || '').split(':')[0];
          if (af.endsWith('/' + payload.file) && al === payload.line) matched.push(astroAll[ai]);
        }
        if (matched.length > 0) all = matched;
      }
      var eids = [];
      var rects = [];
      for (var i = 0; i < all.length; i++) {
        if (all[i].tagName.toLowerCase() === payload.tagName) {
          eids.push(getEid(all[i]));
          rects.push(getRect(all[i]));
        }
      }
      respond(id, { eids: eids, rects: rects });
      return;
    }

    if (type === 'resolve:rect') {
      var rEl = getEl(payload.eid);
      respond(id, rEl ? { rect: getRect(rEl) } : null);
      return;
    }

    if (type === 'resolve:rects') {
      var results = [];
      for (var j = 0; j < payload.eids.length; j++) {
        var re = getEl(payload.eids[j]);
        results.push(re ? getRect(re) : null);
      }
      respond(id, { rects: results });
      return;
    }

    // ── Style Operations ──
    if (type === 'style:get-computed') {
      var sEl = getEl(payload.eid);
      if (!sEl) { respond(id, { styles: {} }); return; }
      var cs = window.getComputedStyle(sEl);
      var styles = {};
      for (var k = 0; k < payload.properties.length; k++) {
        styles[payload.properties[k]] = cs.getPropertyValue(payload.properties[k]);
      }
      respond(id, { styles: styles });
      return;
    }

    if (type === 'style:apply') {
      var aEl = getEl(payload.eid);
      if (!aEl) { respond(id, { before: '' }); return; }
      var before = window.getComputedStyle(aEl).getPropertyValue(payload.property);
      aEl.style.setProperty(payload.property, payload.value);
      respond(id, { before: before });
      return;
    }

    if (type === 'style:apply-batch') {
      var befores = [];
      for (var m = 0; m < payload.eids.length; m++) {
        var bEl = getEl(payload.eids[m]);
        if (bEl) {
          befores.push(window.getComputedStyle(bEl).getPropertyValue(payload.property));
          bEl.style.setProperty(payload.property, payload.value);
        } else {
          befores.push('');
        }
      }
      respond(id, { befores: befores });
      return;
    }

    if (type === 'style:undo') {
      var uEl = getEl(payload.eid);
      if (uEl) {
        if (payload.value) uEl.style.setProperty(payload.property, payload.value);
        else uEl.style.removeProperty(payload.property);
      }
      respond(id, {});
      return;
    }

    if (type === 'class:get') {
      var cEl = getEl(payload.eid);
      respond(id, { classes: cEl ? (typeof cEl.className === 'string' ? cEl.className : '') : '' });
      return;
    }

    if (type === 'class:set') {
      var csEl = getEl(payload.eid);
      if (!csEl) { respond(id, { before: '' }); return; }
      var classBefore = typeof csEl.className === 'string' ? csEl.className : '';
      csEl.className = payload.classes;
      respond(id, { before: classBefore });
      return;
    }

    if (type === 'class:set-batch') {
      var classBefores = [];
      for (var n = 0; n < payload.eids.length; n++) {
        var cbEl = getEl(payload.eids[n]);
        if (cbEl) {
          classBefores.push(typeof cbEl.className === 'string' ? cbEl.className : '');
          cbEl.className = payload.classes;
        } else {
          classBefores.push('');
        }
      }
      respond(id, { befores: classBefores });
      return;
    }

    if (type === 'class:undo') {
      var cuEl = getEl(payload.eid);
      if (cuEl) cuEl.className = payload.classes;
      respond(id, {});
      return;
    }

    // ── Classification ──
    if (type === 'classify:element') {
      var clEl = getEl(payload.eid);
      if (!clEl) { respond(id, null); return; }
      var tag = clEl.tagName.toLowerCase();
      var clCs = window.getComputedStyle(clEl);
      var display = clCs.display;
      var childCount = clEl.children.length;
      var isFlex = display.includes('flex');
      var isGrid = display.includes('grid');
      var semanticContainers = ['section','main','aside','nav','header','footer','article'];
      var role = 'content';
      if (clEl.hasAttribute('data-annotask-component')) {
        var comp = clEl.getAttribute('data-annotask-component') || '';
        if (comp && comp[0] === comp[0].toUpperCase() && comp[0] !== comp[0].toLowerCase()) {
          role = 'component';
        }
      }
      if (role !== 'component' && (isFlex || isGrid) && childCount > 0) role = 'container';
      if (role !== 'component' && role !== 'container' && semanticContainers.indexOf(tag) >= 0 && childCount > 0) role = 'container';

      respond(id, {
        role: role,
        display: display,
        isFlexContainer: isFlex,
        isGridContainer: isGrid,
        flexDirection: isFlex ? clCs.flexDirection : undefined,
        childCount: childCount,
        isComponentUnit: role === 'component'
      });
      return;
    }

    if (type === 'resolve:element-context') {
      var ctxEl = getEl(payload.eid);
      if (!ctxEl) { respond(id, null); return; }

      // Ancestors: walk up 3 levels, capture layout-relevant styles
      var ancestors = [];
      var cur = ctxEl.parentElement;
      for (var ai = 0; ai < 3 && cur && cur !== document.body && cur !== document.documentElement; ai++) {
        var aCs = window.getComputedStyle(cur);
        var aTag = cur.tagName.toLowerCase();
        var aClasses = typeof cur.className === 'string' ? cur.className.trim() : '';
        var aData = getSourceData(cur);
        var ancestor = { tag: aTag, display: aCs.display };
        if (aClasses) ancestor.classes = aClasses;
        if (aData.component) ancestor.component = aData.component;
        if (aCs.display.includes('flex')) {
          ancestor.flexDirection = aCs.flexDirection;
          if (aCs.gap && aCs.gap !== 'normal') ancestor.gap = aCs.gap;
          ancestor.childCount = cur.children.length;
        }
        if (aCs.display.includes('grid')) {
          ancestor.gridTemplateColumns = aCs.gridTemplateColumns;
          ancestor.gridTemplateRows = aCs.gridTemplateRows;
          if (aCs.gap && aCs.gap !== 'normal') ancestor.gap = aCs.gap;
          ancestor.childCount = cur.children.length;
        }
        if (aCs.overflow && aCs.overflow !== 'visible') ancestor.overflow = aCs.overflow;
        ancestors.push(ancestor);
        cur = cur.parentElement;
      }

      // Subtree: simplified HTML of the element and its children (3 levels deep)
      function describeEl(el, depth) {
        var t = el.tagName.toLowerCase();
        var cl = typeof el.className === 'string' ? el.className.trim() : '';
        var txt = '';
        // Only get direct text (not from children)
        for (var ci = 0; ci < el.childNodes.length; ci++) {
          if (el.childNodes[ci].nodeType === 3) {
            var nt = el.childNodes[ci].textContent.trim();
            if (nt) { txt = nt.substring(0, 40); break; }
          }
        }
        var node = { tag: t };
        if (cl) node.classes = cl;
        if (txt) node.text = txt;
        if (depth < 3 && el.children.length > 0) {
          var kids = [];
          for (var ki = 0; ki < el.children.length && ki < 10; ki++) {
            kids.push(describeEl(el.children[ki], depth + 1));
          }
          node.children = kids;
          if (el.children.length > 10) node.childrenTruncated = el.children.length;
        }
        return node;
      }

      respond(id, {
        ancestors: ancestors,
        subtree: describeEl(ctxEl, 0)
      });
      return;
    }

    // ── Accessibility Scan ──
    if (type === 'a11y:scan') {
      var a11yEid = payload.eid;
      var a11yEl = a11yEid ? getEl(a11yEid) : document.body;
      if (!a11yEl) { respond(id, { violations: [] }); return; }

      function runAxeScan(target) {
        if (!window.axe) { respond(id, { violations: [], error: 'axe not loaded' }); return; }
        window.axe.run(target, { resultTypes: ['violations'] }, function(err, results) {
          if (err) { respond(id, { violations: [], error: err.message }); return; }
          var violations = [];
          for (var vi = 0; vi < results.violations.length; vi++) {
            var v = results.violations[vi];
            var nodeDetails = [];
            for (var ni = 0; ni < v.nodes.length && ni < 5; ni++) {
              var node = v.nodes[ni];
              var detail = {
                html: (node.html || '').substring(0, 200),
                target: node.target ? node.target[0] : '',
                failureSummary: node.failureSummary || ''
              };
              // Try to resolve annotask source for this element
              var selector = node.target ? node.target[0] : null;
              if (selector) {
                try {
                  var domEl = document.querySelector(selector);
                  if (domEl) {
                    var src = findSourceElement(domEl);
                    var srcData = getSourceData(src.sourceEl);
                    if (srcData.file) {
                      detail.file = srcData.file;
                      detail.line = srcData.line;
                      detail.component = srcData.component;
                    }
                  }
                } catch(e) {}
              }
              nodeDetails.push(detail);
            }
            violations.push({
              id: v.id,
              impact: v.impact,
              description: v.description,
              help: v.help,
              helpUrl: v.helpUrl,
              nodes: v.nodes.length,
              elements: nodeDetails
            });
          }
          respond(id, { violations: violations });
        });
      }

      if (window.axe) {
        runAxeScan(a11yEl);
      } else {
        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js';
        script.onload = function() { runAxeScan(a11yEl); };
        script.onerror = function() { respond(id, { violations: [], error: 'failed to load axe-core' }); };
        document.head.appendChild(script);
      }
      return;
    }

    // ── Screenshot Capture ──
    if (type === 'screenshot:capture') {
      var clipRect = payload.rect;

      function doCapture(clip) {
        if (!window.html2canvas) {
          respond(id, { error: 'html2canvas not loaded' });
          return;
        }
        var opts = { useCORS: true, logging: false, allowTaint: true };
        if (clip) {
          opts.x = clip.x;
          opts.y = clip.y;
          opts.width = clip.width;
          opts.height = clip.height;
        }
        window.html2canvas(document.body, opts).then(function(canvas) {
          var dataUrl = canvas.toDataURL('image/png');
          respond(id, { dataUrl: dataUrl });
        }).catch(function(err) {
          respond(id, { error: err.message || 'capture failed' });
        });
      }

      if (window.html2canvas) {
        doCapture(clipRect);
      } else {
        var h2cScript = document.createElement('script');
        h2cScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        h2cScript.onload = function() { doCapture(clipRect); };
        h2cScript.onerror = function() { respond(id, { error: 'failed to load html2canvas' }); };
        document.head.appendChild(h2cScript);
      }
      return;
    }

    // ── Layout Scan ──
    if (type === 'layout:scan') {
      var layoutResults = [];
      var allEls = document.querySelectorAll('*');
      for (var li = 0; li < allEls.length; li++) {
        var lEl = allEls[li];
        if (lEl.nodeType !== 1) continue;
        var lCs = window.getComputedStyle(lEl);
        var lDisplay = lCs.display;
        if (!lDisplay.includes('flex') && !lDisplay.includes('grid')) continue;
        var lRect = lEl.getBoundingClientRect();
        if (lRect.width < 20 || lRect.height < 20) continue;
        var lIsGrid = lDisplay.includes('grid');
        var entry = {
          eid: getEid(lEl),
          display: lIsGrid ? 'grid' : 'flex',
          direction: lIsGrid ? 'grid' : lCs.flexDirection,
          rect: { x: lRect.x, y: lRect.y, width: lRect.width, height: lRect.height },
          columnGap: parseFloat(lCs.columnGap) || 0,
          rowGap: parseFloat(lCs.rowGap) || 0
        };
        if (lIsGrid) {
          var cols = lCs.gridTemplateColumns;
          var rows = lCs.gridTemplateRows;
          entry.templateColumns = cols;
          entry.templateRows = rows;
          if (cols && cols !== 'none') {
            entry.columns = cols.split(/\\s+/).map(function(s) { return parseFloat(s) || 0; }).filter(function(v) { return v > 0; });
          }
          if (rows && rows !== 'none') {
            entry.rows = rows.split(/\\s+/).map(function(s) { return parseFloat(s) || 0; }).filter(function(v) { return v > 0; });
          }
        }
        layoutResults.push(entry);
      }
      respond(id, { containers: layoutResults });
      return;
    }

    if (type === 'layout:add-track') {
      var ltEl = getEl(payload.eid);
      if (!ltEl) { respond(id, { property: '', before: '', after: '' }); return; }
      var ltCs = window.getComputedStyle(ltEl);
      var cssProp = payload.axis === 'col' ? 'grid-template-columns' : 'grid-template-rows';
      var ltBefore = ltCs.getPropertyValue(cssProp) || '';
      var ltAfter = ltBefore && ltBefore !== 'none' ? ltBefore + ' 1fr' : '1fr';
      ltEl.style.setProperty(cssProp, ltAfter);
      respond(id, { property: cssProp, before: ltBefore, after: ltAfter });
      return;
    }

    if (type === 'layout:add-child') {
      var lcEl = getEl(payload.eid);
      if (!lcEl) { respond(id, { childEid: '' }); return; }
      var child = document.createElement('div');
      child.style.minWidth = '60px';
      child.style.minHeight = '40px';
      child.style.border = '2px dashed #a855f7';
      child.style.borderRadius = '4px';
      child.style.background = 'rgba(168,85,247,0.05)';
      child.setAttribute('data-annotask-placeholder', 'true');
      lcEl.appendChild(child);
      respond(id, { childEid: getEid(child) });
      return;
    }

    // ── Theme ──
    if (type === 'theme:inject-css') {
      var existing = document.getElementById(payload.styleId);
      if (existing) {
        existing.textContent = payload.css;
      } else {
        var style = document.createElement('style');
        style.id = payload.styleId;
        style.textContent = payload.css;
        document.head.appendChild(style);
      }
      respond(id, {});
      return;
    }

    if (type === 'theme:remove-css') {
      var toRemove = document.getElementById(payload.styleId);
      if (toRemove) toRemove.remove();
      respond(id, {});
      return;
    }

    // ── Color Palette ──
    if (type === 'palette:scan-vars') {
      var swatches = [];
      try {
        var rootStyles = window.getComputedStyle(document.documentElement);
        var sheets = document.styleSheets;
        for (var si = 0; si < sheets.length; si++) {
          try {
            var rules = sheets[si].cssRules;
            for (var ri = 0; ri < rules.length; ri++) {
              var rule = rules[ri];
              if (rule.selectorText === ':root' || rule.selectorText === ':root, :host') {
                for (var pi = 0; pi < rule.style.length; pi++) {
                  var prop = rule.style[pi];
                  if (prop.startsWith('--')) {
                    var val = rootStyles.getPropertyValue(prop).trim();
                    if (val && isColor(val)) {
                      swatches.push({ name: prop, value: val });
                    }
                  }
                }
              }
            }
          } catch(e) { /* cross-origin stylesheet */ }
        }
      } catch(e) {}
      respond(id, { swatches: swatches });
      return;
    }

    // ── Source Mapping Check ──
    if (type === 'check:source-mapping') {
      respond(id, { hasMapping: !!(document.querySelector('[data-annotask-file]') || document.querySelector('[data-astro-source-file]')) });
      return;
    }

    // ── Insert Placeholder ──
    if (type === 'insert:placeholder') {
      var ipTarget = getEl(payload.targetEid);
      if (!ipTarget) { respond(id, { placeholderEid: '' }); return; }
      var ipEl = createPlaceholder(payload);
      var ipRef = ipTarget;
      switch (payload.position) {
        case 'before': ipRef.parentElement && ipRef.parentElement.insertBefore(ipEl, ipRef); break;
        case 'after': ipRef.parentElement && ipRef.parentElement.insertBefore(ipEl, ipRef.nextSibling); break;
        case 'append': ipRef.appendChild(ipEl); break;
        case 'prepend': ipRef.insertBefore(ipEl, ipRef.firstChild); break;
      }
      // Match sibling sizes in flex/grid
      var insertParent = (payload.position === 'append' || payload.position === 'prepend') ? ipRef : ipRef.parentElement;
      if (insertParent) {
        var pCs = window.getComputedStyle(insertParent);
        if (pCs.display.includes('flex') || pCs.display.includes('grid')) {
          if (!ipEl.style.width) {
            var isRow = pCs.flexDirection === 'row' || pCs.flexDirection === 'row-reverse' || pCs.display.includes('grid');
            if (isRow) ipEl.style.flex = '1';
          }
        }
      }
      respond(id, { placeholderEid: getEid(ipEl) });
      return;
    }

    if (type === 'insert:remove') {
      var irEl = getEl(payload.eid);
      if (irEl) {
        var unmount = irEl.__annotask_unmount;
        if (unmount) unmount();
        irEl.remove();
      }
      respond(id, {});
      return;
    }

    if (type === 'move:element') {
      var meEl = getEl(payload.eid);
      var meTarget = getEl(payload.targetEid);
      if (meEl && meTarget) {
        switch (payload.position) {
          case 'before': meTarget.parentElement && meTarget.parentElement.insertBefore(meEl, meTarget); break;
          case 'after': meTarget.parentElement && meTarget.parentElement.insertBefore(meEl, meTarget.nextSibling); break;
          case 'append': meTarget.appendChild(meEl); break;
          case 'prepend': meTarget.insertBefore(meEl, meTarget.firstChild); break;
        }
      }
      respond(id, {});
      return;
    }

    if (type === 'insert:vue-component' || type === 'insert:component') {
      var vcTarget = getEl(payload.targetEid);
      if (!vcTarget) { respond(id, { eid: '', mounted: false }); return; }
      var vcContainer = document.createElement('div');
      vcContainer.setAttribute('data-annotask-placeholder', 'true');
      switch (payload.position) {
        case 'before': vcTarget.parentElement && vcTarget.parentElement.insertBefore(vcContainer, vcTarget); break;
        case 'after': vcTarget.parentElement && vcTarget.parentElement.insertBefore(vcContainer, vcTarget.nextSibling); break;
        case 'append': vcTarget.appendChild(vcContainer); break;
        case 'prepend': vcTarget.insertBefore(vcContainer, vcTarget.firstChild); break;
      }
      var mounted = tryMountComponent(vcContainer, payload.componentName, payload.props);
      respond(id, { eid: getEid(vcContainer), mounted: mounted });
      return;
    }

    // ── Get source data for an eid ──
    if (type === 'resolve:source') {
      var rsEl = getEl(payload.eid);
      if (!rsEl) { respond(id, null); return; }
      var rsSrc = findSourceElement(rsEl);
      var rsData = getSourceData(rsSrc.sourceEl);
      respond(id, {
        sourceEid: getEid(rsSrc.sourceEl),
        file: rsData.file,
        line: rsData.line,
        component: rsData.component,
        tag: rsSrc.sourceEl.tagName.toLowerCase()
      });
      return;
    }

    // ── Route ──
    if (type === 'route:current') {
      respond(id, { path: window.location.pathname });
      return;
    }
  });

  // ── Helpers ───────────────────────────────────────────
  function isColor(val) {
    if (val.startsWith('#') || val.startsWith('rgb') || val.startsWith('hsl')) return true;
    // Named colors — quick check with canvas
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
    // Try Vue
    if (window.__ANNOTASK_VUE__) {
      var mounted = tryMountVueComponent(container, componentName, props);
      if (mounted) return true;
    }
    // Try React
    if (window.__ANNOTASK_REACT__) {
      var mounted = tryMountReactComponent(container, componentName, props);
      if (mounted) return true;
    }
    // Try Svelte
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
      miniApp._context = vueApp._context;
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

  // ── Ready ─────────────────────────────────────────────
  sendToShell('bridge:ready', { version: '1.0' });
})();
`.trim()
}
