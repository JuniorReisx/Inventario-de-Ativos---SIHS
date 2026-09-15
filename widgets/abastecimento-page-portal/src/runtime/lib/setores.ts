import { resolveField } from './map'

function num (value: any): number {
  const n = Number(String(value ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function text (value: any): string {
  return String(value ?? '').trim()
}

function fieldKey (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function integerCodeFromNumber (n: number): string {
  if (!Number.isFinite(n)) return ''
  const rounded = Math.round(n)
  try {
    return rounded.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
  } catch {
    const text = String(rounded)
    if (/e/i.test(text)) return text.replace(/e\+?/i, '')
    return text
  }
}

function codeText (value: any): string {
  try {
    if (value == null || value === '') return ''
    if (typeof value === 'number') return integerCodeFromNumber(value)
    const raw = String(value).trim()
    if (!raw || raw === '—') return raw === '—' ? '—' : ''
    const sci = raw.replace(/\s/g, '').replace(',', '.')
    if (/^-?\d+(?:\.\d+)?e[+-]?\d+$/i.test(sci)) {
      return integerCodeFromNumber(Number(sci))
    }
    return raw
  } catch {
    return String(value ?? '').trim()
  }
}

function resolveExactField (layer: any, ...candidates: string[]): string {
  const fields: any[] = layer?.fields || []
  const wants = new Set(candidates.map(fieldKey))
  for (const field of fields) {
    if (wants.has(fieldKey(field?.name)) || wants.has(fieldKey(field?.alias || ''))) {
      return String(field.name)
    }
  }
  return ''
}

function looksLikeCodeField (name: string, alias = ''): boolean {
  const blob = fieldKey(name) + fieldKey(alias)
  if (!blob) return false
  if (blob.includes('municip') || blob.includes('cdmun') || blob.includes('objectid')) return false
  const isCode = blob.startsWith('cd') || blob.includes('codigo') || blob.includes('cod')
  return isCode && (blob.includes('aglom') || blob.includes('setor'))
}

function pickBestCode (layer: any, attrs: Record<string, any>, preferred?: string): string {
  if (preferred) {
    const direct = codeText(attrs[preferred])
    if (direct && direct !== '0') return direct
    const byLower = Object.keys(attrs || {}).find((key) => key.toLowerCase() === preferred.toLowerCase())
    if (byLower) {
      const value = codeText(attrs[byLower])
      if (value && value !== '0') return value
    }
  }
  const named = pickCode(attrs, [
    'cd_aglom', 'cd_aglomerado', 'codigo_aglomerado', 'codigo_do_aglomerado', 'cod_aglom',
    'cd_setor', 'codigo_do_setor', 'cod_setor', 'codigo_setor', 'cdsetor'
  ])
  if (named) return named
  for (const field of layer?.fields || []) {
    if (!looksLikeCodeField(field?.name, field?.alias || '')) continue
    const value = codeText(attrs[field.name])
    if (value && value !== '0') return value
  }
  for (const [key, raw] of Object.entries(attrs || {})) {
    if (!looksLikeCodeField(key)) continue
    const value = codeText(raw)
    if (value && value !== '0') return value
  }
  return ''
}

function knownField (available: Set<string>, name: string): string {
  if (!name) return ''
  if (available.size === 0) return ''
  if (available.has(name)) return name
  const lower = name.toLowerCase()
  return [...available].find((item) => item.toLowerCase() === lower) || ''
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
  aa_total: number
  aa_rede: number
  aa_poco_prof: number
  aa_poco_raso: number
  aa_fonte: number
  aa_pipa: number
  aa_chuva: number
  aa_rio: number
}

function emptyAgg (cod_mun: string, nm_mun: string, situacao: 'Urbana' | 'Rural'): Agg {
  return {
    cod_mun,
    nm_mun,
    situacao,
    populacao: 0,
    aa_total: 0,
    aa_rede: 0,
    aa_poco_prof: 0,
    aa_poco_raso: 0,
    aa_fonte: 0,
    aa_pipa: 0,
    aa_chuva: 0,
    aa_rio: 0
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
      'v00111',
      'v00112',
      'v00113',
      'v00114',
      'v00115',
      'v00116',
      'v00117'
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
      row.aa_total += num(attrs.v0002)
      row.aa_rede += num(attrs.v00111)
      row.aa_poco_prof += num(attrs.v00112)
      row.aa_poco_raso += num(attrs.v00113)
      row.aa_fonte += num(attrs.v00114)
      row.aa_pipa += num(attrs.v00115)
      row.aa_chuva += num(attrs.v00116)
      row.aa_rio += num(attrs.v00117)
    }

    if (page.length < pageSize) break
    offset += page.length
    if (offset > 80000) break
  }

  const features = [...buckets.values()].map((row) => {
    const known =
      row.aa_rede +
      row.aa_poco_prof +
      row.aa_poco_raso +
      row.aa_fonte +
      row.aa_pipa +
      row.aa_chuva +
      row.aa_rio
    const geo = geoByCod.get(row.cod_mun)
    return {
      type: 'Feature',
      geometry: null,
      properties: {
        ...row,
        nm_mun: geo?.nm_mun || row.nm_mun,
        territorio: geo?.territorio || '',
        semiarido: geo?.semiarido || 'NÃO',
        aa_outra: Math.max(0, row.aa_total - known),
        aa_sem_rede: 0
      }
    }
  })

  return { type: 'FeatureCollection', features }
}

export type SetorCensitarioRow = {
  codigo: string
  codAglom: string
  oid: number
  situacao: string
  tipo: string
  nome: string
  nm_mun: string
  populacao: number
  domicilios: number
}

function fieldSet (layer: any): Set<string> {
  return new Set((layer?.fields || []).map((field: any) => String(field?.name || '')))
}

function decodeField (layer: any, fieldName: string, raw: any): string {
  if (raw == null || raw === '') return ''
  try {
    const wanted = String(fieldName || '').toLowerCase()
    const field = (layer?.fields || []).find((item: any) => String(item?.name || '').toLowerCase() === wanted)
    const coded = field?.domain?.codedValues as Array<{ code: any, name: string }> | undefined
    const match = coded?.find((item) => String(item.code) === String(raw))
    if (match?.name) return String(match.name).trim()
  } catch (_) {}
  return text(raw)
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

function pickCode (attrs: Record<string, any>, candidates: string[]): string {
  if (!attrs) return ''
  const byLower = new Map(Object.keys(attrs).map((key) => [key.toLowerCase(), key]))
  for (const candidate of candidates) {
    const actual = byLower.get(candidate.toLowerCase())
    if (actual == null) continue
    const value = codeText(attrs[actual])
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

  const available = fieldSet(layer)
  const sitField = knownField(available, resolveField(layer, 'situacao', 'Situação do Setor Censitário', 'nm_sit'))
  const codField = knownField(available, resolveField(layer, 'cd_mun', 'codigo do municipio'))
  const nameField = knownField(available, resolveField(layer, 'nm_mun', 'municipio'))
  const setorField = knownField(available, resolveField(layer, 'cd_setor', 'codigo do setor'))
  const tipoField = knownField(available, resolveField(layer, 'nm_tipo', 'tipo_sc', 'tipo_setor', 'tipo'))
  const aglomField = knownField(available, resolveField(layer, 'nm_aglom', 'nome_aglomerado', 'aglomerado', 'nome_do_aglomerado'))
  const aglomCodField = knownField(
    available,
    resolveExactField(layer, 'cd_aglom', 'cd_aglomerado', 'codigo_aglomerado', 'codigo_do_aglomerado', 'cod_aglom')
  )
  const oidField = String(layer.objectIdField || 'OBJECTID')
  const wanted = [sitField, codField, nameField, setorField, tipoField, aglomField, aglomCodField, oidField, 'v0001', 'v0002']
    .filter((name, index, all) => name && (available.size === 0 || available.has(name) || name === oidField) && all.indexOf(name) === index)
  const outFields = ['*']

  const where = munWhere(layer, codField || resolveField(layer, 'cd_mun', 'codigo do municipio'), options.codMun, nameField || resolveField(layer, 'nm_mun', 'municipio'), options.nmMun || '')
  const rows: SetorCensitarioRow[] = []
  let offset = 0
  const pageSize = 1000

  const runPage = async (fields: string[], start: number, orderBy?: string) => {
    const query = layer.createQuery()
    query.where = where
    query.returnGeometry = false
    query.outFields = fields
    query.num = pageSize
    query.start = start
    if (orderBy) query.orderByFields = [orderBy]
    return layer.queryFeatures(query)
  }

  while (true) {
    let page: any[] = []
    try {
      const result = await runPage(outFields, offset, setorField ? `${setorField} ASC` : undefined)
      page = result?.features || []
    } catch (error) {
      try {
        const result = await runPage(outFields, offset)
        page = result?.features || []
      } catch {
        try {
          const result = await runPage(['*'], offset)
          page = result?.features || []
        } catch (lastError) {
          console.warn('[setores] consulta do município falhou:', lastError)
          break
        }
      }
    }
    for (const feature of page) {
      const attrs = feature.attributes || {}
      const situacao = classifySituacao(sitField ? attrs[sitField] : pickAttr(attrs, ['situacao', 'nm_sit']))
        || pickAttr(attrs, ['situacao', 'nm_sit'])
        || '—'
      rows.push({
        codigo: pickBestCode(layer, attrs, setorField) || '—',
        codAglom: pickBestCode(layer, attrs, aglomCodField || setorField) || '—',
        oid: Number(attrs[oidField] ?? attrs.OBJECTID ?? attrs.objectid) || 0,
        situacao,
        tipo: decodeField(layer, tipoField, tipoField ? attrs[tipoField] : null)
          || pickAttr(attrs, ['nm_tipo', 'tipo_sc', 'tipo_setor'])
          || '—',
        nome: decodeField(layer, aglomField, aglomField ? attrs[aglomField] : null)
          || pickAttr(attrs, ['nm_aglom', 'nome_aglomerado', 'aglomerado', 'nome_do_aglomerado'])
          || '—',
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
