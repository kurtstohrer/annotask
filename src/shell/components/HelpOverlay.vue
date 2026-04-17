<template>
  <div class="fullscreen-overlay help-overlay">
    <div class="help-sidebar">
      <nav class="help-nav">
        <button v-for="item in navItems" :key="item.id"
          :class="['help-nav-btn', { active: helpSection === item.id }]"
          @click="$emit('update:helpSection', item.id)">
          <span v-html="item.icon"></span>
          {{ item.label }}
        </button>
      </nav>
      <div class="help-version">Annotask v{{ annotaskVersion }}</div>
    </div>
    <div class="help-content">
      <!-- Overview -->
      <div v-if="helpSection === 'overview'" class="help-page">
        <h2 class="help-page-title">Quick Overview</h2>
        <p class="help-intro">Annotask is a visual UI design tool that runs alongside your app. Make visual changes in the browser and Annotask generates structured tasks that AI agents can apply to your source code.</p>

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
        <p class="help-intro">Select elements, place annotations, and create tasks for your AI agent. Each annotation becomes a structured task with file location, component info, and your description.</p>

        <h3 class="help-section-title">Tools</h3>
        <div class="help-feature-list">
          <div class="help-feature">
            <div class="help-feature-header"><kbd>V</kbd> Select</div>
            <p>Click any element to select it. The inspector panel shows computed styles, component info, and source file location. Multi-select with shift+click. Create a task from the selection with a description of your desired change.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>P</kbd> Pin</div>
            <p>Click to drop a pin on any element. A task panel opens to describe the change you want. Pins track their target element during scroll and resize.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>A</kbd> Arrow</div>
            <p>Draw arrows between elements to show relationships or flow. Arrows snap to element edges with bezier curves. Drag endpoints to reposition. Multiple colors available.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>D</kbd> Draw Section</div>
            <p>Draw a rectangular area to describe a new content section. Includes a markdown editor for detailed descriptions. Sections are movable and resizable.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>H</kbd> Highlight Text</div>
            <p>Select text in your app to highlight it. The highlight is attached to the DOM range and tracks scroll. Create tasks referencing the highlighted content.</p>
          </div>
          <div class="help-feature">
            <div class="help-feature-header"><kbd>I</kbd> Interact</div>
            <p>Switch to interact mode to use your app normally — click links, fill forms, scroll. No element selection or annotation occurs in this mode.</p>
          </div>
        </div>

        <h3 class="help-section-title">Tasks</h3>
        <p class="help-text">Every annotation creates a task with a lifecycle: <strong>pending</strong> &rarr; <strong>in_progress</strong> &rarr; <strong>review</strong> &rarr; <strong>accepted</strong> or <strong>denied</strong>. Tasks include source file, line number, component, route, and optional screenshots. Use the Tasks panel <kbd>T</kbd> to review, accept, deny, or delete tasks.</p>

        <h3 class="help-section-title">Screenshots</h3>
        <p class="help-text">Attach screenshots to any task. Use the snipping tool to capture a region or the full page. Screenshots are stored on the server and included in task reports for your AI agent.</p>
      </div>

      <!-- Design -->
      <div v-else-if="helpSection === 'design'" class="help-page">
        <h2 class="help-page-title">Design</h2>
        <p class="help-intro">Inspect and edit your app's visual design. Changes are recorded as tasks that map back to your source code and design tokens.</p>

        <h3 class="help-section-title">Design Tokens</h3>
        <p class="help-text">View and edit your design system tokens — colors, typography, spacing, borders, shadows, and more. Annotask detects CSS custom properties and organizes them by category. Edits create <strong>theme_update</strong> tasks with the token name, category, before/after values, and CSS variable reference.</p>

        <h3 class="help-section-title">Inspector</h3>
        <p class="help-text">Click any element to inspect its computed styles. Edit properties inline — changes are applied live and recorded as <strong>style_update</strong> tasks. Class editing lets you add, remove, or toggle CSS classes. All changes can be undone with <kbd class="mod">Ctrl</kbd><kbd>Z</kbd>.</p>

        <h3 class="help-section-title">Layout Overlay</h3>
        <p class="help-text">Toggle the layout overlay <kbd>L</kbd> to visualize flex and grid containers. See container boundaries, alignment, and gaps. Scan the page to discover all layout containers at once.</p>

        <h3 class="help-section-title">Color Palette</h3>
        <p class="help-text">Scan your page to extract all CSS custom property colors into a visual palette. See which tokens are in use and quickly navigate to edit them.</p>
      </div>

      <!-- Accessibility -->
      <div v-else-if="helpSection === 'a11y'" class="help-page">
        <h2 class="help-page-title">Accessibility</h2>
        <p class="help-intro">Run automated WCAG accessibility audits powered by axe-core. Scan the full page or a specific element to find violations.</p>

        <h3 class="help-section-title">Scanning</h3>
        <p class="help-text">Click <strong>Scan Page</strong> to run a full-page audit, or select an element first and scan just that subtree. Axe-core is loaded on demand from the local server — no external CDN required.</p>

        <h3 class="help-section-title">Violations</h3>
        <p class="help-text">Results are grouped by rule with impact levels: critical, serious, moderate, minor. Each violation shows the affected elements, their selectors, and a suggested fix. Click a violation to see full details including the WCAG rule reference.</p>

        <h3 class="help-section-title">Creating Fix Tasks</h3>
        <p class="help-text">Click the task button on any violation to create an <strong>a11y_fix</strong> task. The task includes the rule ID, impact, affected elements with their selectors, source file locations, and fix suggestions — everything your AI agent needs to resolve the issue.</p>
      </div>

      <!-- Performance -->
      <div v-else-if="helpSection === 'perf'" class="help-page">
        <h2 class="help-page-title">Performance</h2>
        <p class="help-intro">Monitor Web Vitals, analyze bundles, record interactions, and track console errors. Create fix tasks from performance findings.</p>

        <h3 class="help-section-title">Audit</h3>
        <p class="help-text">Click <strong>Scan</strong> to capture a performance snapshot — Web Vitals (LCP, FID, CLS, TTFB), navigation timing, and resource breakdown. Resources are sorted by transfer size so you can spot large assets immediately.</p>

        <h3 class="help-section-title">Recording</h3>
        <p class="help-text">Click <strong>Record</strong> to capture a performance session. Interact with your app, then stop recording. The result includes a timeline of navigation and click events, vitals collected during the session, and a full resource list. Recordings are saved to the server for historical comparison.</p>

        <h3 class="help-section-title">Findings</h3>
        <p class="help-text">Annotask analyzes scan and recording results to surface actionable findings — slow vitals, large bundles, render-blocking resources, excessive DOM size. Each finding can be turned into a task for your AI agent.</p>

        <h3 class="help-section-title">Errors</h3>
        <p class="help-text">The Errors tab captures console errors and warnings from your app in real time. Errors are deduplicated and bounded to prevent memory issues. Click any error to create a fix task with the error message, stack trace, and source location.</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
