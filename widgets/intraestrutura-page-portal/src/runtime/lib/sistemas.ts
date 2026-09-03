import { findLayer, getAllLayers } from './layers'

export const SISTEMAS_WEB_MAP_ID = '2c52d1e8cbae411ea80842484384ef8f'
export const CISTERNAS_WEB_MAP_ID = 'cd3b5f9c9dca4d72b74104ae17e26640'
export const POCOS_WEB_MAP_ID = 'b500c61fe4854f588184bce720d6e4f3'
export const SISTEMAS_TOTAL_LAYER = 'Total de Sistemas'
export const CISTERNAS_TOTAL_LAYER = 'Cisternas'
export const POCOS_TOTAL_LAYER = 'Poços'

export interface SistemaLayerItem {
  id: string
  title: string
  visible: boolean
}

export interface MunicipioSistema {
  name: string
  total: number
}

export interface ClassMapConfig {
  id: string
  webMapId: string
  tabLabel: string
  shortLabel: string
  eyebrow: string
  title: string
  unitSingular: string
  unitPlural: string
  rankingSource: string
  totalLayerTitles: string[]
  nameFields: string[]
  countFields: string[]
  emptyRanking: string
  loadingMap: string
  allowedLayerKeys?: string[]
  /** Campo de total no popup do município (ausente = sem linha de total). */
  popupTotalLabel?: string
  popupTotalCandidates?: string[]
  note?: string
}

export const CLASS_MAP_CONFIGS: ClassMapConfig[] = [
  {
    id: 'sistemas',
    webMapId: SISTEMAS_WEB_MAP_ID,
    tabLabel: 'Sistemas de abastecimento',
    shortLabel: 'Sistemas',
    eyebrow: 'Sistemas de abastecimento',
    title: 'Distribuição no Território',
    note: 'Todos os sistemas cadastrados, por município — não apenas os geolocalizados',
    unitSingular: 'sistema',
    unitPlural: 'sistemas',
    rankingSource: 'CERB 2026 · Sistemas de Abastecimento de Água',
    totalLayerTitles: [SISTEMAS_TOTAL_LAYER, 'Camada_Teste'],
    nameFields: ['municipio', 'nm_mun', 'nm_mun_1'],
    countFields: ['frequency', 'count_objectid', 'total', 'qtd'],
    emptyRanking: 'Sem dados de sistemas.',
    loadingMap: 'Carregando mapa de sistemas…',
    popupTotalLabel: 'SISTEMAS (TOTAL)',
    popupTotalCandidates: [
      'sistemas (total)',
      'sistemas_total',
      'sistemastotal',
      'frequency',
      'count_objectid',
      'total',
      'qtd'
    ]
  },
  {
    id: 'cisternas',
    webMapId: CISTERNAS_WEB_MAP_ID,
    tabLabel: 'Cisternas',
    shortLabel: 'Cisternas',
    eyebrow: 'Cisternas',
    title: 'Distribuição no Território',
    unitSingular: 'cisterna',
    unitPlural: 'cisternas',
    rankingSource: 'SEADES / MDS 2003 - 2025',
    totalLayerTitles: [CISTERNAS_TOTAL_LAYER, 'Total de Cisternas'],
    nameFields: ['municipio', 'nm_mun', 'nm_mun_1'],
    countFields: ['t_cisterna', 'frequency', 'total'],
    emptyRanking: 'Sem dados de cisternas.',
    loadingMap: 'Carregando mapa de cisternas…',
    popupTotalLabel: 'CISTERNAS (TOTAL)',
    popupTotalCandidates: [
      'cisternas (total)',
      'cisternas_total',
      'cisternastotal',
      't_cisterna',
      'frequency',
      'total'
    ]
  },
  {
    id: 'pocos',
    webMapId: POCOS_WEB_MAP_ID,
    tabLabel: 'Poços',
    shortLabel: 'Poços',
    eyebrow: 'Poços',
    title: 'Distribuição no Território',
    unitSingular: 'poço',
    unitPlural: 'poços',
    rankingSource: 'Poços por município',
    totalLayerTitles: [POCOS_TOTAL_LAYER, 'Pocos', 'Total de Poços', 'Poços e Cisternas por Município-BA', CISTERNAS_TOTAL_LAYER],
    nameFields: ['municipio', 'nm_mun', 'nm_mun_1'],
    countFields: ['total_poco', 't_poco', 'frequency', 'total'],
    emptyRanking: 'Sem dados de poços.',
    loadingMap: 'Carregando mapa de poços…',
    allowedLayerKeys: ['total', 'vazao aproveit', 'aproveitavel', 'vazao insuficien', 'insuficiente'],
    popupTotalLabel: 'POÇOS (TOTAL)',
    popupTotalCandidates: [
      'pocos (total)',
      'poços (total)',
      'pocos_total',
      'pocostotal',
      'total_poco',
      't_poco',
      'frequency',
      'total'
    ]
  }
]

