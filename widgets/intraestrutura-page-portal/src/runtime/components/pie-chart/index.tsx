import { React, ReactDOM } from 'jimu-core'
import { formatPopulation } from '../../lib/municipios'
import { groupSmallChartSlices, type ChartSlice } from '../../lib/charts'
import './style.css'

const { useEffect, useMemo, useRef, useState } = React

const PALETTES: Record<string, string[]> = {
  reservatorios: [
    '#002231', '#0a5c66', '#128a9c', '#1aa8c8', '#2fc4ff', '#6dcae0', '#3d6b8a', '#7d5a3c'
  ],
  pocos: [
    '#14352c', '#1c4f40', '#2d8268', '#3a9a78', '#5bb08c', '#84c5a6', '#0a5c66', '#8aa0ab'
  ],
  sistemas: [
    '#001a2e', '#02364d', '#0a7fa3', '#1aa8c8', '#2fc4ff', '#6dd4ff', '#055a78', '#5d7380'
  ]
}

const DEFAULT_PALETTE = ['#002231', '#0a5c66', '#1aa8c8', '#2fc4ff', '#5d7380', '#8aa0ab']

const UNITS: Record<string, [string, string]> = {
  reservatorios: ['reservatório', 'reservatórios'],
  pocos: ['poço', 'poços'],
  sistemas: ['sistema geolocalizado', 'sistemas geolocalizados']
}

const CHART_TITLES: Record<string, string> = {
  reservatorios: 'Reservatórios',
  pocos: 'Poços',
  sistemas: 'Sistemas'
}

const POPOVER_WIDTH = 320
const POPOVER_GAP = 8

type PieChartProps = {
  chartId: string
  items: ChartSlice[]
  layout?: 'pie' | 'cards' | 'bars'
  preserveOrder?: boolean
}

type SliceRow = ChartSlice & {
  color: string
  percent: number
  start: number
  end: number
}

type PopoverPos = {
  top: number
  left: number
  placement: 'bottom' | 'top'
}

function displayLabel (label: string): string {
  const text = String(label || '').trim()
  if (!text) return 'Não informado'
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!normalized || /^(nan|null|undefined|ni)$/.test(normalized) || normalized.includes('nao informad') || normalized === 'sem informacao' || normalized === 'sem informacoes' || normalized === 'sem dado' || normalized === 'sem dados') {
    return 'Não informado'
  }
  const letters = [...text].filter((ch) => ch.toLocaleLowerCase('pt-BR') !== ch.toLocaleUpperCase('pt-BR'))
  const upper = letters.filter((ch) => ch === ch.toLocaleUpperCase('pt-BR')).length
  if (letters.length >= 2 && upper / letters.length >= 0.75) {
    const lower = text.toLocaleLowerCase('pt-BR')
    return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1)
  }
  return text
}

function formatPercent (value: number): string {
  if (!Number.isFinite(value)) return 'Sem dado'
  const digits = value > 0 && value < 1 ? 2 : 1
  return `${value.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}%`
}

function unitFor (chartId: string, count: number): string {
  const pair = UNITS[chartId] || ['registro', 'registros']
  return count === 1 ? pair[0] : pair[1]
}

function donutPath (cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const large = (a1 - a0) > Math.PI ? 1 : 0
  const x0o = cx + rOuter * Math.cos(a0)
  const y0o = cy + rOuter * Math.sin(a0)
  const x1o = cx + rOuter * Math.cos(a1)
  const y1o = cy + rOuter * Math.sin(a1)
  const x0i = cx + rInner * Math.cos(a0)
  const y0i = cy + rInner * Math.sin(a0)
  const x1i = cx + rInner * Math.cos(a1)
  const y1i = cy + rInner * Math.sin(a1)
  return `M ${x0o} ${y0o} A ${rOuter} ${rOuter} 0 ${large} 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${rInner} ${rInner} 0 ${large} 0 ${x0i} ${y0i} Z`
}

