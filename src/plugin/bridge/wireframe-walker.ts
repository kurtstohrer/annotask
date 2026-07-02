/**
 * Wireframe block-discovery walker — the in-iframe DOM walk that turns the live
 * route into the ordered list of "blocks" the snapshot canvas rasterizes.
 *
 * Extracted from the `wireframe:capture` handler in messages.ts so the
 * MFE-aware descent is a single, jsdom-testable unit (the rest of messages.ts
 * is a stringified, un-typechecked template). Like every other bridge fragment
 * this returns a string of vanilla JS that runs inside the shared bridge IIFE;
 * `bridge-client.ts` concatenates it before `bridgeMessages()`, which calls
 * `discoverBlocks(...)` to produce `wfMetas`.
 *
 * Public surface (in the emitted scope):
 *   discoverBlocks(root, deps, opts) -> { blocks: [{ el, meta }], truncated }
 *     deps = { getComputedStyle, findSourceElement, getSourceData, getEid }
 *     opts = { mfeDescentEnabled?: boolean }   (default true)
 *   wfElementForRect(rootEl, rect, deps) -> Element | null
 *     deps = { getComputedStyle }
 *     The live element whose document-space box best matches `rect` (within a
 *     size-scaled tolerance) — the geometric re-resolution the capture handler
 *     uses to explode an ANCHORLESS block (one with no source anchor to look
 *     up). Null when nothing comes close (the page reflowed past tolerance).
 *
 * Non-MFE pages (no detected MFE regions, or mfeDescentEnabled === false) take
 * the legacy single-root path — the SAME helpers with every region branch
 * skipped, so the block set, order, rects, and anchors are unchanged and no
 * `mfe` field is emitted. MFE pages decompose each mount container into its
 * instrumented children, each anchored to its OWN MFE source (never the host
 * shell) and stamped with `meta.mfe`. An UN-instrumented (`pending`) mount —
 * a framework boundary with no `data-annotask-mfe` descendant (production
 * bundle, third-party remote, or a not-yet-mounted async bundle) — is still
 * decomposed by GEOMETRY into anchorless sub-blocks, so the region can be
 * wireframed for layout even though it can't drive source codegen.
 *
 * Discovery is shadow-DOM-aware: a host with no qualifying light children
 * descends into its OPEN shadow root (a <slot> resolves to its assigned light
 * content, or its fallback children), so a web-component page (Lit/Shoelace)
 * decomposes instead of collapsing into one undecomposable block. A CLOSED
 * shadow host can't be descended — its block is stamped
 * `meta.fidelity: 'shadow-opaque'` so downstream is honest instead of silent.
 * An <iframe> is an opaque leaf: emitted as a block (its geometry/anchor are
 * real — moving the mount is legitimate) and matchable by wfElementForRect,
 * stamped `meta.embedded: 'iframe'`, and never descended into.
 *
 * The walk is pure: it reads the DOM and returns data. Scroll restoration,
 * html2canvas rasterization, and `respond()` stay in messages.ts.
 *
 * Tests: src/plugin/bridge/__tests__/wireframe-walker.test.ts (jsdom; evaluates
 * this exact string via `new Function`, the same approach as bridge-origin).
 */
