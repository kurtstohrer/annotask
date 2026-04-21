<script setup lang="ts">
import { computed } from 'vue'
import {
  Accessibility,
  Activity,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleQuestionMark,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Code,
  Copy,
  Database,
  FileSearch,
  Grid2x2,
  Highlighter,
  Info,
  LayoutDashboard,
  Library,
  Lock,
  MapPin,
  Maximize2,
  Monitor,
  MousePointer2,
  Package,
  Palette,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  RotateCw,
  ScanSearch,
  Search,
  Settings,
  SlidersHorizontal,
  SquareCheckBig,
  SquarePlus,
  Star,
  TextWrap,
  Trash2,
  TriangleAlert,
  Wand,
  X,
} from 'lucide-vue-next'

const REGISTRY = {
  'accessibility': Accessibility,
  'activity': Activity,
  'arrow-right': ArrowRight,
  'bot': Bot,
  'check': Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'circle-help': CircleQuestionMark,
  'clipboard-check': ClipboardCheck,
  'clipboard-list': ClipboardList,
  'clock': Clock,
  'code': Code,
  'copy': Copy,
  'database': Database,
  'file-search': FileSearch,
  'grid-2x2': Grid2x2,
  'highlighter': Highlighter,
  'info': Info,
  'layout-dashboard': LayoutDashboard,
  'library': Library,
  'lock': Lock,
  'map-pin': MapPin,
  'maximize-2': Maximize2,
  'monitor': Monitor,
  'mouse-pointer': MousePointer2,
  'package': Package,
  'palette': Palette,
  'pause': Pause,
  'pencil': Pencil,
  'play': Play,
  'rotate-ccw': RotateCcw,
  'rotate-cw': RotateCw,
  'scan-search': ScanSearch,
  'search': Search,
  'settings': Settings,
  'sliders-horizontal': SlidersHorizontal,
  'square-check-big': SquareCheckBig,
  'square-plus': SquarePlus,
  'star': Star,
  'text-wrap': TextWrap,
  'trash': Trash2,
  'triangle-alert': TriangleAlert,
  'wand': Wand,
  'x': X,
} as const

export type IconName = keyof typeof REGISTRY

const props = withDefaults(defineProps<{
  name: IconName
  size?: number
  strokeWidth?: number
  color?: string
}>(), {
  size: 14,
  strokeWidth: 2,
})

const component = computed(() => REGISTRY[props.name])
</script>

<template>
  <component
    :is="component"
    :size="size"
    :stroke-width="strokeWidth"
    :color="color"
    aria-hidden="true"
  />
</template>
