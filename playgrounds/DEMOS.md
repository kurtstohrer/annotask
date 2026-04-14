# Annotask Playground Demos

Each playground showcases a different *kind of site* so you can demo annotask
across the categories most teams care about: marketing, data exploration,
admin dashboards, and embedded e-commerce widgets.

All playgrounds are wired to the same shared FastAPI service in
`playgrounds/api/`, but each pulls from a different domain (marketing,
countries, dashboard, catalog) so the data, layout, and demo opportunities
feel distinct.

| Playground | Theme | Framework | Port | API domain |
|---|---|---|---|---|
| `react-vite` | Annotask marketing site | React 19 + CSS Modules | 5174 | `/api/marketing/*` |
| `svelte-vite` | Atlas country explorer | Svelte 5 runes | 5175 | `/api/countries/*` |
| `vue-vite` | Annotask Admin dashboard | Vue 3 + PrimeVue | 5173 | `/api/dashboard/*` |
| `mfe-vite` | Storefront widget (MFE child) | Vue 3 (MFE) | 5180 | `/api/catalog/*` |
Run any of them with `just react`, `just svelte`, etc. — the API auto-starts
on `:8888` if it isn't already running.

---

## React — Annotask Marketing Site (`just react`, http://localhost:5174)

A plausible landing page for annotask itself. Hero, features, pricing,
testimonials, FAQ, waitlist form. Plain CSS Modules with a hand-built design
token system, so every color/spacing/shadow lives as a real, inspectable
CSS variable.

### Demo scenarios

1. **Theme inspector → live recolor**
   - Open `/__annotask/` alongside the page.
   - Hit the sun/moon button in the nav to flip between dark and light themes.
   - Open the annotask theme page and edit `--accent` from purple to teal.
   - Watch every CTA, badge, focus ring, and feature icon recolor at once.

2. **Live style edit on the hero CTA**
   - Inspect the "Get started — it's free" button on the hero.
   - Open the style editor, change `padding-block` from 16px → 24px, change
     `border-radius` from 999px → 12px.
   - Apply via `/annotask-apply` and watch the diff land in
     `src/components/Hero.module.css`.

3. **Pin annotation on a pricing tier**
   - Pin a note on the highlighted "Team" pricing card → "Make this card 20%
     bigger and add a subtle gradient border."
   - The created task records the element selector, the file
     (`src/components/PricingGrid.tsx`), and a screenshot.

4. **Section request near the FAQ**
   - Use the section tool to draw a box just above the FAQ.
   - Write "Add a comparison table: annotask vs. Storybook vs. Plasmic."
   - The resulting `section_request` task includes placement coordinates and
     the surrounding markup so the agent can drop the new section in the
     right place.

5. **A11y scan**
   - Run the a11y panel. The hero gradient text and the pricing cards' faint
     CTA on the highlighted tier are good targets for a contrast finding.
   - Click "Create fix task" on a violation and confirm the task type is
     `a11y_fix` with a `rule`/`impact`/`elements` payload.

6. **Performance scan**
   - Run the perf panel. The big hero gradient + the multiple SVG icons in
     the FeatureGrid create a render-cost target.
   - Create a perf task and confirm it lands in `.annotask/tasks.json` with
     `type: "annotation"` and a perf-specific summary.

7. **Component discovery**
   - In your editor (or via MCP), call `annotask_get_components` and confirm
     it returns `Nav`, `Hero`, `FeatureGrid`, `TestimonialCarousel`,
     `PricingGrid`, `FAQ`, `Footer`, etc.

8. **Round-trip via MCP**
   - Pin a task on the hero CTA via the browser.
   - In a separate Claude Code/Cursor session, run `annotask_get_tasks` →
     `annotask_update_task in_progress` → make the source change → mark
     `review` with a resolution note.
   - Back in the browser, accept it from the task drawer.

---

## Svelte — Atlas Country Explorer (`just svelte`, http://localhost:5175)

A real data exploration UI: search, filter by region, sort by population or
area, drill into a country detail page, and compare up to 4 countries
side-by-side with inline SVG bar charts. Routes use a tiny custom hash
router so detail pages are real URLs (`#/country/JP`).

### Demo scenarios

1. **Inline class/style edits on a country card**
   - Select any country card. Open the style editor and change
     `border-radius`, `box-shadow`, and the hover `translateY` value.
   - Apply via `/annotask-apply` — diff lands in
     `src/components/CountryCard.svelte`.

2. **Empty-state redesign request**
   - Search for "zzzz" so the result list is empty.
   - Highlight the empty state, write "Replace this with a small illustrated
     globe and a 'Reset filters' button at the bottom."
   - The task type is `annotation` and includes the empty-state DOM snippet.

3. **Compare flow**
   - Add 3-4 countries to compare via the `+` button on each card.
   - Navigate to `#/compare` (or via the nav button — note the badge count).
   - Take a screenshot of the bar chart, then annotate "Make the population
     bar more prominent and label the unit."
   - Reload the page — the compare list persists from localStorage.

