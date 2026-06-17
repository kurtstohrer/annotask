<template>
  <div class="init-modal-backdrop">
    <div class="init-modal" role="dialog" aria-modal="true" aria-labelledby="init-modal-title">
      <header class="init-modal-header">
        <h2 id="init-modal-title" class="init-modal-title">Set up Annotask</h2>
        <button
          class="init-modal-close"
          type="button"
          @click="flow.closeWizard"
          aria-label="Close"
          title="Close — reopens on reload until you choose a workflow or finish setup"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>

      <ol class="init-stepper" aria-label="Setup steps">
        <li v-for="(step, i) in stepperLabels" :key="step.id"
            class="init-stepper-item"
            :class="{ active: flow.wizardStep.value === step.id, done: doneSteps.has(step.id), clickable: canJumpTo(step.id) }">
          <button
            type="button"
            class="init-stepper-btn"
            :disabled="!canJumpTo(step.id)"
            :aria-current="flow.wizardStep.value === step.id ? 'step' : undefined"
            @click="jumpToStep(step.id)"
          >
            <span class="init-stepper-num">{{ i + 1 }}</span>
            <span class="init-stepper-label">{{ step.label }}</span>
          </button>
        </li>
      </ol>

      <div class="init-wizard-body">
      <!-- Step 0: pick workflow (skill/MCP vs embedded agent) -->
      <section v-if="flow.wizardStep.value === 'mode'" class="init-step" aria-label="Choose Annotask workflow">
        <h2 class="init-step-title">How do you want to apply design changes?</h2>
        <p class="init-step-lead">
          Annotask annotates the UI in the browser; the code edits can come from
          your own editor agent or from an agent running inside Annotask itself.
          Pick whichever fits — you can switch later from <strong>Settings → General</strong>.
        </p>

        <div class="init-mode-choices" role="radiogroup" aria-label="Workflow">
          <button
            type="button"
            role="radio"
            class="init-mode-choice"
            :class="{ selected: selectedMode === 'skill' }"
            :aria-checked="selectedMode === 'skill'"
            @click="selectedMode = 'skill'"
          >
            <div class="init-mode-body">
              <div class="init-mode-head">
                <span class="init-mode-title">Use my editor agent</span>
                <span class="init-mode-badge init-mode-badge-stable">Recommended</span>
              </div>
              <p class="init-mode-blurb">
                Annotate here; drive init and apply from your own editor agent
                (Claude Code, Cursor, Windsurf, …). Annotask installs two skills
                — <code>/annotask-init</code> and <code>/annotask-apply</code> —
                and exposes an MCP server at
                <code>http://localhost:5173/__annotask/mcp</code>. No in-shell
                chat, no spawned subprocesses.
              </p>
              <ul class="init-mode-bullets">
                <li>You stay in your editor; Annotask is read-only on the agent side.</li>
                <li>Tasks land in <code>.annotask/</code> for your agent to pick up.</li>
                <li>Works with any editor agent that supports MCP or slash skills.</li>
              </ul>
            </div>
          </button>

          <button
            type="button"
            role="radio"
            class="init-mode-choice"
            :class="{ selected: selectedMode === 'embedded' }"
            :aria-checked="selectedMode === 'embedded'"
            @click="selectedMode = 'embedded'"
          >
            <div class="init-mode-body">
              <div class="init-mode-head">
                <span class="init-mode-title">Run an agent inside Annotask</span>
                <span class="init-mode-badge init-mode-badge-experimental">Experimental</span>
              </div>
              <p class="init-mode-blurb">
                Spawn a local CLI agent (claude · codex · opencode · copilot)
                directly from the Annotask sidebar. Tasks stream live to a
                Conversation tab and auto-run on creation. One-window
                experience; great when you don't already have an editor agent
                set up.
              </p>
              <ul class="init-mode-bullets">
                <li>In-shell Conversation tab with live tool-call streaming.</li>
                <li>Auto-run on task creation (configurable in Settings).</li>
                <li>Requires at least one supported CLI installed locally.</li>
              </ul>
              <p class="init-mode-warning">
                <strong>Heads up:</strong> the CLIs run headlessly inside the
                shell, so they need <strong>bypass</strong> permission mode
                (claude's <code>--dangerously-skip-permissions</code>, codex's
                <code>--full-auto</code>, etc.) — there's no interactive
                prompt to approve tool calls. Pick the editor-agent option
                if you'd rather review each action in your own terminal.
              </p>
            </div>
          </button>
        </div>

        <div class="init-step-actions">
          <button
            class="init-btn-primary"
            type="button"
            :disabled="selectedMode === null"
            @click="confirmModeChoice"
          >
            Continue →
          </button>
        </div>
      </section>

      <!-- Step 1: select init agent -->
      <section v-else-if="flow.wizardStep.value === 'agent'" class="init-step" aria-label="Select an init agent">
        <h2 class="init-step-title">Select an init agent</h2>
        <p class="init-step-lead">
          The <strong>init agent</strong> runs once to set up Annotask for this
          project. It reads your codebase and writes the design and agent
          configuration that the per-task agents will use later.
        </p>

        <ul class="init-agent-duties">
          <li>
            <strong>Detect framework &amp; styling.</strong>
            Reads <code>package.json</code> and config files to identify Vue / React / Svelte /
            Solid / Astro and the CSS approach (Tailwind, CSS variables, SCSS, scoped CSS, …).
          </li>
          <li>
            <strong>Extract design tokens.</strong>
            Walks your CSS, Tailwind config, and theme files to pull out the colors,
            typography scale, spacing, and border radii your app actually uses —
            written to <code>.annotask/design-spec.json</code>.
          </li>
          <li>
            <strong>Write a style guide.</strong>
            Captures the conventions in your code (naming, structure, accessibility patterns,
            error / loading conventions) as a human-readable <code>STYLE_GUIDE.md</code> the
            per-task agents read before making changes.
          </li>
          <li>
            <strong>Configure per-task agents.</strong>
            Writes <code>.annotask/agents.json</code> with project-specific directions for each
            task-type agent (style fixes, a11y, errors, performance, API changes). You can
            edit these later in Settings → Agents.
          </li>
        </ul>

        <p class="init-step-note">
          Pick whichever provider you'd like for this one-time setup. Local CLIs
          (Claude Code, Codex, opencode) reuse your existing login; cloud providers
          need an API key. The per-task agents are seeded to use the same local
          provider as the init agent, and you can change them later in Settings.
        </p>

        <AgentQuickSetup :hide-plan-mode="true" :hide-permission-mode="true" />
        <div class="init-step-actions">
          <button class="init-btn-primary" :disabled="!flow.hasConfiguredProvider.value" @click="advanceFromAgent">
            Continue →
          </button>
        </div>

        <p class="init-alt">
          Alternatively, open your editor agent (Claude Code, Cursor, Windsurf, …) and run:
        </p>
        <pre class="init-cmd"><code>/annotask-init</code></pre>
      </section>

      <!-- Step 2: scan project -->
      <section v-else-if="flow.wizardStep.value === 'scan'" class="init-step" aria-label="Scanning project">
        <h2 class="init-step-title">
          {{ flow.rescanMode.value ? 'Re-scan your project' : 'Scanning your project' }}
          <span v-if="initWorking.verb.value" class="init-working" aria-live="polite">
            <span class="init-working-dot" />
            <span class="init-working-verb" :key="initWorking.verb.value">
              {{ initWorking.verb.value }}<span class="init-working-dots" aria-hidden="true" />
            </span>
            <span class="init-working-elapsed">{{ initWorking.seconds.value }}s</span>
          </span>
        </h2>
        <p class="init-step-lead">
          <template v-if="flow.rescanMode.value">
            Pick which scanners to re-run. Anything you leave unchecked stays as it
            is on disk — re-scanning replaces only the targets you select.
          </template>
          <template v-else>
            Your AI scans <code>package.json</code>, CSS files, and Tailwind config to
            extract design tokens, write a style guide, and configure a dedicated agent
            for each task type. Review and edit everything before saving.
          </template>
        </p>

        <div v-if="flow.initState.value.steps.length === 0 && !flow.rescanMode.value" class="init-empty">
          Click <strong>Start</strong> to begin.
        </div>

        <template v-if="flow.initState.value.steps.length > 0">
          <!-- First-run progress list. In rescan mode the status indicators
               are folded into the toggle list below, so we hide this. -->
          <ul v-if="!flow.rescanMode.value" class="init-progress-list" aria-live="polite">
            <li v-for="s in flow.initState.value.steps" :key="s.id" class="init-progress-row" :class="s.status">
              <span class="init-progress-marker" :class="s.status" aria-hidden="true">
                <span v-if="s.status === 'success'">✓</span>
                <span v-else-if="s.status === 'error'">✕</span>
                <span v-else-if="s.status === 'running'" class="init-spinner" />
              </span>
              <span class="init-progress-label">{{ s.label }}</span>
              <span v-if="s.message" class="init-progress-message">{{ s.message }}</span>
            </li>
          </ul>

          <!-- Agent streaming output — only shows when the agent step is running/done -->
          <div
            v-if="agentLines.length > 0"
            class="init-agent-log"
            ref="agentLogRef"
            aria-live="polite"
            aria-label="Agent output">
            <div class="init-agent-log-header">
              <Icon name="bot" :size="12" />
              <span>Agent output</span>
            </div>
            <div class="init-agent-log-body">
              <p v-for="(line, i) in agentLines" :key="i" class="init-agent-line">{{ line }}</p>
            </div>
          </div>

          <!-- Live token usage tally for the agent CLI calls. Show as soon as
               the run starts (turns = 0) so the user sees the counter exists
               and watches it accumulate. -->
          <div
            v-if="flow.initState.value.running || (initTokenUsage && initTokenUsage.turns > 0)"
            class="init-token-usage"
            data-testid="init-token-usage"
            aria-label="Token usage so far"
          >
            <span class="init-token-pill" title="Input tokens">↑ {{ formatTokens(initTokenUsage?.inputTokens ?? 0) }}</span>
            <span class="init-token-pill" title="Output tokens">↓ {{ formatTokens(initTokenUsage?.outputTokens ?? 0) }}</span>
            <span
              v-if="initTokenUsage && (initTokenUsage.cacheReadTokens > 0 || initTokenUsage.cacheCreationTokens > 0)"
              class="init-token-pill init-token-pill-cache"
              :title="`Cache read ${initTokenUsage.cacheReadTokens.toLocaleString()} · write ${initTokenUsage.cacheCreationTokens.toLocaleString()}`"
            >
              ⧉ {{ formatTokens(initTokenUsage.cacheReadTokens + initTokenUsage.cacheCreationTokens) }}
            </span>
            <span class="init-token-meta">
              {{ initTokenUsage?.turns ?? 0 }} agent call{{ (initTokenUsage?.turns ?? 0) === 1 ? '' : 's' }}
            </span>
          </div>
        </template>

        <!-- Rescan: same visual as the first-run progress list, but the
             circle marker is clickable and acts as the per-step toggle. -->
        <ul
          v-if="flow.rescanMode.value"
          class="init-progress-list init-progress-list-rescan"
          aria-label="Scanners to re-run"
        >
          <li
            v-for="opt in SCAN_OPTIONS"
            :key="opt.key"
            class="init-progress-row"
            :class="[liveScanStatus(opt.stepId), { selected: !scanOpts[opt.key] }]"
          >
            <button
              type="button"
              class="init-progress-marker init-progress-marker-toggle"
              :class="[liveScanStatus(opt.stepId), { selected: !scanOpts[opt.key] }]"
              :disabled="flow.initState.value.running"
              :aria-pressed="!scanOpts[opt.key]"
              :aria-label="`${!scanOpts[opt.key] ? 'Skip' : 'Include'} ${opt.label}`"
              @click="scanOpts[opt.key] = !scanOpts[opt.key]"
            >
              <span v-if="liveScanStatus(opt.stepId) === 'success'">✓</span>
              <span v-else-if="liveScanStatus(opt.stepId) === 'error'">✕</span>
              <span v-else-if="liveScanStatus(opt.stepId) === 'running'" class="init-spinner" />
              <span v-else-if="!scanOpts[opt.key]" class="init-marker-dot" aria-hidden="true" />
            </button>
            <span class="init-progress-label">
              {{ opt.label }}
              <span v-if="opt.hint" class="init-progress-hint" v-html="opt.hint" />
            </span>
            <span class="init-progress-when">{{ scanTargetLabel(opt.targetId) }}</span>
          </li>
        </ul>

        <!-- First-run scan options — kept as a collapsed details summary -->
        <div
          v-if="!flow.rescanMode.value && !flow.initState.value.running && flow.initState.value.result !== 'awaiting_review'"
          class="init-scan-opts"
        >
          <details class="init-scan-opts-inner">
            <summary>Scan options</summary>
            <ul class="init-scan-opt-list">
              <li v-for="opt in SCAN_OPTIONS" :key="opt.key">
                <label class="init-scan-opt">
                  <input type="checkbox" :checked="!scanOpts[opt.key]"
                    @change="scanOpts[opt.key] = !($event.target as HTMLInputElement).checked" />
                  <span class="init-scan-opt-main">
                    <span>{{ opt.label }}</span>
                    <span v-if="opt.hint" class="init-scan-opt-hint" v-html="opt.hint" />
                  </span>
                </label>
              </li>
            </ul>
          </details>
        </div>

        <div class="init-step-actions">
          <!-- First-run: Start / Retry. Hidden once the scan reaches review
               (success or awaiting_review) so the Review → button takes over. -->
          <button v-if="!flow.rescanMode.value
                          && !flow.initState.value.running
                          && flow.initState.value.result !== 'awaiting_review'
                          && flow.initState.value.result !== 'success'"
                  class="init-btn-primary"
                  @click="() => flow.startRun(scanOpts)">
            {{ flow.initState.value.result ? 'Retry' : 'Start' }}
          </button>
          <!-- Rescan: always exposed (even after a prior successful run) so
               the user can re-run selected scanners. Disabled when nothing
               is selected. -->
          <button v-if="flow.rescanMode.value && !flow.initState.value.running"
                  class="init-btn-primary"
                  :disabled="!hasSelectedScan"
                  @click="() => flow.startRun(scanOpts)">
            Run selected scans
          </button>
          <button v-if="flow.initState.value.running" class="init-btn-secondary" @click="flow.cancelRun">
            Cancel
          </button>
          <button v-if="flow.initState.value.result === 'awaiting_review'
                        || flow.initState.value.result === 'success'"
                  class="init-btn-secondary" @click="goToReviewFromScan">
            Review →
          </button>
        </div>

        <p v-if="flow.initState.value.error" class="init-error">
          {{ flow.initState.value.error }}
        </p>
      </section>

      <!-- Step 3: review — sub-stepped -->
      <section v-else class="init-step init-step-review" aria-label="Review draft">
        <!-- Sub-step progress dots -->
        <nav class="review-subnav" aria-label="Review sub-steps">
          <button
            v-for="(rs, i) in REVIEW_SUBSTEPS"
            :key="rs.id"
            type="button"
            class="review-subnav-item"
            :class="{ active: reviewSubStep === i, done: i < reviewSubStep }"
            @click="reviewSubStep = i"
            :aria-current="reviewSubStep === i ? 'step' : undefined">
            <span class="review-subnav-dot" aria-hidden="true" />
            <span class="review-subnav-label">{{ rs.label }}</span>
          </button>
        </nav>

        <!-- ── Sub-step 0: Framework ── -->
        <div v-if="reviewSubStep === 0" class="review-panel">
          <div class="review-panel-header">
            <span class="review-panel-icon"><Icon name="settings" :size="20" /></span>
            <div>
              <h3 class="review-panel-title">Framework</h3>
              <p class="review-panel-desc">Confirm what Annotask detected from <code>package.json</code>.</p>
            </div>
          </div>
          <div class="init-grid">
            <label class="init-field">
              <span>Name</span>
              <input type="text" :value="framework.name ?? ''" @input="updateFw('name', ($event.target as HTMLInputElement).value)" />
            </label>
            <label class="init-field">
              <span>Version</span>
              <input type="text" :value="framework.version ?? ''" @input="updateFw('version', ($event.target as HTMLInputElement).value)" />
            </label>
            <label class="init-field init-field-full">
              <span>Styling approach (comma-separated)</span>
              <input type="text" :value="(framework.styling ?? []).join(', ')"
                     @input="updateFwStyling(($event.target as HTMLInputElement).value)" />
            </label>
          </div>
        </div>

        <!-- ── Sub-step 1: Themes & Tokens ── -->
        <div v-else-if="reviewSubStep === 1" class="review-panel review-panel-tokens">
          <div class="review-panel-header">
            <span class="review-panel-icon"><Icon name="palette" :size="20" /></span>
            <div>
              <h3 class="review-panel-title">Themes & Tokens</h3>
              <p class="review-panel-desc">Exact same editor as the Design → Tokens tab. Theme variants at the top; Colors / Type / Spacing / Borders below.</p>
            </div>
          </div>
          <DesignTokenEditor
            :spec="flow.draftSpec.value as Record<string, any>"
            :local-only="true"
            @update:spec="flow.draftSpec.value = $event"
            class="init-token-editor"
          />
        </div>

        <!-- ── Sub-step 2: Components ── -->
        <div v-else-if="reviewSubStep === 2" class="review-panel">
          <div class="review-panel-header">
            <span class="review-panel-icon"><Icon name="package" :size="20" /></span>
            <div>
              <h3 class="review-panel-title">Component library</h3>
              <p class="review-panel-desc">The primary UI component library for this project. Agents use this when inserting or editing components.</p>
            </div>
          </div>
          <div v-if="components?.library" class="init-token-row" style="margin-bottom:8px">
            <div class="init-token-info">
              <span class="init-token-role">{{ components.library }}</span>
              <code v-if="components.version" class="init-token-source">{{ components.version }}</code>
            </div>
            <span class="init-token-badge">detected</span>
          </div>
          <p v-else class="init-empty-small" style="margin-bottom:8px">No component library matched the detected framework.</p>
          <p class="init-section-hint">
            Component usage (which components are actually imported) is tracked live at runtime. Open <strong>Design → Components</strong> after the shell loads to see the full usage index.
          </p>
        </div>

        <!-- ── Sub-step 3: APIs & Data ── -->
        <div v-else-if="reviewSubStep === 3" class="review-panel">
          <div class="review-panel-header">
            <span class="review-panel-icon"><Icon name="database" :size="20" /></span>
            <div>
              <h3 class="review-panel-title">APIs & Data sources</h3>
              <p class="review-panel-desc">Review what the scanner found — remove noise, add anything it missed. Agents use this to pick the right hooks and endpoints.</p>
            </div>
          </div>

          <!-- Sub-tabs -->
          <div class="panel-tabs">
            <button class="panel-tab" :class="{ active: apisTab === 'schemas' }" @click="apisTab = 'schemas'">
              API schemas <span class="panel-tab-count">{{ apiSchemas.length }}</span>
            </button>
            <button class="panel-tab" :class="{ active: apisTab === 'sources' }" @click="apisTab = 'sources'">
              Data sources <span class="panel-tab-count">{{ dsEntries.length }}</span>
            </button>
          </div>

          <!-- Tab: Data sources -->
          <template v-if="apisTab === 'sources'">
            <p class="init-section-hint" v-if="dsLibraries.length > 0">
              Detected libraries:
              <span v-for="lib in dsLibraries" :key="lib" class="init-lib-badge">{{ lib }}</span>
            </p>
            <ul v-if="dsEntries.length > 0" class="init-data-list">
              <li v-for="(e, i) in dsEntries" :key="i" class="init-data-row">
                <span class="init-data-kind">{{ e.kind }}</span>
                <span class="init-data-name">{{ e.name }}</span>
                <button class="init-data-remove" @click="removeDataEntry(i)" aria-label="Remove">×</button>
              </li>
            </ul>
            <p v-else class="init-empty-small">No project data sources detected.</p>
            <div class="init-data-add">
              <input v-model="newDsName" type="text" placeholder="hook or store name (e.g. useProducts)" @keydown.enter.prevent="addDataEntry" />
              <select v-model="newDsKind">
                <option value="composable">composable</option>
                <option value="store">store</option>
                <option value="fetch">fetch</option>
                <option value="graphql">graphql</option>
                <option value="rpc">rpc</option>
              </select>
              <button class="init-btn-secondary" @click="addDataEntry" :disabled="!newDsName.trim()">+ Add</button>
            </div>
          </template>

          <!-- Tab: API schemas -->
          <template v-else>
            <ul v-if="apiSchemas.length > 0" class="init-data-list">
              <li v-for="(s, i) in apiSchemas" :key="i" class="init-data-row">
                <span class="init-data-kind">{{ s.kind }}</span>
                <span class="init-data-name">{{ s.location }}</span>
                <button class="init-data-remove" @click="removeSchema(i)" aria-label="Remove">×</button>
              </li>
            </ul>
            <p v-else class="init-empty-small">No API schemas detected.</p>
            <div class="init-data-add">
              <input v-model="newSchemaLoc" type="text" placeholder="path or URL (e.g. /openapi.json)" @keydown.enter.prevent="addSchema" />
              <select v-model="newSchemaKind">
                <option value="openapi">openapi</option>
                <option value="graphql">graphql</option>
                <option value="trpc">trpc</option>
                <option value="jsonschema">jsonschema</option>
              </select>
              <button class="init-btn-secondary" @click="addSchema" :disabled="!newSchemaLoc.trim()">+ Add</button>
            </div>
          </template>
        </div>

        <!-- ── Sub-step 5: Agent directions ── -->
        <div v-else-if="reviewSubStep === 5" class="review-panel review-panel-agents">
          <div class="review-panel-header">
            <span class="review-panel-icon"><Icon name="bot" :size="20" /></span>
            <div>
              <h3 class="review-panel-title">Agent directions</h3>
              <p class="review-panel-desc">
                Project-specific context your AI reads before applying each task type.
                Written by the init agent — click any agent to view or edit its directions.
              </p>
            </div>
          </div>

          <!-- Global default permission mode for per-task agents. The
               wizard intentionally omits "Default" — annotask runs every
               CLI headless (`--print` / `exec` / `run` / `-p`), so there
               is no human to answer "may I write this file?" prompts and
               default mode results in silent denial of every Edit/Bash
               call. Bypass (write) and Plan (read-only) are the only two
               modes that actually do anything in this pipeline. -->
          <div class="init-perm-row">
            <label class="init-perm-label">
              <span class="init-perm-label-title">Default permission mode</span>
              <span class="init-perm-label-hint">How per-task agents approve actions after init. Override per persona or per task later.</span>
            </label>
            <select
              class="init-perm-select"
              data-testid="init-permission-mode"
              :value="globalPermissionMode"
              @change="setGlobalPermissionMode(($event.target as HTMLSelectElement).value)"
            >
              <option v-for="m in INIT_PERMISSION_MODE_OPTIONS" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </div>
          <p class="init-perm-note">
            Note: per-task agents run headlessly — there's no human to answer
            permission prompts. Only <strong>Bypass</strong> (writes allowed)
            and <strong>Plan</strong> (read-only) actually do anything; a
            "Default" mode would deny every Edit and Bash call silently. The
            initial scan separately always runs in its CLI's least-permissive
            headless mode and writes inside <code>.annotask/</code> only.
          </p>

          <AgentDirectionsPanel class="init-adp" />
        </div>

        <!-- ── Sub-step 4: Style guide ── -->
        <div v-else class="review-panel">
          <div class="review-panel-header">
            <span class="review-panel-icon"><Icon name="file-search" :size="20" /></span>
            <div>
              <h3 class="review-panel-title">Style guide</h3>
              <p class="review-panel-desc">Agents read <code>.annotask/STYLE_GUIDE.md</code> before every task. The agent wrote a draft — review it here, or load an existing file from your project.</p>
            </div>
          </div>

          <!-- File override row -->
          <div class="init-guide-file-row">
            <label class="init-guide-file-label">Load from file</label>
            <div class="init-guide-file-input-row">
              <input
                v-model="styleGuideFilePath"
                type="text"
                class="init-guide-file-input"
                placeholder="e.g. docs/CONTRIBUTING.md or .cursor/rules"
                @keydown.enter.prevent="loadStyleGuideFile"
              />
              <button
                class="init-btn-secondary"
                :disabled="!styleGuideFilePath.trim() || styleGuideFileLoading"
                @click="loadStyleGuideFile"
              >{{ styleGuideFileLoading ? 'Loading…' : 'Load' }}</button>
            </div>
            <p v-if="styleGuideFileError" class="init-guide-file-error">{{ styleGuideFileError }}</p>
          </div>

          <!-- Preview / Edit toggle -->
          <div class="init-guide-toolbar">
            <div class="init-guide-toggle" role="group" aria-label="Editor mode">
              <button :class="['init-guide-mode', { active: guideMode === 'preview' }]" @click="guideMode = 'preview'">
                <Icon name="scan-search" :size="12" /> Preview
              </button>
              <button :class="['init-guide-mode', { active: guideMode === 'edit' }]" @click="guideMode = 'edit'">
                <Icon name="pencil" :size="12" /> Edit
              </button>
            </div>
          </div>

          <!-- Rendered markdown preview -->
          <div
            v-if="guideMode === 'preview'"
            class="init-style-preview markdown-body"
            v-html="renderedGuide || emptyGuideHtml"
          />

          <MarkdownEditor
            v-else
            :model-value="flow.draftStyleGuide.value"
            @update:model-value="flow.setStyleGuide($event)"
            class="init-style-guide"
            aria-label="Style guide markdown"
            show-line-numbers
            placeholder="# Project style guide&#10;&#10;## Naming conventions&#10;&#10;## Component patterns&#10;&#10;## Things to avoid"
          />

          <label v-if="draft?.styleGuideExists" class="init-overwrite-toggle" style="margin-top:8px">
            <input type="checkbox" :checked="flow.overwriteStyleGuide.value"
                   @change="flow.setOverwriteStyleGuide(($event.target as HTMLInputElement).checked)" />
            <span>Overwrite existing <code>.annotask/STYLE_GUIDE.md</code> on save</span>
          </label>
        </div>

        <!-- Navigation -->
        <div class="review-nav">
          <button v-if="reviewSubStep > 0" class="init-btn-secondary" @click="reviewSubStep--">← Back</button>
          <div class="review-nav-right">
            <button v-if="reviewSubStep < REVIEW_SUBSTEPS.length - 1"
                    class="init-btn-primary" @click="reviewSubStep++">
              Next →
            </button>
            <template v-else>
              <button class="init-skip-btn" @click="flow.skipInit" style="margin-right:auto">
                Use skill instead
              </button>
              <button class="init-btn-secondary" :disabled="saving" @click="onRetry">Re-scan</button>
              <button class="init-btn-primary" :disabled="saving" @click="onSave">
                {{ saving ? 'Saving…' : 'Accept & Save' }}
              </button>
            </template>
          </div>
        </div>

        <p v-if="flow.initState.value.committedAt" class="init-success">
          ✓ Saved — wizard will close.
        </p>
        <p v-if="flow.initState.value.error && flow.initState.value.result === 'error'" class="init-error">
          {{ flow.initState.value.error }}
        </p>
      </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import AgentQuickSetup from './AgentQuickSetup.vue'
