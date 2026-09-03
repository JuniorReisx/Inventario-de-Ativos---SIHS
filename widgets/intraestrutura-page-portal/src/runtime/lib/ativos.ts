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
    municipalityFields: ['nm_mun', 'municipio_oficial', 'municipio']
  },
  {
    id: 'pocos',
    title: 'Poços',
    layerTitle: 'Poços',
    nameFields: ['localidade', 'localizacao', 'codigo', 'aquifero'],
    municipalityFields: ['nm_mun', 'municipio']
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
