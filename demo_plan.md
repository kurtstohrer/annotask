# Annotask Marketing Demo Plan

## Concept

Start from the annotask marketing page as an AI would first-generate it — the
structure is right, the content is *about annotask*, but the details are slightly
off. Wrong tagline wording, a pricing section that doesn't make sense for OSS,
generic AI copy, missing polish. Use annotask itself to annotate every issue,
then let the in-shell agent apply changes back to source. The viewer sees a real
"AI first draft → finished page" workflow using the actual product.

---

## Step 0 — Snapshot & restore mechanism

We need two git-trackable states of `playgrounds/simple/marketing/`:

| State | Branch / tag | Description |
|-------|-------------|-------------|
| **Before** | `demo/marketing-before` | The annotask marketing page as an AI would first-generate it — correct structure and real content, but slightly off copy, unnecessary sections (pricing), weak styling, a11y gaps, no light mode |
| **After** | current `feat/embedded-agents` HEAD | The polished page as it exists today |

**Restore script** (`scripts/demo-reset.sh`):
```bash
# Restore marketing/ to the "before" snapshot
git checkout demo/marketing-before -- playgrounds/simple/marketing/
# Clear .annotask/tasks.json so the demo starts clean
echo '[]' > playgrounds/simple/marketing/.annotask/tasks.json
```

> **Approach:** Degrade the current page to create the "before" state — revert
> the polish, add back the AI-isms (pricing section, buzzword copy, wrong tagline),
> weaken the CSS (drop light mode, flatten border-radius, break responsive).
> This guarantees the "after" matches what we already have.

---

## Demo structure

**Format:** 3-5 minute hero video (fast cuts, voiceover, no dead air).
Optionally followed by deeper feature-specific clips (2-3 min each).

**Recording approach:**
1. Claude generates a **transcript** (voiceover script + action cues)
2. Screen-record each segment following the transcript
3. AI voiceover reads the script
4. Edit together — sync voiceover to screen capture

### Hero demo — "From AI draft to polished page" (~4 min)

| # | Segment | Duration | Features shown | What happens on screen |
|---|---------|----------|----------------|----------------------|
| 1 | **Cold open** | 15s | — | Side-by-side: AI draft vs polished page. "An AI generated this page. Annotask finished it." |
| 2 | **Setup** | 20s | Vite plugin, `/__annotask/` | Show `vite.config.js` (3 lines), start dev server, open annotask shell |
| 3 | **Init wizard** | 30s | Init wizard, design spec scan | Run init → detects HTML + CSS tokens, extracts design spec, generates style guide |
| 4 | **Pin: bad copy** | 25s | Pin tool, task creation, element context | Pin the hero tagline: "this says 'ships the code' — should be 'applies the change'". Pin the CTA: "change 'Star on GitHub' to 'View on GitHub'" |
| 5 | **Pin: remove pricing** | 20s | Pin tool, contextual feedback | Pin the pricing section: "annotask is open-source and free, remove this entirely" |
| 6 | **Arrow: lifecycle** | 15s | Arrow tool, multi-element context | Arrow from the plain-text lifecycle diagram to the install section — "this should be styled pill badges like the rest of the page" |
| 7 | **Style editor** | 30s | Live inspector, CSS editing, style_update task | Select a card → bump `border-radius` from `4px` to `12px` live → fix section padding → commit as task |
| 8 | **A11y scan** | 30s | axe-core scan, violation list, one-click task | Run scan → catches low contrast on `.section-lede`, missing `alt` on hero image, no `<main>` landmark → one-click fix tasks |
| 9 | **Section: missing content** | 20s | Section tool, markdown editor | Draw section where demo video should go: "add a video placeholder with 16:9 frame and play button overlay" |
| 10 | **Token editor** | 20s | Design tokens, accent color | Open token inspector → change `--accent` from purple `#8b5cf6` to annotask blue `#3b82f6` → commit token change |
| 11 | **Agent applies** | 40s | In-shell agent, task lifecycle, HMR | Switch to auto mode → agent picks up tasks → code streams in → page hot-reloads with each fix |
| 12 | **Accept / deny** | 20s | Review, accept, deny + feedback | Accept the a11y fixes and card styling. Deny the tagline change: "keep the line break, just change the second line". Agent re-applies |
| 13 | **Result** | 15s | — | Full page scroll of the finished site. "Annotask — annotate the UI, agent applies the change." |

### Optional deep-dive clips

| Clip | Duration | Features |
|------|----------|----------|
| **Design tokens** | 2-3 min | Token inspector, theme editing, token commit workflow, design-spec.json |
| **Component catalog** | 2 min | Component detection, props, usage examples, hover highlighting |
| **Performance audit** | 2-3 min | Web Vitals, performance scan, bundle analysis, perf_fix task |
| **Error monitor** | 1-2 min | Inject a runtime error, watch it appear, one-click fix task |
| **Data & API view** | 2 min | Runtime endpoints, data source detection, API schema matching |
| **MCP + CLI** | 2-3 min | Terminal: `annotask tasks`, `annotask task <id>`, editor MCP tools, `/annotask-apply` |
| **Multi-framework** | 2 min | Quick cuts showing annotask on Vue, React, Svelte, Solid, HTML pages |
| **Viewport & responsive** | 1-2 min | Device preview, responsive issues, viewport context in tasks |

---

## "Before" page — the AI first draft

The starting page IS the annotask marketing page — just the version an AI would
generate on first pass. Everything is *close* but slightly off. The kind of stuff
you'd actually want to fix after an LLM scaffolds a landing page.

