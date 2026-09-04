import { findSemiaridoLayer } from './layers'
import type { IndicatorDefinition } from './config'

export interface SemiaridoRecord {
  attrs: Record<string, any>
  fields: any[]
  layer: any
}

interface FieldHint {
  names: string[]
  phrases: string[]
  exclude?: string[]
}

const FIELD_HINTS: Record<string, FieldHint> = {
  pop_total: {
    names: [
      'pop_est_2026',
      'estimativa_pop_2026',
      'populacao_estimada_2026',
      'pop_2026',
      'estimativa_pop_2025',
      'pop_est_2025',
      'pop_2022',
      'população__2022_',
      'populacao__2022_',
      'pop_total'
    ],
    phrases: [
      'pop est 2026',
      'populacao total (estimativa - 2026)',
      'estimativa 2026',
      'populacao total (estimativa - 2025)',
      'estimativa 2025'
    ],
    exclude: ['indigen', 'quilom', 'mulher', 'homem', 'masculin', 'feminin', 'rural', 'urb']
  },
  pop_indigena: {
    names: ['pop_ind_2022', 'pessoas_indigenas__2022_', 'pop_indigena', 'indigenas'],
    phrases: ['indigen']
  },
  pop_quilombola: {
    names: ['pop_quil_2022', 'pessoas_quilombolas__2022_', 'pop_quilombola', 'quilombolas'],
    phrases: ['quilom']
  },
  pop_mulheres: {
    names: ['pop_f_2022', 'população_mulheres__2022_', 'populacao_mulheres__2022_', 'pop_mulheres'],
    phrases: ['mulher', 'feminin'],
    exclude: ['masculin']
  },
  pop_homens: {
    names: ['pop_m_2022', 'população_de_homens__2022_', 'populacao_de_homens__2022_', 'pop_homens'],
    phrases: ['homem', 'homens', 'masculin'],
    exclude: ['feminin', 'mulher']
  },
  densidade: {
    names: ['dens_dem_2022', 'densidade_demografica_hab_km__2', 'densi_demografica_2022', 'densidade'],
    phrases: ['densidade']
  },
  domicilios: {
    names: ['dom_rec_2022', 'total_domicílios_recenseados__2', 'total_domicilios_recenseados__2', 'domicilios'],
    phrases: ['domicilio recense', 'domicilios recenseados']
  },
  rural: {
    names: ['pop_rur_2022', 'st_d_rural_1', 'pop_rural_2022', 'pop_rural'],
    phrases: ['pop rural', 'populacao rural'],
    exclude: ['pct', 'perc']
  },
  urbana: {
    names: ['pop_urb_2022', 'st_d_urba_1', 'pop_urbana'],
    phrases: ['pop urbana', 'populacao urbana'],
    exclude: ['pct', 'perc']
  },
  total_mun: {
    names: ['total_mun', 'qtd_mun', 'qt_mun', 'n_municipios', 'num_municipios', 'qtd_municipios', 'mun'],
    phrases: ['total mun', 'qtd mun'],
    exclude: ['embasa', 'abastec', 'esgot', 'pop_est', 'estimat', 'populac']
  },
  a_tot: {
    names: ['aba_total', 'aa_total', 'a_tot', 'aa_tot'],
    phrases: ['abastecimento de agua total', 'aa total'],
    exclude: ['esgot', 'perc']
  },
  a_rede: {
    names: ['aba_lrg', 'aa_l_r_g', 'a_rede', 'rd_geral_a'],
    phrases: ['ligacao a rede geral', 'abastecimento ligacao'],
    exclude: ['esgot', 'sem lig', 'nao possui', 'perc', 'sem rede', 'pluvial']
  },
  a_pocart: {
    names: ['aba_ppa', 'aa_pp_a', 'a_pocart', 'poco_p'],
    phrases: ['poco profundo', 'artesiano'],
    exclude: ['raso', 'freatic', 'cacimba', 'perc', 'esgot']
  },
  a_pocfre: {
    names: ['aba_prfc', 'aa_pr_f_c', 'a_pocfre', 'poco_raso'],
    phrases: ['poco raso', 'freatic', 'cacimba'],
    exclude: ['profundo', 'artesian', 'perc', 'esgot']
  },
  a_font: {
    names: ['aba_fnm', 'aa_f_n_m', 'a_font', 'fonte_nscnt_mina'],
    phrases: ['fonte nascente', 'nascente ou mina'],
    exclude: ['perc', 'esgot']
  },
  a_car: {
    names: ['aba_cp', 'aa_cp', 'a_car', 'carro_pipa'],
    phrases: ['carro pipa'],
    exclude: ['perc', 'esgot']
  },
  a_chu: {
    names: ['aba_aca', 'aa_aca', 'a_chu', 'a_chuva'],
    phrases: ['chuva armazenada', 'agua de chuva'],
    exclude: ['perc', 'esgot']
  },
  a_rio: {
    names: ['aba_racli', 'aa_racli', 'a_rio', 'rios_acudes'],
    phrases: ['rios acudes', 'corregos lagos'],
    exclude: ['esgot', 'perc', 'vala']
  },
  a_out: {
    names: ['aba_outr', 'aa_outra', 'a_out', 'outros_agua'],
    phrases: ['abastecimento outra'],
    exclude: ['esgot', 'perc']
  },
  a_sem: {
    names: ['aa_npl_rg', 'a_sem', 'sem_rede_geral', 'aba_npl'],
    phrases: ['sem ligacao', 'nao possui ligacao', 'nao possui ligacao com a rede'],
    exclude: ['esgot', 'perc', 'banheiro']
  },
  e_tot: {
    names: ['esg_total', 'e_tot'],
    phrases: ['esgotamento total', 'esg total'],
    exclude: ['perc']
  },
  e_rede: {
    names: ['esg_rrpflg', 'e_rede', 'rede_esgoto'],
    phrases: ['rede de esgoto', 'conexao a rede de esgoto'],
    exclude: ['abastec', 'perc', 'sem', 'agua principal', 'rede geral ou pluvia', 'fossa filtro ligada']
  },
  e_rede_pluvial: {
    names: ['esg_rede_geral_ou_pluvia', 'esg_rede_geral_ou_pluvial', 'e_rede_pluvial'],
    phrases: ['rede geral ou pluvia', 'esgoto rede geral ou pluvial'],
    exclude: ['abastec', 'perc', 'fossa', 'nao ligada']
  },
  e_fossa_ligada: {
    names: ['esg_fossa_septica_ou_fossa_filtro_ligada_a_rede', 'e_fossa_ligada'],
    phrases: ['fossa filtro ligada a rede', 'fossa septica ou fossa filtro ligada'],
    exclude: ['nao ligada', 'rudiment', 'perc', 'abastec']
  },
  e_fossasr: {
    names: ['esg_fffnlg', 'e_fossasr', 'fossa_septica'],
    phrases: ['fossa septica ou fossa filtro', 'fossa filtro nao ligada'],
    exclude: ['rudiment', 'perc', 'buraco', 'ligada a rede']
  },
  e_fossab: {
    names: ['esg_fr_b', 'e_fossab', 'fossa_rudimentar'],
    phrases: ['fossa rudiment', 'rudimentar ou buraco'],
    exclude: ['filtro nao ligada', 'perc']
  },
  e_vala: {
    names: ['esg_vala', 'e_vala', 'vala'],
    phrases: ['esgotamento vala'],
    exclude: ['perc']
  },
  e_rio: {
    names: ['esg_r_l_cm', 'e_rio', 'rio_lago_mar'],
    phrases: ['rio lago corrego', 'lago corrego ou mar'],
    exclude: ['perc', 'abastec']
  },
  e_outra: {
    names: ['esg_outr', 'e_outra', 'outra_forma'],
    phrases: ['esgotamento outra'],
    exclude: ['perc', 'abastec']
  },
  e_sem: {
    names: ['esg_n_t_bs', 'e_sem', 'sem_banheiro', 'esg_ntbs'],
    phrases: ['sem banheiro', 'sem sanitario', 'nao tinham banheiro'],
    exclude: ['perc', 'abastec']
  },
  embasa_aa: {
    names: ['mun_emb_aba', 'embasa_aa', 'mun_at_embasa_aa'],
    phrases: ['embasa abastecimento', 'embasa agua'],
    exclude: ['esgot', 'total_mun']
  },
  embasa_e: {
    names: ['mun_emb_esg', 'embasa_e', 'mun_at_embasa_e'],
    phrases: ['embasa esgotamento', 'embasa esgoto'],
    exclude: ['abastec', 'total_mun']
  }
}

