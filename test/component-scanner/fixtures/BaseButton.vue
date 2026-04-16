<script setup lang="ts">
// Fixture: Base*.vue used to be silently skipped by findVueFile. Make sure it's now picked up.
interface Props {
  /** Visible button text. */
  label?: string
  /** Disable interaction. */
  disabled?: boolean
  /** Visual severity. */
  severity?: 'primary' | 'secondary' | 'danger'
}
const props = withDefaults(defineProps<Props>(), {
  label: 'Click me',
  disabled: false,
})
const emit = defineEmits<{
  click: [event: MouseEvent]
  'focus-change': [focused: boolean]
}>()
</script>

<template>
  <button :disabled="props.disabled" @click="emit('click', $event)">
    <slot name="icon" :severity="props.severity" />
    <slot>{{ props.label }}</slot>
    <slot name="trailing" />
  </button>
</template>
