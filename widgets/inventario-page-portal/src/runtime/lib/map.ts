import { loadArcGISJSAPIModules } from 'jimu-arcgis'

function normalizePortalUrl (value: string): string {
  return String(value || '').replace(/\/+$/, '')
}

function isPlaceholder (value?: string): boolean {
  if (!value || typeof value !== 'string') return true
  const normalized = value.trim().toUpperCase()
  return (
    normalized.length === 0 ||
    normalized.startsWith('COLOCAR_') ||
    normalized.includes('AQUI')
  )
}

export async function setupAuthentication (options: {
  portalUrl: string
  oauthAppId?: string
}): Promise<void> {
  const [esriConfig, identityManager, OAuthInfo] = await loadArcGISJSAPIModules([
    'esri/config',
    'esri/identity/IdentityManager',
    'esri/identity/OAuthInfo'
  ])

  const portalUrl = normalizePortalUrl(options.portalUrl)

  if (!isPlaceholder(options.portalUrl)) {
    esriConfig.portalUrl = portalUrl
  }

  if (!isPlaceholder(options.oauthAppId)) {
    const info = new OAuthInfo({
      appId: options.oauthAppId,
      portalUrl,
      popup: true
    })
    identityManager.registerOAuthInfos([info])
  }
}

export async function createWebMap (options: {
  portalUrl: string
  webMapId: string
}): Promise<any> {
  if (isPlaceholder(options.webMapId)) {
    throw new Error('WEB_MAP_ID não configurado.')
  }
  if (isPlaceholder(options.portalUrl)) {
    throw new Error('PORTAL_URL não configurada.')
  }

  const [WebMap] = await loadArcGISJSAPIModules(['esri/WebMap'])
  const portalUrl = normalizePortalUrl(options.portalUrl)

  const webMap = new WebMap({
    portalItem: {
      id: options.webMapId,
      portal: {
        url: portalUrl
      }
    }
  })

  await webMap.load()
  return webMap
}

export async function createMapView (container: HTMLElement, webMap: any): Promise<any> {
  const [MapView, Zoom, Home, Legend, Expand] = await loadArcGISJSAPIModules([
    'esri/views/MapView',
    'esri/widgets/Zoom',
    'esri/widgets/Home',
    'esri/widgets/Legend',
    'esri/widgets/Expand'
  ])

  const view = new MapView({
    container,
    map: webMap,
    constraints: {
      snapToZoom: false
    },
    ui: {
      components: ['attribution']
    }
  })

  await view.when()
  await resizeMapView(view)

  const zoom = new Zoom({ view })
  const home = new Home({ view })
  const legend = new Legend({ view })
  const legendExpand = new Expand({
    view,
    content: legend,
    expanded: false,
    expandTooltip: 'Legenda',
    group: 'top-left'
  })

  view.ui.add([zoom, home, legendExpand], 'top-left')

  if (view.highlightOptions) {
    view.highlightOptions = {
      color: [47, 196, 255],
      haloColor: [255, 255, 255],
      haloOpacity: 1,
      fillOpacity: 0.28
    }
  }

  if (view.extent) {
    await view.goTo(view.extent.clone().expand(1.02), { animate: false })
  }

  return view
}

export async function resizeMapView (view: any): Promise<void> {
  if (!view) return
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (typeof view.resize === 'function') view.resize()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (typeof view.resize === 'function') view.resize()
}

function getSublayers (layer: any): any[] {
  return layer?.allSublayers?.toArray?.() || layer?.sublayers?.toArray?.() || []
}

function isQueryableLayer (layer: any): boolean {
  return !!(
    layer &&
    (typeof layer.queryExtent === 'function' || typeof layer.queryFeatures === 'function')
  )
}

async function resolveQueryableLayer (layer: any): Promise<any | null> {
  if (!layer) return null
  try {
    await layer.load?.()
  } catch (_) {}

  if (isQueryableLayer(layer)) return layer

  for (const sub of getSublayers(layer)) {
    try {
      await sub.load?.()
    } catch (_) {}
    if (isQueryableLayer(sub)) return sub
  }

  return null
}