import AgentDirectionsPanel from './AgentDirectionsPanel.vue'
import DesignTokenEditor from './DesignTokenEditor.vue'
import MarkdownEditor from './MarkdownEditor.vue'
import Icon from './Icon.vue'
import { useInitFlow } from '../composables/useInitFlow'
import { useWorkingIndicator } from '../composables/useWorkingIndicator'
import { useAgentConfigs } from '../composables/useAgentConfigs'
import { useProviderSettings } from '../composables/useProviderSettings'
import { BUILT_IN_PERSONAS } from '../../embedded/persona'
import { PERMISSION_MODES, type PermissionMode } from '../../schema'
import { marked } from 'marked'

const flow = useInitFlow()
const initRunning = computed(() => flow.initState.value.running)
const initWorking = useWorkingIndicator(initRunning)
const agentConfigs = useAgentConfigs()
const providerSettings = useProviderSettings()
const saving = ref(false)

// Permission-mode picker shown in the Agent directions sub-step. `'default'`
// is the safe "Auto" default: each CLI runs the least-permissive mode that
// still applies tasks headlessly (codex/copilot sandboxed/minimal; claude/
// opencode escalate to bypass via normalizeHeadlessMode). `'bypass'` (all
// sandboxes off) is the explicit opt-in.
const INIT_PERMISSION_MODE_OPTIONS: ReadonlyArray<{ id: PermissionMode; label: string }> = [
  { id: 'default', label: 'Auto — safe per-CLI default (recommended)' },
  { id: 'plan',    label: 'Plan — read-only' },
  { id: 'bypass',  label: 'Bypass — auto-approve everything, all sandboxes off' },
]
const globalPermissionMode = computed<PermissionMode>(() => providerSettings.settings.value.permissionMode)
function setGlobalPermissionMode(value: string) {
  if (!(PERMISSION_MODES as readonly string[]).includes(value)) return
  providerSettings.setPermissionMode(value as PermissionMode)
}

