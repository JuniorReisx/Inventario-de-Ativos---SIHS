import { loadArcGISJSAPIModules } from 'jimu-arcgis'
import { normalizeMunName, resolveMunFields } from './municipios'
import { findMunicipioLayer, getAllLayers } from './layers'

const PORTAL_URL = 'https://portaldaagua.sihs.ba.gov.br/portal'
const WEB_MAP_ID = '8fd43aa62abc49efac53cf5431b32a3a'

function normalizePortalUrl (value: string): string {
  return String(value || '').replace(/\/+$/, '')
}

export async function setupAuthentication (portalUrl = PORTAL_URL): Promise<void> {
  const [esriConfig] = await loadArcGISJSAPIModules(['esri/config'])
  esriConfig.portalUrl = normalizePortalUrl(portalUrl)
}

export async function createWebMap (
  portalUrl = PORTAL_URL,
  webMapId = WEB_MAP_ID
): Promise<any> {
  const [WebMap] = await loadArcGISJSAPIModules(['esri/WebMap'])

  const webMap = new WebMap({
    portalItem: {
      id: webMapId,
      portal: {
        url: normalizePortalUrl(portalUrl)
      }
    }
  })

  await webMap.load()
  return webMap
}

function addBasemapSwitcher (
  view: any,
  Expand: any,
  BasemapGallery: any,
  Basemap: any,
  LocalBasemapsSource: any
): void {
  const seen = new Set<string>()
  const basemaps: any[] = []
  const push = (basemap: any) => {
    if (!basemap) return
    const key = String(basemap.id || basemap.title || '').toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    basemaps.push(basemap)
  }

  push(view.map?.basemap)
  for (const id of ['hybrid', 'satellite', 'streets-vector', 'topo-vector', 'gray-vector', 'osm']) {
    try {
      push(Basemap.fromId(id))
    } catch (_) {}
  }

  const gallery = new BasemapGallery({
    view,
    source: new LocalBasemapsSource({ basemaps })
  })

  view.ui.add(new Expand({
    view,
    content: gallery,
    expanded: false,
    expandIcon: 'basemap',
    expandTooltip: 'Alterar mapa de fundo',
    collapseTooltip: 'Fechar mapas de fundo',
    mode: 'floating'
  }), 'top-right')
}

