import { React, type AllWidgetProps } from 'jimu-core'
import type { IMConfig } from '../config'
import {
  HEADER_INDICATORS,
  STAT_CARDS,
  POPULATION_CHART,
  DEFAULT_PORTAL_URL,
  DEFAULT_WEB_MAP_ID,
  DEFAULT_OAUTH_APP_ID,
  DPA_MUNICIPIO_LAYER_TITLE,
  type IndicatorDefinition
} from './lib/config'
import {
  setupAuthentication,
  createWebMap,
  createMapView,
  resizeMapView,
  zoomToWhere,
  zoomToGeometry,
  zoomToLayerExtent,
  BAHIA_HOME_EXPAND,
  highlightWhere,
  clearHighlight,
  unionGeometries,
  enableMunicipioHighlight,
  disableNativePopup
} from './lib/map'
import { findLayer, findMunicipioLayer, findSemiaridoLayer, findTerritorioLayer, isMunicipioLayerTitle, resolveTerritorioQueryableLayer, restoreLayerDefinition, setLayerDefinition, setTerritorialLayerFocus } from './lib/layers'
import {
  countFeatures,
  queryStatistics,
  queryManyStatistics,
  queryDensity,
  queryFieldValues,
  queryTypeBreakdown,
  queryRestCount,
  searchFieldValues,
  resolveSemiaridoMunicipioCount
} from './lib/statistics'
import {
  loadSemiaridoRecord,
  pickSemiaridoById,
  valueFromSemiaridoRecord
} from './lib/semiarido-record'
import {
  FILTER_ALL,
  combineWhere,
  createTerritoryFilter,
  createMunicipalityFilter,
  createSemiaridoFilter,
  getStatsPanelTitle,
  SEMIARIDO_MUNICIPIOS_WHERE,
  pickMunicipioNameField,
  pickMunicipioPopEst2025Field,
  pickTerritorioNameField,
  pickTerritorioCodeField,
  type DashboardFilter
} from './lib/filter'
import { formatValue, getKpiIconHtml } from './lib/format'
import {
  loadSaneamentoSummaries,
  loadingSummaries,
  listEmbasaMunicipios,
  SANEAMENTO_NOTES,
  SANEAMENTO_SOURCE,
  type SaneamentoSummary
} from './lib/saneamento'
import HeroPortal from './components/hero-portal'
import CardsTelaInicial from './components/cards-telaincial'
import PortalLoader from './components/portal-loader'
import KaioChat from './components/kaio-chat'
import './style.css'

const { useCallback, useEffect, useMemo, useRef, useState } = React

let semiaridoGeometryCache: { geometry: any, extraNames: string[] } | null = null

type CardStatus = 'loading' | 'ok' | 'error' | 'empty'

interface CardValueState {
  value: number | string | null
  meta?: string | null
  status: CardStatus
  message?: string
  decimals?: number
  sourceLabel?: string | null
}

interface ChartSeriesItem {
  id: string
  label: string
  color: string
  value: number | null
}

interface PopupState {
  open: boolean
  anchorId: string | null
  title: string
  mode?: 'list' | 'search' | 'types' | 'filterAction'
  loading: boolean
  names?: string[]
  items?: Array<{ label: string, total: number }>
  secondaryItems?: Array<{ label: string, total: number }>
  secondaryTitle?: string
  hint?: string
  description?: string
  actionLabel?: string
  source?: string
  error?: string
  searchTerm?: string
  searchResults?: string[]
  searching?: boolean
  selectable?: boolean
  above?: boolean
  left?: number
  top?: number
  arrowLeft?: number
}

interface OverlayState {
  visible: boolean
  title: string
  message: string
}

interface IndicatorResult {
  value?: number | null
  meta?: string | null
  unavailable?: boolean
  message?: string
  sourceLabel?: string
}

type ResolveResult = number | null | IndicatorResult

interface PopupContext {
  definition: IndicatorDefinition
  popupConfig: NonNullable<IndicatorDefinition['popup']>
}

