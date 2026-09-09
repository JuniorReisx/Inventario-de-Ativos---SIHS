export type RelatorioKpi = {
  label: string
  value: string
  sub?: string
}

export type RelatorioBar = {
  label: string
  value: string
  pct: number
  color: string
}

export type RelatorioTable = {
  headers: string[]
  rows: string[][]
  colWeights?: number[]
}

export type RelatorioSection = {
  title: string
  bars?: RelatorioBar[]
  table?: RelatorioTable
  note?: string
}

export type RelatorioTheme = 'agua' | 'esgoto' | 'infra'

export type RelatorioGuide = {
  title: string
  items: string[]
}

export type RelatorioPdfInput = {
  title: string
  theme: RelatorioTheme
  scope: string
  source: string
  fileName: string
  kpis: RelatorioKpi[]
  guide?: RelatorioGuide
  compact?: boolean
  mapCaption?: string
  mapDataUrl?: string | null
  mapLegend?: RelatorioLegendGroup[]
  mapLegendTitle?: string
  mapLegendNote?: string
  sections: RelatorioSection[]
}

export type RelatorioLegendItem = {
  label: string
  color: string
  icon?: string | null
}

export type RelatorioLegendGroup = {
  title?: string
  items: RelatorioLegendItem[]
}

const THEMES: Record<RelatorioTheme, { header: string, header2: string, accent: string, kpi: string }> = {
  agua: { header: '#0a7fa8', header2: '#002231', accent: '#1B5FA0', kpi: '#eff7fc' },
  esgoto: { header: '#8B5A2B', header2: '#1A0F08', accent: '#8B5A2B', kpi: '#f5ebdd' },
  infra: { header: '#0a5c66', header2: '#002231', accent: '#1aa8c8', kpi: '#e8f6f8' }
}

const PAGE_W = 1240
const PAGE_H = 1754
const PAD = 56
const CONTENT_W = PAGE_W - PAD * 2

function wrapText (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const lines: string[] = []
  let current = words[0]
  for (let i = 1; i < words.length; i++) {
    const next = `${current} ${words[i]}`
    if (ctx.measureText(next).width <= maxWidth) current = next
    else {
      lines.push(current)
      current = words[i]
    }
  }
  lines.push(current)
  return lines
}

function loadImage (url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Falha ao carregar imagem do mapa'))
    img.src = url
  })
}

function waitImg (img: HTMLImageElement): Promise<void> {
  if (img.complete && (img.naturalWidth || img.width)) return Promise.resolve()
  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true })
    img.addEventListener('error', () => resolve(), { once: true })
    setTimeout(() => resolve(), 900)
  })
}

function colorFromLegendSymbol (el: HTMLElement | null): string {
  if (!el) return '#5b6b75'
  const filled = el.querySelector('[fill]') as SVGElement | null
  const fill = filled?.getAttribute('fill') || ''
  if (fill && fill !== 'none' && !fill.startsWith('url(')) return fill
  const styleText = el.getAttribute('style') || el.querySelector('[style]')?.getAttribute('style') || ''
  const painted = String(styleText).match(/rgba?\([^)]+\)|#([0-9a-fA-F]{3,8})/i)
  if (painted) return painted[0]
  const nodes = [el, ...Array.from(el.querySelectorAll('*'))] as HTMLElement[]
  for (const node of nodes) {
    const bg = window.getComputedStyle(node).backgroundColor
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg
  }
  return '#5b6b75'
}

