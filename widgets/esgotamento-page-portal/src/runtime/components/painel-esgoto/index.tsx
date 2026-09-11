import { React } from 'jimu-core'
import { initPainelEsgoto } from '../../lib/painel'
import { prepareEsgotamentoMap, resizeMapView } from '../../lib/map'
import { loadMunicipiosFromLayer, applySemiaridoFromKeys } from '../../lib/geo'
import { loadSetoresUrbanoRural, querySetoresDoMunicipio } from '../../lib/setores'
import PortalLoader from '../portal-loader'
import './style.css'

type LoadStatus = 'loading' | 'ready' | 'error'

const loadedScripts = new Map<string, Promise<void>>()

function loadScript (src: string): Promise<void> {
  const cached = loadedScripts.get(src)
  if (cached) return cached

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-sihs-esgoto="${src}"]`) as HTMLScriptElement | null
    if (existing) {
      if (existing.dataset.loaded === '1') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`Falha ao carregar ${src}`)), { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = src
    script.async = false
    script.dataset.sihsEsgoto = src
    script.onload = () => {
      script.dataset.loaded = '1'
      resolve()
    }
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`))
    document.head.appendChild(script)
  })

  loadedScripts.set(src, promise)
  return promise
}

function assetUrl (folderUrl: string, fileName: string): string {
  const base = folderUrl.endsWith('/') ? folderUrl : `${folderUrl}/`
  return `${base}dist/runtime/assets/${fileName}`
}

