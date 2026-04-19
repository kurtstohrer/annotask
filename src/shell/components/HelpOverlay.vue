<template>
  <div class="fullscreen-overlay help-overlay">
    <div class="help-sidebar">
      <nav class="help-nav">
        <template v-for="item in navItems" :key="item.id">
          <button
            :class="['help-nav-btn', { active: helpSection === item.id || isChildActive(item) }]"
            @click="$emit('update:helpSection', item.id)">
            <span v-html="item.icon"></span>
            {{ item.label }}
          </button>
          <div v-if="item.children && (helpSection === item.id || isChildActive(item))" class="help-subnav">
            <button v-for="child in item.children" :key="child.id"
              :class="['help-subnav-link', { active: helpSection === child.id }]"
              @click="$emit('update:helpSection', child.id)">{{ child.label }}</button>
          </div>
        </template>
      </nav>
      <div class="help-version">Annotask v{{ annotaskVersion }}</div>
    </div>

    <div class="help-content">
      <!-- Overview -->
      <div v-if="helpSection === 'overview'" class="help-page">
        <h2 class="help-page-title">Overview</h2>
        <p class="help-intro">Annotask is a visual UI design tool that runs alongside your app. Designers and engineers make visual changes in the browser and Annotask generates structured tasks that an AI agent applies back to your source code.</p>

        <div class="help-diagram">
          <FlowDiagram :label="diagrams.overview.label" :nodes="diagrams.overview.nodes" :edges="diagrams.overview.edges" />
          <div class="help-diagram-caption">Visual edits in the browser become structured tasks that an AI agent reads and applies.</div>
        </div>

        <div class="help-cards">
          <button v-for="card in helpCards" :key="card.id" class="help-card" @click="$emit('update:helpSection', card.id)">
            <span v-html="card.icon"></span>
            <span class="help-card-title">{{ card.title }}</span>
            <span class="help-card-desc">{{ card.desc }}</span>
          </button>
        </div>

        <h3 class="help-section-title">Keyboard Shortcuts</h3>
        <div class="help-shortcuts-grid">
          <div class="help-shortcut-group">
            <div class="shortcut-group-title">Tools</div>
            <div class="shortcut-row"><kbd>V</kbd><span>Select</span></div>
            <div class="shortcut-row"><kbd>P</kbd><span>Pin</span></div>
            <div class="shortcut-row"><kbd>A</kbd><span>Arrow</span></div>
            <div class="shortcut-row"><kbd>D</kbd><span>Draw Section</span></div>
            <div class="shortcut-row"><kbd>H</kbd><span>Highlight Text</span></div>
            <div class="shortcut-row"><kbd>I</kbd><span>Interact Mode</span></div>
          </div>
          <div class="help-shortcut-group">
            <div class="shortcut-group-title">View</div>
            <div class="shortcut-row"><kbd>L</kbd><span>Toggle Layout Overlay</span></div>
            <div class="shortcut-row"><kbd>T</kbd><span>Toggle Task Panel</span></div>
            <div class="shortcut-row"><kbd>?</kbd><span>Toggle Help</span></div>
            <div class="shortcut-row"><kbd>Esc</kbd><span>Deselect / Close</span></div>
          </div>
          <div class="help-shortcut-group">
            <div class="shortcut-group-title">Actions</div>
            <div class="shortcut-row"><kbd class="mod">Ctrl</kbd><kbd>Z</kbd><span>Undo</span></div>
            <div class="shortcut-row"><kbd class="mod">Ctrl</kbd><kbd>Enter</kbd><span>Submit Form</span></div>
          </div>
        </div>
        <div class="shortcut-hint">On Mac, use <kbd class="mod">&#8984;</kbd> instead of <kbd class="mod">Ctrl</kbd></div>
      </div>

      <!-- Annotate -->
      <div v-else-if="helpSection === 'annotate'" class="help-page">
        <h2 class="help-page-title">Annotate</h2>
        <p class="help-intro">The <strong>Annotate</strong> tab is where you mark up your running app. Drop pins, draw arrows, outline new sections, highlight text — every annotation becomes a task for your AI agent with element metadata, source location, and optional screenshots.</p>

        <h3 id="annotate-tools" class="help-section-title">Tools</h3>
        <div class="help-feature-list">
          <div class="help-feature">
            <div class="help-feature-header"><kbd>V</kbd> Select</div>
            <p>Click any element to select it. The inspector panel shows computed styles, component info, and source file. Shift+click to multi-select. Create a task from the selection with a description of your desired change.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>P</kbd> Pin</div>
            <p>Click to drop a pin on any element. A task panel opens to describe the change you want. Pins track their target element during scroll and resize.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>A</kbd> Arrow</div>
            <p>Draw arrows between elements to show relationships or flow. Arrows snap to element edges with bezier curves. Drag endpoints to reposition. Six color presets available.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>D</kbd> Draw Section</div>
            <p>Draw a rectangular area to describe a new content section. Includes a markdown editor for detailed descriptions. Sections are movable and resizable.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>H</kbd> Highlight Text</div>
            <p>Select text in your app to highlight it. The highlight attaches to the DOM range and tracks scroll. Create tasks referencing the highlighted content.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>I</kbd> Interact</div>
            <p>Switch to interact mode to use your app normally — click links, fill forms, scroll. No element selection or annotation occurs in this mode.</p>
          </div>
        </div>

        <h3 id="annotate-screenshots" class="help-section-title">Screenshots</h3>
        <p class="help-text">Attach screenshots to any task. The snipping tool captures a region or full page. Screenshots are stored on the server and served to your AI agent.</p>
      </div>

      <!-- Design -->
      <div v-else-if="helpSection === 'design'" class="help-page">
        <h2 class="help-page-title">Design</h2>
        <p class="help-intro">Inspect and edit your app's visual design. The <strong>Design</strong> tab has three sub-sections: <strong>Tokens</strong>, <strong>Inspector</strong>, and <strong>Components</strong>. Edits are recorded as tasks that map back to your source code and design tokens.</p>

        <h3 id="design-tokens" class="help-section-title">Tokens</h3>
        <p class="help-text">View and edit design tokens — colors, typography, spacing, borders, shadows. Annotask detects CSS custom properties and organizes them by category. Edits create <strong>theme_update</strong> tasks with token name, category, before/after values, and the CSS variable reference.</p>

        <h3 id="design-inspector" class="help-section-title">Inspector</h3>
        <p class="help-text">Click any element to inspect its computed styles. Edit properties inline — changes apply live and are recorded as <strong>style_update</strong> tasks. Class editing lets you add, remove, or toggle CSS classes. Undo with <kbd class="mod">Ctrl</kbd><kbd>Z</kbd>.</p>
        <p class="help-text">The <strong>Layout Overlay</strong> (<kbd>L</kbd>) visualizes flex and grid containers — container boundaries, alignment, and gaps. Scan the page to discover all layout containers at once.</p>

        <h3 id="design-components" class="help-section-title">Components</h3>
        <p class="help-text">Browse detected component libraries (Headless UI, shadcn/ui, Radix, Vuetify, Reka UI, etc.) with their props and code examples. Hover a library entry to light up matching elements on the page. This view feeds the <a href="#" class="help-inline-link" @click.prevent="$emit('update:helpSection', 'context')">component context</a> attached to tasks.</p>
      </div>

      <!-- Audit -->
      <div v-else-if="helpSection === 'audit'" class="help-page">
        <h2 class="help-page-title">Audit</h2>
        <p class="help-intro">Monitor runtime health and code quality. The <strong>Audit</strong> tab has five sub-sections: <strong>A11y</strong>, <strong>Data</strong>, <strong>Libraries</strong>, <strong>Performance</strong>, and <strong>Errors</strong>. Each surfaces findings you can turn into fix tasks with one click.</p>

        <h3 id="audit-a11y" class="help-section-title">A11y</h3>
        <p class="help-text">Automated WCAG audits powered by <strong>axe-core</strong> (bundled locally — no CDN). Scan the full page or a specific element. Violations group by rule with impact levels (critical, serious, moderate, minor). Each violation shows affected elements, selectors, and a WCAG reference. Click the task button to create an <strong>a11y_fix</strong> task with everything the agent needs.</p>

        <h3 id="audit-data" class="help-section-title">Data</h3>
        <p class="help-text">Discovers data sources in your app — composables, stores, <code>fetch</code>/<code>axios</code> calls, tRPC, GraphQL, route loaders. Hover a data source row to highlight elements that consume it. Matches endpoints against detected API schemas (OpenAPI, GraphQL, tRPC) so the agent knows what shape comes back. Backend-contract edits create <strong>api_update</strong> tasks with schema and data-source context.</p>

        <h3 id="audit-libraries" class="help-section-title">Libraries</h3>
        <p class="help-text">Shows data-fetching and state libraries detected in your project — TanStack Query, Pinia, Redux, Zustand, Apollo, SWR, and more — with the files that use them. Useful when your agent needs to know which patterns to follow.</p>

        <h3 id="audit-perf" class="help-section-title">Performance</h3>
        <p class="help-text">Web Vitals (LCP, FID, CLS, TTFB), navigation timing, resource/bundle breakdown. Click <strong>Scan</strong> for a snapshot, <strong>Record</strong> to capture a session of interactions. Findings surface slow vitals, large bundles, render-blocking resources, excessive DOM size. Each finding can become a <strong>perf_fix</strong> task.</p>

        <h3 id="audit-errors" class="help-section-title">Errors</h3>
        <p class="help-text">Captures console errors and warnings from your app in real time. Errors are deduplicated and bounded to prevent memory bloat. Click any error to create an <strong>error_fix</strong> task with the message, stack trace, and source location.</p>
      </div>

      <!-- LLM Context -->
      <div v-else-if="helpSection === 'context'" class="help-page">
        <h2 class="help-page-title">LLM Context</h2>
        <p class="help-intro">Every task your agent receives is grounded in structured context about the UI. Annotask assembles this context from several independent sources and attaches it under <code>task.context</code>. You control attachment per-task via toggles in the pending task panel.</p>

        <div class="help-diagram">
          <FlowDiagram :label="diagrams.context.label" :nodes="diagrams.context.nodes" :edges="diagrams.context.edges" />
          <div class="help-diagram-caption">Selection → context capture → task payload. Toggles opt-in to the heavier fragments.</div>
        </div>

        <h3 id="context-component" class="help-section-title">Component Context</h3>
        <p class="help-text">When the selected element maps to a known component (detected from imports and render output), Annotask attaches: library name, category, file location, and real usage examples from your codebase (3–5 snippets showing prop combinations and compound patterns like <code>Callout.Root</code>). This gives the agent concrete patterns to follow rather than prop documentation alone.</p>
        <p class="help-text">Always attached (lightweight). Powered by the component scanner that feeds the <strong>Design → Components</strong> view.</p>

        <h3 id="context-data" class="help-section-title">Data Context</h3>
        <p class="help-text">When the element's source file references data sources (detected via the <strong>binding-analysis</strong> pass), Annotask attaches: data source name, kind (query, mutation, composable, store…), file location, API schema (if matched to an OpenAPI/GraphQL/tRPC endpoint), rendered identifiers, and consumption examples from elsewhere in the codebase.</p>
        <p class="help-text">Toggle: <strong>Include data context</strong> on the pending task panel. The toggle only appears when a lightweight probe confirms the file has data sources — no UI noise otherwise.</p>

        <h3 id="context-element" class="help-section-title">Element Context</h3>
        <p class="help-text">A DOM subtree snapshot of the selected element — tag, classes, id, attributes, visible text — plus the ancestor chain (parent components/elements from root down). The ancestor chain tells the agent <em>where</em> the element renders when file/line alone doesn't pinpoint the usage site in a deep component tree.</p>
        <p class="help-text">Toggle: <strong>Include DOM context</strong>. Off by default — useful for structural changes or when component props don't fully describe the intent.</p>

        <h3 id="context-history" class="help-section-title">Interaction History</h3>
        <p class="help-text">Chronological log of user actions (clicks, form submits) and route changes with timestamps — capped at 100 entries, last 20 attached to tasks. Helps the agent understand the flow that led to a visible issue (e.g. "user clicked X, navigated to Y, and then the button broke").</p>
        <p class="help-text">Toggle: <strong>Include interaction history</strong>. Off by default.</p>

        <h3 id="context-code" class="help-section-title">Code Context</h3>
        <p class="help-text">Source excerpt (±15 lines), detected function/component name, import statements, and a SHA256 hash of the excerpt. The hash lets the agent detect drift on retry if the file changed. Always attached when a file location is known.</p>
      </div>

      <!-- Tasks -->
      <div v-else-if="helpSection === 'tasks'" class="help-page">
        <h2 class="help-page-title">Tasks</h2>
        <p class="help-intro">Every annotation, style edit, a11y violation, error, or perf finding becomes a <strong>task</strong>. Tasks are the unit of work your AI agent consumes — each has a type, status, source file, component info, and full context.</p>

        <div class="help-diagram">
          <FlowDiagram :label="diagrams.lifecycle.label" :nodes="diagrams.lifecycle.nodes" :edges="diagrams.lifecycle.edges" />
          <div class="help-diagram-caption">Task lifecycle. Agents drive the middle states; you drive the outcome.</div>
        </div>

        <h3 id="tasks-lifecycle" class="help-section-title">Lifecycle</h3>
        <p class="help-text"><strong>pending</strong> — you just created the task. <strong>in_progress</strong> — an agent has locked it and is working. <strong>review</strong> — the agent is done and waiting for you to accept or deny. <strong>accepted</strong> — task is removed (and its screenshot auto-cleaned). <strong>denied</strong> — returned to the agent with your feedback for a retry.</p>
        <p class="help-text">Two branch states: <strong>needs_info</strong> (the agent asked a clarifying question — respond in the task drawer) and <strong>blocked</strong> (the agent couldn't apply the change — read the reason and adjust).</p>

        <h3 id="tasks-types" class="help-section-title">Task Types</h3>
        <p class="help-text">
          <strong>annotation</strong> (pins, arrows, notes, highlights),
          <strong>section_request</strong> (drawn sections),
          <strong>style_update</strong> (inspector edits — CSS changes),
          <strong>theme_update</strong> (design token edits),
          <strong>a11y_fix</strong> (WCAG violation fix),
          <strong>error_fix</strong> (console error fix),
          <strong>perf_fix</strong> (performance finding fix),
          <strong>api_update</strong> (backend contract edits).
        </p>

        <h3 id="tasks-panel" class="help-section-title">Tasks Panel</h3>
        <p class="help-text">Toggle with <kbd>T</kbd> or the Tasks button in the toolbar. Tasks are filtered to the current route by default. Click a task to open the detail drawer — markdown description, screenshot lightbox, element info, interaction log, JSON view, and a delete button.</p>
      </div>

      <!-- Agent Workflow -->
      <div v-else-if="helpSection === 'agent'" class="help-page">
        <h2 class="help-page-title">Agent Workflow</h2>
        <p class="help-intro">Annotask exposes tasks through three surfaces: an <strong>MCP server</strong> (for Claude Code, Cursor, VS Code, Windsurf), a <strong>CLI</strong>, and an <strong>HTTP API</strong>. Your agent uses whichever fits its environment.</p>

        <div class="help-diagram">
          <FlowDiagram :label="diagrams.agent.label" :nodes="diagrams.agent.nodes" :edges="diagrams.agent.edges" />
          <div class="help-diagram-caption">The dev server hosts the API, WebSocket, MCP endpoint, and shell UI.</div>
        </div>

        <h3 id="agent-mcp" class="help-section-title">MCP Server</h3>
        <p class="help-text">Runs at <code>POST /__annotask/mcp</code> (Streamable HTTP, JSON-RPC 2.0). Register it with <code>annotask init-mcp --editor=claude</code> (or <code>cursor|vscode|windsurf|all</code>). The tool surface covers task management, design spec, components, screenshots, code context, data context and data-source discovery, plus API-schema lookup and endpoint resolution.</p>

        <h3 id="agent-cli" class="help-section-title">CLI</h3>
        <p class="help-text">For non-MCP agents: <code>annotask tasks</code>, <code>task</code>, <code>design-spec</code>, <code>components</code>, <code>component-examples</code>, <code>code-context</code>, <code>data-context</code>, <code>data-sources</code>, <code>api-schemas</code>, <code>resolve-endpoint</code>, <code>update-task</code>, and <code>watch</code>. Pass <code>--mcp</code> to get compact JSON matching the MCP tool output.</p>

        <h3 id="agent-skills" class="help-section-title">Skills</h3>
        <p class="help-text">Run <code>annotask init-skills</code> to install both bundled skills into your project: <a href="#" class="help-inline-link" @click.prevent="$emit('update:helpSection', 'apply-skill')"><code>/annotask-apply</code></a> (apply pending tasks to source code) and <a href="#" class="help-inline-link" @click.prevent="$emit('update:helpSection', 'init-skill')"><code>/annotask-init</code></a> (scan the project and generate the design spec).</p>

        <h3 id="agent-api" class="help-section-title">HTTP API</h3>
        <p class="help-text">Raw endpoints under <code>/__annotask/api/*</code> include tasks, design spec, components, code context, data context, data sources, API schemas, endpoint resolution, performance snapshots, and screenshots. WebSocket live stream at <code>/__annotask/ws</code>.</p>
      </div>

      <!-- Skills landing -->
      <div v-else-if="helpSection === 'skills'" class="help-page">
        <h2 class="help-page-title">Skills</h2>
        <p class="help-intro">Annotask ships two Claude Code skills that teach your agent how to work with the project. Install both by running <code>annotask init-skills</code> — files land in <code>.claude/skills/</code> and are picked up automatically.</p>

        <div class="help-cards">
          <button class="help-card" @click="$emit('update:helpSection', 'apply-skill')">
            <span v-html="icons.applySkill"></span>
            <span class="help-card-title">/annotask-apply</span>
            <span class="help-card-desc">Triage pending + denied tasks, group by touched resources, apply each group, then sweep for anything that landed mid-run.</span>
          </button>
          <button class="help-card" @click="$emit('update:helpSection', 'init-skill')">
            <span v-html="icons.initSkill"></span>
            <span class="help-card-title">/annotask-init</span>
            <span class="help-card-desc">Scan the project for framework, design tokens, icons, and component libraries. Write <code>.annotask/design-spec.json</code>.</span>
          </button>
        </div>
      </div>

      <!-- /annotask-apply skill -->
      <div v-else-if="helpSection === 'apply-skill'" class="help-page">
        <h2 class="help-page-title"><code>/annotask-apply</code></h2>
        <p class="help-intro">The <strong>apply</strong> skill takes the pending + denied tasks in your Annotask queue and applies them to source code. It batches tasks by touched resources, applies each group, then double-checks for anything that landed mid-run.</p>

        <div class="help-diagram">
          <FlowDiagram :label="diagrams.applyLoop.label" :nodes="diagrams.applyLoop.nodes" :edges="diagrams.applyLoop.edges" />
          <div class="help-diagram-caption">Pull, group, dispatch to parallel subagents, flip each task to <em>review</em>, wait for accept / deny, then report back to you. Denied or new tasks loop straight back into triage.</div>
        </div>

        <h3 class="help-section-title">Triggers</h3>
        <p class="help-text">Run it manually with <code>/annotask-apply</code>, or ask your agent: <em>"apply the Annotask changes"</em>, <em>"apply my design changes"</em>, <em>"sync Annotask"</em>. Installed by <code>annotask init-skills</code>.</p>

        <h3 class="help-section-title">1. Pull Tasks</h3>
        <p class="help-text">The agent pulls all actionable tasks — <code>pending</code>, <code>denied</code> (with feedback), and resumed <code>needs_info</code> tasks whose questions have been answered. Waiting tasks (<code>needs_info</code> pending user) and <code>blocked</code> tasks are skipped.</p>

        <h3 class="help-section-title">2. Triage &amp; Group</h3>
        <p class="help-text">A read-only pass over all summaries buckets tasks by touched resources:</p>
        <ul class="help-list">
          <li><strong>Same file</strong> → one serial group. Never two tasks editing the same file concurrently.</li>
          <li><strong>Shared global state</strong> → one serial group. <code>.annotask/design-spec.json</code>, <code>:root</code> CSS vars, <code>tailwind.config.*</code>, shared layouts, i18n catalogs, route tables, barrel exports.</li>
          <li><strong>Dependency order</strong> → phase ordering. <code>theme_update</code> runs before any <code>style_update</code> that consumes the new token. <code>section_request</code> runs before <code>a11y_fix</code> / <code>style_update</code> targeting the new UI.</li>
        </ul>

        <h3 class="help-section-title">3. Work in Parallel</h3>
        <p class="help-text">Fully disjoint groups (no shared file, state, or dependency edge) fan out to parallel subagents — one per group. Tasks inside a single group are always processed serially.</p>
        <p class="help-text">Each task follows a short cycle: lock (<code>in_progress</code>) → ground (fetch design spec / component examples / data sources as needed) → edit → mark <code>review</code>. Tasks flip to <code>review</code> as soon as their own edit lands, so you can accept or deny early while later tasks are still in flight.</p>

        <a class="help-link-card" href="#" @click.prevent="$emit('update:helpSection', 'tasks')">
          <div class="help-link-card-title">See the full task lifecycle →</div>
          <div class="help-link-card-desc">Task states, transitions (<code>pending</code> → <code>in_progress</code> → <code>review</code> → <code>accepted</code> / <code>denied</code>), and the <code>needs_info</code> / <code>blocked</code> branches — with a state diagram.</div>
        </a>

        <h3 class="help-section-title">4. Review</h3>
        <p class="help-text">As each task lands, it flips from <code>in_progress</code> to <code>review</code> — immediately, even while other tasks in other groups are still running. You see the change in the Tasks panel and in the file diff. For each task you can <strong>accept</strong> (removes the task + cleans up its screenshot) or <strong>deny</strong> with feedback (the task stays as <code>denied</code> for the next sweep).</p>

        <h3 class="help-section-title">5. Second Sweep &amp; Response</h3>
        <p class="help-text">Because tasks flip to <code>review</code> immediately, you may deny early tasks or create new ones mid-run. Before responding, the agent re-fetches <code>pending</code> and <code>denied</code> once more — if either returns unhandled tasks, the whole flow repeats from triage. The loop continues until both queues come back empty.</p>
        <p class="help-text">Once the queue is empty, the agent sends a final <strong>response</strong> summarizing which tasks were applied, which files were modified, and which tasks it couldn't complete (and why). If a task keeps bouncing back as <code>denied</code> across multiple sweeps, the agent stops guessing and asks you for clarification via <code>needs_info</code>.</p>
      </div>

      <!-- /annotask-init skill -->
      <div v-else-if="helpSection === 'init-skill'" class="help-page">
        <h2 class="help-page-title"><code>/annotask-init</code></h2>
        <p class="help-intro">The <strong>init</strong> skill scans your codebase and generates <code>.annotask/design-spec.json</code> — the source of truth that Annotask reads to populate the <strong>Design → Tokens</strong> page with editable design tokens.</p>

        <div class="help-diagram">
          <FlowDiagram :label="diagrams.initScan.label" :nodes="diagrams.initScan.nodes" :edges="diagrams.initScan.edges" />
          <div class="help-diagram-caption">The scanner reads your project, classifies tokens into semantic roles, and writes the design spec.</div>
        </div>

        <h3 id="init-triggers" class="help-section-title">Triggers</h3>
        <p class="help-text">Run it manually with <code>/annotask-init</code>, or ask your agent: <em>"initialize Annotask"</em>, <em>"set up Annotask"</em>, <em>"scan my project for Annotask"</em>. Installed by <code>annotask init-skills</code>. Idempotent — re-run any time to rescan.</p>

        <h3 id="init-framework" class="help-section-title">Framework Detection</h3>
        <p class="help-text">Reads <code>package.json</code> to identify the framework (Vue / React / Svelte / Solid) and version. Detects styling approaches: <code>tailwind</code>, <code>scoped-css</code>, <code>css-modules</code>.</p>

        <h3 id="init-tokens" class="help-section-title">Token Scanning</h3>
        <p class="help-text">Five token categories are extracted and classified into semantic roles:</p>
        <ul class="help-list">
          <li><strong>Colors</strong> — from <code>:root</code> declarations, <code>@theme</code> blocks (Tailwind v4), or <code>tailwind.config</code> (v3). Classified as <code>primary</code>, <code>secondary</code>, <code>accent</code>, <code>background</code>, <code>surface</code>, <code>text</code>, <code>text-muted</code>, <code>border</code>, <code>danger</code>, <code>warning</code>, <code>success</code>, <code>info</code>. Max 30 tokens.</li>
          <li><strong>Typography</strong> — font families (<code>heading</code> / <code>body</code> / <code>mono</code>), scale (<code>xs</code>–<code>4xl</code>), and used weights.</li>
          <li><strong>Spacing</strong> — roles <code>xs</code>–<code>4xl</code>. Max 12 tokens.</li>
          <li><strong>Border radius</strong> — roles <code>sm</code>, <code>md</code>, <code>lg</code>, <code>xl</code>, <code>full</code>.</li>
          <li><strong>Breakpoints</strong> — from Tailwind screens, Bootstrap defaults, <code>--bp-*</code> vars, or common <code>@media</code> values.</li>
        </ul>

        <h3 id="init-libraries" class="help-section-title">Library Detection</h3>
        <p class="help-text"><strong>Icon libraries</strong> — lucide, heroicons, fontawesome, phosphor, tabler (matched from <code>package.json</code> dependencies).</p>
        <p class="help-text"><strong>Component libraries</strong> — PrimeVue, Vuetify, Element Plus, Headless UI, Radix Vue, Naive UI, shadcn/ui. When detected, imports across <code>src/</code> are scanned to populate the <code>used</code> list of component names.</p>

        <h3 id="init-output" class="help-section-title">Output</h3>
        <p class="help-text">Writes <code>.annotask/design-spec.json</code> with every token in a uniform shape: <code>role</code>, <code>value</code>, <code>cssVar</code>, <code>source</code>, <code>sourceFile</code>, <code>sourceLine</code>. The <code>cssVar</code> + <code>sourceFile</code> + <code>sourceLine</code> fields are what let the apply skill edit the right file when a <code>theme_update</code> task lands.</p>
        <p class="help-text">Also adds <code>.annotask/</code> to <code>.gitignore</code> (the spec is regenerated per developer) and deletes the legacy <code>.annotask/config.json</code> if present.</p>
      </div>

      <!-- Settings -->
      <div v-else-if="helpSection === 'settings'" class="help-page">
        <h2 class="help-page-title">Settings</h2>
        <p class="help-intro">Open Settings from the gear icon in the toolbar. Controls for appearance and shell behavior.</p>

        <h3 id="settings-themes" class="help-section-title">Themes</h3>
        <p class="help-text">18 built-in themes (Dark, Light, Monokai, Solarized, Nord, One Dark, Dracula, GitHub, Catppuccin Mocha, Gruvbox, Rosé Pine, Synthwave '84, Cobalt, plus high-contrast and deuteranopia). Create custom themes via Settings → Appearance → "Create Custom Theme" — all 63 CSS variables are exposed with live preview.</p>
        <p class="help-text">Enable <strong>System preference</strong> to auto-pair a dark theme with a light theme and follow your OS.</p>

        <h3 id="settings-task-options" class="help-section-title">Task Options</h3>
        <p class="help-text">The pending task panel exposes per-task toggles for <strong>Include DOM context</strong>, <strong>Include data context</strong>, and <strong>Include interaction history</strong>. See the <a href="#" class="help-inline-link" @click.prevent="$emit('update:helpSection', 'context')">LLM Context</a> page for what each attaches.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import FlowDiagram, { type FlowNode, type FlowEdge } from './FlowDiagram.vue'

export type HelpSection =
  | 'overview' | 'annotate' | 'design' | 'audit'
  | 'context' | 'tasks' | 'agent'
  | 'skills' | 'apply-skill' | 'init-skill'
  | 'settings'

interface Props {
  helpSection: HelpSection
  annotaskVersion: string
}

const props = defineProps<Props>()
defineEmits<{
  (e: 'update:helpSection', section: HelpSection): void
}>()

function isChildActive(item: { children?: Array<{ id: HelpSection }> }): boolean {
  return !!item.children?.some((c) => c.id === props.helpSection)
}

const icons = {
  overview: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  annotate: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  design: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12a10 10 0 0 0 .832 4"/></svg>',
  audit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  context: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6l2 4h4v14H3V7h4l2-4z"/><circle cx="12" cy="14" r="3"/></svg>',
  tasks: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
  agent: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M7 8V6a5 5 0 0 1 10 0v2"/><circle cx="9" cy="14" r="1" fill="currentColor"/><circle cx="15" cy="14" r="1" fill="currentColor"/></svg>',
  skills: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.39 7.36H22l-6.2 4.51L18.18 22 12 17.3 5.82 22l2.38-8.13L2 9.36h7.61L12 2z"/></svg>',
  applySkill: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/><path d="M13 3l3 3"/></svg>',
  initSkill: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21l-4.35-4.35"/><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6"/></svg>',
  settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v6m0 10v6m11-11h-6m-10 0H1m16.5-7.5l-4 4m-7 7l-4 4m15 0l-4-4m-7-7l-4-4"/></svg>',
}

const navItems: Array<{
  id: HelpSection
  label: string
  icon: string
  children?: Array<{ id: HelpSection; label: string }>
}> = [
  { id: 'overview', label: 'Overview', icon: icons.overview },
  { id: 'annotate', label: 'Annotate', icon: icons.annotate },
  { id: 'design', label: 'Design', icon: icons.design },
  { id: 'audit', label: 'Audit', icon: icons.audit },
  { id: 'context', label: 'LLM Context', icon: icons.context },
  { id: 'tasks', label: 'Tasks', icon: icons.tasks },
  { id: 'agent', label: 'Agent Workflow', icon: icons.agent },
  {
    id: 'skills', label: 'Skills', icon: icons.skills,
    children: [
      { id: 'apply-skill', label: '/annotask-apply' },
      { id: 'init-skill', label: '/annotask-init' },
    ],
  },
  { id: 'settings', label: 'Settings', icon: icons.settings },
]

const helpCards: Array<{ id: HelpSection; title: string; desc: string; icon: string }> = [
  { id: 'annotate', title: 'Annotate', desc: 'Pin, arrow, section, and highlight tools to mark up your UI and create tasks', icon: icons.annotate },
  { id: 'design', title: 'Design', desc: 'Edit tokens, inspect element styles, and explore components', icon: icons.design },
  { id: 'audit', title: 'Audit', desc: 'A11y, data sources, performance, and runtime errors — all turned into fix tasks', icon: icons.audit },
  { id: 'context', title: 'LLM Context', desc: 'What component, data, and DOM context Annotask attaches to each task', icon: icons.context },
  { id: 'tasks', title: 'Tasks', desc: 'Task types, lifecycle, and the Tasks panel', icon: icons.tasks },
  { id: 'skills', title: 'Skills', desc: '/annotask-apply and /annotask-init — installed with annotask init-skills', icon: icons.skills },
  { id: 'agent', title: 'Agent Workflow', desc: 'MCP server, CLI, apply skill — how agents pick up and apply tasks', icon: icons.agent },
]

// ── Diagrams ────────────────────────────────────────────
const diagrams: Record<string, { label: string; nodes: FlowNode[]; edges: FlowEdge[] }> = {
  overview: {
    label: 'Annotask overview',
    nodes: [
      { id: 'app',     label: 'Your App',       sublabel: 'running via Vite/Webpack', col: 0, row: 0, variant: 'muted' },
      { id: 'shell',   label: 'Annotask Shell', sublabel: 'browser UI overlay',       col: 1, row: 0, variant: 'accent' },
      { id: 'tasks',   label: 'Tasks',          sublabel: 'structured, grounded',     col: 2, row: 0, variant: 'info' },
      { id: 'agent',   label: 'AI Agent',       sublabel: 'MCP / CLI / API',          col: 3, row: 0, variant: 'purple' },
      { id: 'source',  label: 'Source Code',    sublabel: 'diffs & patches',          col: 3, row: 1, variant: 'success' },
    ],
    edges: [
      { from: 'app', to: 'shell', label: 'postMessage' },
      { from: 'shell', to: 'tasks', label: 'create' },
      { from: 'tasks', to: 'agent', label: 'read' },
      { from: 'agent', to: 'source', label: 'apply' },
      { from: 'source', to: 'app', label: 'HMR', dashed: true },
    ],
  },
  lifecycle: {
    label: 'Task lifecycle',
    nodes: [
      { id: 'pending',  label: 'pending',     sublabel: 'you created it',  col: 0, row: 1, variant: 'muted',    shape: 'pill' },
      { id: 'progress', label: 'in_progress', sublabel: 'agent locked it', col: 1, row: 1, variant: 'info',     shape: 'pill' },
      { id: 'review',   label: 'review',      sublabel: 'agent done',      col: 2, row: 1, variant: 'warning',  shape: 'pill' },
      { id: 'accepted', label: 'accepted',    sublabel: 'done',            col: 3, row: 0, variant: 'success',  shape: 'pill' },
      { id: 'denied',   label: 'denied',      sublabel: 'with feedback',   col: 3, row: 2, variant: 'danger',   shape: 'pill' },
      { id: 'info',     label: 'needs_info',  sublabel: 'agent asking',    col: 2, row: 0, variant: 'purple',   shape: 'pill' },
      { id: 'blocked',  label: 'blocked',     sublabel: "can't apply",     col: 2, row: 2, variant: 'danger',   shape: 'pill' },
    ],
    edges: [
      { from: 'pending',  to: 'progress' },
      { from: 'progress', to: 'review' },
      { from: 'progress', to: 'info',    dashed: true },
      { from: 'info',     to: 'progress', dashed: true, label: 'answered' },
      { from: 'progress', to: 'blocked', dashed: true },
      { from: 'review',   to: 'accepted' },
      { from: 'review',   to: 'denied' },
      { from: 'denied',   to: 'progress', dashed: true, label: 'retry' },
    ],
  },
  context: {
    label: 'LLM context pipeline',
    nodes: [
      { id: 'sel',     label: 'Selected Element', sublabel: 'pin / inspector / etc.', col: 0, row: 2, variant: 'accent' },
      { id: 'comp',    label: 'Component',        sublabel: 'library + usage',        col: 2, row: 0, variant: 'info' },
      { id: 'data',    label: 'Data',             sublabel: 'sources + schemas',      col: 2, row: 1, variant: 'info' },
      { id: 'elem',    label: 'Element',          sublabel: 'DOM + ancestors',        col: 2, row: 2, variant: 'info' },
      { id: 'hist',    label: 'History',          sublabel: 'recent actions',         col: 2, row: 3, variant: 'info' },
      { id: 'code',    label: 'Code',             sublabel: 'excerpt + hash',         col: 2, row: 4, variant: 'info' },
      { id: 'task',    label: 'task.context',     sublabel: 'attached to task',       col: 4, row: 2, variant: 'purple' },
    ],
    edges: [
      { from: 'sel', to: 'comp' },
      { from: 'sel', to: 'data', dashed: true, label: 'probed' },
      { from: 'sel', to: 'elem', dashed: true, label: 'toggle' },
      { from: 'sel', to: 'hist', dashed: true, label: 'toggle' },
      { from: 'sel', to: 'code' },
      { from: 'comp', to: 'task' },
      { from: 'data', to: 'task' },
      { from: 'elem', to: 'task' },
      { from: 'hist', to: 'task' },
      { from: 'code', to: 'task' },
    ],
  },
  agent: {
    label: 'Agent integration surfaces',
    nodes: [
      { id: 'editor',  label: 'Editor / Agent', sublabel: 'Claude Code, Cursor, …', col: 0, row: 1, variant: 'purple' },
      { id: 'mcp',     label: 'MCP Server',     sublabel: 'POST /__annotask/mcp',   col: 2, row: 0, variant: 'accent' },
      { id: 'cli',     label: 'Annotask CLI',   sublabel: 'annotask tasks',         col: 2, row: 1, variant: 'accent' },
      { id: 'api',     label: 'HTTP + WS',      sublabel: '/__annotask/api',        col: 2, row: 2, variant: 'accent' },
      { id: 'server',  label: 'Dev Server',     sublabel: 'Vite / Webpack',         col: 4, row: 1, variant: 'info' },
      { id: 'source',  label: 'Source Files',   sublabel: 'write diffs',            col: 5, row: 0, variant: 'success' },
      { id: 'tasks',   label: 'Tasks Store',    sublabel: 'JSON on disk',           col: 5, row: 2, variant: 'success' },
    ],
    edges: [
      { from: 'editor', to: 'mcp' },
      { from: 'editor', to: 'cli' },
      { from: 'editor', to: 'api' },
      { from: 'mcp', to: 'server' },
      { from: 'cli', to: 'server' },
      { from: 'api', to: 'server' },
      { from: 'server', to: 'tasks' },
      { from: 'editor', to: 'source', dashed: true, label: 'apply' },
    ],
  },
  initScan: {
    label: 'Init skill: scan project, classify, write spec',
    nodes: [
      { id: 'pkg',     label: 'package.json',   sublabel: 'framework + deps',    col: 0, row: 0, variant: 'muted' },
      { id: 'css',     label: 'CSS files',      sublabel: ':root · @theme',      col: 0, row: 1, variant: 'muted' },
      { id: 'tw',      label: 'tailwind.config',sublabel: 'v3 theme.extend',     col: 0, row: 2, variant: 'muted' },
      { id: 'src',     label: 'src/**',         sublabel: 'component imports',   col: 0, row: 3, variant: 'muted' },
      { id: 'scanner', label: 'Scanner',        sublabel: 'classify by role',    col: 2, row: 1, colSpan: 1, variant: 'accent' },
      { id: 'colors',  label: 'Colors',         sublabel: '12 semantic roles',   col: 4, row: 0, variant: 'info' },
      { id: 'typo',    label: 'Typography',     sublabel: 'families + scale',    col: 4, row: 1, variant: 'info' },
      { id: 'spacing', label: 'Spacing · Radius',sublabel: 'xs–4xl',             col: 4, row: 2, variant: 'info' },
      { id: 'libs',    label: 'Icons · Components',sublabel: 'detected + used',  col: 4, row: 3, variant: 'info' },
      { id: 'spec',    label: 'design-spec.json',sublabel: '.annotask/',         col: 6, row: 1, colSpan: 1, variant: 'success' },
      { id: 'theme',   label: 'Design → Tokens',sublabel: 'editable in shell',   col: 6, row: 2, variant: 'purple' },
    ],
    edges: [
      { from: 'pkg',     to: 'scanner' },
      { from: 'css',     to: 'scanner' },
      { from: 'tw',      to: 'scanner' },
      { from: 'src',     to: 'scanner' },
      { from: 'scanner', to: 'colors' },
      { from: 'scanner', to: 'typo' },
      { from: 'scanner', to: 'spacing' },
      { from: 'scanner', to: 'libs' },
      { from: 'colors',  to: 'spec' },
      { from: 'typo',    to: 'spec' },
      { from: 'spacing', to: 'spec' },
      { from: 'libs',    to: 'spec' },
      { from: 'spec',    to: 'theme', dashed: true, label: 'loaded by shell' },
    ],
  },
  applyLoop: {
    label: 'Apply skill: pull, group, work, review, respond',
    nodes: [
      { id: 'pull',    label: 'Pull Tasks',      sublabel: 'pending + denied',      col: 0, row: 1, variant: 'muted' },
      { id: 'triage',  label: 'Triage / Group',  sublabel: 'by file · state · deps',col: 1, row: 1, variant: 'accent' },
      { id: 'worker1', label: 'Subagent A',      sublabel: 'Group 1',               col: 2, row: 0, variant: 'info' },
      { id: 'worker2', label: 'Subagent B',      sublabel: 'Group 2',               col: 2, row: 1, variant: 'info' },
      { id: 'worker3', label: 'Subagent C',      sublabel: 'Group 3',               col: 2, row: 2, variant: 'info' },
      { id: 'review',  label: 'Review',          sublabel: 'tasks ready',           col: 3, row: 1, variant: 'warning' },
      { id: 'user',    label: 'User',            sublabel: 'accept / deny',         col: 4, row: 1, variant: 'purple' },
      { id: 'response',label: 'Response',        sublabel: 'summary report',        col: 5, row: 1, variant: 'success' },
    ],
    edges: [
      { from: 'pull',    to: 'triage' },
      { from: 'triage',  to: 'worker1' },
      { from: 'triage',  to: 'worker2' },
      { from: 'triage',  to: 'worker3' },
      { from: 'worker1', to: 'review' },
      { from: 'worker2', to: 'review' },
      { from: 'worker3', to: 'review' },
      { from: 'review',  to: 'user' },
      { from: 'user',    to: 'response', label: 'queue empty' },
      { from: 'user',    to: 'triage', dashed: true, variant: 'warning', label: 'denied / new' },
    ],
  },
}
</script>
