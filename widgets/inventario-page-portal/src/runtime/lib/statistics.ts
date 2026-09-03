import { combineWhere, escapeSqlString, pickLayerField, semiaridoMunicipiosWhere, sqlIdent } from './filter'

export const SEMIARIDO_MUNICIPIOS_OFICIAL = 287

const loadedLayers = new WeakMap<object, Promise<void>>()

export function ensureLayerLoaded (layer: any): Promise<void> {
  if (!layer) return Promise.resolve()
  const existing = loadedLayers.get(layer)
  if (existing) return existing
  const pending = Promise.resolve(layer.load?.()).then(() => undefined, () => undefined)
  loadedLayers.set(layer, pending)
  return pending
}

function resolveCountField (layer: any): string {
  const objectIdField = layer.objectIdField
  if (objectIdField) return objectIdField

  const fields = layer.fields || []
  const oid = fields.find((field: any) => field.type === 'oid')
  if (oid) return oid.name

  return fields[0]?.name || 'OBJECTID'
}

export async function countFeatures (
  layer: any,
  where = '1=1',
  geometry: any = null
): Promise<number> {
  await ensureLayerLoaded(layer)

  const params: any = { where }
  if (geometry) {
    params.geometry = geometry
    params.spatialRelationship = 'intersects'
  }

  if (typeof layer.queryFeatureCount === 'function') {
    return layer.queryFeatureCount(params)
  }

  const result = await queryStatistics(layer, {
    where,
    geometry,
    statisticType: 'count',
    onStatisticField: resolveCountField(layer),
    outStatisticFieldName: 'total'
  })

  return Number(result?.total ?? 0)
}

const SEMIARIDO_MUN_COUNT_FIELDS = [
  'total_mun',
  'qtd_mun',
  'qt_mun',
  'n_mun',
  'n_municipios',
  'num_municipios',
  'qtd_municipios',
  'mun'
]

/**
 * A camada Região Semiárida_BA pode ser 1 polígono da região.
 * O valor do KPI é a quantidade de municípios (287), não o número de feições.
 */
export async function resolveSemiaridoMunicipioCount (options: {
  semiLayer?: any | null
  munLayer?: any | null
  where?: string
}): Promise<number> {
  const where = options.where || '1=1'
  const semiLayer = options.semiLayer
  const munLayer = options.munLayer

  if (semiLayer && typeof semiLayer.queryFeatures === 'function') {
    try { await semiLayer.load?.() } catch (_) {}
    const field = pickLayerField(semiLayer, ...SEMIARIDO_MUN_COUNT_FIELDS)

    if (field) {
      const stats = await queryStatistics(semiLayer, {
        where: '1=1',
        statisticType: 'sum',
        onStatisticField: field,
        outStatisticFieldName: 'value'
      })
      const summed = Number(stats?.value)
      if (Number.isFinite(summed) && summed > 1) return Math.round(summed)
    }

    const n = await countFeatures(semiLayer, where)
    if (n > 1) return n

    try {
      const result = await semiLayer.queryFeatures({
        where: '1=1',
        returnGeometry: false,
        outFields: field ? [field] : ['mun', 'total_mun'],
        num: 1
      })
      const attrs = result?.features?.[0]?.attributes || {}
      if (field) {
        const raw = Number(attrs[field])
        if (Number.isFinite(raw) && raw > 1) return Math.round(raw)
      }
      for (const [key, value] of Object.entries(attrs)) {
        const nValue = Number(value)
        if (!Number.isFinite(nValue) || nValue < 200 || nValue > 417) continue
        const label = `${key} ${semiLayer.fields?.find((item: any) => item.name === key)?.alias || ''}`
          .toLowerCase()
        if (/mun/.test(label)) return Math.round(nValue)
      }
    } catch (_) {}
  }

  if (munLayer && typeof munLayer.queryFeatures === 'function') {
    const n = await countFeatures(munLayer, semiaridoMunicipiosWhere(munLayer))
    if (n > 1) return n
  }

  return SEMIARIDO_MUNICIPIOS_OFICIAL
}

export async function queryStatistics (layer: any, options: any = {}): Promise<Record<string, any> | null> {
  await ensureLayerLoaded(layer)

  const {
    where = '1=1',
    statisticType = 'count',
    onStatisticField = resolveCountField(layer),
    outStatisticFieldName = 'value',
    geometry = null,
    spatialRelationship = 'intersects'
  } = options

  const query = layer.createQuery()
  query.where = where
  query.returnGeometry = false
  query.outStatistics = [
    {
      statisticType,
      onStatisticField,
      outStatisticFieldName
    }
  ]

  if (geometry) {
    query.geometry = geometry
    query.spatialRelationship = spatialRelationship
  }

  const result = await layer.queryFeatures(query)
  const attrs = result.features?.[0]?.attributes ?? null
  if (!attrs) return null

  const normalized: Record<string, any> = {}
  for (const [key, value] of Object.entries(attrs)) {
    normalized[key] = value
    normalized[key.toLowerCase()] = value
  }
  return normalized
}

