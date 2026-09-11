import { resolveField } from './map'

function num (value: any): number {
  const n = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function text (value: any): string {
  return String(value ?? '').trim()
}

function classifySituacao (value: any): 'Urbana' | 'Rural' | null {
  const raw = text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  if (raw.startsWith('urb')) return 'Urbana'
  if (raw.startsWith('rur')) return 'Rural'
  return null
}

type Agg = {
  cod_mun: string
  nm_mun: string
  situacao: 'Urbana' | 'Rural'
  populacao: number
  esg_total: number
  esg_rede: number
  esg_banheiro: number
}

function emptyAgg (cod_mun: string, nm_mun: string, situacao: 'Urbana' | 'Rural'): Agg {
  return {
    cod_mun,
    nm_mun,
    situacao,
    populacao: 0,
    esg_total: 0,
    esg_rede: 0,
    esg_banheiro: 0
  }
}

/**
 * Agrega Setores Censitários por município + Urbana/Rural.
 * Usa o campo Situação do Setor Censitário (não o tipo detalhado do setor).
 */
export async function loadSetoresUrbanoRural (
  layer: any,
  municipios: { features?: any[] } | null
): Promise<{ type: 'FeatureCollection', features: any[] }> {
  if (!layer || typeof layer.queryFeatures !== 'function') {
    return { type: 'FeatureCollection', features: [] }
  }

  await layer.load?.()

  const sitField = resolveField(layer, 'situacao', 'Situação do Setor Censitário')
  const codField = resolveField(layer, 'cd_mun', 'codigo do municipio')
  const nameField = resolveField(layer, 'nm_mun', 'municipio')

  const geoByCod = new Map<string, any>()
  for (const feature of municipios?.features || []) {
    const cod = String(feature?.properties?.cod_mun || '')
    if (cod) geoByCod.set(cod, feature.properties)
  }

  const buckets = new Map<string, Agg>()
  let offset = 0
  const pageSize = 2000

  while (true) {
    const query = layer.createQuery()
    query.where = '1=1'
    query.returnGeometry = false
    query.outFields = [
      sitField,
      codField,
      nameField,
      'v0001',
      'v0002',
      'v00232',
      'v00309'
    ]
    query.num = pageSize
    query.start = offset
    const result = await layer.queryFeatures(query)
    const page = result?.features || []

    for (const feature of page) {
      const attrs = feature.attributes || {}
      const situacao = classifySituacao(attrs[sitField])
      if (!situacao) continue
      const cod_mun = String(Math.round(num(attrs[codField])))
      if (!cod_mun || cod_mun === '0') continue
      const key = `${cod_mun}|${situacao}`
      if (!buckets.has(key)) {
        buckets.set(key, emptyAgg(cod_mun, text(attrs[nameField]), situacao))
      }
      const row = buckets.get(key) as Agg
      row.populacao += num(attrs.v0001)
      row.esg_total += num(attrs.v0002)
      row.esg_banheiro += num(attrs.v00232)
      row.esg_rede += num(attrs.v00309)
    }

    if (page.length < pageSize) break
    offset += page.length
    if (offset > 80000) break
  }

  const features = [...buckets.values()].map((row) => {
    const geo = geoByCod.get(row.cod_mun)
    const esg_sem = Math.max(0, row.esg_total - row.esg_banheiro)
    return {
      type: 'Feature',
      geometry: null,
      properties: {
        cod_mun: row.cod_mun,
        nm_mun: geo?.nm_mun || row.nm_mun,
        territorio: geo?.territorio || '',
        semiarido: geo?.semiarido || 'NÃO',
        situacao: row.situacao,
        populacao: row.populacao,
        esg_total: row.esg_total,
        esg_rede: row.esg_rede,
        esg_fossa_sep: 0,
        esg_fossa_rud: 0,
        esg_vala: 0,
        esg_rio: 0,
        esg_outra: Math.max(0, row.esg_banheiro - row.esg_rede),
        esg_sem
      }
    }
  })

  return { type: 'FeatureCollection', features }
}

export type SetorCensitarioRow = {
  codigo: string
  situacao: string
  tipo: string
  nm_mun: string
  populacao: number
  domicilios: number
}

function fieldSet (layer: any): Set<string> {
  return new Set((layer?.fields || []).map((field: any) => String(field?.name || '')))
}

function pickAttr (attrs: Record<string, any>, candidates: string[]): string {
  if (!attrs) return ''
  const byLower = new Map(Object.keys(attrs).map((key) => [key.toLowerCase(), key]))
  for (const candidate of candidates) {
    const actual = byLower.get(candidate.toLowerCase())
    if (actual == null) continue
    const value = text(attrs[actual])
    if (value) return value
  }
  return ''
}

function fieldType (layer: any, fieldName: string): string {
  const field = (layer?.fields || []).find((item: any) => String(item?.name || '') === fieldName)
  return String(field?.type || '').toLowerCase()
}

function munWhere (layer: any, codField: string, codMun: string, nameField: string, nmMun: string): string {
  const digits = String(codMun || '').replace(/\D/g, '')
  if (codField && digits) {
    const asString = fieldType(layer, codField).includes('string')
    if (asString) return `${codField} = '${digits}'`
    const n = Number(digits)
    if (Number.isFinite(n)) return `${codField} = ${Math.round(n)}`
  }
  if (nameField && nmMun) {
    const safe = String(nmMun).replace(/'/g, "''")
    return `UPPER(${nameField}) = UPPER('${safe}')`
  }
  return '1=0'
}

/**
 * Lista os setores censitários individuais do município (não o agregado urbano/rural).
 */
export async function querySetoresDoMunicipio (
  layer: any,
  options: { codMun: string, nmMun?: string }
): Promise<SetorCensitarioRow[]> {
  if (!layer || typeof layer.queryFeatures !== 'function') return []
  await layer.load?.()

  const sitField = resolveField(layer, 'situacao', 'Situação do Setor Censitário', 'nm_sit')
  const codField = resolveField(layer, 'cd_mun', 'codigo do municipio')
  const nameField = resolveField(layer, 'nm_mun', 'municipio')
  const setorField = resolveField(layer, 'cd_setor', 'codigo do setor')
  const tipoField = resolveField(layer, 'nm_tipo', 'tipo_sc', 'tipo_setor', 'tipo')
  const available = fieldSet(layer)
  const wanted = [sitField, codField, nameField, setorField, tipoField, 'v0001', 'v0002']
    .filter((name) => name && (available.size === 0 || available.has(name)))

  const where = munWhere(layer, codField, options.codMun, nameField, options.nmMun || '')
  const rows: SetorCensitarioRow[] = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const query = layer.createQuery()
    query.where = where
    query.returnGeometry = false
    query.outFields = wanted.length ? wanted : ['*']
    query.num = pageSize
    query.start = offset
    if (setorField) query.orderByFields = [`${setorField} ASC`]
    const result = await layer.queryFeatures(query)
    const page = result?.features || []
    for (const feature of page) {
      const attrs = feature.attributes || {}
      const situacao = classifySituacao(sitField ? attrs[sitField] : pickAttr(attrs, ['situacao', 'nm_sit']))
        || pickAttr(attrs, ['situacao', 'nm_sit'])
        || '—'
      rows.push({
        codigo: (setorField ? text(attrs[setorField]) : '') || pickAttr(attrs, ['cd_setor', 'codigo_do_setor']) || '—',
        situacao,
        tipo: (tipoField ? text(attrs[tipoField]) : '') || pickAttr(attrs, ['nm_tipo', 'tipo_sc', 'tipo_setor']) || '',
        nm_mun: (nameField ? text(attrs[nameField]) : '') || options.nmMun || '',
        populacao: num(attrs.v0001),
        domicilios: num(attrs.v0002)
      })
    }
    if (page.length < pageSize) break
    offset += page.length
    if (offset > 8000) break
  }

  return rows
}
