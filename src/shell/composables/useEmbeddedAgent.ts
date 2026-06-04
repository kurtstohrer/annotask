/**
 * Embedded agent runner for the per-task Conversation work-stream.
 *
 * One instance per Conversation tab. Drives the active provider, captures
 * the full work-stream timeline (text + tool calls + tool results), and
 * persists each assistant turn as a single `ThreadMessage` with a `blocks`
 * timeline.
 *
 * Flow per turn:
 *   1. Composer calls `send(userText)`.
 *   2. User message appended to thread (HTTP POST → SSE broadcast → all
 *      subscribers, including MCP, see it before the provider does).
 *   3. Provider instantiated via factory.
 *   4. for-await over `provider.stream(...)`. Each event grows
 *      `currentBlocks.value` reactively:
 *        - `text`        → grow the last text block, or push a new one
 *        - `tool_call`   → push a new tool_call block (summary via toolSummary)
 *        - `tool_result` → push a new tool_result block (summary + raw)
 *        - `usage`       → accumulate token totals
 *   5. On `done`, persist a single ThreadMessage with `content` = text-only
 *      rollup and `blocks` = the full timeline. Then drain any queued user
 *      messages — they fire as the next turn.
 *
 * Steering policy:
 *   - User submits while idle → fires `send()` directly.
 *   - User submits while a turn is running → queued for next turn. The
 *     composer surfaces this with a muted "queued" strip.
 *   - User submits while task.status === 'needs_info' → routed through the
 *     answer-mode path (TaskAgentFeedback). The composable does NOT
 *     intercept; the Conversation tab handles answer mode by swapping the
 *     composer.
 */

import { ref, computed, shallowRef, type Ref, type ShallowRef } from 'vue'
import { useProviderSettings } from './useProviderSettings'
import { useAgentConfigs } from './useAgentConfigs'
import { markRunStarted, markRunFinished } from './useAgentMode'
import { useTasks } from './useTasks'
import { makeProvider } from '../../embedded/provider-factory.js'
import { resolveEffectivePermissionMode } from '../../embedded/permission-mode.js'
import { permissionModeSystemPromptPrefix, normalizeHeadlessMode, type InitCliBin } from '../../embedded/permission-mode-flags.js'
import { redactString, redactValue } from '../../embedded/redaction.js'
import type { ProviderMessage, ProviderEvent, ProviderContentBlock } from '../../embedded/provider.js'
import type { PermissionMode } from '../../schema'
import type { WorkStreamBlock } from '../../shared/work-stream'
import { summarizeToolCall, summarizeToolResult } from '../utils/toolSummary'
import { fetchMcpToolCatalog } from '../services/mcpClient'
import type { ThreadMessage, UseTaskThread } from './useTaskThread'

export type RunStatus = 'idle' | 'running' | 'completed' | 'aborted' | 'error'

interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export interface UseEmbeddedAgent {
  status: Ref<RunStatus>
  /** Live work-stream timeline for the in-flight turn. Empty between turns. */
  currentBlocks: ShallowRef<WorkStreamBlock[]>
  /** Cumulative usage across the conversation (informational). */
  usage: Ref<UsageTotals>
  /** Most recent error message. */
  errorMessage: Ref<string | null>
  /** True iff a turn is currently streaming. */
  running: Ref<boolean>
  /** Messages submitted while running, waiting to fire after the current turn. */
  queuedMessages: Ref<string[]>
  /**
   * Send a user message. Fires immediately if idle, else queues for next turn.
   *
   * `isSeed: true` flags the turn as the agent's primary "do this task" run
   * (the prompt is the task description). The composable then apes the
   * canonical annotask flow on the task: lock-on-start (pending|denied →
   * in_progress) and flip-to-review with a resolution on clean completion.
   * Free-form chat turns omit the flag and never touch task.status.
   */
  send(userText: string, opts?: { isSeed?: boolean }): Promise<void>
  /** Remove a queued message by index without firing it. */
  cancelQueued(index: number): void
  abort(): void
}

const SYSTEM_PROMPT_PLACEHOLDER =
  'You are the embedded chat agent inside Annotask. Help the user iterate on the current task. Be concise.'

