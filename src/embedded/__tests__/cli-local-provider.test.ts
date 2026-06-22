import { describe, it, expect } from 'vitest'
import { mapClaudeEvent } from '../claude-local-provider.js'
import { mapCodexEvent } from '../codex-local-provider.js'
import { mapOpencodeEvent } from '../opencode-local-provider.js'
import { mapCopilotEvent } from '../copilot-local-provider.js'
import { ClaudeLocalProvider } from '../claude-local-provider.js'
import type { ProviderEvent } from '../provider.js'

describe('mapClaudeEvent', () => {
  it('emits text events for assistant message content blocks', () => {
    const out = mapClaudeEvent({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello world' }] },
    })
    expect(out).toEqual([{ type: 'text', text: 'hello world' }])
  })

  it('emits tool_call for assistant tool_use blocks', () => {
    const out = mapClaudeEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Let me read it.' },
          { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: 'App.vue' } },
        ],
      },
    })
    expect(out).toEqual([
      { type: 'text', text: 'Let me read it.' },
      { type: 'tool_call', id: 'toolu_01', name: 'Read', input: { file_path: 'App.vue' } },
    ])
  })

  it('emits tool_result from synthetic user messages', () => {
    const out = mapClaudeEvent({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_01', content: 'export default …', is_error: false },
        ],
      },
    })
    expect(out).toEqual([
      { type: 'tool_result', toolUseId: 'toolu_01', content: 'export default …', isError: undefined },
    ])
  })

  it('flattens block-array tool_result content into a single string', () => {
    const out = mapClaudeEvent({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_02',
            content: [
              { type: 'text', text: 'line one' },
              { type: 'text', text: 'line two' },
            ] as unknown as string, // wider field shape; runtime accepts arrays
          },
        ],
      },
    })
    expect(out[0]).toMatchObject({ type: 'tool_result', toolUseId: 'toolu_02', content: 'line one\nline two' })
  })

  it('marks tool_result.isError true when is_error=true', () => {
    const out = mapClaudeEvent({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'oops', is_error: true }] },
    })
    expect(out[0]).toMatchObject({ type: 'tool_result', isError: true })
  })

  it('emits usage with cache buckets when present', () => {
    const out = mapClaudeEvent({
      type: 'assistant',
      message: {
        content: [],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 5,
        },
      },
    })
    expect(out).toContainEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 20,
      cacheCreationTokens: 5,
    })
  })

  it('ignores unrecognised event types', () => {
    expect(mapClaudeEvent({ type: 'system' })).toEqual([])
    expect(mapClaudeEvent({ type: 'unknown_future_type' })).toEqual([])
  })
})

