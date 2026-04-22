import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import nodePath from 'node:path'
import { createRuntimeEndpointStore } from '../runtime-endpoints.js'
import type { NetworkCall } from '../../schema.js'

let root: string

beforeEach(async () => {
  root = await fsp.mkdtemp(nodePath.join(os.tmpdir(), 'annotask-rt-lat-'))
})

afterEach(async () => {
  if (root && fs.existsSync(root)) await fsp.rm(root, { recursive: true, force: true })
})

let nextId = 0
function call(durationMs: number, route = '/x', extra: Partial<NetworkCall> = {}): NetworkCall {
  return {
    id: `c${++nextId}`,
    initiator: 'fetch',
    url: 'http://api.example.com/foo',
    method: 'GET',
    origin: 'http://api.example.com',
    path: '/foo',
    pathNoQuery: '/foo',
    route,
    startedAt: Date.now(),
    durationMs,
    status: 200,
    ...extra,
  }
}

describe('runtime endpoint latency aggregation', () => {
  it('records avgMs / maxMs / latencySamples from completed calls', () => {
    const store = createRuntimeEndpointStore(root)
    store.ingest([call(100), call(200), call(300)])
    const ep = store.getCatalog().endpoints[0]
    expect(ep.latencySamples).toBe(3)
    expect(ep.avgMs).toBeCloseTo(200, 5)
    expect(ep.maxMs).toBe(300)
  })

  it('ignores calls with no durationMs (still pending) but counts them', () => {
    const store = createRuntimeEndpointStore(root)
    store.ingest([
      call(100),
      { ...call(0), durationMs: undefined } as NetworkCall,
      call(300),
    ])
    const ep = store.getCatalog().endpoints[0]
    expect(ep.count).toBe(3)
    expect(ep.latencySamples).toBe(2)
    expect(ep.avgMs).toBeCloseTo(200, 5)
    expect(ep.maxMs).toBe(300)
  })

  it('streams the mean stably across separate ingest batches', () => {
    const store = createRuntimeEndpointStore(root)
    store.ingest([call(100), call(200)])
    store.ingest([call(900)])
    const ep = store.getCatalog().endpoints[0]
    expect(ep.latencySamples).toBe(3)
    expect(ep.avgMs).toBeCloseTo(400, 5)
    expect(ep.maxMs).toBe(900)
  })

  it('endpoints with no timed samples have undefined avgMs/maxMs', () => {
    const store = createRuntimeEndpointStore(root)
    store.ingest([{ ...call(0), durationMs: undefined } as NetworkCall])
    const ep = store.getCatalog().endpoints[0]
    expect(ep.count).toBe(1)
    expect(ep.avgMs).toBeUndefined()
    expect(ep.maxMs).toBeUndefined()
    expect(ep.latencySamples).toBeUndefined()
  })
})
