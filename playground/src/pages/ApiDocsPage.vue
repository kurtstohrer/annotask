<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

const spec = ref<any>(null)
const loading = ref(true)
const error = ref('')
const expandedOps = ref<Set<string>>(new Set())

onMounted(async () => {
  try {
    const res = await fetch('/openapi.json')
    spec.value = await res.json()
  } catch {
    error.value = 'Failed to load API schema. Is the server running?'
  } finally {
    loading.value = false
  }
})

function resolveRef(obj: any): any {
  if (!obj || !spec.value) return obj
  if (obj.$ref) {
    const path = obj.$ref.replace('#/', '').split('/')
    let resolved = spec.value
    for (const p of path) resolved = resolved?.[p]
    return resolved ?? obj
  }
  return obj
}

function resolveSchema(schema: any): any {
  if (!schema) return schema
  if (schema.$ref) return resolveRef(schema)
  if (schema.anyOf) {
    const nonNull = schema.anyOf.filter((s: any) => s.type !== 'null')
    if (nonNull.length === 1) return resolveSchema(nonNull[0])
    return schema
  }
  return schema
}

function schemaTypeName(schema: any): string {
  if (!schema) return 'any'
  const s = resolveSchema(schema)
  if (s.$ref) {
    const parts = s.$ref.split('/')
    return parts[parts.length - 1]
  }
  if (s.enum) return s.enum.join(' | ')
  if (s.type === 'array') {
    const items = resolveSchema(s.items)
    return `${schemaTypeName(items)}[]`
  }
  if (s.type) return s.type
  if (s.anyOf) return s.anyOf.map((x: any) => schemaTypeName(x)).join(' | ')
  return 'object'
}

function getSchemaProperties(schema: any): { name: string; type: string; required: boolean; description: string }[] {
  const s = resolveSchema(schema)
  if (!s?.properties) return []
  const required = new Set(s.required ?? [])
  return Object.entries(s.properties).map(([name, prop]: [string, any]) => ({
    name,
    type: schemaTypeName(prop),
    required: required.has(name),
    description: (prop as any).description ?? '',
  }))
}

interface Endpoint {
  id: string
  method: string
  path: string
  summary: string
  description: string
  tag: string
  parameters: any[]
  requestBody: any
  responses: any
}

const endpoints = computed<Endpoint[]>(() => {
  if (!spec.value?.paths) return []
  const result: Endpoint[] = []
  for (const [path, methods] of Object.entries(spec.value.paths)) {
    for (const [method, op] of Object.entries(methods as any)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        result.push({
          id: `${method}-${path}`,
          method: method.toUpperCase(),
          path,
          summary: op.summary ?? '',
          description: op.description ?? '',
          tag: op.tags?.[0] ?? 'Other',
          parameters: op.parameters ?? [],
          requestBody: op.requestBody,
          responses: op.responses ?? {},
        })
      }
    }
  }
  return result
})

const tags = computed(() => {
  const tagSet = new Set(endpoints.value.map(e => e.tag))
  return Array.from(tagSet)
})

function endpointsForTag(tag: string) {
  return endpoints.value.filter(e => e.tag === tag)
}

