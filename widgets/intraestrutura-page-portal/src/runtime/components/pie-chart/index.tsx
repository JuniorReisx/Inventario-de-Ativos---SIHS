import { React } from 'jimu-core'
import { formatPopulation } from '../../lib/municipios'
import { groupSmallChartSlices, type ChartSlice } from '../../lib/charts'
import './style.css'

const { useMemo, useState } = React

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

function formatPercent (value: number): string {
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

const PieChart = ({ chartId, items, preserveOrder = false }: PieChartProps) => {
  const colors = PALETTES[chartId] || DEFAULT_PALETTE
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [openOutros, setOpenOutros] = useState(false)

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

  if (!rows.length) {
    return <p className="infra-bars__empty">Sem dados</p>
  }

  const size = 188
  const cx = size / 2
  const cy = size / 2
  const rOuter = 84
  const rInner = 52
  const hoverOuter = 88

  const centerTitle = active?.label || 'Total'
  const centerValue = active ? active.total : total
  const centerPct = active ? formatPercent(active.percent) : null

  return (
    <div className="infra-bars infra-bars--pie">
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
                  onClick={() => {
                    if (slice.parts?.length) setOpenOutros((value) => !value)
                  }}
                  tabIndex={0}
                >
                  <title>
                    {`${slice.label}: ${formatPopulation(slice.total)} ${unitFor(chartId, slice.total)} (${formatPercent(slice.percent)})`}
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
                onClick={() => {
                  setActiveLabel(row.label)
                  if (row.parts?.length) setOpenOutros((value) => !value)
                }}
              >
                <i style={{ background: row.color }} />
                <span>
                  {row.label}
                  {row.detail ? <small>{row.detail}</small> : null}
                </span>
                <b>{formatPopulation(row.total)}</b>
                <em>{formatPercent(row.percent)}</em>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {outros && openOutros
        ? (
          <div className="infra-pie__outros">
            <p>Composição de Outros</p>
            <ul>
              {outros.parts!.map((part) => {
                const percent = total > 0 ? (part.total / total) * 100 : 0
                return (
                  <li key={part.label}>
                    <span>
                      {part.label}
                      {part.detail ? <small>{part.detail}</small> : null}
                    </span>
                    <b>{formatPopulation(part.total)}</b>
                    <em>{formatPercent(percent)}</em>
                  </li>
                )
              })}
            </ul>
          </div>
          )
        : outros
          ? (
            <button
              type="button"
              className="infra-pie__outros-toggle"
              onClick={() => setOpenOutros(true)}
            >
              Ver {outros.parts!.length} categorias em Outros
            </button>
            )
          : null}
    </div>
  )
}

export default PieChart