async function queryLayerExtent (layer: any, where: string): Promise<any | null> {
  const previous = layer.definitionExpression
  try {
    layer.definitionExpression = null
    if (typeof layer.queryExtent === 'function') {
      try {
        const result = await layer.queryExtent({ where })
        if (result?.extent && result.count !== 0) return result.extent
      } catch (_) {}
    }

    if (typeof layer.queryFeatures !== 'function') return layer.fullExtent || layer.extent || null

    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.where = where
    query.returnGeometry = true
    query.outFields = [layer.objectIdField || 'objectid']
    query.num = 2000

    const result = await layer.queryFeatures(query)
    const features = result?.features || []
    if (!features.length) return layer.fullExtent || layer.extent || null

    let extent = features[0].geometry?.extent || null
    for (const feature of features.slice(1)) {
      const next = feature.geometry?.extent
      if (extent && next && typeof extent.union === 'function') {
        extent = extent.union(next)
      } else if (!extent && next) {
        extent = next
      }
    }

    return extent
  } finally {
    layer.definitionExpression = previous
  }
}

export const BAHIA_HOME_EXPAND = 1.4

function padExtent (extent: any, expand = 1): any {
  if (!extent) return extent
  const source = typeof extent.clone === 'function' ? extent.clone() : extent
  if (expand === 1 || typeof source.expand !== 'function') return source
  return source.expand(expand)
}

export async function zoomToWhere (
  view: any,
  layer: any,
  where = '1=1',
  expand = 1.12
): Promise<boolean> {
  if (!view || !layer) return false

  const queryLayer = await resolveQueryableLayer(layer)
  if (!queryLayer) {
    const fallback = layer.fullExtent || layer.extent
    if (!fallback) return false
    const target = padExtent(fallback, expand)
    await view.goTo(target, { duration: 800 })
    return true
  }

  const extent = await queryLayerExtent(queryLayer, where) || queryLayer.fullExtent || queryLayer.extent
  if (!extent) return false

  const target = padExtent(extent, expand)
  await view.goTo(target, { duration: 800 })
  return true
}

export async function zoomToLayerExtent (
  view: any,
  layer: any,
  expand = 1.4
): Promise<boolean> {
  if (!view || !layer) return false
  try {
    await layer.load?.()
  } catch (_) {}
  try {
    await view.whenLayerView?.(layer)
  } catch (_) {}

  const go = async (extent: any): Promise<boolean> => {
    if (!extent) return false
    const padded = padExtent(extent, expand)
    await view.goTo(padded, { duration: 700 })
    return true
  }

  if (await go(layer.fullExtent || layer.extent)) return true
  const queryLayer = await resolveQueryableLayer(layer)
  if (!queryLayer) return false
  const extent = await queryLayerExtent(queryLayer, '1=1')
  return go(extent)
}

export async function zoomToGeometry (view: any, geometry: any): Promise<boolean> {
  if (!view || !geometry) return false
  const extent = geometry.extent || geometry
  const target = padExtent(extent, 1.12)
  await view.goTo(target, { duration: 800 })
  return true
}

interface HighlightState {
  handle: { remove?: () => void } | null
  layer: any | null
  token: number
}

const highlightByView = new WeakMap<object, HighlightState>()

function highlightState (view: any): HighlightState {
  let state = highlightByView.get(view)
  if (!state) {
    state = { handle: null, layer: null, token: 0 }
    highlightByView.set(view, state)
  }
  return state
}

export function clearHighlight (view: any): void {
  if (!view) return
  const state = highlightByView.get(view)
  if (!state) return
  state.token += 1
  state.handle?.remove?.()
  state.handle = null
  state.layer?.removeAll?.()
}

function selectionSymbols (theme: 'default' | 'semiarido' = 'default') {
  if (theme === 'semiarido') {
    return {
      halo: {
        type: 'simple-fill',
        style: 'solid',
        color: [212, 154, 58, 0.18],
        outline: {
          type: 'simple-line',
          color: [255, 244, 214, 0.95],
          width: 6
        }
      },
      fill: {
        type: 'simple-fill',
        style: 'solid',
        color: [212, 154, 58, 0.14],
        outline: {
          type: 'simple-line',
          color: [166, 92, 22, 1],
          width: 2.5
        }
      },
      outline: {
        type: 'simple-fill',
        style: 'solid',
        color: [0, 0, 0, 0],
        outline: {
          type: 'simple-line',
          color: [196, 122, 28, 1],
          width: 3
        }
      },
      marker: {
        type: 'simple-marker',
        style: 'circle',
        color: [212, 154, 58, 0.4],
        size: 16,
        outline: {
          color: [255, 244, 214, 1],
          width: 2.5
        }
      }
    }
  }

  return {
    halo: {
      type: 'simple-fill',
      style: 'solid',
      color: [47, 196, 255, 0.22],
      outline: {
        type: 'simple-line',
        color: [255, 255, 255, 0.95],
        width: 6
      }
    },
    fill: {
      type: 'simple-fill',
      style: 'solid',
      color: [47, 196, 255, 0.16],
      outline: {
        type: 'simple-line',
        color: [0, 34, 49, 1],
        width: 2.5
      }
    },
    outline: {
      type: 'simple-fill',
      style: 'solid',
      color: [0, 0, 0, 0],
      outline: {
        type: 'simple-line',
        color: [0, 34, 49, 1],
        width: 2.5
      }
    },
    marker: {
      type: 'simple-marker',
      style: 'circle',
      color: [47, 196, 255, 0.35],
      size: 16,
      outline: {
        color: [255, 255, 255, 1],
        width: 2.5
      }
    }
  }
}

