import { React, type AllWidgetProps } from 'jimu-core'
import {
  setupAuthentication,
  createWebMap,
  createMapView,
  resizeMapView,
  zoomToWhere,
  zoomToGeometry,
  zoomToExtent,
  zoomToLayerExtent,
  queryFirstGeometry,
  queryUnionGeometry,
  highlightWhere,
  highlightGeometry,
  clearHighlight,
  enableMunicipioCustomPopup,
  disableNativePopup,
  zoomToCoordRadius,
  clearCoordMarker,
  type MunicipioPopupData
} from './lib/map'
import { findLayer, findMunicipioLayer, findTerritorioLayer, setTerritorialLayerFocus, territorioLayerWhere } from './lib/layers'
import {
  PAGE_SIZE,
  loadMunicipios,
  municipioWhere,
  territorioWhere,
  formatPopulation,
  normalizeMunName,
  type MunicipioItem
} from './lib/municipios'
import { formatCoordLabel, parseGeoCoordinate } from './lib/coords'
import { applyInfraGeometryFilter, applyInfraLayerScope, chartFilterWhere, emptyCharts, groupSmallChartSlices, layerScopeWhere, loadInfraCharts, type ChartMapFilter, type InfraChart } from './lib/charts'
import {
  ASSET_DEFS,
  ASSET_PAGE_SIZE,
  applyAssetZoomSymbology,
  ativoWhere,
  searchAtivos,
  listAtivosRelatorio,
  isAssetLayer,
  ativoFromFeature,
  hydrateAtivo,
  type AssetType,
  type AtivoItem
} from './lib/ativos'
import {
  SETOR_LAYER_TITLE,
  SETOR_PAGE_SIZE,
  SETOR_TIPOS,
  searchSetores,
  setorWhere,
  isSetorLayer,
  hydrateSetorFromGraphic,
  type SetorItem
} from './lib/setores'
import { loadAssetLegend, legendGroupsForPdf, type AssetLegendGroup } from './lib/legend'
import HeroInfraestrutura from './components/hero-infraestrutura'
import PieChart from './components/pie-chart'
import SistemasMap from './components/sistemas-map'
import AtivoPopup from './components/ativo-popup'
import MapLegend from './components/map-legend'
import PortalLoader from './components/portal-loader'
import { loadPopupRows, popupFieldsForAsset, type PopupRow } from './lib/popup'
import { captureMapView, downloadRelatorioPdf, slugRelatorio } from './lib/relatorio-pdf'
import './style.css'

interface AssetPopupState {
  key: string
  loading: boolean
  rows: PopupRow[]
  error?: string
}

function popupDataFromMunicipio (item: MunicipioItem): MunicipioPopupData {
  return {
    nome: item.name,
    territorio: item.territory || '—',
    semiarido: item.semiarido || '—',
    populacao: item.population,
    codMun: null,
    extraFields: []
  }
}

const COORD_RADIUS_MIN_KM = 1
const COORD_RADIUS_MAX_KM = 100

const { useCallback, useEffect, useMemo, useRef, useState } = React

function withPinnedAtivo (items: AtivoItem[], pinned: AtivoItem | null): AtivoItem[] {
  if (!pinned) return items
  const match = items.find((item) => item.key === pinned.key)
  return [match || pinned, ...items.filter((item) => item.key !== pinned.key)]
}

function withPinnedSetor (items: SetorItem[], pinned: SetorItem | null): SetorItem[] {
  if (!pinned) return items
  const match = items.find((item) => item.key === pinned.key)
  return [match || pinned, ...items.filter((item) => item.key !== pinned.key)]
}

