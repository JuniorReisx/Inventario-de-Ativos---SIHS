import { React } from 'jimu-core'
import { loadArcGISJSAPIModules } from 'jimu-arcgis'
import {
  buildMunicipioPopupData,
  createMapView,
  createWebMap,
  disableNativePopup,
  enableMunicipioCustomPopup,
  highlightWhere,
  resetMunicipioView,
  resizeMapView,
  setupAuthentication,
  zoomToWhere,
  type MunicipioPopupData
} from '../../lib/map'
import {
  CLASS_MAP_CONFIGS,
  applyAllowedLayers,
  findTotalLayer,
  listSistemasLayers,
  loadMunicipioSistemaFeature,
  loadTopMunicipiosSistemas,
  normalizeSistemasTypeFilters,
  orderTotalSistemasBreaksAscending,
  popupCountLabel,
  resolveActiveSistemasLayer,
  searchMunicipiosSistemas,
  selectExclusiveSistemasLayer,
  sistemasLegendLayerInfos,
  type ClassMapConfig,
  type MunicipioSistema,
  type SistemaLayerItem
} from '../../lib/sistemas'
import PortalLoader from '../portal-loader'
import './style.css'

const { useCallback, useEffect, useRef, useState } = React

function layerLabel (title: string): string {
  return title
    .replace(/^Sistema\s+/i, '')
    .replace(/^Instalação\s+/i, '')
    .trim()
}

