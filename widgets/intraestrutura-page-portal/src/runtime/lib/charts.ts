import { findLayer, findMunicipioLayer } from './layers'
import { escapeSqlString } from './municipios'
import { ASSET_DEFS, assetSearchWhere, type AssetType } from './ativos'
import { SETOR_LAYER_TITLE, setorFilterWhere } from './setores'
import { withoutDefinitionExpression } from './map'

export interface ChartSlice {
  label: string
  total: number
  detail?: string
  color?: string
  parts?: ChartSlice[]
}

export function groupSmallChartSlices (
  items: ChartSlice[],
  options?: { minPercent?: number, maxSlices?: number }
): ChartSlice[] {
  const minPercent = options?.minPercent ?? 4
  const maxSlices = options?.maxSlices ?? 7
  const visible = (items || []).filter((item) => item.total > 0)
  const total = visible.reduce((sum, item) => sum + item.total, 0)
  if (!total) return []

  const sorted = [...visible].sort((a, b) => b.total - a.total)
  const keep: ChartSlice[] = []
  const small: ChartSlice[] = []

  const isOutrosLabel = (label: string) => /^outros$/i.test(String(label || '').trim())

  for (const item of sorted) {
    if (isOutrosLabel(item.label)) {
      small.push(item)
      continue
    }
    const percent = (item.total / total) * 100
    if (percent < minPercent) small.push(item)
    else keep.push({ ...item })
  }

  if (!keep.length && sorted.length) {
    const named = sorted.filter((item) => !isOutrosLabel(item.label))
    const head = named.slice(0, Math.min(5, named.length || sorted.length))
    keep.push(...head.map((item) => ({ ...item })))
    const keptLabels = new Set(keep.map((item) => item.label))
    small.length = 0
    small.push(...sorted.filter((item) => !keptLabels.has(item.label)))
  }

  const cap = Math.max(1, maxSlices - (small.length ? 1 : 0))
  if (keep.length > cap) {
    small.push(...keep.splice(cap))
  }

  if (small.length === 1 && !isOutrosLabel(small[0].label)) {
    keep.push({ ...small[0] })
    return keep
  }

  if (!small.length) return keep

  const parts = small.flatMap((item) =>
    item.parts?.length
      ? item.parts
      : [{ label: item.label, total: item.total, detail: item.detail }]
  )
  const groupedTotal = parts.reduce((sum, item) => sum + item.total, 0)
  const names = parts.map((item) => item.label)
  keep.push({
    label: 'Outros',
    total: groupedTotal,
    color: '#8aa0ab',
    detail: names.length <= 3
      ? names.join(', ')
      : `${names.slice(0, 2).join(', ')} e mais ${names.length - 2}`,
    parts
  })
  return keep
}

export interface ChartView {
  id: string
  subtitle: string
  field: string
  layout: 'pie' | 'cards' | 'bars'
  items: ChartSlice[]
  status: 'loading' | 'ok' | 'empty' | 'error'
  message?: string
}

export interface InfraChart {
  id: string
  title: string
  layerTitle: string
  note?: string
  views: ChartView[]
}

const EMPREENDEDOR_FIELDS = ['empreendedor', 'nome_empreendedor', 'nm_empr', 'empreend']
const PORTE_VOLUME_FIELDS = ['capacidade_t', 'capacidade_total', 'cap_total', 'volume', 'vol_total']

export const RESERVATORIO_PORTE_CLASSES = [
  { label: 'Muito pequeno', detail: '≤ 3 hm³', max: 3, color: '#9fd4e0' },
  { label: 'Pequeno', detail: '> 3 e ≤ 10 hm³', max: 10, color: '#1aa8c8' },
  { label: 'Médio', detail: '> 10 e ≤ 75 hm³', max: 75, color: '#0a5c66' },
  { label: 'Grande', detail: '> 75 e ≤ 200 hm³', max: 200, color: '#7d5a3c' },
  { label: 'Muito grande', detail: '> 200 hm³', max: Infinity, color: '#001824' }
] as const

