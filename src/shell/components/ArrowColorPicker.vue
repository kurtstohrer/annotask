<script setup lang="ts">
defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [color: string] }>()

const presets = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
]
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
