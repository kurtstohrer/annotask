// Stress-lab Node service — product catalog backend.
//
// Fastify + @fastify/swagger together build an OpenAPI 3 document from the
// per-route `schema` objects. That document is exposed at /openapi.json so
// annotask's schema scanner picks it up automatically once the service is
// running (see docker-compose port mapping 4340:4340).

import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'

const PORT = Number(process.env.PORT ?? 4340)

const fastify = Fastify({ logger: false })

await fastify.register(cors, { origin: '*' })
await fastify.register(swagger, {
  openapi: {
    info: {
      title: 'Annotask Stress Lab — node-api',
      description: 'Products backend for the React workflows + sidebar MFEs.',
      version: '0.0.1',
    },
    servers: [{ url: `http://localhost:${PORT}` }],
  },
})

// Expose the raw spec at /openapi.json (the path annotask probes).
fastify.get('/openapi.json', async () => fastify.swagger())

// Mirrors packages/shared-fixtures/index.ts so every MFE sees the same data
// shape regardless of which backend it calls.
const PRODUCTS = [
  { id: 'p-1', name: 'Field telemetry node', category: 'hardware', price_cents: 29900,  in_stock: true  },
  { id: 'p-2', name: 'Edge relay gateway',   category: 'hardware', price_cents: 59900,  in_stock: false },
  { id: 'p-3', name: 'Observability plan',   category: 'software', price_cents: 19900,  in_stock: true  },
  { id: 'p-4', name: 'Fleet support (yr)',   category: 'service',  price_cents: 120000, in_stock: true  },
]

const healthSchema = {
  type: 'object',
  required: ['status', 'service', 'port', 'version'],
  properties: {
    status:  { type: 'string', enum: ['ok', 'degraded', 'down'] },
    service: { type: 'string' },
    port:    { type: 'integer' },
    version: { type: 'string' },
  },
}

const productSchema = {
  type: 'object',
  required: ['id', 'name', 'category', 'price_cents', 'in_stock'],
  properties: {
    id:          { type: 'string' },
    name:        { type: 'string' },
    category:    { type: 'string' },
    price_cents: { type: 'integer' },
    in_stock:    { type: 'boolean' },
  },
}

fastify.get('/api/health', {
  schema: {
    tags: ['health'],
    response: { 200: healthSchema },
  },
}, async () => ({ status: 'ok', service: 'node-api', port: PORT, version: '0.0.1' }))

fastify.get('/api/products', {
  schema: {
    tags: ['products'],
    querystring: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        in_stock: { type: 'boolean' },
      },
    },
    response: { 200: { type: 'array', items: productSchema } },
  },
}, async (req) => {
  let items = PRODUCTS
  const { category, in_stock } = /** @type {any} */ (req.query)
  if (category) items = items.filter(p => p.category === category)
  if (typeof in_stock === 'boolean') items = items.filter(p => p.in_stock === in_stock)
  return items
})

fastify.get('/api/products/:id', {
  schema: {
    tags: ['products'],
    params: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
    response: {
      200: productSchema,
      404: {
        type: 'object',
        properties: { error: { type: 'string' }, id: { type: 'string' } },
      },
    },
  },
}, async (req, reply) => {
  const { id } = /** @type {any} */ (req.params)
  const product = PRODUCTS.find(p => p.id === id)
  if (!product) return reply.code(404).send({ error: 'not_found', id })
  return product
})

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' })
  // eslint-disable-next-line no-console
  console.log(`[node-api] listening on http://localhost:${PORT}`)
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(err)
  process.exit(1)
}
