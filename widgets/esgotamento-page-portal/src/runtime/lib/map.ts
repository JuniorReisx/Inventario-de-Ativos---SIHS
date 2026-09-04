import { loadArcGISJSAPIModules } from 'jimu-arcgis'
import { captureEsriLegendFromView } from './relatorio-pdf'

export const PORTAL_URL = 'https://portaldaagua.sihs.ba.gov.br/portal'
/** Web map ABASTECIMENTO / ESGOTAMENTO - Inventário de Ativos */
export const WEB_MAP_ID = '42e3cea83e0b4b86b4b34e015ac722c6'
export const DPA_LAYER_TITLE = 'DPA_Indicadores_Censo_2022'
export const SEMIARIDO_LAYER_TITLE = 'Região Semiárida_BA'
export const SETORES_LAYER_TITLE = 'Setores Censitarios_BA'

function normalizePortalUrl (value: string): string {
  return String(value || '').replace(/\/+$/, '')
}

function normalizeText (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function layerLabel (layer: any): string {
  return layer?.title || layer?.name || ''
}

function getSublayers (layer: any): any[] {
  return layer?.allSublayers?.toArray?.() || layer?.sublayers?.toArray?.() || []
}

function getAllLayers (webMap: any): any[] {
  const collected: any[] = []
  const root = webMap?.allLayers?.toArray?.() || []
  for (const layer of root) {
    collected.push(layer)
    for (const sub of getSublayers(layer)) collected.push(sub)
  }
  return collected
}

function isQueryableLayer (layer: any): boolean {
  return !!(layer && typeof layer.queryFeatures === 'function')
}

export function findLayerByTitle (webMap: any, title: string): any | null {
  const target = normalizeText(title)
  const scored = getAllLayers(webMap).map((layer: any) => {
    const name = normalizeText(layerLabel(layer))
    return {
      layer,
      exact: name === target,
      partial: name.includes(target) || (target.length > 8 && target.includes(name)),
      queryable: isQueryableLayer(layer)
    }
  }).filter((item: any) => item.exact || item.partial)

  return scored.find((item: any) => item.exact && item.queryable)?.layer
    || scored.find((item: any) => item.partial && item.queryable)?.layer
    || scored.find((item: any) => item.exact)?.layer
    || scored.find((item: any) => item.partial)?.layer
    || null
}

export function findCensoMunicipioLayer (webMap: any): any | null {
  return findLayerByTitle(webMap, 'PDA_Indicadores_Censo_2022')
    || findLayerByTitle(webMap, DPA_LAYER_TITLE)
    || findLayerByTitle(webMap, 'PDA Indicadores Censo')
    || findLayerByTitle(webMap, 'DPA - Indicadores Censo')
    || getAllLayers(webMap).find((layer: any) => {
      const name = normalizeText(layerLabel(layer))
      const url = normalizeText(String(layer?.url || ''))
      return name.includes('pdaindicadorescenso')
        || name.includes('dpaindicadorescenso')
        || url.includes('pdaindicadorescenso')
        || url.includes('dpaindicadorescenso')
    })
    || null
}

export function findSemiaridoLayer (webMap: any): any | null {
  const scored = getAllLayers(webMap).map((layer: any) => {
    const name = normalizeText(layerLabel(layer))
    return {
      layer,
      ba: name === 'regiaosemiaridaba' || name.includes('semiaridaba'),
      old: name === 'regiaosemiarida',
      queryable: isQueryableLayer(layer)
    }
  })
  return scored.find((item: any) => item.ba && item.queryable)?.layer
    || scored.find((item: any) => item.ba)?.layer
    || scored.find((item: any) => item.old && item.queryable)?.layer
    || scored.find((item: any) => item.old)?.layer
    || null
}

export function resolveField (layer: any, ...candidates: string[]): string {
  const fields: any[] = layer?.fields || []
  for (const want of candidates) {
    const w = normalizeText(want)
    const hit = fields.find((field: any) => {
      return normalizeText(field.name) === w || normalizeText(field.alias || '') === w
    })
    if (hit) return hit.name
  }
  if (fields.length) {
    for (const want of candidates) {
      const w = normalizeText(want)
      const partial = fields.find((field: any) => {
        const name = normalizeText(field.name)
        const alias = normalizeText(field.alias || '')
        return name.includes(w) || alias.includes(w) || w.includes(name)
      })
      if (partial) return partial.name
    }
    return ''
  }
  return candidates[0] || ''
}

/** Campo pop_est_2026 (população estimada IBGE 2026). */
export function resolvePopEstimadaField (layer: any): string {
  const exact = resolveField(layer, 'pop_est_2026', 'estimativa_pop_2026', 'populacao_estimada_2026', 'pop_2026')
  if (exact) return exact

  const fields: any[] = layer?.fields || []
  const blob = (field: any) => `${normalizeText(field?.name || '')} ${normalizeText(field?.alias || '')}`
  for (let i = fields.length - 1; i >= 0; i--) {
    const text = blob(fields[i])
    if (text.includes('2026') && (text.includes('pop') || text.includes('estimativ') || text.includes('populac'))) {
      return fields[i].name
    }
  }

  return resolveField(
    layer,
    'populacao estimada',
    'populacao total (estimativa - 2026)',
    'populacao_estimada',
    'estimativa_pop_2025',
    'pop_est_2025',
    'estimativa_pop2025',
    'populacao_estimada_2025',
    'populacao total (estimativa - 2025)',
    'pop_2025'
  )
}

function sqlField (name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
  return `"${String(name).replaceAll('"', '""')}"`
}

function revealAncestors (layer: any): void {
  let node = layer?.parent
  while (node && typeof node.visible === 'boolean') {
    node.visible = true
    node = node.parent
  }
}

function setLayerVisible (layer: any, visible: boolean): void {
  if (!layer || typeof layer.visible !== 'boolean') return
  layer.visible = visible
  if (visible) revealAncestors(layer)
}

function bringLayerToFront (webMap: any, layer: any): void {
  if (!layer) return
  try {
    const collection = layer.parent?.layers || webMap?.layers
    if (collection?.reorder && typeof collection.length === 'number') {
      collection.reorder(layer, collection.length - 1)
    }
  } catch (_) {}
}

const POLY_OUTLINE = [26, 15, 8, 220]
const SEMI_OUTLINE = [139, 90, 43, 255]

function outlineFillSymbol (color: number[], width: number) {
  return {
    type: 'simple-fill',
    style: 'solid',
    // Alpha mínima: hitTest costuma ignorar fill totalmente transparente
    color: [0, 0, 0, 0.01],
    outline: { color, width }
  }
}

function applyOutlineOnlyPolygons (layer: any): void {
  if (!layer) return
  try {
    layer.renderer = {
      type: 'simple',
      symbol: outlineFillSymbol(POLY_OUTLINE, 1.05)
    }
    layer.effect = null
  } catch (_) {}
}

function semiOutlineSymbol () {
  return outlineFillSymbol(SEMI_OUTLINE, 2.6)
}

async function querySemiGeometries (layer: any): Promise<any[]> {
  if (!layer || typeof layer.queryFeatures !== 'function') return []
  try {
    await layer.load?.()
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.where = '1=1'
    query.returnGeometry = true
    query.outFields = [layer.objectIdField || 'objectid']
    query.num = 5
    const result = await layer.queryFeatures(query)
    return (result?.features || []).map((feature: any) => feature?.geometry).filter(Boolean)
  } catch (error) {
    console.warn('[esgotamento] geometria da Região Semiárida:', error)
    return []
  }
}

/** Nomes puramente numéricos (ex.: campo mun=287 da camada regional) não são municípios. */
function isPlausibleMunName (value: string): boolean {
  const text = String(value || '').trim()
  if (!text || text.length < 2) return false
  if (/^\d+([.,]\d+)?$/.test(text)) return false
  return true
}

function sanitizeSemiKeys (keys: { codes?: string[], names?: string[] } | null): { codes: string[], names: string[] } {
  const codes = Array.from(new Set(
    (keys?.codes || [])
      .map((c) => Number(c))
      .filter((n) => Number.isFinite(n) && n > 100000)
      .map((n) => String(Math.round(n)))
  ))
  const names = Array.from(new Set(
    (keys?.names || []).map((n) => String(n || '').trim()).filter(isPlausibleMunName)
  ))
  return { codes, names }
}

function hasUsableSemiKeys (keys: { codes: string[], names: string[] }): boolean {
  return keys.codes.length > 0 || keys.names.length > 0
}

function buildDpaSemiFieldWhere (dpaLayer: any): string {
  const semiField = resolveField(dpaLayer, 'região_do_semiarida', 'regiao_do_semiarida', 'semiarido')
  if (!semiField) return ''
  const f = sqlField(semiField)
  return `(UPPER(${f}) = 'SIM' OR ${f} = 'SIM')`
}

/** Municípios oficiais do semiárido no DPA (campo região_do_semiarida). */
async function queryDpaSemiMunicipioKeys (dpaLayer: any): Promise<{ codes: string[], names: string[] }> {
  const codes: string[] = []
  const names: string[] = []
  if (!dpaLayer || typeof dpaLayer.queryFeatures !== 'function') return { codes, names }

  await dpaLayer.load?.().catch(() => {})
  const where = buildDpaSemiFieldWhere(dpaLayer)
  if (!where) return { codes, names }

  const codField = resolveField(dpaLayer, 'codígo_do_municipio', 'codigo_do_municipio', 'codibge', 'cd_mun')
  const nameField = resolveField(dpaLayer, 'nome_do_municipio', 'nm_mun')
  let offset = 0
  const pageSize = 500

  while (true) {
    const query = typeof dpaLayer.createQuery === 'function' ? dpaLayer.createQuery() : ({} as any)
    query.where = where
    query.returnGeometry = false
    query.outFields = [codField, nameField].filter(Boolean)
    if (!query.outFields.length) query.outFields = ['*']
    query.num = pageSize
    query.start = offset
    let result: any
    try {
      result = await dpaLayer.queryFeatures(query)
    } catch (error) {
      console.warn('[esgotamento] queryDpaSemiMunicipioKeys falhou:', error)
      break
    }
    const page = result?.features || []
    for (const feature of page) {
      const attrs = feature?.attributes || {}
      const rawCod = codField ? attrs[codField] : null
      if (rawCod != null && rawCod !== '') {
        const n = Number(rawCod)
        if (Number.isFinite(n) && n > 100000) codes.push(String(Math.round(n)))
      }
      const name = nameField ? String(attrs[nameField] || '').trim() : ''
      if (isPlausibleMunName(name)) names.push(name)
    }
    if (page.length < pageSize) break
    offset += page.length
    if (offset > 5000) break
  }

  return sanitizeSemiKeys({ codes, names })
}

export async function querySemiMunicipioKeys (layer: any): Promise<{ codes: string[], names: string[] }> {
  const codes: string[] = []
  const names: string[] = []
  if (!layer || typeof layer.queryFeatures !== 'function') return { codes, names }

  await layer.load?.()
  const codField = resolveField(layer, 'codígo_do_municipio', 'codigo_do_municipio', 'codibge', 'cd_mun', 'cd_ibge', 'geocodigo')
  const nameField = resolveField(layer, 'nome_do_municipio', 'nm_mun', 'nm_municipio', 'nome_municipio')
  let offset = 0
  const pageSize = 500

  while (true) {
    const query = layer.createQuery ? layer.createQuery() : ({
      where: '1=1',
      returnGeometry: false,
      outFields: ['*'],
      num: pageSize,
      start: offset
    } as any)
    if (layer.createQuery) {
      query.where = '1=1'
      query.returnGeometry = false
      query.outFields = ['*']
      query.num = pageSize
      query.start = offset
    }
    let result: any
    try {
      result = await layer.queryFeatures(query)
    } catch (error) {
      console.warn('[esgotamento] querySemiMunicipioKeys falhou:', error)
      break
    }
    const page = result?.features || []
    if (offset === 0 && page.length <= 1) {
      return { codes: [], names: [] }
    }
    for (const feature of page) {
      const attrs = feature?.attributes || {}
      let codeRaw = codField ? attrs[codField] : null
      if (codeRaw == null) {
        for (const [k, v] of Object.entries(attrs)) {
          const n = k.toLowerCase().replace(/[^a-z0-9]/g, '')
          if (n.includes('codibge') || n === 'cdmun' || n === 'codmun' || n.includes('geocodigo')) {
            codeRaw = v
            break
          }
        }
      }
      if (codeRaw != null && codeRaw !== '') {
        const n = Number(codeRaw)
        if (Number.isFinite(n) && n > 100000) codes.push(String(Math.round(n)))
      }
      let name = nameField ? String(attrs[nameField] || '').trim() : ''
      if (!name) {
        for (const [k, v] of Object.entries(attrs)) {
          const n = k.toLowerCase().replace(/[^a-z0-9]/g, '')
          if (n === 'nomedomunicipio' || n === 'nmmun' || n === 'nmmunicipio' || n === 'nomemunicipio') {
            name = String(v || '').trim()
            if (name) break
          }
        }
      }
      if (isPlausibleMunName(name)) names.push(name)
    }
    if (page.length < pageSize) break
    offset += page.length
    if (offset > 5000) break
  }

  return sanitizeSemiKeys({ codes, names })
}

async function querySemiCodesByIntersection (
  dpaLayer: any,
  semiGeometries: any[]
): Promise<{ codes: string[], names: string[] }> {
  const codes: string[] = []
  const names: string[] = []
  if (!dpaLayer || typeof dpaLayer.queryFeatures !== 'function' || !semiGeometries?.length) {
    return { codes, names }
  }
  await dpaLayer.load?.().catch(() => {})
  const codField = resolveField(dpaLayer, 'codígo_do_municipio', 'codigo_do_municipio', 'codibge', 'cd_mun')
  const nameField = resolveField(dpaLayer, 'nome_do_municipio', 'nm_mun', 'municipio')
  for (const geometry of semiGeometries.slice(0, 5)) {
    try {
      const query = typeof dpaLayer.createQuery === 'function' ? dpaLayer.createQuery() : {}
      query.geometry = geometry
      query.spatialRelationship = 'intersects'
      query.returnGeometry = false
      query.outFields = [codField, nameField].filter(Boolean)
      query.num = 1000
      const result = await dpaLayer.queryFeatures(query)
      for (const feature of result?.features || []) {
        const attrs = feature?.attributes || {}
        const rawCod = attrs[codField]
        if (rawCod != null && rawCod !== '') {
          const n = Number(rawCod)
          if (Number.isFinite(n) && n > 0) codes.push(String(Math.round(n)))
        }
        const name = String(attrs[nameField] || '').trim()
        if (name) names.push(name)
      }
    } catch (error) {
      console.warn('[esgotamento] interseção Semiárido×DPA:', error)
    }
  }
  return { codes, names }
}

function buildDpaSemiWhere (dpaLayer: any, keys: { codes: string[], names: string[] }): string {
  const parts: string[] = []
  const nums = Array.from(new Set(keys.codes.map((c) => Number(c)).filter((n) => Number.isFinite(n) && n > 0)))
  if (nums.length) {
    const codField = resolveField(dpaLayer, 'codígo_do_municipio', 'codigo_do_municipio', 'codibge')
    parts.push(`${sqlField(codField)} IN (${nums.join(',')})`)
  }
  const uniqueNames = Array.from(new Set(keys.names.map((n) => String(n || '').trim()).filter(Boolean)))
  if (uniqueNames.length) {
    const nameField = resolveField(dpaLayer, 'nome_do_municipio', 'nm_mun')
    parts.push(
      uniqueNames.map((name) => `${sqlField(nameField)} = '${escapeSql(name)}'`).join(' OR ')
    )
  }
  return parts.length ? `(${parts.join(' OR ')})` : ''
}

function paintSemiHighlight (highlightLayer: any, geometries: any[], on: boolean): void {
  if (!highlightLayer) return
  highlightLayer.removeAll?.()
  highlightLayer.visible = on
  if (!on) {
    highlightLayer.effect = null
    return
  }
  geometries.forEach((geometry) => {
    highlightLayer.add({
      geometry,
      symbol: semiOutlineSymbol()
    })
  })
  highlightLayer.effect = null
}

function selectionFillSymbol (fill: number[], outline: number[], width = 2.8) {
  return {
    type: 'simple-fill',
    style: 'solid',
    color: fill,
    outline: { color: outline, width }
  }
}

async function paintMunicipioSelection (
  highlightLayer: any,
  sourceLayer: any,
  where: string | null,
  colors: { fill: number[], outline: number[] }
): Promise<void> {
  if (!highlightLayer) return
  highlightLayer.removeAll?.()
  if (!where || !sourceLayer || typeof sourceLayer.queryFeatures !== 'function') {
    highlightLayer.visible = false
    return
  }
  try {
    const previousWhere = sourceLayer.definitionExpression
    sourceLayer.definitionExpression = null
    const query = typeof sourceLayer.createQuery === 'function' ? sourceLayer.createQuery() : {}
    query.where = where
    query.returnGeometry = true
    query.outFields = [sourceLayer.objectIdField || 'OBJECTID']
    query.num = 1
    const result = await sourceLayer.queryFeatures(query)
    sourceLayer.definitionExpression = previousWhere
    const geometry = result?.features?.[0]?.geometry
    if (!geometry) {
      highlightLayer.visible = false
      return
    }
    highlightLayer.visible = true
    highlightLayer.add({
      geometry,
      symbol: selectionFillSymbol(colors.fill, colors.outline, 3.2)
    })
    highlightLayer.add({
      geometry,
      symbol: selectionFillSymbol([0, 0, 0, 0], colors.outline, 1.4)
    })
  } catch (error) {
    console.warn('[esgotamento] destaque do município falhou:', error)
    highlightLayer.visible = false
  }
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
      portal: { url: normalizePortalUrl(portalUrl) }
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
  const [MapView, Zoom, Home, Legend, Expand, BasemapGallery, Basemap, LocalBasemapsSource] = await loadArcGISJSAPIModules([
    'esri/views/MapView',
    'esri/widgets/Zoom',
    'esri/widgets/Home',
    'esri/widgets/Legend',
    'esri/widgets/Expand',
    'esri/widgets/BasemapGallery',
    'esri/Basemap',
    'esri/widgets/BasemapGallery/support/LocalBasemapsSource'
  ])

  container.replaceChildren()

  const view = new MapView({
    container,
    map: webMap,
    constraints: { snapToZoom: false },
    ui: { components: ['attribution'] }
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
  view.__portalLegendExpand = legendExpand
  addBasemapSwitcher(view, Expand, BasemapGallery, Basemap, LocalBasemapsSource)

  if (view.popup) {
    view.popup.autoOpenEnabled = false
    view.popupEnabled = false
  }

  if (view.extent) {
    await view.goTo(view.extent.clone().expand(1.02), { animate: false })
  }

  view.__sihsHomeViewpoint = view.viewpoint?.clone?.() || null
  return view
}

export async function resizeMapView (view: any): Promise<void> {
  if (!view) return
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (typeof view.resize === 'function') view.resize()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (typeof view.resize === 'function') view.resize()
}

function escapeSql (value: string): string {
  return String(value ?? '').replaceAll("'", "''")
}

function graphicFromHit (hit: any, layer: any): any | null {
  const results = hit?.results || []
  const match = results.find((item: any) => {
    const graphic = item?.graphic
    return graphic && (graphic.layer === layer || item.layer === layer)
  })
  return match?.graphic || null
}

async function queryMunicipioAtPoint (layer: any, mapPoint: any): Promise<any | null> {
  if (!layer || !mapPoint || typeof layer.queryFeatures !== 'function') return null
  try { await layer.load?.() } catch (_) {}
  const previousWhere = layer.definitionExpression
  try {
    layer.definitionExpression = null
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.geometry = mapPoint
    query.spatialRelationship = 'intersects'
    query.returnGeometry = false
    query.outFields = ['*']
    query.num = 1
    const result = await layer.queryFeatures(query)
    return result?.features?.[0] || null
  } catch (error) {
    console.warn('[esgotamento] queryMunicipioAtPoint falhou:', error)
    return null
  } finally {
    layer.definitionExpression = previousWhere
  }
}

function attrsLookUseful (attrs: Record<string, any> | null | undefined): boolean {
  if (!attrs) return false
  return Object.keys(attrs).some((key) => {
    const n = normalizeText(key)
    return n.includes('municip') || n.includes('nmmun') || n.includes('codibge')
      || n.includes('cdmun') || n.includes('codmun') || n.includes('nome')
  })
}

async function resolveMunicipioGraphic (view: any, layer: any, event: any): Promise<any | null> {
  const mapPoint = event?.mapPoint || (typeof view?.toMap === 'function'
    ? view.toMap({ x: event?.x, y: event?.y })
    : null)

  try {
    const hit = await view.hitTest(event)
    const results = hit?.results || []
    for (const item of results) {
      const graphic = item?.graphic
      const lyr = item?.layer || graphic?.layer
      if (!graphic?.attributes) continue
      if (lyr === layer || attrsLookUseful(graphic.attributes)) {
        if (attrsLookUseful(graphic.attributes)) return graphic
      }
    }
    const onLayer = graphicFromHit(hit, layer)
    if (onLayer && mapPoint) {
      const full = await queryMunicipioAtPoint(layer, mapPoint)
      if (full) return full
      return onLayer
    }
  } catch (_) {}

  if (mapPoint) {
    const fromQuery = await queryMunicipioAtPoint(layer, mapPoint)
    if (fromQuery) return fromQuery
  }
  return null
}

export type PainelMapState = {
  groupBy: string
  regiao: string
  selectedMun: string | null
  semiOn?: boolean
}

export type PainelMapApi = {
  sync: (state: PainelMapState) => void
  zoomToMun: (codMun: string) => Promise<void>
  zoomToState: (state: PainelMapState) => Promise<void>
  zoomReset: () => Promise<void>
  capture: (state?: PainelMapState) => Promise<string | null>
  captureLegend: () => Promise<import('./relatorio-pdf').RelatorioLegendGroup[]>
  setMunicipios: (items: Array<{ cod_mun?: string, nm_mun?: string }>) => void
  onSelect: (handler: (codMun: string) => void) => () => void
  onHover: (handler: (name: string | null, clientX: number, clientY: number) => void) => () => void
}

export function createMapApi (view: any, layer: any, options: {
  webMap?: any
  semiLayer?: any | null
  semiHighlightLayer?: any | null
  selectionHighlightLayer?: any | null
  semiGeometries?: any[]
  semiMunWhere?: string
  selectionColors?: { fill: number[], outline: number[] }
} = {}): PainelMapApi {
  const nameField = resolveField(layer, 'nome_do_municipio', 'nm_mun', 'municipio', 'nome')
  const tiField = resolveField(layer, 'territorio_de_indentidade', 'territorio_de_identidade', 'territorio')
  const semiField = resolveField(layer, 'região_do_semiarida', 'regiao_do_semiarida', 'semiarido')
  const codField = resolveField(layer, 'codígo_do_municipio', 'codigo_do_municipio', 'codibge', 'cd_mun', 'cd_ibge')

  const filterWhere = (state: PainelMapState) => {
    if (state.semiOn && options.semiMunWhere) {
      return options.semiMunWhere
    }
    if (state.groupBy === 'territorio' && state.regiao !== 'todas') {
      return `${sqlField(tiField)} = '${escapeSql(state.regiao)}'`
    }
    return '1=1'
  }

  const munWhere = (codMun: string) => `${sqlField(codField)} = ${Number(codMun)}`

  const zoomToWhere = async (where: string, targetLayer: any = layer, expand = 1.12, duration = 700) => {
    if (!view || !targetLayer || typeof targetLayer.queryExtent !== 'function') return false
    try {
      const result = await targetLayer.queryExtent({ where })
      if (!result?.extent || result.count === 0) return false
      const target = typeof result.extent.expand === 'function'
        ? result.extent.expand(expand)
        : result.extent
      await view.goTo(target, { duration })
      return true
    } catch (error) {
      console.warn('[esgotamento] zoom falhou:', error)
      return false
    }
  }

  const waitForIdle = async () => {
    await view?.when?.()
    await new Promise<void>((resolve) => {
      if (!view?.updating) {
        resolve()
        return
      }
      const handle = view.watch?.('updating', (updating: boolean) => {
        if (!updating) {
          handle?.remove?.()
          resolve()
        }
      })
      setTimeout(() => {
        handle?.remove?.()
        resolve()
      }, 2500)
    })
  }

  const attrByCandidates = (attrs: Record<string, any> | null | undefined, candidates: string[]) => {
    if (!attrs) return null
    const keys = Object.keys(attrs)
    const byNorm = new Map(keys.map((key) => [normalizeText(key), key]))
    for (const candidate of candidates) {
      const key = byNorm.get(normalizeText(candidate))
      if (key != null && attrs[key] != null && String(attrs[key]).trim() !== '') return attrs[key]
    }
    return null
  }

  const pickCod = (attrs: Record<string, any> | null | undefined) => {
    const raw = attrByCandidates(attrs, [
      codField, 'codígo_do_municipio', 'codigo_do_municipio', 'codibge', 'cd_mun', 'cd_ibge', 'cod_mun'
    ])
    if (raw == null || raw === '') return null
    const num = Number(raw)
    if (!Number.isFinite(num) || num <= 0) return String(raw).replace(/\D/g, '') || null
    return String(Math.round(num))
  }

  const pickName = (attrs: Record<string, any> | null | undefined) => {
    const raw = attrByCandidates(attrs, [
      nameField, 'nome_do_municipio', 'nm_mun', 'municipio', 'nome', 'nm_municipio'
    ])
    return raw == null ? null : String(raw).trim() || null
  }

  const setPointer = (over: boolean) => {
    try {
      if (view?.container) view.container.style.cursor = over ? 'pointer' : ''
    } catch (_) {}
  }

  const munByName = new Map<string, string>()
  const normalizeMunName = (value: string) => normalizeText(value)

  const resolveCod = (attrs: Record<string, any> | null | undefined) => {
    const cod = pickCod(attrs)
    if (cod) return cod
    const name = pickName(attrs)
    if (!name) return null
    return munByName.get(normalizeMunName(name)) || null
  }

  const selectionColors = options.selectionColors || {
    fill: [139, 90, 43, 0.42],
    outline: [255, 196, 0, 1]
  }
  let selectionToken = 0
  let highlightHandle: { remove?: () => void } | null = null

  const clearLayerViewHighlight = () => {
    try { highlightHandle?.remove?.() } catch (_) {}
    highlightHandle = null
  }

  const applyMunicipioHighlight = async (codMun: string | null) => {
    const token = ++selectionToken
    clearLayerViewHighlight()
    const where = codMun ? munWhere(codMun) : null
    await paintMunicipioSelection(
      options.selectionHighlightLayer,
      layer,
      where,
      selectionColors
    )
    if (token !== selectionToken) return

    if (options.selectionHighlightLayer) {
      bringLayerToFront(options.webMap, options.selectionHighlightLayer)
    }

    if (!codMun || !layer) {
      if (layer) layer.featureEffect = null
      return
    }

    try {
      layer.featureEffect = {
        filter: { where: munWhere(codMun) },
        includedEffect: 'drop-shadow(0px, 0px, 10px, #ffc400)',
        excludedEffect: 'opacity(32%)'
      }
    } catch (_) {
      if (layer) layer.featureEffect = null
    }

    try {
      const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
      query.where = munWhere(codMun)
      query.returnGeometry = false
      query.outFields = [layer.objectIdField || 'OBJECTID']
      query.num = 1
      const result = await layer.queryFeatures(query)
      if (token !== selectionToken) return
      const feature = result?.features?.[0]
      if (!feature) return
      const layerView = await view.whenLayerView(layer)
      if (token !== selectionToken) return
      if (typeof layerView?.highlight === 'function') {
        highlightHandle = layerView.highlight(feature)
      }
    } catch (_) {}
  }

  const syncOverlayLayers = (state: PainelMapState) => {
    const showSemi = Boolean(state.semiOn)
    const semiLayer = options.semiLayer
    if (semiLayer) {
      setLayerVisible(semiLayer, showSemi)
      if (typeof semiLayer.opacity === 'number') semiLayer.opacity = showSemi ? 1 : semiLayer.opacity
      semiLayer.effect = null
      if (showSemi) bringLayerToFront(options.webMap, semiLayer)
    }
    paintSemiHighlight(options.semiHighlightLayer, options.semiGeometries || [], showSemi && !!(options.semiGeometries?.length))
    if (showSemi && options.semiHighlightLayer && options.semiGeometries?.length) {
      bringLayerToFront(options.webMap, options.semiHighlightLayer)
    }
  }

  return {
    sync (state: PainelMapState) {
      syncOverlayLayers(state)
      void applyMunicipioHighlight(state.selectedMun || null)
    },

    setMunicipios (items) {
      munByName.clear()
      for (const item of items || []) {
        const cod = String(item?.cod_mun || '').trim()
        const name = String(item?.nm_mun || '').trim()
        if (cod && name) munByName.set(normalizeMunName(name), cod)
      }
    },

    async zoomToMun (codMun: string) {
      await zoomToWhere(munWhere(codMun))
    },

    async zoomToState (state: PainelMapState) {
      if (state.semiOn && options.semiLayer) {
        const ok = await zoomToWhere('1=1', options.semiLayer)
        if (ok) return
      }
      await zoomToWhere(filterWhere(state))
    },

    async zoomReset () {
      const home = view?.__sihsHomeViewpoint
      if (home) {
        await view.goTo(home, { duration: 600 })
        return
      }
      if (view?.extent) {
        await view.goTo(view.extent.clone().expand(1.02), { duration: 600 })
      }
    },

    async capture (state?: PainelMapState) {
      if (!view || typeof view.takeScreenshot !== 'function') return null
      const previous = view.viewpoint?.clone?.() || view.extent?.clone?.()
      try {
        if (state?.selectedMun) {
          await zoomToWhere(munWhere(state.selectedMun), layer, 1.28, 0)
        } else if (state) {
          if (state.semiOn && options.semiLayer) {
            await zoomToWhere('1=1', options.semiLayer, 1.28, 0)
          } else {
            const where = filterWhere(state)
            if (where === '1=1') {
              const home = view.__sihsHomeViewpoint
              if (home) await view.goTo(home, { duration: 0 })
            } else {
              await zoomToWhere(where, layer, 1.28, 0)
            }
          }
        }
        await waitForIdle()
        const shot = await view.takeScreenshot({ format: 'jpg', quality: 88 })
        return shot?.dataUrl || null
      } catch (error) {
        console.warn('[esgotamento] captura do mapa:', error)
        return null
      } finally {
        if (previous) {
          try { await view.goTo(previous, { duration: 0 }) } catch (_) {}
        }
      }
    },

    async captureLegend () {
      return captureEsriLegendFromView(view)
    },

    onSelect (handler) {
      const clickHandle = view.on('click', async (event: any) => {
        try {
          const graphic = await resolveMunicipioGraphic(view, layer, event)
          const cod = resolveCod(graphic?.attributes)
          if (cod) handler(cod)
        } catch (error) {
          console.warn('[esgotamento] clique no mapa:', error)
        }
      })
      return () => clickHandle?.remove?.()
    },

    onHover (handler) {
      let last = 0
      let pending: any = null
      let seq = 0
      let lastName: string | null = null
      const moveHandle = view.on('pointer-move', (event: any) => {
        pending = event
        const now = Date.now()
        if (now - last < 80) return
        last = now
        const native = pending.native || pending
        const clientX = Number(native.clientX ?? (view.position?.x || 0) + (pending.x || 0))
        const clientY = Number(native.clientY ?? (view.position?.y || 0) + (pending.y || 0))
        const token = ++seq
        void resolveMunicipioGraphic(view, layer, pending).then((graphic) => {
          if (token !== seq) return
          const name = pickName(graphic?.attributes)
          setPointer(Boolean(name))
          if (name === lastName && name) {
            handler(name, clientX, clientY)
            return
          }
          lastName = name
          handler(name, clientX, clientY)
        }).catch(() => {
          if (token !== seq) return
          lastName = null
          setPointer(false)
          handler(null, clientX, clientY)
        })
      })
      const leaveHandle = view.on('pointer-leave', () => {
        lastName = null
        setPointer(false)
        handler(null, 0, 0)
      })
      return () => {
        moveHandle?.remove?.()
        leaveHandle?.remove?.()
        setPointer(false)
      }
    }
  }
}

export async function prepareEsgotamentoMap (container: HTMLElement): Promise<{
  view: any
  layer: any
  webMap: any
  setoresLayer: any | null
  semiLayer: any | null
  semiKeys: { codes: string[], names: string[] }
  mapApi: PainelMapApi
}> {
  await setupAuthentication()
  const webMap = await createWebMap()
  const view = await createMapView(container, webMap)

  const layer = findCensoMunicipioLayer(webMap)
  if (!layer) {
    const titles = getAllLayers(webMap).map((item: any) => layerLabel(item)).filter(Boolean)
    throw new Error(
      `Camada PDA/DPA Indicadores Censo não encontrada no web map. Camadas: ${titles.slice(0, 12).join(', ') || '(nenhuma)'}`
    )
  }

  await layer.load?.()
  if (typeof layer.popupEnabled === 'boolean') layer.popupEnabled = false
  try {
    if ('outFields' in layer) layer.outFields = ['*']
  } catch (_) {}
  applyOutlineOnlyPolygons(layer)
  setLayerVisible(layer, true)
  bringLayerToFront(webMap, layer)
  try { await view.whenLayerView?.(layer) } catch (_) {}

  const semiLayer = findSemiaridoLayer(webMap)
  let semiMunWhere = ''
  let semiGeometries: any[] = []
  let semiKeys: { codes: string[], names: string[] } = { codes: [], names: [] }
  if (semiLayer) {
    try { await semiLayer.load?.() } catch (_) {}
    setLayerVisible(semiLayer, false)
    try {
      // Região Semiárida_BA = 1 polígono regional. Não baixar/listar 287 municípios:
      // o DPA já traz região_do_semiarida; a camada BA só aparece no mapa ao ativar.
      const count = typeof semiLayer.queryFeatureCount === 'function'
        ? await semiLayer.queryFeatureCount({ where: '1=1' })
        : 1
      if (count > 5) {
        semiKeys = sanitizeSemiKeys(await querySemiMunicipioKeys(semiLayer))
      }
      if (hasUsableSemiKeys(semiKeys)) {
        semiMunWhere = buildDpaSemiWhere(layer, semiKeys)
      } else {
        semiKeys = { codes: [], names: [] }
        semiMunWhere = buildDpaSemiFieldWhere(layer)
      }
    } catch (error) {
      console.warn('[esgotamento] chaves da Região Semiárida_BA:', error)
    }
  }

  const [GraphicsLayer] = await loadArcGISJSAPIModules(['esri/layers/GraphicsLayer'])
  const semiHighlightLayer = new GraphicsLayer({
    title: 'Destaque Semiárido',
    listMode: 'hide',
    visible: false
  })
  const selectionHighlightLayer = new GraphicsLayer({
    title: 'Município selecionado',
    listMode: 'hide',
    visible: false
  })
  webMap.add(semiHighlightLayer)
  webMap.add(selectionHighlightLayer)

  const setoresLayer = findLayerByTitle(webMap, SETORES_LAYER_TITLE)
    || findLayerByTitle(webMap, 'Setores Censitários - Bahia')
    || findLayerByTitle(webMap, 'Setores Censitarios')
  if (setoresLayer) {
    if (typeof setoresLayer.popupEnabled === 'boolean') setoresLayer.popupEnabled = false
    setoresLayer.listMode = 'hide'
    setLayerVisible(setoresLayer, false)
  }

  await resizeMapView(view)
  return {
    view,
    layer,
    webMap,
    setoresLayer,
    semiLayer,
    semiKeys,
    mapApi: createMapApi(view, layer, {
      webMap,
      semiLayer,
      semiHighlightLayer,
      selectionHighlightLayer,
      semiGeometries,
      semiMunWhere,
      selectionColors: {
        fill: [139, 90, 43, 0.45],
        outline: [255, 196, 0, 1]
      }
    })
  }
}