// Agent directions review state
const agentDraftDirections = ref<Record<string, string>>({})
const agentDirSaving = ref<Record<string, boolean>>({})

// Hydrate local draft whenever configs arrive from the server
watch(
  agentConfigs.configs,
  (configs) => {
    for (const p of BUILT_IN_PERSONAS) {
      agentDraftDirections.value[p.id] = configs[p.id]?.projectDirections ?? ''
    }
  },
  { immediate: true, deep: true },
)

async function saveAgentDirection(personaId: string) {
  agentDirSaving.value[personaId] = true
  await agentConfigs.save(personaId, { projectDirections: agentDraftDirections.value[personaId] ?? '' })
  agentDirSaving.value[personaId] = false
}
const agentLogRef = ref<HTMLElement | null>(null)
// Default to preview; reset to edit only when a new scan result arrives
const guideMode = ref<'edit' | 'preview'>('preview')
watch(() => flow.draftStyleGuide.value, () => { guideMode.value = 'preview' }, { once: false })

// Style-guide file override
const styleGuideFilePath = ref('')
const styleGuideFileLoading = ref(false)
const styleGuideFileError = ref('')

const emptyGuideHtml = '<p style="opacity:0.5;font-style:italic">Nothing to preview yet.</p>'

async function loadStyleGuideFile() {
  const p = styleGuideFilePath.value.trim()
  if (!p) return
  styleGuideFileLoading.value = true
  styleGuideFileError.value = ''
  try {
    const res = await fetch(`/__annotask/api/read-file?path=${encodeURIComponent(p)}`)
    if (!res.ok) {
      const err = await res.json().catch(() => null)
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
    }
    const data = await res.json()
    flow.setStyleGuide(data.content ?? '')
    flow.setOverwriteStyleGuide(true)
    guideMode.value = 'preview'
  } catch (e) {
    styleGuideFileError.value = (e as Error).message
  } finally {
    styleGuideFileLoading.value = false
  }
}

