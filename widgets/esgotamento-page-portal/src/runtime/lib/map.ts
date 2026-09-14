import { loadArcGISJSAPIModules } from 'jimu-arcgis'
import { captureEsriLegendFromView } from './relatorio-pdf'

export const PORTAL_URL = 'https://portaldaagua.sihs.ba.gov.br/portal'
/** Web map ABASTECIMENTO / ESGOTAMENTO - Inventário de Infraestrutura Hídrica e Saneamento */
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

function keepSetoresOriginalSymbology (layer: any): void {
  if (!layer) return
  try { layer.labelsVisible = false } catch (_) {}
  try { layer.labelingInfo = [] } catch (_) {}
}

function pickAttrValue (attrs: Record<string, any> | null | undefined, candidates: string[]): any {
  if (!attrs) return null
  const byLower = new Map(Object.keys(attrs).map((key) => [key.toLowerCase(), key]))
  for (const candidate of candidates) {
    const actual = byLower.get(candidate.toLowerCase())
    if (actual == null) continue
    const value = attrs[actual]
    if (value != null && String(value).trim() !== '') return value
  }
  return null
}

function formatSetorValue (layer: any, fieldHint: string, raw: any): string {
  if (raw == null || raw === '') return '—'
  try {
    const field = (layer?.fields || []).find((item: any) => normalizeText(item?.name || '') === normalizeText(fieldHint))
    const coded = field?.domain?.codedValues as Array<{ code: any, name: string }> | undefined
    const match = coded?.find((item) => String(item.code) === String(raw))
    if (match?.name) return match.name
  } catch (_) {}
  const hint = normalizeText(fieldHint)
  const asCode = hint.includes('setor') || hint.includes('aglom') || hint.includes('codigo') || hint.startsWith('cd')
  const integerCode = (n: number) => Math.round(n).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (asCode || Math.abs(raw) >= 1e10) return integerCode(raw)
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: Number.isInteger(raw) ? 0 : 2 }).format(raw)
  }
  const text = String(raw).trim()
  const sci = text.replace(/\s/g, '').replace(',', '.')
  if (/^-?\d+(?:\.\d+)?e[+-]?\d+$/i.test(sci)) {
    const n = Number(sci)
    if (Number.isFinite(n)) return integerCode(n)
  }
  return text || '—'
}

type SetorPopupSpec = { label: string, candidates: string[] }

function setorPopupSpecs (theme: 'agua' | 'esgoto'): SetorPopupSpec[] {
  const common: SetorPopupSpec[] = [
    { label: 'Município', candidates: ['nm_mun', 'municipio', 'nome_do_municipio'] },
    { label: 'Situação', candidates: ['situacao', 'nm_sit', 'sit_setor', 'situacao_do_setor_censitario'] },
    { label: 'Tipo de setor', candidates: ['nm_tipo', 'tipo_sc', 'tipo_setor', 'tipo'] },
    { label: 'Distrito', candidates: ['nm_dist', 'nm_distrito', 'distrito'] },
    { label: 'Aglomerado', candidates: ['nm_aglom', 'nome_aglomerado', 'aglomerado'] },
    { label: 'Código do aglomerado', candidates: ['cd_aglom', 'cd_aglomerado', 'codigo_aglomerado', 'codigo_do_aglomerado'] },
    { label: 'População', candidates: ['v0001', 'populacao', 'pop'] },
    { label: 'Domicílios', candidates: ['v0002', 'domicilios', 'total_domicilios'] }
  ]
  if (theme === 'esgoto') {
    return [
      ...common,
      { label: 'Domicílios com banheiro', candidates: ['v00232'] },
      { label: 'Rede geral de esgoto', candidates: ['v00309'] }
    ]
  }
  return [
    ...common,
    { label: 'Rede geral de distribuição', candidates: ['v00111'] },
    { label: 'Poço profundo ou artesiano', candidates: ['v00112'] },
    { label: 'Poço raso, freático ou cacimba', candidates: ['v00113'] },
    { label: 'Fonte, nascente ou mina', candidates: ['v00114'] },
    { label: 'Carro-pipa', candidates: ['v00115'] },
    { label: 'Água de chuva armazenada', candidates: ['v00116'] },
    { label: 'Rios, açudes, córregos e lagos', candidates: ['v00117'] }
  ]
}

