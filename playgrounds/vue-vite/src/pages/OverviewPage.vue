<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Planet } from '../types'

type PlanetHit = { planet: Planet; x: number; y: number; r: number }

const router = useRouter()
const planets = ref<Planet[]>([])
const error = ref('')

const orbitCanvas = ref<HTMLCanvasElement | null>(null)
const hoveredPlanet = ref<Planet | null>(null)
const hoveredSun = ref(false)
const tooltipPos = ref({ x: 0, y: 0 })
let rafId = 0
let resizeObserver: ResizeObserver | null = null
let planetHits: PlanetHit[] = []
let sunHit: { x: number; y: number; r: number } | null = null
let pointerPos: { x: number; y: number } | null = null

onMounted(async () => {
  try {
    const res = await fetch('/api/solar/planets?sort_by=distance_from_sun_mkm')
    if (!res.ok) throw new Error('api')
    planets.value = (await res.json()).planets ?? []
  } catch {
    error.value = 'Failed to load solar data — is the API running on port 8888?'
  }
})

function openPlanet(planet: Planet) {
  router.push({ path: '/planets', query: { id: String(planet.id) } })
}

function openSun() {
  router.push({ path: '/sun' })
}

function hitTest(x: number, y: number): PlanetHit | null {
  for (const hit of planetHits) {
    const dx = x - hit.x
    const dy = y - hit.y
    const hitR = Math.max(hit.r + 4, 10)
    if (dx * dx + dy * dy <= hitR * hitR) return hit
  }
  return null
}

function isSunHit(x: number, y: number): boolean {
  if (!sunHit) return false
  const dx = x - sunHit.x
  const dy = y - sunHit.y
  return dx * dx + dy * dy <= sunHit.r * sunHit.r
}

function onCanvasPointerMove(event: PointerEvent) {
  const canvas = orbitCanvas.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  pointerPos = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  tooltipPos.value = pointerPos
}

function onCanvasPointerLeave() {
  pointerPos = null
  hoveredPlanet.value = null
  hoveredSun.value = false
}

function onCanvasClick(event: MouseEvent) {
  const canvas = orbitCanvas.value
  if (!canvas) return
  const rect = canvas.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const hit = hitTest(x, y)
  if (hit) {
    openPlanet(hit.planet)
    return
  }
  if (isSunHit(x, y)) openSun()
}

watch([orbitCanvas, planets], ([canvas, list]) => {
  if (!canvas || list.length === 0) return
  startOrbitAnimation(canvas, list)
})