function fieldSet (layer: any): Set<string> {
  return new Set((layer?.fields || []).map((field: any) => String(field?.name || '').toLowerCase()))
}

function pickField (layer: any, candidates: string[]): string | null {
  const available = fieldSet(layer)
  const match = candidates.find((name) => available.has(name.toLowerCase()))
  if (!match) return null
  return (layer.fields || []).find((field: any) => String(field?.name || '').toLowerCase() === match.toLowerCase())?.name || match
}

export function findTotalLayer (webMap: any, titles: string[], countFields: string[] = []): any | null {
  for (const title of titles) {
    const layer = findLayer(webMap, { layerTitle: title })
    if (layer) return layer
  }
  const layers = getAllLayers(webMap)
  const countSet = new Set(countFields.map((name) => name.toLowerCase()))
  const byRenderer = layers.find((layer: any) => {
    const field = String(layer?.renderer?.field || '').toLowerCase()
    return layer?.renderer?.type === 'class-breaks' && (!countSet.size || countSet.has(field))
  })
  if (byRenderer) return byRenderer
  return layers.find((layer: any) => layer?.renderer?.type === 'class-breaks') || null
}

function normalizeLayerTitle (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

/** Camadas do web map que não devem aparecer em Distribuição no Território. */
const EXCLUDED_LAYER_KEYS = ['lm_estadual', 'lmestadual']

function isExcludedLayerTitle (title: string): boolean {
  const normalized = normalizeLayerTitle(title)
  const compact = normalized.replace(/[^a-z0-9]/g, '')
  if (EXCLUDED_LAYER_KEYS.some((key) => compact.includes(key.replace(/[^a-z0-9]/g, '')))) return true
  if (compact.includes('secouposterior')) return true
  if (/(^|[^a-z])seco([^a-z]|$)/.test(normalized)) return true
  return false
}

function layerIsAllowed (title: string, allowedKeys?: string[]): boolean {
  if (isExcludedLayerTitle(title)) return false
  if (!allowedKeys?.length) return true
  const normalized = normalizeLayerTitle(title)
  return allowedKeys.some((key) => normalized.includes(normalizeLayerTitle(key)))
}

function escapeSqlLiteral (value: string): string {
  return String(value || '').replace(/'/g, "''")
}

function sqlAnd (...clauses: Array<string | null | undefined>): string {
  const parts = clauses
    .map((clause) => String(clause || '').trim())
    .filter((clause) => clause && clause.toLowerCase() !== '1=1')
    .map((clause) => (clause.startsWith('(') ? clause : `(${clause})`))
  return parts.length ? parts.join(' AND ') : '1=1'
}

function tipoLikeWhere (value: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  return `tipo_de_sistema LIKE '${escapeSqlLiteral(trimmed)}%'`
}

function normalizeTipoDefinitionExpression (where: string): string {
  return String(where || '').replace(
    /tipo_de_sistema\s*=\s*'([^']*)'/gi,
    (_all, raw: string) => tipoLikeWhere(raw)
  )
}

function tipoWhereFromTitle (title: string): string {
  const normalized = normalizeLayerTitle(title)
  if (/simplificado/.test(normalized)) return tipoLikeWhere('SISTEMA SIMPLIFICADO')
  if (/convencional/.test(normalized)) return tipoLikeWhere('SISTEMA CONVENCIONAL')
  if (/integrado/.test(normalized)) return tipoLikeWhere('INTEGRADO')
  if (/boca de poco|instalacao/.test(normalized)) return tipoLikeWhere('INSTALAÇÃO BOCA DE POÇO')
  return ''
}