export async function queryManyStatistics (
  layer: any,
  options: {
    where?: string
    geometry?: any
    stats: Array<{
      statisticType?: string
      onStatisticField: string
      outStatisticFieldName: string
    }>
  }
): Promise<Record<string, any> | null> {
  const stats = (options.stats || []).filter((item) => item?.onStatisticField && item.outStatisticFieldName)
  if (!stats.length) return null

  await ensureLayerLoaded(layer)
  const query = layer.createQuery()
  query.where = options.where || '1=1'
  query.returnGeometry = false
  query.outStatistics = stats.map((item) => ({
    statisticType: item.statisticType || 'sum',
    onStatisticField: item.onStatisticField,
    outStatisticFieldName: item.outStatisticFieldName
  }))
  if (options.geometry) {
    query.geometry = options.geometry
    query.spatialRelationship = 'intersects'
  }

  const result = await layer.queryFeatures(query)
  const attrs = result.features?.[0]?.attributes ?? null
  if (!attrs) return null

  const normalized: Record<string, any> = {}
  for (const [key, value] of Object.entries(attrs)) {
    normalized[key] = value
    normalized[key.toLowerCase()] = value
  }
  return normalized
}

export async function queryRestCount (layerOrTableUrl: string, where = '1=1'): Promise<number> {
  const endpoint = `${String(layerOrTableUrl).replace(/\/+$/, '')}/query`
  const url = new URL(endpoint)
  url.searchParams.set('where', where)
  url.searchParams.set('returnCountOnly', 'true')
  url.searchParams.set('f', 'json')

  const response = await fetch(url.toString(), { credentials: 'include' })
  if (!response.ok) {
    throw new Error(`Falha na contagem REST (${response.status})`)
  }

  const data = await response.json()
  if (data?.error) {
    throw new Error(data.error.message || 'Erro na contagem REST')
  }

  return Number(data.count ?? 0)
}

export async function queryFieldValues (
  layer: any,
  options: {
    field?: string
    fallbacks?: string[]
    where?: string
    orderByFields?: string[]
    num?: number
  }
): Promise<string[]> {
  await layer.load()

  const {
    where = '1=1',
    num = 500
  } = options

  const field = resolveExistingField(
    layer,
    options.field,
    options.fallbacks || ['nm_ti', 'nom_ti', 'territorio', 'nome']
  )
  if (!field) {
    throw new Error('Campo não encontrado nesta camada.')
  }

  const available = new Set(fieldNames(layer).map((name) => name.toLowerCase()))
  const orderByFields = (options.orderByFields || []).filter((spec) => {
    const name = String(spec)
      .replace(/\s+(ASC|DESC)$/i, '')
      .trim()
      .replace(/^"|"$/g, '')
    return !name || available.has(name.toLowerCase())
  })

  const run = async (withOrder: boolean) => {
    const query = layer.createQuery()
    query.where = where
    query.outFields = [field]
    if (withOrder && orderByFields.length) {
      for (const orderField of orderByFields) {
        const name = String(orderField)
          .replace(/\s+(ASC|DESC)$/i, '')
          .trim()
          .replace(/^"|"$/g, '')
        if (name && !query.outFields.includes(name)) {
          query.outFields.push(name)
        }
      }
      query.orderByFields = orderByFields
    }
    query.returnGeometry = false
    query.num = num
    return layer.queryFeatures(query)
  }

  let result: any
  try {
    result = await run(true)
  } catch (error) {
    console.warn('[sihs-dash] lista com ordenação falhou, tentando sem orderBy:', error)
    result = await run(false)
  }

  const values: string[] = []
  const seen = new Set<string>()

  for (const feature of result.features || []) {
    const raw = feature.attributes?.[field]
    const text = raw == null || String(raw).trim() === '' ? null : String(raw).trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    values.push(text)
  }

  if (!orderByFields.length) {
    values.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }

  return values
}

export async function searchFieldValues (
  layer: any,
  options: {
    field: string
    term: string
    where?: string
    num?: number
  }
): Promise<string[]> {
  await layer.load()

  const { field, term, where = '1=1', num = 12 } = options
  const cleaned = String(term || '').trim()
  if (cleaned.length < 2) return []

  const like = escapeSqlString(cleaned)
  const searchWhere = combineWhere(
    where,
    `UPPER(${sqlIdent(field)}) LIKE UPPER('%${like}%')`
  )

  return queryFieldValues(layer, {
    field,
    where: searchWhere,
    orderByFields: [`${sqlIdent(field)} ASC`],
    num
  })
}