export async function createMapView (container: HTMLElement, webMap: any): Promise<any> {
  const [MapView, Zoom, Home, Expand, BasemapGallery, Basemap, LocalBasemapsSource] = await loadArcGISJSAPIModules([
    'esri/views/MapView',
    'esri/widgets/Zoom',
    'esri/widgets/Home',
    'esri/widgets/Expand',
    'esri/widgets/BasemapGallery',
    'esri/Basemap',
    'esri/widgets/BasemapGallery/support/LocalBasemapsSource'
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

  view.ui.add([new Zoom({ view }), new Home({ view })], 'top-left')
  addBasemapSwitcher(view, Expand, BasemapGallery, Basemap, LocalBasemapsSource)

  if (view.highlightOptions) {
    view.highlightOptions = {
      color: [47, 196, 255],
      haloOpacity: 0.95,
      fillOpacity: 0.22
    }
  }

  if (view.extent) {
    await view.goTo(view.extent.clone().expand(1.02), { animate: false })
  }
  captureHomeViewpoint(view)

  return view
}

export async function resizeMapView (view: any): Promise<void> {
  if (!view) return
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (typeof view.resize === 'function') view.resize()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (typeof view.resize === 'function') view.resize()
}

function resolveExtent (geometry: any): any | null {
  if (!geometry) return null
  if (geometry.type === 'extent' || typeof geometry.expand === 'function') return geometry
  return geometry.extent || null
}

function isGeographicExtent (extent: any): boolean {
  const wkid = Number(extent?.spatialReference?.wkid || extent?.spatialReference?.latestWkid)
  if (wkid === 4326 || wkid === 4269) return true
  const width = Number(extent?.width)
  const height = Number(extent?.height)
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && width < 8 && height < 8
}

function isTinyExtent (extent: any): boolean {
  const width = Number(extent?.width)
  const height = Number(extent?.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true
  if (width <= 0 && height <= 0) return true
  if (isGeographicExtent(extent)) return width < 0.003 && height < 0.003
  return width < 120 && height < 120
}

export async function geometryContains (container: any, inner: any): Promise<boolean | null> {
  if (!container || !inner) return null
  try {
    const [geometryEngine] = await loadArcGISJSAPIModules(['esri/geometry/geometryEngine'])
    const candidate = inner?.type === 'point' || inner?.type === 'multipoint'
      ? inner
      : inner?.centroid || inner?.extent?.center || inner
    if (typeof geometryEngine.contains === 'function') {
      return Boolean(geometryEngine.contains(container, candidate))
    }
    if (typeof geometryEngine.intersects === 'function') {
      return Boolean(geometryEngine.intersects(container, candidate))
    }
    return null
  } catch {
    return null
  }
}

export async function zoomToGeometry (
  view: any,
  geometry: any,
  options?: { scale?: number }
): Promise<boolean> {
  if (!view || !geometry) return false

  const type = geometry.type
  const extent = resolveExtent(geometry)
  const scale = options?.scale
  if (type === 'point' || type === 'multipoint' || isTinyExtent(extent)) {
    await view.goTo({ target: geometry, scale: scale || 50000 }, { duration: 900 })
    return true
  }

  if (scale) {
    await view.goTo({ target: geometry, scale }, { duration: 900 })
    return true
  }

  const target = typeof extent?.expand === 'function' ? extent.expand(1.65) : extent || geometry
  await view.goTo(target, { duration: 800 })
  return true
}

export async function withoutDefinitionExpression<T> (layer: any, run: () => Promise<T>): Promise<T> {
  const previous = layer.definitionExpression
  layer.definitionExpression = null
  try {
    return await run()
  } finally {
    layer.definitionExpression = previous
  }
}

export async function zoomToWhere (
  view: any,
  layer: any,
  where = '1=1',
  options?: { scale?: number }
): Promise<boolean> {
  if (!view || !layer) return false

  await layer.load?.()

  return withoutDefinitionExpression(layer, async () => {
    if (typeof layer.queryExtent === 'function') {
      const result = await layer.queryExtent({ where })
      if (result?.extent && result.count !== 0 && !isTinyExtent(result.extent)) {
        return zoomToGeometry(view, result.extent, options)
      }
    }

    if (typeof layer.queryFeatures !== 'function') return false

    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.where = where
    query.returnGeometry = true
    query.outFields = [layer.objectIdField || 'objectid']
    query.num = 1

    const result = await layer.queryFeatures(query)
    const geometry = result?.features?.[0]?.geometry
    if (!geometry) return false
    return zoomToGeometry(view, geometry, options)
  })
}

export async function zoomToExtent (view: any, extent: any): Promise<boolean> {
  if (!view || !extent) return false
  const target = typeof extent.clone === 'function' ? extent.clone() : extent
  await view.goTo(target, { duration: 800 })
  return true
}

export async function queryFirstGeometry (layer: any, where = '1=1'): Promise<any | null> {
  if (!layer || typeof layer.queryFeatures !== 'function') return null
  await layer.load?.()
  return withoutDefinitionExpression(layer, async () => {
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.where = where
    query.returnGeometry = true
    query.outFields = [layer.objectIdField || 'objectid']
    query.num = 1
    const result = await layer.queryFeatures(query)
    return result?.features?.[0]?.geometry || null
  })
}

export async function queryUnionGeometry (layer: any, where = '1=1'): Promise<any | null> {
  if (!layer || typeof layer.queryFeatures !== 'function') return null
  await layer.load?.()
  return withoutDefinitionExpression(layer, async () => {
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.where = where
    query.returnGeometry = true
    query.outFields = [layer.objectIdField || 'objectid']
    query.num = 80
    const result = await layer.queryFeatures(query)
    const geometries = (result?.features || [])
      .map((feature: any) => feature?.geometry)
      .filter(Boolean)
    if (!geometries.length) return null
    if (geometries.length === 1) return geometries[0]
    try {
      const [geometryEngine] = await loadArcGISJSAPIModules(['esri/geometry/geometryEngine'])
      return geometryEngine.union(geometries)
    } catch {
      return geometries[0]
    }
  })
}

export async function zoomToLayerExtent (
  view: any,
  layer: any,
  expand = 1.4
): Promise<boolean> {
  if (!view || !layer) return false
  await layer.load?.()

  const go = async (extent: any): Promise<boolean> => {
    if (!extent || isTinyExtent(extent)) return false
    const padded = typeof extent.expand === 'function' ? extent.expand(expand) : extent
    await view.goTo(padded, { duration: 550 })
    return true
  }

  const full = layer.fullExtent
  if (await go(full)) return true

  if (typeof layer.queryExtent !== 'function') return false

  return withoutDefinitionExpression(layer, async () => {
    const result = await layer.queryExtent({ where: '1=1' })
    return go(result?.extent)
  })
}

interface HighlightState {
  handle: { remove?: () => void } | null
  layer: any | null
  token: number
}

const highlightByView = new WeakMap<object, HighlightState>()
const homeByView = new WeakMap<object, any>()
const selectedMunByView = new WeakMap<object, string>()

export function captureHomeViewpoint (view: any): void {
  if (!view || homeByView.has(view)) return
  const viewpoint = view.viewpoint?.clone?.()
  if (viewpoint) homeByView.set(view, viewpoint)
}

export async function resetMunicipioView (view: any): Promise<void> {
  if (!view) return
  const hadSelection = selectedMunByView.has(view)
  clearHighlight(view)
  selectedMunByView.delete(view)
  const home = homeByView.get(view)
  if (!hadSelection || !home) return
  try {
    await view.goTo(home, { duration: 800 })
  } catch {
  }
}

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

export async function highlightWhere (
  view: any,
  layer: any,
  where: string,
  options?: {
    outlineOnly?: boolean
    maxFeatures?: number
    maxAllowableOffset?: number
    theme?: 'default' | 'semiarido'
  }
): Promise<boolean> {
  if (!view || !layer) return false

  const state = highlightState(view)
  const token = state.token + 1
  clearHighlight(view)
  state.token = token

  const [Graphic, GraphicsLayer] = await loadArcGISJSAPIModules([
    'esri/Graphic',
    'esri/layers/GraphicsLayer'
  ])

  if (state.token !== token) return false

  await layer.load?.()

  const result = await withoutDefinitionExpression(layer, async () => {
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.where = where
    query.returnGeometry = true
    query.returnZ = false
    query.returnM = false
    query.outFields = [layer.objectIdField || 'objectid']
    query.num = options?.maxFeatures || 200
    const offset = options?.maxAllowableOffset
    if (Number.isFinite(offset) && Number(offset) > 0) {
      query.maxAllowableOffset = offset
    } else if (options?.outlineOnly) {
      try { query.maxAllowableOffset = 0.002 } catch (_) {}
    }
    return layer.queryFeatures(query)
  })
  if (state.token !== token) return false

  const features = (result?.features || []).filter((feature: any) => feature?.geometry)
  if (!features.length) return false

  if (!state.layer) {
    state.layer = new GraphicsLayer({
      title: 'Município selecionado',
      listMode: 'hide'
    })
    view.map.add(state.layer)
  }
  try {
    const top = Math.max(0, (view.map?.layers?.length || 1) - 1)
    view.map.reorder(state.layer, top)
  } catch (_) {}

  const outlineOnly = Boolean(options?.outlineOnly)
  const semiarido = options?.theme === 'semiarido'
  const outlineColor = semiarido ? [196, 122, 28, 1] : [0, 33, 59, 1]
  const haloColor = semiarido ? [255, 244, 214, 0.95] : [255, 255, 255, 1]
  const fillColor = semiarido ? [212, 154, 58, 0.14] : [47, 196, 255, 0.28]
  const accentColor = semiarido ? [196, 122, 28, 1] : [47, 196, 255, 1]
  state.layer.removeAll()
  for (const feature of features) {
    const geometry = feature.geometry
    const isPoint = geometry.type === 'point' || geometry.type === 'multipoint'
    if (isPoint) {
      state.layer.add(new Graphic({
        geometry,
        symbol: {
          type: 'simple-marker',
          style: 'circle',
          color: semiarido ? [212, 154, 58, 0.4] : [47, 196, 255, 0.35],
          size: 18,
          outline: {
            color: semiarido ? [255, 244, 214, 1] : [47, 196, 255, 1],
            width: 2.5
          }
        }
      }))
    } else if (outlineOnly) {
      if (!semiarido) {
        state.layer.add(new Graphic({
          geometry,
          symbol: {
            type: 'simple-fill',
            style: 'solid',
            color: [0, 0, 0, 0],
            outline: {
              type: 'simple-line',
              color: haloColor,
              width: 6
            }
          }
        }))
      }
      state.layer.add(new Graphic({
        geometry,
        symbol: {
          type: 'simple-fill',
          style: 'solid',
          color: [0, 0, 0, 0],
          outline: {
            type: 'simple-line',
            color: outlineColor,
            width: 3
          }
        }
      }))
    } else {
      state.layer.add(new Graphic({
        geometry,
        symbol: {
          type: 'simple-fill',
          color: fillColor,
          outline: {
            type: 'simple-line',
            color: haloColor,
            width: 1.5
          }
        }
      }))
      state.layer.add(new Graphic({
        geometry,
        symbol: {
          type: 'simple-fill',
          color: [0, 0, 0, 0],
          outline: {
            type: 'simple-line',
            color: accentColor,
            width: 3.5
          }
        }
      }))
    }
  }

  if (!outlineOnly) {
    try {
      const layerView = await view.whenLayerView(layer)
      state.handle = layerView.highlight(features)
    } catch {
    }
  }

  return true
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
  const title = normalizeMunText(layer?.title || layer?.name || '')
  return title.includes('pdaindicadorescenso') ||
    title.includes('dpaindicadorescenso') ||
    title.includes('municipio') ||
    title.includes('municipios') ||
    title.includes('limite_municipal')
}

function graphicLooksLikeMunicipio (graphic: any, layer: any): boolean {
  if (isMunicipioLayer(layer)) return true
  const geom = String(layer?.geometryType || graphic?.geometry?.type || '').toLowerCase()
  if (geom && !geom.includes('polygon')) return false
  const attrs = graphic?.attributes || {}
  return Object.keys(attrs).some((key) => {
    const n = normalizeMunKey(key)
    return n === 'municipio' ||
      n === 'nmmun' ||
      n === 'nmmun1' ||
      n === 'nomedomunicipio' ||
      n === 'nmmunicipio' ||
      n === 'nommunicipio' ||
      n === 'cdmun' ||
      n.includes('municip')
  })
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
    if (String(lyr?.type || '').toLowerCase() === 'graphics') continue
    if (g && g.attributes && (graphicLooksLikeMunicipio(g, lyr) || (layer && lyr === layer))) {
      return { layer: lyr, graphic: g }
    }
  }
  for (const r of results) {
    const g = r?.graphic
    const lyr = r?.layer || g?.layer
    if (String(lyr?.type || '').toLowerCase() === 'graphics') continue
    const geom = String(lyr?.geometryType || g?.geometry?.type || '').toLowerCase()
    if (g && g.attributes && (!geom || geom.includes('polygon'))) {
      return { layer: lyr, graphic: g }
    }
  }
  return null
}

export async function buildMunicipioPopupData (
  layer: any,
  attrs: Record<string, any> | null | undefined,
  options?: {
    webMap?: any
    compact?: boolean
    totalLabel?: string
    totalCandidates?: string[]
  }
): Promise<MunicipioPopupData> {
  const fields: any[] = layer?.fields || []
  await layer?.load?.().catch(() => {})

  const resolved = resolveMunFields(layer)

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
        if (fname) {
          const v = a[fname] ?? a[fname.toLowerCase?.() ?? '']
          if (v != null && String(v).trim() !== '') return fname
          const realFromAttr = attrByNorm.get(normalizeMunKey(fname))
          if (realFromAttr && a[realFromAttr] != null && String(a[realFromAttr]).trim() !== '') return realFromAttr
        }
      }
    }
    return null
  }

  const primaryCandidates = {
    name: [resolved.name, 'nome_do_municipio', 'nm_mun_1', 'nm_mun', 'municipio', 'nome', 'nome_municipio', 'nm_municipio', 'nom_municipio'],
    territory: [resolved.territory, 'territorio_de_indentidade', 'territorio_de_identidade', 'nm_territorio_identidade', 'nm_ti', 'territorio'],
    semiarido: [resolved.semiarido, 'região_do_semiarida', 'regiao_do_semiarida', 'semiarido'],
    population: [resolved.population, 'estimativa_pop_2026', 'pop_est_2026', 'populacao_estimada_2026', 'pop_2026', 'populacao_estimada', 'estimativa_pop_2025', 'pop_est_2025', 'populacao_estimada_2025', 'pop_2025', 'população__2022_', 'populacao__2022_', 'pop_2022', 'populacao', 'total_1'],
    codibge: ['codigo_do_municipio', 'codibge', 'cd_ibge', 'ibge_codigo', 'cd_mun', 'cod_mun', 'geocodigo_ibge', 'codigo_ibge', 'geocodigo_municipio']
  }

  const nameField = pickAttrKey(primaryCandidates.name) ?? resolveMunField(fields, primaryCandidates.name, resolved.name)
  const tiField = pickAttrKey(primaryCandidates.territory) ?? resolveMunField(fields, primaryCandidates.territory, resolved.territory)
  const semiField = pickAttrKey(primaryCandidates.semiarido) ?? resolveMunField(fields, primaryCandidates.semiarido, resolved.semiarido)
  const popField = pickAttrKey(primaryCandidates.population) ?? resolveMunField(fields, primaryCandidates.population, resolved.population)
  const codField = pickAttrKey(primaryCandidates.codibge) ?? resolveMunField(fields, primaryCandidates.codibge, 'codibge')

  const getAttr = (field: string): any => {
    if (!field) return undefined
    if (a[field] != null) return a[field]
    const lower = field.toLowerCase?.() ?? ''
    if (lower && a[lower] != null) return a[lower]
    const norm = normalizeMunKey(field)
    const realKey = attrByNorm.get(norm)
    if (realKey && a[realKey] != null) return a[realKey]
    const fmeta = fieldsByKey.get(norm)
    const fname = fmeta?.name ? String(fmeta.name) : ''
    if (fname && a[fname] != null) return a[fname]
    if (fname && a[fname.toLowerCase?.() ?? ''] != null) return a[fname.toLowerCase?.() ?? '']
    return undefined
  }

  const semiRaw = String(getAttr(semiField) ?? '').trim()
  const semiNorm = semiRaw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
  const semiarido = semiNorm === 'SIM' ? 'Sim' : semiNorm === 'NAO' || semiNorm === 'NÃO' ? 'Não' : semiRaw || 'Não'

  const codRaw = getAttr(codField)
  let codMun: string | null = null
  if (codRaw != null && codRaw !== '') {
    const n = Number(codRaw)
    if (Number.isFinite(n) && n > 0) codMun = String(Math.round(n))
    else codMun = String(codRaw)
  }

  let fallbackName: string | null = null
  let fallbackTi: string | null = null
  for (const key of attrKeys) {
    const alias = normalizeMunText(fieldsByKey.get(normalizeMunKey(key))?.alias || key)
    const raw = a[key]
    if (!fallbackName && /nome.*mun|mun.*nome|nm.*mun|mun.*nm|municipio/i.test(alias)) {
      fallbackName = String(raw).trim()
    }
    if (!fallbackTi && /territorio|territ.*ident|nm.*ti|^ti$/i.test(alias)) {
      fallbackTi = String(raw).trim()
    }
  }

  const nomeResolvido = String(getAttr(nameField) ?? '').trim()
  const nomeFinal = nomeResolvido || fallbackName || 'Município'
  const territorioResolvido = String(getAttr(tiField) ?? '').trim() || '—'
  const territorioFinal = territorioResolvido !== '—' ? territorioResolvido : (fallbackTi && fallbackTi.trim() ? fallbackTi : '—')

  if (options?.compact) {
    const extras: Array<{ label: string, value: string }> = []
    const totalLabel = String(options.totalLabel || '').trim()
    const totalCandidates = options.totalCandidates || []
    if (totalLabel) {
      const totalField = pickAttrKey(totalCandidates)
      const raw = totalField ? getAttr(totalField) : undefined
      extras.push({
        label: totalLabel,
        value: raw != null && String(raw).trim() !== '' ? formatMunValue(raw) : '—'
      })
    }
    return {
      nome: nomeFinal,
      territorio: territorioFinal,
      semiarido,
      populacao: null,
      codMun,
      extraFields: extras
    }
  }

  let populacao = populationFromAttrs(a, fields)
  if (populacao == null) {
    populacao = parsePopulation(getAttr(popField))
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
  for (const key of attrKeys) {
    const kkey = normalizeMunKey(key)
    if (skip.has(kkey)) continue
    const raw = a[key]
    const fmeta = fieldsByKey.get(kkey)
    const alias = normalizeMunText(fmeta?.alias || key)

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
    const raw = getAttr(fname)
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

  if (populacao == null) {
    populacao = await lookupCensusPopulation(options?.webMap, nomeFinal, codMun)
  }

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

const POP_FIELD_CANDIDATES = [
  'estimativa_pop_2026',
  'pop_est_2026',
  'estimativa_pop2026',
  'populacao_estimada_2026',
  'pop_2026',
  'populacao_estimada',
  'estimativa_pop_2025',
  'pop_est_2025',
  'estimativa_pop2025',
  'populacao_estimada_2025',
  'pop_2025',
  'população__2022_',
  'populacao__2022_',
  'populacao_2022',
  'população_2022',
  'pop_2022',
  'populacao_total',
  'populacao',
  'habitantes',
  'total_1'
]

function isCountLikeField (name: string): boolean {
  const key = normalizeMunKey(name)
  return /frequenc|cisterna|poco|poço|vazao|countobjectid|^qtd|quantidade|totalpoco|tpoco/.test(key)
}

function parsePopulation (value: any): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) && num >= 0 ? num : null
}