function startOrbitAnimation(canvas: HTMLCanvasElement, list: Planet[]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()

  let width = 0
  let height = 0

  function resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    width = rect.width
    height = rect.height
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  resize()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)

  const maxDistance = Math.max(...list.map((p) => p.distance_from_sun_mkm))
  const minDistance = Math.min(...list.map((p) => p.distance_from_sun_mkm))

  const start = performance.now()

  function frame(now: number) {
    const t = (now - start) / 1000
    const cx = width / 2
    const cy = height / 2
    const usable = Math.min(width, height * 2) / 2 - 12
    const ringMax = usable
    const ringMin = 36

    ctx!.clearRect(0, 0, width, height)

    ctx!.save()
    ctx!.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx!.lineWidth = 1
    for (const p of list) {
      const ratio = (p.distance_from_sun_mkm - minDistance) / (maxDistance - minDistance || 1)
      const r = ringMin + ratio * (ringMax - ringMin)
      ctx!.beginPath()
      ctx!.ellipse(cx, cy, r, r * 0.45, 0, 0, Math.PI * 2)
      ctx!.stroke()
    }
    ctx!.restore()

    const sunGrad = ctx!.createRadialGradient(cx, cy, 2, cx, cy, 22)
    sunGrad.addColorStop(0, '#fff7cc')
    sunGrad.addColorStop(0.4, '#ffe066')
    sunGrad.addColorStop(0.75, '#ffb833')
    sunGrad.addColorStop(1, 'rgba(255,94,58,0)')
    ctx!.fillStyle = sunGrad
    ctx!.beginPath()
    ctx!.arc(cx, cy, 22, 0, Math.PI * 2)
    ctx!.fill()

    sunHit = { x: cx, y: cy, r: 22 }

    const hits: PlanetHit[] = []
    for (let i = 0; i < list.length; i++) {
      const p = list[i]
      const ratio = (p.distance_from_sun_mkm - minDistance) / (maxDistance - minDistance || 1)
      const r = ringMin + ratio * (ringMax - ringMin)
      const speed = 0.35 / Math.sqrt(1 + ratio * 10)
      const angle = t * speed + (i * Math.PI * 2) / list.length
      const x = cx + Math.cos(angle) * r
      const y = cy + Math.sin(angle) * r * 0.45
      const dotR = 3 + Math.log10(Math.max(p.radius_km, 1000)) - 3
      const drawR = Math.max(2.5, dotR)

      hits.push({ planet: p, x, y, r: drawR })

      ctx!.beginPath()
      ctx!.fillStyle = p.color || '#a0a0a0'
      ctx!.shadowColor = p.color || '#a0a0a0'
      ctx!.shadowBlur = 8
      ctx!.arc(x, y, drawR, 0, Math.PI * 2)
      ctx!.fill()
      ctx!.shadowBlur = 0
    }

    planetHits = hits

    const hovered = pointerPos ? hitTest(pointerPos.x, pointerPos.y) : null
    hoveredPlanet.value = hovered?.planet ?? null
    hoveredSun.value =
      !hovered && !!pointerPos && isSunHit(pointerPos.x, pointerPos.y)
    if (hovered) {
      ctx!.save()
      ctx!.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx!.lineWidth = 1.5
      ctx!.beginPath()
      ctx!.arc(hovered.x, hovered.y, hovered.r + 4, 0, Math.PI * 2)
      ctx!.stroke()
      ctx!.restore()
    }

    rafId = requestAnimationFrame(frame)
  }

  rafId = requestAnimationFrame(frame)
}

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
})
</script>

<template>
  <section class="overview">
    <header class="page-header">
      <h1 class="title">The Solar System</h1>
      <p class="lede">
        Eight planets, dozens of moons, one star. All facts served live from the Solar System API.
      </p>
    </header>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <div v-if="planets.length" class="orbit-stage">
      <canvas
        ref="orbitCanvas"
        class="orbit-canvas"
        :class="{ 'is-hovering': hoveredPlanet || hoveredSun }"
        @pointermove="onCanvasPointerMove"
        @pointerleave="onCanvasPointerLeave"
        @click="onCanvasClick"
      ></canvas>
      <div
        v-if="hoveredPlanet || hoveredSun"
        class="orbit-tooltip"
        :style="{ transform: `translate(${tooltipPos.x}px, ${tooltipPos.y}px)` }"
      >
        {{ hoveredPlanet ? hoveredPlanet.name : 'Sun' }}
      </div>
    </div>
  </section>
</template>

<style scoped>
.overview { display: flex; flex-direction: column; gap: 28px; }

.page-header { display: flex; flex-direction: column; gap: 6px; }
.title { font-size: 28px; font-weight: 700; letter-spacing: -0.02em; }
.lede { color: var(--text-muted); font-size: 14px; max-width: 640px; }

.orbit-stage {
  position: relative;
  width: 100%;
  aspect-ratio: 5 / 2;
  max-height: 360px;
  background: radial-gradient(
    ellipse at center,
    color-mix(in srgb, var(--surface) 80%, #000 20%) 0%,
    var(--bg) 70%
  );
  border: 1px solid var(--border);
  border-radius: 16px;
  overflow: hidden;
}

.orbit-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  cursor: default;
}

.orbit-canvas.is-hovering { cursor: pointer; }

.orbit-tooltip {
  position: absolute;
  top: 0;
  left: 0;
  margin: -36px 0 0 12px;
  padding: 4px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}

</style>
