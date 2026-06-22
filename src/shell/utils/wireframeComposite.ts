import type { WireframeDirectionChange } from '../../schema'
import type { WireframeBlock, WireframeCanvasState } from '../../shared/wireframe-types'

/**
 * Compose the labeled before/after PNG for a wireframe apply: left pane is
 * the full-page capture (the rendered truth), right pane re-draws the sketch
 * — block images at their current rects, placeholders as dashed boxes —
 * with numbered badges matching the direction list 1:1. Honesty labels are
 * burned into the pixels so the image can't outrun its caveats.
 *
 * Plain offscreen 2D canvas, not html2canvas: deterministic, no vendor load
 * in the shell, no transform-capture quirks.
 */

const PANE_MAX_W = 1200
const HEADER_H = 26
const GUTTER = 16
const MAX_BYTES = 3_500_000

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function dataUrlBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(',')
  return Math.floor((dataUrl.length - i - 1) * 3 / 4)
}

/** The block a direction talks about — direction ids are `wd-<blockId>-<op>`. */
function blockIdOf(direction: WireframeDirectionChange): string {
  return direction.id.replace(/^wd-/, '').replace(/-(move|resize|delete|add|note)$/, '')
}

export interface ComposeWireframeDiffOptions {
  canvas: WireframeCanvasState
  directions: WireframeDirectionChange[]
  /** Resolves a block's image source (session dataUrl → sidecar URL → null). */
  imageSrc: (block: WireframeBlock) => string | null
  /** Full-page capture URL — the honest left pane. Null = stitch blocks. */
  beforeSrc: string | null
}

export async function composeWireframeDiff(opts: ComposeWireframeDiffOptions): Promise<string | null> {
  for (let scaleDown = 1; scaleDown >= 0.5; scaleDown *= 0.8) {
    const dataUrl = await composeAt(opts, scaleDown)
    if (!dataUrl) return null
    if (dataUrlBytes(dataUrl) <= MAX_BYTES) return dataUrl
  }
  return null
}

