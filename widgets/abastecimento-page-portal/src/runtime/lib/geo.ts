import { resolveField } from './map'

function num (value: any): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function text (value: any): string {
  return String(value ?? '').trim()
}

function pick (attrs: Record<string, any>, ...keys: string[]): any {
  if (!attrs) return null
  const entries = Object.keys(attrs)
  const byLower = new Map(entries.map((key) => [key.toLowerCase(), key]))
  for (const key of keys) {
    if (!key) continue
    if (attrs[key] != null && attrs[key] !== '') return attrs[key]
    const real = byLower.get(String(key).toLowerCase())
    if (real != null && attrs[real] != null && attrs[real] !== '') return attrs[real]
  }
  return null
}

function mapFeature (attrs: Record<string, any>, fields: {
  cod: string
  name: string
  ti: string
  semi: string
  pop: string
}) {
  const semiaridoRaw = pick(attrs, fields.semi, 'região_do_semiarida', 'regiao_do_semiarida', 'semiarido')
  return {
    type: 'Feature',
    geometry: null,
    properties: {
      objectid: attrs.objectid,
      cod_mun: String(Math.round(num(pick(attrs, fields.cod, 'codígo_do_municipio', 'codigo_do_municipio', 'codibge')))),
      nm_mun: text(pick(attrs, fields.name, 'nome_do_municipio', 'nm_mun')),
      territorio: text(pick(attrs, fields.ti, 'territorio_de_indentidade', 'territorio_de_identidade')),
      // Valor inicial; sobrescrito por applySemiaridoFromKeys com Região Semiárida_BA
      semiarido: /sim/i.test(String(semiaridoRaw || '')) ? 'SIM' : 'NÃO',
      populacao: num(pick(attrs, fields.pop, 'estimativa_pop_2025', 'pop_est_2025', 'pop_2025', 'população__2022_', 'populacao__2022_')),
      pessoas_indigenas: num(pick(attrs, 'pessoas_indigenas__2022_')),
      pessoas_quilombolas: num(pick(attrs, 'pessoas_quilombolas__2022_')),
      total_domicilios: num(pick(
        attrs,
        'total_domicílios_recenseados__2',
        'total_domicilios_recenseados__2',
        'total_domicílios_recenseados',
        'dom_rec_2022',
        'total_domicilios',
        'tot_dom',
        'domicilios'
      )),
      pop_urbana: num(pick(attrs, 'st_d_urba_1')),
      pop_rural: num(pick(attrs, 'st_d_rural_1')),
      aa_total: num(pick(attrs, 'aa_total')),
      aa_rede: num(pick(attrs, 'aa_l_r_g')),
      aa_poco_prof: num(pick(attrs, 'aa_pp_a')),
      aa_poco_raso: num(pick(attrs, 'aa_pr_f_c')),
      aa_fonte: num(pick(attrs, 'aa_f_n_m')),
      aa_pipa: num(pick(attrs, 'aa_cp')),
      aa_chuva: num(pick(attrs, 'aa_aca')),
      aa_rio: num(pick(attrs, 'aa_racli')),
      aa_outra: num(pick(attrs, 'aa_outra')),
      aa_sem_rede: num(pick(attrs, 'aa_npl_rg')),
      embasa_agua: text(pick(
        attrs,
        'abastecimento_agua',
        'embasa_agua',
        'municipios_embasa',
        'atendido_embasa',
        'embasa'
      ))
    }
  }
}

export async function loadMunicipiosFromLayer (layer: any): Promise<{
  type: 'FeatureCollection'
  features: any[]
}> {
  await layer.load?.()

  const fields = {
    cod: resolveField(layer, 'codígo_do_municipio', 'codigo_do_municipio', 'codibge'),
    name: resolveField(layer, 'nome_do_municipio', 'nm_mun'),
    ti: resolveField(layer, 'territorio_de_indentidade', 'territorio'),
    semi: resolveField(layer, 'região_do_semiarida', 'regiao_do_semiarida'),
    pop: resolveField(
      layer,
      'estimativa_pop_2025',
      'pop_est_2025',
      'estimativa_pop2025',
      'populacao_estimada_2025',
      'populacao total (estimativa - 2025)',
      'pop_2025',
      'população__2022_',
      'populacao__2022_'
    )
  }

  // Preferir * para não perder campos SIDRA (aa_*) por mismatch de nome
  let outFields: string[] = ['*']

  const features: any[] = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const query = layer.createQuery()
    query.where = '1=1'
    query.returnGeometry = false
    query.outFields = outFields
    query.num = pageSize
    query.start = offset

    let result: any
    try {
      result = await layer.queryFeatures(query)
    } catch (error) {
      if (outFields[0] === '*') throw error
      console.warn('[abastecimento] query com outFields falhou, tentando *:', error)
      outFields = ['*']
      continue
    }

    const page = result?.features || []
    page.forEach((feature: any) => {
      features.push(mapFeature(feature.attributes || {}, fields))
    })
    if (page.length < pageSize) break
    offset += page.length
    if (offset > 5000) break
  }

  if (!features.length) {
    throw new Error('Nenhum município retornado pela camada DPA/PDA.')
  }

  return { type: 'FeatureCollection', features }
}

