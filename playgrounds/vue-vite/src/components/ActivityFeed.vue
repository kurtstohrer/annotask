<script setup lang="ts">
import type { ActivityEntry } from '../types'

defineProps<{ entries: ActivityEntry[] }>()

function timeAgo(ts: string): string {
  const now = Date.now()
  const t = new Date(ts).getTime()
  const diff = Math.floor((now - t) / 1000)
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
</script>

<template>
  <div class="activity">
    <div v-for="entry in entries" :key="entry.id" class="row">
      <div class="avatar" aria-hidden="true">{{ initials(entry.actor) }}</div>
      <div class="body">
        <div class="line">
          <strong>{{ entry.actor }}</strong>
          <span>{{ entry.action }}</span>
          <em>{{ entry.target }}</em>
        </div>
        <time class="ts">{{ timeAgo(entry.ts) }}</time>
      </div>
    </div>
  </div>
</template>

<style scoped>
.activity {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}

.row:last-child {
  border-bottom: none;
}

.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--surface-alt);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  flex-shrink: 0;
}

.body {
  flex: 1;
  min-width: 0;
}

.line {
  font-size: 13px;
  color: var(--text);
  line-height: 1.5;
}

.line strong {
  color: var(--text);
  font-weight: 600;
}

.line span {
  color: var(--text-muted);
  margin: 0 4px;
}

.line em {
  color: var(--accent);
  font-style: normal;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

.ts {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
