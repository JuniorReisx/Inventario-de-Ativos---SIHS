import { findLayer } from './layers'
import { escapeSqlString, normalizeMunName } from './municipios'

export const ASSET_PAGE_SIZE = 7

export type AssetType = '' | 'reservatorios' | 'pocos' | 'sistemas'

export interface AssetDef {
  id: Exclude<AssetType, ''>
  title: string
  layerTitle: string
  nameFields: string[]
  municipalityFields: string[]
  localityFields?: string[]
  typeFields?: string[]
}

export interface AtivoItem {
  key: string
  type: Exclude<AssetType, ''>
  typeLabel: string
  name: string
  municipality: string
  layerTitle: string
  oidField: string
  oid: number
  geometry?: any
  layerId?: string
}

export const ASSET_DEFS: AssetDef[] = [
  {
    id: 'sistemas',
    title: 'Sistemas de Abastecimento',
    layerTitle: 'Sistemas de Abastecimento',
    nameFields: ['localidade', 'codigo', 'tipo_sistema', 'captacao', 'msb'],
    municipalityFields: ['nm_mun', 'municipio_oficial', 'municipio'],
    localityFields: ['localidade', 'localizacao', 'nome'],
    typeFields: ['tipo_sistema', 'tipo', 'sistema']
  },
  {
    id: 'pocos',
    title: 'Poços',
    layerTitle: 'Poços',
    nameFields: ['localidade', 'localizacao', 'codigo', 'aquifero'],
    municipalityFields: ['nm_mun', 'municipio'],
    localityFields: ['localidade', 'localizacao', 'nome'],
    typeFields: ['condicao', 'estado_qualitativo', 'situacao', 'tipo']
  },
  {
    id: 'reservatorios',
    title: 'Reservatórios',
    layerTitle: 'Reservatórios',
    nameFields: ['barragem', 'n_secund'],
    municipalityFields: ['municipio', 'nm_mun']
  }
]

function text (value: any): string {
  const raw = value == null ? '' : String(value).trim()
  return raw || ''
}