export const RESERVATORIO_EMPREENDEDOR_GROUPS = [
  { label: 'Mineração Caraíba S/A', keys: ['caraiba'] },
  { label: 'Car / Associação Idealista de Bombaça', keys: ['bombaca', 'idealista', 'associacao idealista'] },
  { label: 'Embasa', keys: ['embasa', 'empresa baiana de aguas', 'aguas e saneamento'] },
  { label: 'Dnocs', keys: ['dnocs'] },
  { label: 'Cerb', keys: ['cerb'] },
  { label: 'Shuichi Hayashi', keys: ['hayashi', 'shuichi'] },
  { label: 'CIA DE FERRO LIGAS DA BAHIA FERBASA', keys: ['ferbasa', 'ferro ligas'] },
  { label: 'Fazenda Progresso LTDA', keys: ['fazenda progresso', 'progresso ltda'] },
  { label: 'Codevasf', keys: ['codevasf'] }
] as const

export const CHART_DEFS = [
  {
    id: 'reservatorios',
    title: 'Reservatórios',
    layerTitle: 'Reservatórios',
    views: [
      { id: 'uso', subtitle: 'Uso principal', field: 'uso_princ', layout: 'pie' as const },
      { id: 'empreendedores', subtitle: 'Empreendedores', field: 'empreendedor', layout: 'pie' as const, bucket: 'empreendedor' as const },
      { id: 'porte', subtitle: 'Porte', field: 'capacidade_t', layout: 'pie' as const, bucket: 'porte' as const }
    ]
  },
  {
    id: 'pocos',
    title: 'Poços',
    layerTitle: 'Poços',
    views: [
      { id: 'condicao', subtitle: 'Condição dos poços', field: 'condicao', layout: 'pie' as const },
      { id: 'qualitativo', subtitle: 'Estado qualitativo', field: 'estado_qualitativo', layout: 'pie' as const }
    ]
  },
  {
    id: 'sistemas',
    title: 'Sistemas de Abastecimento',
    layerTitle: 'Sistemas de Abastecimento',
    note: 'Somente os sistemas geolocalizados que aparecem no mapa',
    views: [
      { id: 'tipo', subtitle: 'Tipo de sistema', field: 'tipo_sistema', layout: 'pie' as const },
      { id: 'captacao', subtitle: 'Captação', field: 'captacao', layout: 'pie' as const }
    ]
  }
]

const NAME_FIELDS = [
  'nm_mun',
  'municipio_oficial',
  'nome_do_municipio',
  'nm_mun_1',
  'nm_munm',
  'nm_municipio',
  'nome_municipio',
  'nom_municipio',
  'nm_munic',
  'municipio'
]
const TI_FIELDS = ['territorio_de_indentidade', 'territorio_de_identidade', 'territorio', 'nom_ti', 'nm_ti']
const SEMI_FIELDS = ['região_do_semiarida', 'regiao_do_semiarida', 'semiarido']

type LayerScopeOptions = {
  selectedName: string | null
  filterTerritorio: string
  filterSemiarido?: string
  filteredNames: string[]
  scoped: boolean
}

function quoteIdent (name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
  return `"${String(name).replace(/"/g, '""')}"`
}

function semiFlagWhere (field: string, value: string): string {
  const ident = quoteIdent(field)
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
  if (normalized === 'SIM') {
    return `(${ident} = 'SIM' OR ${ident} = 'Sim' OR ${ident} = 'sim')`
  }
  if (normalized === 'NAO') {
    return `(${ident} = 'NÃO' OR ${ident} = 'NAO' OR ${ident} = 'Não' OR ${ident} = 'Nao' OR ${ident} = 'não' OR ${ident} = 'nao')`
  }
  return `${ident} = '${escapeSqlString(value)}'`
}
const SCOPE_LAYER_TITLES = [
  ...CHART_DEFS.map((def) => def.layerTitle),
  SETOR_LAYER_TITLE
]
const ASSET_VISIBILITY_TITLES = [
  'Reservatórios',
  'Poços',
  'Sistemas de Abastecimento'
]

function fieldSet (layer: any): Set<string> {
  return new Set((layer.fields || []).map((field: any) => String(field?.name || '').toLowerCase()))
}

function pickField (available: Set<string>, candidates: string[]): string | null {
  return candidates.find((name) => available.has(name.toLowerCase())) || null
}

function pickActualField (layer: any, candidates: string[]): string | null {
  const fields = layer?.fields || []
  const byLower = new Map(
    fields.map((field: any) => [String(field?.name || '').toLowerCase(), String(field?.name || '')])
  )
  for (const candidate of candidates) {
    const found = byLower.get(candidate.toLowerCase())
    if (found) return found
  }
  return null
}

function municipalityEqualsWhere (field: string, name: string): string {
  const ident = quoteIdent(field)
  const value = escapeSqlString(name)
  return `(${ident} = '${value}' OR UPPER(${ident}) = UPPER('${value}'))`
}