async function drawHighlightGraphics (
  view: any,
  features: any[],
  options?: { outlineOnly?: boolean, theme?: 'default' | 'semiarido' }
): Promise<boolean> {
  if (!view || !features.length) return false
  const state = highlightState(view)
  const [Graphic, GraphicsLayer] = await loadArcGISJSAPIModules([
    'esri/Graphic',
    'esri/layers/GraphicsLayer'
  ])

  if (!state.layer) {
    state.layer = new GraphicsLayer({
      title: 'Município selecionado',
      listMode: 'hide'
    })
    view.map.add(state.layer)
  }

  const symbols = selectionSymbols(options?.theme)
  const outlineOnly = Boolean(options?.outlineOnly)
  state.layer.removeAll()
  for (const feature of features) {
    const geometry = feature?.geometry
    if (!geometry) continue
    if (geometry.type === 'point' || geometry.type === 'multipoint') {
      state.layer.add(new Graphic({ geometry, symbol: symbols.marker }))
      continue
    }
    if (outlineOnly) {
      state.layer.add(new Graphic({ geometry, symbol: symbols.outline }))
      continue
    }
    state.layer.add(new Graphic({ geometry, symbol: symbols.halo }))
    state.layer.add(new Graphic({ geometry, symbol: symbols.fill }))
  }
  return state.layer.graphics?.length > 0
}

async function highlightLayerView (view: any, layer: any, graphic: any): Promise<void> {
  if (!view || !layer || !graphic) return
  const state = highlightState(view)
  try {
    const layerView = await view.whenLayerView(layer)
    const oidField = layer.objectIdField || 'OBJECTID'
    const oid = graphic.attributes?.[oidField] ??
      graphic.attributes?.OBJECTID ??
      graphic.attributes?.objectid
    if (oid == null || typeof layerView?.highlight !== 'function') return
    state.handle?.remove?.()
    state.handle = layerView.highlight(oid)
  } catch (_) {}
}

export async function highlightFeature (
  view: any,
  graphic: any,
  layer?: any
): Promise<boolean> {
  if (!view || !graphic) return false
  const state = highlightState(view)
  const token = state.token + 1
  clearHighlight(view)
  state.token = token

  let geometry = graphic.geometry
  const sourceLayer = layer || graphic.layer
  if (!geometry && sourceLayer && typeof sourceLayer.queryFeatures === 'function') {
    const oidField = sourceLayer.objectIdField || 'OBJECTID'
    const oid = graphic.attributes?.[oidField] ??
      graphic.attributes?.OBJECTID ??
      graphic.attributes?.objectid
    if (oid != null) {
      try {
        const query = sourceLayer.createQuery ? sourceLayer.createQuery() : {}
        query.objectIds = [oid]
        query.returnGeometry = true
        query.outFields = [oidField]
        const result = await sourceLayer.queryFeatures(query)
        geometry = result?.features?.[0]?.geometry
        if (result?.features?.[0]) graphic = result.features[0]
      } catch (_) {}
    }
  }

  if (state.token !== token) return false
  if (!geometry) return false

  const ok = await drawHighlightGraphics(view, [{ geometry }])
  if (state.token !== token) return false
  await highlightLayerView(view, sourceLayer, graphic)
  return ok
}

