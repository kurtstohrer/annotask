<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  computedStyles: Record<string, string>
}>()

const emit = defineEmits<{
  change: [property: string, value: string]
}>()

function parse(s: string): number { return parseFloat(s) || 0 }

// Parse individual sides from shorthand
function parseSides(shorthand: string): { top: number; right: number; bottom: number; left: number } {
  const parts = shorthand.split(' ').map(s => parseFloat(s) || 0)
  if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] }
  if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] }
  if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] }
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] }
}

const padding = computed(() => parseSides(props.computedStyles['padding'] || '0'))
const margin = computed(() => parseSides(props.computedStyles['margin'] || '0'))
</script>

<template>
  <div class="spacing-controls">
    <!-- Visual box model -->
    <div class="box-model">
      <!-- Margin layer -->
      <div class="margin-box">
        <span class="box-label margin-label">margin</span>
        <input class="side-input top" :value="margin.top" @change="emit('change', 'margin-top', ($event.target as HTMLInputElement).value + 'px')" />
        <input class="side-input right" :value="margin.right" @change="emit('change', 'margin-right', ($event.target as HTMLInputElement).value + 'px')" />
        <input class="side-input bottom" :value="margin.bottom" @change="emit('change', 'margin-bottom', ($event.target as HTMLInputElement).value + 'px')" />
        <input class="side-input left" :value="margin.left" @change="emit('change', 'margin-left', ($event.target as HTMLInputElement).value + 'px')" />

        <!-- Padding layer -->
        <div class="padding-box">
          <span class="box-label padding-label">padding</span>
          <input class="side-input top" :value="padding.top" @change="emit('change', 'padding-top', ($event.target as HTMLInputElement).value + 'px')" />
          <input class="side-input right" :value="padding.right" @change="emit('change', 'padding-right', ($event.target as HTMLInputElement).value + 'px')" />
          <input class="side-input bottom" :value="padding.bottom" @change="emit('change', 'padding-bottom', ($event.target as HTMLInputElement).value + 'px')" />
          <input class="side-input left" :value="padding.left" @change="emit('change', 'padding-left', ($event.target as HTMLInputElement).value + 'px')" />

          <!-- Content -->
          <div class="content-box">
            {{ parse(props.computedStyles['width'] || '0').toFixed(0) }} × {{ parse(props.computedStyles['height'] || '0').toFixed(0) }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.box-model { display: flex; justify-content: center; }

.margin-box, .padding-box {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.margin-box {
  padding: 20px 28px;
  background: rgba(249, 115, 22, 0.08);
  border: 1px dashed rgba(249, 115, 22, 0.3);
  border-radius: 6px;
  min-width: 220px;
}

.padding-box {
  padding: 18px 24px;
  background: rgba(34, 197, 94, 0.08);
  border: 1px dashed rgba(34, 197, 94, 0.3);
  border-radius: 4px;
  width: 100%;
}

.content-box {
  padding: 8px 12px;
  background: var(--accent);
  border-radius: 3px;
  color: white;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.box-label {
  position: absolute;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
}

.margin-label { top: 3px; left: 6px; color: #f97316; }
.padding-label { top: 2px; left: 5px; color: #22c55e; }

.side-input {
  position: absolute;
  width: 28px;
  padding: 1px 2px;
  font-size: 10px;
  text-align: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  outline: none;
}
.side-input:hover { border-color: var(--border); background: var(--bg); }
.side-input:focus { border-color: var(--accent); background: var(--bg); }

.margin-box > .side-input.top { top: 2px; left: 50%; transform: translateX(-50%); }
.margin-box > .side-input.bottom { bottom: 2px; left: 50%; transform: translateX(-50%); }
.margin-box > .side-input.left { left: 2px; top: 50%; transform: translateY(-50%); }
.margin-box > .side-input.right { right: 2px; top: 50%; transform: translateY(-50%); }

.padding-box > .side-input.top { top: 1px; left: 50%; transform: translateX(-50%); }
.padding-box > .side-input.bottom { bottom: 1px; left: 50%; transform: translateX(-50%); }
.padding-box > .side-input.left { left: 2px; top: 50%; transform: translateY(-50%); }
.padding-box > .side-input.right { right: 2px; top: 50%; transform: translateY(-50%); }
</style>