// Scan options — which optional steps to run.
// Defaults differ by mode:
//   - first-run init: everything ON (skip flags false) so the full pipeline runs
//   - re-scan mode: everything OFF (skip flags true) so the user explicitly opts in
import type { ScanOptions } from '../composables/useInitFlow'
const scanOpts = ref<ScanOptions>({
  skipAgentScan: false,
  skipAgentConfigs: false,
  skipComponents: false,
  skipDataSources: false,
  skipApiSchemas: false,
})

// Reset toggles whenever the wizard enters the scan step. In re-scan mode
// default to "skip everything" so the user opts into the specific scanners
// they want to re-run.
watch(
  () => [flow.wizardStep.value, flow.rescanMode.value] as const,
  ([step, rescan]) => {
    if (step !== 'scan') return
    scanOpts.value = rescan
      ? { skipAgentScan: true, skipAgentConfigs: true, skipComponents: true, skipDataSources: true, skipApiSchemas: true }
      : { skipAgentScan: false, skipAgentConfigs: false, skipComponents: false, skipDataSources: false, skipApiSchemas: false }
    if (rescan) fetchScanTargets()
  },
  { immediate: true },
)

// True when at least one scanner is selected to run — drives Start-button
// enablement in re-scan mode.
const hasSelectedScan = computed(() => {
  const o = scanOpts.value
  return !(o.skipAgentScan && o.skipAgentConfigs && o.skipComponents && o.skipDataSources && o.skipApiSchemas)
})

// Single source of truth for the scanner list — drives both the toggleable
// checklist and (in rescan mode) the per-row status + timestamp indicators.
// `stepId` matches the IDs emitted by the server-side init runner.
type ScanOptionKey =
  | 'skipAgentScan'
  | 'skipAgentConfigs'
  | 'skipComponents'
  | 'skipDataSources'
  | 'skipApiSchemas'

const SCAN_OPTIONS: Array<{
  key: ScanOptionKey
  stepId: string
  targetId: string
  label: string
  hint?: string
}> = [
  {
    key: 'skipAgentScan',
    stepId: 'agent-scan',
    targetId: 'designSpec',
    label: 'Scan design tokens & style guide',
    hint: 'Runs the LLM scan that produces <code>design-spec.json</code> and <code>STYLE_GUIDE.md</code>',
  },
  {
    key: 'skipAgentConfigs',
    stepId: 'agent-configs',
    targetId: 'agentConfigs',
    label: 'Write agent directions',
    hint: 'Configures AI personas for each task type',
  },
  { key: 'skipComponents',  stepId: 'components',   targetId: 'designSpec', label: 'Scan component library' },
  { key: 'skipDataSources', stepId: 'data-sources', targetId: 'designSpec', label: 'Scan data sources' },
  { key: 'skipApiSchemas',  stepId: 'api-schemas',  targetId: 'designSpec', label: 'Scan API schemas' },
]

// Status of a given scanner in the *current* init run, if any. Used to fold
// the prior-run progress indicators into the toggle list in rescan mode.
function scanRowStatus(stepId: string): '' | 'pending' | 'running' | 'success' | 'error' | 'skipped' {
  const step = flow.initState.value.steps.find((s) => s.id === stepId)
  return step?.status ?? ''
}

// Marker status for the rescan toggle list. Suppresses stale ✓ / ✕ marks
// from prior runs so the selection screen looks fresh when the user
// reopens the wizard; status only surfaces while a rescan is in flight.
function liveScanStatus(stepId: string): ReturnType<typeof scanRowStatus> {
  if (!flow.initState.value.running) return ''
  return scanRowStatus(stepId)
}

// Per-target presence + mtime metadata for the re-scan UI. Fetched lazily
// when the user lands on the scan step in rescan mode.
const scanTargets = ref<Record<string, { exists: boolean; mtime: number | null }>>({})
async function fetchScanTargets() {
  try {
    const res = await fetch('/__annotask/api/init/scan-targets')
    if (res.ok) scanTargets.value = await res.json()
  } catch { /* offline — leave empty */ }
}

function scanTargetLabel(id: string): string {
  const t = scanTargets.value[id]
  if (!t || !t.exists || !t.mtime) return 'Not yet scanned'
  const ms = Date.now() - t.mtime
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'Scanned just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `Scanned ${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `Scanned ${hr}h ago`
  const day = Math.floor(hr / 24)
  return `Scanned ${day}d ago`
}

const renderedGuide = computed(() => {
  const md = flow.draftStyleGuide.value?.trim()
  if (!md) return '<p style="opacity:0.5;font-style:italic">Nothing to preview yet.</p>'
  try {
    return marked.parse(md, { async: false, gfm: true, breaks: false }) as string
  } catch {
    return `<pre>${md}</pre>`
  }
})

// Keep agent log scrolled to bottom as new lines arrive
const agentLines = computed(() => flow.initState.value.agentLines ?? [])
const initTokenUsage = computed(() => flow.initState.value.tokenUsage ?? null)

