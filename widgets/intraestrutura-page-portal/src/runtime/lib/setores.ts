import { findLayer } from './layers'
import { escapeSqlString } from './municipios'

export const SETOR_LAYER_TITLE = 'Setores Censitários'
export const SETOR_PAGE_SIZE = 7
export const SETOR_TIPOS = [
  'Agrovila do PA',
  'Agrupamento indígena',
  'Agrupamento quilombola'
] as const

function normalizeTipo (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const SETOR_TIPOS_NORM = new Set(SETOR_TIPOS.map((name) => normalizeTipo(name)))

export function isAllowedSetorTipo (tipo: string): boolean {
  return SETOR_TIPOS_NORM.has(normalizeTipo(tipo))
}

function setorAllowedTiposWhere (): string {
  return `(${SETOR_TIPOS.map((name) => `UPPER(nm_tipo) = UPPER('${escapeSqlString(name)}')`).join(' OR ')})`
}

export interface SetorItem {
  key: string
  name: string
  municipality: string
  type: string
  place: string
  oidField: string
  oid: number
  geometry?: any
}

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

export function setorSearchWhere (layer: any, searchText: string): string {
  const query = searchText.trim()
  if (!query) return ''
  const available = fieldSet(layer)
  if (!available.has('nm_aglom')) return ''
  const like = `'%${escapeLike(query.toUpperCase())}%'`
  return `UPPER(nm_aglom) LIKE ${like}`
}

export function setorTipoWhere (tipo: string): string {
  const value = tipo.trim()
  if (!value) return setorAllowedTiposWhere()
  if (!isAllowedSetorTipo(value)) return setorAllowedTiposWhere()
  return `UPPER(nm_tipo) = UPPER('${escapeSqlString(value)}')`
}

export function setorFilterWhere (layer: any, searchText: string, tipo = ''): string {
  const parts = [setorSearchWhere(layer, searchText), setorTipoWhere(tipo)].filter(Boolean)
  if (!parts.length) return ''
  return parts.length === 1 ? parts[0] : parts.map((part) => `(${part})`).join(' AND ')
}

function pickAttr (attrs: any, candidates: string[]): string {
  if (!attrs) return ''
  const keys = Object.keys(attrs)
  const byLower = new Map(keys.map((key) => [key.toLowerCase(), key]))
  for (const candidate of candidates) {
    const actual = byLower.get(candidate.toLowerCase())
    if (actual == null) continue
    const value = text(attrs[actual])
    if (value) return value
  }
  return ''
}

export function setorWhere (item: SetorItem, tipo = ''): string {
  const mun = item.municipality && item.municipality !== '—'
    ? `UPPER(nm_mun) = UPPER('${escapeSqlString(item.municipality)}')`
    : ''
  const aglom = item.name === 'Não informado'
    ? `(nm_aglom IS NULL OR TRIM(nm_aglom) = '')`
    : `UPPER(nm_aglom) = UPPER('${escapeSqlString(item.name)}')`
  const type = setorTipoWhere(tipo || (item.type && item.type !== 'Aglomerado' ? item.type : ''))
  return [aglom, mun, type].filter(Boolean).map((part) => `(${part})`).join(' AND ')
}

function toAgrupamento (attrs: any): SetorItem | null {
  const name = pickAttr(attrs, ['nm_aglom', 'nome_aglomerado', 'aglomerado']) || 'Não informado'
  const municipality = pickAttr(attrs, ['nm_mun', 'municipio', 'nome_do_municipio']) || '—'
  const type = pickAttr(attrs, ['nm_tipo', 'tipo_sc', 'tipo_setor', 'tipo']) || '—'
  return {
    key: `aglom-${municipality}-${name}-${type}`.toLowerCase(),
    name,
    municipality,
    type,
    place: municipality,
    oidField: 'objectid',
    oid: 0
  }
}

export async function searchSetores (
  webMap: any,
  options: {
    searchText: string
    tipo?: string
    selectedName?: string | null
    territorialScope?: boolean
    territorialWhere: (layer: any) => string
  }
): Promise<SetorItem[]> {
  const queryText = options.searchText.trim()
  const hasSearch = queryText.length >= 2
  if (!hasSearch && !options.selectedName && !options.territorialScope) return []

  const layer = findLayer(webMap, { layerTitle: SETOR_LAYER_TITLE })
  if (!layer || typeof layer.queryFeatures !== 'function') return []

  await layer.load?.()
  const available = fieldSet(layer)
  const outFields = ['nm_aglom', 'nm_mun', 'nm_tipo', 'tipo_sc', 'tipo_setor', 'tipo']
    .filter((name) => available.has(name))
  const search = setorFilterWhere(layer, queryText, options.tipo || '')
  const territorial = options.territorialWhere(layer)
  const parts = [territorial, search].filter((part) => part && part !== '1=1')
  if (!parts.length) return []
  const where = parts.length === 1 ? parts[0] : parts.map((part) => `(${part})`).join(' AND ')

  const query = layer.createQuery()
  query.where = where
  query.returnGeometry = false
  query.returnDistinctValues = true
  query.num = 500
  query.outFields = outFields.length ? outFields : ['*']
  query.orderByFields = available.has('nm_aglom') ? ['nm_aglom ASC'] : undefined

  const collect = (features: any[]): SetorItem[] => {
    const seen = new Set<string>()
    const items: SetorItem[] = []
    for (const feature of features) {
      const item = toAgrupamento(feature.attributes || {})
      if (!item || !isAllowedSetorTipo(item.type) || seen.has(item.key)) continue
      seen.add(item.key)
      items.push(item)
    }
    return items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  try {
    const result = await layer.queryFeatures(query)
    return collect(result.features || [])
  } catch {
    query.returnDistinctValues = false
    query.returnGeometry = false
    query.outFields = outFields.length ? outFields : ['*']
    const result = await layer.queryFeatures(query)
    return collect(result.features || [])
  }
}