/** Providers whose spawn pathway can actually apply file edits today. HTTP
 *  API providers (anthropic/openai/openrouter/copilot/paperclip) don't have
 *  a browser-side file-write tool loop yet — seed runs on those providers
 *  get refused with an actionable error. See Phase 3 of the embedded-first
 *  refactor plan. */
const LOCAL_CLI_PROVIDERS = new Set(['claude-local', 'codex-local', 'opencode-local', 'copilot-local'])

function isLocalCliProvider(id: string): boolean {
  return LOCAL_CLI_PROVIDERS.has(id)
}

/**
 * Redact secrets from provider messages before they leave the machine.
 *
 * Applied when `redactionEnabled` is true. Catches provider API keys, PEM
 * private keys, JWTs, bearer tokens, and common env-var secrets — see
 * `redaction.ts` for the full pattern set.
 *
 * Limitation: local CLIs can independently read project files via their
 * tool loop, so redaction here covers only what the shell explicitly sends
 * (system prompt, conversation messages). It is defense-in-depth, not airtight.
 */
function redactMessages(messages: ProviderMessage[]): ProviderMessage[] {
  return messages.map((msg) => {
    if (typeof msg.content === 'string') {
      return { ...msg, content: redactString(msg.content) }
    }
    const blocks: ProviderContentBlock[] = msg.content.map((block) => {
      if (block.type === 'text') return { ...block, text: redactString(block.text) }
      if (block.type === 'tool_result') return { ...block, content: redactString(block.content) }
      // tool_use carries structured `input` (tool arguments) that can contain a
      // secret the model echoed back; walk it with the recursive redactor.
      if (block.type === 'tool_use') return { ...block, input: redactValue(block.input) }
      return block
    })
    return { ...msg, content: blocks }
  })
}

/**
 * Compose the seed prompt sent to the local CLI.
 *
 * Two things go in: the task id (canonical handle) and the description
 * (rendered as a blockquote). Everything else — file, line, component, theme,
 * selected element, screenshot, interaction history, type-specific context —
 * lives behind `annotask_get_task` and the agent fetches what it needs.
 *
 * Why this shape:
 *   - The id is the only field the agent strictly needs; MCP carries the rest.
 *   - The description is decorative for the agent (it'll get a richer copy via
 *     MCP) but **load-bearing for the human** reading the Conversation tab —
 *     without it, the chat thread is just opaque task IDs.
 *   - Also serves as a graceful-degrade fallback when MCP isn't configured:
 *     the agent still has the user's request as plain text.
 *
 * The runner handles status transitions (lock-on-start, mark-review-on-clean-
 * exit), so the agent does NOT need to call `annotask_update_task`.
 */
function buildSeedPrompt(
  task: { id?: string; status?: string; feedback?: string; resolution?: string },
  description: string,
): string {
  const id = task.id ?? '<unknown>'
  const quoted = description
    .trim()
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n')
  // Retry context: when the task is being re-run after a deny, surface the
  // previous attempt's resolution + the user's deny feedback inline so the
  // agent doesn't need to round-trip through `annotask_get_task` to learn
  // what was rejected and why. Same shape for plain `description` blocks
  // (`>` quoted) so the model parses it consistently.
  const isRetry = task.status === 'denied' && (task.feedback ?? '').trim().length > 0
  const retryBlock = isRetry
    ? [
        '',
        '**This is a retry.** Your previous attempt was denied by the user.',
        '',
        'Previous attempt resolution:',
        (task.resolution ?? '(no resolution recorded)').trim().split('\n').map(l => `> ${l}`).join('\n'),
        '',
        'User feedback on the denial:',
        (task.feedback ?? '').trim().split('\n').map(l => `> ${l}`).join('\n'),
        '',
        'Address the feedback specifically — do not repeat the previous approach unless the feedback explicitly asks for a small tweak on top of it.',
      ].join('\n')
    : ''
  return [
    `Apply Annotask task \`${id}\`:`,
    '',
    quoted,
    retryBlock,
    '',
    `Use \`annotask_get_task\` with this id for full context if you need it.`,
    `Annotask handles the status transitions for you — exit cleanly when done, or reply with a short explanation if you can't apply the change.`,
  ].filter(Boolean).join('\n')
}