function formatTokens(n: number): string {
  if (n < 1000) return n.toString()
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 2 : 1)}M`
}
watch(agentLines, () => {
  nextTick(() => {
    if (agentLogRef.value) agentLogRef.value.scrollTop = agentLogRef.value.scrollHeight
  })
})

// Sub-step state for the Review step — resets whenever the user re-enters Review.
const reviewSubStep = ref(0)
watch(() => flow.wizardStep.value, (step) => { if (step === 'review') reviewSubStep.value = 0 })

const REVIEW_SUBSTEPS = [
  { id: 'framework',        label: 'Framework' },
  { id: 'themes-tokens',    label: 'Themes & Tokens' },
  { id: 'components',       label: 'Components' },
  { id: 'apis-data',        label: 'APIs & Data' },
  { id: 'style-guide',      label: 'Style guide' },
  { id: 'agent-directions', label: 'Agent directions' },
] as const

// Panel-level sub-tabs
const themesTab = ref<'themes' | 'colors' | 'typography' | 'spacing'>('themes')
const apisTab   = ref<'sources' | 'schemas'>('schemas')

// ── APIs & Data tab state ─────────────────────────────────
interface DsEntry { name: string; kind: string; used_count?: number }
interface SchemaEntry { kind: string; location: string }

const dsLibraries = ref<string[]>([])
const dsEntries   = ref<DsEntry[]>([])
const apiSchemas  = ref<SchemaEntry[]>([])
const newDsName   = ref('')
const newDsKind   = ref('composable')
const newSchemaLoc  = ref('')
const newSchemaKind = ref('openapi')
let apisDataLoaded = false

async function loadApisData() {
  if (apisDataLoaded) return
  apisDataLoaded = true
  try {
    const [dsRes, schRes] = await Promise.all([
      fetch('/__annotask/api/data-sources').then(r => r.ok ? r.json() : null),
      fetch('/__annotask/api/api-schemas').then(r => r.ok ? r.json() : null),
    ])
    if (dsRes) {
      dsLibraries.value = (dsRes.libraries ?? []).map((l: any) => l.name).slice(0, 8)
      dsEntries.value = (dsRes.project_entries ?? []).map((e: any) => ({ name: e.name, kind: e.kind, used_count: e.used_count }))
    }
    if (schRes) {
      apiSchemas.value = (schRes.schemas ?? []).map((s: any) => ({ kind: s.kind, location: s.location }))
    }
    // Mirror into draftSpec so they serialize on commit
    syncDataToDraft()
  } catch { /* offline */ }
}

watch(() => reviewSubStep.value, (step) => {
  if (step === 3) loadApisData()
  if (step === 5) agentConfigs.refresh()
})

function syncDataToDraft() {
  flow.draftSpec.value = {
    ...flow.draftSpec.value,
    dataSources: dsEntries.value,
    apiSchemas: apiSchemas.value,
  }
}

function removeDataEntry(i: number) {
  dsEntries.value = dsEntries.value.filter((_, idx) => idx !== i)
  syncDataToDraft()
}
function addDataEntry() {
  const name = newDsName.value.trim()
  if (!name) return
  dsEntries.value = [...dsEntries.value, { name, kind: newDsKind.value }]
  newDsName.value = ''
  syncDataToDraft()
}
function removeSchema(i: number) {
  apiSchemas.value = apiSchemas.value.filter((_, idx) => idx !== i)
  syncDataToDraft()
}
function addSchema() {
  const location = newSchemaLoc.value.trim()
  if (!location) return
  apiSchemas.value = [...apiSchemas.value, { kind: newSchemaKind.value, location }]
  newSchemaLoc.value = ''
  syncDataToDraft()
}

// ── Token data from real draft ────────────────────────────
const colorTokens = computed(() => {
  const raw = (flow.draftSpec.value as any).colors
  return Array.isArray(raw) ? raw as Array<Record<string, any>> : []
})
const typographyFamilies = computed(() => {
  const t = (flow.draftSpec.value as any).typography
  return Array.isArray(t?.families) ? t.families as Array<Record<string, any>> : []
})
const typographyScale = computed(() => {
  const t = (flow.draftSpec.value as any).typography
  return Array.isArray(t?.scale) ? t.scale as Array<Record<string, any>> : []
})
const spacingTokens = computed(() => {
  const raw = (flow.draftSpec.value as any).spacing
  return Array.isArray(raw) ? raw as Array<Record<string, any>> : []
})
const borderTokens = computed(() => {
  const b = (flow.draftSpec.value as any).borders
  return Array.isArray(b?.radius) ? b.radius as Array<Record<string, any>> : []
})
const typographyWeights = computed(() => {
  const t = (flow.draftSpec.value as any).typography
  return Array.isArray(t?.weights) ? t.weights as string[] : []
})

const hasAnyTokens = computed(() =>
  colorTokens.value.length > 0 || typographyFamilies.value.length > 0 ||
  typographyScale.value.length > 0 || spacingTokens.value.length > 0 || borderTokens.value.length > 0
)

/** Resolve a token's display value — handles both `value` (old shape) and
 *  `values: { themeId: colorStr }` (new multi-variant shape). */
function tokenDisplayValue(token: Record<string, any>): string {
  if (typeof token.value === 'string') return token.value
  if (token.values && typeof token.values === 'object') {
    const vals = Object.values(token.values as Record<string, string>)
    return vals.find(v => v) ?? ''
  }
  return ''
}

// ── Token categories empty-state ─────────────────────────
const TOKEN_CATEGORIES = [
  { id: 'colors',     label: 'Colors',     hint: '--primary, --background, …' },
  { id: 'typography', label: 'Typography',  hint: 'font-family, scale, weights' },
  { id: 'spacing',    label: 'Spacing',     hint: '--space-sm, --space-md, …' },
  { id: 'borders',    label: 'Borders',     hint: 'radius variants' },
] as const

// ── Style guide section editor ───────────────────────────
// Section metadata — headings, placeholders, and preferred row height.
const GUIDE_SECTION_META: Record<string, { placeholder: string; rows: number }> = {
  'Naming conventions': {
    placeholder: 'e.g. PascalCase components, camelCase composables, kebab-case CSS classes',
    rows: 2,
  },
  'Spacing & layout': {
    placeholder: 'e.g. 4px base unit; cards use --space-md padding; grid is 12-column',
    rows: 2,
  },
  'Component patterns': {
    placeholder: 'e.g. wrap form inputs in <FormField label="…">; prefer Radix primitives over custom',
    rows: 3,
  },
  'Things to avoid': {
    placeholder: "e.g. don't add new dependencies; don't refactor for cleanliness; preserve inline styles",
    rows: 2,
  },
  'Project context': {
    placeholder: 'A sentence or two about what this project does. Helps agents pick tone in copy edits.',
    rows: 2,
  },
}
const FALLBACK_META = { placeholder: 'Your notes here…', rows: 2 }

interface GuideSection { heading: string; content: string; placeholder: string; rows: number }

function parseGuideSections(markdown: string): GuideSection[] {
  // Split on `## ` headings, preserving the first `# ` title as an ignored preamble.
  const lines = markdown.split(/\r?\n/)
  const sections: GuideSection[] = []
  let currentHeading = ''
  let currentLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentHeading) {
        sections.push(makeSection(currentHeading, currentLines))
      }
      currentHeading = line.replace(/^##\s+/, '').trim()
      currentLines = []
    } else if (currentHeading) {
      currentLines.push(line)
    }
    // Lines before the first ## (the # title, intro paragraph) are skipped.
  }
  if (currentHeading) sections.push(makeSection(currentHeading, currentLines))

  // If no sections found (empty / unexpected format), produce a single freeform section.
  if (sections.length === 0) {
    sections.push({ heading: 'Notes', content: markdown.trim(), placeholder: 'Your notes here…', rows: 6 })
  }
  return sections
}

function makeSection(heading: string, lines: string[]): GuideSection {
  const meta = GUIDE_SECTION_META[heading] ?? FALLBACK_META
  // Strip leading/trailing blank lines and HTML comment placeholders.
  const raw = lines.join('\n').trim().replace(/^<!--.*?-->$/gm, '').trim()
  return { heading, content: raw, placeholder: meta.placeholder, rows: meta.rows }
}

function serializeGuideSections(sections: GuideSection[]): string {
  const preamble = '# Project style guide\n\nAnnotask agents read this file before applying tasks. Fill in the sections\nbelow to teach them your project\'s conventions. Empty sections are fine —\nagents will fall back to inferring from the existing code.'
  const body = sections.map(s => {
    const content = s.content.trim()
    return `## ${s.heading}\n\n${content.length > 0 ? content : `<!-- ${s.placeholder} -->`}`
  }).join('\n\n')
  return `${preamble}\n\n${body}\n`
}

const guidesections = ref<GuideSection[]>([])

// Hydrate once when the draft lands and keep in sync with external resets.
watch(
  () => flow.draftStyleGuide.value,
  (md) => {
    const parsed = parseGuideSections(md)
    // Only re-parse if sections are structurally different to avoid clobbering
    // edits the user has in flight.
    if (guidesections.value.length === 0 ||
        parsed.map(s => s.heading).join() !== guidesections.value.map(s => s.heading).join()) {
      guidesections.value = parsed
    }
  },
  { immediate: true },
)

function onSectionInput(idx: number, value: string) {
  if (idx < 0 || idx >= guidesections.value.length) return
  guidesections.value[idx] = { ...guidesections.value[idx], content: value }
  flow.setStyleGuide(serializeGuideSections(guidesections.value))
}

const ALL_STEP_LABELS = [
  { id: 'mode', label: 'Choose workflow' },
  { id: 'agent', label: 'Pick init agent' },
  { id: 'scan', label: 'Scan project' },
  { id: 'review', label: 'Review & Save' },
] as const

// Hide the 'mode' step in the stepper once the user has already chosen a
// workflow (re-opens from settings, re-scans). The user can't "go back" to
// re-pick the workflow from inside the wizard — that toggle lives in
// Settings → General.
const stepperLabels = computed(() => {
  const choice = providerSettings.settings.value.embeddedAgentEnabled
  if (choice == null) return ALL_STEP_LABELS
  return ALL_STEP_LABELS.filter(s => s.id !== 'mode')
})