async function composeAt(opts: ComposeWireframeDiffOptions, scaleDown: number): Promise<string | null> {
  const { canvas: state, directions, imageSrc, beforeSrc } = opts
  const docW = Math.max(state.viewport.docWidth, 1)
  const docH = Math.max(state.viewport.docHeight, 1)
  const scale = Math.min(PANE_MAX_W / docW, 1) * scaleDown
  const paneW = Math.round(docW * scale)
  const paneH = Math.round(docH * scale)
  const totalW = paneW * 2 + GUTTER
  const totalH = paneH + HEADER_H

  const el = document.createElement('canvas')
  el.width = totalW
  el.height = totalH
  const ctx = el.getContext('2d')
  if (!ctx) return null

  ctx.fillStyle = '#1c1c1f'
  ctx.fillRect(0, 0, totalW, totalH)

  // Header labels — burned in, not metadata.
  ctx.fillStyle = '#e8e8ea'
  ctx.font = `600 ${Math.max(11, Math.round(13 * scaleDown))}px system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  ctx.fillText('BEFORE — captured render', 8, HEADER_H / 2)
  ctx.fillText('AFTER — wireframe sketch (rearranged images, not real UI)', paneW + GUTTER + 8, HEADER_H / 2)

  // ── BEFORE pane ──
  const beforeX = 0
  const paneY = HEADER_H
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(beforeX, paneY, paneW, paneH)
  const beforeImg = beforeSrc ? await loadImage(beforeSrc) : null
  if (beforeImg) {
    ctx.drawImage(beforeImg, beforeX, paneY, paneW, paneH)
  } else {
    // Fallback: stitch per-block images at their ORIGINAL rects.
    for (const b of state.blocks) {
      if (b.kind !== 'captured' || b.duplicateOf || !b.originalRect) continue
      const src = imageSrc(b)
      const r = b.originalRect
      if (!src) continue
      const img = await loadImage(src)
      if (img) ctx.drawImage(img, beforeX + r.x * scale, paneY + r.y * scale, r.width * scale, r.height * scale)
    }
  }

  // ── AFTER pane ──
  const afterX = paneW + GUTTER
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(afterX, paneY, paneW, paneH)
  const survivors = state.blocks.filter((b) => !b.deleted).slice().sort((a, b) => a.z - b.z)
  for (const b of survivors) {
    const r = b.rect
    const x = afterX + r.x * scale
    const y = paneY + r.y * scale
    const w = r.width * scale
    const h = r.height * scale
    const src = imageSrc(b)
    const img = src ? await loadImage(src) : null
    if (img) {
      ctx.drawImage(img, x, y, w, h)
    } else {
      // Placeholder / failed capture: dashed labeled box — never fake pixels.
      const isSection = b.kind === 'placeholder' && (!!b.md || !!b.data)
      ctx.save()
      ctx.strokeStyle = b.kind === 'placeholder' ? '#7c6ff0' : '#9a9aa2'
      ctx.setLineDash([6, 4])
      ctx.lineWidth = 2
      ctx.strokeRect(x + 1, y + 1, Math.max(w - 2, 2), Math.max(h - 2, 2))
      ctx.fillStyle = '#55555c'
      ctx.font = `500 ${Math.max(10, Math.round(12 * scaleDown))}px system-ui, sans-serif`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      const tag = b.kind !== 'placeholder' ? '' : isSection ? ' (section — user spec attached)' : ' (placeholder)'
      const text = b.kind === 'placeholder' ? `${b.label ?? 'placeholder'}${tag}` : 'capture failed'
      const lineH = Math.max(12, Math.round(14 * scaleDown))
      const extraLines = (isSection ? 1 : 0) + (b.data ? 1 : 0)
      const baseY = y + h / 2 - (extraLines * lineH) / 2
      ctx.fillText(text, x + w / 2, baseY, Math.max(w - 8, 8))
      // Honest summaries beneath the label — first md line + binding identity.
      // The FULL spec rides the direction payload; pixels never fabricate UI.
      ctx.font = `400 ${Math.max(9, Math.round(10 * scaleDown))}px system-ui, sans-serif`
      ctx.fillStyle = '#7a7a82'
      let lineY = baseY + lineH
      if (b.md) {
        const firstLine = b.md.split('\n')[0].replace(/^#+\s*/, '').slice(0, 120)
        ctx.fillText(firstLine, x + w / 2, lineY, Math.max(w - 8, 8))
        lineY += lineH
      }
      if (b.data) {
        ctx.fillText(`data: ${b.data.name}${b.data.path ? ` → ${b.data.path}` : ''}`, x + w / 2, lineY, Math.max(w - 8, 8))
      }
      ctx.restore()
    }
  }
  // Deleted blocks: a crossed dashed outline at the old spot — the sketch
  // says "this is gone", the pane shows where it was.
  for (const b of state.blocks) {
    if (!b.deleted) continue
    const r = b.originalRect ?? b.rect
    const x = afterX + r.x * scale
    const y = paneY + r.y * scale
    const w = r.width * scale
    const h = r.height * scale
    ctx.save()
    ctx.strokeStyle = '#d24545'
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1.5
    ctx.strokeRect(x, y, w, h)
    ctx.beginPath()
    ctx.moveTo(x, y); ctx.lineTo(x + w, y + h)
    ctx.moveTo(x + w, y); ctx.lineTo(x, y + h)
    ctx.stroke()
    ctx.restore()
  }

  // ── Numbered badges, 1:1 with the direction list ──
  const byId = new Map(state.blocks.map((b) => [b.id, b]))
  directions.forEach((d, i) => {
    const block = byId.get(blockIdOf(d))
    const r = block?.deleted ? (block.originalRect ?? block.rect) : (block?.rect ?? d.measured?.after ?? d.measured?.before)
    if (!r) return
    const bx = afterX + r.x * scale + 4
    const by = paneY + r.y * scale + 4
    const radius = 11
    ctx.save()
    ctx.beginPath()
    ctx.arc(bx + radius, by + radius, radius, 0, Math.PI * 2)
    ctx.fillStyle = '#4f46e5'
    ctx.fill()
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i + 1), bx + radius, by + radius + 0.5)
    ctx.restore()
  })

  try {
    return el.toDataURL('image/png')
  } catch {
    return null
  }
}
