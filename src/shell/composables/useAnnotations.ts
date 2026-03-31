import { ref, computed } from 'vue'

export interface Pin {
  id: string
  number: number
  file: string
  line: number
  component: string
  elementTag: string
  elementClasses: string
  clickX: number
  clickY: number
  note: string
  action?: string
  route: string
  timestamp: number
}

export interface StickyNote {
  id: string
  number: number
  x: number
  y: number
  width: number
  height: number
  text: string
  color: 'yellow' | 'pink' | 'blue' | 'green'
  route: string
  timestamp: number
}

export type ElementRect = { x: number; y: number; width: number; height: number }

export interface Arrow {
  id: string
  number: number
  fromX: number
  fromY: number
  toX: number
  toY: number
  fromFile?: string
  fromLine?: number
  fromComponent?: string
  fromRect?: ElementRect
  fromEid?: string
  toFile?: string
  toLine?: number
  toRect?: ElementRect
  toEid?: string
  label: string
  color: string
  route: string
  timestamp: number
}

export interface DrawnSection {
  id: string
  number: number
  x: number
  y: number
  width: number
  height: number
  prompt: string
  nearEid?: string
  nearFile?: string
  nearLine?: number
  nearComponent?: string
  placement?: 'above' | 'below' | 'left' | 'right'
  route: string
  timestamp: number
}

export interface TextHighlight {
  id: string
  number: number
  selectedText: string
  prompt: string
  color: string
  rect?: ElementRect
  eid?: string
  file: string
  line: number
  component: string
  elementTag: string
  route: string
  timestamp: number
}

const pins = ref<Pin[]>([])
const stickyNotes = ref<StickyNote[]>([])
const arrows = ref<Arrow[]>([])
const drawnSections = ref<DrawnSection[]>([])
const highlights = ref<TextHighlight[]>([])
const activeRoute = ref('/')
const selectedPinId = ref<string | null>(null)
const selectedStickyId = ref<string | null>(null)
const selectedArrowId = ref<string | null>(null)
const selectedSectionId = ref<string | null>(null)
let counter = 0