function normalizeKey (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function normalizePhrase (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

function isPercentish (name: string, alias: string): boolean {
  const text = `${name} ${alias}`.toLowerCase()
  return /perc|percent|%\b|_pct\b/.test(text)
}

function toNumber (value: any): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'boolean') return null
  if (typeof value === 'string' && /[a-zA-Z]/.test(value)) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function fieldEntries (record: SemiaridoRecord): Array<{ name: string, alias: string, value: any }> {
  const attrs = record.attrs || {}
  const byName = new Map<string, { name: string, alias: string, value: any }>()

  for (const field of record.fields || []) {
    const name = String(field?.name || '')
    if (!name) continue
    byName.set(name, {
      name,
      alias: String(field?.alias || ''),
      value: attrs[name]
    })
  }

  for (const [key, value] of Object.entries(attrs)) {
    if (!byName.has(key)) {
      byName.set(key, { name: key, alias: '', value })
    }
  }

  return Array.from(byName.values())
}

function scoreField (entry: { name: string, alias: string, value: any }, hint: FieldHint): number {
  const num = toNumber(entry.value)
  if (num == null) return -1
  if (isPercentish(entry.name, entry.alias)) return -1

  const nameKey = normalizeKey(entry.name)
  const aliasKey = normalizeKey(entry.alias)
  const phrase = normalizePhrase(`${entry.name} ${entry.alias}`)
  const excluded = (hint.exclude || []).some((item) => phrase.includes(normalizePhrase(item)))
  if (excluded) return -1

  let score = 0
  for (const candidate of hint.names) {
    const want = normalizeKey(candidate)
    if (!want) continue
    if (nameKey === want || aliasKey === want) score = Math.max(score, 100)
    else if (want.length >= 6 && (nameKey === want || nameKey.startsWith(want) || want.startsWith(nameKey)) && Math.abs(nameKey.length - want.length) <= 3) {
      score = Math.max(score, 80)
    }
  }

  for (const raw of hint.phrases) {
    const item = normalizePhrase(raw)
    if (item.length >= 4 && phrase.includes(item)) {
      score = Math.max(score, item.length >= 10 ? 70 : 55)
    }
  }

  return score
}

export function pickSemiaridoNumber (
  record: SemiaridoRecord,
  ...candidates: string[]
): number | null {
  const hint: FieldHint = { names: candidates, phrases: [] }
  let best: { score: number, value: number } | null = null
  for (const entry of fieldEntries(record)) {
    const score = scoreField(entry, hint)
    if (score < 55) continue
    const value = toNumber(entry.value)
    if (value == null) continue
    if (!best || score > best.score) best = { score, value }
  }
  return best?.value ?? null
}

export function pickSemiaridoById (
  record: SemiaridoRecord,
  id: string,
  extra: string[] = []
): number | null {
  const hint = FIELD_HINTS[id]
  const merged: FieldHint = hint
    ? { names: [...hint.names, ...extra], phrases: hint.phrases, exclude: hint.exclude }
    : { names: extra, phrases: [] }

  let best: { score: number, value: number } | null = null
  for (const entry of fieldEntries(record)) {
    const score = scoreField(entry, merged)
    if (score < 55) continue
    const value = toNumber(entry.value)
    if (value == null) continue
    if (!best || score > best.score) best = { score, value }
  }
  return best?.value ?? null
}

function attrByFieldName (attrs: Record<string, any>, want: string): any {
  if (!attrs || !want) return undefined
  if (attrs[want] != null && attrs[want] !== '') return attrs[want]
  const wantKey = normalizeKey(want)
  for (const [key, value] of Object.entries(attrs)) {
    if (normalizeKey(key) === wantKey) return value
  }
  return undefined
}

const POP_EST_2026_NAMES = [
  'pop_est_2026',
  'estimativa_pop_2026',
  'populacao_estimada_2026',
  'pop_2026'
]

export function pickSemiaridoPopEst2026 (record: SemiaridoRecord | null): number | null {
  if (!record) return null
  for (const name of POP_EST_2026_NAMES) {
    const value = toNumber(attrByFieldName(record.attrs, name))
    if (value != null && value > 0) return value
  }
  for (const field of record.fields || []) {
    if (normalizeKey(field?.name || '') === 'popest2026' || normalizeKey(field?.alias || '') === 'popest2026') {
      const value = toNumber(attrByFieldName(record.attrs, field.name))
      if (value != null && value > 0) return value
    }
  }
  return pickSemiaridoById(record, 'pop_total')
}

let cache: { webMap: any, record: SemiaridoRecord } | null = null

export function clearSemiaridoRecordCache (): void {
  cache = null
}

export async function loadSemiaridoRecord (webMap: any): Promise<SemiaridoRecord | null> {
  if (cache && cache.webMap === webMap) {
    return cache.record
  }

  const layer = findSemiaridoLayer(webMap)
  if (!layer || typeof layer.queryFeatures !== 'function') return null

  try {
    await layer.load?.()
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.where = '1=1'
    query.returnGeometry = false
    query.outFields = ['*']
    query.num = 1

    const result = await layer.queryFeatures(query)
    const attrs = result?.features?.[0]?.attributes
    if (!attrs) return null

    const record: SemiaridoRecord = {
      attrs,
      fields: layer.fields || [],
      layer
    }
    cache = { webMap, record }
    return record
  } catch (error) {
    console.warn('[sihs-dash] Falha ao ler a Região Semiárida_BA:', error)
    return null
  }
}

export function valueFromSemiaridoRecord (
  definition: IndicatorDefinition,
  record: SemiaridoRecord
): number | null {
  if (definition.id === 'pop_total') {
    return pickSemiaridoPopEst2026(record)
  }

  const extras = [
    definition.filteredScope?.onStatisticField,
    definition.onStatisticField,
    definition.numeratorField,
    definition.denominatorField
  ].filter(Boolean) as string[]

  return pickSemiaridoById(record, definition.id, extras)
}

export function saneamentoStatsFromRecord (record: SemiaridoRecord): Record<string, any> | null {
  const stats = {
    a_tot: pickSemiaridoById(record, 'a_tot'),
    a_rede: pickSemiaridoById(record, 'a_rede'),
    a_pocart: pickSemiaridoById(record, 'a_pocart'),
    a_pocfre: pickSemiaridoById(record, 'a_pocfre'),
    a_font: pickSemiaridoById(record, 'a_font'),
    a_car: pickSemiaridoById(record, 'a_car'),
    a_chu: pickSemiaridoById(record, 'a_chu'),
    a_rio: pickSemiaridoById(record, 'a_rio'),
    a_out: pickSemiaridoById(record, 'a_out'),
    a_sem: pickSemiaridoById(record, 'a_sem'),
    e_tot: pickSemiaridoById(record, 'e_tot'),
    e_rede_pluvial: pickSemiaridoById(record, 'e_rede_pluvial'),
    e_fossa_ligada: pickSemiaridoById(record, 'e_fossa_ligada'),
    e_rede: pickSemiaridoById(record, 'e_rede'),
    e_fossasr: pickSemiaridoById(record, 'e_fossasr'),
    e_fossab: pickSemiaridoById(record, 'e_fossab'),
    e_vala: pickSemiaridoById(record, 'e_vala'),
    e_rio: pickSemiaridoById(record, 'e_rio'),
    e_outra: pickSemiaridoById(record, 'e_outra'),
    e_sem: pickSemiaridoById(record, 'e_sem'),
    embasa_aa: pickSemiaridoById(record, 'embasa_aa'),
    embasa_e: pickSemiaridoById(record, 'embasa_e')
  }

  if (
    stats.a_rede == null &&
    stats.e_rede == null &&
    stats.e_rede_pluvial == null &&
    stats.a_tot == null &&
    stats.e_tot == null &&
    stats.a_sem == null &&
    stats.e_sem == null &&
    stats.a_pocart == null &&
    stats.e_fossasr == null
  ) {
    return null
  }

  if (stats.a_sem == null && stats.a_tot != null && stats.a_rede != null) {
    const derived = stats.a_tot - stats.a_rede
    if (derived >= 0) stats.a_sem = derived
  }

  const esgotoPartes =
    (stats.e_rede || 0) +
    (stats.e_fossasr || 0) +
    (stats.e_fossab || 0) +
    (stats.e_vala || 0) +
    (stats.e_rio || 0) +
    (stats.e_outra || 0)
  if (stats.e_sem == null && stats.e_tot != null && esgotoPartes >= 0) {
    const derived = stats.e_tot - esgotoPartes
    if (derived >= 0) stats.e_sem = derived
  }

  return stats
}