describe('mapCodexEvent', () => {
  it('emits text for completed assistant_message items', () => {
    const out = mapCodexEvent({
      type: 'item.completed',
      item: { item_type: 'assistant_message', text: 'codex says hi' },
    })
    expect(out).toEqual([{ type: 'text', text: 'codex says hi' }])
  })

  it('emits tool_call for function_call items with JSON arguments', () => {
    const out = mapCodexEvent({
      type: 'item.completed',
      item: {
        item_type: 'function_call',
        id: 'call_42',
        name: 'apply_patch',
        arguments: '{"path":"src/App.vue"}',
      },
    })
    expect(out).toEqual([
      { type: 'tool_call', id: 'call_42', name: 'apply_patch', input: { path: 'src/App.vue' } },
    ])
  })

  it('emits tool_result for function_call_output items', () => {
    const out = mapCodexEvent({
      type: 'item.completed',
      item: { item_type: 'function_call_output', call_id: 'call_42', output: 'patched' },
    })
    expect(out).toEqual([
      { type: 'tool_result', toolUseId: 'call_42', content: 'patched', isError: undefined },
    ])
  })

  it('flags tool_result isError when exit_code is non-zero', () => {
    const out = mapCodexEvent({
      type: 'item.completed',
      item: { item_type: 'function_call_output', call_id: 'c1', output: 'fail', exit_code: 1 },
    })
    expect(out[0]).toMatchObject({ type: 'tool_result', isError: true })
  })

  it('emits a Bash tool_call + tool_result pair for command_execution', () => {
    const out = mapCodexEvent({
      type: 'item.completed',
      item: { item_type: 'command_execution', id: 'cmd_1', command: 'npm test', output: 'OK', exit_code: 0 },
    })
    expect(out).toEqual([
      { type: 'tool_call', id: 'cmd_1', name: 'Bash', input: { command: 'npm test' } },
      { type: 'tool_result', toolUseId: 'cmd_1', content: 'OK', isError: undefined },
    ])
  })

  it('emits usage on turn.completed', () => {
    const out = mapCodexEvent({
      type: 'turn.completed',
      usage: { input_tokens: 7, output_tokens: 11, cached_input_tokens: 3 },
    })
    expect(out).toEqual([{ type: 'usage', inputTokens: 7, outputTokens: 11, cacheReadTokens: 3 }])
  })

  it('ignores unrecognised item types', () => {
    const out = mapCodexEvent({ type: 'item.completed', item: { item_type: 'weird_future_item' } })
    expect(out).toEqual([])
  })
})