function ClassMapPanel (props: {
  config: ClassMapConfig
  active: boolean
  folderUrl: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const legendRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<any>(null)
  const webMapRef = useRef<any>(null)
  const legendWidgetRef = useRef<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [layers, setLayers] = useState<SistemaLayerItem[]>([])
  const [ranking, setRanking] = useState<MunicipioSistema[]>([])
  const [rankingLayerId, setRankingLayerId] = useState<string | null>(null)
  const [rankingBusy, setRankingBusy] = useState(false)
  const [munQuery, setMunQuery] = useState('')
  const [munHits, setMunHits] = useState<MunicipioSistema[]>([])
  const [munSearchBusy, setMunSearchBusy] = useState(false)
  const [focusedMun, setFocusedMun] = useState<string | null>(null)
  const rankingLayerIdRef = useRef<string | null>(null)
  const munPopupHandleRef = useRef<{ remove: () => void } | null>(null)
  const munPopupRef = useRef<HTMLDivElement>(null)
  const rankRef = useRef<HTMLElement>(null)
  const [legendOpen, setLegendOpen] = useState(false)
  const [munPopup, setMunPopup] = useState<{
    open: boolean
    data: MunicipioPopupData | null
  }>({
    open: false,
    data: null
  })

  const closeMunPopup = useCallback(() => {
    void resetMunicipioView(viewRef.current)
    setFocusedMun(null)
    setMunPopup({ open: false, data: null })
  }, [])

  const openMunPopup = useCallback((data: MunicipioPopupData) => {
    setMunPopup({ open: true, data })
  }, [])

  const refreshRanking = async (layerId: string | null) => {
    const webMap = webMapRef.current
    if (!webMap) return
    rankingLayerIdRef.current = layerId
    setRankingLayerId(layerId)
    setRankingBusy(true)
    try {
      const top = await loadTopMunicipiosSistemas(webMap, 10, props.config, layerId)
      setRanking(top)
    } catch (err) {
      console.error(`[infra-${props.config.id}] Falha ao atualizar ranking:`, err)
      setRanking([])
    } finally {
      setRankingBusy(false)
    }
  }

  const focusMunicipio = useCallback(async (name: string) => {
    const webMap = webMapRef.current
    const view = viewRef.current
    const wanted = String(name || '').trim()
    if (!webMap || !view || !wanted) return

    if (focusedMun && focusedMun.toUpperCase() === wanted.toUpperCase() && munPopup.open) {
      closeMunPopup()
      return
    }

    const hit = await loadMunicipioSistemaFeature(webMap, wanted, props.config, rankingLayerIdRef.current)
    if (!hit) return

    const oidField = hit.layer?.objectIdField || 'OBJECTID'
    const oid = hit.feature?.attributes?.[oidField]
      ?? hit.feature?.attributes?.OBJECTID
      ?? hit.feature?.attributes?.objectid
    if (oid != null && Number.isFinite(Number(oid))) {
      const where = `${oidField} = ${Number(oid)}`
      void highlightWhere(view, hit.layer, where, { outlineOnly: true })
      void zoomToWhere(view, hit.layer, where)
    }

    const rendererField = String(hit.layer?.renderer?.field || '').trim()
    const data = await buildMunicipioPopupData(hit.layer, hit.feature.attributes, {
      webMap,
      compact: true,
      totalLabel: popupCountLabel(props.config, hit.layer?.title || ''),
      totalCandidates: [
        rendererField,
        ...(props.config.countFields || []),
        ...(props.config.popupTotalCandidates || [])
      ]
    })
    setFocusedMun(data.nome || wanted)
    openMunPopup(data)
  }, [closeMunPopup, focusedMun, munPopup.open, openMunPopup, props.config])

  useEffect(() => {
    const queryText = munQuery.trim()
    if (queryText.length < 2) {
      setMunHits([])
      setMunSearchBusy(false)
      return
    }
    let cancelled = false
    setMunSearchBusy(true)
    const handle = window.setTimeout(() => {
      void searchMunicipiosSistemas(
        webMapRef.current,
        queryText,
        props.config,
        rankingLayerIdRef.current
      ).then((hits) => {
        if (!cancelled) setMunHits(hits)
      }).catch(() => {
        if (!cancelled) setMunHits([])
      }).finally(() => {
        if (!cancelled) setMunSearchBusy(false)
      })
    }, 280)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [munQuery, rankingLayerId, props.config])

  useEffect(() => {
    let cancelled = false

    const init = async () => {
      try {
        await setupAuthentication()
        if (cancelled || !mapRef.current) return

        const webMap = await createWebMap(undefined, props.config.webMapId)
        if (cancelled || !mapRef.current) return
        webMapRef.current = webMap

        const view = await createMapView(mapRef.current, webMap)
        if (cancelled) {
          view.destroy?.()
          return
        }
        viewRef.current = view
        disableNativePopup(view, webMap)
        if (mapRef.current) {
          munPopupHandleRef.current?.remove?.()
          munPopupHandleRef.current = enableMunicipioCustomPopup(view, {
            viewContainer: mapRef.current,
            webMap,
            compact: true,
            countFields: props.config.countFields,
            resolveLayer: () => resolveActiveSistemasLayer(
              webMapRef.current,
              rankingLayerIdRef.current,
              props.config.allowedLayerKeys
            ),
            countLabel: (layer) => popupCountLabel(props.config, layer?.title || ''),
            onOpen: (data) => {
              setFocusedMun(data?.nome || null)
              openMunPopup(data)
            },
            onClose: closeMunPopup
          })
        }
        await orderTotalSistemasBreaksAscending(webMap, props.config.totalLayerTitles)
        normalizeSistemasTypeFilters(webMap)
        applyAllowedLayers(webMap, props.config.allowedLayerKeys)
        const totalLayer = findTotalLayer(webMap, props.config.totalLayerTitles, props.config.countFields)
        const listedBefore = listSistemasLayers(webMap, props.config.allowedLayerKeys)
        const preferred = listedBefore.find((item) => {
          const title = item.title
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
          return title.includes('total')
        }) || (props.config.id === 'pocos'
          ? listedBefore.find((item) => {
            const title = item.title
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .toLowerCase()
            return title.includes('vazao aproveit')
          })
          : null)
        const initialLayerId =
          preferred?.id
          || listedBefore.find((item) => item.id === totalLayer?.id)?.id
          || listedBefore.find((item) => item.visible)?.id
          || listedBefore[0]?.id
          || null
        if (initialLayerId) {
          selectExclusiveSistemasLayer(webMap, initialLayerId, props.config.allowedLayerKeys)
        }
        const listed = listSistemasLayers(webMap, props.config.allowedLayerKeys)
        setLayers(listed)

        if (legendRef.current) {
          const [Legend] = await loadArcGISJSAPIModules(['esri/widgets/Legend'])
          if (cancelled) return
          legendWidgetRef.current = new Legend({
            view,
            container: legendRef.current,
            layerInfos: sistemasLegendLayerInfos(webMap, props.config.allowedLayerKeys)
          })
        }

        rankingLayerIdRef.current = initialLayerId
        setRankingLayerId(initialLayerId)
        const top = await loadTopMunicipiosSistemas(webMap, 10, props.config, initialLayerId)
        if (!cancelled) {
          setRanking(top)
          setLoading(false)
        }
      } catch (err) {
        console.error(`[infra-${props.config.id}] Falha ao carregar o mapa:`, err)
        if (!cancelled) {
          setError((err as any)?.message || props.config.loadingMap.replace('Carregando ', 'Não foi possível carregar o '))
          setLoading(false)
        }
      }
    }

    void init()

    return () => {
      cancelled = true
      munPopupHandleRef.current?.remove?.()
      munPopupHandleRef.current = null
      legendWidgetRef.current?.destroy?.()
      legendWidgetRef.current = null
      viewRef.current?.destroy?.()
      viewRef.current = null
      webMapRef.current = null
    }
  }, [props.config, openMunPopup, closeMunPopup])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!props.active) return
      void resizeMapView(viewRef.current)
    })
    observer.observe(root)
    if (mapRef.current) observer.observe(mapRef.current)
    return () => observer.disconnect()
  }, [props.active])

  useEffect(() => {
    if (!props.active) return
    const handle = window.setTimeout(() => {
      void resizeMapView(viewRef.current)
    }, 80)
    return () => window.clearTimeout(handle)
  }, [props.active])

  useEffect(() => {
    if (!props.active) closeMunPopup()
  }, [props.active, closeMunPopup])

  useEffect(() => {
    if (!munPopup.open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMunPopup()
    }

    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (munPopupRef.current?.contains(target)) return
      if (mapRef.current?.contains(target)) return
      if (rankRef.current?.contains(target)) return
      closeMunPopup()
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('click', onDocClick)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('click', onDocClick)
    }
  }, [munPopup.open, closeMunPopup])

  const selectLayer = (layer: SistemaLayerItem) => {
    if (layer.id === rankingLayerIdRef.current && layer.visible) return
    setMunQuery('')
    setMunHits([])
    closeMunPopup()
    selectExclusiveSistemasLayer(webMapRef.current, layer.id, props.config.allowedLayerKeys)
    setLayers(listSistemasLayers(webMapRef.current, props.config.allowedLayerKeys))
    void refreshRanking(layer.id)
  }

  const rankingLayerTitle = layers.find((item) => item.id === rankingLayerId)?.title
  const searching = munQuery.trim().length >= 2
  const listed = searching ? munHits : ranking
  const listMax = listed[0]?.total || 1
  const isFocused = (name: string) =>
    Boolean(focusedMun && name && focusedMun.toUpperCase() === name.toUpperCase())

  return (
    <div
      className={`infra-sistemas__panel${props.active ? ' is-active' : ' is-idle'}`}
      ref={rootRef}
      aria-hidden={!props.active}
    >
      <div className="infra-sistemas__toolbar">
        {layers.length
          ? (
            <div className="infra-sistemas__filters" role="radiogroup" aria-label="Camada do mapa">
              <span>Camadas</span>
              <div>
                {layers.map((layer) => (
                  <button
                    key={layer.id}
                    type="button"
                    role="radio"
                    className={layer.visible ? 'is-on' : ''}
                    aria-checked={layer.visible}
                    onClick={() => selectLayer(layer)}
                  >
                    {layerLabel(layer.title)}
                  </button>
                ))}
              </div>
            </div>
            )
          : <div />}
        {ranking[0]
          ? (
            <p className="infra-sistemas__lead">
              <em>1º</em>
              <span>
                <strong>{ranking[0].name}</strong>
                lidera com {Number.isFinite(ranking[0].total) ? ranking[0].total.toLocaleString('pt-BR') : 'Sem dado'} {ranking[0].total === 1 ? props.config.unitSingular : props.config.unitPlural}
              </span>
            </p>
            )
          : null}
      </div>

      <div className="infra-sistemas__grid">
        <article className="infra-sistemas__rank" ref={rankRef}>
          <header>
            <p>Ranking</p>
            <h3>Municípios</h3>
            <small>
              {searching
                ? munSearchBusy
                  ? 'Buscando município…'
                  : munHits.length
                    ? `${munHits.length} resultado${munHits.length === 1 ? '' : 's'}`
                    : 'Nenhum município encontrado'
                : rankingBusy
                  ? 'Atualizando ranking…'
                  : rankingLayerTitle
                    ? layerLabel(rankingLayerTitle)
                    : ranking.length
                      ? props.config.rankingSource
                      : loading ? 'Carregando…' : 'Sem dados'}
            </small>
            <label className="infra-sistemas__search">
              <span className="infra-sistemas__search-icon" aria-hidden="true" />
              <input
                type="search"
                value={munQuery}
                onChange={(event) => setMunQuery(event.target.value)}
                placeholder="Pesquisar município…"
                autoComplete="off"
                spellCheck={false}
                aria-label="Pesquisar município"
              />
            </label>
          </header>
          <ol>
            {(searching ? munSearchBusy && !munHits.length : rankingBusy && !ranking.length)
              ? (
                <li className="infra-sistemas__empty">
                  <PortalLoader folderUrl={props.folderUrl} compact />
                </li>
                )
              : listed.length
              ? listed.map((item, index) => (
                <li
                  key={item.name}
                  className={[
                    index < 3 && !searching ? `is-top is-top-${index + 1}` : '',
                    isFocused(item.name) ? 'is-selected' : ''
                  ].filter(Boolean).join(' ')}
                >
                  <button
                    type="button"
                    onClick={() => { void focusMunicipio(item.name) }}
                  >
                    <em>{String(index + 1).padStart(2, '0')}</em>
                    <div>
                      <strong>{item.name}</strong>
                      <span className="infra-sistemas__track">
                        <span style={{ width: `${Math.max(10, (item.total / Math.max(listMax, 1)) * 100)}%` }} />
                      </span>
                    </div>
                    <b>{Number.isFinite(item.total) ? item.total.toLocaleString('pt-BR') : 'Sem dado'}</b>
                  </button>
                </li>
                ))
              : (
                <li className="infra-sistemas__empty">
                  {loading || munSearchBusy
                    ? <PortalLoader folderUrl={props.folderUrl} compact />
                    : searching
                      ? 'Nenhum município encontrado.'
                      : props.config.emptyRanking}
                </li>
                )}
          </ol>
          {rankingBusy && ranking.length
            ? <PortalLoader overlay folderUrl={props.folderUrl} compact />
            : null}
          {props.config.id === 'cisternas' || props.config.id === 'sistemas'
            ? (
              <p className="infra-sistemas__source">
                <span aria-hidden="true" />
                <span>
                  {props.config.note
                    ? <>{props.config.note}. </>
                    : null}
                  Fonte: <strong>{props.config.rankingSource}</strong>
                </span>
              </p>
              )
            : null}
        </article>

        <div className="infra-sistemas__map-wrap">
          <div className="infra-sistemas__map" ref={mapRef} />
          <aside className={`infra-sistemas__legend-card${legendOpen ? ' is-open' : ''}`}>
            <button
              type="button"
              onClick={() => setLegendOpen((value) => !value)}
              aria-expanded={legendOpen}
            >
              <span>Legenda</span>
              <em>{legendOpen ? '−' : '+'}</em>
            </button>
            <div className="infra-sistemas__legend" ref={legendRef} hidden={!legendOpen} />
          </aside>
          {loading
            ? (
              <PortalLoader
                overlay
                folderUrl={props.folderUrl}
                label={props.config.loadingMap.replace('…', '')}
              />
              )
            : null}
          {error
            ? (
              <div className="infra-sistemas__overlay">
                <p>{error}</p>
              </div>
              )
            : null}
          <div
            ref={munPopupRef}
            className="mun-popup"
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
                  <h4 className="mun-popup__title">{munPopup.data.nome}</h4>
                  <dl className="mun-popup__grid">
                    <div className="mun-popup__row">
                      <dt className="mun-popup__label">CODIBGE</dt>
                      <dd className="mun-popup__value">{munPopup.data.codMun || '—'}</dd>
                    </div>
                    <div className="mun-popup__row">
                      <dt className="mun-popup__label">Município</dt>
                      <dd className="mun-popup__value">{munPopup.data.nome}</dd>
                    </div>
                    <div className="mun-popup__row">
                      <dt className="mun-popup__label">Território de Identidade</dt>
                      <dd className="mun-popup__value">{munPopup.data.territorio || '—'}</dd>
                    </div>
                    <div className="mun-popup__row">
                      <dt className="mun-popup__label">Região Semiárida</dt>
                      <dd className="mun-popup__value">{munPopup.data.semiarido || '—'}</dd>
                    </div>
                    {munPopup.data.extraFields?.map((field) => (
                      <div key={field.label} className="mun-popup__row">
                        <dt className="mun-popup__label">{field.label}</dt>
                        <dd className="mun-popup__value">{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const SistemasMap = ({ folderUrl }: { folderUrl: string }) => {
  const [tab, setTab] = useState(CLASS_MAP_CONFIGS[0].id)
  const [visited, setVisited] = useState<Record<string, boolean>>({
    [CLASS_MAP_CONFIGS[0].id]: true
  })
  const active = CLASS_MAP_CONFIGS.find((item) => item.id === tab) || CLASS_MAP_CONFIGS[0]

  const selectTab = (id: string) => {
    setTab(id)
    setVisited((prev) => (prev[id] ? prev : { ...prev, [id]: true }))
  }

  return (
    <section className="infra-sistemas" data-theme={active.id} aria-label="Mapas de classes">
      <header className="infra-sistemas__head">
        <div>
          <p className="infra-sistemas__eyebrow">{active.eyebrow}</p>
          <h2 className="infra-sistemas__title">{active.title}</h2>
          {active.note
            ? <p className="infra-sistemas__note">{active.note}</p>
            : null}
        </div>
        <div className="infra-sistemas__tabs" role="tablist" aria-label="Tipo de mapa">
          {CLASS_MAP_CONFIGS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              data-theme={item.id}
              aria-selected={item.id === tab}
              className={item.id === tab ? 'is-active' : ''}
              onClick={() => selectTab(item.id)}
            >
              <i aria-hidden="true" />
              {item.shortLabel}
            </button>
          ))}
        </div>
      </header>

      {CLASS_MAP_CONFIGS.map((config) => (
        visited[config.id]
          ? (
            <ClassMapPanel
              key={config.id}
              config={config}
              active={config.id === tab}
              folderUrl={folderUrl}
            />
            )
          : null
      ))}
    </section>
  )
}

export default SistemasMap
