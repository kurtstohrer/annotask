<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Product, Category } from '../types'

const categories = ref<Category[]>([])
const products = ref<Product[]>([])
const error = ref('')

onMounted(async () => {
  try {
    const [cRes, pRes] = await Promise.all([
      fetch('/api/catalog/categories'),
      fetch('/api/catalog/products'),
    ])
    categories.value = await cRes.json()
    products.value = (await pRes.json()).products
  } catch {
    error.value = 'Failed to load data — is the API running on port 8888?'
  }
})

function statsFor(catId: string) {
  const items = products.value.filter((p) => p.category === catId)
  return {
    count: items.length,
    inStock: items.filter((p) => p.in_stock).length,
    avgRating: items.length > 0 ? items.reduce((sum, p) => sum + p.rating, 0) / items.length : 0,
    totalReviews: items.reduce((sum, p) => sum + p.review_count, 0),
  }
}
</script>

<template>
  <div class="categories-page">
    <h1 class="page-title">Categories</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <div v-else class="grid">
      <div v-for="c in categories" :key="c.id" class="card">
        <div class="card-icon">{{ c.icon }}</div>
        <h3 class="card-name">{{ c.name }}</h3>
        <div class="card-stats">
          <div class="stat">
            <span class="stat-num">{{ statsFor(c.id).count }}</span>
            <span class="stat-label">Products</span>
          </div>
          <div class="stat">
            <span class="stat-num">{{ statsFor(c.id).inStock }}</span>
            <span class="stat-label">In stock</span>
          </div>
          <div class="stat">
            <span class="stat-num">★ {{ statsFor(c.id).avgRating.toFixed(1) }}</span>
            <span class="stat-label">Rating</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 20px; }
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
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  text-align: center;
  transition: all 0.15s;
}
.card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}
.card-icon {
  font-size: 40px;
  margin-bottom: 8px;
}
.card-name {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 16px;
}
.card-stats {
  display: flex;
  justify-content: space-around;
  padding-top: 14px;
  border-top: 1px solid var(--border);
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat-num {
  font-size: 16px;
  font-weight: 700;
  color: var(--accent);
}
.stat-label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-dim);
}
</style>