function populationFromAttrs (attrs: Record<string, any>, fields: any[]): number | null {
  const a = attrs || {}
  const attrKeys = Object.keys(a)
  const byKey = new Map<string, any>()
  for (const key of attrKeys) byKey.set(normalizeMunKey(key), a[key])
  for (const candidate of POP_FIELD_CANDIDATES) {
    if (isCountLikeField(candidate)) continue
    const value = byKey.get(normalizeMunKey(candidate))
    const parsed = parsePopulation(value)
    if (parsed != null) return parsed
  }
  for (const field of fields || []) {
    const name = String(field?.name || '')
    const alias = String(field?.alias || '')
    const blob = normalizeMunText(`${name} ${alias}`)
    if (isCountLikeField(name) || isCountLikeField(alias)) continue
    if (!(blob.includes('populac') || blob.includes('habitantes') || blob.includes('pop'))) continue
    if (blob.includes('2026') || blob.includes('2025') || blob.includes('estimativ')) {
      const parsed = parsePopulation(a[name] ?? byKey.get(normalizeMunKey(name)))
      if (parsed != null) return parsed
    }
  }
  for (const field of fields || []) {
    const name = String(field?.name || '')
    const alias = String(field?.alias || '')
    const blob = normalizeMunText(`${name} ${alias}`)
    if (isCountLikeField(name) || isCountLikeField(alias)) continue
    if (!(blob.includes('populac') || blob.includes('habitantes') || blob.includes('pop'))) continue
    const parsed = parsePopulation(a[name] ?? byKey.get(normalizeMunKey(name)))
    if (parsed != null) return parsed
  }
  return null
}