const doneSteps = computed(() => {
  const set = new Set<string>()
  const order = ['mode', 'agent', 'scan', 'review'] as const
  for (const id of order) {
    if (id === flow.wizardStep.value) break
    set.add(id)
  }
  return set
})

const framework = computed(() => (flow.draftSpec.value.framework ?? {}) as Record<string, any>)
const themes = computed(() => Array.isArray(flow.draftSpec.value.themes) ? flow.draftSpec.value.themes : [])
const components = computed(() => flow.draftSpec.value.components as { library: string; version?: string; used?: string[] } | null)
const draft = computed(() => flow.initState.value.draft)

function updateFw(key: string, value: string) {
  flow.updateFramework({ [key]: value })
}

function updateFwStyling(raw: string) {
  const styling = raw.split(',').map(s => s.trim()).filter(s => s.length > 0)
  flow.updateFramework({ styling })
}

function onThemePatch(idx: number, patch: Record<string, any>) {
  flow.updateTheme(idx, patch)
}

function onSelectorPatch(idx: number, patch: Record<string, any>) {
  flow.updateThemeSelector(idx, patch)
}

async function onSave() {
  saving.value = true
  const ok = await flow.commitDraft()
  saving.value = false
  if (ok) flow.closeWizard()
}

async function onRetry() {
  await flow.startRun()
}

// True when the user is allowed to jump directly to the given step.
// Forward jumps from `agent` require a configured provider; jumping to
// Review requires that the project has either an active scan draft or is
// already initialized (so we can hydrate from disk).
function canJumpTo(stepId: string): boolean {
  if (stepId === flow.wizardStep.value) return false
  if (flow.initState.value.running) return false
  // 'mode' is a first-run pivot — once the user has chosen, it's not
  // re-enterable from the stepper. Change it from Settings → General.
  if (stepId === 'mode') return false
  if (stepId === 'agent') return true
  if (stepId === 'scan') return true
  if (stepId === 'review') {
    if (flow.initState.value.result === 'awaiting_review') return true
    if (flow.isInitialized.value) return true
    return false
  }
  return false
}

function jumpToStep(stepId: string) {
  if (!canJumpTo(stepId)) return
  if (stepId === 'mode' || stepId === 'agent' || stepId === 'scan' || stepId === 'review') {
    flow.goToStep(stepId as 'mode' | 'agent' | 'scan' | 'review')
  }
}

// Page 0 selection. 'skill' commits the user to MCP/skill mode and closes
// the wizard immediately without touching .annotask/. 'embedded' opts the
// user into the in-shell agent UI and advances to the provider-setup step.
const selectedMode = ref<'skill' | 'embedded' | null>(null)

function confirmModeChoice() {
  if (selectedMode.value === 'skill') {
    providerSettings.setEmbeddedAgentEnabled(false)
    flow.closeWizard()
    return
  }
  if (selectedMode.value === 'embedded') {
    providerSettings.setEmbeddedAgentEnabled(true)
    providerSettings.setAgentMode('auto')
    flow.goToStep('agent')
  }
}

function advanceFromAgent() {
  flow.nextStep()
  // In rescan mode the user is choosing which scans to (re-)run, so don't
  // auto-start. In first-run init, kick off the full scan unless a draft is
  // already awaiting review.
  if (flow.rescanMode.value) return
  if (!flow.initState.value.running && (!flow.initState.value.result || flow.initState.value.result === 'awaiting_review')) {
    if (flow.initState.value.result !== 'awaiting_review') {
      flow.startRun()
    }
  }
}

// Advance to the Review step from Scan. Used for both "Review →" (after a
// successful scan) and "Skip to Review →" (rescan mode, nothing selected).
function goToReviewFromScan() {
  flow.goToStep('review')
}

function close() {
  flow.closeWizard()
}
</script>

<style scoped>
.init-modal-backdrop {
  position: fixed;
  inset: 0;
  /* Above every shell surface — topbar, sidebar, overlays, highlights. */
  z-index: 30000;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  /* Soft body-copy color — light grey on dark themes, dark grey on light
     themes — by mixing the foreground toward the surface. Use this for
     paragraphs/lists; reserve full `var(--text)` for titles, alerts, and
     emphasized inline spans. */
  --init-text-body: color-mix(in srgb, var(--text) 78%, var(--surface));
}

.init-modal {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.init-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.init-modal-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
  margin: 0;
}

.init-modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: 1px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 4px;
  padding: 0;
}
.init-modal-close:hover { color: var(--text); background: var(--surface-2); border-color: var(--border); }
.init-modal-close:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

.init-stepper {
  display: flex;
  gap: 0;
  padding: 10px 16px;
  list-style: none;
  margin: 0;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.init-stepper-item {
  display: flex;
  align-items: center;
  padding: 0;
  color: var(--text);
  opacity: 0.7;
  font-size: 14px;
  font-weight: 600;
  position: relative;
}
.init-stepper-item.active { opacity: 1; }

.init-stepper-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  font-weight: inherit;
  cursor: default;
  border-radius: 6px;
}
.init-stepper-item.clickable .init-stepper-btn {
  cursor: pointer;
}
.init-stepper-item.clickable .init-stepper-btn:hover {
  background: var(--surface-2);
  color: var(--text);
}
.init-stepper-item.clickable .init-stepper-btn:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.init-stepper-btn:disabled {
  cursor: default;
}

.init-stepper-item + .init-stepper-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  width: 1px;
  height: 16px;
  background: var(--border);
  transform: translateY(-50%);
}

.init-stepper-item.active { color: var(--text); }
.init-stepper-item.active .init-stepper-num {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}
.init-stepper-item.done .init-stepper-num {
  background: var(--success);
  border-color: var(--success);
  color: var(--text-on-accent);
}

.init-stepper-num {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--surface-2);
  font-size: 11px;
  font-weight: 600;
}

.init-wizard-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px 0;
  display: flex;
  flex-direction: column;
  /* Centre content with a comfortable max-width while using the full screen */
  align-items: center;
}

/* Constrain direct children (steps) to a readable width */
.init-wizard-body > * {
  width: 100%;
  max-width: 860px;
  padding: 0 28px;
}

.init-step {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.init-step-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0;
  color: var(--text);
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 12px;
  letter-spacing: -0.01em;
}

.init-working {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
  letter-spacing: 0.02em;
}
.init-working-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  align-self: center;
  animation: init-working-pulse 1.2s ease-in-out infinite;
}
.init-working-verb {
  font-weight: 600;
  animation: init-working-verb-in 320ms ease-out;
  display: inline-flex;
  align-items: baseline;
}
.init-working-dots::after {
  display: inline-block;
  content: '';
  width: 1.2em;
  text-align: left;
  animation: init-working-dots 1.4s steps(4, end) infinite;
}
.init-working-elapsed {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}
@keyframes init-working-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@keyframes init-working-verb-in {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes init-working-dots {
  0%   { content: ''; }
  25%  { content: '.'; }
  50%  { content: '..'; }
  75%  { content: '...'; }
  100% { content: ''; }
}
@media (prefers-reduced-motion: reduce) {
  .init-working-dot,
  .init-working-verb,
  .init-working-dots::after { animation: none; }
  .init-working-dots::after { content: '…'; }
}

.init-step-lead {
  font-size: 15px;
  line-height: 1.65;
  color: var(--init-text-body);
  margin: 0;
}

.init-step-lead code,
.init-section-hint code,
.init-agent-duties code,
.init-step-note code,
.init-skip-btn code {
  background: var(--surface-2);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 14px;
  color: var(--text);
}

.init-agent-duties {
  margin: 0;
  padding: 0 0 0 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.init-agent-duties li {
  font-size: 15px;
  line-height: 1.6;
  color: var(--init-text-body);
}
.init-agent-duties strong {
  color: var(--text);
  font-weight: 700;
}

.init-step-note {
  font-size: 14px;
  line-height: 1.6;
  color: var(--init-text-body);
  margin: 0;
  padding: 10px 14px;
  border-left: 3px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 4px;
}

.init-step-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
}

/* Page 0: workflow chooser */
.init-mode-choices {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 12px 0 4px;
}
.init-mode-choice {
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  padding: 14px 16px;
  border: 2px solid var(--border);
  border-radius: 8px;
  background: var(--surface-2);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.init-mode-choice:hover:not(.selected) {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: var(--surface-3);
}
.init-mode-choice:focus-visible {
  outline: none;
  border-color: var(--accent);
}
.init-mode-choice.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
}
.init-mode-body { display: flex; flex-direction: column; gap: 8px; flex: 1; }
.init-mode-head { display: flex; align-items: center; gap: 10px; }
.init-mode-title { font-size: 17px; font-weight: 700; color: var(--text); letter-spacing: -0.005em; }
.init-mode-badge {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 4px;
}
.init-mode-badge-stable {
  background: color-mix(in srgb, var(--success) 28%, transparent);
  color: var(--text);
}
.init-mode-badge-experimental {
  background: color-mix(in srgb, var(--warning) 28%, transparent);
  color: var(--text);
}
.init-mode-blurb {
  margin: 0;
  font-size: 15px;
  color: var(--init-text-body);
  line-height: 1.6;
}
.init-mode-blurb code,
.init-mode-bullets code {
  background: var(--surface-3);
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 14px;
  color: var(--text);
}
.init-mode-bullets {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 14px;
  color: var(--init-text-body);
  line-height: 1.65;
}
.init-mode-bullets li { margin-bottom: 3px; }

.init-mode-warning {
  margin: 10px 0 0;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--init-text-body);
  background: color-mix(in srgb, var(--warning) 22%, transparent);
  border-left: 3px solid var(--warning);
  border-radius: 4px;
}
.init-mode-warning strong { color: var(--text); font-weight: 700; }
.init-mode-warning code {
  background: var(--surface-3);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 13px;
  color: var(--text);
}

