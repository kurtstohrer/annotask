<template>
  <template v-for="b in badges" :key="'tob-' + b.eid">
    <div
      class="tab-order-badge"
      :class="badgeClass(b)"
      :title="badgeTitle(b)"
      :style="{
        left: badgeLeft(b) + 'px',
        top: badgeTop(b) + 'px',
      }"
    >{{ b.index === -1 ? '×' : b.index }}</div>
  </template>
</template>

<script setup lang="ts">
import type { TabOrderBadge } from '../composables/useTabOrderOverlay'

const props = defineProps<{
  badges: TabOrderBadge[]
}>()
void props // keep template-only access happy with strict tsconfig

function badgeClass(b: TabOrderBadge): string {
  if (b.flag === 'positive') return 'positive'
  if (b.flag === 'reorder') return 'warn'
  if (b.flag === 'unreachable') return 'unreachable'
  return ''
}

function badgeTitle(b: TabOrderBadge): string {
  const head = b.index === -1
    ? `Not in tab sequence (tabindex=${b.tabindex})`
    : `Tab #${b.index} · ${b.tag}${b.role ? ' role=' + b.role : ''}`
  const name = b.accessible_name ? `\nName: "${b.accessible_name}"` : ''
  const reason = b.reason ? `\n⚠ ${b.reason}` : ''
  return head + name + reason
}

function badgeLeft(b: TabOrderBadge): number {
  // Anchor the badge to the top-left of the element, slightly offset out so
  // it doesn't obscure the element's own corner.
  return Math.max(0, b.rect.x - 4)
}
function badgeTop(b: TabOrderBadge): number {
  return Math.max(0, b.rect.y - 11)
}
</script>