export function useAnnotations() {
  function setRoute(route: string) { activeRoute.value = route }

  // Route-filtered views
  const routePins = computed(() => pins.value.filter(p => p.route === activeRoute.value))
  const routeArrows = computed(() => arrows.value.filter(a => a.route === activeRoute.value))
  const routeSections = computed(() => drawnSections.value.filter(s => s.route === activeRoute.value))
  const routeHighlights = computed(() => highlights.value.filter(h => h.route === activeRoute.value))

  // ── Pins ──
  function addPin(source: {
    file: string; line: string; component: string;
    elementTag: string; elementClasses: string;
  }, x: number, y: number): Pin {
    counter++
    const pin: Pin = {
      id: `pin-${counter}`, number: counter,
      file: source.file, line: parseInt(source.line) || 0,
      component: source.component,
      elementTag: source.elementTag, elementClasses: source.elementClasses,
      clickX: x, clickY: y, note: '', route: activeRoute.value, timestamp: Date.now(),
    }
    pins.value.push(pin)
    selectedPinId.value = pin.id
    return pin
  }

  function removePin(id: string) {
    pins.value = pins.value.filter(p => p.id !== id)
    if (selectedPinId.value === id) selectedPinId.value = null
  }

  function updatePinNote(id: string, note: string) {
    const pin = pins.value.find(p => p.id === id)
    if (pin) pin.note = note
  }

  function setPinAction(id: string, action: string) {
    const pin = pins.value.find(p => p.id === id)
    if (pin) pin.action = action
  }

  function getPinsForElement(file: string, line: number): Pin[] {
    return pins.value.filter(p => p.file === file && p.line === line)
  }

  const selectedPin = computed(() => pins.value.find(p => p.id === selectedPinId.value) || null)

  // ── Sticky Notes ──
  function addStickyNote(x: number, y: number): StickyNote {
    counter++
    const note: StickyNote = {
      id: `sticky-${counter}`, number: counter,
      x: x - 60, y: y - 60, width: 120, height: 120,
      text: '', color: 'yellow', route: activeRoute.value, timestamp: Date.now(),
    }
    stickyNotes.value.push(note)
    selectedStickyId.value = note.id
    return note
  }

  function removeStickyNote(id: string) {
    stickyNotes.value = stickyNotes.value.filter(s => s.id !== id)
    if (selectedStickyId.value === id) selectedStickyId.value = null
  }

  function updateStickyNote(id: string, updates: Partial<StickyNote>) {
    const note = stickyNotes.value.find(s => s.id === id)
    if (note) Object.assign(note, updates)
  }

  // ── Arrows ──
  function addArrow(fromX: number, fromY: number, toX: number, toY: number, label?: string, color?: string): Arrow {
    counter++
    const arrow: Arrow = {
      id: `arrow-${counter}`, number: counter,
      fromX, fromY, toX, toY,
      label: label || 'Move here',
      color: color || '#ef4444',
      route: activeRoute.value, timestamp: Date.now(),
    }
    arrows.value.push(arrow)
    selectedArrowId.value = arrow.id
    return arrow
  }

  function removeArrow(id: string) {
    arrows.value = arrows.value.filter(a => a.id !== id)
    if (selectedArrowId.value === id) selectedArrowId.value = null
  }

  function updateArrow(id: string, updates: Partial<Arrow>) {
    const arrow = arrows.value.find(a => a.id === id)
    if (arrow) Object.assign(arrow, updates)
  }

  // ── Drawn Sections ──
  function addDrawnSection(x: number, y: number, width: number, height: number): DrawnSection {
    counter++
    const section: DrawnSection = {
      id: `section-${counter}`, number: counter,
      x, y, width, height,
      prompt: '', route: activeRoute.value, timestamp: Date.now(),
    }
    drawnSections.value.push(section)
    selectedSectionId.value = section.id
    return section
  }

  function removeDrawnSection(id: string) {
    drawnSections.value = drawnSections.value.filter(s => s.id !== id)
    if (selectedSectionId.value === id) selectedSectionId.value = null
  }

  function updateDrawnSection(id: string, updates: Partial<DrawnSection>) {
    const section = drawnSections.value.find(s => s.id === id)
    if (section) Object.assign(section, updates)
  }

  // ── Text Highlights ──
  const selectedHighlightId = ref<string | null>(null)

  function addHighlight(text: string, source: { file: string; line: number; component: string; elementTag: string }, color?: string, rect?: ElementRect, eid?: string): TextHighlight {
    counter++
    const h: TextHighlight = {
      id: `hl-${counter}`, number: counter,
      selectedText: text, prompt: '',
      color: color || '#f59e0b',
      ...(rect ? { rect } : {}),
      ...(eid ? { eid } : {}),
      file: source.file, line: source.line,
      component: source.component, elementTag: source.elementTag,
      route: activeRoute.value, timestamp: Date.now(),
    }
    highlights.value.push(h)
    selectedHighlightId.value = h.id
    return h
  }

  function removeHighlight(id: string) {
    highlights.value = highlights.value.filter(h => h.id !== id)
    if (selectedHighlightId.value === id) selectedHighlightId.value = null
  }

  function updateHighlight(id: string, updates: Partial<TextHighlight>) {
    const h = highlights.value.find(x => x.id === id)
    if (h) Object.assign(h, updates)
  }

  function clearAll() {
    pins.value = []
    stickyNotes.value = []
    arrows.value = []
    drawnSections.value = []
    highlights.value = []
    selectedPinId.value = null
    selectedStickyId.value = null
    selectedArrowId.value = null
    selectedSectionId.value = null
  }

  return {
    pins, stickyNotes, arrows, drawnSections, highlights,
    routePins, routeArrows, routeSections, routeHighlights,
    activeRoute, setRoute,
    selectedPinId, selectedStickyId, selectedArrowId, selectedSectionId, selectedHighlightId,
    selectedPin,
    addPin, removePin, updatePinNote, setPinAction, getPinsForElement,
    addStickyNote, removeStickyNote, updateStickyNote,
    addArrow, removeArrow, updateArrow,
    addDrawnSection, removeDrawnSection, updateDrawnSection,
    addHighlight, removeHighlight, updateHighlight,
    clearAll,
  }
}