4. **Region filter chip styling**
   - Pin an annotation on the active region chip → "The active state should
     have stronger contrast against the surface — try a 1px ring instead of
     a fill."
   - The task includes the chip's element context.

5. **A11y scan**
   - Run the a11y panel on the country list. The flag emojis and the search
     icon are good targets for `aria-label` warnings.
   - One-click fix → task created.

6. **Live route navigation via toolbar**
   - In the annotask toolbar, type `#/country/JP` into the route input and
     hit enter. Confirm the iframe navigates and the detail page loads.
   - Reload — the route persists from localStorage.

7. **Cross-component theme edit**
   - Open the theme page and change `--accent` from teal to a coral.
   - The compare badge, the active filter chip, the focus ring, and the
     compare-button "active" state all recolor instantly.

---

## Vue — Annotask Admin Dashboard (`just vue`, http://localhost:5173)

A dashboard skin built on PrimeVue components. Four KPI cards with
sparklines, an activity feed, a sortable users DataTable, an orders
DataTable with status tags, and an analytics chart with range/metric
selectors.

### Demo scenarios

1. **Theme tokens cascading through PrimeVue**
   - Open the theme page and change `--accent`. Confirm the KPI sparklines,
     active nav item, and active SelectButton all update.
   - Edit the dark surface variables and watch the DataTable rows restyle.

2. **DataTable density tweak**
   - Open the Users page. Inspect a row, change `padding` on
     `.p-datatable-tbody > tr > td` from 12px to 6px via the style editor
     for tighter rows.
   - Apply and watch `App.vue`'s scoped overrides update.

3. **KPI card layout edit**
   - Inspect a KPI card on the Overview page. Increase `border-radius`,
     soften the sparkline color, add a stronger box-shadow on hover.

4. **Multi-page tasks (regression check for cb6243b)**
   - Create one task each on Overview, Users, Orders, and Analytics.
   - Confirm the `mfe` filter doesn't drop them (this exercises the fix
     committed in `cb6243b`).

5. **Chart styling**
   - Annotate the analytics chart bars → "Use a softer two-stop gradient
     and add a baseline at the average."
   - The task captures `AnalyticsChart.vue` as the file context.

6. **API docs page**
   - Visit `/api-docs`. The page renders the FastAPI OpenAPI schema live.
   - All four new domains (Marketing, Countries, Dashboard, Catalog) appear
     under their tags.

---

## MFE — Storefront Widget (`just mfe`, http://localhost:5180)

A Module-Federation child app pretending to be an embeddable storefront
widget. Same surface as the Vue dashboard but smaller, scoped, and with the
`mfe: '@test/mfe-child'` flag set in `vite.config.ts`. Tasks created here
land in this child's `.annotask/tasks.json`, not the host's.

### Demo scenarios

1. **Cross-MFE isolation**
   - Create a task on the Storefront overview.
   - Open the host playground (e.g. vue-vite). Confirm the task is *not*
     visible there — it lives in the child's task store.
   - In the MFE's annotask UI, the `mfe` field on the task is
     `@test/mfe-child`.

2. **Top-rated ranking edit**
   - On the Overview page, inspect the `ProductRanking` bars and change the
     gradient stops via the style editor.

3. **Detail-row drill in**
   - Open the Products page. Click a row to open the detail panel.
   - Annotate the panel → "Move the price into the title row."

---

## Suggested demo order for a 15-minute walkthrough

1. **(2 min) Marketing site (React)** — open `just react`. Show the hero, do
   a quick theme color swap. Convince the audience this is a real product page.
2. **(3 min)** Pin a task on the hero CTA, run an a11y scan, create a fix
   task. Show `.annotask/tasks.json` updating in real time.
3. **(2 min)** Switch to the Atlas explorer (Svelte). Filter by region,
   pick 3 countries, navigate to `/compare`, point out the URL persistence.
4. **(2 min)** Create a section request on the empty state. Open the task
   drawer to show the captured element context.
5. **(2 min)** Switch to the admin dashboard (Vue). Show the live KPI
   sparklines, edit a card's hover state via the inspector.
6. **(2 min)** Switch to the MFE storefront. Create a task and show that it
   lives in the child's `.annotask/tasks.json`, not the host's.
7. **(2 min)** Open Claude/Cursor side-by-side. Run `/annotask-apply` and
   watch the agent pick up the queued tasks via MCP and apply each one.

---

## Troubleshooting

- **404 on `/api/...`**: the FastAPI service isn't running. Run `just api`
  in foreground or let any playground auto-start it via the justfile.
- **Stale planet/moon data**: make sure the api process was restarted after
  the migration — `just stop-api` then re-run any playground.
- **`.annotask/tasks.json` not updating**: confirm the playground has
  annotask wired in `vite.config.ts` and the dev server is still running.
- **MFE tasks landing in the wrong store**: confirm the MFE playground's
  vite.config.ts has `annotask({ mfe: '@test/mfe-child' })`.