function municipalityMatchWhere (layer: any, name: string): string | null {
  const available = fieldSet(layer)
  const fields: string[] = []
  const seen = new Set<string>()
  for (const candidate of NAME_FIELDS) {
    const actual = pickActualField(layer, [candidate]) || (available.has(candidate.toLowerCase()) ? candidate : null)
    if (!actual) continue
    const key = actual.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    fields.push(actual)
  }
  if (!fields.length) return null
  const clauses = fields.map((field) => municipalityEqualsWhere(field, name))
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`
}

function normalizeEmp (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

function classifyEmpreendedor (label: string): string {
  const normalized = normalizeEmp(label)
  if (!normalized || normalized === 'nao informado') return 'Outros'
  if (normalized === 'car' || normalized.startsWith('car ') || normalized.startsWith('car/')) {
    return 'Car / Associação Idealista de Bombaça'
  }
  for (const group of RESERVATORIO_EMPREENDEDOR_GROUPS) {
    if (group.keys.some((key) => normalized.includes(key))) return group.label
  }
  return 'Outros'
}

function bucketEmpreendedorSlices (items: ChartSlice[]): ChartSlice[] {
  const totals = new Map<string, number>()
  for (const group of RESERVATORIO_EMPREENDEDOR_GROUPS) totals.set(group.label, 0)
  totals.set('Outros', 0)
  for (const item of items) {
    const label = classifyEmpreendedor(item.label)
    totals.set(label, (totals.get(label) || 0) + item.total)
  }
  return RESERVATORIO_EMPREENDEDOR_GROUPS.map((group) => ({
    label: group.label,
    total: totals.get(group.label) || 0
  }))
}

export function parseVolumeHm3 (value: any): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value).trim().replace(/\s/g, '').replace(',', '.')
  if (!text) return null
  const num = Number(text)
  return Number.isFinite(num) ? num : null
}

export function classifyPorte (volume: number): string {
  for (const item of RESERVATORIO_PORTE_CLASSES) {
    if (volume <= item.max) return item.label
  }
  return 'Muito grande'
}

export function formatReservatorioPorte (value: any): string {
  const volume = parseVolumeHm3(value)
  if (volume == null) return '—'
  const item = RESERVATORIO_PORTE_CLASSES.find((entry) => volume <= entry.max)
    || RESERVATORIO_PORTE_CLASSES[RESERVATORIO_PORTE_CLASSES.length - 1]
  return `${item.label} (${item.detail})`
}

function porteSlicesFromCounts (counts: Map<string, number>): ChartSlice[] {
  const slices = [...RESERVATORIO_PORTE_CLASSES].reverse().map((item) => ({
    label: item.label,
    detail: item.detail,
    color: item.color,
    total: counts.get(item.label) || 0
  }))
  const unknown = counts.get('Não informado') || 0
  if (unknown > 0) {
    slices.push({
      label: 'Não informado',
      detail: 'Sem volume cadastrado',
      color: '#8aa0ab',
      total: unknown
    })
  }
  return slices.filter((item) => item.total > 0)
}

async function queryVolumeValues (
  layer: any,
  field: string,
  where: string
): Promise<Array<number | null>> {
  const values: Array<number | null> = []
  let start = 0

  return withoutDefinitionExpression(layer, async () => {
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
        values.push(parseVolumeHm3(feature.attributes?.[field]))
      }
      if (!features.length || !result.exceededTransferLimit) break
      start += features.length
      if (start > 20000) break
    }
    return values
  })
}

async function queryPorteForScope (
  layer: any,
  field: string,
  options: LayerScopeOptions
): Promise<ChartSlice[]> {
  const counts = new Map<string, number>()
  for (const item of RESERVATORIO_PORTE_CLASSES) counts.set(item.label, 0)
  counts.set('Não informado', 0)

  const addValues = (values: Array<number | null>) => {
    for (const volume of values) {
      const label = volume == null ? 'Não informado' : classifyPorte(volume)
      counts.set(label, (counts.get(label) || 0) + 1)
    }
  }

  await layer.load()
  const available = fieldSet(layer)
  const nameField = pickField(available, NAME_FIELDS)
  const tiField = pickField(available, TI_FIELDS)
  const semiField = pickField(available, SEMI_FIELDS)

  if (options.selectedName && nameField) {
    addValues(await queryVolumeValues(
      layer,
      field,
      municipalityMatchWhere(layer, options.selectedName) || `UPPER(${nameField}) = UPPER('${escapeSqlString(options.selectedName)}')`
    ))
    return porteSlicesFromCounts(counts)
  }

  if (!options.scoped) {
    addValues(await queryVolumeValues(layer, field, '1=1'))
    return porteSlicesFromCounts(counts)
  }

  if (options.filterTerritorio && tiField) {
    addValues(await queryVolumeValues(
      layer,
      field,
      municipalityEqualsWhere(tiField, options.filterTerritorio)
    ))
    return porteSlicesFromCounts(counts)
  }

  if (options.filterSemiarido && semiField && !options.filterTerritorio) {
    addValues(await queryVolumeValues(layer, field, semiFlagWhere(semiField, options.filterSemiarido)))
    return porteSlicesFromCounts(counts)
  }

  if (!nameField || !options.filteredNames.length) return []

  addValues(await queryVolumeValues(
    layer,
    field,
    namesWhere(nameField, options.filteredNames, true)
  ))
  return porteSlicesFromCounts(counts)
}

function resolveChartField (layer: any, field: string, extra: string[] = []): string | null {
  const available = fieldSet(layer)
  const picked = pickField(available, [field, ...extra])
  if (picked) return picked
  const wanted = normalizeEmp(field)
  for (const item of layer.fields || []) {
    const alias = normalizeEmp(item?.alias || '')
    const name = normalizeEmp(item?.name || '')
    if (alias === wanted || name === wanted || alias.includes(wanted)) {
      return item.name
    }
  }
  return null
}

function resolveCountField (layer: any): string {
  if (layer.objectIdField) return layer.objectIdField
  const oid = (layer.fields || []).find((field: any) => field.type === 'oid')
  return oid?.name || 'objectid'
}

function chunk <T>(items: T[], size: number): T[][] {
  const groups: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size))
  }
  return groups
}

function slicesFromFeatures (features: any[], field: string): ChartSlice[] {
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
    .filter((item: ChartSlice) => item.total > 0)
}

async function queryBreakdownClient (
  layer: any,
  field: string,
  where: string
): Promise<ChartSlice[]> {
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

async function queryBreakdown (
  layer: any,
  field: string,
  where: string
): Promise<ChartSlice[]> {
  const available = fieldSet(layer)
  if (!available.has(field.toLowerCase())) return []

  return withoutDefinitionExpression(layer, async () => {
    const runStats = async (orderBy: boolean) => {
      const query = layer.createQuery()
      query.where = where
      query.returnGeometry = false
      query.groupByFieldsForStatistics = [field]
      if (orderBy) query.orderByFields = ['total DESC']
      query.outStatistics = [
        {
          statisticType: 'count',
          onStatisticField: resolveCountField(layer),
          outStatisticFieldName: 'total'
        }
      ]
      const result = await layer.queryFeatures(query)
      return slicesFromFeatures(result.features, field)
    }

    try {
      return await runStats(true)
    } catch {
      try {
        return await runStats(false)
      } catch {
        return queryBreakdownClient(layer, field, where)
      }
    }
  })
}

function namesWhere (nameField: string, names: string[], compact = false): string {
  const values = names.filter(Boolean)
  if (!values.length) return '1=0'
  if (compact && values.length <= 400) {
    const list = values.map((name) => `'${escapeSqlString(name)}'`).join(',')
    return `${nameField} IN (${list})`
  }
  const groups = chunk(values, 40)
  const parts = groups.map((group) => {
    if (compact) {
      const list = group.map((name) => `'${escapeSqlString(name)}'`).join(',')
      return `${nameField} IN (${list})`
    }
    const list = group.map((name) => `UPPER('${escapeSqlString(name)}')`).join(',')
    return `UPPER(${nameField}) IN (${list})`
  })
  return parts.length === 1 ? parts[0] : parts.map((part) => `(${part})`).join(' OR ')
}

async function queryBreakdownForScope (
  layer: any,
  field: string,
  options: LayerScopeOptions
): Promise<ChartSlice[]> {
  await layer.load()
  const available = fieldSet(layer)
  const nameField = pickField(available, NAME_FIELDS)
  const tiField = pickField(available, TI_FIELDS)
  const semiField = pickField(available, SEMI_FIELDS)

  if (options.selectedName) {
    const where = municipalityMatchWhere(layer, options.selectedName)
    if (where) return queryBreakdown(layer, field, where)
  }

  if (!options.scoped) {
    return queryBreakdown(layer, field, '1=1')
  }

  if (options.filterTerritorio && tiField) {
    return queryBreakdown(
      layer,
      field,
      municipalityEqualsWhere(tiField, options.filterTerritorio)
    )
  }

  if (options.filterSemiarido && semiField && !options.filterTerritorio) {
    return queryBreakdown(layer, field, semiFlagWhere(semiField, options.filterSemiarido))
  }

  if (!nameField || !options.filteredNames.length) return []

  return queryBreakdown(layer, field, namesWhere(nameField, options.filteredNames, true))
}

const ORIGINAL_WHERE = '__infraOriginalWhere'

function rememberOriginalWhere (layer: any): string {
  if (layer[ORIGINAL_WHERE] == null) {
    layer[ORIGINAL_WHERE] = layer.definitionExpression || '1=1'
  }
  return layer[ORIGINAL_WHERE]
}

function combineWhere (left: string, right: string): string {
  if (!right || right === '1=1') return left || '1=1'
  if (!left || left === '1=1') return right
  return `(${left}) AND (${right})`
}

export function layerScopeWhere (
  layer: any,
  options: LayerScopeOptions
): string {
  const original = rememberOriginalWhere(layer)
  const available = fieldSet(layer)
  const nameField = pickActualField(layer, NAME_FIELDS) || pickField(available, NAME_FIELDS)
  const tiField = pickActualField(layer, TI_FIELDS) || pickField(available, TI_FIELDS)
  const semiField = pickActualField(layer, SEMI_FIELDS) || pickField(available, SEMI_FIELDS)

  if (options.selectedName) {
    return municipalityMatchWhere(layer, options.selectedName) || original
  }

  if (!options.scoped) return original

  if (options.filterTerritorio) {
    const tiWhere = tiField ? municipalityEqualsWhere(tiField, options.filterTerritorio) : ''
    const names = nameField && options.filteredNames.length
      ? namesWhere(nameField, options.filteredNames, true)
      : ''
    if (tiWhere && names) return `(${tiWhere} OR ${names})`
    if (tiWhere) return tiWhere
    if (names) return names
  }

  if (options.filterSemiarido && semiField && !options.filterTerritorio) {
    return semiFlagWhere(semiField, options.filterSemiarido)
  }

  if (nameField && options.filteredNames.length) {
    return namesWhere(nameField, options.filteredNames, true)
  }

  return original
}

function applyAssetVisibility (webMap: any, assetType: AssetType, scoped = false): void {
  const visibleTitle = assetType
    ? ASSET_DEFS.find((def) => def.id === assetType)?.layerTitle
    : null

  for (const layerTitle of ASSET_VISIBILITY_TITLES) {
    const layer = findLayer(webMap, { layerTitle })
    if (!layer) continue
    if (layer.__infraOriginalVisible == null) {
      layer.__infraOriginalVisible = layer.visible !== false
    }
    const on = visibleTitle
      ? layerTitle === visibleTitle
      : scoped || layer.__infraOriginalVisible
    layer.visible = on
    if (!on) continue
    let parent = layer.parent
    while (parent && parent !== webMap && parent !== webMap?.layers && typeof parent === 'object' && 'visible' in parent) {
      parent.visible = true
      parent = parent.parent
    }
  }
}

export async function applyInfraLayerScope (
  webMap: any,
  options: {
    selectedName: string | null
    filterTerritorio: string
    filterSemiarido: string
    filteredNames: string[]
    assetType?: AssetType
    searchText?: string
    setorSearch?: string
    setorTipo?: string
  }
): Promise<void> {
  const scoped = Boolean(
    options.selectedName || options.filterTerritorio || options.filterSemiarido
  )
  const assetType = options.assetType || ''
  const searchText = options.searchText || ''
  const setorSearch = options.setorSearch || ''
  const setorTipo = options.setorTipo || ''

  applyAssetVisibility(webMap, assetType, scoped)

  const layers = [
    ...SCOPE_LAYER_TITLES.map((layerTitle) => findLayer(webMap, { layerTitle })),
    findMunicipioLayer(webMap)
  ].filter((layer, index, list) => layer && list.indexOf(layer) === index)

  await Promise.all(
    layers.map(async (layer) => {
      await layer.load?.()
      const territorial = layerScopeWhere(layer, {
        selectedName: options.selectedName,
        filterTerritorio: options.filterTerritorio,
        filterSemiarido: options.filterSemiarido,
        filteredNames: options.filteredNames,
        scoped
      })
      const assetDef = ASSET_DEFS.find((def) => def.layerTitle === layer.title || def.layerTitle === layer.layerTitle)
      const search = assetDef
        ? assetSearchWhere(layer, assetDef, searchText)
        : layer.title === SETOR_LAYER_TITLE || layer.layerTitle === SETOR_LAYER_TITLE
          ? setorFilterWhere(layer, setorSearch, setorTipo)
          : ''
      layer.definitionExpression = combineWhere(territorial, search)
    })
  )
}

export async function applyInfraGeometryFilter (
  view: any,
  webMap: any,
  geometry: any | null
): Promise<void> {
  if (!view || !webMap) return

  const layers = SCOPE_LAYER_TITLES
    .map((layerTitle) => findLayer(webMap, { layerTitle }))
    .filter((layer, index, list) => layer && list.indexOf(layer) === index)

  await Promise.all(layers.map(async (layer) => {
    try {
      const layerView = await view.whenLayerView(layer)
      if (!geometry) {
        layerView.filter = null
        return
      }
      try {
        layerView.filter = { geometry, spatialRelationship: 'intersects' }
      } catch {
        layerView.filter = { geometry }
      }
    } catch {
      // camada sem filtro espacial
    }
  }))
}

export function emptyCharts (status: ChartView['status'] = 'loading'): InfraChart[] {
  return CHART_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    layerTitle: def.layerTitle,
    note: 'note' in def ? def.note : undefined,
    views: def.views.map((view) => ({
      id: view.id,
      subtitle: view.subtitle,
      field: view.field,
      layout: view.layout,
      items: [],
      status
    }))
  }))
}

export async function loadInfraCharts (
  webMap: any,
  options: {
    selectedName: string | null
    filterTerritorio: string
    filterSemiarido: string
    filteredNames: string[]
  }
): Promise<InfraChart[]> {
  const scoped = Boolean(
    options.selectedName || options.filterTerritorio || options.filterSemiarido
  )

  return Promise.all(
    CHART_DEFS.map(async (def) => {
      const layer = findLayer(webMap, { layerTitle: def.layerTitle })
      const views = await Promise.all(
        def.views.map(async (view) => {
          if (!layer || typeof layer.queryFeatures !== 'function') {
            return {
              id: view.id,
              subtitle: view.subtitle,
              field: view.field,
              layout: view.layout,
              items: [],
              status: 'error' as const,
              message: `Camada ${def.layerTitle} não encontrada`
            }
          }

          try {
            await layer.load?.()
            const field = resolveChartField(
              layer,
              view.field,
              'bucket' in view && view.bucket === 'empreendedor'
                ? EMPREENDEDOR_FIELDS
                : 'bucket' in view && view.bucket === 'porte'
                  ? PORTE_VOLUME_FIELDS
                  : []
            )
            if (!field) {
              return {
                id: view.id,
                subtitle: view.subtitle,
                field: view.field,
                layout: view.layout,
                items: [],
                status: 'error' as const,
                message: 'Campo não encontrado nesta camada'
              }
            }

            const scope = {
              selectedName: options.selectedName,
              filterTerritorio: options.filterTerritorio,
              filterSemiarido: options.filterSemiarido,
              filteredNames: options.filteredNames,
              scoped
            }
            let items = 'bucket' in view && view.bucket === 'porte'
              ? await queryPorteForScope(layer, field, scope)
              : await queryBreakdownForScope(layer, field, scope)
            if ('bucket' in view && view.bucket === 'empreendedor') {
              items = bucketEmpreendedorSlices(items)
            }
            const hasData = items.some((item) => item.total > 0)
            return {
              id: view.id,
              subtitle: view.subtitle,
              field: view.field,
              layout: view.layout,
              items,
              status: hasData ? 'ok' as const : 'empty' as const,
              message: hasData ? undefined : 'Sem dados para este recorte'
            }
          } catch (error: any) {
            console.error(`[infra-page] Falha no gráfico ${def.title}:`, error)
            return {
              id: view.id,
              subtitle: view.subtitle,
              field: view.field,
              layout: view.layout,
              items: [],
              status: 'error' as const,
              message: 'Não foi possível carregar os dados deste recorte'
            }
          }
        })
      )

      return {
        id: def.id,
        title: def.title,
        layerTitle: def.layerTitle,
        note: 'note' in def ? def.note : undefined,
        views
      }
    })
  )
}