function escapeLike (value: string): string {
  return escapeSqlString(value).replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function fieldSet (layer: any): Set<string> {
  return new Set((layer.fields || []).map((field: any) => String(field?.name || '').toLowerCase()))
}

function pickExisting (available: Set<string>, candidates: string[]): string[] {
  return candidates.filter((name) => available.has(name))
}

export function assetSearchWhere (layer: any, def: AssetDef, searchText: string): string {
  const query = searchText.trim()
  if (!query) return ''
  const available = fieldSet(layer)
  const fields = pickExisting(available, def.nameFields)
  if (!fields.length) return ''
  const like = `'%${escapeLike(query.toUpperCase())}%'`
  return fields.map((field) => `UPPER(${field}) LIKE ${like}`).join(' OR ')
}

export function ativoWhere (item: AtivoItem): string {
  return `${item.oidField} = ${item.oid}`
}

function toItem (def: AssetDef, layer: any, feature: any): AtivoItem | null {
  const attrs = feature?.attributes || {}
  const oidField = layer.objectIdField || 'objectid'
  const oid = Number(attrs[oidField] ?? attrs.objectid ?? attrs.OBJECTID)
  if (!Number.isFinite(oid)) return null

  const name = def.nameFields.map((field) => text(attrs[field])).find(Boolean) || def.title
  const municipality = def.municipalityFields.map((field) => text(attrs[field])).find(Boolean) || '—'

  return {
    key: `${def.id}-${oid}`,
    type: def.id,
    typeLabel: def.title,
    name,
    municipality,
    layerTitle: def.layerTitle,
    oidField,
    oid,
    geometry: feature.geometry || null,
    layerId: layer.id
  }
}

function compactTitle (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

export function assetDefForLayer (layer: any): AssetDef | null {
  const title = compactTitle(layer?.title || layer?.name || '')
  if (!title) return null
  return ASSET_DEFS.find((def) => {
    const wanted = compactTitle(def.layerTitle)
    return title === wanted || title.includes(wanted) || wanted.includes(title)
  }) || null
}

export function isAssetLayer (layer: any): boolean {
  return Boolean(assetDefForLayer(layer))
}

export function ativoBelongsToMunicipio (item: AtivoItem, municipality?: string | null): boolean {
  if (!municipality) return true
  const mun = normalizeMunName(municipality)
  const value = normalizeMunName(item.municipality || '')
  if (!mun) return true
  if (!value || value === '-') return true
  return value === mun
}

export function ativoFromFeature (layer: any, feature: any): AtivoItem | null {
  const def = assetDefForLayer(layer)
  if (!def) return null
  return toItem(def, layer, feature)
}

export async function hydrateAtivo (webMap: any, item: AtivoItem): Promise<AtivoItem> {
  const layer = findLayer(webMap, {
    layerId: item.layerId,
    layerTitle: item.layerTitle
  })
  if (!layer || typeof layer.queryFeatures !== 'function') return item

  await layer.load?.()
  const def = ASSET_DEFS.find((entry) => entry.id === item.type)
  if (!def) return item

  const query = layer.createQuery()
  query.objectIds = [item.oid]
  query.returnGeometry = true
  query.outFields = ['*']
  const result = await layer.queryFeatures(query)
  const feature = result?.features?.[0]
  if (!feature) return item
  return toItem(def, layer, feature) || item
}

export async function searchAtivos (
  webMap: any,
  options: {
    searchText: string
    assetType: AssetType
    selectedName?: string | null
    territorialScope?: boolean
    territorialWhere: (layer: any) => string
  }
): Promise<AtivoItem[]> {
  const queryText = options.searchText.trim()
  const hasSearch = queryText.length >= 2
  const hasScope = Boolean(options.selectedName || options.territorialScope)
  if (!hasSearch && !hasScope) return []

  const defs = options.assetType
    ? ASSET_DEFS.filter((def) => def.id === options.assetType)
    : ASSET_DEFS

  const groups = await Promise.all(
    defs.map(async (def) => {
      const layer = findLayer(webMap, { layerTitle: def.layerTitle })
      if (!layer || typeof layer.queryFeatures !== 'function') return []

      await layer.load?.()
      const search = hasSearch ? assetSearchWhere(layer, def, queryText) : ''
      const territorial = options.territorialWhere(layer)
      const parts = [territorial, search].filter((part) => part && part !== '1=1')
      if (!parts.length) return []
      const where = parts.length === 1 ? parts[0] : parts.map((part) => `(${part})`).join(' AND ')

      const available = fieldSet(layer)
      const query = layer.createQuery()
      query.where = where
      query.returnGeometry = true
      query.num = options.selectedName ? 200 : options.territorialScope ? 400 : 80
      query.outFields = [
        layer.objectIdField || 'objectid',
        ...pickExisting(available, [...def.nameFields, ...def.municipalityFields])
      ]

      const result = await layer.queryFeatures(query)
      return (result.features || [])
        .map((feature: any) => toItem(def, layer, feature))
        .filter(Boolean) as AtivoItem[]
    })
  )

  return groups
    .flat()
    .filter((item) => ativoBelongsToMunicipio(item, options.selectedName))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export interface RelatorioAtivoRow {
  locality: string
  municipality: string
  assetType: string
}

function isUninformedText (value: string): boolean {
  const n = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!n) return true
  if (/^(nan|null|undefined|ni)$/.test(n)) return true
  if (n.includes('nao informad')) return true
  if (n === 'sem informacao' || n === 'sem informacoes') return true
  if (n === 'sem dado' || n === 'sem dados') return true
  return false
}

function sentenceCaseLabel (value: string): string {
  const text = String(value || '').trim()
  if (!text) return ''
  const letters = [...text].filter((ch) => ch.toLocaleLowerCase('pt-BR') !== ch.toLocaleUpperCase('pt-BR'))
  const mostlyUpper = letters.length >= 2 &&
    letters.filter((ch) => ch === ch.toLocaleUpperCase('pt-BR')).length / letters.length >= 0.75
  if (!mostlyUpper) return text
  const lower = text.toLocaleLowerCase('pt-BR')
  return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1)
}

function domainName (layer: any, fieldName: string, raw: any): any {
  if (raw == null || raw === '') return raw
  try {
    const field = typeof layer?.getField === 'function'
      ? layer.getField(fieldName)
      : (layer?.fields || []).find((item: any) => String(item?.name) === fieldName)
    const coded = field?.domain?.codedValues as Array<{ code: any, name: string }> | undefined
    if (!coded?.length) return raw
    const match = coded.find((item) => String(item.code) === String(raw))
    return match?.name ?? raw
  } catch {
    return raw
  }
}

export function formatAssetTypeLabel (kind: 'pocos' | 'sistemas', raw: any, layer?: any, field?: string): string {
  const resolved = field && layer ? domainName(layer, field, raw) : raw
  const text = resolved == null ? '' : String(resolved).trim()
  const label = !text || isUninformedText(text) ? 'Não informado' : sentenceCaseLabel(text)
  const lower = label.toLocaleLowerCase('pt-BR')
  if (kind === 'pocos') {
    if (label === 'Não informado') return 'Poço — não informado'
    if (lower.includes('poço') || lower.includes('poco')) return sentenceCaseLabel(label)
    return `Poço ${lower}`
  }
  if (label === 'Não informado') return 'Sistema — não informado'
  if (lower.includes('sistema')) return sentenceCaseLabel(label)
  return `Sistema ${lower}`
}

export async function listAtivosRelatorio (
  webMap: any,
  options: {
    selectedName?: string | null
    territorialWhere: (layer: any) => string
    maxPerKind?: number
  }
): Promise<{
  pocos: RelatorioAtivoRow[]
  sistemas: RelatorioAtivoRow[]
  truncated: { pocos: boolean, sistemas: boolean }
}> {
  const maxPerKind = options.maxPerKind || 200
  const kinds: Array<'pocos' | 'sistemas'> = ['pocos', 'sistemas']

  const groups = await Promise.all(kinds.map(async (kind) => {
    const def = ASSET_DEFS.find((entry) => entry.id === kind)
    if (!def) return { kind, rows: [] as RelatorioAtivoRow[], truncated: false }

    const layer = findLayer(webMap, { layerTitle: def.layerTitle })
    if (!layer || typeof layer.queryFeatures !== 'function') {
      return { kind, rows: [] as RelatorioAtivoRow[], truncated: false }
    }

    await layer.load?.()
    const available = fieldSet(layer)
    const localityFields = pickExisting(available, def.localityFields || def.nameFields)
    const typeFields = pickExisting(available, def.typeFields || [])
    const munFields = pickExisting(available, def.municipalityFields)
    const territorial = options.territorialWhere(layer)
    const where = territorial && territorial !== '1=1' ? territorial : '1=1'

    const query = layer.createQuery()
    query.where = where
    query.returnGeometry = false
    query.num = maxPerKind + 1
    query.outFields = [
      layer.objectIdField || 'objectid',
      ...localityFields,
      ...typeFields,
      ...munFields
    ]

    const result = await layer.queryFeatures(query)
    const features = result?.features || []
    const truncated = features.length > maxPerKind
    const rows = features.slice(0, maxPerKind).map((feature: any) => {
      const attrs = feature?.attributes || {}
      const locality = localityFields.map((field) => text(attrs[field])).find(Boolean) || '—'
      const municipality = munFields.map((field) => text(attrs[field])).find(Boolean) || '—'
      const typeField = typeFields[0]
      const assetType = formatAssetTypeLabel(kind, typeField ? attrs[typeField] : '', layer, typeField)
      return { locality, municipality, assetType }
    }).filter((row) => {
      if (!options.selectedName) return true
      const mun = normalizeMunName(options.selectedName)
      const value = normalizeMunName(row.municipality)
      if (!mun) return true
      if (!value || value === '-') return true
      return value === mun
    }).sort((a, b) => {
      const loc = a.locality.localeCompare(b.locality, 'pt-BR')
      if (loc) return loc
      return a.assetType.localeCompare(b.assetType, 'pt-BR')
    })

    return { kind, rows, truncated }
  }))

  const pocos = groups.find((group) => group.kind === 'pocos')
  const sistemas = groups.find((group) => group.kind === 'sistemas')
  return {
    pocos: pocos?.rows || [],
    sistemas: sistemas?.rows || [],
    truncated: {
      pocos: Boolean(pocos?.truncated),
      sistemas: Boolean(sistemas?.truncated)
    }
  }
}

const ASSET_SCALE_SIZE_STOPS = [
  { value: 4000, size: 30 },
  { value: 12000, size: 22 },
  { value: 40000, size: 16 },
  { value: 120000, size: 12 },
  { value: 400000, size: 9 },
  { value: 1500000, size: 6 },
  { value: 5000000, size: 4 }
]

function isPointAssetLayer (layer: any): boolean {
  const geometry = String(layer?.geometryType || '').toLowerCase()
  if (geometry === 'point' || geometry === 'multipoint') return true
  if (geometry === 'polygon' || geometry === 'polyline' || geometry === 'mesh') return false
  const symbolType = String(
    layer?.renderer?.symbol?.type
    || layer?.renderer?.uniqueValueInfos?.[0]?.symbol?.type
    || layer?.renderer?.classBreakInfos?.[0]?.symbol?.type
    || ''
  ).toLowerCase()
  return symbolType.includes('marker') || symbolType.includes('picture')
}

export async function applyAssetZoomSymbology (webMap: any): Promise<void> {
  await Promise.all(ASSET_DEFS.map(async (def) => {
    const layer = findLayer(webMap, { layerTitle: def.layerTitle })
    if (!layer) return
    try {
      await layer.load?.()
      if (!isPointAssetLayer(layer) || !layer.renderer) return
      const renderer = layer.renderer.clone?.() || layer.renderer
      const kept = (renderer.visualVariables || []).filter((variable: any) => {
        if (String(variable?.type || '').toLowerCase() !== 'size') return true
        return String(variable?.valueExpression || '') !== '$view.scale'
      })
      renderer.visualVariables = [
        ...kept,
        {
          type: 'size',
          valueExpression: '$view.scale',
          stops: ASSET_SCALE_SIZE_STOPS
        }
      ]
      layer.renderer = renderer
    } catch (err) {
      console.error(`[infra-page] Falha ao ajustar simbologia de ${def.title}:`, err)
    }
  }))
}