export function bridgeWireframeWalker(): string {
  return `
  // ===================== Wireframe block-discovery walker =====================
  function discoverBlocks(root, deps, opts) {
    opts = opts || {};
    var descentEnabled = opts.mfeDescentEnabled !== false;
    var WF_BLOCK_CAP = 24;
    // Minimum sub-blocks guaranteed to each MFE so a flat document-order slice
    // can't drop a whole trailing MFE off a busy multi-MFE route.
    var WF_MIN_PER_MFE = 2;
    var getCS = deps.getComputedStyle;

    // ---- shared element predicates (identical for legacy + region paths) ----
    function wfQualifies(el) {
      if (!el || el.nodeType !== 1) return false;
      var t = el.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'LINK' || t === 'TEMPLATE' || t === 'NOSCRIPT') return false;
      if (el.hasAttribute('data-annotask-instance') || el.hasAttribute('data-annotask-preview')) return false;
      var cs = getCS(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }
    function wfChildren(el) {
      // An <iframe> is an opaque leaf: its element children are unrendered
      // fallback content and its real interior (contentDocument) is another
      // page's DOM — the mount moves as one block, nothing to descend into.
      if (el.tagName === 'IFRAME') return [];
      var out = [];
      for (var i = 0; i < el.children.length; i++) {
        if (wfQualifies(el.children[i])) out.push(el.children[i]);
      }
      // A web-component host (Lit/Shoelace) keeps its content in an OPEN shadow
      // root, invisible to el.children — html2canvas RENDERS open shadow DOM
      // fine, so discovery must see it too or the whole page collapses into one
      // undecomposable block. Light children win on mixed hosts.
      if (out.length === 0 && el.shadowRoot) return wfShadowChildren(el.shadowRoot);
      return out;
    }
    // Element children of an open shadow root. A <slot> is no box of its own
    // (display:contents) — resolve it to its assignedElements() so slotted
    // light content is walked once, at its RENDERED position; a slot with
    // nothing assigned renders its fallback content, so walk its own children.
    function wfShadowChildren(sr) {
      var out = [];
      for (var i = 0; i < sr.children.length; i++) {
        var c = sr.children[i];
        if (c.tagName === 'SLOT') {
          var assigned = c.assignedElements ? c.assignedElements() : [];
          var list = assigned.length ? assigned : c.children;
          for (var j = 0; j < list.length; j++) {
            if (wfQualifies(list[j])) out.push(list[j]);
          }
        } else if (wfQualifies(c)) {
          out.push(c);
        }
      }
      return out;
    }
    function wfHeight(el) { return el.getBoundingClientRect().height; }
    function wfDocOrder(a, b) {
      var pos = a.compareDocumentPosition(b);
      if (pos & 4) return -1;
      if (pos & 2) return 1;
      return 0;
    }
    function wfCssEsc(s) {
      if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
      return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
    }

    // ---- MFE region detection ------------------------------------------------
    function wfMfeOf(el) {
      return (el && el.getAttribute && el.getAttribute('data-annotask-mfe')) || '';
    }
    // Cheap framework accelerators: these only OPEN a subtree as a candidate
    // boundary. The NAME is never trusted from the container (it is host glue) —
    // it always comes from the stamped descendant via wfDescendantMfe.
    function wfFrameworkBoundary(el) {
      if (!el || el.nodeType !== 1) return false;
      var id = el.id || '';
      if (id.indexOf('single-spa-application:') === 0) return true;      // single-spa
      if (id.indexOf('__qiankun_microapp_wrapper_for_') === 0) return true; // qiankun
      if (el.tagName === 'APPLICATION') return true;                      // single-spa-layout
      if (el.getAttribute && el.getAttribute('data-qiankun')) return true; // qiankun (alt)
      return false;
    }
    // First data-annotask-mfe in el's subtree NOT separated from el by a deeper
    // mount boundary — so an outer container is never mis-named by an inner
    // MFE's stamp. '' when none.
    function wfDescendantMfe(el) {
      if (!el.querySelectorAll) return '';
      var stamped = el.querySelectorAll('[data-annotask-mfe]');
      for (var i = 0; i < stamped.length; i++) {
        var s = stamped[i];
        var name = wfMfeOf(s);
        if (!name) continue;
        var nested = false;
        var p = s.parentElement;
        while (p && p !== el) {
          if (wfFrameworkBoundary(p) || (wfMfeOf(p) && wfMfeOf(p) !== name)) { nested = true; break; }
          p = p.parentElement;
        }
        if (!nested) return name;
      }
      return '';
    }
    // Is el the OUTERMOST element of an MFE region? Returns { mfe, pending } or
    // null. pending = a framework container with no stamped descendant yet
    // (async bundle still loading) -> emitted as one opaque block, never
    // anchored to the host mount div.
    function wfBoundaryAt(el) {
      if (wfMfeOf(el)) return null;                 // interior to an MFE, not a boundary
      var fw = wfFrameworkBoundary(el);
      var childMfe = wfDescendantMfe(el);
      if (fw) return childMfe ? { mfe: childMfe, pending: false } : { mfe: '', pending: true };
      if (!childMfe) return null;                   // plain wrapper with no MFE inside
      return { mfe: childMfe, pending: false };     // children-driven boundary (Module Federation)
    }
    // Single descent collecting OUTERMOST boundaries only (don't recurse into a
    // region — a nested MFE self-identifies via its own descendant stamps).
    function wfCollectMfeRegions(node) {
      var regions = [];
      (function walk(el) {
        for (var i = 0; i < el.children.length; i++) {
          var c = el.children[i];
          if (c.nodeType !== 1) continue;
          var b = wfBoundaryAt(c);
          if (b) regions.push({ mountEl: c, mfe: b.mfe, pending: b.pending });
          else walk(c);
        }
      })(node);
      return regions;
    }
    function wfEnclosesRegion(el, regions) {
      for (var i = 0; i < regions.length; i++) {
        if (regions[i].mountEl === el || el.contains(regions[i].mountEl)) return true;
      }
      return false;
    }
    function wfRegionRelated(el, regions) {
      for (var i = 0; i < regions.length; i++) {
        var m = regions[i].mountEl;
        if (m === el || m.contains(el) || el.contains(m)) return true;
      }
      return false;
    }

    // ---- content root + passes (region-aware via the optional regions arg) ---
    // Unwrap single-child wrappers while the lone child covers >=80% of parent
    // HEIGHT. Identical to the legacy pass when regions is empty; in the region
    // path it stops before crossing INTO a mount container (the region pass
    // owns the descent past the host glue).
    function wfContentRoot(rootEl, regions) {
      var main = rootEl.querySelector('main, [role="main"]');
      var cur = (main && wfQualifies(main)) ? main : rootEl;
      for (var depth = 0; depth < 6; depth++) {
        var kids = wfChildren(cur);
        if (kids.length === 1 && wfHeight(cur) > 0 && wfHeight(kids[0]) >= wfHeight(cur) * 0.8) {
          if (regions.length && wfEnclosesRegion(kids[0], regions)) break;
          cur = kids[0];
          continue;
        }
        break;
      }
      return cur;
    }
    // Direct qualifying children of a start node with a minimum footprint;
    // descend through a single (undersized) raw child so a thin wrapper doesn't
    // yield one page block. Returns { kids, cursor }.
    function wfContentKids(start) {
      var kids = [];
      var cursor = start;
      for (var depth = 0; depth < 5; depth++) {
        var raw = wfChildren(cursor);
        kids = [];
        for (var i = 0; i < raw.length; i++) {
          var r = raw[i].getBoundingClientRect();
          if (r.width >= 48 && r.height >= 24) kids.push(raw[i]);
        }
        if (kids.length === 0 && raw.length === 1) { cursor = raw[0]; continue; }
        break;
      }
      return { kids: kids, cursor: cursor };
    }
    // Chrome-candidate garbage filters. wfQualifies stays lean (the explode
    // path shares it), so the chrome pass enforces its own footprint — the same
    // 48x24 the content/straggler passes use — plus two checks display/visibility
    // can't catch: accessible-hide chrome parked off-document (left:-9999px /
    // translate(-100%) skip-navigation rasterizes blank and lands off-canvas)
    // and opacity:0 furniture. Both would otherwise eat WF_BLOCK_CAP slots.
    function wfChromeGarbage(el) {
      var r = el.getBoundingClientRect();
      if (r.width < 48 || r.height < 24) return true;
      if (getCS(el).opacity === '0') return true;
      // Document-space box (same rect+scroll arithmetic as wfBuildMeta) must
      // overlap [0, docW) x [0, docH) by >=25% of the element's own area.
      // scrollWidth/Height with a viewport fallback (jsdom reports zero).
      var de = document.documentElement;
      var docW = (de && de.scrollWidth) || window.innerWidth || 0;
      var docH = (de && de.scrollHeight) || window.innerHeight || 0;
      var x = r.x + (window.scrollX || 0);
      var y = r.y + (window.scrollY || 0);
      var ow = Math.min(x + r.width, docW) - Math.max(x, 0);
      var oh = Math.min(y + r.height, docH) - Math.max(y, 0);
      return ow <= 0 || oh <= 0 || ow * oh < r.width * r.height * 0.25;
    }
    // Page furniture outside the content root, outermost only. Garbage chrome is
    // dropped from the emitted set but kept in \`covered\` so the straggler pass
    // still treats it as chrome-owned — a rejected skip-nav must not resurface
    // as a straggler block (pre-filter, every candidate was in the chrome list).
    function wfChromePass(rootEl, content) {
      var chrome = [];
      var covered = [];
      var cand = rootEl.querySelectorAll('header, nav, footer, aside');
      for (var i = 0; i < cand.length; i++) {
        var el = cand[i];
        if (!wfQualifies(el)) continue;
        if (content !== rootEl && content.contains(el) && content !== el) continue;
        var contained = false;
        for (var j = 0; j < covered.length; j++) { if (covered[j].contains(el)) { contained = true; break; } }
        if (contained) continue;
        covered.push(el);
        if (!wfChromeGarbage(el)) chrome.push(el);
      }
      return { chrome: chrome, covered: covered };
    }
    // Content OUTSIDE the content root that isn't semantic chrome (a floating
    // button/banner mounted as a sibling of <main>).
    function wfStragglerPass(rootEl, content, chrome) {
      var stragglers = [];
      var path = [];
      var node = content;
      while (node && node !== rootEl) { path.push(node); node = node.parentElement; }
      if (node !== rootEl) return stragglers; // content root detached from capture root
      path.push(rootEl);
      for (var pi = path.length - 1; pi >= 1; pi--) {
        var parent = path[pi];
        var pathChild = path[pi - 1];
        var kids = wfChildren(parent);
        for (var k = 0; k < kids.length; k++) {
          var kid = kids[k];
          if (kid === pathChild) continue;
          var r = kid.getBoundingClientRect();
          if (r.width < 48 || r.height < 24) continue;
          var covered = false;
          for (var c = 0; c < chrome.length && !covered; c++) {
            if (chrome[c] === kid || chrome[c].contains(kid) || kid.contains(chrome[c])) covered = true;
          }
          if (!covered) stragglers.push(kid);
        }
      }
      return stragglers;
    }
    function wfMerge(chrome, contentKids, stragglers) {
      var all = [];
      for (var i = 0; i < chrome.length; i++) all.push(chrome[i]);
      for (var j = 0; j < contentKids.length; j++) if (all.indexOf(contentKids[j]) === -1) all.push(contentKids[j]);
      for (var k = 0; k < stragglers.length; k++) if (all.indexOf(stragglers[k]) === -1) all.push(stragglers[k]);
      all.sort(wfDocOrder);
      return all;
    }

    // ---- anchoring -----------------------------------------------------------
    // Page-pass blocks anchor exactly as before (findSourceElement walk-up).
    // Region sub-blocks resolve DOWN to the MFE-stamped element so they never
    // anchor to the host shell file that the mount container carries.
    function wfResolveMfeAnchor(el, region) {
      var c = el;
      var firstInstr = null;
      while (c) {
        if (c.getAttribute && c.getAttribute('data-annotask-file')) { firstInstr = c; break; }
        if (c === region.mountEl) break;
        c = c.parentElement;
      }
      if (firstInstr && firstInstr.getAttribute('data-annotask-mfe') === region.mfe) {
        return deps.getSourceData(firstInstr);
      }
      // First instrumented ancestor is host glue (or none) — resolve down to the
      // nearest descendant carrying THIS region's mfe.
      if (el.getAttribute && el.getAttribute('data-annotask-mfe') === region.mfe && el.getAttribute('data-annotask-file')) {
        return deps.getSourceData(el);
      }
      var down = el.querySelector ? el.querySelector('[data-annotask-mfe="' + wfCssEsc(region.mfe) + '"]') : null;
      if (down && down.getAttribute('data-annotask-file')) return deps.getSourceData(down);
      // Honest unanchored — never the host file.
      return { file: '', line: '', component: '', source_tag: '', mfe: region.mfe };
    }

    // Bounded source walk: find the nearest data-annotask-* ancestor that is a
    // STRICT DESCENDANT of the boundary, never the boundary itself or above it.
    // The geometric (anchorless) explode path passes the resolved root as the
    // boundary so a child of an un-instrumented region can still resolve DOWN to
    // a real instrumented descendant, but never UP to the host-glue mount whose
    // wrapper carries the host shell's file (which would mis-anchor an anchorless
    // block to the wrong source — issue #54). Empty when nothing qualifies.
    function wfBoundedSource(el, boundary) {
      var c = el;
      while (c && c !== boundary) {
        if (c.hasAttribute && (c.hasAttribute('data-annotask-file') || c.hasAttribute('data-astro-source-file'))) {
          return deps.getSourceData(c);
        }
        c = c.parentElement;
      }
      return { file: '', line: '', component: '', source_tag: '', mfe: '' };
    }

    function wfBuildMeta(el, region) {
      var data;
      if (region && region.pending) {
        data = { file: '', line: '', component: '', source_tag: '', mfe: region.mfe || '' };
      } else if (region) {
        data = wfResolveMfeAnchor(el, region);
      } else if (opts.anchorBoundary) {
        data = wfBoundedSource(el, opts.anchorBoundary);
      } else {
        var src = deps.findSourceElement(el);
        data = deps.getSourceData(src.sourceEl);
      }
      var rect = el.getBoundingClientRect();
      var tag = el.tagName.toLowerCase();
      var meta = {
        eid: deps.getEid(el),
        file: data.file, line: data.line, component: data.component,
        source_tag: data.source_tag, tag: tag,
        cls: (el.classList && el.classList[0]) || '',
        role: (tag === 'header' || tag === 'nav' || tag === 'footer' || tag === 'aside') ? tag : 'content',
        rect: { x: rect.x + (window.scrollX || 0), y: rect.y + (window.scrollY || 0), width: rect.width, height: rect.height },
        dataUrl: null
      };
      // Only carry mfe when it resolved — keeps legacy/non-MFE output free of
      // the field (and the shell omits an empty anchor.mfe).
      if (data.mfe) meta.mfe = data.mfe;
      // Honesty stamps — additive, absent on ordinary blocks. An <iframe> is an
      // embedded document: geometry/anchor are real (moving the mount is
      // legitimate) but the interior is another app — never descended, and
      // cross-origin pixels rasterize blank. A custom element (a '-' tag) with
      // no reachable children is a CLOSED shadow host we can't see into (an
      // open root would have yielded shadow children) — real pixels, nothing
      // separable, so say so instead of staying silent.
      if (tag === 'iframe') meta.embedded = 'iframe';
      else if (tag.indexOf('-') !== -1 && wfChildren(el).length === 0) meta.fidelity = 'shadow-opaque';
      return meta;
    }

    // ---- region descent: mount container -> its instrumented sections --------
    // Unwrap the host glue (mount -> MFE root, single full-height child chain),
    // then enumerate that content root's children as sub-blocks.
    function wfRegionUnwrap(mount) {
      var cur = mount;
      for (var depth = 0; depth < 6; depth++) {
        var kids = wfChildren(cur);
        if (kids.length === 1 && wfHeight(cur) > 0 && wfHeight(kids[0]) >= wfHeight(cur) * 0.8) { cur = kids[0]; continue; }
        break;
      }
      return cur;
    }
    function wfDiscoverRegion(region, cap) {
      var mount = region.mountEl;
      // An EMPTY PENDING mount (an inactive single-spa route's leftover
      // container, or a not-yet-mounted async bundle) emits nothing — it is
      // still a detected region so the page pass can't mis-anchor it to the host
      // glue, but it adds no noise box. A pending mount WITH content now runs the
      // same geometric unwrap + content pass as instrumented regions; wfBuildMeta
      // honestly returns empty anchors for it (region.pending), so a pre-built
      // component library / third-party remote decomposes into wireframeable
      // blocks instead of one opaque box. INSTRUMENTED regions are untouched —
      // they fall straight through to the byte-identical fallback chain below
      // (which emits [mount] anchored DOWN when the mount has no qualifying
      // direct children, e.g. a display:contents wrapper).
      if (region.pending && wfChildren(mount).length === 0) return { els: [], truncated: false };
      var contentRoot = wfRegionUnwrap(mount);
      var res = wfContentKids(contentRoot);
      var kids = res.kids;
      if (kids.length === 0) {
        if (wfQualifies(res.cursor)) kids = [res.cursor];
        else if (wfQualifies(contentRoot)) kids = [contentRoot];
        else if (wfQualifies(mount)) kids = [mount];
      }
      var trunc = false;
      if (kids.length > cap) { kids = kids.slice(0, cap); trunc = true; }
      return { els: kids, truncated: trunc };
    }

    // ---- orchestration -------------------------------------------------------
    var regions = descentEnabled ? wfCollectMfeRegions(root) : [];
    var content = wfContentRoot(root, regions);
    var cp = wfChromePass(root, content);
    var ck = wfContentKids(content);
    var contentKids = ck.kids;
    if (contentKids.length === 0) {
      if (wfQualifies(ck.cursor)) contentKids = [ck.cursor];
    }
    var stragglers = wfStragglerPass(root, content, cp.covered);
    var wfAll = wfMerge(cp.chrome, contentKids, stragglers);

    var truncated = false;

    if (regions.length === 0) {
      // ----- legacy single-root path (byte-identical to the pre-MFE code) -----
      if (wfAll.length > WF_BLOCK_CAP) { wfAll = wfAll.slice(0, WF_BLOCK_CAP); truncated = true; }
      var legacy = [];
      for (var i = 0; i < wfAll.length; i++) legacy.push({ el: wfAll[i], meta: wfBuildMeta(wfAll[i], null) });
      return { blocks: legacy, truncated: truncated };
    }

    // ----- region-aware path -----
    // Page blocks: everything from the page passes that isn't a region (the
    // region pass owns those — including a chrome <aside> that IS a mount).
    var blocks = [];
    var pageEls = [];
    for (var p = 0; p < wfAll.length; p++) {
      if (!wfRegionRelated(wfAll[p], regions)) pageEls.push(wfAll[p]);
    }
    for (var pe = 0; pe < pageEls.length; pe++) blocks.push({ el: pageEls[pe], meta: wfBuildMeta(pageEls[pe], null) });

    // Fair per-MFE budget so a busy trailing MFE isn't dropped by the cap.
    var remaining = WF_BLOCK_CAP - blocks.length;
    var perMfe = Math.max(WF_MIN_PER_MFE, Math.floor(remaining / regions.length));
    for (var r = 0; r < regions.length; r++) {
      var rr = wfDiscoverRegion(regions[r], perMfe);
      if (rr.truncated) truncated = true;
      for (var e = 0; e < rr.els.length; e++) blocks.push({ el: rr.els[e], meta: wfBuildMeta(rr.els[e], regions[r]) });
    }
    blocks.sort(function(a, b) { return wfDocOrder(a.el, b.el); });
    if (blocks.length > WF_BLOCK_CAP) { blocks = blocks.slice(0, WF_BLOCK_CAP); truncated = true; }
    return { blocks: blocks, truncated: truncated };
  }

  // ===================== Geometric root re-resolution ========================
  // The live element whose document-space box best matches a captured block's
  // rect. An ANCHORLESS block (un-instrumented MFE / shared-library DOM) has no
  // source anchor to look up for explode, but its PIXELS are real — its captured
  // geometry pins the live subtree. Document-space (rect + scroll) so it works
  // whether or not the caller normalized scroll (the metaOnly hover probe does
  // not scroll; the full-rasterize explode scrolls to 0,0 first). Returns null
  // when nothing comes within tolerance, so the caller can surface an honest
  // "couldn't find this block" instead of exploding the wrong element.
  function wfElementForRect(rootEl, rect, deps) {
    if (!rootEl || !rect) return null;
    var getCS = deps.getComputedStyle;
    var sx = window.scrollX || 0, sy = window.scrollY || 0;
    var best = null, bestScore = Infinity;
    // The expensive part (getComputedStyle, a style flush) is deferred to genuine
    // candidates only — most elements are rejected by the cheap tag/box/score
    // checks first, so a full-document scan stays one layout flush + O(n) reads
    // rather than O(n) style flushes (this also runs on the debounced metaOnly
    // hover probe). Visibility/preview exclusion mirrors wfQualifies (scoped
    // inside discoverBlocks, so it can't be shared without hoisting).
    function consider(el) {
      if (!el || el.nodeType !== 1) return;
      var t = el.tagName;
      if (t === 'SCRIPT' || t === 'STYLE' || t === 'LINK' || t === 'TEMPLATE' || t === 'NOSCRIPT') return;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      var score = Math.abs((r.x + sx) - rect.x) + Math.abs((r.y + sy) - rect.y)
        + Math.abs(r.width - rect.width) + Math.abs(r.height - rect.height);
      // Strict '<' so equal-box elements keep the FIRST (outermost: rootEl, then
      // document order) — explode the container, not its lone inner wrapper. A
      // non-improving score skips the costly qualify check entirely.
      if (score >= bestScore) return;
      if (el.hasAttribute('data-annotask-instance') || el.hasAttribute('data-annotask-preview')) return;
      var cs = getCS(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      best = el; bestScore = score;
    }
    consider(rootEl);
    var all = rootEl.querySelectorAll ? rootEl.querySelectorAll('*') : [];
    for (var i = 0; i < all.length; i++) consider(all[i]);
    // querySelectorAll never crosses a shadow boundary — sweep OPEN shadow
    // roots too (recursively; the page is finite) so a captured shadow-DOM
    // block can still be re-resolved by geometry. Light elements were
    // considered FIRST, so on an exact-box tie a host still beats its own
    // full-size shadow wrapper (the same outermost-wins rule as above).
    function considerShadow(sr) {
      var kids = sr.querySelectorAll('*');
      for (var k = 0; k < kids.length; k++) {
        consider(kids[k]);
        if (kids[k].shadowRoot) considerShadow(kids[k].shadowRoot);
      }
    }
    if (rootEl.shadowRoot) considerShadow(rootEl.shadowRoot);
    for (var s = 0; s < all.length; s++) { if (all[s].shadowRoot) considerShadow(all[s].shadowRoot); }
    // Accept only a genuinely close match. Tolerance scales with the block (a
    // small drift on a big region is fine; the same px on a tiny block is not),
    // summed across the four edges, with a floor for tiny blocks.
    var tol = Math.max(48, (rect.width + rect.height) * 0.3);
    return (best && bestScore <= tol) ? best : null;
  }
`
}