function TypeBreakdownList (props: { items: Array<{ label: string, total: number }> }) {
  const max = Math.max(...props.items.map((item) => item.total || 0), 1)
  return (
    <ul className="kpi-popover__types">
      {props.items.map((item) => {
        const pct = Math.max(6, Math.round(((item.total || 0) / max) * 100))
        return (
          <li key={item.label}>
            <div className="type-row">
              <span className="type-label">{item.label}</span>
              <strong className="type-total">{formatValue(item.total)}</strong>
            </div>
            <div className="type-bar">
              <i style={{ width: `${pct}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function buildInitialCardValues (): Record<string, CardValueState> {
  const values: Record<string, CardValueState> = {}
  for (const item of [...HEADER_INDICATORS, ...STAT_CARDS]) {
    values[item.id] = {
      value: null,
      status: 'loading',
      decimals: item.decimals
    }
  }
  return values
}

function normalize (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function getScopeWhere (definition: IndicatorDefinition, filter: DashboardFilter): string {
  if (!filter || filter.type === 'all') return '1=1'

  if (isMunicipioLayerTitle(definition.layerTitle)) {
    return filter.munWhere || '1=1'
  }
  const title = normalize(definition.layerTitle)
  if (title.includes('setores')) {
    return filter.setoresWhere || '1=1'
  }

  return '1=1'
}

function isMunicipalStatsLayer (layerTitle: string): boolean {
  return isMunicipioLayerTitle(layerTitle)
}

function resolveMunicipalLayer (webMap: any, _filter?: DashboardFilter) {
  return findMunicipioLayer(webMap)
}

function municipalScopeWhere (_layer: any, definition: IndicatorDefinition, filter: DashboardFilter): string {
  return getScopeWhere(definition, filter)
}

function geometryForLayer (layerTitle: string, filter: DashboardFilter): any {
  if (!filter?.geometry) return null
  if (filter.skipMunicipalGeometry && isMunicipalStatsLayer(layerTitle)) return null
  return filter.geometry
}

function buildFriendlyError (error: unknown): string {
  const message = (error as any)?.message || String(error)

  if (/Failed to fetch|NetworkError|CORS|cross-origin/i.test(message)) {
    return `${message} — Verifique a conexão com o portal e CORS.`
  }

  return message
}

async function resolveDualCount (
  layer: any,
  definition: IndicatorDefinition,
  where: string
): Promise<IndicatorResult> {
  const dual = definition.dualCount
  if (!dual) return { value: null }

  const geolocalized = await countFeatures(layer, where)

  const extraCounts = await Promise.all(
    (dual.additionalCountUrls || []).map((url) => queryRestCount(url, '1=1'))
  )
  const extraTotal = extraCounts.reduce((sum, n) => sum + (Number(n) || 0), 0)
  const total = geolocalized + extraTotal

  const format = (n: number) => new Intl.NumberFormat('pt-BR').format(n)
  const meta = String(dual.metaTemplate || '{geolocalized} geolocalizados')
    .replaceAll('{geolocalized}', format(geolocalized))
    .replaceAll('{total}', format(total))
    .replaceAll('{extra}', format(extraTotal))

  const primary = dual.showPrimary === 'geolocalized' ? geolocalized : total

  return { value: primary, meta }
}

async function resolveIndicatorValue (
  webMap: any,
  definition: IndicatorDefinition,
  filter: DashboardFilter = FILTER_ALL
): Promise<ResolveResult> {
  if (definition.id === 'semiarido' || (definition.id === 'municipios' && filter.type === 'semiarido')) {
    const semiLayer = findSemiaridoLayer(webMap)
    const munLayer = findMunicipioLayer(webMap)
    if (!semiLayer && !munLayer) {
      throw new Error('Camada Região Semiárida_BA não encontrada')
    }
    try {
      const record = await loadSemiaridoRecord(webMap)
      const fromLayer = record ? pickSemiaridoById(record, 'total_mun') : null
      if (fromLayer != null && fromLayer > 1) return fromLayer
    } catch (_) {}
    return resolveSemiaridoMunicipioCount({
      semiLayer,
      munLayer,
      where: '1=1'
    })
  }

  if (filter.type === 'semiarido') {
    try {
      const record = await loadSemiaridoRecord(webMap)
      if (record) {
        const value = valueFromSemiaridoRecord(definition, record)
        if (value != null) {
          return {
            value,
            sourceLabel: definition.id === 'pop_total' ? 'Estimativa IBGE 2026' : 'Região Semiárida_BA'
          }
        }
      }

      if (definition.id === 'pop_total') {
        const semiLayer = findSemiaridoLayer(webMap)
        if (semiLayer && typeof semiLayer.queryFeatures === 'function') {
          try { await semiLayer.load?.() } catch (_) {}
          const field = pickMunicipioPopEst2025Field(semiLayer, 'pop_est_2026')
          const stats = await queryStatistics(semiLayer, {
            where: '1=1',
            statisticType: 'sum',
            onStatisticField: field,
            outStatisticFieldName: 'value'
          })
          const summed = Number(stats?.value)
          if (Number.isFinite(summed) && summed > 0) {
            return {
              value: summed,
              sourceLabel: 'Estimativa IBGE 2026'
            }
          }
        }
      }
    } catch (error) {
      console.warn('[sihs-dash] recorte semiárido, usando DPA:', error)
    }
  }

  // Estado: Limite Bahia / população estimada 2026 (último campo).
  // Município, TI ou semiárido: camada municipal / população estimada 2026.
  if (filter.type !== 'all' && definition.filteredScope) {
    const scoped = definition.filteredScope
    const layer = (
      isMunicipalStatsLayer(scoped.layerTitle)
        ? resolveMunicipalLayer(webMap, filter)
        : null
    ) || findLayer(webMap, { layerTitle: scoped.layerTitle })
    if (!layer || typeof layer.queryFeatures !== 'function') {
      throw new Error(`Camada não encontrada: ${scoped.layerTitle}`)
    }

    try { await layer.load?.() } catch (_) {}

    const scopeWhere = municipalScopeWhere(
      layer,
      { ...definition, layerTitle: scoped.layerTitle },
      filter
    )
    const where = combineWhere(definition.where || '1=1', scopeWhere)
    const geometry = geometryForLayer(scoped.layerTitle, filter)

    if (scoped.statisticType === 'density') {
      if (!scoped.numeratorField || !scoped.denominatorField) {
        return {
          unavailable: true,
          message: 'Dado indisponível para este filtro'
        }
      }

      const value = await queryDensity(layer, {
        where,
        geometry,
        numeratorField: scoped.numeratorField,
        denominatorField: scoped.denominatorField
      })

      if (value == null || !Number.isFinite(value)) {
        return {
          unavailable: true,
          message: 'Dado indisponível para este filtro'
        }
      }

      return {
        value,
        sourceLabel: scoped.sourceLabel || 'Censo IBGE 2022'
      }
    }

    const stats = await queryStatistics(layer, {
      where,
      geometry,
      statisticType: scoped.statisticType || 'sum',
      onStatisticField: definition.id === 'pop_total'
                ? pickMunicipioPopEst2025Field(layer, scoped.onStatisticField)
        : scoped.onStatisticField,
      outStatisticFieldName: 'value'
    })

    const value = stats?.value
    if (value == null || value === '' || Number.isNaN(Number(value))) {
      return {
        unavailable: true,
        message: 'Dado indisponível para este filtro'
      }
    }

    return {
      value: Number(value),
      sourceLabel: scoped.sourceLabel || 'Censo IBGE 2022'
    }
  }

  const layer = (
    definition.id === 'territorios'
      ? await resolveTerritorioQueryableLayer(webMap)
      : null
  ) || (
    isMunicipalStatsLayer(definition.layerTitle)
      ? resolveMunicipalLayer(webMap, filter)
      : null
  ) || findLayer(webMap, {
    layerTitle: definition.layerTitle,
    layerId: definition.layerId
  })

  if (!layer) {
    throw new Error(`Camada não encontrada: ${definition.layerTitle || definition.layerId}`)
  }

  if (typeof layer.queryFeatures !== 'function') {
    throw new Error(`Camada não consultável: ${layer.title || layer.id}`)
  }

  const scopeWhere = municipalScopeWhere(layer, definition, filter)
  const where = combineWhere(definition.where || '1=1', scopeWhere)
  const geometry = geometryForLayer(definition.layerTitle, filter)
  const statisticType = definition.statisticType || 'count'

  if (definition.dualCount) {
    return resolveDualCount(layer, definition, definition.where || '1=1')
  }

  if (definition.stateOnly && filter.type !== 'all') {
    return {
      unavailable: true,
      message: 'Estimativa disponível apenas para o Estado'
    }
  }

  if (statisticType === 'count') {
    return countFeatures(layer, where, geometry)
  }

  if (statisticType === 'density') {
    const value = await queryDensity(layer, {
      where,
      geometry,
      numeratorField: definition.numeratorField,
      denominatorField: definition.denominatorField
    })

    if (value == null || !Number.isFinite(value)) {
      return {
        unavailable: true,
        message: 'Dado indisponível para este filtro'
      }
    }

    return value
  }

  const stats = await queryStatistics(layer, {
    where,
    geometry,
    statisticType,
    onStatisticField: definition.id === 'pop_total'
      ? pickMunicipioPopEst2025Field(layer, definition.onStatisticField)
      : definition.onStatisticField,
    outStatisticFieldName: 'value'
  })

  const value = stats?.value
  if (value == null || value === '' || Number.isNaN(Number(value))) {
    return {
      unavailable: true,
      message: 'Dado indisponível para este filtro'
    }
  }

  return Number(value)
}

async function loadPopulationChartSeries (
  webMap: any,
  filter: DashboardFilter = FILTER_ALL
): Promise<{
  title: string
  series: ChartSeriesItem[]
  emptyMessage: string | null
}> {
  const config = POPULATION_CHART
  const chartTitle =
    filter.type === 'all'
      ? config.title
      : `${config.title} — ${filter.label}`

  const empty = (message: string) => ({
    title: chartTitle,
    series: config.series.map((item) => ({ ...item, value: null })),
    emptyMessage: message
  })

  if (filter.type === 'semiarido') {
    try {
      const record = await loadSemiaridoRecord(webMap)
      if (record) {
        const series = config.series.map((item) => ({
          ...item,
          value: pickSemiaridoById(
            record,
            item.id,
            [item.filteredField, item.field].filter(Boolean) as string[]
          )
        }))
        const hasData = series.some((item) => item.value != null && item.value > 0)
        return {
          title: chartTitle,
          series,
          emptyMessage: hasData ? null : 'Dado indisponível para este filtro'
        }
      }
    } catch (error) {
      console.warn('[sihs-dash] gráfico da Região Semiárida_BA:', error)
    }
  }

  let layerTitle = config.layerTitle
  let fieldBySeries: Record<string, string | undefined> = {}
  let where = '1=1'
  let geometry = filter.geometry || null

  if (filter.type === 'all') {
    layerTitle = config.layerTitle
    fieldBySeries = Object.fromEntries(
      config.series.map((item) => [item.id, item.field])
    )
  } else if (filter.type === 'semiarido') {
    layerTitle = config.filteredLayerTitle || DPA_MUNICIPIO_LAYER_TITLE
    fieldBySeries = Object.fromEntries(
      config.series.map((item) => [item.id, item.filteredField || item.field])
    )
    where = filter.munWhere || '1=1'
    geometry = filter.skipMunicipalGeometry ? null : (filter.geometry || null)
  } else {
    layerTitle = config.filteredLayerTitle || DPA_MUNICIPIO_LAYER_TITLE
    fieldBySeries = Object.fromEntries(
      config.series.map((item) => [item.id, item.filteredField || item.field])
    )
    where = filter.munWhere || '1=1'
    geometry = filter.geometry || null
  }

  const layer = (
    isMunicipalStatsLayer(layerTitle)
      ? resolveMunicipalLayer(webMap, filter)
      : null
  ) || findLayer(webMap, { layerTitle })
  if (!layer || typeof layer.queryFeatures !== 'function') {
    return empty('Camada do gráfico não encontrada')
  }

  try {
    const stats = await queryManyStatistics(layer, {
      where,
      geometry,
      stats: config.series.map((item) => ({
        statisticType: 'sum',
        onStatisticField: fieldBySeries[item.id] || item.field || '',
        outStatisticFieldName: item.id
      })).filter((item) => item.onStatisticField)
    })
    const series = config.series.map((item) => {
      const raw = stats?.[item.id] ?? stats?.[item.id.toLowerCase()]
      return {
        ...item,
        value: raw == null || raw === '' ? null : Number(raw)
      }
    })
    const hasData = series.some((item) => item.value != null && Number.isFinite(item.value))
    return {
      title: chartTitle,
      series,
      emptyMessage: hasData ? null : 'Dado indisponível para este filtro'
    }
  } catch (error) {
    console.error('[sihs-dash] Erro no gráfico de população:', error)
    return empty('Falha ao carregar o gráfico')
  }
}

function positionPopover (
  popupEl: HTMLElement,
  anchorEl: HTMLElement,
  options?: { preferBelow?: boolean }
): { left: number, top: number, arrowLeft: number, above: boolean } {
  const rect = anchorEl.getBoundingClientRect()
  const gap = 10
  const margin = 8
  const popWidth = popupEl.offsetWidth || 320
  const popHeight = popupEl.offsetHeight || 200
  const preferBelow = options?.preferBelow !== false

  let left = rect.left + rect.width / 2 - popWidth / 2
  left = Math.max(margin, Math.min(left, window.innerWidth - popWidth - margin))

  let top = rect.bottom + gap
  let above = false
  const spaceBelow = window.innerHeight - rect.bottom - gap
  const minSpace = preferBelow ? Math.min(popHeight, 120) : Math.min(popHeight, 180)

  if (spaceBelow < minSpace && rect.top > popHeight + gap) {
    // Só sobe se realmente não couber embaixo
    top = rect.top - popHeight - gap
    above = true
  } else if (preferBelow && spaceBelow < popHeight) {
    // Mantém flutuando abaixo do botão, mesmo se a lista for alta (o body faz scroll)
    top = rect.bottom + gap
    above = false
  }

  // Se ainda sair da viewport por baixo, sobe só o necessário
  if (!above && top + Math.min(popHeight, 280) > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - Math.min(popHeight, 280) - margin)
  }

  const arrowCenter = rect.left + rect.width / 2 - left
  const arrowLeft = Math.max(18, Math.min(arrowCenter, popWidth - 18))

  return { left, top, arrowLeft, above }
}

const Widget = (props: AllWidgetProps<IMConfig>) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const kpiStripRef = useRef<HTMLElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const webMapRef = useRef<any>(null)
  const viewRef = useRef<any>(null)
  const munSelectHandleRef = useRef<{ remove: () => void } | null>(null)
  const popupContextRef = useRef<PopupContext | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeFilterRef = useRef<DashboardFilter>({ ...FILTER_ALL })
  const applyFilterRef = useRef<(filter: DashboardFilter) => Promise<void>>(async () => {})
  const mountedRef = useRef(true)
  const statsLoadTokenRef = useRef(0)

  const [cardValues, setCardValues] = useState<Record<string, CardValueState>>(buildInitialCardValues)
  const [chartSeries, setChartSeries] = useState<ChartSeriesItem[]>(
    () => POPULATION_CHART.series.map((item) => ({ ...item, value: null }))
  )
  const [chartTitle, setChartTitle] = useState(POPULATION_CHART.title)
  const [chartEmptyMessage, setChartEmptyMessage] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<DashboardFilter>({ ...FILTER_ALL })
  const [statsRefreshing, setStatsRefreshing] = useState(false)
  const [saneamento, setSaneamento] = useState<{
    agua: SaneamentoSummary
    esgoto: SaneamentoSummary
  }>(() => loadingSummaries())
  const [saneamentoNoteOpen, setSaneamentoNoteOpen] = useState<'agua' | 'esgoto' | null>(null)
  const [overlay, setOverlay] = useState<OverlayState>({
    visible: true,
    title: 'Carregando mapa',
    message: 'Conectando ao ArcGIS Enterprise…'
  })
  const [popup, setPopup] = useState<PopupState>({
    open: false,
    anchorId: null,
    title: '',
    loading: false
  })

  const portalUrl = props.config?.portalUrl || DEFAULT_PORTAL_URL
  const webMapId = props.config?.webMapId || DEFAULT_WEB_MAP_ID
  const oauthAppId = props.config?.oauthAppId || DEFAULT_OAUTH_APP_ID

  const largeStat = useMemo(
    () => STAT_CARDS.find((item) => item.size === 'large') || STAT_CARDS[0],
    []
  )
  const smallStats = useMemo(
    () => STAT_CARDS.filter((item) => item.size !== 'large'),
    []
  )

  const statsPanelTitle = getStatsPanelTitle(activeFilter)
  const filterActive = activeFilter.type !== 'all'

  const updateCardsFromDefinitions = useCallback(async (
    webMap: any,
    definitions: IndicatorDefinition[],
    filter: DashboardFilter = FILTER_ALL
  ) => {
    const canBatchDpa =
      (filter.type === 'municipio' || filter.type === 'territorio') &&
      definitions.every((item) => item.filteredScope || isMunicipalStatsLayer(item.layerTitle))

    if (canBatchDpa) {
      const layer = resolveMunicipalLayer(webMap, filter)
      if (layer) {
        try {
          try { await layer.load?.() } catch (_) {}
          const stats = await queryManyStatistics(layer, {
            where: filter.munWhere || '1=1',
            geometry: filter.skipMunicipalGeometry ? null : (filter.geometry || null),
            stats: definitions.map((item) => {
              const field = item.id === 'pop_total'
                ? pickMunicipioPopEst2025Field(
                  layer,
                  item.filteredScope?.onStatisticField || item.onStatisticField
                )
                : (item.filteredScope?.onStatisticField || item.onStatisticField)
              return {
                statisticType: item.filteredScope?.statisticType || item.statisticType || 'sum',
                onStatisticField: field || '',
                outStatisticFieldName: item.id
              }
            }).filter((item) => item.onStatisticField)
          })
          if (stats && mountedRef.current) {
            const next: Record<string, CardValueState> = {}
            for (const definition of definitions) {
              const raw = stats[definition.id] ?? stats[definition.id.toLowerCase()]
              const value = raw == null || raw === '' ? null : Number(raw)
              next[definition.id] = {
                value: Number.isFinite(value as number) ? value : null,
                meta: definition.unit || null,
                status: value == null || !Number.isFinite(value as number) ? 'empty' : 'ok',
                message: value == null ? 'Dado indisponível para este filtro' : undefined,
                decimals: definition.decimals,
                sourceLabel: definition.filteredScope?.sourceLabel || 'Censo IBGE 2022'
              }
            }
            setCardValues((prev) => ({ ...prev, ...next }))
            return
          }
        } catch (error) {
          console.warn('[sihs-dash] soma em lote do DPA falhou, consultando um a um:', error)
        }
      }
    }

    await Promise.all(
      definitions.map(async (definition) => {
        try {
          const result = await resolveIndicatorValue(webMap, definition, filter)
          const value = result && typeof result === 'object' ? result.value : result
          const meta = result && typeof result === 'object' ? result.meta : null
          const unavailable =
            result && typeof result === 'object' ? result.unavailable : false
          const sourceLabel =
            result && typeof result === 'object' ? result.sourceLabel : undefined

          if (!mountedRef.current) return

          if (unavailable) {
            setCardValues((prev) => ({
              ...prev,
              [definition.id]: {
                value: null,
                status: 'empty',
                message: (result as IndicatorResult).message || 'Dado indisponível para este filtro',
                decimals: definition.decimals,
                sourceLabel: null
              }
            }))
            return
          }

          setCardValues((prev) => ({
            ...prev,
            [definition.id]: {
              value: value as number | null,
              meta: meta ?? definition.unit ?? null,
              status: 'ok',
              decimals: definition.decimals,
              sourceLabel: sourceLabel || null
            }
          }))
        } catch (error) {
          console.error(`[sihs-dash] Erro no indicador "${definition.id}":`, error)
          if (!mountedRef.current) return
          setCardValues((prev) => ({
            ...prev,
            [definition.id]: {
              value: null,
              status: 'error',
              message: (error as any)?.message || 'Falha na consulta',
              decimals: definition.decimals
            }
          }))
        }
      })
    )
  }, [])

  const loadBahiaNumeros = useCallback(async (webMap: any, filter: DashboardFilter) => {
    if (!mountedRef.current) return
    const token = ++statsLoadTokenRef.current
    setStatsRefreshing(true)
    setSaneamento(loadingSummaries(filter.label))

    const loadingStats: Record<string, CardValueState> = {}
    for (const item of STAT_CARDS) {
      loadingStats[item.id] = {
        value: null,
        status: 'loading',
        decimals: item.decimals
      }
    }
    setCardValues((prev) => ({ ...prev, ...loadingStats }))

    try {
      // Stats primeiro (visível), gráfico e saneamento em paralelo sem bloquear um ao outro
      const statsPromise = updateCardsFromDefinitions(webMap, STAT_CARDS, filter)
      const chartPromise = loadPopulationChartSeries(webMap, filter)
      const saneamentoPromise = loadSaneamentoSummaries(webMap, filter)

      await statsPromise
      if (!mountedRef.current || token !== statsLoadTokenRef.current) return

      const [chartData, saneamentoData] = await Promise.all([chartPromise, saneamentoPromise])
      if (!mountedRef.current || token !== statsLoadTokenRef.current) return

      setChartTitle(chartData.title)
      setChartSeries(chartData.series)
      setChartEmptyMessage(chartData.emptyMessage)
      setSaneamento(saneamentoData)
    } finally {
      if (mountedRef.current && token === statsLoadTokenRef.current) {
        setStatsRefreshing(false)
      }
    }
  }, [updateCardsFromDefinitions])

  const closePopup = useCallback(() => {
    popupContextRef.current = null
    setPopup((prev) => ({
      ...prev,
      open: false,
      anchorId: null,
      loading: false,
      error: undefined,
      names: undefined,
      items: undefined,
      searchTerm: undefined,
      searchResults: undefined,
      searching: false
    }))
  }, [])

  const repositionPopup = useCallback(() => {
    const popupEl = popoverRef.current
    const root = rootRef.current
    if (!popupEl || !root) return

    setPopup((prev) => {
      if (!prev.open || !prev.anchorId) return prev
      const anchor = root.querySelector(
        `[data-card-id="${prev.anchorId}"]`
      ) as HTMLElement | null
      if (!anchor) return prev
      const preferBelow = String(prev.anchorId).startsWith('embasa-')
      const pos = positionPopover(popupEl, anchor, { preferBelow })
      return {
        ...prev,
        left: pos.left,
        top: pos.top,
        arrowLeft: pos.arrowLeft,
        above: pos.above
      }
    })
  }, [])

  const applyFilter = useCallback(async (filter: DashboardFilter) => {
    const webMap = webMapRef.current
    const view = viewRef.current
    if (!webMap || !view) return

    activeFilterRef.current = filter
    setActiveFilter(filter)

    const zoomTask = (async () => {
      try {
        setTerritorialLayerFocus(webMap, filter.type)

        const munLayer = findMunicipioLayer(webMap)
        let tiLayer = findTerritorioLayer(webMap)
        const tiParent =
          (tiLayer?.parent && tiLayer.parent.type === 'map-image' ? tiLayer.parent : null) ||
          (tiLayer?.type === 'map-image' ? tiLayer : null)
        if (tiParent) {
          try { await tiParent.load?.() } catch (_) {}
          tiLayer = findTerritorioLayer(webMap) || tiLayer
        }
        if (filter.type === 'territorio') {
          setLayerDefinition(munLayer, filter.munWhere)
          setLayerDefinition(tiLayer, filter.zoomWhere)
        } else {
          restoreLayerDefinition(munLayer)
          restoreLayerDefinition(tiLayer)
        }

        const zoomLayer = (
          filter.type === 'semiarido'
            ? findSemiaridoLayer(webMap)
            : filter.type === 'municipio'
              ? findMunicipioLayer(webMap)
              : filter.type === 'territorio'
                ? findTerritorioLayer(webMap)
                : null
        ) || findLayer(webMap, { layerTitle: filter.zoomLayerTitle })
          || ((filter.type === 'municipio' || filter.type === 'semiarido')
            ? findMunicipioLayer(webMap)
            : null)

        if (filter.type === 'municipio') {
          const outlineLayer = findMunicipioLayer(webMap) || zoomLayer
          const outlineWhere = filter.zoomWhere || filter.munWhere
          if (outlineLayer && outlineWhere && outlineWhere !== '1=1') {
            void highlightWhere(view, outlineLayer, outlineWhere)
          } else {
            clearHighlight(view)
          }
        } else if (filter.type === 'territorio') {
          const outlineLayer = findTerritorioLayer(webMap) || zoomLayer
          const outlineWhere = filter.zoomWhere
          if (outlineLayer && outlineWhere && outlineWhere !== '1=1') {
            void highlightWhere(view, outlineLayer, outlineWhere, { maxFeatures: 20 })
          } else {
            clearHighlight(view)
          }
        } else if (filter.type === 'semiarido') {
          const outlineLayer = findSemiaridoLayer(webMap) || zoomLayer
          if (outlineLayer) {
            void highlightWhere(view, outlineLayer, filter.zoomWhere || '1=1', {
              outlineOnly: true,
              allowAll: true,
              maxFeatures: 1,
              theme: 'semiarido'
            })
          } else {
            clearHighlight(view)
          }
        } else {
          clearHighlight(view)
        }

        let ok = false
        if (filter.type === 'all') {
          const bahiaLayer = findLayer(webMap, { layerTitle: 'Limite Bahia' }) || zoomLayer
          ok = bahiaLayer ? await zoomToLayerExtent(view, bahiaLayer, BAHIA_HOME_EXPAND) : false
          if (!ok && bahiaLayer) {
            ok = await zoomToWhere(view, bahiaLayer, '1=1', BAHIA_HOME_EXPAND)
          }
        }

        if (filter.type === 'semiarido') {
          const semiLayer = findSemiaridoLayer(webMap) || zoomLayer
          ok = semiLayer ? await zoomToLayerExtent(view, semiLayer, 1.45) : false
        }

        if (!ok && zoomLayer) {
          ok = await zoomToWhere(view, zoomLayer, filter.zoomWhere || '1=1')
        }

        if (!ok && filter.type !== 'all') {
          const munLayer = findMunicipioLayer(webMap)
          const munWhere = filter.munWhere && filter.munWhere !== '1=1'
            ? filter.munWhere
            : filter.type === 'semiarido'
              ? SEMIARIDO_MUNICIPIOS_WHERE
              : null

          if (munLayer && munWhere) {
            ok = await zoomToWhere(view, munLayer, munWhere)
          }
        }

        if (!ok && filter.geometry) {
          ok = await zoomToGeometry(view, filter.geometry)
        }

        if (!ok && filter.type !== 'all') {
          console.warn('[sihs-dash] Não foi possível zoomar no filtro:', filter.label)
        }
      } catch (error) {
        console.warn('[sihs-dash] Falha no zoom do filtro:', error)
      }
    })()

    await Promise.all([zoomTask, loadBahiaNumeros(webMap, filter)])
  }, [loadBahiaNumeros])

  applyFilterRef.current = applyFilter

  const loadSemiaridoGeometry = useCallback(async () => {
    if (semiaridoGeometryCache) return semiaridoGeometryCache

    const webMap = webMapRef.current
    if (!webMap) {
      return { geometry: null as any, extraNames: [] as string[] }
    }

    const layer = findSemiaridoLayer(webMap)
    if (layer && typeof layer.queryFeatures === 'function') {
      try {
        await layer.load()
        // 1 feição regional — pedir só o necessário (sem paginar 2000)
        const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
        query.where = '1=1'
        query.returnGeometry = true
        query.outFields = [layer.objectIdField || 'objectid']
        query.num = 1
        // Simplifica o polígono no servidor (bem mais leve na rede)
        try { query.maxAllowableOffset = 0.002 } catch (_) {}
        const result = await layer.queryFeatures(query)
        const geoms = (result.features || []).map((feature: any) => feature?.geometry).filter(Boolean)
        const geometry = geoms.length <= 1 ? (geoms[0] || null) : await unionGeometries(geoms)
        semiaridoGeometryCache = { geometry, extraNames: [] as string[] }
        return semiaridoGeometryCache
      } catch (error) {
        console.warn('[sihs-dash] Geometria da Região Semiárida_BA:', error)
      }
    } else {
      console.warn('[sihs-dash] Camada Região Semiárida_BA não encontrada para geometria.')
    }

    // Sem fallback pesado (listar municípios / union): o zoom usa a própria camada.
    semiaridoGeometryCache = { geometry: null as any, extraNames: [] as string[] }
    return semiaridoGeometryCache
  }, [])

  const openIndicatorPopup = useCallback(async (
    definition: IndicatorDefinition,
    anchorId: string
  ) => {
    const popupConfig = definition.popup
    const webMap = webMapRef.current
    if (!popupConfig || !webMap) return

    popupContextRef.current = { definition, popupConfig }

    setPopup({
      open: true,
      anchorId,
      title: popupConfig.title || definition.label,
      loading: true,
      mode: popupConfig.mode,
      selectable: Boolean(popupConfig.selectable),
      hint: popupConfig.hint,
      description: popupConfig.description,
      actionLabel: popupConfig.actionLabel,
      source: popupConfig.source
    })

    requestAnimationFrame(() => repositionPopup())

    try {
      const needsLayer = popupConfig.mode === 'list' || popupConfig.mode === 'types'
      const layer = popupConfig.filterType === 'municipio' || popupConfig.filterType === 'semiarido'
        ? findMunicipioLayer(webMap)
        : popupConfig.filterType === 'territorio'
          ? (await resolveTerritorioQueryableLayer(webMap) || findLayer(webMap, {
              layerTitle: definition.layerTitle,
              layerId: definition.layerId
            }))
          : findLayer(webMap, {
              layerTitle: definition.layerTitle,
              layerId: definition.layerId
            })

      if (needsLayer && (!layer || typeof layer.queryFeatures !== 'function')) {
        throw new Error('Camada não encontrada para detalhamento.')
      }

      if (popupConfig.mode === 'list') {
        if (!layer || typeof layer.queryFeatures !== 'function') {
          throw new Error('Camada não encontrada para detalhamento.')
        }
        try { await layer.load?.() } catch (_) {}
        const nameField = popupConfig.filterType === 'territorio'
          ? pickTerritorioNameField(layer, popupConfig.field)
          : popupConfig.field
        const codeField = popupConfig.filterType === 'territorio'
          ? pickTerritorioCodeField(layer)
          : null
        const names = await queryFieldValues(layer, {
          field: nameField || popupConfig.field,
          fallbacks: popupConfig.filterType === 'territorio'
            ? ['nm_ti', 'nom_ti', 'territorio']
            : undefined,
          where: definition.where || '1=1',
          orderByFields: codeField
            ? [`${codeField} ASC`]
            : popupConfig.orderByFields,
          num: 200
        })

        if (!mountedRef.current) return
        setPopup((prev) => ({
          ...prev,
          open: true,
          anchorId,
          title: popupConfig.title || definition.label,
          loading: false,
          mode: 'list',
          names,
          selectable: Boolean(popupConfig.selectable),
          hint: popupConfig.hint,
          error: undefined
        }))
        requestAnimationFrame(() => repositionPopup())
        return
      }

      if (popupConfig.mode === 'search') {
        if (!mountedRef.current) return
        setPopup((prev) => ({
          ...prev,
          open: true,
          anchorId,
          title: popupConfig.title || definition.label,
          loading: false,
          mode: 'search',
          hint: popupConfig.hint,
          searchTerm: '',
          searchResults: [],
          searching: false,
          error: undefined
        }))
        requestAnimationFrame(() => repositionPopup())
        return
      }

      if (popupConfig.mode === 'filterAction') {
        if (!mountedRef.current) return
        setPopup((prev) => ({
          ...prev,
          open: true,
          anchorId,
          title: popupConfig.title || definition.label,
          loading: false,
          mode: 'filterAction',
          description: popupConfig.description,
          actionLabel: popupConfig.actionLabel,
          error: undefined
        }))
        requestAnimationFrame(() => repositionPopup())
        return
      }

      if (popupConfig.mode === 'types') {
        const items = await queryTypeBreakdown(layer, {
          field: popupConfig.field,
          where: definition.where || '1=1'
        })
        let secondaryItems: Array<{ label: string, total: number }> = []
        if (popupConfig.secondaryField) {
          try {
            secondaryItems = await queryTypeBreakdown(layer, {
              field: popupConfig.secondaryField,
              where: `${popupConfig.secondaryField} IS NOT NULL AND ${popupConfig.secondaryField} <> ''`
            })
          } catch {
            secondaryItems = []
          }
        }

        if (!mountedRef.current) return
        setPopup((prev) => ({
          ...prev,
          open: true,
          anchorId,
          title: popupConfig.title || definition.label,
          loading: false,
          mode: 'types',
          items,
          secondaryItems,
          secondaryTitle: popupConfig.secondaryTitle,
          hint: popupConfig.hint,
          error: undefined
        }))
        requestAnimationFrame(() => repositionPopup())
        return
      }

      throw new Error('Tipo de popup não suportado.')
    } catch (error) {
      console.error('[sihs-dash] Erro no popup do indicador:', error)
      if (!mountedRef.current) return
      setPopup((prev) => ({
        ...prev,
        open: true,
        anchorId,
        title: popupConfig.title || definition.label,
        loading: false,
        error: (error as any)?.message || 'Falha ao consultar detalhamento.'
      }))
      requestAnimationFrame(() => repositionPopup())
    }
  }, [repositionPopup])

  const handleKpiClick = useCallback((id: string) => {
    const definition = HEADER_INDICATORS.find((item) => item.id === id)
    if (!definition?.popup) return

    if (popup.open && popup.anchorId === id) {
      closePopup()
      return
    }

    openIndicatorPopup(definition, id)
  }, [popup.open, popup.anchorId, closePopup, openIndicatorPopup])

  const openEmbasaMunicipiosPopup = useCallback(async (kind: 'agua' | 'esgoto') => {
    const webMap = webMapRef.current
    const filter = activeFilterRef.current
    const anchorId = `embasa-${kind}`

    if (!webMap) return
    if (filter.type === 'municipio') return

    if (popup.open && popup.anchorId === anchorId) {
      closePopup()
      return
    }

    popupContextRef.current = null
    const title = kind === 'agua'
      ? 'Municípios Embasa (água)'
      : 'Municípios Embasa (esgoto)'
    const scopeHint = filter.type === 'territorio'
      ? `Território: ${filter.label}`
      : filter.type === 'semiarido'
        ? 'Região Semiárida'
        : 'Estado da Bahia'

    setPopup({
      open: true,
      anchorId,
      title,
      mode: 'list',
      loading: true,
      selectable: false,
      hint: scopeHint,
      names: []
    })
    requestAnimationFrame(() => repositionPopup())

    try {
      const names = await listEmbasaMunicipios(webMap, filter, kind)
      if (!mountedRef.current) return
      setPopup((prev) => ({
        ...prev,
        open: true,
        anchorId,
        title,
        mode: 'list',
        loading: false,
        selectable: false,
        hint: names.length
          ? `${scopeHint} · ${names.length} município${names.length === 1 ? '' : 's'}`
          : scopeHint,
        names,
        error: undefined
      }))
      requestAnimationFrame(() => repositionPopup())
    } catch (error) {
      if (!mountedRef.current) return
      setPopup((prev) => ({
        ...prev,
        open: true,
        anchorId,
        title,
        mode: 'list',
        loading: false,
        error: (error as any)?.message || 'Falha ao listar municípios Embasa.'
      }))
      requestAnimationFrame(() => repositionPopup())
    }
  }, [popup.open, popup.anchorId, closePopup, repositionPopup])

  const handlePopupSelection = useCallback(async (value: string) => {
    if (!value || !popupContextRef.current) return

    const filterType = popupContextRef.current.popupConfig?.filterType
    closePopup()

    if (filterType === 'territorio') {
      const munLayer = findMunicipioLayer(webMapRef.current)
      const tiLayer = await resolveTerritorioQueryableLayer(webMapRef.current)
        || findTerritorioLayer(webMapRef.current)
      try { await munLayer?.load?.() } catch (_) {}
      try { await tiLayer?.load?.() } catch (_) {}
      await applyFilter(createTerritoryFilter(value, { munLayer, tiLayer }))
      return
    }

    if (filterType === 'municipio') {
      const munLayer = findMunicipioLayer(webMapRef.current)
      try { await munLayer?.load?.() } catch (_) {}
      const nameField = pickMunicipioNameField(munLayer, 'nome_do_municipio')
      await applyFilter(createMunicipalityFilter(value, nameField))
    }
  }, [applyFilter, closePopup])

  const handleFilterAction = useCallback(async () => {
    if (!popupContextRef.current) return
    const filterType = popupContextRef.current.popupConfig?.filterType
    closePopup()

    if (filterType !== 'semiarido') return

    try {
      // Aplicar na hora: não esperar download da geometria (pulamos spatial filter).
      // Os totais vêm da própria camada Região Semiárida_BA / campo do DPA.
      const munLayer = findMunicipioLayer(webMapRef.current)
      try { await munLayer?.load?.() } catch (_) {}
      await applyFilter(createSemiaridoFilter(null, [], munLayer))
      // Geometria em background só para cache de zoom futuro (não bloqueia os cards)
      void loadSemiaridoGeometry().catch(() => {})
    } catch (error) {
      console.warn('[sihs-dash] Falha ao aplicar filtro da região semiárida:', error)
      try {
        await applyFilter(createSemiaridoFilter())
      } catch (fallbackError) {
        console.warn('[sihs-dash] Fallback do filtro semiárido:', fallbackError)
      }
    }
  }, [applyFilter, closePopup, loadSemiaridoGeometry])

  const handleSearchTermChange = useCallback((term: string) => {
    setPopup((prev) => ({
      ...prev,
      searchTerm: term,
      searching: String(term).trim().length >= 2,
      searchResults: String(term).trim().length < 2 ? [] : prev.searchResults
    }))

    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    if (String(term).trim().length < 2) return

    searchTimerRef.current = setTimeout(async () => {
      const ctx = popupContextRef.current
      const webMap = webMapRef.current
      if (!ctx || !webMap) return

      try {
        const layer = findMunicipioLayer(webMap) || findLayer(webMap, {
          layerTitle: ctx.definition.layerTitle
        })
        if (!layer) {
          setPopup((prev) => ({
            ...prev,
            searching: false,
            searchResults: []
          }))
          return
        }

        const results = await searchFieldValues(layer, {
          field: pickMunicipioNameField(layer, ctx.popupConfig.field || 'nome_do_municipio'),
          term,
          num: 12
        })

        if (!mountedRef.current) return
        setPopup((prev) => ({
          ...prev,
          searching: false,
          searchResults: results
        }))
        requestAnimationFrame(() => repositionPopup())
      } catch (error) {
        console.error('[sihs-dash] Erro na busca:', error)
        if (!mountedRef.current) return
        setPopup((prev) => ({
          ...prev,
          searching: false,
          searchResults: []
        }))
      }
    }, 280)
  }, [repositionPopup])

  // Init map + data
  useEffect(() => {
    mountedRef.current = true
    let cancelled = false

    const init = async () => {
      try {
        console.group('[sihs-dash] Configuração')
        console.log('PORTAL_URL:', portalUrl)
        console.log('WEB_MAP_ID:', webMapId)
        console.groupEnd()

        await setupAuthentication({ portalUrl, oauthAppId })
        if (cancelled) return

        setOverlay({
          visible: true,
          title: 'Carregando mapa',
          message: 'Conectando ao ArcGIS Enterprise…'
        })

        const webMap = await createWebMap({ portalUrl, webMapId })
        if (cancelled || !mapRef.current) return

        const view = await createMapView(mapRef.current, webMap)
        if (cancelled) {
          view.destroy?.()
          return
        }

        webMapRef.current = webMap
        viewRef.current = view

        setOverlay({ visible: false, title: '', message: '' })

        disableNativePopup(view, webMap)
        setTerritorialLayerFocus(webMap, 'all')
        const bahiaHome = findLayer(webMap, { layerTitle: 'Limite Bahia' })
        if (bahiaHome) {
          await zoomToLayerExtent(view, bahiaHome, BAHIA_HOME_EXPAND)
        }

        const munLayer = findMunicipioLayer(webMap)
        if (munLayer) {
          try { await munLayer.load?.() } catch (_) {}
          munLayer.visible = true
          munSelectHandleRef.current = enableMunicipioHighlight(view, {
            webMap,
            layer: munLayer,
            onSelect: (payload) => {
              if (!payload?.name) {
                void applyFilterRef.current(FILTER_ALL)
                return
              }
              const nameField = pickMunicipioNameField(payload.layer || munLayer, 'nome_do_municipio')
              void applyFilterRef.current(createMunicipalityFilter(payload.name, nameField))
            }
          })
        } else {
          console.warn('[sihs-dash] Camada de municípios não encontrada — clique no mapa desabilitado.')
        }

        // KPIs do topo primeiro; Bahia em números em seguida (evita rajada de queries)
        await updateCardsFromDefinitions(webMap, HEADER_INDICATORS, FILTER_ALL)
        if (!cancelled && mountedRef.current) {
          void loadBahiaNumeros(webMap, activeFilterRef.current)
        }
        console.info('[sihs-dash] Dashboard inicializado.')
      } catch (error) {
        console.error('[sihs-dash] Falha na inicialização:', error)
        if (!cancelled) {
          setOverlay({
            visible: true,
            title: 'Não foi possível carregar o mapa',
            message: buildFriendlyError(error)
          })
        }
      }
    }

    init()

    return () => {
      cancelled = true
      mountedRef.current = false
      munSelectHandleRef.current?.remove?.()
      munSelectHandleRef.current = null
      if (viewRef.current) {
        clearHighlight(viewRef.current)
        viewRef.current.destroy?.()
        viewRef.current = null
      }
      webMapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once with config snapshot
  }, [portalUrl, webMapId, oauthAppId])

  // ResizeObserver
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      void resizeMapView(viewRef.current)
      repositionPopup()
    })
    observer.observe(root)
    if (mapRef.current) observer.observe(mapRef.current)
    return () => observer.disconnect()
  }, [repositionPopup])

  // Close popup on outside click / Escape; reposition on scroll/resize
  useEffect(() => {
    if (!popup.open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePopup()
    }

    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (popoverRef.current?.contains(target)) return
      if ((target as Element)?.closest?.('.kpi-item--interactive')) return
      closePopup()
    }

    const onReposition = () => repositionPopup()

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('click', onDocClick)
    window.addEventListener('resize', onReposition, { passive: true })
    window.addEventListener('scroll', onReposition, { passive: true, capture: true })

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onDocClick)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [popup.open, closePopup, repositionPopup])

  useEffect(() => {
    if (!saneamentoNoteOpen) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSaneamentoNoteOpen(null)
    }

    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Element
      if (target?.closest?.('.saneamento-card__note-wrap')) return
      setSaneamentoNoteOpen(null)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('click', onDocClick)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onDocClick)
    }
  }, [saneamentoNoteOpen])

  useEffect(() => {
    if (popup.open) {
      requestAnimationFrame(() => repositionPopup())

    }
  }, [popup.open, popup.loading, popup.mode, popup.names, popup.items, popup.searchResults, repositionPopup])

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  const chartHasData = chartSeries.some(
    (item) => item.value != null && Number(item.value) > 0
  )
  const chartTotal = chartSeries.reduce((sum, item) => sum + (Number(item.value) || 0), 0)

  const renderCardValue = (id: string) => {
    const state = cardValues[id]
    if (!state || state.status === 'loading') return '—'
    if (state.status === 'error') return 'Erro'
    if (state.status === 'empty') return '—'
    return formatValue(state.value, state.decimals)
  }

  const cardClassName = (id: string, base: string) => {
    const state = cardValues[id]
    const status = state?.status || 'loading'
    return [
      base,
      status === 'loading' ? 'is-loading' : '',
      status === 'error' ? 'is-error' : '',
      status === 'empty' ? 'is-empty' : ''
    ].filter(Boolean).join(' ')
  }

  const hasSecondaryTypes = Boolean(popup.secondaryItems?.length)

  return (
    <div className="sihs-page jimu-widget" ref={rootRef}>
      <div className="sihs-page__hero">
        <HeroPortal />
      </div>
      <div className="sihs-dash">
      <div className="dashboard">
        <header className="kpi-strip" ref={kpiStripRef} aria-label="Indicadores principais">
          {HEADER_INDICATORS.map((item) => {
            const state = cardValues[item.id]
            const hasPopup = Boolean(item.popup)
            const expanded = popup.open && popup.anchorId === item.id
            const className = cardClassName(
              item.id,
              hasPopup ? 'kpi-item kpi-item--interactive' : 'kpi-item'
            )
            const iconHtml = getKpiIconHtml(item.icon, props.context.folderUrl)

            const content = (
              <>
                <span
                  className="kpi-icon"
                  dangerouslySetInnerHTML={{ __html: iconHtml }}
                />
                <span className="kpi-text">
                  <span className="kpi-label">{item.label}</span>
                  <span className="kpi-value" data-role="value">
                    {renderCardValue(item.id)}
                  </span>
                  {state?.meta
                    ? (
                      <span className="kpi-meta" data-role="meta">
                        {state.meta}
                      </span>
                      )
                    : (
                      <span className="kpi-meta" data-role="meta" hidden />
                      )}
                  {hasPopup ? <span className="kpi-hint">Ver detalhes</span> : null}
                </span>
              </>
            )

            if (hasPopup) {
              return (
                <button
                  key={item.id}
                  type="button"
                  className={className}
                  data-card-id={item.id}
                  aria-busy={state?.status === 'loading'}
                  aria-haspopup="true"
                  aria-expanded={expanded}
                  title={state?.status === 'error' ? state.message : undefined}
                  onClick={(event) => {
                    event.stopPropagation()
                    handleKpiClick(item.id)
                  }}
                >
                  {content}
                </button>
              )
            }

            return (
              <div
                key={item.id}
                className={className}
                data-card-id={item.id}
                aria-busy={state?.status === 'loading'}
              >
                {content}
              </div>
            )
          })}
        </header>

        <main className="dashboard-main">
          <section className="panel panel-map" aria-label="Estado da Bahia">
            <div className="panel-accent" />
            <header className="panel-head">
              <div>
                <p className="panel-eyebrow">Mapa interativo</p>
                <h2 className="panel-title">ESTADO DA BAHIA</h2>
              </div>
            </header>
            <div className="map-frame">
              <div className="sihs-dash__map" ref={mapRef} />
              <div className={`map-overlay${overlay.visible ? ' is-visible' : ''}`}>
                <PortalLoader
                  folderUrl={props.context.folderUrl}
                  label={overlay.message || overlay.title || 'Carregando mapa'}
                />
              </div>
            </div>
          </section>

          <section
            className={`panel panel-stats${statsRefreshing ? ' is-refreshing' : ''}`}
            aria-label="Bahia em números"
            aria-busy={statsRefreshing}
          >
            {statsRefreshing
              ? (
                <div className="stats-loading" aria-live="polite" aria-label="Carregando indicadores">
                  <PortalLoader folderUrl={props.context.folderUrl} label="Atualizando indicadores" />
                </div>
                )
              : null}
            <div className="panel-accent" />
            <div className="stats-panel-head">
              <header className="panel-head">
                <div>
                  <p className="panel-eyebrow">Indicadores demográficos</p>
                  <h2 className="panel-title">{statsPanelTitle}</h2>
                </div>
              </header>
              <div className="filter-banner" hidden={!filterActive}>
                <span>{`Filtro: ${activeFilter.label}`}</span>
                <button
                  type="button"
                  className="filter-clear"
                  onClick={() => { void applyFilter(FILTER_ALL) }}
                >
                  Limpar filtro
                </button>
              </div>
            </div>

            <div className="stats-layout">
              <div className="stat-card-wrap">
                <article
                  className={cardClassName(largeStat.id, 'stat-card stat-card--large')}
                  data-card-id={largeStat.id}
                  aria-busy={cardValues[largeStat.id]?.status === 'loading'}
                  title={
                    cardValues[largeStat.id]?.status === 'error'
                      ? cardValues[largeStat.id]?.message
                      : undefined
                  }
                >
                  <p className="stat-kicker">{largeStat.label}</p>
                  <p className="stat-value" data-role="value">
                    {renderCardValue(largeStat.id)}
                  </p>
                  {cardValues[largeStat.id]?.status === 'empty' && cardValues[largeStat.id]?.message
                    ? (
                      <p className="stat-meta" data-role="meta">
                        {cardValues[largeStat.id].message}
                      </p>
                      )
                    : cardValues[largeStat.id]?.meta
                      ? (
                        <p className="stat-meta" data-role="meta">
                          {cardValues[largeStat.id].meta}
                        </p>
                        )
                      : (
                        <p className="stat-meta" data-role="meta" hidden />
                        )}
                </article>
                <p className="stat-source">
                  <span>
                    Pop. estimada IBGE <strong>2026</strong>
                  </span>
                  <span className="stats-year-ref__accent" aria-hidden="true" />
                </p>
              </div>

              <div className="stats-grid" aria-live="polite">
                {smallStats.map((item, index) => {
                  const state = cardValues[item.id]
                  return (
                    <article
                      key={item.id}
                      className={cardClassName(item.id, 'stat-card')}
                      data-card-id={item.id}
                      data-tone={(index % 3) + 1}
                      aria-busy={state?.status === 'loading'}
                      style={{ ['--delay' as any]: `${index * 40}ms` }}
                      title={state?.status === 'error' ? state.message : undefined}
                    >
                      <p className="stat-label">{item.label}</p>
                      <p className="stat-value" data-role="value">
                        {renderCardValue(item.id)}
                      </p>
                      {state?.status === 'empty' && state.message
                        ? (
                          <p className="stat-meta" data-role="meta">
                            {state.message}
                          </p>
                          )
                        : state?.meta
                          ? (
                            <p className="stat-meta" data-role="meta">
                              {state.meta}
                            </p>
                            )
                          : (
                            <p className="stat-meta" data-role="meta" hidden />
                            )}
                    </article>
                  )
                })}
              </div>
            </div>

            <div className="stats-year-ref" aria-label="Ano de referência dos dados">
              <span className="stats-year-ref__accent" aria-hidden="true" />
              <span className="stats-year-ref__text">
                Fonte: Censo IBGE <strong>2022</strong>
              </span>
            </div>

            <div className="chart-block">
              <div className="chart-head">
                <h3 className="chart-title">{chartTitle}</h3>
              </div>
              <div className="population-chart" aria-live="polite">
                {!chartHasData
                  ? (
                    <p className="chart-empty">
                      {chartEmptyMessage || 'Dado indisponível para este filtro'}
                    </p>
                    )
                  : chartSeries.map((item, index) => {
                    const value = Number(item.value) || 0
                    const share = chartTotal > 0 ? (value / chartTotal) * 100 : 0
                    const pct = Math.max(0, Math.min(100, share))
                    return (
                      <div
                        key={item.id}
                        className="chart-row"
                        data-series-id={item.id}
                        style={{ ['--i' as any]: index }}
                      >
                        <div className="chart-row-top">
                          <span className="chart-series-label">
                            <i style={{ background: item.color }} />
                            {item.label}
                          </span>
                          <span className="chart-bar-value">
                            {formatValue(item.value)}
                          </span>
                        </div>
                        <div
                          className={`chart-bar-track${pct < 18 ? ' has-hint-out' : ''}`}
                          style={{ ['--pct' as any]: `${pct}%` }}
                        >
                          <div
                            className="chart-bar"
                            style={{
                              ['--bar-color' as any]: item.color,
                              width: `${pct}%`
                            }}
                          >
                            {pct >= 18
                              ? (
                                <span className="chart-bar-hint">
                                  {share.toLocaleString('pt-BR', {
                                    minimumFractionDigits: 1,
                                    maximumFractionDigits: 1
                                  })}%
                                </span>
                                )
                              : null}
                          </div>
                          {pct < 18
                            ? (
                              <span className="chart-bar-hint chart-bar-hint--out">
                                {share.toLocaleString('pt-BR', {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1
                                })}%
                              </span>
                              )
                            : null}
                        </div>
                      </div>
                    )
                  })}
              </div>
              {chartHasData
                ? (
                  <div className="chart-scale" aria-hidden="true">
                    <span>0%</span>
                    <span>100%</span>
                  </div>
                  )
                : null}
            </div>
          </section>
        </main>

        <section className="saneamento-resumo" aria-label="Resumo de saneamento">
          {(['agua', 'esgoto'] as const).map((kind) => {
            const data = saneamento[kind]
            return (
              <article
                key={kind}
                className={`saneamento-card saneamento-card--${kind}${data.status === 'loading' ? ' is-loading' : ''}`}
              >
                <header className="saneamento-card__head">
                  <div>
                    <p className="saneamento-card__eyebrow">
                      {kind === 'agua' ? 'Saneamento · Água' : 'Saneamento · Esgoto'}
                    </p>
                    <div className="saneamento-card__title-row">
                      <h3 className="saneamento-card__title">{data.title}</h3>
                      <div className="saneamento-card__note-wrap">
                        <button
                          type="button"
                          className={`saneamento-card__info-btn${saneamentoNoteOpen === kind ? ' is-open' : ''}`}
                          aria-label={`Como funcionam os indicadores de ${data.title}`}
                          aria-expanded={saneamentoNoteOpen === kind}
                          aria-controls={`saneamento-note-${kind}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            setSaneamentoNoteOpen((prev) => (prev === kind ? null : kind))
                          }}
                        >
                          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                            <path
                              d="M12 10.5v5.25M12 7.75h.01"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.2"
                              strokeLinecap="round"
                            />
                          </svg>
                        </button>
                        {saneamentoNoteOpen === kind
                          ? (
                            <div
                              id={`saneamento-note-${kind}`}
                              className="saneamento-card__note"
                              role="dialog"
                              aria-labelledby={`saneamento-note-title-${kind}`}
                            >
                              <div className="saneamento-card__note-head">
                                <h4 id={`saneamento-note-title-${kind}`}>
                                  {SANEAMENTO_NOTES[kind].title}
                                </h4>
                                <button
                                  type="button"
                                  className="saneamento-card__note-close"
                                  aria-label="Fechar nota"
                                  onClick={() => setSaneamentoNoteOpen(null)}
                                >
                                  ×
                                </button>
                              </div>
                              <div className="saneamento-card__note-body">
                                {SANEAMENTO_NOTES[kind].body.map((paragraph) => (
                                  <p key={paragraph}>{paragraph}</p>
                                ))}
                              </div>
                            </div>
                            )
                          : null}
                      </div>
                    </div>
                    <p className="saneamento-card__scope">{data.scopeLabel}</p>
                  </div>
                  {data.embasaText || data.embasaValue != null
                    ? (
                      activeFilter.type !== 'municipio' && data.status === 'ok'
                        ? (
                          <button
                            type="button"
                            className={`saneamento-card__badge saneamento-card__badge--btn${data.embasaText ? ' saneamento-card__badge--text' : ''}`}
                            data-card-id={`embasa-${kind}`}
                            aria-haspopup="dialog"
                            aria-expanded={popup.open && popup.anchorId === `embasa-${kind}`}
                            title="Ver municípios atendidos pela Embasa"
                            onClick={() => { void openEmbasaMunicipiosPopup(kind) }}
                          >
                            <span>{data.embasaText || formatValue(data.embasaValue)}</span>
                            <small>{data.embasaLabel}</small>
                            <em className="saneamento-card__badge-action">Ver lista</em>
                          </button>
                          )
                        : (
                          <div className={`saneamento-card__badge${data.embasaText ? ' saneamento-card__badge--text' : ''}`}>
                            <span>{data.embasaText || formatValue(data.embasaValue)}</span>
                            <small>{data.embasaLabel}</small>
                          </div>
                          )
                      )
                    : null}
                </header>

                {data.status === 'error'
                  ? (
                    <p className="saneamento-card__error">
                      {data.message || 'Dados indisponíveis'}
                    </p>
                    )
                  : (
                    <>
                      <div className="saneamento-card__highlights">
                        <div className="saneamento-kpi">
                          <p className="saneamento-kpi__label">{data.highlightLabel}</p>
                          <p className="saneamento-kpi__value">
                            {data.status === 'loading'
                              ? '—'
                              : formatValue(data.highlightValue)}
                          </p>
                          <p className="saneamento-kpi__pct">
                            {data.highlightPercent == null
                              ? '—'
                              : `${formatValue(data.highlightPercent, 1)}% dos domicílios`}
                          </p>
                        </div>
                        <div className="saneamento-kpi saneamento-kpi--secondary">
                          <p className="saneamento-kpi__label">{data.secondaryLabel}</p>
                          <p className="saneamento-kpi__value">
                            {data.status === 'loading'
                              ? '—'
                              : formatValue(data.secondaryValue)}
                          </p>
                          <p className="saneamento-kpi__pct">
                            {data.secondaryPercent == null
                              ? '—'
                              : `${formatValue(data.secondaryPercent, 1)}% dos domicílios`}
                          </p>
                        </div>
                      </div>

                      <div className="saneamento-bars" aria-label={`Composição — ${data.title}`}>
                        {data.metrics.map((metric) => {
                          const pct = Math.max(0, Math.min(100, Number(metric.percent) || 0))
                          return (
                            <div key={metric.id} className="saneamento-bar-row">
                              <div className="saneamento-bar-row__top">
                                <span>
                                  <i style={{ background: metric.color }} />
                                  {metric.label}
                                </span>
                                <strong>
                                  {data.status === 'loading'
                                    ? '—'
                                    : metric.value == null
                                      ? '—'
                                      : formatValue(metric.value)}
                                </strong>
                              </div>
                              <div
                                className={`saneamento-bar-track${pct < 18 ? ' has-hint-out' : ''}`}
                                style={{ ['--pct' as any]: `${pct}%` }}
                              >
                                <div
                                  className="saneamento-bar-fill"
                                  style={{
                                    width: data.status === 'loading' ? '18%' : `${pct}%`,
                                    background: metric.color
                                  }}
                                >
                                  {data.status !== 'loading' && metric.percent != null && pct >= 18
                                    ? (
                                      <span className="saneamento-bar-hint">
                                        {formatValue(metric.percent, 1)}%
                                      </span>
                                      )
                                    : null}
                                </div>
                                {data.status !== 'loading' && metric.percent != null && pct < 18
                                  ? (
                                    <span className="saneamento-bar-hint saneamento-bar-hint--out">
                                      {formatValue(metric.percent, 1)}%
                                    </span>
                                    )
                                  : null}
                              </div>
                            </div>
                          )
                        })}
                        <div className="chart-scale chart-scale--saneamento" aria-hidden="true">
                          <span>0%</span>
                          <span>100%</span>
                        </div>
                      </div>
                    </>
                    )}
                <div className="saneamento-card__source">
                  <span className="stats-year-ref__accent" aria-hidden="true" />
                  <p className="saneamento-card__source-text">
                    Fonte: <strong>{SANEAMENTO_SOURCE}</strong>
                  </p>
                </div>
              </article>
            )
          })}
        </section>
      </div>

      <div
        ref={popoverRef}
        className={`kpi-popover${popup.above ? ' kpi-popover--above' : ''}${hasSecondaryTypes ? ' kpi-popover--stack' : ''}`}
        hidden={!popup.open}
        role="dialog"
        aria-labelledby="kpiPopupTitle"
        style={
          popup.open
            ? {
                left: popup.left ?? 0,
                top: popup.top ?? 0,
                ['--arrow-left' as any]: `${popup.arrowLeft ?? 50}px`
              }
            : undefined
        }
      >
        <div className="kpi-popover__arrow" aria-hidden="true" />
        <header className="kpi-popover__header">
          <h3 id="kpiPopupTitle">{popup.title || 'Indicador'}</h3>
          <button
            type="button"
            className="kpi-popover__close"
            data-popup-close
            aria-label="Fechar"
            onClick={closePopup}
          >
            ×
          </button>
        </header>
        <div className="kpi-popover__body">
          {popup.loading
            ? <PortalLoader folderUrl={props.context.folderUrl} compact label="Carregando" />
            : null}

          {!popup.loading && popup.error
            ? <p className="kpi-popover__error">{popup.error}</p>
            : null}

          {!popup.loading && !popup.error && popup.mode === 'list' && popup.names?.length
            ? (
              <>
                {popup.hint ? <p className="kpi-popover__hint">{popup.hint}</p> : null}
                <ul className={`kpi-popover__list${popup.selectable ? ' is-selectable' : ''}`}>
                  {popup.names.map((name, index) => (
                    <li key={name}>
                      {popup.selectable
                        ? (
                          <button
                            type="button"
                            className="kpi-popover__option"
                            data-filter-value={name}
                            onClick={() => { void handlePopupSelection(name) }}
                          >
                            <span>{index + 1}</span>
                            {name}
                          </button>
                          )
                        : (
                          <>
                            <span>{index + 1}</span>
                            {name}
                          </>
                          )}
                    </li>
                  ))}
                </ul>
              </>
              )
            : null}

          {!popup.loading && !popup.error && popup.mode === 'list' && !popup.names?.length
            ? <p className="kpi-popover__error">Nenhum dado encontrado.</p>
            : null}

          {!popup.loading && !popup.error && popup.mode === 'search'
            ? (
              <>
                {popup.hint ? <p className="kpi-popover__hint">{popup.hint}</p> : null}
                <label className="kpi-search">
                  <input
                    id="kpiSearchInput"
                    type="search"
                    placeholder="Ex.: Salvador, Feira de Santana…"
                    autoComplete="off"
                    autoFocus
                    value={popup.searchTerm || ''}
                    onChange={(event) => handleSearchTermChange(event.target.value)}
                  />
                </label>
                <ul className="kpi-popover__list is-selectable kpi-search-results">
                  {String(popup.searchTerm || '').trim().length < 2
                    ? null
                    : popup.searching
                      ? <li className="kpi-popover__empty">Buscando…</li>
                      : !(popup.searchResults || []).length
                          ? <li className="kpi-popover__empty">Nenhum município encontrado</li>
                          : (popup.searchResults || []).map((name) => (
                            <li key={name}>
                              <button
                                type="button"
                                className="kpi-popover__option kpi-popover__option--plain"
                                data-filter-value={name}
                                onClick={() => { void handlePopupSelection(name) }}
                              >
                                {name}
                              </button>
                            </li>
                            ))}
                </ul>
              </>
              )
            : null}

          {!popup.loading && !popup.error && popup.mode === 'filterAction'
            ? (
              <>
                <p className="kpi-popover__hint">{popup.description || ''}</p>
                <button
                  type="button"
                  className="kpi-action-btn"
                  data-filter-action
                  onClick={() => { void handleFilterAction() }}
                >
                  {popup.actionLabel || 'Aplicar filtro'}
                </button>
              </>
              )
            : null}

          {!popup.loading && !popup.error && popup.mode === 'types' && popup.items?.length
            ? (
              <>
                {popup.hint
                  ? <p className="kpi-popover__hint">{popup.hint}</p>
                  : null}
                {hasSecondaryTypes
                  ? <p className="kpi-popover__section-title">Uso principal</p>
                  : null}
                <TypeBreakdownList items={popup.items} />
                {hasSecondaryTypes
                  ? (
                    <>
                      <p className="kpi-popover__section-title">
                        {popup.secondaryTitle || 'Uso complementar'}
                      </p>
                      <TypeBreakdownList items={popup.secondaryItems || []} />
                    </>
                    )
                  : null}
              </>
              )
            : null}

          {!popup.loading && !popup.error && popup.mode === 'types' && !popup.items?.length
            ? <p className="kpi-popover__error">Nenhum dado encontrado.</p>
            : null}

          {!popup.loading && popup.source
            ? (
              <div className="kpi-popover__source">
                <span className="kpi-popover__source-accent" aria-hidden="true" />
                <p className="kpi-popover__source-text">
                  Fonte: <strong>{popup.source}</strong>
                </p>
              </div>
              )
            : null}
        </div>
      </div>
      </div>
      <div className="sihs-page__cards">
        <CardsTelaInicial folderUrl={props.context.folderUrl} />
      </div>
      <KaioChat
        folderUrl={props.context.folderUrl}
        apiUrl={props.config?.chatApiUrl}
      />
    </div>
  )
}

export default Widget
