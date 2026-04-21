<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { Product } from '../types'

const products = ref<Product[]>([])
const search = ref('')
const selected = ref<Product | null>(null)
const error = ref('')

onMounted(async () => {
  try {
    const res = await fetch('/api/catalog/products')
    products.value = (await res.json()).products
  } catch {
    error.value = 'Failed to load products — is the API running on port 8888?'
  }
})

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return products.value
  return products.value.filter(
    (p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q),
  )
})

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}
</script>

<template>
  <div class="products-page">
    <h1 class="page-title">Products</h1>

    <div v-if="error" class="error">{{ error }}</div>

    <template v-else>
      <input v-model="search" class="search" type="text" placeholder="Search products..." />

      <div class="layout">
        <table class="table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Category</th>
              <th>Price</th>
              <th>Rating</th>
              <th>Stock</th>
              <th>Reviews</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in filtered"
              :key="p.id"
              :class="{ active: selected?.id === p.id }"
              @click="selected = p"
            >
              <td class="name-cell">
                <span class="emoji">{{ p.image_emoji }}</span>
                {{ p.name }}
              </td>
              <td><span class="type-tag">{{ p.category }}</span></td>
              <td>{{ formatPrice(p.price_cents) }}</td>
              <td class="rating">★ {{ p.rating.toFixed(1) }}</td>
              <td>
                <span class="stock-pill" :class="{ out: !p.in_stock }">
                  {{ p.in_stock ? 'In stock' : 'Sold out' }}
                </span>
              </td>
              <td>{{ p.review_count.toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>

        <aside v-if="selected" class="detail">
          <button class="close-btn" @click="selected = null">✕</button>
          <div class="detail-emoji">{{ selected.image_emoji }}</div>
          <h2>{{ selected.name }}</h2>
          <p class="detail-cat">{{ selected.category }}</p>
          <p class="detail-desc">{{ selected.summary }}</p>
          <dl class="detail-grid">
            <div><dt>Price</dt><dd>{{ formatPrice(selected.price_cents) }}</dd></div>
            <div><dt>Rating</dt><dd>★ {{ selected.rating.toFixed(1) }}</dd></div>
            <div><dt>Reviews</dt><dd>{{ selected.review_count.toLocaleString() }}</dd></div>
            <div><dt>Status</dt><dd>{{ selected.in_stock ? 'In stock' : 'Sold out' }}</dd></div>
          </dl>
        </aside>
      </div>
    </template>
  </div>
</template>

<style scoped>
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 16px; }
.error {
  padding: 14px 18px;
  background: rgba(245, 91, 91, 0.1);
  border: 1px solid rgba(245, 91, 91, 0.3);
  border-radius: var(--radius);
  color: #fca5a5;
  font-size: 14px;
}
.search {
  width: 100%;
  padding: 10px 14px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  margin-bottom: 16px;
  outline: none;
}
.search:focus { border-color: var(--accent); }
.layout { display: flex; gap: 20px; align-items: flex-start; }
.table {
  flex: 1;
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.table th {
  text-align: left;
  padding: 10px 12px;
  background: var(--surface);
  color: var(--text-dim);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--border);
}
.table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.table tr { cursor: pointer; transition: background 0.1s; }
.table tbody tr:hover { background: var(--surface-hover); }
.table tr.active { background: var(--accent-dim); }
.name-cell { display: flex; align-items: center; gap: 10px; font-weight: 600; }
.emoji { font-size: 18px; }
.type-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--surface-hover);
  color: var(--text-dim);
}
.rating { color: #fbbf24; font-weight: 600; }
.stock-pill {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
  font-weight: 600;
}
.stock-pill.out {
  background: var(--surface-hover);
  color: var(--text-dim);
}

.detail {
  width: 300px;
  flex-shrink: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  position: relative;
}
.close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 16px;
}
.detail-emoji {
  width: 56px; height: 56px; border-radius: 12px;
  background: var(--surface-hover);
  display: flex; align-items: center; justify-content: center;
  font-size: 32px;
  margin-bottom: 12px;
}
.detail h2 { font-size: 18px; margin-bottom: 4px; }
.detail-cat { color: var(--text-dim); font-size: 12px; margin-bottom: 12px; text-transform: capitalize; }
.detail-desc { font-size: 13px; line-height: 1.5; color: var(--text-dim); margin-bottom: 16px; }
.detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.detail-grid dt { font-size: 11px; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.04em; }
.detail-grid dd { font-size: 14px; font-weight: 600; margin: 2px 0 0; }

@media (max-width: 800px) {
  .layout { flex-direction: column; }
  .detail { width: 100%; }
}
</style>