export type HelpSection = 'overview' | 'annotate' | 'design' | 'a11y' | 'perf'

interface Props {
  helpSection: HelpSection
  annotaskVersion: string
}

defineProps<Props>()
defineEmits<{
  (e: 'update:helpSection', section: HelpSection): void
}>()

const navItems: Array<{ id: HelpSection; label: string; icon: string }> = [
  {
    id: 'overview',
    label: 'Overview',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  },
  {
    id: 'annotate',
    label: 'Annotate',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  },
  {
    id: 'design',
    label: 'Design',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12a10 10 0 0 0 .832 4"/></svg>',
  },
  {
    id: 'a11y',
    label: 'Accessibility',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><path d="M7 9h10"/><path d="M12 9v9"/><path d="M9.5 18l2.5-4 2.5 4"/></svg>',
  },
  {
    id: 'perf',
    label: 'Performance',
    icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  },
]

const helpCards: Array<{ id: HelpSection; title: string; desc: string; icon: string }> = [
  {
    id: 'annotate',
    title: 'Annotate',
    desc: 'Pin, arrow, section, and highlight tools to mark up your UI and create tasks',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  },
  {
    id: 'design',
    title: 'Design',
    desc: 'Edit design tokens, inspect element styles, and manage your design system',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="10.5" r="2.5"/><circle cx="8.5" cy="7.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12a10 10 0 0 0 .832 4"/></svg>',
  },
  {
    id: 'a11y',
    title: 'Accessibility',
    desc: 'Run WCAG audits with axe-core and create fix tasks from violations',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="4.5" r="1.5" fill="currentColor" stroke="none"/><path d="M7 9h10"/><path d="M12 9v9"/><path d="M9.5 18l2.5-4 2.5 4"/></svg>',
  },
  {
    id: 'perf',
    title: 'Performance',
    desc: 'Web Vitals, bundle analysis, interaction recording, and error monitoring',
    icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  },
]
</script>
