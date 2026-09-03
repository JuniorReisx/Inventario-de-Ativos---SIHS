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
        aa_outra: 0, // camada sem campo “Outra”; residual não é categoria do Censo
        aa_sem_rede: 0
      }
    }
  })

  return { type: 'FeatureCollection', features }
}