export async function iconFromLegendNode (root: HTMLElement | null): Promise<string | null> {
  if (!root) return null
  const canvasEl = root.querySelector('canvas') as HTMLCanvasElement | null
  if (canvasEl && canvasEl.width && canvasEl.height) {
    try { return canvasEl.toDataURL('image/png') } catch { /* canvas protegido */ }
  }
  const img = root.querySelector('img') as HTMLImageElement | null
  if (img) {
    await waitImg(img)
    if (img.src && img.src.startsWith('data:')) return img.src
    try {
      const c = document.createElement('canvas')
      const w = Math.max(1, img.naturalWidth || img.width || 24)
      const h = Math.max(1, img.naturalHeight || img.height || 24)
      c.width = w
      c.height = h
      const g = c.getContext('2d')
      if (g) {
        g.drawImage(img, 0, 0, w, h)
        return c.toDataURL('image/png')
      }
    } catch { /* cors */ }
    if (img.src) return img.src
  }
  const svg = root.querySelector('svg')
  if (svg) {
    const clone = svg.cloneNode(true) as SVGElement
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const xml = new XMLSerializer().serializeToString(clone)
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  }
  return null
}

export async function iconFromPreviewHtml (html: string): Promise<string | null> {
  if (!html) return null
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:#fff;'
  host.innerHTML = html
  document.body.appendChild(host)
  try {
    await Promise.all(Array.from(host.querySelectorAll('img')).map((node) => waitImg(node as HTMLImageElement)))
    return await iconFromLegendNode(host)
  } finally {
    host.remove()
  }
}

