/**
 * Work-stream blocks — the timeline view the Conversation tab renders.
 *
 * One `ThreadMessage` per assistant turn carries an ordered array of these
 * blocks. The legacy `content: string` field is kept alongside as a flat
 * text rollup so MCP / CLI tail-readers (e.g. `annotask_conversation_read`)
 * still get a sensible plaintext shape; rich UIs read `blocks` instead.
 *
 * Block kinds:
 * - `text`     — assistant prose (markdown). Multiple texts are allowed in
 *                one turn because tool calls split the timeline.
 * - `tool_call`  — agent invoked a tool. `summary` is a one-liner produced
 *                by the toolSummary helper; `input` is the raw arguments.
 * - `tool_result` — paired with a prior `tool_call.id`. `summary` is a
 *                  short preview ("128 lines returned"); `raw` is the
 *                  full content for the expandable panel.
 * - `agent_question` — synthetic block emitted by the shell when the task
 *                     transitions to `needs_info`. Renders read-only with
 *                     a link to the inline answer composer.
 *
 * This file is shared by both the server task-thread store and the shell
 * UI so the wire format has a single source of truth.
 */

export type WorkStreamBlock =
  | { kind: 'text'; text: string }
  | {
      kind: 'tool_call'
      id: string
      name: string
      input: unknown
      /** Human-friendly one-liner (`"Reading App.vue:42-89"`). */
      summary: string
    }
  | {
      kind: 'tool_result'
      /** Pairs with a prior tool_call.id. */
      toolUseId: string
      /** One-line preview, e.g. "128 lines returned" or "Error: …". */
      summary: string
      /** Full raw output. UI shows in an expandable panel. */
      raw: string
      isError?: boolean
    }
  | {
      kind: 'agent_question'
      /** Index into task.agent_feedback for the entry this block represents. */
      entryIndex: number
      /** Short message extracted from the entry (or first question text). */
      label: string
    }