export function normalizeSistemasTypeFilters (webMap: any): void {
  const layers = webMap?.layers?.toArray?.() || []
  for (const layer of layers) {
    const current = String(layer?.definitionExpression || '').trim()
    const next = current
      ? normalizeTipoDefinitionExpression(current)
      : tipoWhereFromTitle(layer?.title || '')
    if (next && next !== current) layer.definitionExpression = next
  }
}

function rankingWhere (layer: any, countField: string): string {
  const inherited = String(layer?.definitionExpression || '').trim()
  const typeWhere = inherited
    ? normalizeTipoDefinitionExpression(inherited)
    : tipoWhereFromTitle(layer?.title || '')
  return sqlAnd(typeWhere, `${countField} IS NOT NULL AND ${countField} > 0`)
}

export function applyAllowedLayers (webMap: any, allowedKeys?: string[]): void {
  const layers = webMap?.layers?.toArray?.() || []
  let keptVisible = false
  for (const layer of layers) {
    const title = layer?.title || ''
    if (isExcludedLayerTitle(title) || (allowedKeys?.length && !layerIsAllowed(title, allowedKeys))) {
      layer.visible = false
      continue
    }
    if (!allowedKeys?.length) {
      if (layer.visible !== false) keptVisible = true
      continue
    }
    if (layer.visible !== false) keptVisible = true
  }
  if (!allowedKeys?.length) return
  if (!keptVisible) {
    const total = layers.find((layer: any) => {
      const title = layer?.title || ''
      return !isExcludedLayerTitle(title) && normalizeLayerTitle(title).includes('total')
    })
    if (total) total.visible = true
    else {
      const first = layers.find((layer: any) => layerIsAllowed(layer?.title || '', allowedKeys))
      if (first) first.visible = true
    }
  }
}

export function listSistemasLayers (webMap: any, allowedKeys?: string[]): SistemaLayerItem[] {
  const layers = webMap?.layers?.toArray?.() || []
  return layers
    .filter((layer: any) => layer && layer.title && layerIsAllowed(layer.title, allowedKeys))
    .map((layer: any) => ({
      id: layer.id,
      title: layer.title,
      visible: layer.visible !== false
    }))
    .reverse()
}

export function sistemasLegendLayerInfos (webMap: any, allowedKeys?: string[]): Array<{ layer: any, title: string }> {
  const layers = webMap?.layers?.toArray?.() || []
  return listSistemasLayers(webMap, allowedKeys)
    .map((item) => {
      const layer = layers.find((entry: any) => entry.id === item.id)
      return layer ? { layer, title: item.title } : null
    })
    .filter(Boolean) as Array<{ layer: any, title: string }>
}

export async function orderTotalSistemasBreaksAscending (
  webMap: any,
  layerTitles: string[] = [SISTEMAS_TOTAL_LAYER]
): Promise<void> {
  const layer = findTotalLayer(webMap, layerTitles)
  if (!layer) return
  await layer.load?.()

  const renderer = layer.renderer
  if (!renderer || renderer.type !== 'class-breaks' || !renderer.classBreakInfos?.length) return

  const infos = renderer.classBreakInfos.slice()
  const firstMax = Number(infos[0]?.maxValue ?? infos[0]?.classMaxValue)
  const lastMax = Number(infos[infos.length - 1]?.maxValue ?? infos[infos.length - 1]?.classMaxValue)
  if (!Number.isFinite(firstMax) || !Number.isFinite(lastMax) || firstMax <= lastMax) return

  renderer.classBreakInfos = infos.reverse()
}

export function selectExclusiveSistemasLayer (
  webMap: any,
  layerId: string,
  allowedKeys?: string[]
): void {
  const layers = webMap?.layers?.toArray?.() || []
  for (const layer of layers) {
    if (!layerIsAllowed(layer?.title || '', allowedKeys)) {
      layer.visible = false
      continue
    }
    layer.visible = layer.id === layerId
  }
}

export function resolveActiveSistemasLayer (
  webMap: any,
  layerId?: string | null,
  allowedKeys?: string[]
): any | null {
  if (layerId) {
    const byId = findLayer(webMap, { layerId })
    if (byId) return byId
  }
  const visible = listSistemasLayers(webMap, allowedKeys).find((item) => item.visible)
  return visible ? findLayer(webMap, { layerId: visible.id }) : null
}