function setoresMunWhere (layer: any, codMun: string, nmMun?: string): string {
  const codField = resolveField(layer, 'cd_mun', 'codigo do municipio')
  const nameField = resolveField(layer, 'nm_mun', 'municipio')
  const digits = String(codMun || '').replace(/\D/g, '')
  const field = (layer?.fields || []).find((item: any) => String(item?.name || '') === codField)
  const asString = String(field?.type || '').toLowerCase().includes('string')
  if (codField && digits) {
    if (asString) return `${sqlField(codField)} = '${digits}'`
    const n = Number(digits)
    if (Number.isFinite(n)) return `${sqlField(codField)} = ${Math.round(n)}`
  }
  if (nameField && nmMun) {
    return `UPPER(${sqlField(nameField)}) = UPPER('${escapeSql(nmMun)}')`
  }
  return '1=0'
}

function setorGraphicWhere (layer: any, graphic: any): string | null {
  const attrs = graphic?.attributes || {}
  const code = pickAttrValue(attrs, ['cd_setor', 'codigo_do_setor'])
  const codeField = resolveField(layer, 'cd_setor', 'codigo do setor', 'codigo_do_setor')
  if (codeField && code != null && String(code).trim() !== '') {
    const field = (layer?.fields || []).find((item: any) => String(item?.name || '') === codeField)
    const asString = String(field?.type || '').toLowerCase().includes('string')
    if (asString) return `${sqlField(codeField)} = '${escapeSql(String(code))}'`
    const n = Number(code)
    if (Number.isFinite(n)) return `${sqlField(codeField)} = ${Math.round(n)}`
    return `${sqlField(codeField)} = '${escapeSql(String(code))}'`
  }
  const oidField = layer?.objectIdField
  const oid = oidField ? attrs[oidField] : null
  if (oidField && oid != null && Number.isFinite(Number(oid))) {
    return `${sqlField(oidField)} = ${Number(oid)}`
  }
  return null
}