function placePopover (anchor: DOMRect, estimatedHeight = 280): PopoverPos {
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  let left = anchor.left
  if (left + POPOVER_WIDTH > viewportW - 12) {
    left = Math.max(12, anchor.right - POPOVER_WIDTH)
  }
  left = Math.max(12, left)

  const below = anchor.bottom + POPOVER_GAP
  const above = anchor.top - POPOVER_GAP - estimatedHeight
  const fitsBelow = below + estimatedHeight <= viewportH - 12
  if (fitsBelow || above < 12) {
    return { top: below, left, placement: 'bottom' }
  }
  return { top: Math.max(12, above), left, placement: 'top' }
}

const PieChart = ({ chartId, items, preserveOrder = false }: PieChartProps) => {
  const colors = PALETTES[chartId] || DEFAULT_PALETTE
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<Element | null>(null)
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [openOutros, setOpenOutros] = useState(false)
  const [popoverPos, setPopoverPos] = useState<PopoverPos | null>(null)

  const grouped = useMemo(
    () => preserveOrder
      ? (items || []).filter((item) => item.total > 0)
      : groupSmallChartSlices(items),
    [items, preserveOrder]
  )
  const total = grouped.reduce((sum, item) => sum + item.total, 0)

  const rows = useMemo(() => {
    const painted = grouped.map((item, index) => ({
      ...item,
      color: item.color || colors[index % colors.length],
      percent: total > 0 ? (item.total / total) * 100 : 0
    }))
    const gap = painted.length > 1 ? 0.035 : 0
    let angle = -Math.PI / 2
    return painted.map((row): SliceRow => {
      const sweep = Math.max(0, Math.min((row.percent / 100) * 2 * Math.PI, 2 * Math.PI - 1e-6) - gap)
      const start = angle + gap / 2
      const end = start + sweep
      angle += sweep + gap
      return { ...row, start, end }
    })
  }, [grouped, colors, total])

  const active = rows.find((row) => row.label === activeLabel) || null
  const outros = rows.find((row) => row.label === 'Outros' && row.parts?.length) || null

  const syncPopover = () => {
    const anchor = anchorRef.current
    if (!anchor) return
    const height = popoverRef.current?.offsetHeight || 280
    setPopoverPos(placePopover(anchor.getBoundingClientRect(), height))
  }

  const closeOutrosPopup = () => {
    anchorRef.current = null
    setOpenOutros(false)
    setPopoverPos(null)
  }

  const openOutrosPopup = (event: React.SyntheticEvent) => {
    event.stopPropagation()
    const target = event.currentTarget as Element
    if (openOutros && anchorRef.current === target) {
      closeOutrosPopup()
      return
    }
    anchorRef.current = target
    setPopoverPos(placePopover(target.getBoundingClientRect()))
    setOpenOutros(true)
  }

  useEffect(() => {
    setOpenOutros(false)
    setPopoverPos(null)
    anchorRef.current = null
  }, [items, chartId])

  useEffect(() => {
    if (!openOutros) return
    syncPopover()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeOutrosPopup()
    }
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      closeOutrosPopup()
    }
    const onReposition = () => syncPopover()
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onDocClick)
    window.addEventListener('resize', onReposition)
    document.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onDocClick)
      window.removeEventListener('resize', onReposition)
      document.removeEventListener('scroll', onReposition, true)
    }
  }, [openOutros])

  if (!rows.length) {
    return <p className="infra-bars__empty">Sem dados</p>
  }

  const size = 188
  const cx = size / 2
  const cy = size / 2
  const rOuter = 84
  const rInner = 52
  const hoverOuter = 88

  const centerTitle = active ? displayLabel(active.label) : 'Total'
  const centerValue = active ? active.total : total
  const centerPct = active ? formatPercent(active.percent) : null

  const outrosPopup = outros && openOutros && popoverPos
    ? ReactDOM.createPortal(
      (
        <div
          ref={popoverRef}
          className={`infra-pie__outros-popover is-${popoverPos.placement}`}
          role="dialog"
          aria-labelledby={`infra-outros-title-${chartId}`}
          style={{ top: popoverPos.top, left: popoverPos.left }}
        >
          <header className="infra-pie__outros-head">
            <div>
              <p>{CHART_TITLES[chartId] || 'Indicador'}</p>
              <h4 id={`infra-outros-title-${chartId}`}>Composição de Outros</h4>
            </div>
            <button
              type="button"
              className="infra-pie__outros-close"
              aria-label="Fechar"
              onClick={closeOutrosPopup}
            >
              ×
            </button>
          </header>
          <p className="infra-pie__outros-meta">
            {formatPopulation(outros.total)} {unitFor(chartId, outros.total)} agrupados em {outros.parts!.length} categorias
          </p>
          <ul>
            {outros.parts!.map((part) => {
              const percent = total > 0 ? (part.total / total) * 100 : 0
              return (
                <li key={part.label}>
                  <span>
                    {displayLabel(part.label)}
                    {part.detail ? <small>{part.detail}</small> : null}
                  </span>
                  <b>{formatPopulation(part.total)}</b>
                  <em>{formatPercent(percent)}</em>
                </li>
              )
            })}
          </ul>
        </div>
      ),
      document.body
    )
    : null

  return (
    <div className="infra-bars infra-bars--pie" ref={rootRef}>
      <div className="infra-pie">
        <div
          className="infra-pie__viz"
          onMouseLeave={() => setActiveLabel(null)}
        >
          <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Gráfico de distribuição">
            <circle cx={cx} cy={cy} r={rInner - 2} fill="#f4f8fb" />
            {rows.map((slice) => (
                <path
                  key={slice.label}
                  d={donutPath(
                    cx,
                    cy,
                    activeLabel === slice.label ? hoverOuter : rOuter,
                    rInner,
                    slice.start,
                    slice.end || slice.start + Math.PI * 2 - 1e-4
                  )}
                  fill={slice.color}
                  className={activeLabel && activeLabel !== slice.label ? 'is-dim' : activeLabel === slice.label ? 'is-hot' : ''}
                  onMouseEnter={() => setActiveLabel(slice.label)}
                  onFocus={() => setActiveLabel(slice.label)}
                  onClick={(event) => {
                    if (slice.parts?.length) openOutrosPopup(event)
                  }}
                  tabIndex={0}
                >
                  <title>
                    {`${displayLabel(slice.label)}: ${formatPopulation(slice.total)} ${unitFor(chartId, slice.total)} (${formatPercent(slice.percent)})`}
                  </title>
                </path>
              ))}
          </svg>
          <div className="infra-pie__center" aria-live="polite">
            <span>{centerTitle}</span>
            <strong>{formatPopulation(centerValue)}</strong>
            <em>{centerPct || unitFor(chartId, centerValue)}</em>
          </div>
        </div>

        <ul className="infra-pie__legend">
          {rows.map((row) => (
            <li
              key={row.label}
              className={activeLabel === row.label ? 'is-active' : activeLabel ? 'is-dim' : ''}
              onMouseEnter={() => setActiveLabel(row.label)}
              onMouseLeave={() => setActiveLabel(null)}
            >
              <button
                type="button"
                onClick={(event) => {
                  setActiveLabel(row.label)
                  if (row.parts?.length) openOutrosPopup(event)
                }}
              >
                <i style={{ background: row.color }} />
                <span>
                  {displayLabel(row.label)}
                  {row.detail ? <small>{row.detail}</small> : null}
                </span>
                <b>{formatPopulation(row.total)}</b>
                <em>{formatPercent(row.percent)}</em>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {outros
        ? (
          <button
            type="button"
            className="infra-pie__outros-toggle"
            onClick={openOutrosPopup}
          >
            Ver {outros.parts!.length} categorias em Outros
          </button>
          )
        : null}
      {outrosPopup}
    </div>
  )
}

export default PieChart