/** Rótulo da ficha: segue a camada visível, não o total genérico. */
export function popupCountLabel (config: Pick<ClassMapConfig, 'id'>, layerTitle: string): string {
  const title = String(layerTitle || '').trim()
  const normalized = normalizeLayerTitle(title)
  if (config.id === 'cisternas') return 'CISTERNAS'
  if (config.id === 'pocos') {
    if (/vazao aproveit|aproveitavel/.test(normalized)) return 'POÇOS · VAZÃO APROVEITÁVEL'
    if (/vazao insuficien|insuficiente/.test(normalized)) return 'POÇOS · VAZÃO INSUFICIENTE'
    if (/(^|[^a-z])seco([^a-z]|$)/.test(normalized)) return 'POÇOS · SECO'
    if (/total/.test(normalized)) return 'POÇOS (TOTAL)'
    return title.toUpperCase() || 'POÇOS'
  }
  if (/simplificado/.test(normalized)) return 'SISTEMAS SIMPLIFICADO'
  if (/convencional/.test(normalized)) return 'SISTEMAS CONVENCIONAL'
  if (/integrado/.test(normalized)) return 'SISTEMAS INTEGRADO'
  if (/boca de poco|instalacao/.test(normalized)) return 'INSTALAÇÃO BOCA DE POÇO'
  if (/total/.test(normalized)) return 'SISTEMAS (TOTAL)'
  return title.replace(/^Sistema\s+/i, 'SISTEMAS ').toUpperCase() || 'SISTEMAS'
}

function pickCountField (layer: any, candidates: string[]): string | null {
  const rendererField = String(layer?.renderer?.field || '').trim()
  if (rendererField && !rendererField.startsWith('$')) {
    const fromRenderer = pickField(layer, [rendererField])
    if (fromRenderer) return fromRenderer
  }
  const fromCandidates = pickField(layer, candidates)
  if (fromCandidates) return fromCandidates

  const skip = /^(objectid|fid|oid|globalid|shape__area|shape__length)$/i
  const numeric = (layer.fields || []).find((field: any) => {
    const name = String(field?.name || '')
    const type = String(field?.type || '').toLowerCase()
    if (!name || skip.test(name)) return false
    return (
      type.includes('integer') ||
      type.includes('double') ||
      type.includes('small') ||
      type === 'long' ||
      type === 'oid'
    ) && type !== 'oid'
  })
  return numeric?.name || null
}

function pickNameField (layer: any, candidates: string[]): string | null {
  const fromCandidates = pickField(layer, candidates)
  if (fromCandidates) return fromCandidates
  const display = String(layer?.displayField || '').trim()
  if (display) {
    const fromDisplay = pickField(layer, [display])
    if (fromDisplay) return fromDisplay
  }
  const textField = (layer.fields || []).find((field: any) => {
    const type = String(field?.type || '').toLowerCase()
    return type.includes('string') || type === 'text'
  })
  return textField?.name || null
}

function resolveQueryableLayer (webMap: any, layerId?: string | null): any | null {
  if (!layerId) return null
  return findLayer(webMap, { layerId })
}

export async function searchMunicipiosSistemas (
  webMap: any,
  searchText: string,
  config?: Pick<ClassMapConfig, 'totalLayerTitles' | 'nameFields' | 'countFields'>,
  layerId?: string | null,
  limit = 12
): Promise<MunicipioSistema[]> {
  const queryText = searchText.trim()
  if (queryText.length < 2) return []

  const titles = config?.totalLayerTitles || [SISTEMAS_TOTAL_LAYER]
  const nameFields = config?.nameFields || ['municipio']
  const countFields = config?.countFields || ['frequency']
  const layer = layerId
    ? resolveQueryableLayer(webMap, layerId)
    : findTotalLayer(webMap, titles, countFields)
  if (!layer || typeof layer.queryFeatures !== 'function') return []

  await layer.load?.()
  const nameField = pickNameField(layer, nameFields)
  const countField = pickCountField(layer, countFields)
  if (!nameField) return []

  const like = `'%${escapeSqlLiteral(queryText).replace(/%/g, '\\%').replace(/_/g, '\\_').toUpperCase()}%'`
  const inherited = String(layer?.definitionExpression || '').trim()
  const typeWhere = inherited
    ? normalizeTipoDefinitionExpression(inherited)
    : tipoWhereFromTitle(layer?.title || '')
  const query = layer.createQuery()
  query.where = sqlAnd(typeWhere, `UPPER(${nameField}) LIKE ${like}`)
  query.returnGeometry = false
  query.num = limit
  query.outFields = [nameField, ...(countField ? [countField] : [])]
  if (countField) query.orderByFields = [`${countField} DESC`]

  try {
    const result = await layer.queryFeatures(query)
    return (result.features || [])
      .map((feature: any) => {
        const attrs = feature.attributes || {}
        return {
          name: String(attrs[nameField] || '').trim() || '—',
          total: Number(attrs[countField || ''] ?? 0)
        }
      })
      .filter((item: MunicipioSistema) => item.name !== '—')
  } catch (err) {
    console.error('[infra-sistemas] Falha ao buscar município:', err)
    return []
  }
}