export async function legendGroupsFromEsriDom (container: HTMLElement | null): Promise<RelatorioLegendGroup[]> {
  if (!container) return []
  const groups: RelatorioLegendGroup[] = []
  const layerNodes = Array.from(container.querySelectorAll('.esri-legend__layer')) as HTMLElement[]
  const blocks = layerNodes.length ? layerNodes : [container]
  for (const block of blocks) {
    const title = (block.querySelector('.esri-legend__layer-caption, .esri-legend__layer-title, .esri-legend__service-label')?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
    const items: RelatorioLegendItem[] = []
    const seen = new Set<string>()
    for (const node of Array.from(block.querySelectorAll('.esri-legend__layer-row'))) {
      const row = node as HTMLElement
      if (row.style.display === 'none') continue
      const info = row.querySelector('.esri-legend__layer-cell--info') as HTMLElement | null
      const label = (info?.textContent || '').replace(/\s+/g, ' ').trim()
      if (!label || seen.has(label)) continue
      seen.add(label)
      const symbol = row.querySelector('.esri-legend__layer-cell--symbols') as HTMLElement | null
      items.push({
        label,
        color: colorFromLegendSymbol(symbol),
        icon: await iconFromLegendNode(symbol)
      })
    }
    if (items.length) groups.push({ title: title || undefined, items })
  }
  return groups
}

export async function captureEsriLegendFromView (view: any): Promise<RelatorioLegendGroup[]> {
  if (!view) return []
  const expand = view.__portalLegendExpand
  const wasExpanded = Boolean(expand?.expanded)
  try {
    if (expand && !wasExpanded && typeof expand.expand === 'function') {
      expand.expand()
      await new Promise((resolve) => setTimeout(resolve, 320))
    }
    const root = view.container instanceof HTMLElement ? view.container : document.body
    const legendRoot = root.querySelector('.esri-legend') as HTMLElement | null
    if (legendRoot) {
      await Promise.all(Array.from(legendRoot.querySelectorAll('img')).map((node) => waitImg(node as HTMLImageElement)))
    }
    return await legendGroupsFromEsriDom(legendRoot)
  } finally {
    if (expand && !wasExpanded && typeof expand.collapse === 'function') {
      try { expand.collapse() } catch (_) {}
    }
  }
}

function strBytes (value: string): Uint8Array {
  const out = new Uint8Array(value.length)
  for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff
  return out
}

function concatBytes (parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function canvasToJpeg (canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
  const base64 = dataUrl.split(',')[1] || ''
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function jpegPagesToPdf (jpegs: Array<{ bytes: Uint8Array, width: number, height: number }>): Blob {
  const A4W = 595.28
  const A4H = 841.89
  const parts: Uint8Array[] = [strBytes('%PDF-1.4\n')]
  const offsets = [0]
  let length = parts[0].length

  const add = (chunk: Uint8Array | string) => {
    const bytes = typeof chunk === 'string' ? strBytes(chunk) : chunk
    offsets.push(length)
    parts.push(bytes)
    length += bytes.length
  }

  const pageIds: number[] = []
  let nextId = 3
  const imageBlocks: Array<{ pageId: number, contentId: number, imageId: number, jpeg: Uint8Array, w: number, h: number }> = []
  for (const page of jpegs) {
    const pageId = nextId++
    const contentId = nextId++
    const imageId = nextId++
    pageIds.push(pageId)
    imageBlocks.push({ pageId, contentId, imageId, jpeg: page.bytes, w: page.width, h: page.height })
  }

  add(`1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n`)
  add(`2 0 obj << /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >> endobj\n`)

  for (const block of imageBlocks) {
    add(`${block.pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4W} ${A4H}] /Resources << /XObject << /Im0 ${block.imageId} 0 R >> >> /Contents ${block.contentId} 0 R >> endobj\n`)
    const stream = `q ${A4W} 0 0 ${A4H} 0 0 cm /Im0 Do Q\n`
    add(`${block.contentId} 0 obj << /Length ${stream.length} >> stream\n${stream}endstream endobj\n`)
    add(concatBytes([
      strBytes(`${block.imageId} 0 obj << /Type /XObject /Subtype /Image /Width ${block.w} /Height ${block.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${block.jpeg.length} >> stream\n`),
      block.jpeg,
      strBytes('\nendstream endobj\n')
    ]))
  }

  const xrefStart = length
  let xref = `xref\n0 ${nextId}\n0000000000 65535 f \n`
  for (let i = 1; i < nextId; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  }
  add(xref)
  add(`trailer << /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)
  return new Blob([concatBytes(parts)], { type: 'application/pdf' })
}

function downloadBlob (blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
}

class ReportCanvas {
  pages: HTMLCanvasElement[] = []
  canvas!: HTMLCanvasElement
  ctx!: CanvasRenderingContext2D
  y = 0
  theme: RelatorioPdfInput['theme']
  colors: (typeof THEMES)[RelatorioTheme]

  constructor (theme: RelatorioTheme) {
    this.theme = theme
    this.colors = THEMES[theme]
    this.newPage()
  }

  newPage (): void {
    const canvas = document.createElement('canvas')
    canvas.width = PAGE_W
    canvas.height = PAGE_H
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas indisponível')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, PAGE_W, PAGE_H)
    this.pages.push(canvas)
    this.canvas = canvas
    this.ctx = ctx
    this.y = PAD
  }

  ensure (height: number): void {
    if (this.y + height > PAGE_H - 72) this.newPage()
  }

  stampFooters (generatedAt: string): void {
    this.pages.forEach((page, index) => {
      const ctx = page.getContext('2d')
      if (!ctx) return
      ctx.fillStyle = '#8aa0ab'
      ctx.font = '15px Segoe UI, Arial, sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`Portal da Água · SIHS/BA · ${generatedAt}`, PAD, PAGE_H - 28)
      ctx.textAlign = 'right'
      ctx.fillText(`Página ${index + 1} de ${this.pages.length}`, PAGE_W - PAD, PAGE_H - 28)
      ctx.textAlign = 'left'
    })
  }
}

export async function captureMapView (view: any): Promise<string | null> {
  if (!view || typeof view.takeScreenshot !== 'function') return null
  try {
    await view.when?.()
    await new Promise((resolve) => {
      if (!view.updating) {
        resolve(undefined)
        return
      }
      const handle = view.watch?.('updating', (updating: boolean) => {
        if (!updating) {
          handle?.remove?.()
          resolve(undefined)
        }
      })
      setTimeout(() => {
        handle?.remove?.()
        resolve(undefined)
      }, 2500)
    })
    const shot = await view.takeScreenshot({
      format: 'jpg',
      quality: 92
    })
    return shot?.dataUrl || null
  } catch (error) {
    console.warn('[relatorio-pdf] captura do mapa:', error)
    return null
  }
}

export function slugRelatorio (value: string): string {
  return String(value || 'selecao')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 72) || 'selecao'
}

async function drawLegendSwatch (
  ctx: CanvasRenderingContext2D,
  item: RelatorioLegendItem,
  x: number,
  y: number,
  size: number
): Promise<void> {
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, x, y, size, size, 3)
  ctx.fill()
  ctx.strokeStyle = 'rgba(28,43,51,0.16)'
  ctx.lineWidth = 1
  ctx.stroke()
  let drewIcon = false
  if (item.icon) {
    try {
      const img = await loadImage(item.icon)
      const max = size - 4
      const ratio = (img.width || 1) / (img.height || 1)
      let dw = max
      let dh = max
      if (ratio > 1) dh = max / ratio
      else dw = max * ratio
      ctx.drawImage(img, x + (size - dw) / 2, y + (size - dh) / 2, dw, dh)
      drewIcon = true
    } catch {
      drewIcon = false
    }
  }
  if (!drewIcon) {
    ctx.fillStyle = item.color || '#8aa0ab'
    roundRect(ctx, x + 3, y + 3, size - 6, size - 6, 2)
    ctx.fill()
  }
}

async function paintLegendOnMap (
  ctx: CanvasRenderingContext2D,
  colors: (typeof THEMES)[RelatorioTheme],
  groups: RelatorioLegendGroup[],
  mapX: number,
  mapY: number,
  mapW: number,
  mapH: number
): Promise<void> {
  const visible = groups.filter((group) => group.items?.length)
  if (!visible.length) return

  const boxW = Math.min(268, Math.max(180, mapW * 0.3))
  const inner = 10
  const rowH = 18
  const groupTitleH = 16
  let contentH = 20
  for (const group of visible) {
    if (group.title) contentH += groupTitleH
    contentH += group.items.length * rowH + 6
  }
  const boxH = Math.min(mapH - 20, contentH + inner * 2)
  const boxX = mapX + mapW - boxW - 12
  const boxY = mapY + 12

  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.94)'
  roundRect(ctx, boxX, boxY, boxW, boxH, 8)
  ctx.fill()
  ctx.strokeStyle = 'rgba(28,43,51,0.18)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.beginPath()
  roundRect(ctx, boxX, boxY, boxW, boxH, 8)
  ctx.clip()

  ctx.fillStyle = colors.header2
  ctx.font = '700 12px Segoe UI, Arial, sans-serif'
  ctx.fillText('Legenda', boxX + inner, boxY + 16, boxW - inner * 2)

  let y = boxY + 26
  const maxY = boxY + boxH - 8
  for (const group of visible) {
    if (y + 14 > maxY) break
    if (group.title) {
      ctx.fillStyle = colors.header
      ctx.font = '700 11px Segoe UI, Arial, sans-serif'
      ctx.fillText(group.title, boxX + inner, y + 12, boxW - inner * 2)
      y += groupTitleH
    }
    for (const item of group.items) {
      if (y + rowH > maxY) break
      await drawLegendSwatch(ctx, item, boxX + inner, y, 14)
      ctx.fillStyle = '#2c3d47'
      ctx.font = '11px Segoe UI, Arial, sans-serif'
      ctx.fillText(item.label, boxX + inner + 20, y + 11, boxW - inner * 2 - 20)
      y += rowH
    }
    y += 4
  }
  ctx.restore()
}

async function paintMapLegend (
  painter: ReportCanvas,
  ctx: () => CanvasRenderingContext2D,
  colors: (typeof THEMES)[RelatorioTheme],
  input: RelatorioPdfInput
): Promise<void> {
  const groups = (input.mapLegend || []).filter((group) => group.items?.length)
  if (!groups.length) return

  const title = input.mapLegendTitle || 'Legenda do mapa'
  const note = String(input.mapLegendNote || '').trim()
  const colW = (CONTENT_W - 32) / 2
  const rowH = 32
  const sw = 22

  ctx().font = '14px Segoe UI, Arial, sans-serif'
  const noteLines = note ? wrapText(ctx(), note, CONTENT_W - 8) : []
  painter.ensure(48 + noteLines.length * 18)
  ctx().fillStyle = '#1c2b33'
  ctx().font = '700 20px Segoe UI, Arial, sans-serif'
  ctx().fillText(title, PAD, painter.y)
  painter.y += 10
  if (noteLines.length) {
    ctx().fillStyle = '#5b6b75'
    ctx().font = '14px Segoe UI, Arial, sans-serif'
    noteLines.forEach((line) => {
      ctx().fillText(line, PAD, painter.y + 16, CONTENT_W)
      painter.y += 18
    })
    painter.y += 8
  } else {
    painter.y += 8
  }

  for (const group of groups) {
    const rows = Math.max(1, Math.ceil(group.items.length / 2))
    const boxH = (group.title ? 28 : 10) + rows * rowH + 14
    painter.ensure(boxH + 8)
    ctx().fillStyle = '#f4f7f9'
    roundRect(ctx(), PAD, painter.y, CONTENT_W, boxH, 10)
    ctx().fill()
    let y = painter.y + 22
    if (group.title) {
      ctx().fillStyle = colors.header2
      ctx().font = '700 15px Segoe UI, Arial, sans-serif'
      ctx().fillText(group.title, PAD + 16, y, CONTENT_W - 32)
      y += 22
    }
    for (let index = 0; index < group.items.length; index++) {
      const item = group.items[index]
      const col = index % 2
      const row = Math.floor(index / 2)
      const x = PAD + 16 + col * colW
      const iy = y + row * rowH
      ctx().fillStyle = '#ffffff'
      roundRect(ctx(), x, iy - 14, sw, sw, 4)
      ctx().fill()
      ctx().strokeStyle = 'rgba(28,43,51,0.16)'
      ctx().lineWidth = 1
      ctx().stroke()
      let drewIcon = false
      if (item.icon) {
        try {
          const img = await loadImage(item.icon)
          const max = 18
          const ratio = (img.width || 1) / (img.height || 1)
          let dw = max
          let dh = max
          if (ratio > 1) dh = max / ratio
          else dw = max * ratio
          ctx().drawImage(img, x + (sw - dw) / 2, iy - 14 + (sw - dh) / 2, dw, dh)
          drewIcon = true
        } catch {
          drewIcon = false
        }
      }
      if (!drewIcon) {
        ctx().fillStyle = item.color || '#8aa0ab'
        roundRect(ctx(), x + 4, iy - 10, 14, 14, 3)
        ctx().fill()
      }
      ctx().fillStyle = '#2c3d47'
      ctx().font = '14px Segoe UI, Arial, sans-serif'
      ctx().fillText(item.label, x + sw + 8, iy, colW - sw - 18)
    }
    painter.y += boxH + 10
  }
  painter.y += 10
}

export async function downloadRelatorioPdf (input: RelatorioPdfInput): Promise<void> {
  const painter = new ReportCanvas(input.theme)
  const colors = painter.colors
  const generatedAt = new Date().toLocaleString('pt-BR')
  const ctx = () => painter.ctx

  const compact = Boolean(input.compact)
  const headerH = compact ? 108 : 138
  ctx().fillStyle = colors.header2
  ctx().fillRect(0, 0, PAGE_W, headerH)
  const gradient = ctx().createLinearGradient(0, 0, PAGE_W, 0)
  gradient.addColorStop(0, colors.header)
  gradient.addColorStop(1, colors.header2)
  ctx().fillStyle = gradient
  ctx().fillRect(0, 0, PAGE_W, headerH)
  ctx().fillStyle = '#ffffff'
  ctx().font = compact ? '700 28px Segoe UI, Arial, sans-serif' : '700 34px Segoe UI, Arial, sans-serif'
  ctx().fillText(input.title, PAD, compact ? 42 : 52)
  ctx().font = compact ? '600 16px Segoe UI, Arial, sans-serif' : '600 20px Segoe UI, Arial, sans-serif'
  ctx().fillText(input.scope, PAD, compact ? 68 : 86)
  ctx().font = compact ? '14px Segoe UI, Arial, sans-serif' : '16px Segoe UI, Arial, sans-serif'
  ctx().fillStyle = 'rgba(255,255,255,0.86)'
  ctx().fillText(input.source, PAD, compact ? 90 : 116)
  painter.y = compact ? 128 : 168

  const kpiH = compact ? 78 : 124
  painter.ensure(kpiH + 8)
  const kpiCount = Math.max(1, input.kpis.length)
  const kpiW = (CONTENT_W - (kpiCount - 1) * 12) / kpiCount
  input.kpis.forEach((kpi, index) => {
    const x = PAD + index * (kpiW + 12)
    ctx().fillStyle = colors.kpi
    roundRect(ctx(), x, painter.y, kpiW, kpiH, 10)
    ctx().fill()
    ctx().strokeStyle = 'rgba(0,0,0,0.06)'
    ctx().stroke()
    ctx().fillStyle = colors.accent
    ctx().font = compact ? '700 22px Segoe UI, Arial, sans-serif' : '700 28px Segoe UI, Arial, sans-serif'
    ctx().fillText(kpi.value, x + 14, painter.y + (compact ? 32 : 46), kpiW - 28)
    ctx().fillStyle = '#4f6470'
    ctx().font = compact ? '13px Segoe UI, Arial, sans-serif' : '15px Segoe UI, Arial, sans-serif'
    wrapText(ctx(), kpi.label, kpiW - 28).slice(0, compact ? 1 : 2).forEach((line, lineIndex) => {
      ctx().fillText(line, x + 14, painter.y + (compact ? 54 : 72) + lineIndex * 18, kpiW - 28)
    })
    if (kpi.sub && !compact) {
      ctx().fillStyle = colors.header
      ctx().font = '600 15px Segoe UI, Arial, sans-serif'
      ctx().fillText(kpi.sub, x + 14, painter.y + 110, kpiW - 28)
    }
  })
  painter.y += kpiH + (compact ? 14 : 20)

  if (!compact && input.guide && input.guide.items.length) {
    ctx().font = '15px Segoe UI, Arial, sans-serif'
    const itemLines = input.guide.items.map((item, index) => (
      wrapText(ctx(), `${index + 1}. ${item}`, CONTENT_W - 32)
    ))
    const textH = itemLines.reduce((sum, lines) => sum + lines.length * 20 + 8, 0)
    const boxH = 44 + textH
    painter.ensure(boxH + 12)
    ctx().fillStyle = colors.kpi
    roundRect(ctx(), PAD, painter.y, CONTENT_W, boxH, 12)
    ctx().fill()
    ctx().fillStyle = colors.header2
    ctx().font = '700 18px Segoe UI, Arial, sans-serif'
    ctx().fillText(input.guide.title, PAD + 16, painter.y + 26)
    let gy = painter.y + 50
    ctx().fillStyle = '#3d4f59'
    ctx().font = '15px Segoe UI, Arial, sans-serif'
    itemLines.forEach((lines) => {
      lines.forEach((line) => {
        ctx().fillText(line, PAD + 16, gy, CONTENT_W - 32)
        gy += 20
      })
      gy += 8
    })
    painter.y += boxH + 18
  }

  let legendOnMap = false
  if (input.mapDataUrl) {
    try {
      const img = await loadImage(input.mapDataUrl)
      const boxW = CONTENT_W
      const maxH = compact ? 430 : 520
      const imgRatio = img.width / Math.max(1, img.height)
      let drawW = boxW
      let drawH = boxW / imgRatio
      if (drawH > maxH) {
        drawH = maxH
        drawW = maxH * imgRatio
      }
      painter.ensure(drawH + 64)
      ctx().fillStyle = '#1c2b33'
      ctx().font = '700 20px Segoe UI, Arial, sans-serif'
      ctx().fillText('Mapa da seleção atual', PAD, painter.y)
      painter.y += 10
      if (input.mapCaption) {
        ctx().fillStyle = '#5b6b75'
        ctx().font = '15px Segoe UI, Arial, sans-serif'
        ctx().fillText(input.mapCaption, PAD, painter.y + 14)
        painter.y += 22
      }
      painter.y += 6
      const dx = PAD + (boxW - drawW) / 2
      ctx().fillStyle = '#d9e3ea'
      roundRect(ctx(), dx, painter.y, drawW, drawH, 10)
      ctx().fill()
      ctx().save()
      roundRect(ctx(), dx, painter.y, drawW, drawH, 10)
      ctx().clip()
      ctx().drawImage(img, dx, painter.y, drawW, drawH)
      ctx().restore()
      const legendGroups = (input.mapLegend || []).filter((group) => group.items?.length)
      if (legendGroups.length) {
        await paintLegendOnMap(ctx(), colors, legendGroups, dx, painter.y, drawW, drawH)
        legendOnMap = true
      }
      painter.y += drawH + (compact ? 14 : 24)
    } catch (_) {
      painter.ensure(32)
      ctx().fillStyle = '#8aa0ab'
      ctx().font = '16px Segoe UI, Arial, sans-serif'
      ctx().fillText('Mapa da seleção indisponível neste momento.', PAD, painter.y)
      painter.y += 32
    }
  }

  if (!legendOnMap) {
    await paintMapLegend(painter, ctx, colors, input)
  }

  for (const section of input.sections) {
    const bars = (section.bars || []).filter((bar) => bar.label)
    const table = section.table
    painter.ensure(compact ? 36 : 56)
    ctx().fillStyle = colors.header2
    ctx().font = compact ? '700 17px Segoe UI, Arial, sans-serif' : '700 22px Segoe UI, Arial, sans-serif'
    ctx().fillText(section.title, PAD, painter.y, CONTENT_W)
    painter.y += compact ? 14 : 22
    ctx().fillStyle = colors.accent
    ctx().fillRect(PAD, painter.y, compact ? 48 : 72, 3)
    painter.y += compact ? 10 : 18

    if (section.note && !compact) {
      ctx().font = '15px Segoe UI, Arial, sans-serif'
      const noteLines = wrapText(ctx(), section.note, CONTENT_W - 28)
      const noteH = 20 + noteLines.length * 20
      painter.ensure(noteH + 12)
      ctx().fillStyle = '#f4f7f9'
      roundRect(ctx(), PAD, painter.y, CONTENT_W, noteH, 8)
      ctx().fill()
      ctx().fillStyle = '#3d4f59'
      noteLines.forEach((line, lineIndex) => {
        ctx().fillText(line, PAD + 14, painter.y + 22 + lineIndex * 20, CONTENT_W - 28)
      })
      painter.y += noteH + 16
    } else if (section.note && compact) {
      ctx().font = '12px Segoe UI, Arial, sans-serif'
      ctx().fillStyle = '#5b6b75'
      const noteLines = wrapText(ctx(), section.note, CONTENT_W).slice(0, 1)
      ctx().fillText(noteLines[0], PAD, painter.y + 12, CONTENT_W)
      painter.y += 18
    }

    for (const bar of bars) {
      painter.ensure(compact ? 36 : 52)
      ctx().fillStyle = '#1c2b33'
      ctx().font = compact ? '600 13px Segoe UI, Arial, sans-serif' : '600 16px Segoe UI, Arial, sans-serif'
      ctx().fillText(bar.label, PAD, painter.y)
      ctx().textAlign = 'right'
      ctx().fillStyle = '#4f6470'
      ctx().font = compact ? '12px Segoe UI, Arial, sans-serif' : '15px Segoe UI, Arial, sans-serif'
      ctx().fillText(`${bar.value}  ·  ${bar.pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, PAGE_W - PAD, painter.y)
      ctx().textAlign = 'left'
      painter.y += compact ? 6 : 10
      ctx().fillStyle = '#eef4f8'
      roundRect(ctx(), PAD, painter.y, CONTENT_W, compact ? 8 : 12, 4)
      ctx().fill()
      const width = Math.max(2, Math.min(CONTENT_W, CONTENT_W * (Math.max(0, bar.pct) / 100)))
      ctx().fillStyle = bar.color || colors.accent
      roundRect(ctx(), PAD, painter.y, width, compact ? 8 : 12, 4)
      ctx().fill()
      painter.y += compact ? 18 : 30
    }

    if (table && table.headers.length) {
      const weights = table.colWeights && table.colWeights.length === table.headers.length
        ? table.colWeights
        : table.headers.map((_, index) => index === 0 ? 1.7 : 1)
      const weightSum = weights.reduce((sum, w) => sum + w, 0)
      const colW = weights.map((w) => CONTENT_W * w / weightSum)
      const colX = colW.reduce<number[]>((xs, _w, i) => {
        xs.push(i === 0 ? PAD : xs[i - 1] + colW[i - 1])
        return xs
      }, [])
      const headH = compact ? 26 : 36
      painter.ensure(headH + 4)
      ctx().fillStyle = colors.header
      roundRect(ctx(), PAD, painter.y, CONTENT_W, headH, 6)
      ctx().fill()
      ctx().fillStyle = '#ffffff'
      ctx().font = compact ? '700 12px Segoe UI, Arial, sans-serif' : '700 14px Segoe UI, Arial, sans-serif'
      table.headers.forEach((header, index) => {
        ctx().fillText(header, colX[index] + 8, painter.y + (compact ? 17 : 24), colW[index] - 12)
      })
      painter.y += headH
      table.rows.forEach((row, rowIndex) => {
        ctx().font = compact ? '12px Segoe UI, Arial, sans-serif' : '15px Segoe UI, Arial, sans-serif'
        const lineH = compact ? 14 : 19
        const cellLines = row.map((cell, index) => wrapText(ctx(), String(cell ?? ''), colW[index] - 12).slice(0, compact ? 1 : 4))
        const lineCount = Math.max(1, ...cellLines.map((lines) => lines.length))
        const rowH = compact ? 22 : Math.max(32, 14 + lineCount * lineH)
        painter.ensure(rowH)
        ctx().fillStyle = rowIndex % 2 ? '#f7fafc' : '#ffffff'
        ctx().fillRect(PAD, painter.y, CONTENT_W, rowH)
        ctx().fillStyle = '#1c2b33'
        cellLines.forEach((lines, index) => {
          lines.forEach((line, lineIndex) => {
            ctx().fillText(line, colX[index] + 8, painter.y + (compact ? 15 : 21) + lineIndex * lineH, colW[index] - 12)
          })
        })
        painter.y += rowH
      })
      painter.y += compact ? 10 : 18
    } else {
      painter.y += compact ? 6 : 10
    }
  }

  painter.stampFooters(generatedAt)
  const jpegs = painter.pages.map((page) => ({
    bytes: canvasToJpeg(page),
    width: page.width,
    height: page.height
  }))
  downloadBlob(jpegPagesToPdf(jpegs), input.fileName.endsWith('.pdf') ? input.fileName : `${input.fileName}.pdf`)
}

function roundRect (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}
