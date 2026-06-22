/**
 * Shared types for the embedded agent UI surface. These are intentionally
 * narrower than the provider-level types in `src/server/embedded-runner/`
 * (when ANN-3 lands) — the shell only needs the event union it has to render.
 *
 * Keep field names aligned with the Anthropic SDK shape so the real runner can
 * pipe events straight through.
 */

export interface AgentTextDelta {
  kind: 'text'
  /** Append-only text delta. */
  delta: string
}

export interface AgentToolCall {
  kind: 'tool_call'
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AgentToolResult {
  kind: 'tool_result'
  toolUseId: string
  /** Short, human-readable summary for the transcript. Full payload is in `data`. */
  summary: string
  data?: unknown
  isError?: boolean
}

export interface AgentUsage {
  kind: 'usage'
  /** Tokens billed at the standard input rate. */
  input: number
  /** Tokens billed at the output rate. */
  output: number
  /** Tokens served from the prompt cache (billed at 10% of input rate). */
  cacheRead?: number
  /** Tokens written to the prompt cache (billed at 125% of input rate). */
  cacheWrite?: number
}

export interface AgentDone {
  kind: 'done'
  /** Final diff or summary the user is meant to see in silent mode. */
  finalDiff?: string
  /** Optional reason: 'completed' | 'aborted' | 'cap_exceeded' | 'error'. */
  reason: 'completed' | 'aborted' | 'cap_exceeded' | 'error'
  message?: string
}

export type AgentEvent =
  | AgentTextDelta
  | AgentToolCall
  | AgentToolResult
  | AgentUsage
  | AgentDone

export interface AgentRunRequest {
  taskId: string
  /** The change the user wants the agent to apply. */
  task: unknown
  /** Anthropic model id, e.g. 'claude-sonnet-4-5'. */
  model: string
  /** Per-task USD cap. Runner aborts when running total exceeds this. */
  capUsd: number
  /** Caller-provided AbortSignal so the UI can cancel cleanly. */
  signal: AbortSignal
}

export interface AgentRunner {
  /** Async iterable of events. Implementation is expected to honour `signal`. */
  run(req: AgentRunRequest): AsyncIterable<AgentEvent>
}