export async function loadMunicipioSistemaFeature (
  webMap: any,
  name: string,
  config?: Pick<ClassMapConfig, 'totalLayerTitles' | 'nameFields' | 'countFields'>,
  layerId?: string | null
): Promise<{ layer: any, feature: any } | null> {
  const wanted = String(name || '').trim()
  if (!wanted) return null
  const titles = config?.totalLayerTitles || [SISTEMAS_TOTAL_LAYER]
  const nameFields = config?.nameFields || ['municipio']
  const countFields = config?.countFields || ['frequency']
  const layer = layerId
    ? resolveQueryableLayer(webMap, layerId)
    : findTotalLayer(webMap, titles, countFields)
  if (!layer || typeof layer.queryFeatures !== 'function') return null

  await layer.load?.()
  const nameField = pickNameField(layer, nameFields)
  if (!nameField) return null

  const query = layer.createQuery()
  query.where = sqlAnd(
    layer.definitionExpression,
    `UPPER(${nameField}) = UPPER('${escapeSqlLiteral(wanted)}')`
  )
  query.returnGeometry = true
  query.num = 1
  query.outFields = ['*']

  try {
    const result = await layer.queryFeatures(query)
    const feature = result?.features?.[0]
    return feature ? { layer, feature } : null
  } catch (err) {
    console.error('[infra-sistemas] Falha ao localizar município:', err)
    return null
  }
}

export async function loadTopMunicipiosSistemas (
  webMap: any,
  limit = 10,
  config?: Pick<ClassMapConfig, 'totalLayerTitles' | 'nameFields' | 'countFields'>,
  layerId?: string | null
): Promise<MunicipioSistema[]> {
  const titles = config?.totalLayerTitles || [SISTEMAS_TOTAL_LAYER]
  const nameFields = config?.nameFields || ['municipio']
  const countFields = config?.countFields || ['frequency']
  const layer = layerId
    ? resolveQueryableLayer(webMap, layerId)
    : findTotalLayer(webMap, titles, countFields)
  if (!layer || typeof layer.queryFeatures !== 'function') return []

  await layer.load?.()
  const nameField = pickNameField(layer, nameFields)
  const countField = pickCountField(layer, countFields)
  if (!nameField || !countField) return []

  const query = layer.createQuery()
  query.where = rankingWhere(layer, countField)
  query.returnGeometry = false
  query.num = Math.max(limit * 4, 80)
  query.outFields = [nameField, countField]
  query.orderByFields = [`${countField} DESC`]

  const toItems = (features: any[]) => (features || [])
    .map((feature: any) => {
      const attrs = feature.attributes || {}
      return {
        name: String(attrs[nameField] || '').trim() || '—',
        total: Number(attrs[countField] ?? 0)
      }
    })
    .filter((item: MunicipioSistema) => item.total > 0)
    .sort((a: MunicipioSistema, b: MunicipioSistema) => b.total - a.total)
    .slice(0, limit)

  try {
    const result = await layer.queryFeatures(query)
    return toItems(result.features)
  } catch (err) {
    console.error('[infra-sistemas] Falha ao consultar ranking:', err)
    query.orderByFields = []
    try {
      const result = await layer.queryFeatures(query)
      return toItems(result.features)
    } catch {
      return []
    }
  }
}
