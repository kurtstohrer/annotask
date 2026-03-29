<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import type { Planet } from '../types'

const props = defineProps<{ planets: Planet[]; loading: boolean }>()
const emit = defineEmits<{ select: [planet: Planet] }>()

const canvas = ref<HTMLCanvasElement | null>(null)
let animationId = 0
// Store planet positions each frame for hit-testing
let planetPositions: { planet: Planet; x: number; y: number; size: number }[] = []
// Store moon positions for hit-testing in zoomed view
let moonPositions: { name: string; x: number; y: number; size: number }[] = []

const sorted = computed(() =>
  [...props.planets].sort((a, b) => a.distance_from_sun_mkm - b.distance_from_sun_mkm)
)

// Zoom state
const zoomedPlanet = ref<Planet | null>(null)

// Generate synthetic moon data from a planet's moon count
function generateMoons(planet: Planet): { name: string; color: string; size: number }[] {
  const moonColors = ['#c0c0c0', '#a0a0a0', '#d4c5a9', '#b8a88a', '#8899aa', '#aabbcc', '#ccbbaa', '#99aaaa']
  const moons: { name: string; color: string; size: number }[] = []
  const count = Math.min(planet.moons, 20) // cap visual moons at 20
  for (let i = 0; i < count; i++) {
    const seed = (planet.id * 137 + i * 31) % 1000
    moons.push({
      name: `Moon ${i + 1}`,
      color: moonColors[i % moonColors.length],
      size: 2 + (seed % 5)
    })
  }
  return moons
}

// Known moon names for major planets
const knownMoonNames: Record<string, string[]> = {
  Earth: ['Moon'],
  Mars: ['Phobos', 'Deimos'],
  Jupiter: ['Io', 'Europa', 'Ganymede', 'Callisto', 'Amalthea', 'Himalia', 'Thebe', 'Elara'],
  Saturn: ['Titan', 'Rhea', 'Iapetus', 'Dione', 'Tethys', 'Enceladus', 'Mimas', 'Hyperion'],
  Uranus: ['Titania', 'Oberon', 'Umbriel', 'Ariel', 'Miranda', 'Puck', 'Sycorax', 'Portia'],
  Neptune: ['Triton', 'Proteus', 'Nereid', 'Larissa', 'Galatea', 'Despina', 'Thalassa', 'Naiad'],
}

function getMoonName(planet: Planet, index: number): string {
  const names = knownMoonNames[planet.name]
  if (names && index < names.length) return names[index]
  return `Moon ${index + 1}`
}