function normalizeMunKey (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Marca SIM/NÃO a partir das chaves da camada Região Semiárida_BA.
 * Se não houver chaves, mantém o valor já presente em properties.semiarido.
 */
export function applySemiaridoFromKeys (
  dpaGeo: { type?: string, features?: any[] } | null,
  keys: { codes?: string[], names?: string[] } | null
): { type: 'FeatureCollection', features: any[] } {
  const codes = new Set(
    (keys?.codes || [])
      .map((c) => Number(c))
      .filter((n) => Number.isFinite(n) && n > 100000)
      .map((n) => String(Math.round(n)))
  )
  const names = new Set(
    (keys?.names || [])
      .map((n) => String(n || '').trim())
      .filter((n) => n.length >= 2 && !/^\d+([.,]\d+)?$/.test(n))
      .map((n) => normalizeMunKey(n))
      .filter(Boolean)
  )
  const hasKeys = codes.size > 0 || names.size > 0
  const features = (dpaGeo?.features || []).map((feature) => {
    const props = feature?.properties || {}
    if (!hasKeys) {
      return {
        ...feature,
        properties: {
          ...props,
          semiarido: props.semiarido === 'SIM' ? 'SIM' : 'NÃO'
        }
      }
    }
    const byCod = codes.has(String(props.cod_mun || ''))
    const byName = names.has(normalizeMunKey(props.nm_mun))
    return {
      ...feature,
      properties: {
        ...props,
        semiarido: byCod || byName ? 'SIM' : 'NÃO'
      }
    }
  })
  return { type: 'FeatureCollection', features }
}

/**
 * Recorta o GEO do DPA com a camada Região Semiárida_BA:
 * marca SIM/NÃO, troca os atributos pelos da camada oficial e inclui
 * municípios que só existem nela.
 */
export function applySemiaridoFromLayer (
  dpaGeo: { type?: string, features?: any[] } | null,
  semiGeo: { type?: string, features?: any[] } | null
): { type: 'FeatureCollection', features: any[] } {
  const dpaFeatures = dpaGeo?.features || []
  const semiFeatures = (semiGeo?.features || []).filter((feature) => {
    const props = feature?.properties || {}
    const name = String(props.nm_mun || '').trim()
    const cod = String(props.cod_mun || '')
    return Boolean(name) || (cod && cod !== '0')
  })
  if (semiFeatures.length <= 1) {
    return { type: 'FeatureCollection', features: dpaFeatures }
  }

  const byCod = new Map<string, any>()
  const byName = new Map<string, any>()
  for (const feature of semiFeatures) {
    const props = { ...(feature.properties || {}), semiarido: 'SIM' }
    const marked = { ...feature, properties: props }
    const cod = String(props.cod_mun || '')
    if (cod && cod !== '0') byCod.set(cod, marked)
    const name = normalizeMunKey(props.nm_mun)
    if (name) byName.set(name, marked)
  }

  const used = new Set<any>()
  const merged = dpaFeatures.map((feature) => {
    const props = feature.properties || {}
    const hit = byCod.get(String(props.cod_mun || '')) || byName.get(normalizeMunKey(props.nm_mun))
    if (!hit) {
      return { ...feature, properties: { ...props, semiarido: 'NÃO' } }
    }
    used.add(hit)
    return {
      ...feature,
      properties: {
        ...props,
        ...hit.properties,
        semiarido: 'SIM',
        territorio: hit.properties.territorio || props.territorio,
        nm_mun: props.nm_mun || hit.properties.nm_mun,
        cod_mun: props.cod_mun && props.cod_mun !== '0' ? props.cod_mun : hit.properties.cod_mun
      }
    }
  })

  for (const feature of semiFeatures) {
    const props = feature.properties || {}
    const hit = byCod.get(String(props.cod_mun || '')) || byName.get(normalizeMunKey(props.nm_mun))
    if (hit && used.has(hit)) continue
    const already = merged.some((item) => {
      const sameCod = props.cod_mun && props.cod_mun !== '0' && item.properties.cod_mun === props.cod_mun
      const sameName = props.nm_mun && normalizeMunKey(item.properties.nm_mun) === normalizeMunKey(props.nm_mun)
      return sameCod || sameName
    })
    if (!already) {
      merged.push({ ...feature, properties: { ...props, semiarido: 'SIM' } })
    }
  }

  return { type: 'FeatureCollection', features: merged }
}
