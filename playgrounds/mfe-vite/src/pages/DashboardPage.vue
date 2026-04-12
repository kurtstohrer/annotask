<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import type { Product, Category } from '../types'
import StatCard from '../components/StatCard.vue'
import ProductRanking from '../components/ProductRanking.vue'

const products = ref<Product[]>([])
const categories = ref<Category[]>([])
const error = ref('')

onMounted(async () => {
  try {
    const [pRes, cRes] = await Promise.all([
      fetch('/api/catalog/products'),
      fetch('/api/catalog/categories'),
    ])
    products.value = (await pRes.json()).products
    categories.value = await cRes.json()
  } catch {
    error.value = 'Failed to load data — is the API running on port 8888?'
  }
})

const inStockCount = computed(() => products.value.filter((p) => p.in_stock).length)
const totalReviews = computed(() => products.value.reduce((sum, p) => sum + p.review_count, 0))
const bestSeller = computed(
  () => [...products.value].sort((a, b) => b.review_count - a.review_count)[0],
)
const highestRated = computed(
  () => [...products.value].sort((a, b) => b.rating - a.rating)[0],
)

const categoryBreakdown = computed(() => {
  const counts: Record<string, number> = {}
  for (const p of products.value) {
    counts[p.category] = (counts[p.category] || 0) + 1
  }
  return counts
})

function categoryName(id: string): string {
  return categories.value.find((c) => c.id === id)?.name ?? id
}
</script>

<template>
  <div class="dashboard">
    <h1 class="page-title">Storefront Overview</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <template v-else-if="products.length">
      <div class="grid">
        <StatCard label="Products" :value="products.length" icon="📦" />
        <StatCard label="In stock" :value="inStockCount" icon="✅" />
        <StatCard label="Total reviews" :value="totalReviews.toLocaleString()" icon="💬" />
        <StatCard label="Best seller" :value="bestSeller?.name ?? '—'" icon="🏆" />
      </div>

      <div class="section">
        <h2 class="section-title">Catalog by Category</h2>
        <div class="type-badges">
          <div v-for="(count, cat) in categoryBreakdown" :key="cat" class="type-badge">
            <span class="type-count">{{ count }}</span>
            <span class="type-name">{{ categoryName(cat) }}</span>
          </div>
        </div>
      </div>

      <div class="section">
        <h2 class="section-title">Top rated products</h2>
        <ProductRanking :products="products" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-title {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 20px;
}
.error {
  padding: 14px 18px;
  background: rgba(245, 91, 91, 0.1);
  border: 1px solid rgba(245, 91, 91, 0.3);
  border-radius: var(--radius);
  color: #fca5a5;
  font-size: 14px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 28px;
}
.section { margin-bottom: 28px; }
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 12px;
}
.type-badges { display: flex; gap: 10px; flex-wrap: wrap; }
.type-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 16px;
}
.type-count {
  font-size: 20px;
  font-weight: 700;
  color: var(--accent);
}
.type-name {
  font-size: 13px;
  color: var(--text-dim);
}
</style>