function drawSolarSystem(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  const cx = w / 2
  const cy = h / 2

  // Draw starfield
  const starSeed = 42
  for (let i = 0; i < 120; i++) {
    const sx = ((starSeed * (i + 1) * 7919) % w)
    const sy = ((starSeed * (i + 1) * 6271) % h)
    const brightness = 0.2 + (i % 5) * 0.15
    ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`
    ctx.beginPath()
    ctx.arc(sx, sy, 0.8, 0, Math.PI * 2)
    ctx.fill()
  }

  // Sun glow
  const sunRadius = 22
  const glow = ctx.createRadialGradient(cx, cy, sunRadius * 0.5, cx, cy, sunRadius * 3)
  glow.addColorStop(0, 'rgba(250, 204, 21, 0.4)')
  glow.addColorStop(1, 'rgba(250, 204, 21, 0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, sunRadius * 3, 0, Math.PI * 2)
  ctx.fill()

  // Sun
  const sunGrad = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, sunRadius)
  sunGrad.addColorStop(0, '#fef08a')
  sunGrad.addColorStop(0.5, '#facc15')
  sunGrad.addColorStop(1, '#ea580c')
  ctx.fillStyle = sunGrad
  ctx.beginPath()
  ctx.arc(cx, cy, sunRadius, 0, Math.PI * 2)
  ctx.fill()

  const planets = sorted.value
  const positions: typeof planetPositions = []
  if (planets.length === 0) return

  const minOrbit = 50
  const maxOrbit = Math.min(cx, cy) - 30
  const orbitStep = (maxOrbit - minOrbit) / planets.length

  planets.forEach((planet, i) => {
    const orbitRadius = minOrbit + orbitStep * (i + 0.5)

    // Orbit ring
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, orbitRadius, 0, Math.PI * 2)
    ctx.stroke()

    // Planet position — slower for outer planets
    const speed = 0.0003 / (1 + i * 0.4)
    const angle = time * speed + (i * Math.PI * 2) / planets.length
    const px = cx + Math.cos(angle) * orbitRadius
    const py = cy + Math.sin(angle) * orbitRadius

    // Planet size scaled by radius_km (min 4, max 14)
    const minR = Math.min(...planets.map(p => p.radius_km))
    const maxR = Math.max(...planets.map(p => p.radius_km))
    const planetSize = 4 + ((planet.radius_km - minR) / (maxR - minR || 1)) * 10

    // Planet glow
    const planetGlow = ctx.createRadialGradient(px, py, planetSize * 0.5, px, py, planetSize * 2.5)
    planetGlow.addColorStop(0, planet.color + '66')
    planetGlow.addColorStop(1, planet.color + '00')
    ctx.fillStyle = planetGlow
    ctx.beginPath()
    ctx.arc(px, py, planetSize * 2.5, 0, Math.PI * 2)
    ctx.fill()

    // Planet body
    ctx.fillStyle = planet.color
    ctx.beginPath()
    ctx.arc(px, py, planetSize, 0, Math.PI * 2)
    ctx.fill()

    // Label
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
    ctx.font = '11px Inter, system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(planet.name, px, py - planetSize - 6)

    positions.push({ planet, x: px, y: py, size: planetSize })
  })

  planetPositions = positions
}

function drawZoomedPlanet(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
  const planet = zoomedPlanet.value
  if (!planet) return

  const cx = w / 2
  const cy = h / 2

  // Draw starfield (same as solar system view)
  const starSeed = 42
  for (let i = 0; i < 120; i++) {
    const sx = ((starSeed * (i + 1) * 7919) % w)
    const sy = ((starSeed * (i + 1) * 6271) % h)
    const brightness = 0.2 + (i % 5) * 0.15
    ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`
    ctx.beginPath()
    ctx.arc(sx, sy, 0.8, 0, Math.PI * 2)
    ctx.fill()
  }

  // Planet glow
  const planetRadius = 40
  const glow = ctx.createRadialGradient(cx, cy, planetRadius * 0.5, cx, cy, planetRadius * 3)
  glow.addColorStop(0, planet.color + '55')
  glow.addColorStop(1, planet.color + '00')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, planetRadius * 3, 0, Math.PI * 2)
  ctx.fill()

  // Planet body
  const planetGrad = ctx.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, planetRadius)
  planetGrad.addColorStop(0, lightenColor(planet.color, 40))
  planetGrad.addColorStop(0.6, planet.color)
  planetGrad.addColorStop(1, darkenColor(planet.color, 40))
  ctx.fillStyle = planetGrad
  ctx.beginPath()
  ctx.arc(cx, cy, planetRadius, 0, Math.PI * 2)
  ctx.fill()

  // Planet name
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
  ctx.font = 'bold 16px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(planet.name, cx, cy - planetRadius - 14)

  // Moon count subtitle
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'
  ctx.font = '12px Inter, system-ui, sans-serif'
  ctx.fillText(
    planet.moons === 0 ? 'No known moons' : `${planet.moons} known moon${planet.moons > 1 ? 's' : ''}`,
    cx, cy - planetRadius - 0
  )

  // Draw moons
  const moons = generateMoons(planet)
  const positions: typeof moonPositions = []

  if (moons.length > 0) {
    const minOrbit = planetRadius + 30
    const maxOrbit = Math.min(cx, cy) - 20
    const orbitStep = moons.length > 1 ? (maxOrbit - minOrbit) / moons.length : 0

    moons.forEach((moon, i) => {
      const orbitRadius = minOrbit + orbitStep * (i + 0.5)

      // Orbit ring
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(cx, cy, orbitRadius, 0, Math.PI * 2)
      ctx.stroke()

      // Moon position — inner moons orbit faster
      const speed = 0.0008 / (1 + i * 0.3)
      const angle = time * speed + (i * Math.PI * 2) / moons.length + (i * 0.7)
      const mx = cx + Math.cos(angle) * orbitRadius
      const my = cy + Math.sin(angle) * orbitRadius

      // Moon glow
      const moonGlow = ctx.createRadialGradient(mx, my, moon.size * 0.3, mx, my, moon.size * 2)
      moonGlow.addColorStop(0, moon.color + '44')
      moonGlow.addColorStop(1, moon.color + '00')
      ctx.fillStyle = moonGlow
      ctx.beginPath()
      ctx.arc(mx, my, moon.size * 2, 0, Math.PI * 2)
      ctx.fill()

      // Moon body
      ctx.fillStyle = moon.color
      ctx.beginPath()
      ctx.arc(mx, my, moon.size, 0, Math.PI * 2)
      ctx.fill()

      // Moon label
      const name = getMoonName(planet, i)
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'
      ctx.font = '10px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(name, mx, my - moon.size - 5)

      positions.push({ name, x: mx, y: my, size: moon.size })
    })
  }

  moonPositions = positions

  // Back button hint
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.font = '12px Inter, system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('← Click to go back', 16, 24)
}

function lightenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.min(255, (num >> 16) + amount)
  const g = Math.min(255, ((num >> 8) & 0xff) + amount)
  const b = Math.min(255, (num & 0xff) + amount)
  return `rgb(${r}, ${g}, ${b})`
}

function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, (num >> 16) - amount)
  const g = Math.max(0, ((num >> 8) & 0xff) - amount)
  const b = Math.max(0, (num & 0xff) - amount)
  return `rgb(${r}, ${g}, ${b})`
}

function draw(time: number) {
  const c = canvas.value
  if (!c) return
  const ctx = c.getContext('2d')
  if (!ctx) return

  const dpr = window.devicePixelRatio || 1
  const rect = c.getBoundingClientRect()
  c.width = rect.width * dpr
  c.height = rect.height * dpr
  ctx.scale(dpr, dpr)

  const w = rect.width
  const h = rect.height

  ctx.clearRect(0, 0, w, h)

  if (zoomedPlanet.value) {
    drawZoomedPlanet(ctx, w, h, time)
  } else {
    drawSolarSystem(ctx, w, h, time)
  }

  animationId = requestAnimationFrame(draw)
}

function onCanvasClick(e: MouseEvent) {
  const c = canvas.value
  if (!c) return
  const rect = c.getBoundingClientRect()
  const mx = e.clientX - rect.left
  const my = e.clientY - rect.top

  if (zoomedPlanet.value) {
    // In zoomed view — click anywhere to go back
    zoomedPlanet.value = null
    return
  }

  // Solar system view — hit test planets
  let best: { planet: Planet; dist: number } | null = null
  for (const p of planetPositions) {
    const dx = mx - p.x
    const dy = my - p.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    const hitRadius = Math.max(p.size + 8, 16)
    if (dist <= hitRadius && (!best || dist < best.dist)) {
      best = { planet: p.planet, dist }
    }
  }
  if (best) {
    if (best.planet.moons > 0) {
      // Zoom into planet+moons diagram
      zoomedPlanet.value = best.planet
    }
    emit('select', best.planet)
  }
}

// Restart the animation loop when loading finishes and the canvas appears
watch(() => props.loading, async (loading) => {
  if (!loading) {
    await nextTick()
    cancelAnimationFrame(animationId)
    animationId = requestAnimationFrame(draw)
  }
})

onMounted(() => {
  animationId = requestAnimationFrame(draw)
})

onUnmounted(() => {
  cancelAnimationFrame(animationId)
})
</script>

<template>
  <div class="orbital-wrapper">
    <div v-if="loading" class="orbital-loading">Loading planets...</div>
    <canvas v-else ref="canvas" class="orbital-canvas" @click="onCanvasClick"></canvas>
  </div>
</template>

<style scoped>
.orbital-wrapper {
  flex: 1;
  min-height: 500px;
  background: #0a0a0f;
  border-radius: 10px;
  overflow: hidden;
}

.orbital-canvas {
  width: 100%;
  height: 500px;
  display: block;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.orbital-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 500px;
  color: var(--text-muted);
  font-size: 14px;
}
</style>
