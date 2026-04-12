<template>
  <div class="ranking">
    <div v-for="product in topRated" :key="product.id" class="rank-row">
      <div class="rank-emoji">{{ product.image_emoji }}</div>
      <span class="rank-name">{{ product.name }}</span>
      <div class="rank-bar-track">
        <div class="rank-bar" :style="{ width: pct(product) + '%' }"></div>
      </div>
      <span class="rank-value">★ {{ product.rating.toFixed(1) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Product } from '../types'

const props = defineProps<{ products: Product[] }>()

const topRated = computed(() =>
  [...props.products].sort((a, b) => b.rating - a.rating).slice(0, 6),
)
function pct(p: Product) {
  return (p.rating / 5) * 100
}
</script>

<style scoped>
.ranking { display: flex; flex-direction: column; gap: 8px; }
.rank-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}
.rank-emoji {
  font-size: 22px;
  flex-shrink: 0;
}
.rank-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rank-bar-track {
  width: 120px;
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
  flex-shrink: 0;
}
.rank-bar {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #fbbf24, #f59e0b);
  transition: width 0.4s ease;
}
.rank-value {
  font-size: 12px;
  color: #fbbf24;
  font-weight: 600;
  width: 50px;
  text-align: right;
  flex-shrink: 0;
}
</style>
