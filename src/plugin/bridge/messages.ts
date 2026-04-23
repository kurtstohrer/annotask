/** postMessage handler: dispatches all message types from the Annotask shell. */
export function bridgeMessages(): string {
  return `
  // ── Color Scheme Detection ────────────────────────────
  // Shared detector used by 'color-scheme:get' (on-demand) and the
  // MutationObserver / matchMedia change listener in events.ts (push).
  //
  // Strategy (matches the documented behavior in CLAUDE.md):
  //   1. Compute a ground-truth scheme from background luminance — reflects
  //      what the viewport is actually painting, regardless of theming system.
  //   2. Fall back to the CSS color-scheme property, then matchMedia.
  //   3. Sniff explicit DOM markers (class / data-attr). A recognized marker
  //      overrides luminance when unambiguous ('dark'/'light'), since explicit
  //      dev intent should win over a heuristic.
  function detectColorScheme() {
    var scheme = 'light';
    var source = 'fallback';
    var marker = null;

    try {
      var html = document.documentElement;
      var body = document.body;

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
        var lum = (0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 255;
        scheme = lum < 0.5 ? 'dark' : 'light';
        source = 'background-luminance';
      } else {
        var declared = '';
        try { declared = (window.getComputedStyle(html).colorScheme || '').toLowerCase(); } catch(e) {}
        var hasDark = declared.indexOf('dark') !== -1;
        var hasLight = declared.indexOf('light') !== -1;
        if (hasDark && !hasLight) { scheme = 'dark'; source = 'css-color-scheme'; }
        else if (hasLight && !hasDark) { scheme = 'light'; source = 'css-color-scheme'; }
        else if (window.matchMedia) {
          scheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          source = 'media-query';
        }
      }

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
            if (val === 'dark' || val === 'light') { scheme = val; source = 'attribute'; }
            break outer;
          }
        }
      }

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
              scheme = 'dark'; source = 'class';
              break classOuter;
            }
            if (hEl.classList.contains(pair.light)) {
              marker = { kind: 'class', host: hosts[hj].name, name: pair.light, framework: pair.framework };
              scheme = 'light'; source = 'class';
              break classOuter;
            }
          }
        }
      }
    } catch (e) {}

    var result = { scheme: scheme, source: source };
    if (marker) result.marker = marker;
    return result;
  }

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

    if (type === 'frame:offset') {
      // Shell-pushed iframe rect in the shell viewport — fallback for
      // cross-origin contexts where window.frameElement is null. See
      // cachedFrameOffsetX/Y in bridge/events.ts.
      if (payload && typeof payload.x === 'number' && typeof payload.y === 'number') {
        cachedFrameOffsetX = payload.x;
        cachedFrameOffsetY = payload.y;
        haveCachedFrameOffset = true;
      }
      if (id) respond(id, { ok: true });
      return;
    }

    if (type === 'data:watch') {
      if (typeof window.__annotaskSetDataWatch === 'function') {
        window.__annotaskSetDataWatch(!!(payload && payload.enabled));
      }
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
      // If we're leaving inspect modes, any lingering hover overlay in the
      // shell needs to be dismissed — no further mouseover will fire to
      // clear it.
      if (!inspectModes[currentMode]) clearHoverState();
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
        source_tag: srcData.source_tag,
        parent_component: findParentComponent(src.sourceEl, srcData.component),
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
      // Reject detached nodes and zero-size rects — those paint as a stuck
      // 4px border at (0,0) on the shell overlay otherwise.
      if (!rEl || !rEl.isConnected) { respond(id, null); return; }
      var r0 = getRect(rEl);
      respond(id, (r0.width > 0 && r0.height > 0) ? { rect: r0 } : null);
      return;
    }

    if (type === 'resolve:rects') {
      var results = [];
      for (var j = 0; j < payload.eids.length; j++) {
        var re = getEl(payload.eids[j]);
        if (!re || !re.isConnected) { results.push(null); continue; }
        var r1 = getRect(re);
        results.push((r1.width > 0 && r1.height > 0) ? r1 : null);
      }
      respond(id, { rects: results });
      return;
    }

    if (type === 'list:rendered-files') {
      // Distinct (file, mfe) pairs from the live iframe DOM. We used to emit
      // just file strings, but host-aggregated catalogs hold workspace-
      // relative paths while the per-MFE plugin writes MFE-local
      // data-annotask-file values — the shell pairs them back up using the
      // mfe tag + the workspace catalog.
      var allFileNodes = document.querySelectorAll('[data-annotask-file]');
      var fileSeen = Object.create(null);
      var fileList = [];
      for (var fii = 0; fii < allFileNodes.length; fii++) {
        var fnode = allFileNodes[fii];
        var fval = fnode.getAttribute('data-annotask-file');
        if (!fval) continue;
        var mval = fnode.getAttribute('data-annotask-mfe') || '';
        var fkey = fval + '\u0001' + mval;
        if (fileSeen[fkey]) continue;
        fileSeen[fkey] = true;
        fileList.push(mval ? { file: fval, mfe: mval } : { file: fval });
      }
      respond(id, { files: fileList });
      return;
    }

    if (type === 'list:project-components') {
      // Group every [data-annotask-component] element by its component name.
      // Record each instance's (file, line, eid, rect) so the shell can
      // highlight them and load their definition. Uses the COMPONENT-ROOT
      // elements — not their descendants — to avoid duplicate instances.
      var compNodes = document.querySelectorAll('[data-annotask-component]');
      var compBuckets = Object.create(null);
      for (var ci = 0; ci < compNodes.length; ci++) {
        var cnel = compNodes[ci];
        // Skip if an ancestor has the SAME component attribute — keep the
        // outermost element for each rendered instance.
        var parent = cnel.parentNode;
        var sameAncestor = false;
        var selfComp = cnel.getAttribute('data-annotask-component');
        while (parent && parent.nodeType === 1) {
          if (parent.getAttribute && parent.getAttribute('data-annotask-component') === selfComp) {
            sameAncestor = true;
            break;
          }
          parent = parent.parentNode;
        }
        if (sameAncestor) continue;
        var cname = selfComp || '';
        if (!cname) continue;
        if (!compBuckets[cname]) compBuckets[cname] = [];
        var cmfe = cnel.getAttribute('data-annotask-mfe') || '';
        var inst = {
          file: cnel.getAttribute('data-annotask-file') || '',
          line: cnel.getAttribute('data-annotask-line') || '',
          eid: getEid(cnel),
          rect: getRect(cnel),
        };
        if (cmfe) inst.mfe = cmfe;
        compBuckets[cname].push(inst);
      }
      var compOut = [];
      for (var cn in compBuckets) {
        var insts = compBuckets[cn];
        // Primary file/line = the first instance's source attrs — used as the
        // definition anchor for the detail pane.
        var primary = insts[0];
        compOut.push({
          name: cn,
          file: primary.file,
          line: primary.line,
          count: insts.length,
          instances: insts
        });
      }
      // Sort by name for stable order.
      compOut.sort(function(a, b){ return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      respond(id, { components: compOut });
      return;
    }

    if (type === 'resolve:by-locations') {
      var CAP2 = 500;
      var locTrunc = false;
      var locMatches = [];
      var locs = Array.isArray(payload.locations) ? payload.locations : [];
      // Deduplicate by (file, mfe) so two MFEs with the same MFE-local path
      // (e.g. both exposing src/App.tsx) don't cross-highlight each other.
      var byFile = Object.create(null);
      for (var li = 0; li < locs.length; li++) {
        var loc = locs[li];
        if (!loc || typeof loc.file !== 'string') continue;
        var bucketKey = loc.file + '\u0001' + (typeof loc.mfe === 'string' ? loc.mfe : '');
        if (!byFile[bucketKey]) byFile[bucketKey] = { file: loc.file, mfe: typeof loc.mfe === 'string' ? loc.mfe : '', entries: [] };
        byFile[bucketKey].entries.push(loc);
      }
      for (var bucketK in byFile) {
        // byFile is Object.create(null) — no prototype, so for-in only yields own keys.
        var bucket = byFile[bucketK];
        var fname = bucket.file;
        var entries = bucket.entries;
        var safeFile = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(fname) : fname.replace(/"/g, '\\\\"');
        var mfeAttrPart = bucket.mfe
          ? '[data-annotask-mfe="' + ((typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(bucket.mfe) : bucket.mfe.replace(/"/g, '\\\\"')) + '"]'
          : '';
        // Pull every element in this file once.
        var fileNodes;
        try { fileNodes = document.querySelectorAll('[data-annotask-file="' + safeFile + '"]' + mfeAttrPart); }
        catch (e) { fileNodes = []; }
        if ((!fileNodes || fileNodes.length === 0)) {
          var astroAll = document.querySelectorAll('[data-astro-source-file]');
          var am = [];
          for (var aj = 0; aj < astroAll.length; aj++) {
            var afile = astroAll[aj].getAttribute('data-astro-source-file') || '';
            if (afile.endsWith('/' + fname) || afile === fname) am.push(astroAll[aj]);
          }
          fileNodes = am;
        }
        // Bucket nodes by line once.
        var nodesByLine = Object.create(null);
        for (var ni = 0; ni < fileNodes.length; ni++) {
          var nel = fileNodes[ni];
          var lineAttr = nel.getAttribute('data-annotask-line') || '';
          var lineKey = String(lineAttr);
          if (!nodesByLine[lineKey]) nodesByLine[lineKey] = [];
          nodesByLine[lineKey].push(nel);
        }
        // For each requested location, pick the matching bucket (line === 0
        // is an explicit file-level wildcard — used by the Components view
        // for on-page library tags). We used to also fall back to every
        // tagged element in the file when the specific line missed; that
        // caused the Hooks/APIs tabs to light up every hardcoded element,
        // so precise line matching is now required — callers that want a
        // wildcard should send line: 0 explicitly.
        for (var ei = 0; ei < entries.length; ei++) {
          var ent = entries[ei];
          var targetLine = typeof ent.line === 'number' ? ent.line : parseInt(ent.line, 10) || 0;
          var targetNodes;
          if (targetLine === 0) {
            targetNodes = fileNodes; // file-level wildcard (explicit only).
          } else {
            targetNodes = nodesByLine[String(targetLine)] || [];
          }
          // Optional tag filter: when the caller names a source tag (e.g. the
          // Components view picking 'Card'), only nodes whose
          // data-annotask-source-tag matches survive. Drops nested elements
          // that happen to share the same source line.
          //
          // We then reduce the kept set to *outermost* elements per instance —
          // i.e. each rect represents one whole component instance, not every
          // tagged descendant. This matters for compound components: Radix's
          // <Table.Root>/<Table.Header>/<Table.Row>/<Table.Cell> all get
          // source-tag="Table" (the JSX tag parser stops at '.'), so without
          // a root-only reduction a single <table> would surface as 16 td/th
          // rects instead of one clean outline around the whole element.
          if (ent.tag && typeof ent.tag === 'string') {
            var wanted = ent.tag;
            // Optional module prefix filter — the shell passes the library's
            // package name (or a specific subpath) so two libraries that both
            // export a same-named component stay separate in the DOM even when
            // the wrapper component does not forward the tag attribute.
            // Matches exactly OR as a subpath prefix so "@kobalte/core" covers
            // "@kobalte/core/button".
            var modulePrefix = (typeof ent.module === 'string' && ent.module) ? ent.module : '';
            var kept = [];
            for (var tti = 0; tti < targetNodes.length; tti++) {
              var tn = targetNodes[tti];
              if (!tn.getAttribute) continue;
              if (tn.getAttribute('data-annotask-source-tag') !== wanted) continue;
              if (modulePrefix) {
                var sm = tn.getAttribute('data-annotask-source-module') || '';
                if (!(sm === modulePrefix || sm.indexOf(modulePrefix + '/') === 0)) continue;
              }
              kept.push(tn);
            }
            var roots = [];
            for (var ki = 0; ki < kept.length; ki++) {
              var kn = kept[ki];
              var hasAnc = false;
              for (var kj = 0; kj < kept.length && !hasAnc; kj++) {
                if (ki === kj) continue;
                if (kept[kj].contains(kn) && kept[kj] !== kn) hasAnc = true;
              }
              if (!hasAnc) roots.push(kn);
            }
            targetNodes = roots;
          }
          // Leaf-only filter within this target set.
          for (var ti = 0; ti < targetNodes.length; ti++) {
            if (locMatches.length >= CAP2) { locTrunc = true; break; }
            var cand = targetNodes[ti];
            var hasDesc = false;
            for (var tj = 0; tj < targetNodes.length && !hasDesc; tj++) {
              if (ti === tj) continue;
              if (cand !== targetNodes[tj] && cand.contains(targetNodes[tj])) hasDesc = true;
            }
            if (hasDesc) continue;
            locMatches.push({
              ref: ent.ref,
              file: fname,
              line: targetLine,
              eid: getEid(cand),
              rect: getRect(cand)
            });
          }
          if (locTrunc) break;
        }
        if (locTrunc) break;
      }
      respond(id, { matches: locMatches, truncated: locTrunc });
      return;
    }

    if (type === 'resolve:by-files') {
      var CAP = 500;
      var truncated = false;
      var files = Array.isArray(payload.files) ? payload.files : [];
      // Collect matched elements per file so we can do leaf-only filtering.
      var collected = []; // { file, el, line }
      for (var fi = 0; fi < files.length && !truncated; fi++) {
        var fname = files[fi];
        if (!fname || typeof fname !== 'string') continue;
        var safeName = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(fname) : fname.replace(/"/g, '\\\\"');
        var nodes;
        try {
          nodes = document.querySelectorAll('[data-annotask-file="' + safeName + '"]');
        } catch (e) { nodes = []; }
        // Astro fallback: same normalization as resolve:template-group (file may be a suffix)
        if ((!nodes || nodes.length === 0)) {
          var astroAll = document.querySelectorAll('[data-astro-source-file]');
          var am = [];
          for (var aj = 0; aj < astroAll.length; aj++) {
            var afile = astroAll[aj].getAttribute('data-astro-source-file') || '';
            if (afile.endsWith('/' + fname) || afile === fname) am.push(astroAll[aj]);
          }
          nodes = am;
        }
        for (var ni = 0; ni < nodes.length; ni++) {
          if (collected.length >= CAP) { truncated = true; break; }
          var nel = nodes[ni];
          var lineAttr = nel.getAttribute('data-annotask-line') || '';
          collected.push({ file: fname, el: nel, line: lineAttr });
        }
      }
      // Leaf-only filter — drop any element that contains another matched
      // element. Keeps overlay noise down (outer containers would otherwise
      // stack on top of their children).
      var elSet = new Set ? new Set() : null;
      if (elSet) {
        for (var ci = 0; ci < collected.length; ci++) elSet.add(collected[ci].el);
      }
      var outMatches = [];
      for (var li = 0; li < collected.length; li++) {
        var cur = collected[li];
        var hasMatchedDescendant = false;
        for (var lj = 0; lj < collected.length && !hasMatchedDescendant; lj++) {
          if (li === lj) continue;
          if (cur.el !== collected[lj].el && cur.el.contains(collected[lj].el)) {
            hasMatchedDescendant = true;
          }
        }
        if (hasMatchedDescendant) continue;
        outMatches.push({
          file: cur.file,
          eid: getEid(cur.el),
          line: cur.line,
          rect: getRect(cur.el)
        });
      }
      respond(id, { matches: outMatches, truncated: truncated });
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

    if (type === 'resolve:component-chain') {
      var ccEl = getEl(payload.eid);
      if (!ccEl) { respond(id, null); return; }

      function entryFromEl(el) {
        var d = getSourceData(el);
        // When the source_tag is PascalCase (e.g. "Switch", "Slider") it names
        // the component the user visually selected, even when data-annotask-component
        // points at the owning file (e.g. "App"). Always prefer it — otherwise
        // the primary turns into the container instead of the thing clicked.
        var st = d.source_tag || '';
        var stIsCustom = st && st.charAt(0) >= 'A' && st.charAt(0) <= 'Z';
        var name = stIsCustom ? st : d.component;
        if (!name) return null;
        var entry = { name: name };
        if (d.file) entry.file = d.file;
        if (d.line) {
          var n = parseInt(d.line, 10);
          if (!isNaN(n)) entry.line = n;
        }
        if (d.mfe) entry.mfe = d.mfe;
        return entry;
      }

      // Walk up until we find the first element carrying annotask attrs —
      // library components' inner DOM (Radix/MUI internals) have none, so
      // the selected span/div is usually a child of the real component root.
      var primaryEntry = entryFromEl(ccEl);
      var anchorEl = ccEl;
      if (!primaryEntry) {
        var fallback = ccEl.parentElement;
        while (fallback && fallback !== document.body && fallback !== document.documentElement) {
          var fEntry = entryFromEl(fallback);
          if (fEntry) { primaryEntry = fEntry; anchorEl = fallback; break; }
          fallback = fallback.parentElement;
        }
      }
      if (!primaryEntry) { respond(id, null); return; }

      // Rendered HTML: the element's own outerHTML, with annotask
      // bookkeeping attributes stripped. Truncated so the task payload stays
      // compact — agents still see the structure of what shipped to the DOM.
      var RENDERED_MAX = 4000;
      var rendered = '';
      try {
        var raw = ccEl.outerHTML || '';
        raw = raw.replace(/ data-annotask-[a-z-]+="[^"]*"/g, '');
        if (raw.length > RENDERED_MAX) raw = raw.slice(0, RENDERED_MAX) + '…';
        rendered = raw;
      } catch (_e) { rendered = ''; }

      var out = { primary: primaryEntry };
      if (rendered) out.rendered = rendered;
      respond(id, out);
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
      respond(id, detectColorScheme());
      return;
    }

    if (type === 'scroll:into-view') {
      var sivEl = payload.eid ? getEl(payload.eid) : null;
      if (sivEl && sivEl.scrollIntoView) {
        try { sivEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' }); }
        catch (_e) { try { sivEl.scrollIntoView(); } catch (_e2) {} }
      }
      if (id) respond(id, { ok: true });
      return;
    }

    if (type === 'resolve:by-selectors') {
      var selsIn = Array.isArray(payload.selectors) ? payload.selectors : [];
      var selMatches = [];
      for (var ssi = 0; ssi < selsIn.length; ssi++) {
        var sel = selsIn[ssi];
        var matchEl = null;
        if (typeof sel === 'string' && sel) {
          try { matchEl = document.querySelector(sel); } catch (_e) { matchEl = null; }
        }
        if (matchEl && matchEl.isConnected) {
          var sRect = getRect(matchEl);
          selMatches.push({
            selector: sel,
            eid: getEid(matchEl),
            rect: (sRect.width > 0 && sRect.height > 0) ? sRect : null,
          });
        } else {
          selMatches.push({ selector: sel, eid: null, rect: null });
        }
      }
      respond(id, { matches: selMatches });
      return;
    }

    if (type === 'compute:accessibility-info') {
      var aiEids = Array.isArray(payload.eids) ? payload.eids : [];
      var aiItems = [];
      for (var aii = 0; aii < aiEids.length; aii++) {
        var aiEl = getEl(aiEids[aii]);
        if (!aiEl || !aiEl.isConnected) { aiItems.push(null); continue; }
        aiItems.push(computeA11yInfoFor(aiEl));
      }
      respond(id, { items: aiItems });
      return;
    }

    if (type === 'compute:tab-order') {
      var allInteractive = collectFocusables(document);
      var entries = [];
      for (var toi = 0; toi < allInteractive.length; toi++) {
        var foEl = allInteractive[toi];
        var foTab = getTabIndexValue(foEl);
        var foRect = getRect(foEl);
        if (foRect.width === 0 && foRect.height === 0) continue;
        entries.push({
          eid: getEid(foEl),
          rect: foRect,
          tag: foEl.tagName.toLowerCase(),
          role: getElementRole(foEl).role,
          accessible_name: getAccessibleName(foEl).name,
          tabindex: foTab,
          is_positive_tabindex: typeof foTab === 'number' && foTab > 0,
          is_disabled_focusable: isNativelyFocusable(foEl) && foTab === -1,
          index: -1,
          domOrder: toi,
        });
      }
      // Sort by tab order: positive tabindex first (numeric ascending), then
      // tabindex=0 / native focusables in DOM order, then tabindex=-1 elements
      // are excluded from the sequence (kept in result for analysis).
      var sequenced = entries.slice().filter(function(e){ return e.tabindex !== -1; });
      sequenced.sort(function(a, b) {
        var at = a.tabindex;
        var bt = b.tabindex;
        var aPos = typeof at === 'number' && at > 0;
        var bPos = typeof bt === 'number' && bt > 0;
        if (aPos && !bPos) return -1;
        if (!aPos && bPos) return 1;
        if (aPos && bPos) {
          if (at !== bt) return at - bt;
          return a.domOrder - b.domOrder;
        }
        return a.domOrder - b.domOrder;
      });
      var byEid = Object.create(null);
      for (var qi = 0; qi < entries.length; qi++) byEid[entries[qi].eid] = entries[qi];
      for (var si = 0; si < sequenced.length; si++) {
        var e = byEid[sequenced[si].eid];
        if (e) e.index = si + 1;
      }
      // Detect tab/visual-order disagreements among sequenced entries: pairs
      // (a, b) where a comes before b in tab order but b is visually above
      // (or to the left of) a on the same row.
      var reorderings = [];
      for (var ri = 0; ri < sequenced.length - 1 && reorderings.length < 20; ri++) {
        var ra = sequenced[ri];
        var rb = sequenced[ri + 1];
        var dy = rb.rect.y - ra.rect.y;
        if (dy < -8) {
          reorderings.push({ aEid: ra.eid, bEid: rb.eid, reason: 'next-in-tab-order is visually above current' });
        } else if (Math.abs(dy) <= 8 && rb.rect.x < ra.rect.x - 8) {
          reorderings.push({ aEid: ra.eid, bEid: rb.eid, reason: 'next-in-tab-order is visually left of current on the same row' });
        }
      }
      respond(id, { entries: entries, reorderings: reorderings });
      return;
    }

    if (id) {
      respond(id, { error: 'unsupported bridge request: ' + type });
    }
  });

  // ── Accessibility helpers ────────────────────────────────

  // Implicit ARIA roles for common HTML elements. Best-effort; matches the
  // mappings most agents will recognize without becoming an exhaustive AOM.
  var IMPLICIT_ROLES = {
    a: function(el) { return el.hasAttribute('href') ? 'link' : 'generic'; },
    article: 'article', aside: 'complementary', button: 'button',
    datalist: 'listbox', dd: 'definition', details: 'group', dfn: 'term',
    dialog: 'dialog', dt: 'term', fieldset: 'group', figure: 'figure',
    footer: 'contentinfo', form: 'form', h1: 'heading', h2: 'heading',
    h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading',
    header: 'banner', hr: 'separator', img: function(el) {
      return el.getAttribute('alt') === '' ? 'presentation' : 'img';
    },
    input: function(el) {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'reset' || t === 'image') return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'range') return 'slider';
      if (t === 'search') return 'searchbox';
      if (t === 'text' || t === 'email' || t === 'tel' || t === 'url' || t === 'password') return 'textbox';
      if (t === 'number') return 'spinbutton';
      return 'textbox';
    },
    li: 'listitem', main: 'main', nav: 'navigation', ol: 'list', ul: 'list',
    option: 'option', output: 'status', progress: 'progressbar',
    section: function(el) {
      return (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby')) ? 'region' : 'generic';
    },
    select: 'combobox', summary: 'button', table: 'table', tbody: 'rowgroup',
    td: 'cell', textarea: 'textbox', tfoot: 'rowgroup', th: 'columnheader',
    thead: 'rowgroup', tr: 'row'
  };

  function getElementRole(el) {
    var explicit = el.getAttribute('role');
    if (explicit) return { role: explicit, source: 'explicit' };
    var tag = el.tagName.toLowerCase();
    var resolver = IMPLICIT_ROLES[tag];
    if (typeof resolver === 'function') return { role: resolver(el), source: 'implicit' };
    if (typeof resolver === 'string') return { role: resolver, source: 'implicit' };
    return { role: '', source: 'none' };
  }

  function normalizeText(s) {
    return (s || '').replace(/\\s+/g, ' ').trim();
  }

  function getAccessibleName(el) {
    // 1. aria-labelledby
    var labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      var ids = labelledby.split(/\\s+/);
      var parts = [];
      for (var li = 0; li < ids.length; li++) {
        var ref = document.getElementById(ids[li]);
        if (ref) parts.push(normalizeText(ref.textContent));
      }
      var joined = parts.join(' ').trim();
      if (joined) return { name: joined.slice(0, 200), source: 'aria-labelledby' };
    }
    // 2. aria-label
    var ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return { name: ariaLabel.trim().slice(0, 200), source: 'aria-label' };
    // 3. Form-control label association
    var tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'meter' || tag === 'progress') {
      var labelText = '';
      var idAttr = el.getAttribute('id');
      if (idAttr) {
        try {
          var labelEl = document.querySelector('label[for="' + (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(idAttr) : idAttr) + '"]');
          if (labelEl) labelText = normalizeText(labelEl.textContent);
        } catch(e) {}
      }
      if (!labelText) {
        var ancL = el.parentElement;
        while (ancL) {
          if (ancL.tagName && ancL.tagName.toLowerCase() === 'label') {
            labelText = normalizeText(ancL.textContent);
            break;
          }
          ancL = ancL.parentElement;
        }
      }
      if (labelText) return { name: labelText.slice(0, 200), source: 'label' };
    }
    // 4. img alt
    if (tag === 'img' || (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'image')) {
      var alt = el.getAttribute('alt');
      if (alt !== null) return { name: alt.trim().slice(0, 200), source: 'alt' };
    }
    // 5. Native value (button[value], input[type=button|submit|reset])
    if (tag === 'input') {
      var t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'button' || t === 'submit' || t === 'reset') {
        var v = el.getAttribute('value');
        if (v) return { name: v.trim().slice(0, 200), source: 'value' };
      }
    }
    // 6. text content (button, link, heading, etc.)
    var txt = normalizeText(el.textContent || '');
    if (txt) return { name: txt.slice(0, 200), source: 'text' };
    // 7. title attribute
    var title = el.getAttribute('title');
    if (title && title.trim()) return { name: title.trim().slice(0, 200), source: 'title' };
    // 8. placeholder (last resort, anti-pattern but useful as a hint)
    var ph = el.getAttribute('placeholder');
    if (ph && ph.trim()) return { name: ph.trim().slice(0, 200), source: 'placeholder' };
    return { name: '', source: 'none' };
  }

  function isNativelyFocusable(el) {
    var tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'area') return el.hasAttribute('href');
    if (tag === 'button' || tag === 'select' || tag === 'textarea') return !el.disabled;
    if (tag === 'input') return !el.disabled && (el.getAttribute('type') || '').toLowerCase() !== 'hidden';
    if (tag === 'audio' || tag === 'video') return el.hasAttribute('controls');
    if (tag === 'summary' || tag === 'iframe') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function getTabIndexValue(el) {
    var raw = el.getAttribute('tabindex');
    if (raw === null) return null;
    var n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  }

  function isHiddenForA11y(el) {
    if (el.hasAttribute('hidden')) return true;
    if ((el.getAttribute('aria-hidden') || '').toLowerCase() === 'true') return true;
    var cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
    return false;
  }

  function collectFocusables(root) {
    var out = [];
    // Order traversal matches DOM order.
    var walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_ELEMENT, null);
    var node = walker.nextNode();
    while (node) {
      if (!isHiddenForA11y(node)) {
        var ti = getTabIndexValue(node);
        if (isNativelyFocusable(node) || (ti !== null && ti >= -1)) {
          out.push(node);
        }
      }
      node = walker.nextNode();
    }
    return out;
  }

  function parseColor(str) {
    // Returns { r, g, b, a } or null.
    if (!str) return null;
    var m = str.match(/rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*,\\s*([\\d.]+))?\\s*\\)/);
    if (m) return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]), a: m[4] !== undefined ? parseFloat(m[4]) : 1 };
    return null;
  }

  function rgbToHex(c) {
    function h(n) { var s = Math.round(n).toString(16); return s.length === 1 ? '0' + s : s; }
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  function relativeLuminance(c) {
    var rs = c.r / 255, gs = c.g / 255, bs = c.b / 255;
    function ch(v) { return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(rs) + 0.7152 * ch(gs) + 0.0722 * ch(bs);
  }

  function contrastRatio(c1, c2) {
    var l1 = relativeLuminance(c1);
    var l2 = relativeLuminance(c2);
    var hi = Math.max(l1, l2);
    var lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  function getEffectiveBackground(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      var bg = parseColor(window.getComputedStyle(node).backgroundColor);
      if (bg && bg.a >= 0.99) return bg;
      node = node.parentElement;
    }
    // Default to white when we walk off the top with no opaque background.
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function probeFocusIndicator(el) {
    // Heuristic: probe outline/box-shadow on the resting state. Actually
    // focusing the element would steal focus from the user, so we approximate
    // using the default computed style. Returns 'visible' when an outline is
    // already declared (typical for components with permanent focus rings) or
    // 'unknown' otherwise.
    var cs = window.getComputedStyle(el);
    var ow = parseFloat(cs.outlineWidth) || 0;
    if (ow > 0 && cs.outlineStyle && cs.outlineStyle !== 'none') return 'visible';
    if (cs.boxShadow && cs.boxShadow !== 'none') return 'visible';
    return 'unknown';
  }

  function computeA11yInfoFor(el) {
    var nameInfo = getAccessibleName(el);
    var roleInfo = getElementRole(el);
    var ti = getTabIndexValue(el);
    var focusable = isNativelyFocusable(el) || (ti !== null && ti >= 0);
    var indicator = focusable ? probeFocusIndicator(el) : 'unknown';
    var ariaAttrs = [];
    var attrs = el.attributes;
    for (var ai = 0; ai < attrs.length; ai++) {
      var an = attrs[ai].name;
      if (an.indexOf('aria-') === 0 || an === 'role') {
        ariaAttrs.push({ name: an, value: attrs[ai].value });
      }
    }
    var info = {
      eid: getEid(el),
      tag: el.tagName.toLowerCase(),
      accessible_name: nameInfo.name,
      name_source: nameInfo.source,
      role: roleInfo.role,
      role_source: roleInfo.source,
      tabindex: ti,
      focusable: focusable,
      focus_indicator: indicator,
      aria_attrs: ariaAttrs
    };
    // Contrast: compute when element has visible non-whitespace text.
    var hasText = false;
    for (var ci = 0; ci < el.childNodes.length; ci++) {
      var n = el.childNodes[ci];
      if (n.nodeType === 3 && n.textContent && n.textContent.trim()) { hasText = true; break; }
    }
    if (hasText) {
      var cs2 = window.getComputedStyle(el);
      var fg = parseColor(cs2.color);
      var bg = getEffectiveBackground(el);
      if (fg && bg) {
        var ratio = contrastRatio(fg, bg);
        var fontSizePx = parseFloat(cs2.fontSize) || 16;
        var fontWeight = parseInt(cs2.fontWeight, 10) || 400;
        var isLarge = fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
        info.contrast = {
          foreground: rgbToHex(fg),
          background: rgbToHex(bg),
          ratio: Math.round(ratio * 100) / 100,
          aa_normal: ratio >= 4.5,
          aa_large: ratio >= 3,
          aaa_normal: ratio >= 7,
          aaa_large: ratio >= 4.5,
        };
        if (isLarge) {
          info.contrast.aa_normal = ratio >= 3;
          info.contrast.aaa_normal = ratio >= 4.5;
        }
      }
    }
    return info;
  }
`
}