/**
 * Fetch the task-type-aware system prompt from the dev server. Composes the
 * base `annotask-apply` skill body with the matching task-type companion
 * (A11Y_RULES.md, THEME_UPDATE.md, etc.) so the embedded runner sees the
 * same prompt the MCP `initialize.instructions` payload ships to external
 * editors, plus per-type guidance.
 *
 * Falls back to the built-in placeholder when the bundled skills are missing
 * (older annotask install, dev-mode without skills built) or the endpoint
 * is unreachable — the run still works, it just lacks the apply playbook.
 */
async function fetchSystemPrompt(taskType: string | undefined): Promise<string> {
  try {
    const qs = taskType ? `?task_type=${encodeURIComponent(taskType)}` : ''
    const res = await fetch(`/__annotask/api/system-prompt${qs}`)
    if (!res.ok) return SYSTEM_PROMPT_PLACEHOLDER
    const payload = await res.json() as { prompt?: string }
    const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : ''
    return prompt.length > 0 ? prompt : SYSTEM_PROMPT_PLACEHOLDER
  } catch {
    return SYSTEM_PROMPT_PLACEHOLDER
  }
}

export function useEmbeddedAgent(thread: UseTaskThread): UseEmbeddedAgent {
  const providerSettings = useProviderSettings()
  const agentConfigs = useAgentConfigs()
  const status = ref<RunStatus>('idle')
  const currentBlocks = shallowRef<WorkStreamBlock[]>([])
  const errorMessage = ref<string | null>(null)
  const usage = ref<UsageTotals>({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  const queuedMessages = ref<string[]>([])

  const running = computed(() => status.value === 'running')

  let aborter: AbortController | null = null
  let currentProvider: import('../../embedded/provider.js').LLMProvider | null = null

  function reset() {
    currentBlocks.value = []
    errorMessage.value = null
  }

  /**
   * Grow the last `text` block, or push a new one. Tool calls and results
   * break the run; any text that arrives after a tool starts a fresh block
   * so the UI renders the natural sequence.
   */
  function pushText(delta: string): void {
    const list = currentBlocks.value
    const last = list[list.length - 1]
    if (last && last.kind === 'text') {
      const updated: WorkStreamBlock = { kind: 'text', text: last.text + delta }
      currentBlocks.value = [...list.slice(0, -1), updated]
      return
    }
    currentBlocks.value = [...list, { kind: 'text', text: delta }]
  }

  function pushToolCall(id: string, name: string, input: unknown): void {
    currentBlocks.value = [
      ...currentBlocks.value,
      { kind: 'tool_call', id, name, input, summary: summarizeToolCall(name, input) },
    ]
  }

  function pushToolResult(toolUseId: string, content: string, isError?: boolean): void {
    currentBlocks.value = [
      ...currentBlocks.value,
      {
        kind: 'tool_result',
        toolUseId,
        summary: summarizeToolResult(content, isError),
        raw: content,
        isError,
      },
    ]
  }

  function applyEvent(ev: ProviderEvent): void {
    switch (ev.type) {
      case 'text':
        pushText(ev.text)
        return
      case 'tool_call':
        pushToolCall(ev.id, ev.name, ev.input)
        return
      case 'tool_result':
        pushToolResult(ev.toolUseId, ev.content, ev.isError)
        return
      case 'usage':
        usage.value = {
          input: usage.value.input + ev.inputTokens,
          output: usage.value.output + ev.outputTokens,
          cacheRead: usage.value.cacheRead + (ev.cacheReadTokens ?? 0),
          cacheWrite: usage.value.cacheWrite + (ev.cacheCreationTokens ?? 0),
        }
        return
      // done + error are handled in send() so they affect status/control flow.
      default:
        return
    }
  }

  /**
   * Flatten the blocks into a single text rollup for the legacy `content`
   * field. Tool blocks are summarized inline so MCP tail-readers still see
   * something coherent ("[Tool] Reading App.vue:42-89") even without the
   * rich block surface.
   */
  function rollupText(blocks: WorkStreamBlock[]): string {
    const parts: string[] = []
    for (const b of blocks) {
      if (b.kind === 'text') parts.push(b.text)
      else if (b.kind === 'tool_call') parts.push(`[Tool] ${b.summary}`)
      else if (b.kind === 'tool_result') parts.push(`[Result] ${b.summary}`)
    }
    return parts.join('\n').trim()
  }

  async function runOne(userText: string, isSeed = false): Promise<void> {
    reset()
    status.value = 'running'
    // Broadcast "this task has an active run" so TaskCard can pulse its
    // dot. Independent of the task's persisted `status` field — the agent
    // doesn't always call annotask_update_task to flip status, especially
    // in chat-only flows.
    const taskId = thread.taskId.value
    if (taskId) markRunStarted(taskId)

    // Resolve persona + provider up front so we can gate HTTP-only providers
    // out of the apply path. Personas bundle provider + model + effort +
    // system-prompt extras; the fallback uses the global `activeProvider`
    // settings so legacy behavior holds when no persona matches.
    const currentTask = taskId ? useTasks().tasks.value.find((t) => t.id === taskId) : undefined
    const taskType = currentTask && typeof currentTask.type === 'string' ? currentTask.type : undefined
    const persona = isSeed ? providerSettings.getPersonaForTaskType(taskType) : null

    const activeProviderId = persona?.providerId ?? providerSettings.activeProvider.value
    const activeCfg = providerSettings.settings.value.providers[activeProviderId]
    const activeModel = (persona && persona.model.length > 0 ? persona.model : activeCfg.model) ?? ''
    const activeEffort = persona && persona.effort !== 'auto' ? persona.effort : activeCfg.effort

    // Phase 3 v1: only local CLIs can apply tasks (they have native file-edit
    // tools and the spawn `cwd` lands them in the project root). HTTP-only
    // providers have no file-write path yet, so refuse the seed run and tell
    // the user how to fix it.
    if (isSeed && !isLocalCliProvider(activeProviderId)) {
      status.value = 'error'
      errorMessage.value = `${activeProviderId} can't apply tasks yet — pick a persona that uses a local CLI (claude-local, codex-local, opencode-local) in Settings → Agents.`
      if (taskId) markRunFinished(taskId)
      return
    }

    // Seed runs ape the canonical annotask lifecycle: lock the task on
    // start (pending|denied → in_progress) and flip to review on clean
    // completion. Free-form chat turns (isSeed = false) leave status alone.
    if (isSeed && taskId) {
      await lockTaskOnStart(taskId)
    }

    // Enrich the seed prompt with task grounding so the CLI has file/line
    // anchors without having to round-trip through MCP. Free-form chat is
    // sent verbatim.
    const promptToSend = isSeed && currentTask ? buildSeedPrompt(currentTask, userText) : userText

    try {
      await thread.append({ role: 'user', content: promptToSend })
    } catch (err) {
      status.value = 'error'
      errorMessage.value = `Failed to record user message: ${(err as Error).message}`
      if (taskId) markRunFinished(taskId)
      return
    }

    const history = toProviderMessages(thread.messages.value)

    // Pre-warm the MCP tool catalog so the first tool-using turn (Phase 3+)
    // doesn't pay an extra round-trip. Errors are non-fatal — the catalog
    // fetch is best-effort.
    fetchMcpToolCatalog().catch(() => {})

    const baseSystemPrompt = await fetchSystemPrompt(taskType)
    // Compose persona system-prompt layers in order:
    //   skill+companion  →  projectDirections (the single per-agent blob)
    //   →  systemPromptExtras (custom persona overrides)
    // projectDirections is the only instruction set the user sees and edits;
    // it's written by the init CLI from `BUILT_IN_PERSONAS[].roleDirections`
    // (used as a reference template, not a runtime layer). roleDirections is
    // kept here as a safety-net fallback for the rare case projectDirections
    // is empty (e.g. before init has ever run).
    const personaRole = persona?.roleDirections?.trim() ?? ''
    const projectDirections = persona
      ? (agentConfigs.configs.value[persona.id]?.projectDirections ?? '').trim()
      : ''
    const personaExtras = persona?.systemPromptExtras?.trim() ?? ''
    const layers = [baseSystemPrompt]
    if (projectDirections.length > 0) layers.push(projectDirections)
    else if (personaRole.length > 0) layers.push(personaRole)
    if (personaExtras.length > 0) layers.push(personaExtras)
    const systemPrompt = layers.join('\n\n---\n\n')

    let provider: import('../../embedded/provider.js').LLMProvider
    try {
      // If a persona is active and selects a different provider than the
      // global active one, fork the settings so makeProvider keys off the
      // persona's choice without mutating the user's persisted activeProvider.
      const settingsForCall = persona && persona.providerId !== providerSettings.settings.value.activeProvider
        ? { ...providerSettings.settings.value, activeProvider: persona.providerId }
        : providerSettings.settings.value
      provider = makeProvider(settingsForCall, {
        referer: typeof window !== 'undefined' ? window.location.origin : undefined,
        appTitle: 'Annotask',
      })
      currentProvider = provider
    } catch (err) {
      status.value = 'error'
      errorMessage.value = (err as Error).message
      return
    }

    aborter = new AbortController()
    let stopReason: string | undefined

    // Resolve the effective permission mode (task ?? provider ?? global).
    // Local-CLI providers translate the mode to their own permission flag at
    // spawn time. HTTP/API providers currently ignore it (no client-side
    // write tools wired).
    const taskPermissionMode = currentTask?.permissionMode
    const providerPermissionMode = (activeCfg as { permissionMode?: PermissionMode }).permissionMode
    const resolvedPermissionMode = resolveEffectivePermissionMode(
      taskPermissionMode,
      providerPermissionMode,
      providerSettings.settings.value.permissionMode,
    )
    // Local CLIs run headless, so `'default'` ("Auto") escalates to the
    // per-CLI working mode: bypass on claude/opencode (no headless ask-mode),
    // while codex/copilot keep their safer sandboxed/minimal `default`. HTTP
    // providers ignore permission mode entirely.
    const cliBin: InitCliBin | null = activeProviderId.endsWith('-local')
      ? (activeProviderId.slice(0, -'-local'.length) as InitCliBin)
      : null
    const effectivePermissionMode = cliBin
      ? normalizeHeadlessMode(resolvedPermissionMode, cliBin)
      : resolvedPermissionMode

    // Plan mode needs model-level enforcement on opencode/copilot (no native
    // read-only flag in their headless modes). Prepend a strong directive so
    // the model refuses write tools on its own. Claude/codex still get
    // CLI/sandbox enforcement on top via `permissionMode` below.
    const permissionPrefix = permissionModeSystemPromptPrefix(effectivePermissionMode)
    const systemPromptWithPermission = permissionPrefix
      ? `${permissionPrefix}\n\n---\n\n${systemPrompt}`
      : systemPrompt

    // Redact secrets from outgoing messages/prompt when enabled.
    const redact = providerSettings.settings.value.redactionEnabled
    const outHistory = redact ? redactMessages(history) : history
    const outSystemPrompt = redact ? redactString(systemPromptWithPermission) : systemPromptWithPermission

    const logEnabled = providerSettings.settings.value.eventLogEnabled
    const { eventLog } = providerSettings
    const conversationId = taskId ?? 'chat'
    const turnStartTime = Date.now()

    // Stream the turn as a single *partial* assistant message: append it now
    // (empty) and patch it in place as events arrive. This is the only channel
    // by which an observer that isn't this exact instance — a Conversation tab
    // that attached mid-run, an external MCP tail-reader, the running-timer in
    // another tab — sees live progress. `currentBlocks` (below) stays the
    // smooth local surface for the tab that owns the run.
    let partialId: string | null = null
    try {
      const seed = await thread.append({
        role: 'assistant',
        content: '',
        providerId: activeProviderId,
        model: activeModel,
        isPartial: true,
        lastEventAt: turnStartTime,
      })
      partialId = seed.id
    } catch {
      // Non-fatal: fall back to the single post-turn write (still works, just
      // not streamed). partialId stays null and the final persist re-appends.
    }

    // Throttled flush of the live blocks into the partial message (~300ms).
    let lastEventAt = turnStartTime
    let lastFlushedBlocks: WorkStreamBlock[] | null = null
    let flushing = false
    async function flushPartial(final: boolean): Promise<void> {
      if (!partialId) return
      if (flushing && !final) return
      const blocks = currentBlocks.value
      if (!final && blocks === lastFlushedBlocks) return // nothing new since last flush
      flushing = true
      lastFlushedBlocks = blocks
      try {
        await thread.update(partialId, {
          content: rollupText(blocks),
          blocks,
          lastEventAt,
          ...(final
            ? {
                isPartial: false,
                usage: {
                  inputTokens: usage.value.input,
                  outputTokens: usage.value.output,
                  cacheReadTokens: usage.value.cacheRead,
                  cacheCreationTokens: usage.value.cacheWrite,
                },
              }
            : {}),
        })
      } catch {
        // Best-effort mid-stream; the final flush re-tries and its error
        // (if any) surfaces below.
      } finally {
        flushing = false
      }
    }
    const flushTimer = partialId ? setInterval(() => { void flushPartial(false) }, 300) : null

    // Stall watchdog. `idleTimeoutMs` aborts a run that stops producing output;
    // `maxRunDurationMs` is an absolute ceiling. Either triggers `aborter.abort()`
    // and records a reason so the post-loop block can explain + unblock the queue.
    // `0` disables that timer.
    const idleMs = providerSettings.settings.value.idleTimeoutMs
    const maxMs = providerSettings.settings.value.maxRunDurationMs
    let watchdogReason: 'idle-timeout' | 'max-duration' | null = null
    const idleTimer = idleMs > 0
      ? setInterval(() => {
          if (Date.now() - lastEventAt > idleMs) {
            watchdogReason = watchdogReason ?? 'idle-timeout'
            aborter?.abort()
          }
        }, Math.max(1000, Math.min(idleMs, 15_000)))
      : null
    const maxTimer = maxMs > 0
      ? setTimeout(() => {
          watchdogReason = watchdogReason ?? 'max-duration'
          aborter?.abort()
        }, maxMs)
      : null
    function clearWatchdog(): void {
      if (flushTimer) clearInterval(flushTimer)
      if (idleTimer) clearInterval(idleTimer)
      if (maxTimer) clearTimeout(maxTimer)
    }

    try {
      for await (const ev of provider.stream(outHistory, [], {
        systemPrompt: outSystemPrompt,
        signal: aborter.signal,
        model: activeModel || undefined,
        effort: activeEffort,
        permissionMode: effectivePermissionMode,
        // Lets the server key its run registry by task: one live run per task
        // (no cross-tab double-spawn) + orphaned-task finalization.
        taskId: taskId ?? undefined,
      })) {
        lastEventAt = Date.now()
        applyEvent(ev)
        if (ev.type === 'tool_call' && logEnabled) {
          eventLog.appendToolCall({
            conversationId,
            provider: activeProviderId,
            model: activeModel || 'default',
            toolName: ev.name,
            toolUseId: ev.id,
            input: ev.input,
          })
        } else if (ev.type === 'error') {
          errorMessage.value = ev.error
          stopReason = stopReason ?? 'error'
          if (logEnabled) {
            eventLog.append({
              kind: 'error',
              conversationId,
              provider: activeProviderId,
              model: activeModel || 'default',
              reason: 'provider_error',
              detail: ev.error,
            })
          }
        } else if (ev.type === 'done') {
          if (!stopReason) stopReason = ev.stopReason
        }
      }
    } catch (err) {
      stopReason = stopReason ?? 'error'
      errorMessage.value = errorMessage.value ?? (err as Error).message
    } finally {
      clearWatchdog()
    }

    // A watchdog abort masquerades as a generic abort to the stream; promote
    // it to its own stop reason and a human-readable message so observers
    // understand the run was killed for inactivity / duration, not by the user.
    if (watchdogReason) {
      stopReason = 'aborted'
      const idleSecs = Math.round(idleMs / 1000)
      const maxMins = Math.round(maxMs / 60_000)
      errorMessage.value = watchdogReason === 'idle-timeout'
        ? `Run cancelled: no output for ${idleSecs}s.`
        : `Run cancelled: exceeded the ${maxMins}-minute limit.`
    }

    // Log the completed turn to the local event log.
    if (logEnabled) {
      eventLog.append({
        kind: 'turn',
        conversationId,
        provider: activeProviderId,
        model: activeModel || 'default',
        inputTokens: usage.value.input,
        outputTokens: usage.value.output,
        cacheReadTokens: usage.value.cacheRead || undefined,
        cacheCreationTokens: usage.value.cacheWrite || undefined,
        latencyMs: Date.now() - turnStartTime,
        stopReason: stopReason ?? 'end_turn',
      })
    }

    // Persist the turn. With a partial message in flight we flush it one last
    // time (clears `isPartial`, attaches final usage). Without one (the seed
    // append failed earlier) we fall back to the legacy single append. The
    // block timeline is the rich surface; `content` is a flat text rollup so
    // MCP / CLI tail-readers still see meaningful output without parsing blocks.
    const blocks = currentBlocks.value
    if (partialId) {
      await flushPartial(true)
    } else if (blocks.length > 0) {
      try {
        await thread.append({
          role: 'assistant',
          content: rollupText(blocks),
          providerId: activeProviderId,
          model: activeModel,
          usage: {
            inputTokens: usage.value.input,
            outputTokens: usage.value.output,
            cacheReadTokens: usage.value.cacheRead,
            cacheCreationTokens: usage.value.cacheWrite,
          },
          blocks,
        })
      } catch (err) {
        errorMessage.value = errorMessage.value ?? `Failed to record assistant turn: ${(err as Error).message}`
      }
    }

    // Surface a watchdog stall as a system message so it's part of the
    // persisted transcript (visible to every observer + MCP tail-readers).
    if (watchdogReason && errorMessage.value) {
      try {
        await thread.append({ role: 'system', content: errorMessage.value })
      } catch { /* best-effort */ }
    }

    const finalBlocks = blocks
    currentBlocks.value = []
    aborter = null
    currentProvider = null
    status.value =
      stopReason === 'aborted' ? 'aborted'
      : stopReason === 'error' ? 'error'
      : 'completed'

    if (isSeed && taskId && watchdogReason) {
      // A stalled/timed-out seed run lands the task in `blocked` (not `pending`)
      // so the auto-run driver won't immediately re-queue it into the same
      // stall — a human reviews the reason and retries deliberately.
      await markTaskBlocked(taskId, errorMessage.value ?? 'Run cancelled by the stall watchdog.')
    } else if (isSeed && taskId && status.value === 'completed') {
      await markTaskForReview(taskId, finalBlocks)
    }

    if (taskId) markRunFinished(taskId)
  }

  /**
   * Lock the task at the start of a seed run. The annotask lifecycle requires
   * `pending → in_progress` (or `denied → in_progress` on retry) before
   * `→ review` is allowed at completion. Anything else (review/accepted/
   * needs_info/blocked/in_progress) we leave alone — the agent is iterating,
   * resuming, or the user already has a pending action.
   */
  async function lockTaskOnStart(taskId: string): Promise<void> {
    try {
      const taskSystem = useTasks()
      const current = taskSystem.tasks.value.find((t) => t.id === taskId)
      if (!current) return
      if (current.status !== 'pending' && current.status !== 'denied') return
      await taskSystem.updateTaskStatus(taskId, 'in_progress')
    } catch (err) {
      // Surface in the conversation error strip, don't abort the run — the
      // agent should still try to do useful work even if the lock fails.
      errorMessage.value = `Couldn't lock task: ${(err as Error).message}`
    }
  }

  /**
   * On clean seed-run completion, flip the task to `review` with the agent's
   * final text block as the resolution. Skips if the task drifted to another
   * status mid-run (e.g. the agent paused via `needs_info`) — those
   * transitions aren't valid from `in_progress → review` and the server
   * would reject them anyway.
   */
  async function markTaskForReview(taskId: string, blocks: WorkStreamBlock[]): Promise<void> {
    try {
      const taskSystem = useTasks()
      const current = taskSystem.tasks.value.find((t) => t.id === taskId)
      if (!current || current.status !== 'in_progress') return
      const resolution = extractResolution(blocks)
      await taskSystem.updateTaskStatus(taskId, 'review', undefined, { resolution })
    } catch (err) {
      errorMessage.value = `Couldn't mark task for review: ${(err as Error).message}`
    }
  }

  /**
   * Flip a seed run's task to `blocked` after the stall watchdog killed it.
   * `blocked` is terminal for the auto-run queue (not re-drained), so a task
   * that consistently stalls can't loop. Only transitions from `in_progress`
   * (the lock the seed run took) — anything else the agent moved deliberately.
   */
  async function markTaskBlocked(taskId: string, reason: string): Promise<void> {
    try {
      const taskSystem = useTasks()
      const current = taskSystem.tasks.value.find((t) => t.id === taskId)
      if (!current || current.status !== 'in_progress') return
      await taskSystem.updateTaskStatus(taskId, 'blocked', undefined, { blocked_reason: reason })
    } catch (err) {
      errorMessage.value = `Couldn't mark task blocked: ${(err as Error).message}`
    }
  }

  /**
   * Pick the resolution string for the `review` transition: prefer the last
   * `text` block (the agent's natural sign-off), fall back to a synthesized
   * one-liner from the tool summaries when the agent only worked silently.
   */
  function extractResolution(blocks: WorkStreamBlock[]): string {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i]
      if (b.kind === 'text') {
        const t = b.text.trim()
        if (t.length > 0) return t
      }
    }
    // No text block — synthesize from tool calls so the resolution field
    // isn't blank.
    const summaries: string[] = []
    for (const b of blocks) {
      if (b.kind === 'tool_call') summaries.push(b.summary)
    }
    if (summaries.length === 0) return 'Done.'
    if (summaries.length <= 3) return summaries.join('; ')
    return `${summaries.slice(0, 3).join('; ')}; +${summaries.length - 3} more`
  }

  /**
   * Public entry point. If idle, fires the turn directly. If a turn is
   * running, the message is queued and fires after the current turn ends.
   * Once `runOne()` returns, drain the queue so chained messages fire one
   * after the other.
   *
   * `opts.isSeed` distinguishes the seed run (prompt = task description)
   * from free-form chat. Only seed runs touch task.status. Queued messages
   * are always free-form turns — the seed always fires immediately or not
   * at all (the auto-run driver enforces concurrency at the driver layer).
   */
  async function send(userText: string, opts: { isSeed?: boolean } = {}): Promise<void> {
    const trimmed = userText.trim()
    if (!trimmed) return

    if (status.value === 'running') {
      queuedMessages.value = [...queuedMessages.value, trimmed]
      return
    }

    await runOne(trimmed, opts.isSeed === true)

    // Drain the queue. Queued items are free-form (no isSeed) — they
    // shouldn't bounce the task through status transitions.
    while (queuedMessages.value.length > 0 && status.value !== 'error') {
      const [next, ...rest] = queuedMessages.value
      queuedMessages.value = rest
      await runOne(next, false)
    }
  }

  function cancelQueued(index: number): void {
    if (index < 0 || index >= queuedMessages.value.length) return
    queuedMessages.value = [
      ...queuedMessages.value.slice(0, index),
      ...queuedMessages.value.slice(index + 1),
    ]
  }

  function abort(): void {
    if (aborter) aborter.abort()
    // Kill the CLI subprocess server-side so it doesn't linger after the
    // browser-side fetch is aborted. Falls back to req.on('close') if the
    // explicit DELETE doesn't reach the server in time.
    currentProvider?.abortRun?.()
  }

  return {
    status,
    currentBlocks,
    usage,
    errorMessage,
    running,
    queuedMessages,
    send,
    cancelQueued,
    abort,
  }
}

/**
 * Flatten the persisted thread into the provider-agnostic shape `LLMProvider`
 * expects. System messages are dropped — the system prompt is handed in via
 * `StreamOptions.systemPrompt` instead. Tool messages are excluded since
 * each provider's tool loop runs in its own sandbox.
 */
function toProviderMessages(messages: ThreadMessage[]): ProviderMessage[] {
  const out: ProviderMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.role === 'tool') continue
    out.push({ role: m.role, content: m.content })
  }
  return out
}