function AtivosList (props: {
  query: string
  municipality: string | null
  territory?: string
  loading: boolean
  items: AtivoItem[]
  page: number
  selectedKey: string | null
  zooming: boolean
  popup: AssetPopupState | null
  folderUrl: string
  onPage: (updater: (value: number) => number) => void
  onSelect: (item: AtivoItem) => void
}) {
  const selectedRef = useRef<HTMLLIElement | null>(null)
  const pageCount = Math.max(1, Math.ceil(props.items.length / ASSET_PAGE_SIZE))
  const currentPage = Math.min(props.page, pageCount - 1)
  const start = currentPage * ASSET_PAGE_SIZE
  const sliced = props.items.slice(start, start + ASSET_PAGE_SIZE)
  const selected = props.selectedKey
    ? props.items.find((item) => item.key === props.selectedKey)
    : null
  const pageItems = selected && !sliced.some((item) => item.key === selected.key)
    ? [selected, ...sliced.slice(0, Math.max(0, ASSET_PAGE_SIZE - 1))]
    : sliced
  const rangeStart = props.items.length ? start + 1 : 0
  const rangeEnd = Math.min(start + ASSET_PAGE_SIZE, props.items.length)

  useEffect(() => {
    if (!props.selectedKey || !props.popup) return
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [props.selectedKey, props.popup])

  const hasFilter = props.query.length >= 2 || Boolean(props.municipality) || Boolean(props.territory) || props.items.length > 0
  let meta = 'Selecione um município, um território, busque um ativo ou clique nele no mapa.'
  const place = props.municipality || props.territory
  if (hasFilter && props.loading) meta = 'Buscando ativos…'
  else if (hasFilter && props.items.length) {
    meta = place
      ? `${rangeStart}–${rangeEnd} de ${props.items.length} em ${place}`
      : `${rangeStart}–${rangeEnd} de ${props.items.length}`
  } else if (hasFilter) {
    meta = place
      ? `Nenhum ativo encontrado em ${place}`
      : 'Nenhum ativo encontrado'
  }

  return (
    <>
      <p className="infra-mun__meta">
        {meta}
        {props.zooming ? ' — aproximando no mapa…' : ''}
      </p>
      {hasFilter && props.loading && !props.items.length
        ? <PortalLoader folderUrl={props.folderUrl} compact label="Buscando ativos" />
        : null}
      <ul className="infra-mun__list">
        {pageItems.map((item) => (
          <li
            key={item.key}
            ref={props.selectedKey === item.key ? selectedRef : undefined}
            className={props.selectedKey === item.key ? 'has-popup' : undefined}
          >
            <button
              type="button"
              className={`infra-mun__item${props.selectedKey === item.key ? ' is-selected' : ''}`}
              onClick={() => props.onSelect(item)}
            >
              <strong className="infra-mun__name">{item.name}</strong>
              <span className="infra-mun__row">
                <em>Tipo</em>
                {item.typeLabel}
              </span>
              <span className="infra-mun__row">
                <em>Município</em>
                {item.municipality}
              </span>
              <span className="infra-mun__row infra-mun__row--coord">
                <em>Coordenada</em>
                <span>
                  {item.coordDms || '—'}
                  {item.coordDecimal
                    ? <small>{item.coordDecimal}</small>
                    : null}
                </span>
              </span>
            </button>
            {props.selectedKey === item.key
              ? (
                <AtivoPopup
                  title={item.name}
                  folderUrl={props.folderUrl}
                  loading={!props.popup || props.popup.loading}
                  error={props.popup?.error}
                  rows={props.popup?.rows || []}
                  onClose={() => props.onSelect(item)}
                />
                )
              : null}
          </li>
        ))}
      </ul>
      {props.items.length
        ? (
          <div className="infra-mun__pager">
            <button
              type="button"
              disabled={currentPage <= 0}
              onClick={() => props.onPage((value) => Math.max(0, value - 1))}
            >
              Anterior
            </button>
            <span>{currentPage + 1} / {pageCount}</span>
            <button
              type="button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => props.onPage((value) => Math.min(pageCount - 1, value + 1))}
            >
              Próxima
            </button>
          </div>
          )
        : null}
    </>
  )
}

function SetoresList (props: {
  query: string
  municipality: string | null
  territory?: string
  loading: boolean
  items: SetorItem[]
  page: number
  selectedKey: string | null
  zooming: boolean
  popup: AssetPopupState | null
  folderUrl: string
  onPage: (updater: (value: number) => number) => void
  onSelect: (item: SetorItem) => void
}) {
  const pageCount = Math.max(1, Math.ceil(props.items.length / SETOR_PAGE_SIZE))
  const currentPage = Math.min(props.page, pageCount - 1)
  const start = currentPage * SETOR_PAGE_SIZE
  const pageItems = props.items.slice(start, start + SETOR_PAGE_SIZE)
  const rangeStart = props.items.length ? start + 1 : 0
  const rangeEnd = Math.min(start + SETOR_PAGE_SIZE, props.items.length)

  const hasFilter = props.query.length >= 2 || Boolean(props.municipality) || Boolean(props.territory)
  let meta = 'Selecione um município, um território ou busque um aglomerado.'
  const place = props.municipality || props.territory
  if (hasFilter && props.loading) meta = 'Buscando aglomerados…'
  else if (hasFilter && props.items.length) {
    meta = place
      ? `${rangeStart}–${rangeEnd} de ${props.items.length} em ${place}`
      : `${rangeStart}–${rangeEnd} de ${props.items.length}`
  } else if (hasFilter) {
    meta = place
      ? `Nenhum aglomerado encontrado em ${place}`
      : 'Nenhum aglomerado encontrado'
  }

  return (
    <>
      <p className="infra-mun__meta">
        {meta}
        {props.zooming ? ' — aproximando no mapa…' : ''}
      </p>
      {hasFilter && props.loading && !props.items.length
        ? <PortalLoader folderUrl={props.folderUrl} compact label="Buscando aglomerados" />
        : null}
      <ul className="infra-mun__list">
        {pageItems.map((item) => (
          <li key={item.key} className={props.selectedKey === item.key && props.popup ? 'has-popup' : undefined}>
            <button
              type="button"
              className={`infra-mun__item${props.selectedKey === item.key ? ' is-selected' : ''}`}
              onClick={() => props.onSelect(item)}
            >
              <strong className="infra-mun__name">{item.name}</strong>
              <span className="infra-mun__row">
                <em>Tipo</em>
                {item.type}
              </span>
              <span className="infra-mun__row">
                <em>Município</em>
                {item.municipality}
              </span>
            </button>
            {props.selectedKey === item.key && props.popup
              ? (
                <AtivoPopup
                  folderUrl={props.folderUrl}
                  loading={props.popup.loading}
                  error={props.popup.error}
                  rows={props.popup.rows}
                />
                )
              : null}
          </li>
        ))}
      </ul>
      {props.items.length
        ? (
          <div className="infra-mun__pager">
            <button
              type="button"
              disabled={currentPage <= 0}
              onClick={() => props.onPage((value) => Math.max(0, value - 1))}
            >
              Anterior
            </button>
            <span>{currentPage + 1} / {pageCount}</span>
            <button
              type="button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => props.onPage((value) => Math.min(pageCount - 1, value + 1))}
            >
              Próxima
            </button>
          </div>
          )
        : null}
    </>
  )
}

const Widget = (props: AllWidgetProps<any>) => {
  const rootRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<any>(null)
  const webMapRef = useRef<any>(null)
  const initialExtentRef = useRef<any>(null)
  const extentBeforeSemiRef = useRef<any>(null)
  const munPopupRef = useRef<HTMLDivElement>(null)
  const munPopupHandleRef = useRef<{ remove: () => void } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [municipios, setMunicipios] = useState<MunicipioItem[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const selectedNameRef = useRef<string | null>(null)
  const selectedAtivoKeyRef = useRef<string | null>(null)
  const clearMunSelectionRef = useRef<() => void>(() => {})
  const selectMunFromMapRef = useRef<(name: string) => void>(() => {})
  const selectAtivoFromMapRef = useRef<(item: AtivoItem) => void>(() => {})
  const selectSetorFromMapRef = useRef<(item: SetorItem) => void>(() => {})
  const deselectAtivoRef = useRef<() => void>(() => {})
  const pinnedAtivoRef = useRef<AtivoItem | null>(null)
  const pinnedSetorRef = useRef<SetorItem | null>(null)
  const selectedSetorKeyRef = useRef<string | null>(null)
  const assetTypeRef = useRef<AssetType>('')
  const savedAssetTypeRef = useRef<AssetType | null>(null)
  const [zooming, setZooming] = useState(false)
  const [filterTerritorio, setFilterTerritorio] = useState('')
  const [semiRegionOn, setSemiRegionOn] = useState(false)
  const [munQuery, setMunQuery] = useState('')
  const [coordQuery, setCoordQuery] = useState('')
  const [coordError, setCoordError] = useState('')
  const [coordHit, setCoordHit] = useState<{
    open: boolean
    lat: number
    lon: number
    label: string
    radiusKm: number | null
  } | null>(null)
  const coordBufferRef = useRef<any>(null)
  const [coordBufferEpoch, setCoordBufferEpoch] = useState(0)
  const radiusTimerRef = useRef(0)
  const radiusRequestRef = useRef(0)
  const [radiusDraft, setRadiusDraft] = useState(COORD_RADIUS_MIN_KM)
  const [listTab, setListTab] = useState<'municipios' | 'ativos' | 'setores'>('municipios')
  const [assetType, setAssetType] = useState<AssetType>('')
  assetTypeRef.current = assetType
  const scopeGeometryRef = useRef<any>(null)
  const [assetQuery, setAssetQuery] = useState('')
  const [assetSearch, setAssetSearch] = useState('')
  const [ativos, setAtivos] = useState<AtivoItem[]>([])
  const [ativosLoading, setAtivosLoading] = useState(false)
  const [selectedAtivoKey, setSelectedAtivoKey] = useState<string | null>(null)
  const [setorQuery, setSetorQuery] = useState('')
  const [setorSearch, setSetorSearch] = useState('')
  const [setorTipo, setSetorTipo] = useState('')
  const [setores, setSetores] = useState<SetorItem[]>([])
  const [setoresLoading, setSetoresLoading] = useState(false)
  const [selectedSetorKey, setSelectedSetorKey] = useState<string | null>(null)
  const [assetPopup, setAssetPopup] = useState<AssetPopupState | null>(null)
  const popupRequestRef = useRef(0)
  const [fonteOpen, setFonteOpen] = useState(false)
  const [legend, setLegend] = useState<AssetLegendGroup[]>([])
  const [legendLoading, setLegendLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [charts, setCharts] = useState<InfraChart[]>(() => emptyCharts('loading'))
  const [chartView, setChartView] = useState<Record<string, string>>({
    reservatorios: 'uso',
    pocos: 'condicao',
    sistemas: 'tipo'
  })
  const [chartFilter, setChartFilter] = useState<ChartMapFilter | null>(null)
  const chartFilterRef = useRef<ChartMapFilter | null>(null)
  const chartFilterReadyRef = useRef(false)
  chartFilterRef.current = chartFilter
  const [munPopup, setMunPopup] = useState<{
    open: boolean
    data: MunicipioPopupData | null
  }>({
    open: false,
    data: null
  })

  const restoreAssetTypeFilter = useCallback(() => {
    if (savedAssetTypeRef.current == null) return
    setAssetType(savedAssetTypeRef.current)
    savedAssetTypeRef.current = null
  }, [])

  const closeAssetPopup = useCallback(() => {
    popupRequestRef.current += 1
    pinnedAtivoRef.current = null
    restoreAssetTypeFilter()
    setAssetPopup(null)
    setSelectedAtivoKey(null)
    selectedAtivoKeyRef.current = null
    setSelectedSetorKey(null)
    selectedSetorKeyRef.current = null
    pinnedSetorRef.current = null
  }, [restoreAssetTypeFilter])

  const closeMunPopup = useCallback(() => {
    setMunPopup((prev) => ({
      ...prev,
      open: false
    }))
  }, [])

  const closeCoordPopup = useCallback(() => {
    setCoordHit((prev) => (prev ? { ...prev, open: false } : prev))
  }, [])

  const clearMunPopup = useCallback(() => {
    setMunPopup({
      open: false,
      data: null
    })
  }, [])

  const reopenMunPopup = useCallback((event?: { stopPropagation?: () => void, preventDefault?: () => void }) => {
    event?.stopPropagation?.()
    event?.preventDefault?.()
    const name = selectedNameRef.current
    setMunPopup((prev) => {
      const sameData = prev.data?.nome && name
        ? prev.data.nome.localeCompare(name, 'pt-BR', { sensitivity: 'accent' }) === 0
        : false
      const item = name
        ? municipios.find((entry) => entry.name.localeCompare(name, 'pt-BR', { sensitivity: 'accent' }) === 0)
        : null
      const data = sameData ? prev.data : item ? popupDataFromMunicipio(item) : prev.data
      if (!data) return prev
      return { open: true, data }
    })
  }, [municipios])

  useEffect(() => {
    if (!selectedName) return
    setMunPopup((prev) => {
      if (prev.data?.nome?.localeCompare(selectedName, 'pt-BR', { sensitivity: 'accent' }) === 0) return prev
      const item = municipios.find((entry) => entry.name.localeCompare(selectedName, 'pt-BR', { sensitivity: 'accent' }) === 0)
      if (!item) return prev
      return { open: prev.open, data: popupDataFromMunicipio(item) }
    })
  }, [selectedName, municipios])

  const openMunPopup = useCallback((data: MunicipioPopupData) => {
    setMunPopup({
      open: true,
      data
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      try {
        await setupAuthentication()
        if (cancelled || !mapRef.current) return

        const webMap = await createWebMap()
        if (cancelled || !mapRef.current) return
        webMapRef.current = webMap

        const view = await createMapView(mapRef.current, webMap)
        if (cancelled) {
          view.destroy?.()
          return
        }
        viewRef.current = view
        initialExtentRef.current = view.extent?.clone?.() || view.extent || null
        await applyAssetZoomSymbology(webMap)
        window.setTimeout(() => {
          if (!viewRef.current) return
          initialExtentRef.current = viewRef.current.extent?.clone?.() || viewRef.current.extent || initialExtentRef.current
        }, 600)
        setTerritorialLayerFocus(webMap, 'all')
        setLoading(false)

        disableNativePopup(view, webMap)

        const layer = findMunicipioLayer(webMap)
        if (!layer) {
          setListError('Camada PDA_Indicadores_Censo_2022 não encontrada.')
          return
        }

        if (mapRef.current) {
          munPopupHandleRef.current = enableMunicipioCustomPopup(view, {
            viewContainer: mapRef.current,
            webMap,
            layer,
            onOpen: (data) => {
              openMunPopup(data)
              if (data?.nome) selectMunFromMapRef.current(data.nome)
            },
            onClose: closeMunPopup,
            isSelected: (name) => {
              if (selectedAtivoKeyRef.current || selectedSetorKeyRef.current) return false
              const current = selectedNameRef.current
              if (!current || !name) return false
              return current.localeCompare(name, 'pt-BR', { sensitivity: 'accent' }) === 0
            },
            isAssetSelected: () => Boolean(selectedAtivoKeyRef.current),
            isSetorSelected: () => Boolean(selectedSetorKeyRef.current),
            onDeselect: () => { clearMunSelectionRef.current() },
            isAssetLayer,
            onAssetHit: (_layer, graphic) => {
              const item = ativoFromFeature(_layer, graphic)
              if (!item) return
              selectAtivoFromMapRef.current(item)
            },
            onAssetDeselect: () => { deselectAtivoRef.current() },
            isSetorLayer,
            onSetorHit: async (_layer, graphic) => {
              const item = await hydrateSetorFromGraphic(_layer, graphic)
              if (!item) return false
              selectSetorFromMapRef.current(item)
              return true
            }
          })
        }

        const items = await loadMunicipios(layer)
        if (!cancelled) setMunicipios(items)
      } catch (err) {
        console.error('[infra-page] Falha ao carregar o mapa:', err)
        if (!cancelled) {
          setError((err as any)?.message || 'Não foi possível carregar o mapa.')
          setLoading(false)
        }
      }
    }

    init()

    return () => {
      cancelled = true
      munPopupHandleRef.current?.remove?.()
      munPopupHandleRef.current = null
      clearHighlight(viewRef.current)
      viewRef.current?.destroy?.()
      viewRef.current = null
      webMapRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, [])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      void resizeMapView(viewRef.current)
    })
    observer.observe(root)
    if (mapRef.current) observer.observe(mapRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!munPopup.open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMunPopup()
    }

    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (munPopupRef.current?.contains(target)) return
      if (mapRef.current?.contains(target)) return
      closeMunPopup()
    }

    document.addEventListener('keydown', onKeyDown)
    const handle = window.setTimeout(() => {
      document.addEventListener('click', onDocClick)
    }, 0)

    return () => {
      window.clearTimeout(handle)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onDocClick)
    }
  }, [munPopup.open, closeMunPopup])

  useEffect(() => {
    if (!assetPopup?.key) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') deselectAtivoRef.current()
    }

    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      const listWrap = rootRef.current
      if (!listWrap) return
      if (listWrap.contains(target)) return
      deselectAtivoRef.current()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('click', onDocClick)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onDocClick)
    }
  }, [assetPopup?.key, closeAssetPopup])

  useEffect(() => {
    if (listTab !== 'municipios') return
    if (!selectedAtivoKeyRef.current && !selectedSetorKeyRef.current) return
    deselectAtivoRef.current()
  }, [listTab])

  useEffect(() => {
    if (!assetPopup?.key) return
    if (selectedAtivoKey || selectedSetorKey) return
    closeAssetPopup()
  }, [page, assetPopup?.key, selectedAtivoKey, selectedSetorKey, closeAssetPopup])

  const territorios = useMemo(() => {
    const names = new Set<string>()
    for (const item of municipios) {
      if (item.territory && item.territory !== '—') names.add(item.territory)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [municipios])

  const normalizeSearch = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()

  const territorialMunicipios = useMemo(() => {
    return municipios.filter((item) => {
      if (filterTerritorio && item.territory !== filterTerritorio) return false
      if (semiRegionOn && item.semiarido !== 'Sim' && !item.forcedSemiarido) return false
      return true
    })
  }, [municipios, filterTerritorio, semiRegionOn])

  const filteredMunicipios = useMemo(() => {
    const query = normalizeSearch(munQuery)
    if (!query) return territorialMunicipios
    return territorialMunicipios.filter((item) => normalizeSearch(item.name).includes(query))
  }, [territorialMunicipios, munQuery])

  const pageCount = Math.max(1, Math.ceil(filteredMunicipios.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageItems = useMemo(() => {
    const start = currentPage * PAGE_SIZE
    return filteredMunicipios.slice(start, start + PAGE_SIZE)
  }, [filteredMunicipios, currentPage])

  const rangeStart = filteredMunicipios.length ? currentPage * PAGE_SIZE + 1 : 0
  const rangeEnd = Math.min((currentPage + 1) * PAGE_SIZE, filteredMunicipios.length)
  const filteredNames = useMemo(
    () => territorialMunicipios.map((item) => item.name),
    [territorialMunicipios]
  )
  const hasCoordZone = Boolean(coordHit?.radiusKm && coordBufferEpoch > 0)
  const scoped = Boolean(selectedName || filterTerritorio || semiRegionOn || hasCoordZone)
  const filterSemiarido = semiRegionOn ? 'SIM' : ''
  const territorialKey = `${selectedName || ''}|${filterTerritorio}|${filterSemiarido}|${filteredNames.join(',')}|${hasCoordZone ? `${coordHit?.lat},${coordHit?.lon},${coordHit?.radiusKm},${coordBufferEpoch}` : ''}`
  const lastTerritorialRef = useRef('')

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setAssetSearch(assetQuery.trim())
      setPage(0)
    }, 350)
    return () => window.clearTimeout(handle)
  }, [assetQuery])

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSetorSearch(setorQuery.trim())
      setPage(0)
    }, 350)
    return () => window.clearTimeout(handle)
  }, [setorQuery])

  useEffect(() => {
    const webMap = webMapRef.current
    if (!webMap || loading) return

    let cancelled = false
    const scope = {
      selectedName,
      filterTerritorio,
      filterSemiarido,
      filteredNames,
      assetType,
      searchText: assetSearch,
      setorSearch,
      setorTipo,
      geometry: hasCoordZone ? coordBufferRef.current : null,
      chartFilter: chartFilterRef.current
    }
    const reloadCharts = lastTerritorialRef.current !== territorialKey
    if (reloadCharts) {
      lastTerritorialRef.current = territorialKey
      setCharts(emptyCharts('loading'))
    }

    const run = async () => {
      if (reloadCharts) {
        const [, next] = await Promise.all([
          applyInfraLayerScope(webMap, { ...scope, searchText: '' }),
          loadInfraCharts(webMap, scope)
        ])
        if (!cancelled) setCharts(next)
        if (scope.searchText) await applyInfraLayerScope(webMap, scope)
      } else {
        await applyInfraLayerScope(webMap, scope)
      }
      if (hasCoordZone && coordBufferRef.current) {
        await applyInfraGeometryFilter(viewRef.current, webMap, coordBufferRef.current)
      }
      if (!cancelled) setLegendLoading(true)
      try {
        const nextLegend = await loadAssetLegend(webMap, (layer) => layerScopeWhere(layer, {
          selectedName,
          filterTerritorio,
          filterSemiarido,
          filteredNames,
          scoped,
          geometry: hasCoordZone ? coordBufferRef.current : null
        }))
        if (!cancelled) setLegend(nextLegend)
      } catch (err) {
        console.error('[infra-page] Falha ao carregar legenda:', err)
        if (!cancelled) setLegend([])
      } finally {
        if (!cancelled) setLegendLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [loading, selectedName, filterTerritorio, filterSemiarido, filteredNames, assetType, assetSearch, setorSearch, setorTipo, territorialKey, hasCoordZone])

  useEffect(() => {
    if (!chartFilterReadyRef.current) {
      chartFilterReadyRef.current = true
      return
    }
    const webMap = webMapRef.current
    if (!webMap || loading) return
    void applyInfraLayerScope(webMap, {
      selectedName,
      filterTerritorio,
      filterSemiarido,
      filteredNames,
      assetType,
      searchText: assetSearch,
      setorSearch,
      setorTipo,
      geometry: coordBufferRef.current,
      chartFilter
    })
  }, [chartFilter])

  useEffect(() => {
    const webMap = webMapRef.current
    if (!webMap || loading) return

    if (assetSearch.length < 2 && !selectedName && !filterTerritorio && !hasCoordZone && !chartFilter) {
      setAtivos(withPinnedAtivo([], pinnedAtivoRef.current))
      setAtivosLoading(false)
      return
    }

    let cancelled = false
    setAtivosLoading(true)

    const run = async () => {
      try {
        const items = await searchAtivos(webMap, {
          searchText: assetSearch,
          assetType: chartFilter?.chartId ? chartFilter.chartId as AssetType : assetType,
          selectedName,
          territorialScope: Boolean(filterTerritorio || hasCoordZone || chartFilter),
          geometry: hasCoordZone ? coordBufferRef.current : null,
          territorialWhere: (layer) => {
            const territorial = layerScopeWhere(layer, {
              selectedName,
              filterTerritorio,
              filterSemiarido,
              filteredNames,
              scoped,
              geometry: hasCoordZone ? coordBufferRef.current : null
            })
            const slice = chartFilterWhere(layer, chartFilter)
            if (!slice) return territorial
            if (!territorial || territorial === '1=1') return slice
            return `(${territorial}) AND (${slice})`
          }
        })
        if (!cancelled) setAtivos(withPinnedAtivo(items, pinnedAtivoRef.current))
      } catch (err) {
        console.error('[infra-page] Falha ao buscar ativos:', err)
        if (!cancelled) setAtivos([])
      } finally {
        if (!cancelled) setAtivosLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [loading, assetSearch, assetType, selectedName, filterTerritorio, filterSemiarido, filteredNames, scoped, hasCoordZone, coordBufferEpoch, chartFilter])

  useEffect(() => {
    const webMap = webMapRef.current
    if (!webMap || loading) return

    if (setorSearch.length < 2 && !selectedName && !filterTerritorio && !hasCoordZone) {
      setSetores(withPinnedSetor([], pinnedSetorRef.current))
      setSetoresLoading(false)
      return
    }

    let cancelled = false
    setSetoresLoading(true)

    const run = async () => {
      try {
        const items = await searchSetores(webMap, {
          searchText: setorSearch,
          tipo: setorTipo,
          selectedName,
          territorialScope: Boolean(filterTerritorio || hasCoordZone),
          geometry: hasCoordZone ? coordBufferRef.current : null,
          territorialWhere: (layer) => layerScopeWhere(layer, {
            selectedName,
            filterTerritorio,
            filterSemiarido,
            filteredNames,
            scoped,
            geometry: hasCoordZone ? coordBufferRef.current : null
          })
        })
        if (!cancelled) setSetores(withPinnedSetor(items, pinnedSetorRef.current))
      } catch (err) {
        console.error('[infra-page] Falha ao buscar setores:', err)
        if (!cancelled) setSetores([])
      } finally {
        if (!cancelled) setSetoresLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [loading, setorSearch, setorTipo, selectedName, filterTerritorio, filterSemiarido, filteredNames, scoped, hasCoordZone, coordBufferEpoch])

  const applyScope = useCallback(async (
    selected: string | null,
    overrides?: { filterTerritorio?: string, filteredNames?: string[] }
  ) => {
    const webMap = webMapRef.current
    if (!webMap) return
    await applyInfraLayerScope(webMap, {
      selectedName: selected,
      filterTerritorio: overrides?.filterTerritorio ?? filterTerritorio,
      filterSemiarido,
      filteredNames: overrides?.filteredNames ?? filteredNames,
      assetType,
      searchText: assetSearch,
      setorSearch,
      setorTipo,
      geometry: coordBufferRef.current,
      chartFilter
    })
  }, [filterTerritorio, filterSemiarido, filteredNames, assetType, assetSearch, setorSearch, setorTipo, chartFilter])

  const focusMunicipio = useCallback(async (name: string) => {
    const view = viewRef.current
    const webMap = webMapRef.current
    if (!view || !webMap) return false
    coordBufferRef.current = null
    setCoordBufferEpoch(0)
    setCoordHit(null)
    clearCoordMarker(view)
    const layer = findMunicipioLayer(webMap)
    if (!layer) return false
    const where = municipioWhere(name)
    setSemiRegionOn(false)
    setTerritorialLayerFocus(webMap, 'municipio')
    await applyScope(name)
    const geometry = await queryFirstGeometry(layer, where)
    scopeGeometryRef.current = geometry
    await applyInfraGeometryFilter(view, webMap, geometry)
    await highlightWhere(view, layer, where, { outlineOnly: true })
    await zoomToWhere(view, layer, where)
    return true
  }, [applyScope])

  const toggleSemiRegion = useCallback(() => {
    const next = !semiRegionOn
    setSemiRegionOn(next)
    const webMap = webMapRef.current
    const view = viewRef.current
    if (next) {
      extentBeforeSemiRef.current = view?.extent?.clone?.() || view?.extent || initialExtentRef.current
      const { semi } = setTerritorialLayerFocus(webMap, 'semiarido')
      if (semi && !selectedName) {
        void highlightWhere(view, semi, '1=1', {
          outlineOnly: true,
          maxFeatures: 1,
          theme: 'semiarido'
        })
      }
      if (!semi || selectedName || filterTerritorio) return
      void zoomToLayerExtent(view, semi, 1.45)
      return
    }
    clearHighlight(view)
    if (selectedName) {
      setTerritorialLayerFocus(webMap, 'municipio')
      void focusMunicipio(selectedName)
      return
    }
    if (filterTerritorio) {
      setTerritorialLayerFocus(webMap, 'territorio')
    } else {
      setTerritorialLayerFocus(webMap, 'all')
    }
    const target = extentBeforeSemiRef.current || initialExtentRef.current
    if (view && target) {
      void zoomToExtent(view, target)
    }
  }, [semiRegionOn, selectedName, filterTerritorio, focusMunicipio])

  const focusArea = useCallback(async (territorio: string) => {
    const view = viewRef.current
    const webMap = webMapRef.current
    if (!view || !webMap || !territorio) return false
    coordBufferRef.current = null
    setCoordBufferEpoch(0)
    setCoordHit(null)
    clearCoordMarker(view)
    const layer = findMunicipioLayer(webMap)
    if (!layer) return false
    const where = territorioWhere(territorio)
    const names = municipios
      .filter((item) => item.territory === territorio)
      .map((item) => item.name)
    await applyScope(null, { filterTerritorio: territorio, filteredNames: names })
    setSemiRegionOn(false)
    const { ti } = setTerritorialLayerFocus(webMap, 'territorio')
    let geometry: any = null
    if (ti) {
      try { await ti.load?.() } catch (_) {}
      geometry = await queryFirstGeometry(ti, territorioLayerWhere(ti, territorio))
    }
    if (!geometry) geometry = await queryUnionGeometry(layer, where)
    scopeGeometryRef.current = geometry
    await applyInfraGeometryFilter(view, webMap, geometry)
    if (geometry) {
      await highlightGeometry(view, geometry, { outlineOnly: true })
      await zoomToGeometry(view, geometry)
    } else {
      clearHighlight(view)
      await zoomToWhere(view, layer, where)
    }
    return true
  }, [applyScope, municipios])

  const restoreScopeView = useCallback(async (options?: {
    municipality?: string | null
    territorio?: string
  }) => {
    const municipality = options && 'municipality' in options ? options.municipality : selectedName
    const territorio = options && 'territorio' in options ? options.territorio : filterTerritorio
    const view = viewRef.current
    const webMap = webMapRef.current
    if (!municipality && !territorio && coordBufferRef.current && coordHit?.radiusKm) {
      clearHighlight(view)
      await applyInfraGeometryFilter(view, webMap, coordBufferRef.current)
      const extent = coordBufferRef.current.extent
      if (view && extent) {
        await zoomToExtent(view, typeof extent.expand === 'function' ? extent.expand(1.2) : extent)
      }
      return
    }
    if (!municipality && !territorio) {
      scopeGeometryRef.current = null
      await applyInfraGeometryFilter(view, webMap, null)
      if (!semiRegionOn) setTerritorialLayerFocus(webMap, 'all')
    }
    if (municipality) {
      const ok = await focusMunicipio(municipality)
      if (ok) return
    }
    if (territorio) {
      const ok = await focusArea(territorio)
      if (ok) return
    }
    if (semiRegionOn) {
      const { semi } = setTerritorialLayerFocus(webMap, 'semiarido')
      if (semi) {
        void highlightWhere(view, semi, '1=1', {
          outlineOnly: true,
          maxFeatures: 1,
          theme: 'semiarido'
        })
      }
      if (view && (extentBeforeSemiRef.current || initialExtentRef.current)) {
        await zoomToExtent(view, extentBeforeSemiRef.current || initialExtentRef.current)
      }
      return
    }
    clearHighlight(view)
    if (view && initialExtentRef.current) {
      await zoomToExtent(view, initialExtentRef.current)
    }
  }, [selectedName, filterTerritorio, focusMunicipio, focusArea, semiRegionOn, coordHit?.radiusKm])

  const deselectAtivoKeepScope = useCallback(async () => {
    const requestId = ++popupRequestRef.current
    pinnedAtivoRef.current = null
    selectedAtivoKeyRef.current = null
    selectedSetorKeyRef.current = null
    restoreAssetTypeFilter()
    clearHighlight(viewRef.current)
    if (assetSearch.length < 2 && !selectedNameRef.current && !filterTerritorio && !coordBufferRef.current) setAtivos([])
    setAssetPopup(null)
    setSelectedAtivoKey(null)
    setSelectedSetorKey(null)
    pinnedSetorRef.current = null
    setZooming(true)
    try {
      await restoreScopeView()
      if (popupRequestRef.current !== requestId) return
      if (selectedNameRef.current) setListTab('municipios')
    } catch (err) {
      console.error('[infra-page] Falha ao voltar ao recorte:', err)
    } finally {
      if (popupRequestRef.current === requestId) setZooming(false)
    }
  }, [assetSearch, filterTerritorio, restoreScopeView, restoreAssetTypeFilter])

  deselectAtivoRef.current = () => { void deselectAtivoKeepScope() }

  const clearSelection = useCallback(async () => {
    selectedNameRef.current = null
    scopeGeometryRef.current = null
    setSelectedName(null)
    closeAssetPopup()
    clearMunPopup()
    const view = viewRef.current
    setZooming(true)
    try {
      await applyInfraGeometryFilter(view, webMapRef.current, null)
      await applyScope(null)
      await restoreScopeView({ municipality: null })
    } catch (err) {
      console.error('[infra-page] Falha ao limpar seleção:', err)
    } finally {
      setZooming(false)
    }
  }, [closeAssetPopup, clearMunPopup, restoreScopeView, applyScope])

  clearMunSelectionRef.current = () => { void clearSelection() }

  const handleSelectAtivo = useCallback(async (item: AtivoItem) => {
    const view = viewRef.current
    const webMap = webMapRef.current
    if (!view || !webMap) return

    if (selectedAtivoKeyRef.current === item.key) {
      await deselectAtivoKeepScope()
      return
    }

    selectedAtivoKeyRef.current = item.key
    pinnedAtivoRef.current = item
    setSelectedAtivoKey(item.key)
    setSelectedSetorKey(null)
    selectedSetorKeyRef.current = null
    pinnedSetorRef.current = null
    setListTab('ativos')
    setPage(0)
    setAtivos((prev) => withPinnedAtivo(prev, item))
    closeMunPopup()
    const requestId = ++popupRequestRef.current
    setAssetPopup({ key: item.key, loading: true, rows: [] })
    setZooming(true)
    try {
      const layer = findLayer(webMap, {
        layerId: item.layerId,
        layerTitle: item.layerTitle
      })
      if (!layer) {
        if (popupRequestRef.current === requestId) {
          setAssetPopup({
            key: item.key,
            loading: false,
            rows: [],
            error: 'Camada do ativo não encontrada.'
          })
        }
        return
      }
      layer.visible = true
      const where = ativoWhere(item)
      const [rows] = await Promise.all([
        loadPopupRows(webMap, {
          layerTitle: item.layerTitle,
          layerId: item.layerId,
          where: ativoWhere(item),
          objectId: item.oid,
          fields: popupFieldsForAsset(item.type)
        }),
        highlightWhere(view, layer, where).then(async () => {
          if (popupRequestRef.current !== requestId) return
          const closeZoom = { scale: 2000 }
          if (item.geometry) {
            await zoomToGeometry(view, item.geometry, closeZoom)
          } else {
            await zoomToWhere(view, layer, where, closeZoom)
          }
          if (popupRequestRef.current !== requestId) {
            await restoreScopeView()
          }
        })
      ])
      if (popupRequestRef.current !== requestId) return
      let detail = item
      if (!item.coordDms) {
        detail = await hydrateAtivo(webMap, item)
        if (popupRequestRef.current !== requestId) return
        pinnedAtivoRef.current = detail
        setAtivos((prev) => withPinnedAtivo(prev, detail))
      }
      const coordValue = detail.coordDms
        ? (detail.coordDecimal ? `${detail.coordDms}  (${detail.coordDecimal})` : detail.coordDms)
        : ''
      const header = [
        { label: 'Tipo', value: detail.typeLabel },
        { label: 'Município', value: detail.municipality },
        { label: 'Coordenada geográfica', value: coordValue || '—' }
      ].filter((row) => row.label === 'Coordenada geográfica' || (row.value && row.value !== '—'))
      const known = new Set(rows.map((row) => row.label))
      setAssetPopup({
        key: item.key,
        loading: false,
        rows: [...header.filter((row) => !known.has(row.label)), ...rows]
      })
    } catch (err) {
      console.error('[infra-page] Falha ao zoomar ativo:', err)
      if (popupRequestRef.current !== requestId) return
      setAssetPopup({
        key: item.key,
        loading: false,
        rows: [],
        error: 'Não foi possível carregar os detalhes deste ativo.'
      })
    } finally {
      if (popupRequestRef.current === requestId) setZooming(false)
    }
  }, [selectedAtivoKey, deselectAtivoKeepScope, closeMunPopup, restoreScopeView])

  selectAtivoFromMapRef.current = (item: AtivoItem) => {
    if (selectedAtivoKeyRef.current === item.key) {
      void deselectAtivoKeepScope()
      return
    }
    if (savedAssetTypeRef.current == null) {
      savedAssetTypeRef.current = assetTypeRef.current
    }
    pinnedAtivoRef.current = item
    setListTab('ativos')
    setAssetType(item.type)
    setAssetQuery('')
    setAssetSearch('')
    setPage(0)
    setAtivos((prev) => withPinnedAtivo(prev, item))
    void handleSelectAtivo(item)
    const webMap = webMapRef.current
    if (!webMap) return
    void hydrateAtivo(webMap, item).then((next) => {
      if (selectedAtivoKeyRef.current !== item.key && selectedAtivoKeyRef.current !== next.key) return
      pinnedAtivoRef.current = next
      setAtivos((prev) => withPinnedAtivo(prev, next))
    })
  }

  const handleSelectSetor = useCallback(async (item: SetorItem) => {
    const view = viewRef.current
    const webMap = webMapRef.current
    if (!view || !webMap) return

    if (selectedSetorKeyRef.current === item.key && !selectedAtivoKeyRef.current) {
      await deselectAtivoKeepScope()
      return
    }

    selectedSetorKeyRef.current = item.key
    pinnedSetorRef.current = item
    setSelectedSetorKey(item.key)
    setSelectedAtivoKey(null)
    selectedAtivoKeyRef.current = null
    pinnedAtivoRef.current = null
    setListTab('setores')
    setPage(0)
    setSetores((prev) => withPinnedSetor(prev, item))
    closeMunPopup()
    const requestId = ++popupRequestRef.current
    setAssetPopup({ key: item.key, loading: true, rows: [] })
    setZooming(true)
    try {
      const layer = findLayer(webMap, { layerTitle: SETOR_LAYER_TITLE })
      if (!layer) {
        if (popupRequestRef.current === requestId) {
          setAssetPopup({
            key: item.key,
            loading: false,
            rows: [],
            error: 'Camada de setores não encontrada.'
          })
        }
        return
      }
      layer.visible = true
      const where = setorWhere(item)
      const [rows] = await Promise.all([
        loadPopupRows(webMap, {
          layerTitle: SETOR_LAYER_TITLE,
          where,
          fields: popupFieldsForAsset('setores')
        }),
        highlightWhere(view, layer, where).then(async () => {
          await zoomToWhere(view, layer, where)
        })
      ])
      if (popupRequestRef.current !== requestId) return
      const header = [
        { label: 'Tipo', value: item.type },
        { label: 'Município', value: item.municipality }
      ].filter((row) => row.value && row.value !== '—')
      const known = new Set(rows.map((row) => row.label))
      setAssetPopup({
        key: item.key,
        loading: false,
        rows: [...header.filter((row) => !known.has(row.label)), ...rows]
      })
    } catch (err) {
      console.error('[infra-page] Falha ao zoomar setor:', err)
      if (popupRequestRef.current !== requestId) return
      setAssetPopup({
        key: item.key,
        loading: false,
        rows: [],
        error: 'Não foi possível carregar os detalhes deste setor.'
      })
    } finally {
      setZooming(false)
    }
  }, [deselectAtivoKeepScope, closeMunPopup])

  selectSetorFromMapRef.current = (item: SetorItem) => {
    if (selectedSetorKeyRef.current === item.key && !selectedAtivoKeyRef.current) {
      void deselectAtivoKeepScope()
      return
    }
    pinnedSetorRef.current = item
    setListTab('setores')
    setPage(0)
    setSetores((prev) => withPinnedSetor(prev, item))
    void handleSelectSetor(item)
  }

  const handleSelect = useCallback(async (item: MunicipioItem) => {
    if (
      selectedName &&
      selectedName.localeCompare(item.name, 'pt-BR', { sensitivity: 'accent' }) === 0
    ) {
      if (selectedAtivoKeyRef.current) {
        await deselectAtivoKeepScope()
        return
      }
      await clearSelection()
      return
    }

    const view = viewRef.current
    const webMap = webMapRef.current
    if (!view || !webMap) return

    selectedNameRef.current = item.name
    setSelectedName(item.name)
    closeAssetPopup()
    setMunPopup((prev) => {
      const same = prev.data?.nome
        ? prev.data.nome.localeCompare(item.name, 'pt-BR', { sensitivity: 'accent' }) === 0
        : false
      if (same || prev.open) return prev
      return { open: false, data: popupDataFromMunicipio(item) }
    })
    setListTab('municipios')
    setPage(0)
    setZooming(true)
    try {
      await focusMunicipio(item.name)
    } catch (err) {
      console.error('[infra-page] Falha ao zoomar município:', err)
    } finally {
      setZooming(false)
    }
  }, [selectedName, clearSelection, focusMunicipio, closeAssetPopup, deselectAtivoKeepScope])

  const applyNearbyRadius = useCallback(async (
    km: number,
    hit = coordHit,
    options?: { live?: boolean }
  ) => {
    const view = viewRef.current
    const webMap = webMapRef.current
    if (!hit || !view || !webMap) return

    const radius = Math.min(COORD_RADIUS_MAX_KM, Math.max(COORD_RADIUS_MIN_KM, Math.round(km)))
    const requestId = ++radiusRequestRef.current
    selectedNameRef.current = null
    setSelectedName(null)
    clearMunPopup()
    closeAssetPopup()
    setFilterTerritorio('')
    setSemiRegionOn(false)
    setTerritorialLayerFocus(webMap, 'municipio')
    if (!options?.live) {
      pinnedAtivoRef.current = null
      setAtivos([])
      setSetores([])
    }
    if (!coordBufferRef.current) {
      setListTab('ativos')
      setPage(0)
    }
    if (!options?.live) setZooming(true)
    try {
      const geometry = await zoomToCoordRadius(view, hit.lon, hit.lat, radius, {
        duration: options?.live ? 0 : 700,
        fit: !options?.live
      })
      if (requestId !== radiusRequestRef.current) return
      if (!geometry) {
        setCoordError('Não foi possível desenhar esse raio no mapa.')
        return
      }
      coordBufferRef.current = geometry
      setCoordBufferEpoch((value) => value + 1)
      scopeGeometryRef.current = geometry
      await applyInfraGeometryFilter(view, webMap, geometry)
      if (requestId !== radiusRequestRef.current) return
      await applyScope(null, { filterTerritorio: '', filteredNames: [] })
      if (requestId !== radiusRequestRef.current) return
      setCoordHit({ ...hit, open: true, radiusKm: radius })
      setRadiusDraft(radius)
    } catch (err) {
      if (requestId !== radiusRequestRef.current) return
      console.error('[infra-page] Falha ao aplicar raio da coordenada:', err)
      setCoordError('Não foi possível visualizar a infraestrutura nesse raio.')
    } finally {
      if (requestId === radiusRequestRef.current && !options?.live) setZooming(false)
    }
  }, [coordHit, clearMunPopup, closeAssetPopup, applyScope])

  const scheduleNearbyRadius = useCallback((km: number) => {
    const radius = Math.min(COORD_RADIUS_MAX_KM, Math.max(COORD_RADIUS_MIN_KM, Number(km) || COORD_RADIUS_MIN_KM))
    setRadiusDraft(radius)
    window.clearTimeout(radiusTimerRef.current)
    radiusTimerRef.current = window.setTimeout(() => {
      void applyNearbyRadius(radius, coordHit, { live: true })
    }, 160)
  }, [applyNearbyRadius, coordHit])

  const goToCoordinate = useCallback(async (raw?: string) => {
    const query = typeof raw === 'string' ? raw : coordQuery
    const parsed = parseGeoCoordinate(query)
    if (!parsed) {
      setCoordError(query.trim()
        ? 'Coordenada inválida. Use graus, minutos e segundos ou decimal.'
        : '')
      return
    }

    const view = viewRef.current
    if (!view) {
      setCoordError('O mapa ainda está carregando.')
      return
    }

    setCoordError('')
    closeMunPopup()
    closeAssetPopup()
    selectedNameRef.current = null
    setSelectedName(null)
    clearMunPopup()
    pinnedAtivoRef.current = null
    pinnedSetorRef.current = null
    setSelectedAtivoKey(null)
    selectedAtivoKeyRef.current = null
    setSelectedSetorKey(null)
    selectedSetorKeyRef.current = null
    setAtivos([])
    setSetores([])
    coordBufferRef.current = null
    setCoordBufferEpoch(0)
    const hit = {
      open: true,
      lat: parsed.lat,
      lon: parsed.lon,
      label: formatCoordLabel(parsed),
      radiusKm: null as number | null
    }
    setCoordHit(hit)
    setRadiusDraft(COORD_RADIUS_MIN_KM)
    setZooming(true)
    try {
      await applyScope(null, { filterTerritorio: filterTerritorio || '', filteredNames })
      await applyInfraGeometryFilter(view, webMapRef.current, null)
      await applyNearbyRadius(COORD_RADIUS_MIN_KM, hit)
    } catch (err) {
      console.error('[infra-page] Falha ao ir até a coordenada:', err)
      setCoordError('Não foi possível ir até essa coordenada.')
    } finally {
      setZooming(false)
    }
  }, [coordQuery, closeMunPopup, closeAssetPopup, clearMunPopup, applyScope, filterTerritorio, filteredNames, applyNearbyRadius])

  selectMunFromMapRef.current = (name: string) => {
    const wanted = normalizeMunName(name)
    if (!wanted) return
    if (selectedAtivoKeyRef.current) {
      void deselectAtivoKeepScope()
      return
    }
    const current = selectedNameRef.current
    if (current && normalizeMunName(current) === wanted) return
    const item = municipios.find((entry) => normalizeMunName(entry.name) === wanted)
    if (item) {
      void handleSelect(item)
      return
    }
    selectedNameRef.current = name
    setSelectedName(name)
    closeAssetPopup()
    setListTab('municipios')
    setPage(0)
    void focusMunicipio(name)
  }

  const scopeLabel = useMemo(() => {
    if (hasCoordZone && coordHit) {
      return `Coordenada geográfica — raio de ${coordHit.radiusKm} km`
    }
    if (selectedName) return `Município — ${selectedName}`
    if (filterTerritorio) return `Território de Identidade — ${filterTerritorio}`
    if (semiRegionOn) return 'Região Semiárida'
    return `Estado da Bahia — ${municipios.length} municípios`
  }, [hasCoordZone, coordHit, selectedName, filterTerritorio, semiRegionOn, municipios.length])

  const exportPdf = useCallback(async () => {
    if (exporting || loading) return
    if (charts.some((chart) => chart.views.some((view) => view.status === 'loading'))) {
      window.alert('Aguarde os indicadores carregarem para gerar o relatório.')
      return
    }
    setExporting(true)
    try {
      const coordGeometry = hasCoordZone ? coordBufferRef.current : null
      const scoped = selectedName
        ? municipios.filter((item) => item.name === selectedName)
        : territorialMunicipios
      const webMap = webMapRef.current
      const listLimit = selectedName ? 18 : 80
      const assetLists = webMap
        ? await listAtivosRelatorio(webMap, {
            selectedName: coordGeometry ? null : selectedName,
            geometry: coordGeometry,
            maxPerKind: listLimit,
            territorialWhere: (layer) => layerScopeWhere(layer, {
              selectedName: coordGeometry ? null : selectedName,
              filterTerritorio: coordGeometry ? '' : filterTerritorio,
              filterSemiarido: coordGeometry ? undefined : filterSemiarido,
              filteredNames: coordGeometry ? [] : filteredNames,
              geometry: coordGeometry,
              scoped: Boolean(coordGeometry || selectedName || filterTerritorio || semiRegionOn)
            })
          })
        : { pocos: [], sistemas: [], truncated: { pocos: false, sistemas: false } }
      const countByType = (rows: Array<{ assetType: string }>) => {
        const counts = new Map<string, number>()
        for (const row of rows) counts.set(row.assetType, (counts.get(row.assetType) || 0) + 1)
        return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
      }
      const population = scoped.reduce((sum, item) => sum + (item.population || 0), 0)
      const semiCount = scoped.filter((item) => {
        const normalized = String(item.semiarido || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase()
        return normalized === 'SIM' || Boolean(item.forcedSemiarido)
      }).length
      const palettes: Record<string, string[]> = {
        reservatorios: ['#002231', '#0a4a58', '#0d6b7a', '#128a9c', '#1aa8c8', '#3eb8d4', '#6dcae0', '#9edbeb'],
        pocos: ['#14352c', '#1c4f40', '#246655', '#2d8268', '#3a9a78', '#5bb08c', '#84c5a6', '#b3dcc8'],
        sistemas: ['#001a2e', '#02364d', '#055a78', '#0a7fa3', '#1aa8c8', '#2fc4ff', '#6dd4ff', '#a8e6ff']
      }
      const sections: Array<{
        title: string
        note?: string
        bars?: Array<{ label: string, value: string, pct: number, color: string }>
        table?: { headers: string[], rows: string[][], colWeights?: number[] }
      }> = []
      if (assetLists.pocos.length) {
        sections.push(selectedName
          ? {
              title: 'Poços no recorte',
              note: assetLists.truncated.pocos ? 'Lista limitada aos primeiros registros.' : undefined,
              table: {
                headers: ['Localidade', 'Tipo de ativo'],
                colWeights: [1.2, 1.4],
                rows: assetLists.pocos.map((row) => [row.locality, row.assetType])
              }
            }
          : {
              title: 'Poços no recorte — por tipo',
              note: 'Resumo por tipo de ativo (ex.: Poço aproveitável).',
              table: {
                headers: ['Tipo de ativo', 'Quantidade'],
                colWeights: [2, 0.7],
                rows: countByType(assetLists.pocos).map(([label, total]) => [label, formatPopulation(total)])
              }
            })
      }
      if (assetLists.sistemas.length) {
        sections.push(selectedName
          ? {
              title: 'Sistemas de abastecimento no recorte',
              note: assetLists.truncated.sistemas ? 'Lista limitada aos primeiros registros.' : undefined,
              table: {
                headers: ['Localidade', 'Tipo de ativo'],
                colWeights: [1.2, 1.4],
                rows: assetLists.sistemas.map((row) => [row.locality, row.assetType])
              }
            }
          : {
              title: 'Sistemas no recorte — por tipo',
              note: 'Resumo por tipo de ativo (ex.: Sistema simplificado).',
              table: {
                headers: ['Tipo de ativo', 'Quantidade'],
                colWeights: [2, 0.7],
                rows: countByType(assetLists.sistemas).map(([label, total]) => [label, formatPopulation(total)])
              }
            })
      }
      sections.push(...charts.flatMap((chart) => {
        const colors = palettes[chart.id] || palettes.sistemas
        return chart.views
          .filter((view) => view.status === 'ok' && (view.items || []).some((item) => item.total > 0))
          .map((view) => {
            const visible = view.items.filter((item) => item.total > 0)
            const items = view.id === 'porte'
              ? visible
              : groupSmallChartSlices(visible)
            const total = items.reduce((sum, item) => sum + item.total, 0)
            const bars = items.map((item, index) => ({
              label: item.detail ? `${item.label} (${item.detail})` : item.label,
              value: formatPopulation(item.total),
              pct: total ? item.total / total * 100 : 0,
              color: item.color || colors[index % colors.length]
            }))
            const note = view.note || chart.note
            return {
              title: note
                ? `${chart.title} — ${view.subtitle} (${note})`
                : `${chart.title} — ${view.subtitle}`,
              bars
            }
          })
      }))
      if (!coordGeometry && scoped.length > 1 && scoped.length <= 12) {
        sections.push({
          title: 'Municípios no recorte',
          table: {
            headers: ['Município', 'Território', 'População'],
            rows: scoped.map((item) => [
              item.name,
              item.territory,
              formatPopulation(item.population)
            ])
          }
        })
      }
      const coordKpis = coordGeometry && coordHit
        ? [
            { label: 'Raio no terreno', value: `${coordHit.radiusKm} km` },
            { label: 'Poços no raio', value: formatPopulation(assetLists.pocos.length) },
            { label: 'Sistemas no raio', value: formatPopulation(assetLists.sistemas.length) }
          ]
        : [
            { label: 'Municípios no recorte', value: formatPopulation(scoped.length) },
            { label: 'População no recorte', value: formatPopulation(population) },
            { label: 'Municípios no semiárido', value: formatPopulation(semiCount) }
          ]
      await downloadRelatorioPdf({
        title: 'Relatório de infraestrutura hídrica',
        theme: 'infra',
        scope: scopeLabel,
        source: 'Inventário de ativos · web map de infraestrutura',
        fileName: `relatorio-infraestrutura-${slugRelatorio(scopeLabel)}.pdf`,
        kpis: coordKpis,
        mapCaption: scopeLabel,
        mapLegendTitle: 'Legenda do mapa',
        mapLegendNote: 'Símbolos e classes visíveis no recorte atual.',
        mapLegend: await legendGroupsForPdf(legend),
        mapDataUrl: await (async () => {
          const view = viewRef.current
          const previous = view?.viewpoint?.clone?.() || view?.extent?.clone?.()
          try {
            await restoreScopeView()
            return await captureMapView(view)
          } finally {
            if (view && previous) {
              try { await view.goTo(previous, { duration: 0 }) } catch (_) {}
            }
          }
        })(),
        sections
      })
    } catch (err) {
      console.error('[infra-page] Falha ao exportar PDF:', err)
      window.alert('Não foi possível gerar o PDF da seleção.')
    } finally {
      setExporting(false)
    }
  }, [
    exporting,
    loading,
    charts,
    selectedName,
    municipios,
    territorialMunicipios,
    scopeLabel,
    restoreScopeView,
    legend,
    filterTerritorio,
    filterSemiarido,
    filteredNames,
    semiRegionOn,
    hasCoordZone,
    coordHit
  ])

  return (
    <div className="infra-page jimu-widget" ref={rootRef}>
      <div className="infra-page__hero">
        <HeroInfraestrutura />
      </div>
      <div className="infra-report-bar">
        <p>
          <span>Relatório da seleção</span>
          <strong>{scopeLabel}</strong>
        </p>
        <button
          type="button"
          className="infra-export-pdf"
          disabled={exporting || loading}
          onClick={() => { void exportPdf() }}
        >
          {exporting ? 'Gerando PDF…' : 'Exportar PDF'}
        </button>
      </div>
      <section className="infra-charts" aria-label="Indicadores de infraestrutura">
        {charts.map((chart) => {
          const activeId = chartView[chart.id] || chart.views[0]?.id
          const active = chart.views.find((view) => view.id === activeId) || chart.views[0]
          return (
            <article key={chart.id} className="infra-chart">
              <header className="infra-chart__head">
                <p className="infra-chart__eyebrow">{active?.subtitle}</p>
                <h3 className="infra-chart__title">{chart.title}</h3>
                {active?.note || chart.note
                  ? <p className="infra-chart__note">{active?.note || chart.note}</p>
                  : null}
                {chart.views.length > 1
                  ? (
                    <div className="infra-chart__switch" role="tablist" aria-label={`Indicadores de ${chart.title}`}>
                      {chart.views.map((view) => (
                        <button
                          key={view.id}
                          type="button"
                          role="tab"
                          aria-selected={view.id === active?.id}
                          className={view.id === active?.id ? 'is-active' : ''}
                          onClick={() => {
                            setChartView((prev) => ({ ...prev, [chart.id]: view.id }))
                            setChartFilter((prev) => (prev?.chartId === chart.id ? null : prev))
                          }}
                        >
                          {view.subtitle}
                        </button>
                      ))}
                    </div>
                    )
                  : null}
              </header>
              <div className="infra-chart__body">
                {!active || active.status === 'loading'
                  ? <PortalLoader folderUrl={props.context.folderUrl} compact />
                  : active.status !== 'ok'
                    ? <p className="infra-chart__empty">{active.message || 'Sem dados'}</p>
                    : (
                      <PieChart
                        chartId={chart.id}
                        items={active.items}
                        layout={active.layout || 'pie'}
                        preserveOrder={active.id === 'porte'}
                        selectedLabel={chartFilter?.chartId === chart.id && chartFilter.viewId === active.id ? chartFilter.label : null}
                        onSliceSelect={(slice) => {
                          const same = Boolean(
                            chartFilter
                            && chartFilter.chartId === chart.id
                            && chartFilter.viewId === active.id
                            && chartFilter.label === slice.label
                          )
                          const next = same
                            ? null
                            : {
                              chartId: chart.id,
                              viewId: active.id,
                              label: slice.label,
                              parts: slice.parts?.length
                                ? slice.parts.map((part) => ({ label: part.label }))
                                : undefined
                            }
                          setChartFilter(next)
                          if (next) {
                            setListTab('ativos')
                            setPage(0)
                          }
                        }}
                      />
                      )}
              </div>
              {chart.source
                ? (
                  <p className="infra-chart__source">
                    <span aria-hidden="true" />
                    <span>Fonte: <strong>{chart.source}</strong></span>
                  </p>
                  )
                : null}
            </article>
          )
        })}
      </section>
      <div className="infra-page__body">
        <aside className="infra-mun" aria-label="Filtros e listas">
          <header className="infra-mun__head">
            <p className="infra-mun__eyebrow">Recorte territorial</p>
            <div className="infra-mun__title-row">
              <h2 className="infra-mun__title">
                {listTab === 'ativos' ? 'Infraestrutura' : listTab === 'setores' ? 'Aglomerado' : 'Municípios'}
              </h2>
              {listTab === 'setores'
                ? (
                  <div className="infra-fonte-wrap">
                    <button
                      type="button"
                      className={`infra-fonte-btn${fonteOpen ? ' is-open' : ''}`}
                      aria-label="Fonte dos dados de aglomerado"
                      aria-expanded={fonteOpen}
                      aria-controls="infra-fonte-note"
                      onClick={() => setFonteOpen((open) => !open)}
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
                    {fonteOpen
                      ? (
                        <div
                          id="infra-fonte-note"
                          className="infra-fonte-note"
                          role="dialog"
                          aria-labelledby="infra-fonte-note-title"
                        >
                          <div className="infra-fonte-note__head">
                            <h4 id="infra-fonte-note-title">Fonte</h4>
                            <button
                              type="button"
                              className="infra-fonte-note__close"
                              aria-label="Fechar fonte"
                              onClick={() => setFonteOpen(false)}
                            >
                              ×
                            </button>
                          </div>
                          <p>FONTE: SETOR CENSITÁRIO, IBGE 2022.</p>
                        </div>
                        )
                      : null}
                  </div>
                  )
                : null}
            </div>
            <span className="infra-mun__accent" aria-hidden="true" />
          </header>
          <div className="infra-mun__tabs" role="tablist" aria-label="Tipo de lista">
            <button
              type="button"
              role="tab"
              aria-selected={listTab === 'municipios'}
              className={listTab === 'municipios' ? 'is-active' : ''}
              onClick={() => {
                setListTab('municipios')
                setPage(0)
              }}
            >
              Municípios
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={listTab === 'ativos'}
              className={listTab === 'ativos' ? 'is-active' : ''}
              onClick={() => {
                setListTab('ativos')
                setPage(0)
              }}
            >
              Infraestrutura
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={listTab === 'setores'}
              className={listTab === 'setores' ? 'is-active' : ''}
              onClick={() => {
                setListTab('setores')
                setPage(0)
              }}
            >
              Aglomerado
            </button>
          </div>
          <div className="infra-mun__filters">
            {listTab === 'municipios'
              ? (
                <>
                  <label>
                    Território de Identidade
                    <select
                      value={filterTerritorio}
                      onChange={(event) => {
                        const value = event.target.value
                        setFilterTerritorio(value)
                        setPage(0)
                        const mun = selectedName
                          ? municipios.find((item) => item.name === selectedName)
                          : null
                        const munInTi = Boolean(mun && (!value || mun.territory === value))
                        if (selectedName && !munInTi) {
                          selectedNameRef.current = null
                          setSelectedName(null)
                          setSelectedAtivoKey(null)
                          setSelectedSetorKey(null)
                        }
                        void restoreScopeView({
                          municipality: value ? null : (munInTi ? selectedName : null),
                          territorio: value
                        })
                      }}
                    >
                      <option value="">Todos</option>
                      {territorios.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className={`infra-mun__semi-toggle${semiRegionOn ? ' is-on' : ''}`}
                    aria-pressed={semiRegionOn}
                    onClick={() => { void toggleSemiRegion() }}
                  >
                    <span>Região Semiárida</span>
                    <strong>{semiRegionOn ? 'Desativar' : 'Ativar'}</strong>
                  </button>
                  <label>
                    Pesquisar município
                    <input
                      type="search"
                      value={munQuery}
                      placeholder="Nome do município"
                      onChange={(event) => {
                        setMunQuery(event.target.value)
                        setPage(0)
                      }}
                    />
                  </label>
                  <label className="infra-mun__coord">
                    Buscar por coordenada geográfica
                    <span className="infra-mun__coord-row">
                      <input
                        type="search"
                        value={coordQuery}
                        placeholder="Cole DMS ou decimal"
                        onPaste={(event) => {
                          const text = event.clipboardData?.getData('text') || ''
                          const compact = text.replace(/\s+/g, ' ').trim()
                          setCoordQuery(compact)
                          setCoordError('')
                          void goToCoordinate(text)
                        }}
                        onChange={(event) => {
                          const value = event.target.value
                          setCoordQuery(value)
                          setCoordError('')
                          if (!value.trim()) {
                            coordBufferRef.current = null
                            setCoordBufferEpoch(0)
                            setCoordHit(null)
                            clearCoordMarker(viewRef.current)
                            setAtivos([])
                            setSetores([])
                            pinnedAtivoRef.current = null
                            void applyInfraGeometryFilter(viewRef.current, webMapRef.current, null)
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            void goToCoordinate()
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="infra-mun__coord-go"
                        onClick={() => { void goToCoordinate() }}
                      >
                        Ir no mapa
                      </button>
                    </span>
                    {coordError
                      ? <span className="infra-mun__coord-error">{coordError}</span>
                      : null}
                  </label>
                  <button
                    type="button"
                    className="infra-mun__clear"
                    disabled={!filterTerritorio && !munQuery && !coordQuery && !coordHit}
                    onClick={() => {
                      setFilterTerritorio('')
                      setMunQuery('')
                      setCoordQuery('')
                      setCoordError('')
                      setCoordHit(null)
                      coordBufferRef.current = null
                      setCoordBufferEpoch(0)
                      setPage(0)
                      clearCoordMarker(viewRef.current)
                      setAtivos([])
                      setSetores([])
                      pinnedAtivoRef.current = null
                      void applyInfraGeometryFilter(viewRef.current, webMapRef.current, null)
                      void restoreScopeView({ territorio: '' })
                    }}
                  >
                    Limpar filtro
                  </button>
                </>
                )
              : null}
            {listTab === 'ativos'
              ? (
                <>
                  <label>
                    Tipo de ativo
                    <select
                      value={assetType}
                      onChange={(event) => {
                        setAssetType(event.target.value as AssetType)
                        setChartFilter((prev) => {
                          const value = event.target.value as AssetType
                          if (!value) return null
                          if (prev && prev.chartId !== value) return null
                          return prev
                        })
                        setPage(0)
                      }}
                    >
                      <option value="">Todos</option>
                      {ASSET_DEFS.map((def) => (
                        <option key={def.id} value={def.id}>{def.title}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Buscar ativo
                    <input
                      type="search"
                      value={assetQuery}
                      placeholder="Sistema, poço ou barragem"
                      onChange={(event) => setAssetQuery(event.target.value)}
                    />
                  </label>
                </>
                )
              : null}
            {listTab === 'setores'
              ? (
                <>
                  <label>
                    Tipo de aglomerado
                    <select
                      value={setorTipo}
                      onChange={(event) => {
                        setSetorTipo(event.target.value)
                        setPage(0)
                      }}
                    >
                      <option value="">Todos (PA, indígena e quilombola)</option>
                      {SETOR_TIPOS.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Buscar aglomerado
                    <input
                      type="search"
                      value={setorQuery}
                      placeholder="Nome do aglomerado"
                      onChange={(event) => setSetorQuery(event.target.value)}
                    />
                  </label>
                </>
                )
              : null}
          </div>
          {listTab === 'municipios'
            ? (
              <>
                <p className="infra-mun__meta">
                  {listError
                    ? listError
                    : filteredMunicipios.length
                      ? `${rangeStart}–${rangeEnd} de ${filteredMunicipios.length}`
                      : loading
                        ? 'Carregando lista…'
                        : 'Nenhum município encontrado'}
                  {zooming ? ' — aproximando no mapa…' : ''}
                </p>
                {selectedName
                  ? (
                    <button
                      type="button"
                      className="infra-mun__clear"
                      onClick={() => { void clearSelection() }}
                    >
                      Desmarcar {selectedName}
                    </button>
                    )
                  : null}

                {loading && !pageItems.length
                  ? <PortalLoader folderUrl={props.context.folderUrl} compact label="Carregando lista" />
                  : null}

                <ul className="infra-mun__list">
                  {pageItems.map((item) => (
                    <li key={item.name}>
                      <button
                        type="button"
                        className={`infra-mun__item${selectedName === item.name ? ' is-selected' : ''}`}
                        onClick={() => { void handleSelect(item) }}
                      >
                        <strong className="infra-mun__name">{item.name}</strong>
                        <span className="infra-mun__row">
                          <em>Território</em>
                          {item.territory}
                        </span>
                        <span className="infra-mun__row">
                          <em>Semiárido</em>
                          {item.semiarido}
                        </span>
                        <span className="infra-mun__row">
                          <em>População</em>
                          {formatPopulation(item.population)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="infra-mun__pager">
                  <button
                    type="button"
                    disabled={currentPage <= 0}
                    onClick={() => setPage((value) => Math.max(0, value - 1))}
                  >
                    Anterior
                  </button>
                  <span>{currentPage + 1} / {pageCount}</span>
                  <button
                    type="button"
                    disabled={currentPage >= pageCount - 1}
                    onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                  >
                    Próxima
                  </button>
                </div>
              </>
              )
            : listTab === 'setores'
              ? (
                <SetoresList
                  query={setorSearch}
                  municipality={selectedName}
                  territory={coordHit?.radiusKm ? `raio de ${coordHit.radiusKm} km` : filterTerritorio}
                  loading={setoresLoading}
                  items={setores}
                  page={page}
                  selectedKey={selectedSetorKey}
                  zooming={zooming}
                  popup={assetPopup?.key === selectedSetorKey ? assetPopup : null}
                  folderUrl={props.context.folderUrl}
                  onPage={setPage}
                  onSelect={(item) => { void handleSelectSetor(item) }}
                />
                )
              : (
                <AtivosList
                  query={assetSearch}
                  municipality={selectedName}
                  territory={coordHit?.radiusKm ? `raio de ${coordHit.radiusKm} km` : filterTerritorio}
                  loading={ativosLoading}
                  items={ativos}
                  page={page}
                  selectedKey={selectedAtivoKey}
                  zooming={zooming}
                  popup={assetPopup?.key === selectedAtivoKey ? assetPopup : null}
                  folderUrl={props.context.folderUrl}
                  onPage={setPage}
                  onSelect={(item) => { void handleSelectAtivo(item) }}
                />
                )}
        </aside>

        <div className="infra-page__map-wrap">
          <div className="infra-page__map" ref={mapRef} />
          {!loading && !error
            ? (
              <MapLegend
                place={selectedName || filterTerritorio || (semiRegionOn ? 'Região Semiárida' : 'Bahia')}
                loading={legendLoading}
                groups={legend}
              />
              )
            : null}
          {loading
            ? (
              <PortalLoader
                overlay
                folderUrl={props.context.folderUrl}
                label="Carregando mapa"
              />
              )
            : null}
          {error
            ? (
              <div className="infra-page__overlay">
                <p>{error}</p>
              </div>
              )
            : null}
          <div
            ref={munPopupRef}
            className="mun-popup-dock"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            {(coordHit && !coordHit.open && !selectedAtivoKey && !selectedSetorKey) || (selectedName && !munPopup.open && !coordHit && !selectedAtivoKey && !selectedSetorKey)
              ? (
                <button
                  type="button"
                  className="mun-popup__expand"
                  aria-label={coordHit ? 'Abrir ficha da coordenada' : `Abrir ficha de ${selectedName}`}
                  title={coordHit ? 'Abrir ficha da coordenada' : 'Abrir ficha do município'}
                  onPointerDown={(event) => event.stopPropagation()}
                  onMouseDown={(event) => {
                    event.stopPropagation()
                    event.preventDefault()
                    if (coordHit) setCoordHit({ ...coordHit, open: true })
                    else reopenMunPopup(event)
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    event.preventDefault()
                    if (coordHit) setCoordHit({ ...coordHit, open: true })
                    else reopenMunPopup(event)
                  }}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path
                      d="M14.5 5.5 8 12l6.5 6.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                )
              : null}
            <div
              className={`mun-popup${munPopup.open ? ' is-open' : ''}`}
              hidden={!munPopup.open}
              role="complementary"
              aria-label={munPopup.data?.nome ? `Município — ${munPopup.data.nome}` : 'Ficha do município'}
            >
            <div className="mun-popup__card">
              {munPopup.data?.nome ? (
                <>
                  <button
                    type="button"
                    className="mun-popup__close"
                    aria-label="Fechar"
                    onClick={closeMunPopup}
                  >
                    ×
                  </button>
                  <p className="mun-popup__kicker">Ficha do município</p>
                  {munPopup.data.territorio && munPopup.data.territorio !== '—' ? (
                    <p className="mun-popup__eyebrow">{munPopup.data.territorio}</p>
                  ) : null}
                  <h4 className="mun-popup__title">{munPopup.data.nome}</h4>
                  <dl className="mun-popup__grid">
                    <div className="mun-popup__row">
                      <dt className="mun-popup__label">Região Semiárida</dt>
                      <dd className="mun-popup__value">{munPopup.data.semiarido || '—'}</dd>
                    </div>
                    <div className="mun-popup__row">
                      <dt className="mun-popup__label">População</dt>
                      <dd className="mun-popup__value">
                        {munPopup.data.populacao != null && Number.isFinite(Number(munPopup.data.populacao))
                          ? new Intl.NumberFormat('pt-BR').format(Number(munPopup.data.populacao))
                          : 'Sem dado'}
                      </dd>
                    </div>
                    {munPopup.data.codMun ? (
                      <div className="mun-popup__row">
                        <dt className="mun-popup__label">Código IBGE</dt>
                        <dd className="mun-popup__value">{munPopup.data.codMun}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {munPopup.data.extraFields?.length ? (
                    <dl className="mun-popup__extras">
                      {munPopup.data.extraFields.map((field) => (
                        <div key={field.label} className="mun-popup__row">
                          <dt className="mun-popup__label">{field.label}</dt>
                          <dd className="mun-popup__value">{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                </>
              ) : null}
            </div>
            </div>
            {coordHit?.open
              ? (
                <div
                  className="mun-popup is-open"
                  role="complementary"
                  aria-label="Ficha da coordenada"
                >
                  <div className="mun-popup__card coord-popup__card">
                    <button
                      type="button"
                      className="mun-popup__close"
                      aria-label="Fechar"
                      onClick={closeCoordPopup}
                    >
                      ×
                    </button>
                    <p className="mun-popup__kicker">Recorte por coordenada</p>
                    <h4 className="mun-popup__title">{coordHit.label.split('  (')[0]}</h4>
                    <dl className="mun-popup__grid">
                      <div className="mun-popup__row">
                        <dt className="mun-popup__label">Decimal</dt>
                        <dd className="mun-popup__value">{coordHit.lat.toFixed(6)}, {coordHit.lon.toFixed(6)}</dd>
                      </div>
                      <div className="mun-popup__row">
                        <dt className="mun-popup__label">Raio atual</dt>
                        <dd className="mun-popup__value">{radiusDraft} km</dd>
                      </div>
                    </dl>
                    <label className="infra-mun__radius">
                      Área de busca
                      <input
                        type="range"
                        min={COORD_RADIUS_MIN_KM}
                        max={COORD_RADIUS_MAX_KM}
                        step={1}
                        value={radiusDraft}
                        onChange={(event) => scheduleNearbyRadius(Number(event.target.value))}
                      />
                      <span className="infra-mun__radius-scale">
                        <span>{COORD_RADIUS_MIN_KM} km</span>
                        <span>Máximo {COORD_RADIUS_MAX_KM} km</span>
                      </span>
                    </label>
                    <p className="coord-popup__note">
                      O raio é em <strong>quilômetros reais no terreno</strong>. O círculo chega no máximo a <strong>{COORD_RADIUS_MAX_KM} km</strong> a partir deste ponto.
                    </p>
                  </div>
                </div>
                )
              : null}
          </div>
        </div>
      </div>
      <SistemasMap folderUrl={props.context.folderUrl} />
    </div>
  )
}

export default Widget