const PainelEsgoto = ({ folderUrl }: { folderUrl: string }) => {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<HTMLDivElement>(null)
  const [status, setStatus] = React.useState<LoadStatus>('loading')
  const [errorMessage, setErrorMessage] = React.useState<string>('')

  React.useLayoutEffect(() => {
    const root = rootRef.current
    const mapNode = mapRef.current
    if (!root || !mapNode) return

    let cancelled = false
    let destroyPainel: (() => void) | undefined
    let view: any
    let observer: ResizeObserver | undefined

    const run = async () => {
      try {
        setErrorMessage('')
        const ptsPromise = loadScript(assetUrl(folderUrl, 'pts-data.js')).catch((error) => {
          console.warn('[esgotamento-page] pts-data.js indisponível:', error)
        })

        const prepared = await prepareEsgotamentoMap(mapNode)
        if (cancelled) {
          prepared.view?.destroy?.()
          return
        }
        view = prepared.view

        const [geoDpa] = await Promise.all([
          loadMunicipiosFromLayer(prepared.layer),
          ptsPromise
        ])
        const geo = applySemiaridoFromKeys(geoDpa, prepared.semiKeys)
        if (cancelled) {
          view?.destroy?.()
          return
        }

        const setoresHolder: {
          type: 'FeatureCollection'
          features: any[]
          __loaded: boolean
          __refresh?: () => void
          __queryMun?: (codMun: string, nmMun?: string) => Promise<any[]>
        } = {
          type: 'FeatureCollection',
          features: [],
          __loaded: false
        }
        if (prepared.setoresLayer) {
          setoresHolder.__queryMun = (codMun, nmMun) =>
            querySetoresDoMunicipio(prepared.setoresLayer, { codMun, nmMun })
        }
        destroyPainel = initPainelEsgoto(
          root,
          geo,
          window.PTS_DATA_ESGOTO || [],
          prepared.mapApi,
          setoresHolder
        )

        observer = typeof ResizeObserver !== 'undefined'
          ? new ResizeObserver(() => { void resizeMapView(view) })
          : undefined
        observer?.observe(mapNode)
        if (mapNode.parentElement) observer?.observe(mapNode.parentElement)
        void resizeMapView(view)
        if (!cancelled) {
          setStatus('ready')
          requestAnimationFrame(() => { void resizeMapView(view) })
        }

        if (prepared.setoresLayer && !cancelled) {
          void loadSetoresUrbanoRural(prepared.setoresLayer, geo)
            .then((setores) => {
              if (cancelled) return
              setoresHolder.features = setores.features || []
              setoresHolder.__loaded = true
              setoresHolder.__refresh?.()
            })
            .catch((error) => {
              console.warn('[esgotamento-page] setores urbano/rural:', error)
              if (cancelled) return
              setoresHolder.features = []
              setoresHolder.__loaded = true
              setoresHolder.__refresh?.()
            })
        } else if (!cancelled) {
          setoresHolder.__loaded = true
          setoresHolder.__refresh?.()
        }
      } catch (error) {
        console.error('[esgotamento-page] Falha ao ligar o web map:', error)
        if (!cancelled) {
          setErrorMessage((error as any)?.message || 'Falha ao carregar o mapa')
          setStatus('error')
        }
      }
    }

    void run()
    return () => {
      cancelled = true
      observer?.disconnect()
      destroyPainel?.()
      view?.destroy?.()
    }
  }, [folderUrl])

  return (
    <div className={`esgo-painel${status !== 'ready' ? ' is-booting' : ''}`} ref={rootRef}>
      {status !== 'ready' && status !== 'error'
        ? <PortalLoader overlay folderUrl={folderUrl} label="Carregando mapa e indicadores" />
        : null}
      {status === 'error'
        ? (
          <p className="esgo-painel__error">
            Não foi possível carregar o web map de esgotamento.
            {errorMessage ? <span className="esgo-painel__error-detail"> {errorMessage}</span> : null}
          </p>
          )
        : null}

      <div className="panel-shell">
        <main>
          <div className="var-banner" role="note">
            <span className="var-banner-label">Variável</span>
            Domicílios particulares permanentes ocupados <span className="var-banner-unit">(SIDRA 6805 · unidades)</span>
            <button type="button" id="btnExportPdf" className="btn-export-pdf">Exportar PDF</button>
          </div>

          <div className="view active" id="view-esgoto">
            <div className="ligacao-board" id="kpiRow-esgoto"></div>

            <div className="stage-row">
              <aside className="stage-filters">
                <div className="panel filters-panel">
                  <div className="panel-header">Filtros e pesquisa</div>
                  <div className="controls">
                    <div className="filter-block">
                      <span className="filter-label">Território de Identidade</span>
                      <select className="regiao-select" id="selectMicro"></select>
                    </div>
                    <div className="filter-block">
                      <button
                        type="button"
                        id="btnSemiToggle"
                        className="semi-region-toggle"
                        aria-pressed="false"
                      >
                        <span>Região Semiárida</span>
                        <strong>Ativar</strong>
                      </button>
                    </div>
                    <div className="filter-block">
                      <span className="filter-label">Município</span>
                      <div className="search-box">
                        <input type="text" id="muniSearch-esgoto" list="muniList-esgoto" placeholder="Consultar município..." />
                        <datalist id="muniList-esgoto"></datalist>
                        <button type="button" id="muniClear" className="btn-clear-muni" title="Desselecionar município" disabled aria-hidden="true">Limpar seleção</button>
                      </div>
                    </div>
                    <div className="filter-block aglomerados-block">
                      <button
                        type="button"
                        id="btnAglomerados"
                        className="btn-aglomerados"
                        disabled
                        aria-expanded="false"
                        aria-controls="aglomeradosModal"
                      >
                        Ver aglomerados
                      </button>
                      <p className="aglomerados-hint" id="aglomeradosHint">Disponível após selecionar um município</p>
                      <div className="popup-panel" id="aglomeradosModal" hidden role="dialog" aria-labelledby="aglomeradosTitle">
                        <div className="popup-header">
                          <h2 id="aglomeradosTitle">Setores censitários do município</h2>
                          <button type="button" className="popup-close" id="aglomeradosClose" aria-label="Fechar">×</button>
                        </div>
                        <div className="popup-body">
                          <div className="table-wrap">
                            <table className="data-table" id="aglomeradosTable">
                              <thead>
                                <tr>
                                  <th>Código do setor</th>
                                  <th>Situação</th>
                                  <th>População</th>
                                  <th>Domicílios</th>
                                </tr>
                              </thead>
                              <tbody id="aglomeradosTbody"></tbody>
                            </table>
                          </div>
                          <p className="empty-msg" id="aglomeradosEmpty" style={{ display: 'none' }}>Nenhum setor censitário encontrado para este município.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel muni-detail-panel recorte-panel" id="muniDetailPanel">
                  <div className="panel-header recorte-panel__head">
                    <div className="recorte-panel__titles">
                      <span className="recorte-panel__kicker">Recorte atual</span>
                      <span className="muni-detail-title" id="muniDetailTitle">Estado da Bahia</span>
                    </div>
                    <button type="button" id="muniDetailClose" className="btn-clear-muni" title="Desselecionar município" hidden>Fechar</button>
                  </div>
                  <div className="panel-body recorte-panel__body" id="muniDetailBody"></div>
                </div>
              </aside>

              <div className="panel stage-map area-map">
                <div className="panel-header">Mapa — ESGOTAMENTO Inventário de Ativos</div>
                <div id="mapWrap-esgoto" className="panel-body map-slot">
                  <div className="esgo-map-view" ref={mapRef} />
                  <div className="map-hint" role="tooltip" aria-hidden="true"></div>
                </div>
              </div>
            </div>

            <div className="data-grid">
              <div className="panel area-comp">
                <div className="panel-header">
                  <span>Formas de esgotamento</span>
                </div>
                <div className="panel-body">
                  <div id="compChart-esgoto"></div>
                </div>
              </div>

              <div className="panel area-setores">
                <div className="panel-header">Urbano e rural — setores censitários</div>
                <div className="panel-body" id="setoresChart-esgoto"></div>
              </div>
            </div>
          </div>
        </main>

        <footer className="meta-footer">
          <span className="meta-label">Data-base</span><b>Censo IBGE 2022</b>
          <span className="meta-dot">·</span>
          <span className="meta-label">Município</span><b>DPA Indicadores · SIDRA 6805</b>
          <span className="meta-dot">·</span>
          <span className="meta-label">Urbano/rural</span><b>Setores censitários IBGE</b>
          <span className="meta-dot">·</span>
          <span className="meta-label">Painel gerado em</span><b id="genDate"></b>
        </footer>
      </div>
    </div>
  )
}

export default PainelEsgoto