function fieldNames (layer: any): string[] {
  return (layer.fields || []).map((field: any) => String(field?.name || ''))
}

function resolveExistingField (layer: any, preferred?: string, fallbacks: string[] = []): string | null {
  const available = new Map(
    fieldNames(layer).map((name) => [name.toLowerCase(), name])
  )
  for (const candidate of [preferred, ...fallbacks]) {
    if (!candidate) continue
    const match = available.get(candidate.toLowerCase())
    if (match) return match
  }
  return null
}

function slicesFromStats (features: any[], field: string): Array<{ label: string, total: number }> {
  return (features || [])
    .map((feature: any) => {
      const attrs = feature.attributes || {}
      const labelRaw = attrs[field]
      const total = Number(attrs.total ?? attrs.TOTAL ?? attrs.Total ?? 0)
      return {
        label:
          labelRaw == null || String(labelRaw).trim() === ''
            ? 'Não informado'
            : String(labelRaw).trim(),
        total: Number.isFinite(total) ? total : 0
      }
    })
    .filter((item: { total: number }) => item.total > 0)
}

async function queryTypeBreakdownClient (
  layer: any,
  field: string,
  where: string
): Promise<Array<{ label: string, total: number }>> {
  const counts = new Map<string, number>()
  let start = 0

  while (true) {
    const query = layer.createQuery()
    query.where = where
    query.returnGeometry = false
    query.outFields = [field]
    query.num = 2000
    query.start = start
    const result = await layer.queryFeatures(query)
    const features = result.features || []
    for (const feature of features) {
      const raw = feature.attributes?.[field]
      const label = raw == null || String(raw).trim() === '' ? 'Não informado' : String(raw).trim()
      counts.set(label, (counts.get(label) || 0) + 1)
    }
    if (!features.length || !result.exceededTransferLimit) break
    start += features.length
    if (start > 20000) break
  }

  return Array.from(counts.entries())
    .map(([label, total]) => ({ label, total }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)
}

export async function queryTypeBreakdown (
  layer: any,
  options: { field?: string, fallbacks?: string[], where?: string }
): Promise<Array<{ label: string, total: number }>> {
  await layer.load()

  const where = options.where || '1=1'
  const field = resolveExistingField(
    layer,
    options.field,
    options.fallbacks || ['uso_princ', 'clas__bar', 'clas_rese', 'clas_poco', 'condicao', 'tipo_sistema']
  )
  if (!field) {
    throw new Error('Campo de tipo não encontrado nesta camada.')
  }

  const countField = resolveCountField(layer)
  const previous = layer.definitionExpression
  layer.definitionExpression = null

  try {
    const runStats = async (orderBy: boolean) => {
      const query = layer.createQuery()
      query.where = where
      query.returnGeometry = false
      query.groupByFieldsForStatistics = [field]
      if (orderBy) query.orderByFields = ['total DESC']
      query.outStatistics = [
        {
          statisticType: 'count',
          onStatisticField: countField,
          outStatisticFieldName: 'total'
        }
      ]
      const result = await layer.queryFeatures(query)
      return slicesFromStats(result.features, field)
    }

    try {
      return await runStats(true)
    } catch {
      try {
        return await runStats(false)
      } catch {
        return queryTypeBreakdownClient(layer, field, where)
      }
    }
  } finally {
    layer.definitionExpression = previous
  }
}

export async function queryDensity (
  layer: any,
  options: {
    numeratorField: string
    denominatorField: string
    where?: string
    geometry?: any
    spatialRelationship?: string
  }
): Promise<number | null> {
  await layer.load()

  const {
    numeratorField,
    denominatorField,
    where = '1=1',
    geometry = null,
    spatialRelationship = 'intersects'
  } = options

  const query = layer.createQuery()
  query.where = where
  query.returnGeometry = false
  query.outStatistics = [
    {
      statisticType: 'sum',
      onStatisticField: numeratorField,
      outStatisticFieldName: 'numerator'
    },
    {
      statisticType: 'sum',
      onStatisticField: denominatorField,
      outStatisticFieldName: 'denominator'
    }
  ]

  if (geometry) {
    query.geometry = geometry
    query.spatialRelationship = spatialRelationship
  }

  const result = await layer.queryFeatures(query)
  const attrs = result.features?.[0]?.attributes
  if (!attrs) return null

  const numerator = Number(attrs.numerator ?? attrs.NUMERATOR ?? attrs.Numerator)
  const denominator = Number(attrs.denominator ?? attrs.DENOMINATOR ?? attrs.Denominator)

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null
  }

  return numerator / denominator
}
