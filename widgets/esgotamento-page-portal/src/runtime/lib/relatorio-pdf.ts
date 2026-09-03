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
  mapCaption?: string
  mapDataUrl?: string | null
  sections: RelatorioSection[]
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
      quality: 88
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

export async function downloadRelatorioPdf (input: RelatorioPdfInput): Promise<void> {
  const painter = new ReportCanvas(input.theme)
  const colors = painter.colors
  const generatedAt = new Date().toLocaleString('pt-BR')
  const ctx = () => painter.ctx

  ctx().fillStyle = colors.header2
  ctx().fillRect(0, 0, PAGE_W, 138)
  const gradient = ctx().createLinearGradient(0, 0, PAGE_W, 0)
  gradient.addColorStop(0, colors.header)
  gradient.addColorStop(1, colors.header2)
  ctx().fillStyle = gradient
  ctx().fillRect(0, 0, PAGE_W, 138)
  ctx().fillStyle = '#ffffff'
  ctx().font = '700 34px Segoe UI, Arial, sans-serif'
  ctx().fillText(input.title, PAD, 52)
  ctx().font = '600 20px Segoe UI, Arial, sans-serif'
  ctx().fillText(input.scope, PAD, 86)
  ctx().font = '16px Segoe UI, Arial, sans-serif'
  ctx().fillStyle = 'rgba(255,255,255,0.86)'
  ctx().fillText(input.source, PAD, 116)
  painter.y = 168

  painter.ensure(132)
  const kpiCount = Math.max(1, input.kpis.length)
  const kpiW = (CONTENT_W - (kpiCount - 1) * 12) / kpiCount
  input.kpis.forEach((kpi, index) => {
    const x = PAD + index * (kpiW + 12)
    ctx().fillStyle = colors.kpi
    roundRect(ctx(), x, painter.y, kpiW, 124, 12)
    ctx().fill()
    ctx().strokeStyle = 'rgba(0,0,0,0.06)'
    ctx().stroke()
    ctx().fillStyle = colors.accent
    ctx().font = '700 28px Segoe UI, Arial, sans-serif'
    ctx().fillText(kpi.value, x + 14, painter.y + 46, kpiW - 28)
    ctx().fillStyle = '#4f6470'
    ctx().font = '15px Segoe UI, Arial, sans-serif'
    wrapText(ctx(), kpi.label, kpiW - 28).slice(0, 2).forEach((line, lineIndex) => {
      ctx().fillText(line, x + 14, painter.y + 72 + lineIndex * 19, kpiW - 28)
    })
    if (kpi.sub) {
      ctx().fillStyle = colors.header
      ctx().font = '600 15px Segoe UI, Arial, sans-serif'
      ctx().fillText(kpi.sub, x + 14, painter.y + 110, kpiW - 28)
    }
  })
  painter.y += 144

  if (input.guide && input.guide.items.length) {
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

  if (input.mapDataUrl) {
    try {
      const img = await loadImage(input.mapDataUrl)
      const boxW = CONTENT_W
      const maxH = 520
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
      ctx().drawImage(img, dx, painter.y, drawW, drawH)
      painter.y += drawH + 24
    } catch (_) {
      painter.ensure(32)
      ctx().fillStyle = '#8aa0ab'
      ctx().font = '16px Segoe UI, Arial, sans-serif'
      ctx().fillText('Mapa da seleção indisponível neste momento.', PAD, painter.y)
      painter.y += 32
    }
  }

  for (const section of input.sections) {
    const bars = (section.bars || []).filter((bar) => bar.label)
    const table = section.table
    painter.ensure(56)
    ctx().fillStyle = colors.header2
    ctx().font = '700 22px Segoe UI, Arial, sans-serif'
    ctx().fillText(section.title, PAD, painter.y, CONTENT_W)
    painter.y += 22
    ctx().fillStyle = colors.accent
    ctx().fillRect(PAD, painter.y, 72, 3)
    painter.y += 18

    if (section.note) {
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
    }

    for (const bar of bars) {
      painter.ensure(52)
      ctx().fillStyle = '#1c2b33'
      ctx().font = '600 16px Segoe UI, Arial, sans-serif'
      ctx().fillText(bar.label, PAD, painter.y)
      ctx().textAlign = 'right'
      ctx().fillStyle = '#4f6470'
      ctx().font = '15px Segoe UI, Arial, sans-serif'
      ctx().fillText(`${bar.value}  ·  ${bar.pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, PAGE_W - PAD, painter.y)
      ctx().textAlign = 'left'
      painter.y += 10
      ctx().fillStyle = '#eef4f8'
      roundRect(ctx(), PAD, painter.y, CONTENT_W, 12, 6)
      ctx().fill()
      const width = Math.max(2, Math.min(CONTENT_W, CONTENT_W * (Math.max(0, bar.pct) / 100)))
      ctx().fillStyle = bar.color || colors.accent
      roundRect(ctx(), PAD, painter.y, width, 12, 6)
      ctx().fill()
      painter.y += 30
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
      painter.ensure(38)
      ctx().fillStyle = colors.header
      roundRect(ctx(), PAD, painter.y, CONTENT_W, 36, 6)
      ctx().fill()
      ctx().fillStyle = '#ffffff'
      ctx().font = '700 14px Segoe UI, Arial, sans-serif'
      table.headers.forEach((header, index) => {
        ctx().fillText(header, colX[index] + 10, painter.y + 24, colW[index] - 16)
      })
      painter.y += 36
      table.rows.forEach((row, rowIndex) => {
        ctx().font = '15px Segoe UI, Arial, sans-serif'
        const cellLines = row.map((cell, index) => wrapText(ctx(), String(cell ?? ''), colW[index] - 16))
        const lineCount = Math.max(1, ...cellLines.map((lines) => lines.length))
        const rowH = Math.max(32, 14 + lineCount * 19)
        painter.ensure(rowH)
        ctx().fillStyle = rowIndex % 2 ? '#f7fafc' : '#ffffff'
        ctx().fillRect(PAD, painter.y, CONTENT_W, rowH)
        ctx().fillStyle = '#1c2b33'
        cellLines.forEach((lines, index) => {
          lines.forEach((line, lineIndex) => {
            ctx().fillText(line, colX[index] + 10, painter.y + 21 + lineIndex * 19, colW[index] - 16)
          })
        })
        painter.y += rowH
      })
      painter.y += 18
    } else {
      painter.y += 10
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