.init-btn-primary,
.init-btn-secondary {
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}

.init-btn-primary {
  background: var(--accent);
  color: var(--text-on-accent);
  border: 1px solid var(--accent);
}
.init-btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
.init-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.init-btn-secondary {
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
}
.init-btn-secondary:hover:not(:disabled) { background: var(--surface-3); }

.init-step-actions-split {
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
}

.init-alt {
  margin: 16px 0 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  font-size: 14px;
  color: var(--init-text-body);
}
.init-cmd {
  margin: 6px 0 0;
  padding: 10px 14px;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 14px;
  color: var(--text);
  overflow-x: auto;
}
.init-cmd code {
  background: transparent;
  padding: 0;
  font-size: 14px;
  color: var(--text);
}

.init-skip-btn {
  font: inherit;
  font-size: 13px;
  background: none;
  border: none;
  color: var(--text);
  cursor: pointer;
  padding: 4px 0;
  text-decoration: underline;
  text-decoration-color: var(--text-muted);
  text-underline-offset: 2px;
}
.init-skip-btn:hover { color: var(--accent); }

.init-empty {
  font-size: 15px;
  color: var(--init-text-body);
  padding: 18px;
  border: 1px dashed var(--border);
  border-radius: 6px;
}
.init-empty-small {
  font-size: 14px;
  color: var(--init-text-body);
  margin: 4px 0 0;
}

.init-progress-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
}

.init-progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
}
.init-progress-row:last-child { border-bottom: none; }
.init-progress-row { font-size: 14px; }
.init-progress-row.success { color: var(--text); }
.init-progress-row.pending { color: var(--text); opacity: 0.7; }
.init-progress-row.running { color: var(--text); }
.init-progress-row.error { color: var(--text); font-weight: 600; }
.init-progress-row.skipped { color: var(--text); opacity: 0.55; }

.init-progress-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1px solid var(--border);
  font-size: 10px;
  background: var(--surface-2);
}
.init-progress-marker.success { background: var(--success); border-color: var(--success); color: var(--text-on-accent); }
.init-progress-marker.error { background: var(--danger); border-color: var(--danger); color: var(--text-on-accent); }
.init-progress-marker.running { background: var(--accent-muted); border-color: var(--accent); }

/* Rescan-mode clickable marker — same visual as the read-only marker, but
   acts as a per-step include/skip toggle. */
.init-progress-marker-toggle {
  padding: 0;
  cursor: pointer;
  font: inherit;
  font-size: 10px;
  transition: background 120ms, border-color 120ms;
}
.init-progress-marker-toggle:hover:not(:disabled) {
  border-color: var(--accent);
}
.init-progress-marker-toggle:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.init-progress-marker-toggle:disabled {
  cursor: default;
}
.init-progress-marker-toggle.selected:not(.success):not(.error):not(.running) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
}
.init-marker-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.init-progress-list-rescan .init-progress-row {
  align-items: flex-start;
  cursor: default;
}
.init-progress-list-rescan .init-progress-row:not(.selected):not(.success):not(.error):not(.running) {
  opacity: 0.55;
}
.init-progress-hint {
  display: block;
  margin-top: 2px;
  font-size: 13px;
  color: var(--init-text-body);
}
.init-progress-when {
  flex-shrink: 0;
  font-size: 13px;
  color: var(--init-text-body);
  opacity: 0.8;
  font-style: italic;
  margin-left: 8px;
  padding-top: 1px;
}

.init-spinner {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-top-color: var(--accent);
  animation: init-spin 700ms linear infinite;
}
@keyframes init-spin { to { transform: rotate(360deg); } }

.init-progress-label { flex: 1; }

/* ── Agent streaming log ── */
.init-agent-log {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  max-height: 200px;
  display: flex;
  flex-direction: column;
}
.init-agent-log-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  flex-shrink: 0;
}
.init-agent-log-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px;
  background: var(--surface);
}
.init-agent-line {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.init-progress-message {
  font-size: 13px;
  color: var(--text);
}

.init-error {
  color: var(--init-text-body);
  background: color-mix(in srgb, var(--danger) 22%, transparent);
  border-left: 3px solid var(--danger);
  padding: 10px 14px;
  border-radius: 4px;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.55;
  margin: 0;
}
.init-success {
  color: var(--init-text-body);
  background: color-mix(in srgb, var(--success) 22%, transparent);
  border-left: 3px solid var(--success);
  padding: 10px 14px;
  border-radius: 4px;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.55;
  margin: 0;
}

/* Review-step sections */
.init-section {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  background: var(--surface);
  margin: 0;
}
.init-section legend {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
  padding: 0 6px;
}
.init-section-hint {
  font-size: 14px;
  line-height: 1.55;
  color: var(--init-text-body);
  margin: 4px 0 12px;
}

.init-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px 12px;
}

.init-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
  color: var(--init-text-body);
}
.init-field span { font-weight: 600; color: var(--text); }
.init-field input,
.init-field select,
.init-field textarea {
  font: inherit;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 4px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
}
.init-field-full { grid-column: 1 / -1; }

.init-themes {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.init-theme-row {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.init-theme-grid {
  grid-template-columns: repeat(3, 1fr);
}

.init-default-toggle {
  display: inline-flex;
  flex-direction: row !important;
  align-items: center;
  gap: 4px;
  font-size: 11px;
}
.init-default-toggle input { margin: 0; }

.init-theme-delete {
  align-self: flex-end;
  font-size: 11px;
  padding: 4px 10px;
}

.init-readout {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  font-size: 13px;
  color: var(--text);
}
.init-readout-key { font-weight: 600; }
.init-readout-version {
  font-size: 11px;
  color: var(--text-muted);
  font-family: var(--font-mono, ui-monospace, monospace);
}
.init-readout-meta {
  font-size: 11px;
  color: var(--text-muted);
}

.init-style-guide {
  width: 100%;
  font: inherit;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 12px;
  line-height: 1.5;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--text);
  resize: vertical;
}

.init-overwrite-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 8px;
}
.init-overwrite-toggle code { font-size: 11px; }

/* ── APIs & Data tab ── */
.init-lib-badge {
  display: inline-block;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  padding: 1px 7px;
  margin-left: 4px;
}

.init-data-list {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.init-data-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.init-data-row:last-child { border-bottom: none; }
.init-data-kind {
  font-size: 10px;
  color: var(--text-muted);
  background: var(--surface-2);
  border-radius: 3px;
  padding: 1px 6px;
  white-space: nowrap;
  flex-shrink: 0;
}
.init-data-name {
  flex: 1;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
}
.init-data-remove {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 2px;
  border-radius: 3px;
}
.init-data-remove:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }

.init-data-add {
  display: flex;
  gap: 6px;
  align-items: center;
}
.init-data-add input {
  flex: 1;
  font: inherit;
  font-size: 12px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
}
.init-data-add select {
  font: inherit;
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
}

/* ── Style guide toolbar + editor ── */
.init-guide-toolbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-bottom: 6px;
}

.init-guide-toggle {
  display: inline-flex;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px;
  gap: 2px;
}

.init-guide-mode {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font: inherit;
  font-size: 11px;
  font-weight: 500;
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 4px;
  cursor: pointer;
  transition: background 100ms, color 100ms;
}
.init-guide-mode:hover { color: var(--text); }
.init-guide-mode.active {
  background: var(--surface);
  color: var(--text);
  box-shadow: 0 1px 3px var(--shadow);
}

.init-style-guide {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  min-height: 420px;
}
.init-style-guide:focus-within {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 3%, var(--surface));
}

.init-style-preview {
  min-height: 420px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text);
}

/* Markdown body styles for the preview */
.init-style-preview :deep(h1) { font-size: 18px; font-weight: 700; margin: 0 0 12px; }
.init-style-preview :deep(h2) { font-size: 14px; font-weight: 600; margin: 20px 0 8px; padding-bottom: 4px; border-bottom: 1px solid var(--border); color: var(--text); }
.init-style-preview :deep(h3) { font-size: 13px; font-weight: 600; margin: 14px 0 6px; }
.init-style-preview :deep(p) { margin: 0 0 10px; color: var(--text); }
.init-style-preview :deep(ul), .init-style-preview :deep(ol) { margin: 0 0 10px; padding-left: 20px; }
.init-style-preview :deep(li) { margin-bottom: 4px; color: var(--text); }
.init-style-preview :deep(code) { background: var(--surface-2); padding: 1px 5px; border-radius: 3px; font-size: 11.5px; font-family: var(--font-mono, ui-monospace, monospace); }
.init-style-preview :deep(pre) { background: var(--surface-2); padding: 10px 12px; border-radius: 6px; overflow-x: auto; margin: 0 0 10px; }
.init-style-preview :deep(pre code) { background: none; padding: 0; }
.init-style-preview :deep(blockquote) { border-left: 3px solid var(--accent); margin: 0 0 10px; padding: 4px 12px; color: var(--text-muted); }
.init-style-preview :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
.init-style-preview :deep(strong) { font-weight: 600; }

