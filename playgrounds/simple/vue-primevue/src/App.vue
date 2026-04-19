<script setup lang="ts">
import { ref } from 'vue'
import Button from 'primevue/button'
import Card from 'primevue/card'
import InputText from 'primevue/inputtext'
import Checkbox from 'primevue/checkbox'
import Select from 'primevue/select'
import Slider from 'primevue/slider'
import Tag from 'primevue/tag'
import Badge from 'primevue/badge'
import ProgressBar from 'primevue/progressbar'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'

const name = ref('')
const agree = ref(false)
const severity = ref('primary')
const volume = ref(40)

const severities = [
  { label: 'Primary', value: 'primary' },
  { label: 'Secondary', value: 'secondary' },
  { label: 'Success', value: 'success' },
  { label: 'Warn', value: 'warn' },
  { label: 'Danger', value: 'danger' },
  { label: 'Info', value: 'info' },
]

const products = ref([
  { id: 1, name: 'Zeus', status: 'active', price: '$29' },
  { id: 2, name: 'Hermes', status: 'paused', price: '$49' },
  { id: 3, name: 'Atlas', status: 'active', price: '$99' },
])
</script>

<template>
  <div class="page">
    <header class="hero">
      <h1>Annotask × PrimeVue Playground</h1>
      <p>A test-bed for component discovery against a real component library.</p>
    </header>

    <Card class="demo-card">
      <template #title>Form controls</template>
      <template #content>
        <div class="form-grid">
          <label>
            <span>Name</span>
            <InputText v-model="name" placeholder="Your name" />
          </label>
          <label>
            <span>Severity</span>
            <Select v-model="severity" :options="severities" optionLabel="label" optionValue="value" placeholder="Pick one" />
          </label>
          <label class="inline">
            <Checkbox v-model="agree" binary inputId="agree" />
            <span>I agree to the terms</span>
          </label>
          <label>
            <span>Volume — {{ volume }}</span>
            <Slider v-model="volume" :min="0" :max="100" />
          </label>
        </div>
      </template>
      <template #footer>
        <div class="actions">
          <Button label="Cancel" severity="secondary" outlined />
          <Button :label="`Submit (${severity})`" :severity="severity" />
        </div>
      </template>
    </Card>

    <Card class="demo-card">
      <template #title>Status indicators</template>
      <template #content>
        <div class="badges">
          <Tag value="Primary" />
          <Tag value="Success" severity="success" />
          <Tag value="Warn" severity="warn" />
          <Tag value="Danger" severity="danger" />
          <Badge value="4" />
          <Badge value="12" severity="success" />
          <ProgressBar :value="volume" />
        </div>
      </template>
    </Card>

    <Card class="demo-card">
      <template #title>DataTable</template>
      <template #content>
        <DataTable :value="products" tableStyle="min-width: 20rem">
          <Column field="id" header="ID" />
          <Column field="name" header="Name" />
          <Column field="status" header="Status">
            <template #body="slotProps">
              <Tag :value="slotProps.data.status" :severity="slotProps.data.status === 'active' ? 'success' : 'warn'" />
            </template>
          </Column>
          <Column field="price" header="Price" />
        </DataTable>
      </template>
    </Card>
  </div>
</template>

<style>
body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #0b0d10; color: #e7eaef; }
.page { max-width: 960px; margin: 0 auto; padding: 32px 20px 64px; display: flex; flex-direction: column; gap: 20px; }
.hero h1 { margin: 0 0 6px; font-size: 24px; font-weight: 700; }
.hero p { margin: 0; color: #9ba3af; font-size: 14px; }
.demo-card { background: #141821; border: 1px solid #232a36; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.form-grid label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #9ba3af; }
.form-grid label.inline { flex-direction: row; align-items: center; gap: 8px; color: #e7eaef; font-size: 13px; }
.actions { display: flex; gap: 8px; justify-content: flex-end; }
.badges { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.badges > *:last-child { flex: 1; min-width: 180px; }
</style>