function setorCodeWhere (layer: any, codigo: string): string | null {
  const code = String(codigo || '').trim()
  if (!code || code === '—') return null
  return setorGraphicWhere(layer, { attributes: { cd_setor: code, codigo_do_setor: code } })
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
  try {
    view.highlightOptions = {
      color: [201, 154, 88, 1],
      haloOpacity: 0.9,
      fillOpacity: 0.16
    }
  } catch (_) {}
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

function sameMapLayer (left: any, right: any): boolean {
  if (!left || !right) return false
  if (left === right) return true
  if (left.id && right.id && left.id === right.id) return true
  if (left.layerId != null && right.layerId != null && left.layerId === right.layerId) return true
  return false
}

function isLayerOrChild (candidate: any, target: any): boolean {
  let current = candidate
  for (let i = 0; i < 6 && current; i++) {
    if (sameMapLayer(current, target)) return true
    current = current.parent
  }
  return false
}

function graphicFromHit (hit: any, layer: any): any | null {
  const results = hit?.results || []
  const match = results.find((item: any) => {
    const graphic = item?.graphic
    const lyr = item?.layer || graphic?.layer
    return graphic && (isLayerOrChild(lyr, layer) || isLayerOrChild(layer, lyr))
  })
  return match?.graphic || null
}

function featureEnvelopeArea (feature: any): number {
  const extent = feature?.geometry?.extent
  if (!extent) return Number.POSITIVE_INFINITY
  const width = Math.abs((extent.xmax ?? 0) - (extent.xmin ?? 0))
  const height = Math.abs((extent.ymax ?? 0) - (extent.ymin ?? 0))
  const area = width * height
  return area > 0 ? area : Number.POSITIVE_INFINITY
}

function pickSmallestFeature (features: any[]): any | null {
  if (!features?.length) return null
  return features.slice().sort((a, b) => featureEnvelopeArea(a) - featureEnvelopeArea(b))[0]
}

function clickSearchGeometry (view: any, event: any, pixels = 14): any | null {
  const mapPoint = event?.mapPoint || (typeof view?.toMap === 'function'
    ? view.toMap({ x: event?.x, y: event?.y })
    : null)
  if (typeof view?.toMap !== 'function' || event?.x == null || event?.y == null) return mapPoint
  try {
    const a = view.toMap({ x: event.x - pixels, y: event.y - pixels })
    const b = view.toMap({ x: event.x + pixels, y: event.y + pixels })
    if (!a || !b) return mapPoint
    return {
      type: 'extent',
      xmin: Math.min(a.x, b.x),
      xmax: Math.max(a.x, b.x),
      ymin: Math.min(a.y, b.y),
      ymax: Math.max(a.y, b.y),
      spatialReference: a.spatialReference || view.spatialReference
    }
  } catch (_) {
    return mapPoint
  }
}

async function hydrateGraphicByObjectId (layer: any, graphic: any): Promise<any | null> {
  if (!graphic) return null
  if (!layer || typeof layer.queryFeatures !== 'function') return graphic
  const oidField = String(layer.objectIdField || 'OBJECTID')
  const oid = Number(graphic?.attributes?.[oidField] ?? graphic?.attributes?.OBJECTID ?? graphic?.attributes?.objectid)
  if (!Number.isFinite(oid) || oid <= 0) return graphic
  try {
    await layer.load?.()
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.objectIds = [oid]
    query.outFields = ['*']
    query.returnGeometry = true
    const result = await layer.queryFeatures(query)
    return result?.features?.[0] || graphic
  } catch (_) {
    return graphic
  }
}

async function querySetorAtClick (layer: any, view: any, event: any): Promise<any | null> {
  if (!layer || typeof layer.queryFeatures !== 'function') return null
  const geometry = clickSearchGeometry(view, event)
  if (!geometry) return null
  try {
    await layer.load?.()
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.geometry = geometry
    query.spatialRelationship = 'intersects'
    query.returnGeometry = true
    query.outFields = ['*']
    query.num = 40
    const result = await layer.queryFeatures(query)
    return pickSmallestFeature(result?.features || [])
  } catch (_) {
    return null
  }
}

async function resolveSetorGraphic (view: any, layer: any, event: any): Promise<any | null> {
  if (!view || !layer) return null
  let graphic: any | null = null
  try {
    const hit = await view.hitTest(event, { include: [layer] })
    graphic = graphicFromHit(hit, layer)
  } catch (_) {}
  if (!graphic) graphic = await querySetorAtClick(layer, view, event)
  if (!graphic) return null
  return hydrateGraphicByObjectId(layer, graphic)
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
  showSetores: (codMun: string, nmMun?: string) => Promise<void>
  hideSetores: () => void
  selectSetorByCodigo: (codigo: string, oid?: number) => Promise<void>
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
  setoresLayer?: any | null
  setoresTheme?: 'agua' | 'esgoto'
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

  const munWhere = (codMun: string) => {
    const raw = String(codMun || '').trim()
    const num = Number(raw)
    if (Number.isFinite(num) && num > 0) return `${sqlField(codField)} = ${Math.round(num)}`
    return `${sqlField(codField)} = '${escapeSql(raw)}'`
  }

  const zoomToSetorGeometry = async (graphic: any, duration = 900) => {
    if (!view || !graphic?.geometry) return false
    try {
      const geom = graphic.geometry
      const extent = geom.extent?.clone?.() || geom.extent
      if (extent && typeof extent.expand === 'function') {
        await view.goTo(extent.expand(1.22), { duration })
        return true
      }
      await view.goTo({ target: geom, zoom: Math.max(Number(view.zoom) || 0, 15) }, { duration })
      return true
    } catch (error) {
      console.warn('[esgotamento] zoom do aglomerado falhou:', error)
      return false
    }
  }

  const zoomToWhere = async (where: string, targetLayer: any = layer, expand = 1.12, duration = 700) => {
    if (!view || !targetLayer) return false
    try {
      let extent = null
      if (typeof targetLayer.queryExtent === 'function') {
        const result = await targetLayer.queryExtent({ where })
        if (result?.extent && result.count !== 0) extent = result.extent
      }
      if (!extent && typeof targetLayer.queryFeatures === 'function') {
        const query = typeof targetLayer.createQuery === 'function' ? targetLayer.createQuery() : {}
        query.where = where
        query.returnGeometry = true
        query.num = 1
        const result = await targetLayer.queryFeatures(query)
        extent = result?.features?.[0]?.geometry?.extent || null
      }
      if (!extent) return false
      const target = typeof extent.expand === 'function' ? extent.expand(expand) : extent
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

  let highlightHandle: { remove?: () => void } | null = null
  let setorHighlightHandle: { remove?: () => void } | null = null
  let setoresActive = false
  let setorPopupEl: HTMLElement | null = null

  const clearSetorHighlight = () => {
    try { setorHighlightHandle?.remove?.() } catch (_) {}
    setorHighlightHandle = null
    const sl = options.setoresLayer
    if (sl) {
      try { sl.featureEffect = null } catch (_) {}
    }
  }

  const selectSetorGraphic = async (graphic: any) => {
    clearSetorHighlight()
    const sl = options.setoresLayer
    if (!sl || !graphic) return
    const where = setorGraphicWhere(sl, graphic)
    if (where) {
      try {
        sl.featureEffect = {
          filter: { where },
          includedEffect: 'drop-shadow(0px, 0px, 16px, #c99a58) brightness(1.28) saturate(1.35)',
          excludedEffect: 'opacity(28%)'
        }
      } catch (_) {
        try { sl.featureEffect = null } catch (__) {}
      }
    }
    try {
      const layerView = await view.whenLayerView(sl)
      if (typeof layerView?.highlight === 'function') {
        setorHighlightHandle = layerView.highlight(graphic)
      }
    } catch (_) {}
  }

  const closeSetorPopup = () => {
    clearSetorHighlight()
    if (!setorPopupEl) return
    setorPopupEl.classList.remove('is-open')
    setorPopupEl.hidden = true
    setorPopupEl.innerHTML = ''
  }

  const ensureSetorPopup = () => {
    const host = view?.container?.parentElement || view?.container
    if (!host) return null
    if (!setorPopupEl || !host.contains(setorPopupEl)) {
      setorPopupEl = document.createElement('div')
      setorPopupEl.className = 'setor-popup'
      setorPopupEl.hidden = true
      setorPopupEl.setAttribute('role', 'complementary')
      setorPopupEl.setAttribute('aria-label', 'Ficha do setor censitário')
      host.appendChild(setorPopupEl)
    }
    return setorPopupEl
  }

  const openSetorPopup = (graphic: any) => {
    const el = ensureSetorPopup()
    const sl = options.setoresLayer
    if (!el) return
    const attrs = graphic?.attributes || {}
    const code = pickAttrValue(attrs, ['cd_setor', 'codigo_do_setor'])
    const munName = pickAttrValue(attrs, ['nm_mun', 'municipio', 'nome_do_municipio'])
    const theme = options.setoresTheme || 'esgoto'
    const rows = setorPopupSpecs(theme).flatMap((spec) => {
      const raw = pickAttrValue(attrs, spec.candidates)
      if (raw == null) return []
      return [{ label: spec.label, value: formatSetorValue(sl, spec.candidates[0], raw) }]
    })
    const title = code != null && String(code).trim() ? String(code) : 'Setor censitário'
    const eyebrow = munName != null ? `<p class="setor-popup__eyebrow">${String(munName)}</p>` : ''
    el.innerHTML = `
      <div class="setor-popup__card">
        <button type="button" class="setor-popup__close" aria-label="Fechar">×</button>
        <p class="setor-popup__kicker">Ficha do setor censitário</p>
        ${eyebrow}
        <h4 class="setor-popup__title">${title}</h4>
        <dl class="setor-popup__grid">
          ${rows.map((row) => `
            <div class="setor-popup__row">
              <dt class="setor-popup__label">${row.label}</dt>
              <dd class="setor-popup__value">${row.value}</dd>
            </div>
          `).join('')}
        </dl>
      </div>
    `
    el.hidden = false
    el.classList.add('is-open')
    void selectSetorGraphic(graphic)
    el.querySelector('.setor-popup__close')?.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      closeSetorPopup()
    })
  }

  const hideSetoresLayer = () => {
    setoresActive = false
    closeSetorPopup()
    const sl = options.setoresLayer
    if (!sl) return
    try { sl.definitionExpression = null } catch (_) {}
    setLayerVisible(sl, false)
  }

  const clearLayerViewHighlight = () => {
    try { highlightHandle?.remove?.() } catch (_) {}
    highlightHandle = null
  }

  const applySelectionHighlight = (state: PainelMapState) => {
    clearLayerViewHighlight()
    if (options.selectionHighlightLayer) {
      options.selectionHighlightLayer.removeAll?.()
      options.selectionHighlightLayer.visible = false
    }

    const munWhereClause = state.selectedMun ? munWhere(state.selectedMun) : null
    const tiWhere = (tiField && state.regiao && state.regiao !== 'todas')
      ? `${sqlField(tiField)} = '${escapeSql(state.regiao)}'`
      : null
    const where = munWhereClause || tiWhere

    if (!layer) return
    if (!where) {
      layer.featureEffect = null
      return
    }
    try {
      layer.featureEffect = {
        filter: { where },
        includedEffect: munWhereClause
          ? 'drop-shadow(0px, 0px, 18px, #c99a58) drop-shadow(0px, 0px, 4px, #1A0F08) brightness(1.25) saturate(1.4)'
          : 'drop-shadow(0px, 0px, 12px, #c99a58) brightness(1.12) saturate(1.2)',
        excludedEffect: munWhereClause ? 'opacity(32%)' : 'opacity(40%)'
      }
    } catch (_) {
      layer.featureEffect = null
    }
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
      applySelectionHighlight(state)
      if (!state.selectedMun) {
        hideSetoresLayer()
      }
    },

    setMunicipios (items) {
      munByName.clear()
      for (const item of items || []) {
        const cod = String(item?.cod_mun || '').trim()
        const name = String(item?.nm_mun || '').trim()
        if (cod && name) munByName.set(normalizeMunName(name), cod)
      }
    },

    async showSetores (codMun: string, nmMun?: string) {
      const sl = options.setoresLayer
      if (!sl) return
      try { await sl.load?.() } catch (_) {}
      keepSetoresOriginalSymbology(sl)
      sl.definitionExpression = setoresMunWhere(sl, codMun, nmMun)
      try { if ('outFields' in sl) sl.outFields = ['*'] } catch (_) {}
      if (typeof sl.popupEnabled === 'boolean') sl.popupEnabled = false
      sl.listMode = 'hide'
      setLayerVisible(sl, true)
      bringLayerToFront(options.webMap, sl)
      if (options.selectionHighlightLayer) {
        bringLayerToFront(options.webMap, options.selectionHighlightLayer)
      }
      setoresActive = true
    },

    hideSetores () {
      hideSetoresLayer()
    },

    async selectSetorByCodigo (codigo: string, oid = 0) {
      const sl = options.setoresLayer
      if (!sl || typeof sl.queryFeatures !== 'function') {
        console.warn('[esgotamento] camada de setores indisponível para seleção')
        return
      }
      try { await sl.load?.() } catch (_) {}
      keepSetoresOriginalSymbology(sl)
      try { if ('outFields' in sl) sl.outFields = ['*'] } catch (_) {}
      if (typeof sl.popupEnabled === 'boolean') sl.popupEnabled = false
      sl.listMode = 'hide'
      setLayerVisible(sl, true)
      bringLayerToFront(options.webMap, sl)
      setoresActive = true

      const queryGraphic = async (setup: (query: any) => void) => {
        const query = typeof sl.createQuery === 'function' ? sl.createQuery() : {}
        query.outFields = ['*']
        query.returnGeometry = true
        query.num = 1
        setup(query)
        const result = await sl.queryFeatures(query)
        return result?.features?.[0] || null
      }

      let graphic: any = null
      const oidNum = Number(oid)
      if (Number.isFinite(oidNum) && oidNum > 0) {
        try {
          graphic = await queryGraphic((query) => {
            query.objectIds = [oidNum]
            query.where = null
          })
        } catch (error) {
          console.warn('[esgotamento] query setor por OID:', error)
        }
      }
      if (!graphic) {
        const field = resolveField(sl, 'cd_setor', 'codigo do setor', 'codigo_do_setor')
        const code = String(codigo || '').trim()
        const tries: string[] = []
        if (field && code && code !== '—') {
          tries.push(`${sqlField(field)} = '${escapeSql(code)}'`)
          if (/^\d+$/.test(code)) tries.push(`${sqlField(field)} = ${code}`)
        }
        for (const where of tries) {
          try {
            graphic = await queryGraphic((query) => { query.where = where })
            if (graphic) break
          } catch (error) {
            console.warn('[esgotamento] query setor por código:', where, error)
          }
        }
      }
      if (!graphic) {
        console.warn('[esgotamento] setor não encontrado na lista', { codigo, oid })
        return
      }
      let zoomed = await zoomToSetorGeometry(graphic, 900)
      if (!zoomed) {
        const where = setorGraphicWhere(sl, graphic)
          || (oidNum > 0 ? `${sqlField(String(sl.objectIdField || 'OBJECTID'))} = ${oidNum}` : '')
        if (where) zoomed = await zoomToWhere(where, sl, 1.22, 900)
      }
      await waitForIdle()
      openSetorPopup(graphic)
    },

    async zoomToMun (codMun: string) {
      await zoomToWhere(munWhere(codMun), layer, 1.55, 700)
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
        const shot = await view.takeScreenshot({ format: 'jpg', quality: 92, width: 1920 })
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
          if (setoresActive && options.setoresLayer) {
            const setor = await resolveSetorGraphic(view, options.setoresLayer, event)
            if (setor) openSetorPopup(setor)
            return
          }
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
    keepSetoresOriginalSymbology(setoresLayer)
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
      setoresLayer,
      setoresTheme: 'esgoto',
      selectionColors: {
        fill: [139, 90, 43, 0.45],
        outline: [255, 196, 0, 1]
      }
    })
  }
}
