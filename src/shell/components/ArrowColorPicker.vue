<script setup lang="ts">
import { ref, onMounted } from 'vue'

defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [color: string] }>()

function readVar(name: string, fallback: string): string {
  const style = getComputedStyle(document.documentElement)
  return style.getPropertyValue(name).trim() || fallback
}

const presets = ref<string[]>([])

onMounted(() => {
  presets.value = [
    readVar('--annotation-red', '#ef4444'),
    readVar('--annotation-orange', '#f97316'),
    readVar('--annotation-yellow', '#eab308'),
    readVar('--annotation-green', '#22c55e'),
    readVar('--annotation-blue', '#3b82f6'),
    readVar('--annotation-purple', '#8b5cf6'),
  ]
})
</script>

<template>
  <div class="arrow-colors">
    <button
      v-for="c in presets" :key="c"
      :class="['color-dot', { active: modelValue === c }]"
      :style="{ background: c }"
      @click="emit('update:modelValue', c)"
    />
  </div>
</template>

<style scoped>
.arrow-colors { display: flex; gap: 3px; align-items: center; margin-left: 4px; }
.color-dot {
  width: 16px; height: 16px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  padding: 0;
  transition: border-color 0.1s;
}
.color-dot:hover { border-color: var(--text-muted); }
.color-dot.active { border-color: var(--text); box-shadow: 0 0 0 1px var(--surface); }
</style>