let censusMapPromise: Promise<any> | null = null
const censusPopIndex = new WeakMap<object, Map<string, number>>()

async function resolveCensusLayer (webMap?: any): Promise<any | null> {
  const local = webMap ? findMunicipioLayer(webMap) : null
  if (local) return local
  if (webMap) {
    for (const layer of getAllLayers(webMap)) {
      const fields = layer?.fields || []
      const hasPop = fields.some((field: any) => {
        const blob = `${field?.name || ''} ${field?.alias || ''}`
        return /populacao__2022|população__2022|estimativa_pop_2026|estimativa_pop_2025|pop_est_2026|pop_2022/i.test(blob)
      })
      if (hasPop) return layer
    }
  }
  if (!censusMapPromise) {
    censusMapPromise = createWebMap().catch((err) => {
      censusMapPromise = null
      throw err
    })
  }
  try {
    const map = await censusMapPromise
    return findMunicipioLayer(map)
  } catch (err) {
    console.warn('[infra-map] Não foi possível carregar a camada de população:', err)
    return null
  }
}

async function lookupCensusPopulation (webMap: any, nome: string, codMun: string | null): Promise<number | null> {
  const layer = await resolveCensusLayer(webMap)
  if (!layer) return null
  await layer.load?.().catch(() => {})
  let index = censusPopIndex.get(layer)
  if (!index) {
    index = new Map<string, number>()
    try {
      const fields = resolveMunFields(layer)
      const query = layer.createQuery ? layer.createQuery() : ({} as any)
      query.where = '1=1'
      query.returnGeometry = false
      query.outFields = [fields.name, fields.population, 'codigo_do_municipio', 'cd_mun', 'codibge']
      query.num = 500
      const result = await layer.queryFeatures(query)
      for (const feature of result?.features || []) {
        const attrs = feature?.attributes || {}
        const pop = parsePopulation(attrs[fields.population])
        if (pop == null) continue
        const munName = normalizeMunName(String(attrs[fields.name] || ''))
        if (munName) index.set(`n:${munName}`, pop)
        const code = String(attrs.codigo_do_municipio ?? attrs.cd_mun ?? attrs.codibge ?? '').replace(/\D/g, '')
        if (code) index.set(`c:${code}`, pop)
      }
      censusPopIndex.set(layer, index)
    } catch (err) {
      console.warn('[infra-map] Falha ao consultar população municipal:', err)
      return null
    }
  }
  if (codMun) {
    const byCode = index.get(`c:${String(codMun).replace(/\D/g, '')}`)
    if (byCode != null) return byCode
  }
  const byName = index.get(`n:${normalizeMunName(nome)}`)
  return byName ?? null
}

