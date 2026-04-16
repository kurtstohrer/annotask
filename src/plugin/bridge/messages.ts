/** postMessage handler: dispatches all message types from the Annotask shell. */
export function bridgeMessages(): string {
  return `
  // ── Message Handler ───────────────────────────────────
  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || msg.source !== 'annotask-shell') return;
    if (shellOrigin === '*' && event.origin) shellOrigin = event.origin;

    var type = msg.type;
    var payload = msg.payload || {};
    var id = msg.id;

    if (type === 'bridge:ping') {
      if (id) respond(id, { ok: true });
      return;
    }

    if (type === 'mode:set') {
      currentMode = payload.mode || 'select';
      try { localStorage.setItem('annotask:mode', currentMode); } catch(e) {}
      if (currentMode === 'interact' || currentMode === 'highlight') {
        document.body.classList.remove('annotask-no-select');
      } else {
        document.body.classList.add('annotask-no-select');
      }
      return;
    }

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
        classes: typeof src.targetEl.className === 'string' ? src.targetEl.className : '',
        text: getVisibleText(src.targetEl, 200)
      });
      return;
    }

    if (type === 'resolve:template-group') {
      var all = document.querySelectorAll(
        '[data-annotask-file="' + payload.file + '"][data-annotask-line="' + payload.line + '"]'
      );
      if (all.length === 0 && payload.file && payload.line) {
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
      var wantTag = (payload.tagName || '').toLowerCase();
      for (var i = 0; i < all.length; i++) {
        if (!wantTag || all[i].tagName.toLowerCase() === wantTag) {
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

      function describeEl(el, depth) {
        var t = el.tagName.toLowerCase();
        var cl = typeof el.className === 'string' ? el.className.trim() : '';
        var txt = '';
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
        subtree: describeEl(ctxEl, 0),
        selected_element_text: getVisibleText(ctxEl, 200)
      });
      return;
    }

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
              var rawHtml = (node.html || '').replace(/ data-annotask-[a-z-]+="[^"]*"/g, '');
              var detail = {
                html: rawHtml.substring(0, 200),
                target: node.target ? node.target[0] : '',
                failureSummary: node.failureSummary || ''
              };
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
        script.src = '/__annotask/vendor/axe-core.min.js';
        var savedDefine;
        if (typeof window.define === 'function' && window.define.amd) {
          savedDefine = window.define;
          window.define = undefined;
        }
        script.onload = function() {
          if (savedDefine !== undefined) window.define = savedDefine;
          runAxeScan(a11yEl);
        };
        script.onerror = function() {
          if (savedDefine !== undefined) window.define = savedDefine;
          respond(id, { violations: [], error: 'failed to load axe-core — check that /__annotask/ routes are accessible from the app origin' });
        };
        document.head.appendChild(script);
      }
      return;
    }

    if (type === 'perf:start-recording') {
      perfRecording = true;
      perfRecordStart = performance.now();
      perfRecordEvents = [];
      perfRecordEvents.push({ time: 0, type: 'navigation', label: 'Recording started on ' + window.location.pathname });
      if (id) respond(id, { ok: true });
      return;
    }

    if (type === 'perf:stop-recording') {
      perfRecording = false;
      var recEnd = performance.now();
      var recDuration = recEnd - perfRecordStart;
      var vitalsArr = [];
      var recNavTiming = null;
      var recResources = [];
      var recEvents = perfRecordEvents.slice(0, 500);
      perfRecordEvents = [];
      try {
        for (var vk in perfVitals) { if (perfVitals.hasOwnProperty(vk) && perfVitals[vk]) vitalsArr.push(perfVitals[vk]); }
        try {
          var navE = performance.getEntriesByType('navigation');
          if (navE && navE.length > 0) {
            var nv = navE[0];
            recNavTiming = {
              domContentLoaded: Number(nv.domContentLoadedEventEnd - nv.startTime) || 0,
              loadComplete: Number(nv.loadEventEnd - nv.startTime) || 0,
              domInteractive: Number(nv.domInteractive - nv.startTime) || 0,
              ttfb: Number(nv.responseStart - nv.requestStart) || 0,
              responseTime: Number(nv.responseEnd - nv.responseStart) || 0,
              domProcessing: Number(nv.domComplete - nv.domInteractive) || 0
            };
            if (!perfVitals.TTFB) {
              var tv = Number(nv.responseStart - nv.requestStart) || 0;
              perfVitals.TTFB = { name: 'TTFB', value: tv, rating: ratePerfVital('TTFB', tv) };
            }
          }
        } catch(e) {}
        try {
          var rawRes = Array.prototype.slice.call(performance.getEntriesByType('resource'));
          rawRes.sort(function(a, b) { return (b.transferSize || 0) - (a.transferSize || 0); });
          for (var rri = 0; rri < rawRes.length && rri < 200; rri++) {
            var rr = rawRes[rri];
            recResources.push({
              name: String(rr.name || '').substring(0, 200),
              initiatorType: String(rr.initiatorType || ''),
              transferSize: Number(rr.transferSize) || 0,
              duration: Number(rr.duration) || 0,
              startTime: Number(rr.startTime) || 0
            });
          }
        } catch(e) {}
      } catch(e) {}
      respond(id, {
        startTime: perfRecordStart,
        endTime: recEnd,
        duration: recDuration,
        url: String(window.location.href),
        route: String(window.location.pathname),
        events: recEvents,
        vitals: vitalsArr,
        navigation: recNavTiming,
        resources: recResources
      });
      return;
    }

    if (type === 'perf:scan') {
      try {
        var scanVitals = [];
        for (var svk in perfVitals) { if (perfVitals.hasOwnProperty(svk) && perfVitals[svk]) scanVitals.push(perfVitals[svk]); }

        var scanNav = null;
        var scanRes = [];
        try {
          var sNavE = performance.getEntriesByType('navigation');
          if (sNavE && sNavE.length > 0) {
            var sn = sNavE[0];
            scanNav = {
              domContentLoaded: Number(sn.domContentLoadedEventEnd - sn.startTime) || 0,
              loadComplete: Number(sn.loadEventEnd - sn.startTime) || 0,
              domInteractive: Number(sn.domInteractive - sn.startTime) || 0,
              ttfb: Number(sn.responseStart - sn.requestStart) || 0,
              responseTime: Number(sn.responseEnd - sn.responseStart) || 0,
              domProcessing: Number(sn.domComplete - sn.domInteractive) || 0
            };
          }
        } catch(e) {}
        try {
          var sRaw = Array.prototype.slice.call(performance.getEntriesByType('resource'));
          sRaw.sort(function(a, b) { return (b.transferSize || 0) - (a.transferSize || 0); });
          for (var sri = 0; sri < sRaw.length && sri < 200; sri++) {
            var sr = sRaw[sri];
            scanRes.push({
              name: String(sr.name || '').substring(0, 200),
              initiatorType: String(sr.initiatorType || ''),
              transferSize: Number(sr.transferSize) || 0,
              duration: Number(sr.duration) || 0,
              startTime: Number(sr.startTime) || 0
            });
          }
        } catch(e) {}
      } catch(e) {
        scanVitals = [];
        scanNav = null;
        scanRes = [];
      }
      respond(id, {
        timestamp: Date.now(),
        url: String(window.location.href),
        route: String(window.location.pathname),
        vitals: scanVitals || [],
        navigation: scanNav,
        resources: scanRes || []
      });
      return;
    }

    if (type === 'screenshot:capture') {
      var clipRect = payload.rect;

      function doCapture(clip) {
        // html2canvas-pro v2 UMD exposes window.html2canvas as { default, ... }
        // whereas the legacy html2canvas v1 exposed it as a callable function.
        var h2c = window.html2canvas;
        if (h2c && typeof h2c !== 'function' && typeof h2c.default === 'function') h2c = h2c.default;
        if (typeof h2c !== 'function') {
          respond(id, { error: 'html2canvas not loaded' });
          return;
        }
        var opts = { useCORS: true, logging: false, allowTaint: true };
        if (clip) {
          // clip coords are viewport-relative; html2canvas crops relative
          // to the full document body, so add scroll offsets.
          opts.x = clip.x + (window.scrollX || 0);
          opts.y = clip.y + (window.scrollY || 0);
          opts.width = clip.width;
          opts.height = clip.height;
        }
        h2c(document.body, opts).then(function(canvas) {
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
        h2cScript.src = '/__annotask/vendor/html2canvas.min.js';
        var savedDefine2;
        if (typeof window.define === 'function' && window.define.amd) {
          savedDefine2 = window.define;
          window.define = undefined;
        }
        h2cScript.onload = function() {
          if (savedDefine2 !== undefined) window.define = savedDefine2;
          doCapture(clipRect);
        };
        h2cScript.onerror = function() {
          if (savedDefine2 !== undefined) window.define = savedDefine2;
          respond(id, { error: 'failed to load html2canvas — check that /__annotask/ routes are accessible from the app origin' });
        };
        document.head.appendChild(h2cScript);
      }
      return;
    }

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
          } catch(e) {}
        }
      } catch(e) {}
      respond(id, { swatches: swatches });
      return;
    }

    if (type === 'check:source-mapping') {
      respond(id, { hasMapping: !!(document.querySelector('[data-annotask-file]') || document.querySelector('[data-astro-source-file]')) });
      return;
    }

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

    if (type === 'route:current') {
      respond(id, { path: window.location.pathname });
      return;
    }

    if (type === 'color-scheme:get') {
      // Detect what scheme the user is currently looking at, in a way that
      // works across frameworks (Tailwind, Bootstrap, MUI, Mantine, Vuetify,
      // Quasar, Chakra, daisyUI, custom systems, plain CSS, …).
      //
      // Strategy:
      //   1. Compute a ground-truth scheme from background luminance — this
      //      reflects what the viewport is actually painting and works for any
      //      app regardless of theming convention.
      //   2. Fall back to the standard CSS color-scheme property, then to the
      //      OS prefers-color-scheme media query if no background is paintable.
      //   3. Independently sniff for common DOM markers (class / data-attr) so
      //      the agent has a hint about WHERE to apply theme-related changes.
      //      A recognized marker overrides luminance only when the marker
      //      itself is unambiguous (e.g. data-bs-theme="dark"), since explicit
      //      developer intent should win over a heuristic.
      var scheme = 'light';
      var source = 'fallback';
      var marker = null;

      try {
        var html = document.documentElement;
        var body = document.body;

        // ── Step 1: Background luminance (universal ground truth) ──
        function readBg(el) {
          if (!el) return null;
          var bg = '';
          try { bg = window.getComputedStyle(el).backgroundColor || ''; } catch(e) { return null; }
          if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return null;
          var parts = bg.match(/[0-9.]+/g);
          if (!parts || parts.length < 3) return null;
          var alpha = parts.length >= 4 ? parseFloat(parts[3]) : 1;
          if (!alpha) return null;
          return { r: parseFloat(parts[0]), g: parseFloat(parts[1]), b: parseFloat(parts[2]) };
        }

        var bg = readBg(html) || readBg(body);
        if (bg) {
          // Perceptual luminance approximation in sRGB
          var lum = (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255;
          scheme = lum < 0.5 ? 'dark' : 'light';
          source = 'background-luminance';
        } else {
          var declared = '';
          try { declared = (window.getComputedStyle(html).colorScheme || '').toLowerCase(); } catch(e) {}
          var hasDark = declared.indexOf('dark') !== -1;
          var hasLight = declared.indexOf('light') !== -1;
          if (hasDark && !hasLight) {
            scheme = 'dark';
            source = 'css-color-scheme';
          } else if (hasLight && !hasDark) {
            scheme = 'light';
            source = 'css-color-scheme';
          } else if (window.matchMedia) {
            scheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            source = 'media-query';
          }
        }

        // ── Step 2: Sniff for explicit DOM markers (enrichment) ──
        // Attribute markers — covers Bootstrap 5.3+, MUI, Mantine, Joy UI,
        // daisyUI, Radix, shadcn, and plain "data-theme" / "data-mode" patterns.
        var ATTR_NAMES = [
          'data-theme',
          'data-color-scheme',
          'data-color-mode',
          'data-mode',
          'data-bs-theme',
          'data-mui-color-scheme',
          'data-joy-color-scheme',
          'data-mantine-color-scheme'
        ];
        var hosts = [{ el: html, name: 'html' }];
        if (body) hosts.push({ el: body, name: 'body' });

        outer: for (var hi = 0; hi < hosts.length; hi++) {
          var hostEl = hosts[hi].el;
          for (var ai = 0; ai < ATTR_NAMES.length; ai++) {
            var attrName = ATTR_NAMES[ai];
            var raw = hostEl.getAttribute && hostEl.getAttribute(attrName);
            if (raw) {
              var val = (raw + '').toLowerCase();
              marker = { kind: 'attribute', host: hosts[hi].name, name: attrName, value: raw };
              if (val === 'dark' || val === 'light') {
                scheme = val;
                source = 'attribute';
              }
              break outer;
            }
          }
        }

        // Class markers — covers Tailwind, Vuetify, Quasar, Chakra, generic.
        // Each entry is { dark: <className>, light: <className>, framework }.
        if (!marker) {
          var CLASS_PAIRS = [
            { dark: 'dark', light: 'light', framework: 'tailwind/generic' },
            { dark: 'theme-dark', light: 'theme-light', framework: 'generic' },
            { dark: 'mode-dark', light: 'mode-light', framework: 'generic' },
            { dark: 'is-dark', light: 'is-light', framework: 'bulma/generic' },
            { dark: 'v-theme--dark', light: 'v-theme--light', framework: 'vuetify' },
            { dark: 'body--dark', light: 'body--light', framework: 'quasar' },
            { dark: 'chakra-ui-dark', light: 'chakra-ui-light', framework: 'chakra' },
            { dark: 'dark-theme', light: 'light-theme', framework: 'generic' },
            { dark: 'dark-mode', light: 'light-mode', framework: 'generic' }
          ];
          classOuter: for (var ci = 0; ci < CLASS_PAIRS.length; ci++) {
            var pair = CLASS_PAIRS[ci];
            for (var hj = 0; hj < hosts.length; hj++) {
              var hEl = hosts[hj].el;
              if (!hEl || !hEl.classList) continue;
              if (hEl.classList.contains(pair.dark)) {
                marker = { kind: 'class', host: hosts[hj].name, name: pair.dark, framework: pair.framework };
                scheme = 'dark';
                source = 'class';
                break classOuter;
              }
              if (hEl.classList.contains(pair.light)) {
                marker = { kind: 'class', host: hosts[hj].name, name: pair.light, framework: pair.framework };
                scheme = 'light';
                source = 'class';
                break classOuter;
              }
            }
          }
        }
      } catch (e) {}

      var result = { scheme: scheme, source: source };
      if (marker) result.marker = marker;
      respond(id, result);
      return;
    }

    if (id) {
      respond(id, { error: 'unsupported bridge request: ' + type });
    }
  });
`
}
