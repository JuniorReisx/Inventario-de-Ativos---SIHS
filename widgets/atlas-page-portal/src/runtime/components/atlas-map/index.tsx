import { React } from 'jimu-core'
import {
  atlasDisplayTitle,
  atlasMountLegend,
  atlasSyncLegend,
  bindAtlasMunicipioSearch,
  clearAtlasMunicipio,
  countVisibleLayers,
  createAtlasView,
  createWebMap,
  enableAtlasMunicipioSelect,
  enableAtlasRootLayers,
  layerHasMixedChildren,
  listAtlasLayers,
  listAtlasLayerReportRows,
  resizeMapView,
  setAllAtlasLayersVisible,
  setAtlasLayerVisible,
  setupAuthentication,
  type AtlasLayerNode,
  type AtlasMunicipioInfo
} from '../../lib/map'
import { captureMapView, downloadRelatorioPdf, slugRelatorio } from '../../lib/relatorio-pdf'
import PortalLoader from '../portal-loader'
import './style.css'

const { useCallback, useEffect, useMemo, useRef, useState } = React

function layerKind (title: string): string {
  const t = String(title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (t.includes('municip') || t.includes('limite')) return 'limite'
  if (t.includes('semiarid')) return 'semi'
  if (t.includes('reservat')) return 'reserv'
  if (t.includes('sistema') || t.includes('abastec')) return 'sistema'
  if (t.includes('poco')) return 'poco'
  if (t.includes('setor') || t.includes('censit')) return 'setor'
  if (t.includes('territor')) return 'ti'
  return 'layer'
}

function matchesQuery (node: AtlasLayerNode, query: string): boolean {
  if (!query) return true
  const hay = `${node.title} ${atlasDisplayTitle(node.title)}`.toLowerCase()
  if (hay.includes(query)) return true
  return Boolean(node.children?.some((child) => matchesQuery(child, query)))
}

function MixedCheck (props: {
  checked: boolean
  mixed?: boolean
  onChange: (value: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = Boolean(props.mixed)
  }, [props.mixed, props.checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={props.checked}
      aria-checked={props.mixed ? 'mixed' : props.checked}
      onChange={(event) => props.onChange(event.target.checked)}
      onClick={(event) => event.stopPropagation()}
    />
  )
}

function LayerRow (props: {
  node: AtlasLayerNode
  query: string
  expanded: Record<string, boolean>
  onToggle: (uid: string, visible: boolean) => void
  onExpand: (uid: string) => void
  depth?: number
}) {
  const { node, query, expanded, onToggle, onExpand, depth = 0 } = props
  if (!matchesQuery(node, query)) return null
  const kind = layerKind(node.title)
  const hasKids = Boolean(node.children?.length)
  const open = Boolean(expanded[node.uid]) || (Boolean(query) && hasKids && matchesQuery(node, query))
  const mixed = layerHasMixedChildren(node)
  return (
    <li className={`atlas-map__node${depth ? ' is-child' : ''}`}>
      <div
        className={`atlas-map__row atlas-map__row--${kind}${hasKids ? ' is-group' : ''}`}
        style={{ paddingLeft: `${0.4 + depth * 0.55}rem` }}
        onClick={() => onToggle(node.uid, !node.visible)}
      >
        {hasKids
          ? (
            <button
              type="button"
              className={`atlas-map__twist${open ? ' is-open' : ''}`}
              aria-expanded={open}
              aria-label={open ? 'Recolher subcamadas' : 'Expandir subcamadas'}
              onClick={(event) => {
                event.stopPropagation()
                onExpand(node.uid)
              }}
            />
            )
          : <span className="atlas-map__twist is-leaf" aria-hidden="true" />}
        <MixedCheck checked={node.visible} mixed={mixed} onChange={(value) => onToggle(node.uid, value)} />
        <i className="atlas-map__swatch" aria-hidden="true" />
        <span>{atlasDisplayTitle(node.title)}</span>
      </div>
      {hasKids && open
        ? (
          <ul>
            {node.children.map((child) => (
              <LayerRow
                key={child.uid}
                node={child}
                query={query}
                expanded={expanded}
                onToggle={onToggle}
                onExpand={onExpand}
                depth={depth + 1}
              />
            ))}
          </ul>
          )
        : null}
    </li>
  )
}

export default function AtlasMap (props: { folderUrl: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<any>(null)
  const webMapRef = useRef<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [layers, setLayers] = useState<AtlasLayerNode[]>([])
  const [query, setQuery] = useState('')
  const [panelOpen, setPanelOpen] = useState(true)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [exporting, setExporting] = useState(false)
  const [legendOpen, setLegendOpen] = useState(true)
  const [selectedMun, setSelectedMun] = useState<AtlasMunicipioInfo | null>(null)
  const legendRef = useRef<HTMLDivElement>(null)

  const refreshLayers = useCallback(() => {
    const next = listAtlasLayers(webMapRef.current)
    setLayers(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    let dropSelect: (() => void) | null = null
    const init = async () => {
      try {
        await setupAuthentication()
        if (cancelled || !mapRef.current) return
        const webMap = await createWebMap()
        if (cancelled || !mapRef.current) return
        webMapRef.current = webMap
        const view = await createAtlasView(mapRef.current, webMap)
        if (cancelled) {
          view.destroy?.()
          return
        }
        viewRef.current = view
        enableAtlasRootLayers(webMap)
        await bindAtlasMunicipioSearch(view, webMap).catch(() => {})
        dropSelect = enableAtlasMunicipioSelect(
          view,
          webMap,
          (info) => { if (!cancelled) setSelectedMun(info) },
          () => { if (!cancelled) setSelectedMun(null) }
        )
        refreshLayers()
        if (!cancelled) setLoading(false)
      } catch (err) {
        console.error('[atlas] Falha ao carregar o mapa:', err)
        if (!cancelled) {
          setError((err as any)?.message || 'Não foi possível carregar o Atlas.')
          setLoading(false)
        }
      }
    }
    void init()
    return () => {
      cancelled = true
      dropSelect?.()
      viewRef.current?.destroy?.()
      viewRef.current = null
      webMapRef.current = null
    }
  }, [refreshLayers])

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
    if (loading || !legendRef.current || !viewRef.current) return
    let drop: (() => void) | null = null
    void atlasMountLegend(viewRef.current, legendRef.current).then((fn) => { drop = fn })
    return () => { drop?.() }
  }, [loading])

  const counts = useMemo(() => countVisibleLayers(layers), [layers])
  const q = query.trim().toLowerCase()

  const toggle = (uid: string, visible: boolean) => {
    setAtlasLayerVisible(webMapRef.current, uid, visible)
    refreshLayers()
    atlasSyncLegend(viewRef.current?.__atlasLegend, webMapRef.current)
  }

  const toggleExpand = (uid: string) => {
    setExpanded((prev) => ({ ...prev, [uid]: !prev[uid] }))
  }

  const exportPdf = async () => {
    if (exporting || loading) return
    setExporting(true)
    try {
      const view = viewRef.current
      const countsNow = countVisibleLayers(layers)
      const scale = Number(view?.scale)
      const scaleLabel = Number.isFinite(scale)
        ? `1:${Math.round(scale).toLocaleString('pt-BR')}`
        : '—'
      const visibleNames = listAtlasLayerReportRows(layers)
        .filter((row) => row[1] === 'Visível')
        .map((row) => row[0])
      await downloadRelatorioPdf({
        title: 'Relatório do Atlas',
        theme: 'infra',
        scope: selectedMun?.nome || (visibleNames.length ? visibleNames.slice(0, 4).join(' · ') : 'Atlas hídrico da Bahia'),
        source: 'Portal da Água · SIHS/BA · web map do Atlas',
        fileName: `relatorio-atlas-${slugRelatorio(new Date().toLocaleDateString('pt-BR'))}.pdf`,
        kpis: [
          { label: 'Camadas visíveis', value: String(countsNow.on) },
          { label: 'Camadas no mapa', value: String(countsNow.total) },
          { label: 'Escala atual', value: scaleLabel }
        ],
        guide: {
          title: 'Como ler este relatório',
          items: [
            'O mapa abaixo registra a extensão e as camadas ligadas no momento da exportação.',
            'A legenda do mapa no Portal acompanha as camadas visíveis na tela.',
            'Use o painel de camadas para alterar o recorte e gerar um novo PDF.'
          ]
        },
        mapCaption: 'Captura da vista atual do Atlas',
        mapDataUrl: await captureMapView(view),
        sections: [
          {
            title: 'Camadas do Atlas',
            note: 'Situação de cada camada no momento da exportação.',
            table: {
              headers: ['Camada', 'Situação', 'Grupo'],
              rows: listAtlasLayerReportRows(layers),
              colWeights: [2.2, 0.8, 1.4]
            }
          }
        ]
      })
    } catch (err) {
      console.error('[atlas] Falha ao exportar PDF:', err)
      window.alert('Não foi possível gerar o PDF do Atlas.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={`atlas-map${panelOpen ? ' is-open' : ''}`} ref={rootRef}>
      <aside className="atlas-map__panel" aria-label="Camadas do Atlas">
        <header className="atlas-map__panel-head">
          <div>
            <p>Camadas</p>
            <small>{counts.on} de {counts.total} visíveis</small>
          </div>
          <button
            type="button"
            className="atlas-map__collapse"
            aria-label={panelOpen ? 'Recolher camadas' : 'Abrir camadas'}
            onClick={() => setPanelOpen((value) => !value)}
          >
            {panelOpen ? '‹' : '›'}
          </button>
        </header>
        <div className="atlas-map__tools">
          <label className="atlas-map__search">
            <span className="sr-only">Filtrar camadas</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar camada…"
            />
          </label>
          <div className="atlas-map__bulk">
            <button type="button" onClick={() => { setAllAtlasLayersVisible(webMapRef.current, true); refreshLayers(); atlasSyncLegend(viewRef.current?.__atlasLegend, webMapRef.current) }}>
              Todas
            </button>
            <button type="button" onClick={() => { setAllAtlasLayersVisible(webMapRef.current, false); refreshLayers(); atlasSyncLegend(viewRef.current?.__atlasLegend, webMapRef.current) }}>
              Nenhuma
            </button>
          </div>
        </div>
        <ul className="atlas-map__list">
          {layers.length
            ? layers.map((node) => (
              <LayerRow
                key={node.uid}
                node={node}
                query={q}
                expanded={expanded}
                onToggle={toggle}
                onExpand={toggleExpand}
              />
              ))
            : (
              <li className="atlas-map__empty">
                {loading ? 'Carregando camadas…' : 'Nenhuma camada no web map.'}
              </li>
              )}
        </ul>
      </aside>

      <div className="atlas-map__stage">
        <div className="atlas-map__view" ref={mapRef} />
        <button
          type="button"
          className="atlas-map__export"
          disabled={exporting || loading}
          onClick={() => { void exportPdf() }}
        >
          {exporting ? 'Gerando PDF…' : 'Exportar PDF'}
        </button>

        <aside className={`atlas-map__legend-card${legendOpen ? ' is-open' : ''}`}>
          <button
            type="button"
            onClick={() => setLegendOpen((value) => !value)}
            aria-expanded={legendOpen}
          >
            <span>Legenda</span>
            <em>{legendOpen ? '−' : '+'}</em>
          </button>
          <div className="atlas-map__legend" ref={legendRef} hidden={!legendOpen} />
        </aside>

        {selectedMun
          ? (
            <div className="atlas-map__mun" role="complementary" aria-label={`Município — ${selectedMun.nome}`}>
              <button
                type="button"
                className="atlas-map__mun-close"
                aria-label="Limpar seleção"
                onClick={() => {
                  clearAtlasMunicipio(viewRef.current)
                  setSelectedMun(null)
                }}
              >
                ×
              </button>
              <p>Ficha do município</p>
              <h4>{selectedMun.nome}</h4>
              <dl>
                <div>
                  <dt>CODIBGE</dt>
                  <dd>{selectedMun.codigo || '—'}</dd>
                </div>
                <div>
                  <dt>Território de Identidade</dt>
                  <dd>{selectedMun.territorio || '—'}</dd>
                </div>
                <div>
                  <dt>Região Semiárida</dt>
                  <dd>{selectedMun.semiarido || '—'}</dd>
                </div>
              </dl>
            </div>
            )
          : null}

        {loading
          ? <PortalLoader overlay folderUrl={props.folderUrl} label="Carregando Atlas" />
          : null}
        {error
          ? (
            <div className="atlas-map__error">
              <p>{error}</p>
            </div>
            )
          : null}
      </div>
    </div>
  )
}