function sqlIdentSafe (value: string): string {
  const name = String(value || '').trim()
  if (!name) return value
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
  return `"${name.replace(/"/g, '""')}"`
}

async function queryMunicipioFullAttributes (
  layer: any,
  partialAttrs: Record<string, any> | null | undefined
): Promise<Record<string, any> | null> {
  if (!layer || typeof layer.queryFeatures !== 'function') return null
  const a = partialAttrs || {}
  const keys = Object.keys(a).filter((k) => a[k] != null && String(a[k]).trim() !== '')
  let objectId: any = null
  const oidCandidates = ['OBJECTID', 'objectid', 'ObjectID', 'FID', 'fid', 'Shape__Area__']
  for (const c of oidCandidates) {
    if (a[c] != null && String(a[c]).trim() !== '') {
      objectId = a[c]
      break
    }
  }
  const oidField = layer?.objectIdField ? String(layer.objectIdField) : ''
  if (!objectId && oidField && a[oidField] != null) objectId = a[oidField]
  if (!objectId) {
    for (const k of keys) {
      const kl = k.toLowerCase()
      if (kl.includes('objectid') || kl.includes('fid') || kl === 'id') {
        objectId = a[k]
        break
      }
    }
  }
  if (objectId == null || String(objectId).trim() === '') return null
  try {
    await layer?.load?.().catch(() => {})
    const oidFinal = Number(objectId)
    if (!Number.isFinite(oidFinal)) return null
    const finalOidField = oidField || 'OBJECTID'
    const query = layer.createQuery ? layer.createQuery() : ({ where: '', outFields: ['*'], returnGeometry: false } as any)
    query.where = `${sqlIdentSafe(finalOidField)} = ${oidFinal}`
    query.outFields = ['*']
    query.returnGeometry = false
    const result = await layer.queryFeatures(query)
    const feature = result?.features?.[0]
    return feature?.attributes ? { ...a, ...feature.attributes } : a
  } catch (err) {
    console.warn('[infra-map] Falha ao consultar atributos completos do município:', err)
    return a
  }
}

