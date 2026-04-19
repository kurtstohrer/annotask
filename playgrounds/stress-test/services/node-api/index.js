import http from 'node:http'

const PORT = Number(process.env.PORT ?? 4340)

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method === 'GET' && req.url === '/api/health') {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ status: 'ok', service: 'node-api', port: PORT, version: '0.0.1' }))
    return
  }

  res.statusCode = 404
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: 'not_found', path: req.url }))
})

server.listen(PORT, () => {
  console.log(`[node-api] listening on http://localhost:${PORT}`)
})