### Copy that's close but not quite (pin annotations)
- [ ] Tagline says "Agent ships the code" → should be "Agent applies the change"
      (pin: "this isn't accurate — the agent applies changes, it doesn't ship anything")
- [ ] Lede paragraph is too long and buzzwordy — AI-generated filler like
      "revolutionary workflow" and "seamless integration" instead of being direct
- [ ] "How it works" step 2 says "AI agent reads the task" — too vague, should
      mention MCP/CLI/HTTP specifically
- [ ] CTA says "Star on GitHub" as the primary action — should say "View on
      GitHub" (pin: "asking to star is presumptuous, just link to the repo")

### Content that doesn't belong (section tool + pins)
- [ ] **Pricing section** with Free / Pro / Enterprise tiers — annotask is
      open-source, there's no pricing. Draw a section around it and say "remove this,
      annotask is MIT-licensed and free"
- [ ] **"Trusted by" logo bar** with fake company logos — we don't have users yet,
      this looks dishonest. Pin: "remove or replace with framework logos"
- [ ] **Newsletter signup form** at the bottom — we don't have a newsletter.
      Pin: "replace with a link to GitHub discussions or Discord"

### Style / design issues (style editor + token editor)
- [ ] Cards have `border-radius: 4px` instead of `12px` — too sharp, doesn't
      match the rounded feel of the rest of the page (live-edit in inspector)
- [ ] Section padding is inconsistent — some sections `48px`, hero is `72px`,
      install is `32px`. Should be uniform (style editor)
- [ ] Code blocks use a slightly wrong background — `#1a1a1a` instead of
      `--code-bg` token, so it doesn't match the surface hierarchy
- [ ] Accent color is a generic purple `#8b5cf6` instead of the annotask blue
      `#3b82f6` (token editor: change `--accent`)
- [ ] Font stack is just `"Inter", sans-serif` — missing the full fallback chain
      the current page has

### A11y issues (audit scan — real axe-core catches)
- [ ] Low contrast on `.section-lede` text — `#999` on `#0a0a0a` fails AA
      (one-click fix task from a11y panel)
- [ ] Hero screenshot `<img>` has `alt=""` — should describe what's shown
- [ ] Missing `<main>` landmark — content is all in a bare `<div class="wrap">`
- [ ] Nav links say "Link 1", "Link 2" instead of descriptive text (or `<a>`
      wrapping only an icon with no `aria-label`)
- [ ] Heading skip: hero h1 → card h3s with no h2 in between

### Layout / responsive issues (viewport preview)
- [ ] Feature grid uses fixed `grid-template-columns: repeat(3, 1fr)` with no
      media query — overflows on mobile (switch to viewport preview, see the break)
- [ ] Hero font-size is a fixed `56px` — no `clamp()`, so it's massive on mobile
- [ ] Agent integration code blocks overflow horizontally on small screens

### Missing polish the AI skipped (section requests + arrows)
- [ ] No demo video section — just a static screenshot where the video frame
      should be. Draw a section: "add a video placeholder with play button overlay"
- [ ] No syntax highlighting in code blocks — the AI generated `<pre><code>`
      but didn't add the `<span class="k">` / `<span class="s">` markup
- [ ] Lifecycle diagram is just plain text `pending → in_progress → review`
      instead of the styled pill badges. Arrow from text to where pills should be
- [ ] No dogfood banner ("This page is running with Annotask enabled") — the AI
      didn't know about this self-referential feature
- [ ] No light mode support at all — only dark CSS variables, no
      `@media (prefers-color-scheme: light)` block

---

## Technical setup

### Prerequisites
- [ ] Marketing playground runs cleanly on port 5181
- [ ] Annotask shell loads at `/__annotask/`
- [ ] Init wizard completes successfully
- [ ] In-shell embedded agent works (Claude local provider)
- [ ] Screenshots directory has placeholder images (or we capture real ones during demo)

### Recording tools
- **Screen capture:** OBS or built-in OS recorder (1920x1080, 60fps)
- **Terminal:** Clean terminal with visible font (JetBrains Mono 14px)
- **Browser:** Chrome, clean profile, no extensions visible
- **AI voiceover:** ElevenLabs or similar TTS from transcript
- **Editor:** Assemble clips + voiceover in DaVinci Resolve / CapCut

### Artifacts produced
1. `scripts/demo-reset.sh` — restore marketing page to "before" state
2. `demo/transcript.md` — full voiceover script with timestamps and action cues
3. `demo/segments/` — individual screen recordings per segment
4. `demo/voiceover/` — AI-generated audio clips per segment
5. Final assembled video (MP4, 1080p)

---

## Open questions

1. **Which agent on camera?** Options:
   - **In-shell embedded agent** (Claude local) — shows the full in-shell UX,
     everything happens in the browser
   - **Claude Code with MCP** — shows the editor integration story
   - **Both** — in-shell for the hero video, MCP for a deep-dive clip

2. **Init wizard in the hero video?** It's impressive (shows token extraction,
   framework detection) but adds 30s. Could be a separate clip instead.

3. **Agent conversation panel** — do we show the thinking/tool calls/token
   usage streaming, or just the results landing in the page? Transparent but
   slower vs punchy.

4. **How many tasks applied on camera?** The "before" state has ~15 fixable
   items. Apply 3-4 on camera at real speed, then fast-forward the rest?
   Or let them all stream through?

5. **Music / sound design?** Subtle background track or voiceover only?

6. **Do we need real annotask screenshots** in `/public/screenshots/` for the
   feature cards, or are placeholders fine for the demo?