export type MunicipioClickHandle = { remove: () => void }

export function enableMunicipioCustomPopup (
  view: any,
  options: {
    viewContainer: HTMLElement
    webMap?: any
    layer?: any
    resolveLayer?: () => any
    compact?: boolean
    totalLabel?: string
    totalCandidates?: string[]
    countFields?: string[]
    countLabel?: (layer: any) => string
    onOpen: (data: MunicipioPopupData, clientX: number, clientY: number) => void
    onClose: () => void
    onDeselect?: () => void
    isSelected?: (name: string) => boolean
    isAssetSelected?: () => boolean
    isAssetLayer?: (layer: any) => boolean
    onAssetHit?: (layer: any, graphic: any) => void
    onAssetDeselect?: () => void
  }
): MunicipioClickHandle {
  if (!view) return { remove: () => {} }
  disableNativePopup(view, options.webMap)
  captureHomeViewpoint(view)

  const clickHandle = view.on('click', async (event: any) => {
    try {
      const native = event?.native || event
      const clientX = native.clientX ?? event?.x
      const clientY = native.clientY ?? event?.y
      const hitAll = await view.hitTest(event)
      if (options.onAssetHit && options.isAssetLayer) {
        const results = hitAll?.results || []
        for (const result of results) {
          const graphic = result?.graphic
          const lyr = graphic?.layer
          if (!graphic || !lyr) continue
          if (String(lyr.type || '').toLowerCase() === 'graphics') continue
          if (!options.isAssetLayer(lyr)) continue
          options.onAssetHit(lyr, graphic)
          return
        }
      }

      const activeLayer = options.resolveLayer?.() || options.layer
      const opts: any = {}
      if (activeLayer) opts.include = activeLayer
      else if (options.webMap) opts.include = options.webMap.allLayers

      const hit = activeLayer ? await view.hitTest(event, opts) : hitAll
      const found = await extractMunicipioFromHit(hit, activeLayer)
      if (!found) {
        options.onClose()
        if (options.isAssetSelected?.()) options.onAssetDeselect?.()
        return
      }
      if (options.isAssetSelected?.()) {
        options.onClose()
        options.onAssetDeselect?.()
        return
      }
      const oidField = found.layer?.objectIdField || 'OBJECTID'
      const oid = found.graphic?.attributes?.[oidField] ??
        found.graphic?.attributes?.OBJECTID ??
        found.graphic?.attributes?.objectid
      const key = `${found.layer?.id || found.layer?.title || 'layer'}:${oid ?? ''}`
      const rendererField = String(found.layer?.renderer?.field || '').trim()
      const totalLabel = options.countLabel?.(found.layer) || options.totalLabel
      const preferLayerCount = !/total/i.test(String(totalLabel || ''))
      const totalCandidates = [
        rendererField,
        ...(options.countFields || []),
        ...(options.totalCandidates || [])
      ].filter((name) => {
        if (!name) return false
        if (!preferLayerCount) return true
        const compact = String(name)
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
        return compact !== 'sistemastotal' && compact !== 'cisternastotal' && compact !== 'pocostotal' && compact !== 'pocoestotal'
      })
      const fullAttrs = (await queryMunicipioFullAttributes(found.layer, found.graphic.attributes)) || found.graphic.attributes
      const data = await buildMunicipioPopupData(found.layer, fullAttrs, {
        webMap: options.webMap,
        compact: options.compact,
        totalLabel,
        totalCandidates
      })
      const sameGraphic = selectedMunByView.get(view) === key
      const sameName = Boolean(data?.nome && options.isSelected?.(data.nome))
      if (sameGraphic || sameName) {
        selectedMunByView.delete(view)
        options.onClose()
        if (options.onDeselect) options.onDeselect()
        else void resetMunicipioView(view)
        return
      }
      selectedMunByView.set(view, key)
      if (oid != null && Number.isFinite(Number(oid))) {
        const where = `${sqlIdentSafe(oidField)} = ${Number(oid)}`
        void highlightWhere(view, found.layer, where, { outlineOnly: true })
        void zoomToWhere(view, found.layer, where)
      }
      options.onOpen(data, clientX, clientY)
    } catch (err) {
      console.warn('[infra-map] Falha no clique de município:', err)
    }
  })

  return {
    remove: () => {
      try { clickHandle?.remove?.() } catch (_) {}
    }
  }
}