function toggleOp(id: string) {
  const next = new Set(expandedOps.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expandedOps.value = next
}

function methodColor(method: string): string {
  switch (method) {
    case 'GET': return '#3b82f6'
    case 'POST': return '#22c55e'
    case 'PUT': return '#f59e0b'
    case 'PATCH': return '#f59e0b'
    case 'DELETE': return '#ef4444'
    default: return '#9ca3af'
  }
}
</script>

<template>
  <div class="api-docs-page">
    <div class="api-docs-header">
      <div>
        <h2 class="api-docs-title">
          <i class="pi pi-book"></i>
          {{ spec?.info?.title ?? 'API Documentation' }}
        </h2>
        <p v-if="spec?.info?.description" class="api-docs-desc">{{ spec.info.description }}</p>
      </div>
      <span v-if="spec?.info?.version" class="api-version">v{{ spec.info.version }}</span>
    </div>

    <div v-if="loading" class="api-loading">Loading API schema...</div>

    <div v-else-if="error" class="error-banner">
      <i class="pi pi-exclamation-triangle"></i>
      {{ error }}
    </div>

    <template v-else>
      <div v-for="tag in tags" :key="tag" class="tag-group">
        <h3 class="tag-title">{{ tag }}</h3>

        <div class="endpoints-list">
          <div
            v-for="ep in endpointsForTag(tag)"
            :key="ep.id"
            class="endpoint-card"
          >
            <button class="endpoint-summary" @click="toggleOp(ep.id)">
              <span class="method-badge" :style="{ background: methodColor(ep.method) }">
                {{ ep.method }}
              </span>
              <code class="endpoint-path">{{ ep.path }}</code>
              <span class="endpoint-name">{{ ep.summary }}</span>
              <i
                class="pi expand-icon"
                :class="expandedOps.has(ep.id) ? 'pi-chevron-up' : 'pi-chevron-down'"
              ></i>
            </button>

            <div v-if="expandedOps.has(ep.id)" class="endpoint-detail">
              <p v-if="ep.description" class="ep-description">{{ ep.description }}</p>

              <!-- Parameters -->
              <div v-if="ep.parameters.length" class="detail-section">
                <h4 class="detail-title">Parameters</h4>
                <table class="params-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>In</th>
                      <th>Type</th>
                      <th>Required</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="param in ep.parameters" :key="param.name">
                      <td><code>{{ param.name }}</code></td>
                      <td><span class="param-in">{{ param.in }}</span></td>
                      <td class="mono-cell">{{ schemaTypeName(param.schema) }}</td>
                      <td>{{ param.required ? 'Yes' : 'No' }}</td>
                      <td class="desc-cell">{{ param.description ?? '' }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Request Body -->
              <div v-if="ep.requestBody" class="detail-section">
                <h4 class="detail-title">Request Body</h4>
                <div
                  v-for="(content, mediaType) in ep.requestBody.content"
                  :key="mediaType as string"
                >
                  <div class="schema-block">
                    <div class="schema-header">
                      <code>{{ mediaType }}</code>
                      <span class="schema-name">{{ schemaTypeName(content.schema) }}</span>
                    </div>
                    <table v-if="getSchemaProperties(content.schema).length" class="params-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Type</th>
                          <th>Required</th>
                          <th>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr v-for="prop in getSchemaProperties(content.schema)" :key="prop.name">
                          <td><code>{{ prop.name }}</code></td>
                          <td class="mono-cell">{{ prop.type }}</td>
                          <td>{{ prop.required ? 'Yes' : 'No' }}</td>
                          <td class="desc-cell">{{ prop.description }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <!-- Responses -->
              <div class="detail-section">
                <h4 class="detail-title">Responses</h4>
                <div
                  v-for="(resp, code) in ep.responses"
                  :key="code as string"
                  class="response-row"
                >
                  <span
                    class="status-code"
                    :class="{ success: String(code).startsWith('2'), error: String(code).startsWith('4') }"
                  >{{ code }}</span>
                  <span class="response-desc">{{ (resp as any).description }}</span>
                  <span
                    v-if="(resp as any).content?.['application/json']?.schema"
                    class="response-schema"
                  >
                    {{ schemaTypeName((resp as any).content['application/json'].schema) }}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.api-docs-page {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.api-docs-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.api-docs-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  margin-bottom: 4px;
}

.api-docs-title i { color: var(--text-muted); font-size: 14px; }

.api-docs-desc {
  font-size: 13px;
  color: var(--text-muted);
}

.api-version {
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  background: var(--surface-alt);
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.api-loading {
  text-align: center;
  padding: 40px;
  color: var(--text-muted);
  font-size: 14px;
}

.tag-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.tag-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.endpoints-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.endpoint-card {
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--surface);
}

.endpoint-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  background: none;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: var(--text);
}

.endpoint-summary:hover {
  background: var(--surface-alt);
}

.method-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  min-width: 56px;
  text-align: center;
  flex-shrink: 0;
}

.endpoint-path {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.endpoint-name {
  font-size: 13px;
  color: var(--text-muted);
  flex: 1;
}

.expand-icon {
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.endpoint-detail {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}

.ep-description {
  font-size: 13px;
  color: var(--text-muted);
  line-height: 1.5;
}

.detail-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.detail-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.params-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.params-table th {
  text-align: left;
  padding: 6px 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border);
  background: var(--surface-alt);
}

.params-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

.params-table code {
  font-size: 12px;
  font-weight: 600;
  color: #93c5fd;
}

.mono-cell {
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 12px;
  color: var(--text-muted);
}

.desc-cell {
  color: var(--text-muted);
  font-size: 12px;
}

.param-in {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--surface-alt);
  color: var(--text-muted);
}

.schema-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.schema-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.schema-header code {
  font-size: 12px;
  color: var(--text-muted);
}

.schema-name {
  font-size: 12px;
  font-weight: 600;
  color: #93c5fd;
}

.response-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--surface-alt);
  border-radius: 6px;
}

.status-code {
  font-size: 12px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
}

.status-code.success { color: #22c55e; }
.status-code.error { color: #f59e0b; }

.response-desc {
  font-size: 13px;
  color: var(--text-muted);
  flex: 1;
}

.response-schema {
  font-size: 12px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  color: #93c5fd;
}
</style>