export async function highlightWhere (
  view: any,
  layer: any,
  where: string,
  options?: { outlineOnly?: boolean, maxFeatures?: number, allowAll?: boolean, theme?: 'default' | 'semiarido' }
): Promise<boolean> {
  if (!view || !layer || !where) return false
  if (where === '1=1' && !options?.allowAll) return false

  const state = highlightState(view)
  const token = state.token + 1
  clearHighlight(view)
  state.token = token

  const queryLayer = await resolveQueryableLayer(layer)
  if (!queryLayer || typeof queryLayer.queryFeatures !== 'function') return false

  const previous = queryLayer.definitionExpression
  queryLayer.definitionExpression = null
  let result: any
  try {
    const query = typeof queryLayer.createQuery === 'function' ? queryLayer.createQuery() : {}
    query.where = where
    query.returnGeometry = true
    query.outFields = [queryLayer.objectIdField || 'objectid']
    query.num = options?.maxFeatures || 8
    if (options?.outlineOnly) {
      try { query.maxAllowableOffset = 0.002 } catch (_) {}
    }
    result = await queryLayer.queryFeatures(query)
  } finally {
    queryLayer.definitionExpression = previous
  }

  if (state.token !== token) return false

  const features = (result?.features || []).filter((feature: any) => feature?.geometry)
  if (!features.length) return false

  const ok = await drawHighlightGraphics(view, features, {
    outlineOnly: options?.outlineOnly,
    theme: options?.theme
  })
  if (state.token !== token) return false
  if (!options?.outlineOnly) {
    await highlightLayerView(view, queryLayer, features[0])
  }
  return ok
}

export function enableFeatureSelection (view: any, onSelect?: (payload: any) => void): IHandle | null {
  if (!view) return null

  return view.on('click', async (event: any) => {
    try {
      const response = await view.hitTest(event, {
        include: view.map.allLayers
      })

      const hit = response.results.find((result: any) => {
        return (
          result.type === 'graphic' &&
          result.graphic &&
          result.graphic.layer &&
          result.graphic.attributes &&
          (result.graphic.layer.type === 'feature' ||
            result.graphic.layer.type === 'subtype-group')
        )
      })

      if (!hit) {
        onSelect?.(null)
        return
      }

      const { graphic } = hit
      onSelect?.({
        graphic,
        layer: graphic.layer,
        attributes: graphic.attributes
      })
    } catch (error) {
      console.error('[map] Erro no hitTest/seleção:', error)
    }
  })
}

interface IHandle {
  remove: () => void
}

export async function unionGeometries (geometries: any[]): Promise<any | null> {
  const valid = (geometries || []).filter(Boolean)
  if (!valid.length) return null
  if (valid.length === 1) return valid[0]

  try {
    const [geometryEngine] = await loadArcGISJSAPIModules(['esri/geometry/geometryEngine'])
    return geometryEngine.union(valid)
  } catch (error) {
    console.warn('[map] Falha ao unir geometrias com geometryEngine:', error)
    let acc = valid[0]
    for (const geom of valid.slice(1)) {
      if (acc && typeof acc.union === 'function') {
        acc = acc.union(geom)
      }
    }
    return acc
  }
}

export type MunicipioPopupData = {
  nome: string
  territorio: string
  semiarido: string
  populacao: number | null
  codMun: string | null
  extraFields: Array<{ label: string, value: string }>
}