/* ── Review step sub-nav ── */
.init-step-review {
  gap: 0;
}

.review-subnav {
  display: flex;
  gap: 0;
  padding: 0 0 16px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 4px;
}

.review-subnav-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  border: 1px solid transparent;
  background: none;
  color: var(--text-muted);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 100ms, color 100ms, border-color 100ms;
}
.review-subnav-item:hover { background: var(--surface-2); color: var(--text); }
.review-subnav-item.active {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  color: var(--accent);
}
.review-subnav-item.done { color: var(--text-muted); }
.review-subnav-item.done .review-subnav-dot { background: var(--success); }

.review-subnav-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--border);
  flex-shrink: 0;
}
.review-subnav-item.active .review-subnav-dot { background: var(--accent); }

/* ── Review panel ── */
.review-panel-tokens {
  /* Let DesignTokenEditor manage its own scroll — prevent double-scroll */
  overflow: hidden;
}
.init-token-editor {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.review-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  min-height: 200px;
}

.review-panel-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.review-panel-icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 2px;
}

.review-panel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 4px;
}

.review-panel-desc {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0;
  line-height: 1.5;
}
.review-panel-desc code { background: var(--surface-2); padding: 1px 5px; border-radius: 3px; }

.review-callout {
  background: var(--surface-2);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  padding: 12px 14px;
  font-size: 12px;
  color: var(--text);
  line-height: 1.55;
}
.review-callout code { background: var(--surface-3); padding: 1px 5px; border-radius: 3px; font-size: 11px; }

/* ── Review navigation ── */
.review-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}

.review-nav-right {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

/* ── Panel-level sub-tabs ── */
.panel-tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
}
.panel-tab {
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  padding: 7px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: color 100ms, border-color 100ms;
}
.panel-tab:hover { color: var(--text); }
.panel-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
.panel-tab-count {
  background: var(--surface-2);
  border-radius: 9px;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  color: var(--text-muted);
}
.panel-tab.active .panel-tab-count {
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  color: var(--accent);
}

/* ── Section sub-label ── */
.init-section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-muted);
  margin: 12px 0 6px;
}

/* ── Token sections matching ThemePage layout ── */
.init-token-section {
  margin-bottom: 8px;
}
.init-token-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 4px 8px;
  margin: 0 0 2px;
  border-bottom: 1px solid var(--border);
}

/* Re-use ThemePage's .token-row classes verbatim */
.token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  gap: 8px;
  transition: background 80ms;
}
.token-row:hover { background: var(--surface-2); }
.token-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.token-role { font-size: 12px; font-weight: 500; color: var(--text); white-space: nowrap; }
.token-source {
  font-size: 9px; color: var(--text-muted); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 180px;
}
.token-controls { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.color-swatch-inline {
  width: 20px; height: 20px; border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  flex-shrink: 0;
}
.token-value-text {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 11px; color: var(--text-muted);
}
.font-sample {
  font-size: 11px; max-width: 160px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.font-size-preview {
  color: var(--text); line-height: 1; min-width: 20px; text-align: center;
}
.spacing-preview { display: flex; align-items: center; width: 60px; }
.spacing-bar {
  height: 6px; background: var(--accent-muted); border-radius: 2px;
  max-width: 60px; min-width: 2px;
}
.radius-preview {
  width: 20px; height: 20px;
  background: var(--accent-muted);
  border: 1px solid var(--accent);
}

/* ── Design-token & component rows (ThemePage-style) ── */
.init-token-categories {
  list-style: none;
  margin: 0 0 4px;
  padding: 0;
  display: flex;
  flex-direction: column;
}

.init-token-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  gap: 8px;
  transition: background 80ms;
}
.init-token-row:hover { background: var(--surface-2); }

.init-token-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.init-token-role {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
  white-space: nowrap;
}
.init-token-source {
  font-size: 10px;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.init-token-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--success) 15%, transparent);
  color: var(--success);
  border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
  white-space: nowrap;
}
.init-token-badge.muted {
  background: var(--surface-2);
  color: var(--text-muted);
  border-color: var(--border);
}

/* ── Style guide structured sections ── */
.init-guide-sections {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.init-guide-section {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}
.init-guide-section + .init-guide-section { margin-top: 6px; }

.init-guide-section-label {
  display: block;
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.init-guide-section-body {
  display: block;
  width: 100%;
  font: inherit;
  font-size: 13px;
  line-height: 1.55;
  padding: 10px 12px;
  border: none;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
  min-height: 48px;
}
.init-guide-section-body:focus {
  outline: none;
  background: color-mix(in srgb, var(--accent) 4%, var(--surface));
}

/* ── Agent directions sub-step ── */
.review-panel-agents {
  overflow: hidden;
}

.init-perm-row {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 12px 14px;
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
}
.init-perm-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.init-perm-label-title { font-size: 12px; font-weight: 600; color: var(--text); }
.init-perm-label-hint  { font-size: 11px; color: var(--text-muted); line-height: 1.4; }
.init-perm-select {
  font: inherit;
  font-size: 12px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  border-radius: 5px;
  min-width: 280px;
}
.init-perm-select:focus { outline: none; border-color: var(--accent); }

.init-perm-note {
  margin: -6px 0 16px;
  padding: 10px 14px;
  font-size: 14px;
  line-height: 1.55;
  color: var(--init-text-body);
  background: color-mix(in srgb, var(--warning) 22%, transparent);
  border-left: 3px solid var(--warning);
  border-radius: 4px;
}
.init-perm-note code {
  font-size: 13px;
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--surface-2);
  color: var(--text);
}

.init-adp {
  flex: 1;
  min-height: 380px;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

/* ── Scan options disclosure ── */
.init-scan-opts {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  padding: 8px 12px;
  font-size: 12px;
}
.init-scan-opts summary {
  cursor: pointer;
  font-weight: 500;
  color: var(--text-muted);
  user-select: none;
}
.init-scan-opts summary:hover { color: var(--text); }

.init-scan-opt-list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.init-scan-opt {
  display: flex;
  align-items: baseline;
  gap: 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--text);
}
.init-scan-opt input { margin: 0; cursor: pointer; }
.init-scan-opt-status {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}
.init-scan-opt-list > li.success .init-scan-opt-status { color: var(--success); }
.init-scan-opt-list > li.error   .init-scan-opt-status { color: var(--danger); }
.init-scan-opt-list > li.running .init-scan-opt-status { color: var(--accent); }
.init-scan-opt-list > li.skipped .init-scan-opt-status { color: var(--text-muted); opacity: 0.6; }
.init-scan-opt-main {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex: 1;
  min-width: 0;
}
.init-scan-opt-hint {
  font-size: 11px;
  color: var(--text-muted);
}
.init-scan-opt-when {
  font-size: 11px;
  color: var(--text-muted);
  font-style: italic;
  flex-shrink: 0;
  margin-left: 8px;
}

/* ── Re-scan mode: toggles take the primary surface ── */
.init-scan-opts-rescan {
  background: var(--surface);
  padding: 14px 16px;
}
.init-scan-opts-rescan .init-scan-opt-list { margin-top: 0; gap: 12px; }
.init-scan-opts-rescan .init-scan-opt {
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-2);
  transition: border-color 120ms, background 120ms;
}
.init-scan-opts-rescan .init-scan-opt:hover {
  border-color: var(--border-strong);
}
.init-scan-opts-rescan .init-scan-opt:has(input:checked) {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
}

/* ── Style guide file override ── */
.init-guide-file-row {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.init-guide-file-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.init-guide-file-input-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.init-guide-file-input {
  flex: 1;
  font: inherit;
  font-size: 12px;
  padding: 6px 9px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--surface);
  color: var(--text);
}
.init-guide-file-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }

.init-guide-file-error {
  font-size: 11px;
  color: var(--danger);
  margin: 0;
}

/* ── Agent directions review panel ── */
.init-agent-dir-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.init-agent-dir-row {
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--surface);
}

.init-agent-dir-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
}

.init-agent-dir-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
}

.init-agent-dir-types {
  font-size: 10px;
  color: var(--text-muted);
  font-family: var(--font-mono, ui-monospace, monospace);
}

.init-agent-dir-textarea {
  display: block;
  width: 100%;
  font: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 8px 12px;
  border: none;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
  min-height: 64px;
}
.init-agent-dir-textarea:focus {
  outline: none;
  background: color-mix(in srgb, var(--accent) 3%, var(--surface));
}

.init-agent-dir-actions {
  display: flex;
  justify-content: flex-end;
  padding: 6px 10px;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}

.init-btn-xs {
  font-size: 11px;
  padding: 4px 12px;
}

.init-token-usage {
  display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
  margin-top: 8px; padding: 6px 8px; border-radius: 6px;
  background: var(--surface-2); border: 1px solid var(--border);
}
.init-token-pill {
  font-size: 11px; font-family: monospace; padding: 2px 6px; border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--text);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
}
.init-token-pill-cache {
  background: color-mix(in srgb, var(--info) 12%, transparent);
  border-color: color-mix(in srgb, var(--info) 22%, transparent);
}
.init-token-meta { font-size: 11px; color: var(--text-muted); }
</style>