describe('mapOpencodeEvent', () => {
  it('accepts {type:"text", text}', () => {
    expect(mapOpencodeEvent({ type: 'text', text: 'hi' })).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('accepts string content', () => {
    expect(mapOpencodeEvent({ type: 'message', content: 'hi' })).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('emits tool_call + tool_result from content blocks', () => {
    expect(mapOpencodeEvent({
      type: 'message',
      content: [
        { type: 'text', text: 'a' },
        { type: 'tool_use', id: 'u1', name: 'Read', input: { file_path: 'x' } },
        { type: 'text', text: 'b' },
        { type: 'tool_result', tool_use_id: 'u1', content: 'contents', is_error: false },
      ],
    })).toEqual([
      { type: 'text', text: 'a' },
      { type: 'tool_call', id: 'u1', name: 'Read', input: { file_path: 'x' } },
      { type: 'text', text: 'b' },
      { type: 'tool_result', toolUseId: 'u1', content: 'contents', isError: undefined },
    ])
  })

  it('emits top-level tool_call / tool_result envelopes', () => {
    expect(mapOpencodeEvent({ type: 'tool_call', id: 'a', name: 'Bash', input: { command: 'ls' } }))
      .toEqual([{ type: 'tool_call', id: 'a', name: 'Bash', input: { command: 'ls' } }])
    expect(mapOpencodeEvent({ type: 'tool_result', call_id: 'a', output: 'README.md' }))
      .toEqual([{ type: 'tool_result', toolUseId: 'a', content: 'README.md', isError: undefined }])
  })

  it('reads text from the v1.14+ part envelope', () => {
    expect(mapOpencodeEvent({
      type: 'text',
      part: { type: 'text', text: 'ok' },
    })).toEqual([{ type: 'text', text: 'ok' }])
  })

  it('emits usage from a v1.14+ step_finish event', () => {
    expect(mapOpencodeEvent({
      type: 'step_finish',
      part: {
        type: 'step-finish',
        tokens: { input: 1583, output: 7, cache: { read: 9728, write: 0 } },
      },
    })).toEqual([{
      type: 'usage',
      inputTokens: 1583,
      outputTokens: 7,
      cacheReadTokens: 9728,
      cacheCreationTokens: 0,
    }])
  })
})

describe('mapCopilotEvent', () => {
  it('emits text from a message_delta event', () => {
    expect(mapCopilotEvent({
      type: 'assistant.message_delta',
      data: { messageId: 'm1', deltaContent: 'ok' },
    })).toEqual([{ type: 'text', text: 'ok' }])
  })

  it('emits a tool_call from toolRequests on assistant.message', () => {
    const out = mapCopilotEvent({
      type: 'assistant.message',
      data: {
        messageId: 'm1',
        content: '',
        outputTokens: 4,
        toolRequests: [{ id: 't1', name: 'Bash', arguments: '{"command":"ls"}' }],
      },
    })
    expect(out).toEqual([
      { type: 'tool_call', id: 't1', name: 'Bash', input: { command: 'ls' } },
      { type: 'usage', inputTokens: 0, outputTokens: 4 },
    ])
  })

  it('ignores noise events (session.*, user.message, …) silently', () => {
    expect(mapCopilotEvent({ type: 'session.skills_loaded' })).toEqual([])
    expect(mapCopilotEvent({ type: 'user.message', data: { content: 'hi' } })).toEqual([])
    expect(mapCopilotEvent({ type: 'assistant.reasoning', data: {} })).toEqual([])
  })
})

describe('ClaudeLocalProvider end-to-end via fake fetch', () => {
  it('streams text + usage + done from a fixture SSE stream', async () => {
    const sse = [
      'event: stdout',
      `data: ${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } })}`,
      '',
      'event: stdout',
      `data: ${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: ' world' }] } })}`,
      '',
      'event: stdout',
      `data: ${JSON.stringify({
        type: 'result',
        usage: { input_tokens: 10, output_tokens: 2 },
      })}`,
      '',
      'event: exit',
      'data: {"code":0,"signal":null}',
      '',
      '',
    ].join('\n')

    const fakeResponse = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse))
        controller.close()
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })

    const fakeFetch: typeof fetch = async () => fakeResponse
    const provider = new ClaudeLocalProvider({ fetchImpl: fakeFetch })

    const events: ProviderEvent[] = []
    for await (const ev of provider.stream(
      [{ role: 'user', content: 'hi' }],
      [],
      { systemPrompt: '' },
    )) {
      events.push(ev)
    }

    // Text deltas in order, usage, done.
    const texts = events.filter((e): e is { type: 'text'; text: string } => e.type === 'text').map((e) => e.text)
    expect(texts.join('')).toBe('Hello world')
    expect(events.some((e) => e.type === 'usage' && e.inputTokens === 10 && e.outputTokens === 2)).toBe(true)
    expect(events[events.length - 1]).toMatchObject({ type: 'done' })
  })

  it('maps a 409 task_already_running to a benign done:already_running (never an error)', async () => {
    // Another tab owns the live run. The losing run must NOT emit an error —
    // an error reverts the task to pending and yanks the winner's run.
    const body = JSON.stringify({ error: { code: 'task_already_running', message: 'Task task-1 is already running in another tab or session.' } })
    const fakeFetch: typeof fetch = async () =>
      new Response(body, { status: 409, headers: { 'Content-Type': 'application/json' } })
    const provider = new ClaudeLocalProvider({ fetchImpl: fakeFetch })

    const events: ProviderEvent[] = []
    for await (const ev of provider.stream([{ role: 'user', content: 'hi' }], [], { systemPrompt: '', taskId: 'task-1' })) {
      events.push(ev)
    }

    expect(events.some((e) => e.type === 'error')).toBe(false)
    expect(events).toEqual([{ type: 'done', stopReason: 'already_running' }])
  })

  it('still maps other non-ok spawn responses to an error + done', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response('boom', { status: 500, headers: { 'Content-Type': 'text/plain' } })
    const provider = new ClaudeLocalProvider({ fetchImpl: fakeFetch })

    const events: ProviderEvent[] = []
    for await (const ev of provider.stream([{ role: 'user', content: 'hi' }], [], { systemPrompt: '' })) {
      events.push(ev)
    }
    expect(events.some((e) => e.type === 'error')).toBe(true)
    expect(events[events.length - 1]).toMatchObject({ type: 'done', stopReason: 'error' })
  })
})