function normalizeMunText (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function normalizeMunKey (value: string): string {
  return normalizeMunText(value).replace(/[^a-z0-9]/g, '')
}

function resolveMunField (fields: any[], candidates: string[], fallback: string): string {
  const byText = new Map<string, string>()
  const byKey = new Map<string, string>()
  for (const f of fields || []) {
    const name = String(f?.name || '')
    if (!name) continue
    byText.set(normalizeMunText(name), name)
    byKey.set(normalizeMunKey(name), name)
    const alias = String(f?.alias || '')
    if (alias) {
      byText.set(normalizeMunText(alias), name)
      byKey.set(normalizeMunKey(alias), name)
    }
  }
  for (const c of candidates) {
    const exact = byText.get(normalizeMunText(c))
    if (exact) return exact
    const keyed = byKey.get(normalizeMunKey(c))
    if (keyed) return keyed
  }
  return fallback
}

function formatMunNumber (value: any): string {
  if (value == null || value === '') return 'Sem dado'
  const num = Number(value)
  if (!Number.isFinite(num)) return 'Sem dado'
  return new Intl.NumberFormat('pt-BR').format(num)
}

function formatMunDate (value: any): string | null {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString('pt-BR')
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN
    if (Number.isFinite(ms)) {
      const d = new Date(ms)
      if (d.getFullYear() > 1900 && d.getFullYear() < 2100) {
        return d.toLocaleDateString('pt-BR')
      }
    }
  }
  const text = String(value).trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`)
    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('pt-BR')
  }
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return text
  return null
}

function formatMunValue (raw: any): string {
  if (raw == null || raw === '') return 'Sem dado'
  if (typeof raw === 'number' && !Number.isFinite(raw)) return 'Sem dado'
  const asDate = formatMunDate(raw)
  if (asDate) return asDate
  if (typeof raw === 'number' && Number.isFinite(raw)) return formatMunNumber(raw)
  const text = String(raw).trim()
  if (!text || /^nan$/i.test(text)) return 'Sem dado'
  return text
}

export function isMunicipioLayer (layer: any): boolean {
  if (!layer) return false
  const title = normalizeMunKey(layer?.title || layer?.name || '')
  const url = normalizeMunKey(String(layer?.url || ''))
  if (title.includes('pdaindicadorescenso') || title.includes('dpaindicadorescenso')) return true
  if (url.includes('pdaindicadorescenso') || url.includes('dpaindicadorescenso')) return true
  if (title === 'municipios' || title === 'limitesmunicipais' || title === 'limitemunicipal') return true
  if (title.includes('municipio') && !/sistema|setor|saneamento|aglomerado|abastec|esgoto/.test(title)) {
    return true
  }
  return false
}

export function disableNativePopup (view: any, webMap?: any): void {
  if (!view) return
  try {
    if (view.popup) {
      view.popup.autoOpenEnabled = false
      view.popupEnabled = false
      view.popup.visibleElements = { content: false, title: false }
      view.popup.actions = []
    }
  } catch (_) {}
  if (!webMap) return
  try {
    const layers = webMap?.allLayers?.toArray?.() || []
    for (const l of layers) {
      if (l && typeof l.popupEnabled === 'boolean') l.popupEnabled = false
    }
  } catch (_) {}
}

export async function extractMunicipioFromHit (
  hit: any,
  layer?: any
): Promise<{ layer: any, graphic: any } | null> {
  const results = hit?.results || []
  for (const r of results) {
    const g = r?.graphic
    const lyr = r?.layer || g?.layer
    if (g && g.attributes && (isMunicipioLayer(lyr) || (layer && lyr === layer))) {
      return { layer: lyr || layer, graphic: g }
    }
  }
  return null
}

/**
 * Fallback quando o hitTest não encontra feição (camada coberta, fill transparente, etc.).
 * Consulta o município sob o ponto clicado no mapa.
 */
export async function queryMunicipioAtPoint (
  layer: any,
  mapPoint: any
): Promise<{ layer: any, graphic: any } | null> {
  if (!layer || !mapPoint || typeof layer.queryFeatures !== 'function') return null
  try { await layer.load?.() } catch (_) {}

  const nameField = (() => {
    const fields = layer.fields || []
    const preferred = [
      'nome_do_municipio', 'nome_municipio', 'nm_municipio', 'nom_municipio',
      'nm_mun', 'municipio', 'nome'
    ]
    const byLower = new Map(
      fields.map((f: any) => [String(f?.name || '').toLowerCase(), String(f?.name || '')])
    )
    for (const candidate of preferred) {
      const hit = byLower.get(candidate.toLowerCase())
      if (hit) return hit
    }
    return layer.displayField || preferred[0]
  })()

  const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
  query.geometry = mapPoint
  query.spatialRelationship = 'intersects'
  query.returnGeometry = true
  query.outFields = ['*']
  query.num = 1
  // Permite clicar em qualquer município, mesmo com filtro territorial ativo na camada
  const previousWhere = layer.definitionExpression
  try {
    layer.definitionExpression = null
    const result = await layer.queryFeatures(query)
    const feature = result?.features?.[0]
    if (!feature?.attributes) return null
    if (nameField && feature.attributes[nameField] == null) {
      const key = Object.keys(feature.attributes).find((k) => k.toLowerCase() === nameField.toLowerCase())
      if (key) feature.attributes[nameField] = feature.attributes[key]
    }
    return { layer, graphic: feature }
  } catch (error) {
    console.warn('[map] queryMunicipioAtPoint falhou:', error)
    return null
  } finally {
    layer.definitionExpression = previousWhere
  }
}

export async function buildMunicipioPopupData (
  layer: any,
  attrs: Record<string, any> | null | undefined
): Promise<MunicipioPopupData> {
  const fields: any[] = layer?.fields || []
  await layer?.load?.().catch(() => {})

  const a = attrs || {}
  const attrKeys = Object.keys(a).filter((k) => a[k] != null && String(a[k]).trim() !== '')
  const attrByNorm = new Map<string, string>()
  for (const k of attrKeys) attrByNorm.set(normalizeMunKey(k), k)

  const fieldsByKey = new Map<string, any>()
  for (const f of fields || []) {
    const n = String(f?.name || '')
    if (n) {
      fieldsByKey.set(normalizeMunKey(n), f)
      const alias = String(f?.alias || '')
      if (alias) fieldsByKey.set(normalizeMunKey(alias), f)
    }
  }

  const pickAttrKey = (candidates: string[]): string | null => {
    for (const c of candidates) {
      const k = normalizeMunKey(c)
      if (attrByNorm.has(k)) return attrByNorm.get(k)!
      if (fieldsByKey.has(k)) {
        const f = fieldsByKey.get(k)
        const fname = String(f?.name || '')
        if (fname && (a[fname] != null || a[fname.toLowerCase()] != null)) return fname
      }
    }
    return null
  }

  const nameCandidates = [
    'nome_do_municipio', 'nome_municipio', 'nm_municipio', 'nom_municipio',
    'municipio_nome', 'nm_mun', 'nm_mun_1', 'municipio', 'nome',
    'municipios', 'nome_municip', 'mun_nome'
  ]
  const tiCandidates = [
    'territorio_de_indentidade', 'territorio_de_identidade',
    'nm_territorio_identidade', 'nm_territorio_de_identidade',
    'territorio', 'nm_ti', 'ti', 'territorio_identidade'
  ]
  const semiCandidates = [
    'regiao_do_semiarida', 'região_do_semiarida',
    'semiarido', 'semiarido_ba', 'no_semiarido', 'fl_semiarido',
    'pertence_semiarido', 'regiao_semiarida'
  ]
  const popCandidates = [
    'estimativa_pop_2026', 'pop_est_2026', 'estimativa_pop2026',
    'populacao_estimada_2026', 'pop_2026', 'pop_est_2026',
    'populacao_estimada', 'pop_estimada', 'populacao estimada',
    'estimativa_pop_2025', 'pop_est_2025', 'estimativa_pop2025',
    'populacao_estimada_2025', 'pop_2025',
    'populacao__2022_', 'população__2022_', 'populacao_2022', 'população_2022',
    'pop_2022', 'populacao', 'populacao_total',
    'total_1', 'pop', 'habitantes'
  ]
  const codCandidates = [
    'codigo_do_municipio', 'codígo_do_municipio',
    'codigo_municipio', 'cod_municipio', 'cd_municipio',
    'codibge', 'cd_ibge', 'ibge', 'ibge_codigo',
    'cd_mun', 'cod_mun', 'geocodigo', 'geocodigo_municipio',
    'geocodigo_ibge', 'codigo_ibge'
  ]

  const nameField = pickAttrKey(nameCandidates) ?? resolveMunField(fields, nameCandidates, 'nome_do_municipio')
  const tiField = pickAttrKey(tiCandidates) ?? resolveMunField(fields, tiCandidates, 'territorio_de_indentidade')
  const semiField = pickAttrKey(semiCandidates) ?? resolveMunField(fields, semiCandidates, 'região_do_semiarida')
  const popField = pickAttrKey(['pop_est_2026', ...popCandidates]) ||
    resolveMunField(fields, ['pop_est_2026', ...popCandidates], 'pop_est_2026')
  const codField = pickAttrKey(codCandidates) ?? resolveMunField(fields, codCandidates, 'codibge')

  const getAttr = (field: string): any => a[field] ?? a[field?.toLowerCase?.() ?? '']

  const semiRaw = String(getAttr(semiField) ?? '').trim()
  const semiNorm = semiRaw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
  const semiarido = semiNorm === 'SIM' ? 'Sim' : semiNorm === 'NAO' || semiNorm === 'NÃO' ? 'Não' : semiRaw || 'Não'

  const popRaw = getAttr(popField)
  const populacao = (popRaw == null || popRaw === '') ? null : (Number.isFinite(Number(popRaw)) ? Number(popRaw) : null)

  const codRaw = getAttr(codField)
  let codMun: string | null = null
  if (codRaw != null && codRaw !== '') {
    const n = Number(codRaw)
    if (Number.isFinite(n) && n > 0) codMun = String(Math.round(n))
    else codMun = String(codRaw)
  }

  const skip = new Set<string>()
  for (const f of [nameField, tiField, semiField, popField, codField]) {
    skip.add(normalizeMunKey(f))
  }
  const preferredLabels: Array<{ match: (name: string) => boolean, label: string }> = [
    { match: (n) => /area.*km/i.test(n), label: 'Área (km²)' },
    { match: (n) => /densidade|dens.*pop/i.test(n), label: 'Densidade demográfica' },
    { match: (n) => /idh/i.test(n), label: 'IDH' },
    { match: (n) => /pib|produto/i.test(n), label: 'PIB' },
    { match: (n) => /renda|per.?capta/i.test(n), label: 'Renda per capita' }
  ]

  const extraFields: Array<{ label: string, value: string, priority: number }> = []
  let fallbackName: string | null = null
  let fallbackTi: string | null = null
  for (const key of attrKeys) {
    const kkey = normalizeMunKey(key)
    if (skip.has(kkey)) continue
    const raw = a[key]
    const fmeta = fieldsByKey.get(kkey)
    const alias = normalizeMunText(fmeta?.alias || key)

    if (!fallbackName && /nome.*mun|mun.*nome|nm.*mun|mun.*nm|municipio/i.test(alias)) {
      fallbackName = String(raw).trim()
    }
    if (!fallbackTi && /territorio|territ.*ident|nm.*ti|^ti$/i.test(alias)) {
      fallbackTi = String(raw).trim()
    }

    const matched = preferredLabels.find((p) => p.match(alias) || p.match(normalizeMunText(key)))
    const label = matched?.label || (fmeta?.alias || key)
    extraFields.push({
      label,
      value: formatMunValue(raw),
      priority: matched ? 0 : 1
    })
  }
  const nameK = normalizeMunKey(nameField)
  const tiK = normalizeMunKey(tiField)
  for (const f of fields || []) {
    const fname = String(f?.name || '')
    if (!fname) continue
    const fkey = normalizeMunKey(fname)
    if (skip.has(fkey)) continue
    if (attrByNorm.has(fkey)) continue
    const raw = a[fname] ?? a[fname.toLowerCase()]
    if (raw == null || raw === '' || String(raw).trim() === '') continue
    if (nameK === fkey || tiK === fkey) continue
    const alias = normalizeMunText(f?.alias || fname)
    const matched = preferredLabels.find((p) => p.match(alias) || p.match(normalizeMunText(fname)))
    const label = matched?.label || (f?.alias || fname)
    extraFields.push({ label, value: formatMunValue(raw), priority: matched ? 0 : 1 })
  }
  extraFields.sort((a, b) => a.priority - b.priority)
  const MAX_EXTRA = 20
  const finalExtras = extraFields
    .slice(0, MAX_EXTRA)
    .map(({ label, value }) => ({ label, value }))

  const nomeResolvido = String(getAttr(nameField) ?? '').trim()
  const nomeFinal = nomeResolvido || fallbackName || 'Município'
  const territorioResolvido = String(getAttr(tiField) ?? '').trim() || '—'
  const territorioFinal = territorioResolvido !== '—' ? territorioResolvido : (fallbackTi && fallbackTi.trim() ? fallbackTi : '—')

  return {
    nome: nomeFinal,
    territorio: territorioFinal,
    semiarido,
    populacao,
    codMun,
    extraFields: finalExtras
  }
}

export function positionMunicipioPopup (
  popupEl: HTMLElement,
  viewContainer: HTMLElement,
  clientX: number,
  clientY: number
): { left: number, top: number, arrowLeft: number, above: boolean } {
  const rect = viewContainer.getBoundingClientRect()
  const gap = 14
  const margin = 12
  const popWidth = popupEl.offsetWidth || 340
  const popHeight = popupEl.offsetHeight || 200

  let left = clientX - rect.left - popWidth / 2
  left = Math.max(margin, Math.min(left, rect.width - popWidth - margin))

  let above = false
  let top = clientY - rect.top + gap
  const spaceBelow = rect.bottom - clientY - gap
  if (spaceBelow < Math.min(popHeight, 200) && clientY - rect.top > popHeight + gap) {
    top = clientY - rect.top - popHeight - gap
    above = true
  }

  const arrowCenter = clientX - rect.left - left
  const arrowLeft = Math.max(22, Math.min(arrowCenter, popWidth - 22))

  return { left, top, arrowLeft, above }
}

export type MunicipioClickHandle = { remove: () => void }

export function municipioNameFromGraphic (layer: any, graphic: any): string | null {
  const attrs = graphic?.attributes || {}
  const keys = Object.keys(attrs)
  const byLower = new Map(keys.map((key) => [key.toLowerCase(), key]))
  const preferred = [
    'nome_do_municipio',
    'nm_mun_1',
    'nm_mun',
    'municipio',
    'nome_municipio',
    'nm_municipio',
    'nom_municipio',
    'nome'
  ]

  const fields = (layer?.fields || []).map((field: any) => String(field?.name || ''))
  const fieldLower = new Set(fields.map((name: string) => name.toLowerCase()))
  for (const name of fields) {
    if (/nome.*mun|mun.*nome|nm_mun|municipio/i.test(name) && !preferred.includes(name)) {
      preferred.push(name)
    }
  }

  for (const candidate of preferred) {
    const key = byLower.get(candidate.toLowerCase())
    if (!key) continue
    const value = String(attrs[key] ?? '').trim()
    if (value) return value
  }

  for (const key of keys) {
    if (!/mun|nome/i.test(key)) continue
    if (fieldLower.size && !fieldLower.has(key.toLowerCase()) && !/mun/i.test(key)) continue
    const value = String(attrs[key] ?? '').trim()
    if (value && !/^\d+$/.test(value)) return value
  }
  return null
}

export function enableMunicipioHighlight (
  view: any,
  options: {
    webMap?: any
    layer?: any
    onSelect?: (payload: { name: string, graphic: any, layer: any } | null) => void
  }
): MunicipioClickHandle {
  if (!view) return { remove: () => {} }
  disableNativePopup(view, options.webMap)

  // Garante camada de município desenhável para hitTest (quando existir no mapa)
  if (options.layer) {
    try {
      options.layer.visible = true
      let parent = options.layer.parent
      while (parent && typeof parent === 'object' && 'visible' in parent) {
        parent.visible = true
        parent = parent.parent
      }
    } catch (_) {}
  }

  const clickHandle = view.on('click', async (event: any) => {
    try {
      const munLayer = options.layer
      const opts: any = {}
      if (munLayer) opts.include = munLayer
      else if (options.webMap) opts.include = options.webMap.allLayers

      const hit = await view.hitTest(event, opts)
      let found = await extractMunicipioFromHit(hit, munLayer)

      // Fallback: consulta espacial no ponto (funciona mesmo com camada coberta)
      if (!found && munLayer && event?.mapPoint) {
        found = await queryMunicipioAtPoint(munLayer, event.mapPoint)
      }

      if (!found) {
        clearHighlight(view)
        options.onSelect?.(null)
        return
      }
      const name = municipioNameFromGraphic(found.layer, found.graphic)
      if (!name) {
        clearHighlight(view)
        options.onSelect?.(null)
        return
      }
      void highlightFeature(view, found.graphic, found.layer)
      options.onSelect?.({ name, graphic: found.graphic, layer: found.layer })
    } catch (err) {
      console.warn('[map] Falha no destaque de município:', err)
    }
  })

  return {
    remove: () => {
      try { clickHandle?.remove?.() } catch (_) {}
    }
  }
}

export function enableMunicipioCustomPopup (
  view: any,
  options: {
    viewContainer: HTMLElement
    webMap?: any
    layer?: any
    onOpen: (data: MunicipioPopupData, clientX: number, clientY: number) => void
    onClose: () => void
  }
): MunicipioClickHandle {
  if (!view) return { remove: () => {} }
  disableNativePopup(view, options.webMap)

  const clickHandle = view.on('click', async (event: any) => {
    try {
      const native = event?.native || event
      const clientX = native.clientX ?? event?.x
      const clientY = native.clientY ?? event?.y
      const opts: any = {}
      if (options.layer) opts.include = options.layer
      else if (options.webMap) opts.include = options.webMap.allLayers

      const hit = await view.hitTest(event, opts)
      const found = await extractMunicipioFromHit(hit, options.layer)
      if (!found) {
        clearHighlight(view)
        options.onClose()
        return
      }
      void highlightFeature(view, found.graphic, found.layer)
      const data = await buildMunicipioPopupData(found.layer, found.graphic.attributes)
      options.onOpen(data, clientX, clientY)
    } catch (err) {
      console.warn('[map] Falha no clique de município:', err)
    }
  })

  const moveHandle = view.on('pointer-move', () => {})
  return {
    remove: () => {
      try { clickHandle?.remove?.() } catch (_) {}
      try { moveHandle?.remove?.() } catch (_) {}
    }
  }
}
