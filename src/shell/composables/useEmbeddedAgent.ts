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
import type { ProviderMessage, ProviderEvent } from '../../embedded/provider.js'
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

/** Compose the seed prompt sent to the local CLI. The CLI sees task id,
 *  type, file/line anchors, and the user-authored description — enough to
 *  find the target without round-tripping through MCP. The runner handles
 *  the status lifecycle (lock-on-start, mark-review-on-clean-exit), so the
 *  CLI doesn't need to call `annotask_update_task`. */
function buildSeedPrompt(task: { id?: string; type?: string; file?: string | null; line?: number | null; component?: string | null }, description: string): string {
  const lines: string[] = []
  lines.push(`Apply annotask task ${task.id ?? '<unknown>'} (type: ${task.type ?? 'unknown'}).`)
  if (task.file) {
    const at = task.line ? `:${task.line}` : ''
    lines.push(`File: ${task.file}${at}`)
  }
  if (task.component) {
    lines.push(`Component: ${task.component}`)
  }
  lines.push('')
  lines.push(description.trim())
  lines.push('')
  lines.push('Use your file-edit tools to make the change. The annotask runner will mark the task for review when you exit cleanly. If you cannot apply the change, exit with a short explanation.')
  return lines.join('\n')
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

    let provider
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
    } catch (err) {
      status.value = 'error'
      errorMessage.value = (err as Error).message
      return
    }

    aborter = new AbortController()
    let stopReason: string | undefined

    try {
      for await (const ev of provider.stream(history, [], {
        systemPrompt,
        signal: aborter.signal,
        model: activeModel || undefined,
        effort: activeEffort,
      })) {
        applyEvent(ev)
        if (ev.type === 'error') {
          errorMessage.value = ev.error
          stopReason = stopReason ?? 'error'
        } else if (ev.type === 'done') {
          if (!stopReason) stopReason = ev.stopReason
        }
      }
    } catch (err) {
      stopReason = stopReason ?? 'error'
      errorMessage.value = errorMessage.value ?? (err as Error).message
    }

    // Persist the turn. The block timeline is the rich surface; `content` is
    // a flat text rollup so MCP / CLI tail-readers (annotask_conversation_read)
    // still see meaningful output without parsing blocks.
    const blocks = currentBlocks.value
    if (blocks.length > 0) {
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

    const finalBlocks = blocks
    currentBlocks.value = []
    aborter = null
    status.value =
      stopReason === 'aborted' ? 'aborted'
      : stopReason === 'error' ? 'error'
      : 'completed'

    if (isSeed && taskId && status.value === 'completed') {
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
