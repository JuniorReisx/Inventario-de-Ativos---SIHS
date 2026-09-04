import { findLayer, findMunicipioLayer } from './layers'
import { queryStatistics } from './statistics'
import type { DashboardFilter } from './filter'
import { pickMunicipioNameField } from './filter'
import { loadSemiaridoRecord, saneamentoStatsFromRecord } from './semiarido-record'

export interface SaneamentoMetric {
  id: string
  label: string
  value: number | null
  percent: number | null
  color: string
}

export interface SaneamentoSummary {
  title: string
  scopeLabel: string
  highlightLabel: string
  highlightValue: number | null
  highlightPercent: number | null
  secondaryLabel: string
  secondaryValue: number | null
  secondaryPercent: number | null
  embasaLabel: string
  embasaValue: number | null
  embasaText?: string | null
  metrics: SaneamentoMetric[]
  status: 'loading' | 'ok' | 'error'
  message?: string
  source?: string
}

export const SANEAMENTO_SOURCE = 'SIDRA - IBGE 2022'

export const SANEAMENTO_NOTES = {
  agua: {
    title: 'Como funcionam os indicadores',
    body: [
      'Fonte: Tabela 6803 (SIDRA / IBGE 2022) — Domicílios particulares permanentes ocupados, por existência de ligação à rede geral de distribuição de água e principal forma de abastecimento de água.',
      'O indicador “Possui ligação à rede geral” soma todas as categorias com ligação, seja a rede a forma principal ou não. “Não possui ligação à rede geral” é a categoria correspondente.',
      'Quem tem ligação se divide em duas formas no gráfico: “Possui ligação à rede geral e a utiliza como forma principal”; ou “Possui ligação à rede geral, mas utiliza principalmente outra forma” (poço profundo, poço raso/cacimba, fonte, pipa, chuva, rio/açude e outras).',
      'As duas barras do gráfico usam “Possui ligação à rede geral” como 100%: a soma dos dois grupos é 100%.',
      'O selo Embasa indica municípios atendidos pela Embasa em água. No recorte de um município, o selo mostra “Atendido” ou “Não atendido”. No território (ou outro recorte), clique no selo para ver a lista dos municípios atendidos.'
    ]
  },
  esgoto: {
    title: 'Como funcionam os indicadores',
    body: [
      'Fonte: Tabela 6805 (SIDRA / IBGE 2022) — Domicílios particulares permanentes ocupados, por tipo de esgotamento sanitário.',
      'O destaque “Rede geral, rede pluvial ou fossa ligada à rede” é a soma dos dois campos do web map. O gráfico de barras mostra como esse total se divide: “Rede geral ou pluvial” e “Fossa séptica ou fossa filtro ligada à rede” (100% = o destaque). O segundo indicador é “Não tinham banheiro nem sanitário” (SIDRA).',
      'O selo Embasa indica municípios atendidos pela Embasa em esgotamento. No recorte de um município, o selo mostra “Atendido” ou “Não atendido”. No território (ou outro recorte), clique no selo para ver a lista dos municípios atendidos.'
    ]
  }
} as const

const AA_HIGHLIGHT_LABEL = 'Possui ligação à rede geral'
const AA_SECONDARY_LABEL = 'Não possui ligação à rede geral'
const AA_USA_REDE_LABEL = 'Possui ligação à rede geral e a utiliza como forma principal'
const AA_NAO_USA_REDE_LABEL = 'Possui ligação à rede geral, mas utiliza principalmente outra forma'
const ESG_HIGHLIGHT_LABEL = 'Rede geral, rede pluvial ou fossa ligada à rede'
const ESG_SECONDARY_LABEL = 'Não tinham banheiro nem sanitário'
const ESG_USA_REDE_LABEL = 'Rede geral ou pluvial'
const ESG_NAO_USA_REDE_LABEL = 'Fossa séptica ou fossa filtro ligada à rede'

const AA_COLORS = {
  rede: '#071C33',
  poco: '#1B5FA0',
  inadequado: '#78BFE8',
  sem: '#9BB8C9'
}

const ESG_COLORS = {
  rede: '#3E2723',
  fossa: '#6D4C41',
  rudimentar: '#A1887F',
  sem: '#BCAAA4'
}

function n (value: any): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function fieldMatchesNeedle (fieldName: string, needle: string): boolean {
  const compact = (value: string) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const a = compact(fieldName)
  const b = compact(needle)
  if (!a || !b) return false
  if (a === b) return true
  const shorter = a.length <= b.length ? a : b
  const longer = a.length <= b.length ? b : a
  return shorter.length >= 20 && longer.startsWith(shorter)
}

function pickLayerFieldByTokens (
  available: Map<string, string>,
  required: string[],
  forbidden: string[] = []
): string | null {
  const compact = (value: string) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const need = required.map(compact).filter(Boolean)
  const skip = forbidden.map(compact).filter(Boolean)
  for (const [lower, name] of available) {
    const key = compact(lower)
    if (skip.some((item) => key.includes(item))) continue
    if (need.every((item) => key.includes(item))) return name
  }
  return null
}

function numFromKeyPattern (
  attrs: Record<string, any>,
  includes: string[],
  excludes: string[] = []
): number | null {
  for (const [key, value] of Object.entries(attrs || {})) {
    if (excludes.some((item) => fieldMatchesNeedle(key, item))) continue
    if (!includes.some((item) => fieldMatchesNeedle(key, item))) continue
    const parsed = n(value)
    if (parsed != null) return parsed
  }
  return null
}

const DPA_EMBASA_AGUA_FIELD = 'abastecimento_agua'
const DPA_EMBASA_ESGOTO_FIELD = 'esgotamento_sanitario'

function isEmbasaServedValue (value: any): boolean {
  if (value == null || value === '') return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  const normalized = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
  if (!normalized || normalized === 'NAO' || normalized === 'N' || normalized === '0' || normalized.includes('NAO ATEND')) {
    return false
  }
  return (
    normalized === 'SIM' ||
    normalized === 'S' ||
    normalized === '1' ||
    normalized === 'TRUE' ||
    normalized === 'ATENDIDO' ||
    normalized.includes('ATENDIDO') ||
    normalized.includes('EMBASA')
  )
}

function layerFieldEntries (layer: any): Array<{ name: string, alias: string }> {
  return (layer?.fields || []).map((field: any) => ({
    name: String(field?.name || ''),
    alias: String(field?.alias || '')
  })).filter((field: { name: string }) => field.name)
}

function normalizeFieldText (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function pickDpaEmbasaField (layer: any, fieldName: string, aliasPhrases: string[]): string | null {
  const fields = layerFieldEntries(layer)
  const byName = new Map(
    fields.map((field: { name: string }) => [field.name.toLowerCase(), field.name])
  )
  const exact = byName.get(fieldName.toLowerCase())
  if (exact) return exact

  const phrases = aliasPhrases.map(normalizeFieldText).filter(Boolean)
  const byAlias = fields.find((field: { name: string, alias: string }) => {
    const text = `${normalizeFieldText(field.name)} ${normalizeFieldText(field.alias)}`
    return phrases.some((phrase) => text.includes(phrase))
  })
  return byAlias?.name || null
}

function pickAguaEmbasaField (layer: any): string | null {
  return pickDpaEmbasaField(layer, DPA_EMBASA_AGUA_FIELD, [
    'municipios embasa (abastecimento de agua)',
    'embasa (abastecimento de agua)',
    'embasa abastecimento'
  ])
}

function pickEsgotoEmbasaField (layer: any): string | null {
  return pickDpaEmbasaField(layer, DPA_EMBASA_ESGOTO_FIELD, [
    'municipios embasa (esgotamento)',
    'embasa (esgotamento)',
    'embasa esgotamento'
  ])
}

function embasaServedWhere (field: string): string {
  // Campos Embasa no DPA são texto (SIM/NÃO). Evitar `= 1` — quebra a query no ArcGIS Server.
  return `(${field} = 'SIM' OR ${field} = 'Sim' OR ${field} = 'sim' OR ${field} = 'S' OR ${field} = 'ATENDIDO' OR ${field} = 'Atendido')`
}

async function countEmbasaField (
  layer: any,
  filter: DashboardFilter,
  field: string
): Promise<number | null> {
  try {
    const stats = await queryStatistics(layer, {
      where: `${filter.munWhere || '1=1'} AND ${embasaServedWhere(field)}`,
      geometry: filter.skipMunicipalGeometry ? null : (filter.geometry || null),
      statisticType: 'count',
      onStatisticField: layer.objectIdField || 'objectid',
      outStatisticFieldName: 'value'
    })
    const value = n(stats?.value)
    return value == null ? 0 : value
  } catch {
    return null
  }
}

async function readMunicipioEmbasaFlag (
  layer: any,
  filter: DashboardFilter,
  field: string | null
): Promise<number> {
  if (!field) return 0
  const query = layer.createQuery()
  query.where = filter.munWhere || '1=1'
  query.returnGeometry = false
  query.outFields = [field]
  query.num = 1
  const result = await layer.queryFeatures(query)
  const attrs = result.features?.[0]?.attributes || {}
  const raw = attrs[field] ?? attrs[Object.keys(attrs).find((key) => key.toLowerCase() === field.toLowerCase()) || '']
  return isEmbasaServedValue(raw) ? 1 : 0
}

async function countAguaEmbasa (
  layer: any,
  filter: DashboardFilter
): Promise<number | null> {
  const field = pickAguaEmbasaField(layer)
  if (filter.type === 'municipio') {
    try {
      return await readMunicipioEmbasaFlag(layer, filter, field)
    } catch {
      return 0
    }
  }
  if (!field) return null
  return countEmbasaField(layer, filter, field)
}

async function countEsgotoEmbasa (
  layer: any,
  filter: DashboardFilter
): Promise<number | null> {
  const field = pickEsgotoEmbasaField(layer)
  if (filter.type === 'municipio') {
    try {
      return await readMunicipioEmbasaFlag(layer, filter, field)
    } catch {
      return 0
    }
  }
  if (!field) return null
  return countEmbasaField(layer, filter, field)
}

function pickEmbasaFieldForKind (layer: any, kind: 'agua' | 'esgoto'): string | null {
  return kind === 'agua' ? pickAguaEmbasaField(layer) : pickEsgotoEmbasaField(layer)
}

/**
 * Lista municípios atendidos pela Embasa no recorte ativo (ex.: território de identidade).
 */
export async function listEmbasaMunicipios (
  webMap: any,
  filter: DashboardFilter,
  kind: 'agua' | 'esgoto'
): Promise<string[]> {
  const layer = findMunicipioLayer(webMap)
    || findLayer(webMap, { layerTitle: 'PDA_Indicadores_Censo_2022' })
    || findLayer(webMap, { layerTitle: 'DPA_Indicadores_Censo_2022' })
  if (!layer || typeof layer.queryFeatures !== 'function') {
    throw new Error('Camada de municípios não encontrada')
  }

  await layer.load?.()
  const embasaField = pickEmbasaFieldForKind(layer, kind)
  if (!embasaField) {
    throw new Error('Campo Embasa não encontrado nesta camada')
  }

  const nameField = pickMunicipioNameField(layer, 'nome_do_municipio')
  const whereParts = [filter.munWhere || '1=1', embasaServedWhere(embasaField)]
  const where = whereParts.map((part) => `(${part})`).join(' AND ')

  const names: string[] = []
  const seen = new Set<string>()
  let offset = 0
  const pageSize = 200

  while (offset < 1000) {
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.where = where
    query.returnGeometry = false
    query.outFields = [nameField]
    query.orderByFields = [`${nameField} ASC`]
    query.num = pageSize
    query.start = offset
    if (filter.geometry && !filter.skipMunicipalGeometry) {
      query.geometry = filter.geometry
      query.spatialRelationship = 'intersects'
    }

    let result: any
    try {
      result = await layer.queryFeatures(query)
    } catch (_) {
      query.orderByFields = undefined
      result = await layer.queryFeatures(query)
    }

    const page = result?.features || []
    for (const feature of page) {
      const attrs = feature?.attributes || {}
      const raw = attrs[nameField]
        ?? attrs[Object.keys(attrs).find((key) => key.toLowerCase() === nameField.toLowerCase()) || '']
      const text = raw == null ? '' : String(raw).trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      names.push(text)
    }

    if (page.length < pageSize) break
    offset += page.length
  }

  if (!names.length) return names
  names.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  return names
}

function pct (part: number | null, total: number | null): number | null {
  if (part == null || total == null || total <= 0) return null
  return (part / total) * 100
}

function resolveShareTotal (declared: number | null, parts: number, values: Array<number | null>): number {
  const positive = values.filter((value): value is number => value != null && value > 0)
  if (positive.some((value) => declared != null && value > declared)) {
    return Math.max(parts, declared || 0)
  }
  if (declared != null && declared > 0) return declared
  return parts
}

function esgotoLigacaoFromAttrs (attrs: Record<string, any>): {
  usaPrincipal: number | null
  naoUsaPrincipal: number | null
  totalDom: number | null
  semBanheiro: number | null
} {
  return {
    usaPrincipal: n(attrs.esg_rede_geral_ou_pluvia)
      ?? n(attrs.esg_rede_geral_ou_pluvial)
      ?? n(attrs.e_rede_pluvial)
      ?? n(attrs.rede_geral_ou_pluvial)
      ?? n(attrs.rede_geral_ou_pluvia)
      ?? numFromKeyPattern(attrs, ['esg_rede_geral_ou_pluvia', 'esg_rede_geral_ou_pluvial']),
    naoUsaPrincipal: n(attrs.esg_fossa_septica_ou_fossa_filtro_ligada_a_rede)
      ?? n(attrs.e_fossa_ligada)
      ?? n(attrs.fossa_septica_ou_fossa_filtro_ligada_a_rede)
      ?? numFromKeyPattern(attrs, ['esg_fossa_septica_ou_fossa_filtro_ligada', 'fossa_filtro_ligada'], ['nao_ligada']),
    totalDom: n(attrs.esg_total) ?? n(attrs.e_tot),
    semBanheiro: n(attrs.sem_banheiro)
      ?? n(attrs.esg_n_t_bs)
      ?? n(attrs.e_sem)
      ?? n(attrs.esg_ntbs)
      ?? numFromKeyPattern(attrs, ['esg_n_t_bs', 'sem_banheiro', 'nao_tinham_banheiro'])
  }
}

function buildEsgotoSplit (
  usaPrincipal: number | null,
  naoUsaPrincipal: number | null,
  totalDom: number | null,
  fallbackRede: number | null = null
) {
  const hasNewFields = usaPrincipal != null || naoUsaPrincipal != null
  const usa = hasNewFields ? (usaPrincipal || 0) : (fallbackRede || 0)
  const outra = hasNewFields ? (naoUsaPrincipal || 0) : 0
  return splitAguaLigacao({
    totalDom,
    semLigacao: null,
    usaComoPrincipal: usa,
    outrasFormas: outra
  })
}
function splitAguaLigacao (options: {
  totalDom: number | null
  semLigacao: number | null
  usaComoPrincipal: number | null
  outrasFormas: number
}): {
  total: number
  possuiLigacao: number
  usaPrincipal: number
  naoUsaPrincipal: number
  sem: number
} {
  const usaPrincipal = Math.max(0, options.usaComoPrincipal || 0)
  const naoUsaPrincipal = Math.max(0, options.outrasFormas)
  const possuiLigacao = usaPrincipal + naoUsaPrincipal
  const declared = options.totalDom
  const hasSem = options.semLigacao != null
  const semGiven = Math.max(0, options.semLigacao || 0)
  const partsTotal = possuiLigacao + (hasSem ? semGiven : 0)
  const total = declared != null && declared > partsTotal
    ? declared
    : (hasSem ? partsTotal : Math.max(declared || 0, possuiLigacao))
  const sem = hasSem ? semGiven : Math.max(0, total - possuiLigacao)
  return { total, possuiLigacao, usaPrincipal, naoUsaPrincipal, sem }
}

function emptySummary (
  kind: 'agua' | 'esgoto',
  scopeLabel: string,
  status: 'loading' | 'error' = 'loading',
  message?: string
): SaneamentoSummary {
  const isAgua = kind === 'agua'
  const placeholderMetrics: SaneamentoMetric[] = isAgua
    ? [
        { id: 'usa-rede', label: AA_USA_REDE_LABEL, value: null, percent: null, color: AA_COLORS.rede },
        { id: 'nao-usa-rede', label: AA_NAO_USA_REDE_LABEL, value: null, percent: null, color: AA_COLORS.poco }
      ]
    : [
        { id: 'usa-rede', label: ESG_USA_REDE_LABEL, value: null, percent: null, color: ESG_COLORS.rede },
        { id: 'nao-usa-rede', label: ESG_NAO_USA_REDE_LABEL, value: null, percent: null, color: ESG_COLORS.fossa }
      ]

  return {
    title: isAgua ? 'Abastecimento de Água' : 'Esgotamento Sanitário',
    scopeLabel,
    highlightLabel: isAgua ? AA_HIGHLIGHT_LABEL : ESG_HIGHLIGHT_LABEL,
    highlightValue: null,
    highlightPercent: null,
    secondaryLabel: isAgua ? AA_SECONDARY_LABEL : ESG_SECONDARY_LABEL,
    secondaryValue: null,
    secondaryPercent: null,
    embasaLabel: isAgua
      ? 'Mun. atendidos Embasa (água)'
      : 'Mun. atendidos Embasa (esgoto)',
    embasaValue: null,
    embasaText: null,
    metrics: placeholderMetrics,
    status,
    message,
    source: SANEAMENTO_SOURCE
  }
}

function buildAguaFromBahia (attrs: Record<string, any>, scopeLabel: string): SaneamentoSummary {
  const sem = n(attrs.sem_rede_geral)
  const outrasFormas =
    (n(attrs.poco_p) || 0) +
    (n(attrs.poco_raso) || 0) +
    (n(attrs.a_chuva) || 0) +
    (n(attrs.fonte_nscnt_mina) || 0) +
    (n(attrs.rios_acudes) || 0) +
    (n(attrs.carro_pipa) || 0) +
    (n(attrs.outros_agua) || 0)
  const split = splitAguaLigacao({
    totalDom: n(attrs.aba_total) ?? n(attrs.aa_total) ?? n(attrs.a_tot),
    semLigacao: sem,
    usaComoPrincipal: n(attrs.rd_geral_a) ?? n(attrs.aba_lrg) ?? n(attrs.aa_l_r_g),
    outrasFormas
  })

  return {
    title: 'Abastecimento de Água',
    scopeLabel,
    highlightLabel: AA_HIGHLIGHT_LABEL,
    highlightValue: split.possuiLigacao,
    highlightPercent: pct(split.possuiLigacao, split.total),
    secondaryLabel: AA_SECONDARY_LABEL,
    secondaryValue: split.sem,
    secondaryPercent: pct(split.sem, split.total),
    embasaLabel: 'Mun. atendidos Embasa (água)',
    embasaValue: n(attrs.mun_at_embasa_aa),
    metrics: [
      {
        id: 'usa-rede',
        label: AA_USA_REDE_LABEL,
        value: split.usaPrincipal,
        percent: pct(split.usaPrincipal, split.possuiLigacao),
        color: AA_COLORS.rede
      },
      {
        id: 'nao-usa-rede',
        label: AA_NAO_USA_REDE_LABEL,
        value: split.naoUsaPrincipal,
        percent: pct(split.naoUsaPrincipal, split.possuiLigacao),
        color: AA_COLORS.poco
      }
    ],
    status: 'ok',
    source: SANEAMENTO_SOURCE
  }
}

function buildEsgotoFromBahia (attrs: Record<string, any>, scopeLabel: string): SaneamentoSummary {
  const ligacao = esgotoLigacaoFromAttrs(attrs)
  const split = buildEsgotoSplit(
    ligacao.usaPrincipal,
    ligacao.naoUsaPrincipal,
    ligacao.totalDom,
    n(attrs.rede_esgoto) ?? n(attrs.esg_rrpflg)
  )
  const semBanheiro = ligacao.semBanheiro
  const baseTotal = split.total || ligacao.totalDom

  return {
    title: 'Esgotamento Sanitário',
    scopeLabel,
    highlightLabel: ESG_HIGHLIGHT_LABEL,
    highlightValue: split.possuiLigacao,
    highlightPercent: pct(split.possuiLigacao, split.total),
    secondaryLabel: ESG_SECONDARY_LABEL,
    secondaryValue: semBanheiro,
    secondaryPercent: pct(semBanheiro, baseTotal),
    embasaLabel: 'Mun. atendidos Embasa (esgoto)',
    embasaValue: n(attrs.mun_at_embasa_e),
    metrics: [
      {
        id: 'usa-rede',
        label: ESG_USA_REDE_LABEL,
        value: split.usaPrincipal,
        percent: pct(split.usaPrincipal, split.possuiLigacao),
        color: ESG_COLORS.rede
      },
      {
        id: 'nao-usa-rede',
        label: ESG_NAO_USA_REDE_LABEL,
        value: split.naoUsaPrincipal,
        percent: pct(split.naoUsaPrincipal, split.possuiLigacao),
        color: ESG_COLORS.fossa
      }
    ],
    status: 'ok',
    source: SANEAMENTO_SOURCE
  }
}

function buildAguaFromMunStats (
  stats: Record<string, any>,
  scopeLabel: string,
  filterType: DashboardFilter['type'] = 'all'
): SaneamentoSummary {
  const sem = n(stats.a_sem)
  const outrasFormas =
    (n(stats.a_pocart) || 0) +
    (n(stats.a_pocfre) || 0) +
    (n(stats.a_font) || 0) +
    (n(stats.a_car) || 0) +
    (n(stats.a_chu) || 0) +
    (n(stats.a_rio) || 0) +
    (n(stats.a_out) || 0)
  const split = splitAguaLigacao({
    totalDom: n(stats.a_tot),
    semLigacao: sem,
    usaComoPrincipal: n(stats.a_rede),
    outrasFormas
  })
  const embasaCount = n(stats.embasa_aa)
  const isMunicipio = filterType === 'municipio'
  const served = (embasaCount || 0) > 0
  const embasaLabel = isMunicipio
    ? 'Embasa (água)'
    : filterType === 'territorio'
      ? 'Mun. Embasa no território'
      : 'Mun. atendidos Embasa (água)'

  return {
    title: 'Abastecimento de Água',
    scopeLabel,
    highlightLabel: AA_HIGHLIGHT_LABEL,
    highlightValue: split.possuiLigacao,
    highlightPercent: pct(split.possuiLigacao, split.total),
    secondaryLabel: AA_SECONDARY_LABEL,
    secondaryValue: split.sem,
    secondaryPercent: pct(split.sem, split.total),
    embasaLabel,
    embasaValue: isMunicipio ? (served ? 1 : 0) : embasaCount,
    embasaText: isMunicipio ? (served ? 'Atendido' : 'Não atendido') : null,
    metrics: [
      {
        id: 'usa-rede',
        label: AA_USA_REDE_LABEL,
        value: split.usaPrincipal,
        percent: pct(split.usaPrincipal, split.possuiLigacao),
        color: AA_COLORS.rede
      },
      {
        id: 'nao-usa-rede',
        label: AA_NAO_USA_REDE_LABEL,
        value: split.naoUsaPrincipal,
        percent: pct(split.naoUsaPrincipal, split.possuiLigacao),
        color: AA_COLORS.poco
      }
    ],
    status: 'ok',
    source: SANEAMENTO_SOURCE
  }
}

function buildEsgotoFromMunStats (
  stats: Record<string, any>,
  scopeLabel: string,
  filterType: DashboardFilter['type']
): SaneamentoSummary {
  const split = buildEsgotoSplit(
    n(stats.e_rede_pluvial),
    n(stats.e_fossa_ligada),
    n(stats.e_tot),
    n(stats.e_rede)
  )
  const semBanheiro = n(stats.e_sem)
  const baseTotal = n(stats.e_tot) || split.total
  const embasaCount = n(stats.embasa_e)
  const isMunicipio = filterType === 'municipio'
  const served = (embasaCount || 0) > 0
  const embasaLabel = isMunicipio
    ? 'Embasa (esgoto)'
    : filterType === 'territorio'
      ? 'Mun. Embasa no território'
      : 'Mun. atendidos Embasa (esgoto)'

  return {
    title: 'Esgotamento Sanitário',
    scopeLabel,
    highlightLabel: ESG_HIGHLIGHT_LABEL,
    highlightValue: split.possuiLigacao,
    highlightPercent: pct(split.possuiLigacao, baseTotal),
    secondaryLabel: ESG_SECONDARY_LABEL,
    secondaryValue: semBanheiro,
    secondaryPercent: pct(semBanheiro, baseTotal),
    embasaLabel,
    embasaValue: isMunicipio ? (served ? 1 : 0) : embasaCount,
    embasaText: isMunicipio ? (served ? 'Atendido' : 'Não atendido') : null,
    metrics: [
      {
        id: 'usa-rede',
        label: ESG_USA_REDE_LABEL,
        value: split.usaPrincipal,
        percent: pct(split.usaPrincipal, split.possuiLigacao),
        color: ESG_COLORS.rede
      },
      {
        id: 'nao-usa-rede',
        label: ESG_NAO_USA_REDE_LABEL,
        value: split.naoUsaPrincipal,
        percent: pct(split.naoUsaPrincipal, split.possuiLigacao),
        color: ESG_COLORS.fossa
      }
    ],
    status: 'ok',
    source: SANEAMENTO_SOURCE
  }
}

function numFrom (attrs: Record<string, any>, ...keys: string[]): number | null {
  for (const key of keys) {
    if (!key) continue
    if (attrs[key] != null && attrs[key] !== '') return n(attrs[key])
    const lower = key.toLowerCase()
    if (attrs[lower] != null && attrs[lower] !== '') return n(attrs[lower])
  }
  return null
}

function statsFromAttributes (attrs: Record<string, any>): Record<string, any> | null {
  const normalized: Record<string, any> = {}
  for (const [key, value] of Object.entries(attrs || {})) {
    normalized[key] = value
    normalized[key.toLowerCase()] = value
  }

  const stats = {
    a_tot: numFrom(normalized, 'aba_total', 'aa_total', 'a_tot', 'aa_tot'),
    a_rede: numFrom(normalized, 'aba_lrg', 'aa_l_r_g', 'a_rede', 'rd_geral_a'),
    a_pocart: numFrom(normalized, 'aba_ppa', 'aa_pp_a', 'a_pocart', 'poco_p'),
    a_pocfre: numFrom(normalized, 'aba_prfc', 'aa_pr_f_c', 'a_pocfre', 'poco_raso'),
    a_font: numFrom(normalized, 'aba_fnm', 'aa_f_n_m', 'a_font', 'fonte_nscnt_mina'),
    a_car: numFrom(normalized, 'aba_cp', 'aa_cp', 'a_car', 'carro_pipa'),
    a_chu: numFrom(normalized, 'aba_aca', 'aa_aca', 'a_chu', 'a_chuva'),
    a_rio: numFrom(normalized, 'aba_racli', 'aa_racli', 'a_rio', 'rios_acudes'),
    a_out: numFrom(normalized, 'aba_outr', 'aa_outra', 'a_out', 'outros_agua'),
    a_sem: numFrom(normalized, 'aa_npl_rg', 'a_sem', 'sem_rede_geral'),
    e_tot: numFrom(normalized, 'esg_total', 'e_tot'),
    e_rede_pluvial: numFrom(normalized, 'esg_rede_geral_ou_pluvia', 'esg_rede_geral_ou_pluvial', 'e_rede_pluvial'),
    e_fossa_ligada: numFrom(normalized, 'esg_fossa_septica_ou_fossa_filtro_ligada_a_rede', 'e_fossa_ligada'),
    e_rede: numFrom(normalized, 'esg_rrpflg', 'e_rede', 'rede_esgoto'),
    e_fossasr: numFrom(normalized, 'esg_fffnlg', 'e_fossasr', 'fossa_septica'),
    e_fossab: numFrom(normalized, 'esg_fr_b', 'e_fossab', 'fossa_rudimentar'),
    e_vala: numFrom(normalized, 'esg_vala', 'e_vala', 'vala'),
    e_rio: numFrom(normalized, 'esg_r_l_cm', 'e_rio', 'rio_lago_mar'),
    e_outra: numFrom(normalized, 'esg_outr', 'e_outra', 'outra_forma'),
    e_sem: numFrom(normalized, 'esg_n_t_bs', 'e_sem', 'sem_banheiro'),
    embasa_aa: numFrom(normalized, 'mun_emb_aba', 'embasa_aa', 'mun_at_embasa_aa'),
    embasa_e: numFrom(normalized, 'mun_emb_esg', 'embasa_e', 'mun_at_embasa_e')
  }

  if (stats.e_rede_pluvial == null) {
    stats.e_rede_pluvial = numFromKeyPattern(normalized, ['esg_rede_geral_ou_pluvia', 'esg_rede_geral_ou_pluvial'])
  }
  if (stats.e_fossa_ligada == null) {
    stats.e_fossa_ligada = numFromKeyPattern(normalized, ['fossa_filtro_ligada'], ['nao_ligada'])
  }

  if (stats.a_rede == null && stats.e_rede == null && stats.e_rede_pluvial == null && stats.a_tot == null && stats.e_tot == null) {
    return null
  }
  return stats
}

async function querySemiaridoAggregates (layer: any): Promise<Record<string, any> | null> {
  if (!layer || typeof layer.queryFeatures !== 'function') return null
  await layer.load?.()
  const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
  query.where = '1=1'
  query.returnGeometry = false
  query.outFields = ['*']
  query.num = 1
  const result = await layer.queryFeatures(query)
  const attrs = result?.features?.[0]?.attributes
  if (!attrs) return null
  return statsFromAttributes(attrs)
}

async function sumFieldsClientSide (
  layer: any,
  where: string,
  items: Array<{ out: string, field: string }>,
  geometry: any = null
): Promise<Record<string, any>> {
  const out: Record<string, any> = { mun_count: 0 }
  for (const item of items) out[item.out] = 0

  let offset = 0
  const pageSize = 1000
  const outFields = Array.from(new Set(items.map((item) => item.field)))

  while (true) {
    const query = typeof layer.createQuery === 'function' ? layer.createQuery() : {}
    query.where = where || '1=1'
    query.returnGeometry = false
    query.outFields = outFields
    query.num = pageSize
    query.start = offset
    if (geometry) {
      query.geometry = geometry
      query.spatialRelationship = 'intersects'
    }
    const result = await layer.queryFeatures(query)
    const page = result?.features || []
    for (const feature of page) {
      out.mun_count += 1
      const attrs = feature?.attributes || {}
      for (const item of items) {
        const value = Number(attrs[item.field])
        if (Number.isFinite(value)) out[item.out] += value
      }
    }
    if (page.length < pageSize) break
    offset += page.length
    if (offset > 5000) break
  }

  return out
}

async function queryMunSums (layer: any, filter: DashboardFilter): Promise<Record<string, any>> {
  await layer.load()
  const available = new Map(
    (layer.fields || []).map((field: any) => [
      String(field?.name || '').toLowerCase(),
      String(field?.name || '')
    ])
  )
  const pick = (...candidates: string[]) => {
    for (const candidate of candidates) {
      const match = available.get(candidate.toLowerCase())
      if (match) return match
    }
    return null
  }
  const pickIncludes = (...needles: string[]) => {
    const exact = pick(...needles)
    if (exact) return exact
    const entries = Array.from(available.entries()) as Array<[string, string]>
    for (const needle of needles) {
      const hit = entries.find(([lower]) => fieldMatchesNeedle(lower, needle))
      if (hit) return hit[1]
    }
    return null
  }

  const statisticMap: Array<{ out: string, field: string | null }> = [
    { out: 'a_tot', field: pick('aa_total', 'a_tot') },
    { out: 'a_rede', field: pick('aa_l_r_g', 'a_rede') },
    { out: 'a_pocart', field: pick('aa_pp_a', 'a_pocart') },
    { out: 'a_pocfre', field: pick('aa_pr_f_c', 'a_pocfre') },
    { out: 'a_font', field: pick('aa_f_n_m', 'a_font') },
    { out: 'a_car', field: pick('aa_cp', 'a_car') },
    { out: 'a_chu', field: pick('aa_aca', 'a_chu') },
    { out: 'a_rio', field: pick('aa_racli', 'a_rio') },
    { out: 'a_out', field: pick('aa_outra', 'a_out') },
    { out: 'a_sem', field: pick('aa_npl_rg', 'a_sem') },
    { out: 'e_tot', field: pick('esg_total', 'e_tot') },
    { out: 'e_rede_pluvial', field: pick('esg_rede_geral_ou_pluvia', 'esg_rede_geral_ou_pluvial')
      || pickLayerFieldByTokens(available, ['pluvia'], ['fossa', 'agua', 'rrpflg', 'l_r_g']) },
    { out: 'e_fossa_ligada', field: pick(
      'esg_fossa_septica_ou_fossa_filtro_ligada_a_rede',
      'esg_fossa_septica_ou_fossa_filtro_ligada',
      'esg_fossa_septica_ou_fossa_filt'
    ) || pickLayerFieldByTokens(available, ['fossa', 'ligada'], ['nao', 'rrpflg', 'rudiment', 'pluvia']) },
    { out: 'e_rede', field: pick('esg_rrpflg', 'e_rede') },
    { out: 'e_fossasr', field: pick('esg_fffnlg', 'e_fossasr') },
    { out: 'e_fossab', field: pick('esg_fr_b', 'e_fossab') },
    { out: 'e_sem', field: pick('esg_n_t_bs', 'e_sem') }
  ]
  const existing = statisticMap.filter((item): item is { out: string, field: string } => Boolean(item.field))
  if (!existing.some((item) => ['a_rede', 'e_rede', 'e_rede_pluvial', 'e_fossa_ligada'].includes(item.out))) {
    throw new Error('Indicadores de saneamento indisponíveis para este recorte')
  }

  const where = filter.munWhere || '1=1'
  const geometry = filter.geometry && !filter.skipMunicipalGeometry ? filter.geometry : null
  const existingFields = existing as Array<{ out: string, field: string }>

  const runStats = async (statsWhere: string, statsGeometry: any) => {
    const query = layer.createQuery()
    query.where = statsWhere
    query.returnGeometry = false
    query.outStatistics = existingFields.map((item) => ({
      statisticType: 'sum',
      onStatisticField: item.field,
      outStatisticFieldName: item.out
    }))
    query.outStatistics.push({
      statisticType: 'count',
      onStatisticField: layer.objectIdField || 'objectid',
      outStatisticFieldName: 'mun_count'
    })
    if (statsGeometry) {
      query.geometry = statsGeometry
      query.spatialRelationship = 'intersects'
    }
    const result = await layer.queryFeatures(query)
    const attrs = result.features?.[0]?.attributes || {}
    const normalized: Record<string, any> = {}
    for (const [key, value] of Object.entries(attrs)) {
      normalized[key] = value
      normalized[key.toLowerCase()] = value
    }
    return normalized
  }

  let normalized: Record<string, any>
  try {
    normalized = await runStats(where, geometry)
  } catch (error) {
    console.warn('[saneamento] outStatistics falhou, tentando alternativa:', error)
    try {
      if (filter.geometry) {
        normalized = await runStats('1=1', filter.geometry)
      } else {
        throw error
      }
    } catch (spatialError) {
      console.warn('[saneamento] soma espacial falhou, somando no cliente:', spatialError)
      try {
        normalized = await sumFieldsClientSide(layer, where, existingFields, geometry)
      } catch (clientError) {
        if (!filter.geometry) throw clientError
        normalized = await sumFieldsClientSide(layer, '1=1', existingFields, filter.geometry)
      }
    }
  }

  const [embasaAa, embasaE] = await Promise.all([
    countAguaEmbasa(layer, filter).catch(() => null),
    countEsgotoEmbasa(layer, filter).catch(() => null)
  ])
  normalized.embasa_aa = embasaAa
  normalized.embasa_e = embasaE
  const pluvial = n(normalized.e_rede_pluvial)
  const fossaLigada = n(normalized.e_fossa_ligada)
  const combined = n(normalized.e_rede)
  if ((pluvial == null || pluvial === 0) && fossaLigada != null && combined != null && fossaLigada === combined) {
    normalized.e_fossa_ligada = null
  }
  return normalized
}

export async function loadSaneamentoSummaries (
  webMap: any,
  filter: DashboardFilter
): Promise<{ agua: SaneamentoSummary, esgoto: SaneamentoSummary }> {
  const scopeLabel = filter?.type === 'all' ? 'Estado da Bahia' : filter.label

  try {
    if (!filter || filter.type === 'all' || filter.type === 'territorio' || filter.type === 'municipio' || filter.type === 'semiarido') {
      const munLayer = findMunicipioLayer(webMap)
        || findLayer(webMap, { layerTitle: 'PDA_Indicadores_Censo_2022' })
        || findLayer(webMap, { layerTitle: 'DPA_Indicadores_Censo_2022' })

      if (filter?.type === 'semiarido' && munLayer && typeof munLayer.queryFeatures === 'function') {
        try {
          const stats = await queryMunSums(munLayer, filter)
          if (stats && (n(stats.a_tot) != null || n(stats.a_rede) != null || n(stats.e_tot) != null)) {
            return {
              agua: buildAguaFromMunStats(stats, scopeLabel, filter.type),
              esgoto: buildEsgotoFromMunStats(stats, scopeLabel, filter.type)
            }
          }
        } catch (error) {
          console.warn('[sihs-dash] DPA do semiárido falhou, tentando a camada da região:', error)
        }
      }

      if (filter?.type === 'semiarido') {
        const record = await loadSemiaridoRecord(webMap)
        const stats = record ? saneamentoStatsFromRecord(record) : null
        if (stats && (n(stats.e_rede_pluvial) != null || n(stats.e_fossa_ligada) != null || n(stats.a_tot) != null)) {
          return {
            agua: buildAguaFromMunStats(stats, scopeLabel, filter.type),
            esgoto: buildEsgotoFromMunStats(stats, scopeLabel, filter.type)
          }
        }
      }

      if (munLayer && typeof munLayer.queryFeatures === 'function') {
        const stats = await queryMunSums(munLayer, filter || {
          type: 'all',
          label: scopeLabel,
          munWhere: '1=1'
        } as DashboardFilter)
        return {
          agua: buildAguaFromMunStats(stats, scopeLabel, filter?.type || 'all'),
          esgoto: buildEsgotoFromMunStats(stats, scopeLabel, filter?.type || 'all')
        }
      }
    }

    if (!filter || filter.type === 'all') {
      const layer = findLayer(webMap, { layerTitle: 'Limite Bahia' })
      if (!layer || typeof layer.queryFeatures !== 'function') {
        throw new Error('Camada Limite Bahia não encontrada')
      }
      await layer.load()
      const result = await layer.queryFeatures({
        where: '1=1',
        outFields: ['*'],
        returnGeometry: false,
        num: 1
      })
      const attrs = result.features?.[0]?.attributes
      if (!attrs) throw new Error('Sem atributos em Limite Bahia')
      return {
        agua: buildAguaFromBahia(attrs, scopeLabel),
        esgoto: buildEsgotoFromBahia(attrs, scopeLabel)
      }
    }

    if (filter.type === 'semiarido') {
      const record = await loadSemiaridoRecord(webMap)
      if (!record) {
        throw new Error('Camada Região Semiárida_BA não encontrada')
      }
      const stats = saneamentoStatsFromRecord(record)
      if (stats) {
        return {
          agua: buildAguaFromMunStats(stats, scopeLabel, filter.type),
          esgoto: buildEsgotoFromMunStats(stats, scopeLabel, filter.type)
        }
      }
      return {
        agua: buildAguaFromBahia(record.attrs, scopeLabel),
        esgoto: buildEsgotoFromBahia(record.attrs, scopeLabel)
      }
    }

    const munLayer = findMunicipioLayer(webMap)
      || findLayer(webMap, { layerTitle: 'PDA_Indicadores_Censo_2022' })
      || findLayer(webMap, { layerTitle: 'DPA_Indicadores_Censo_2022' })
    if (!munLayer || typeof munLayer.queryFeatures !== 'function') {
      throw new Error('Camada PDA_Indicadores_Censo_2022 não encontrada')
    }
    const stats = await queryMunSums(munLayer, filter)
    return {
      agua: buildAguaFromMunStats(stats, scopeLabel, filter.type),
      esgoto: buildEsgotoFromMunStats(stats, scopeLabel, filter.type)
    }
  } catch (error: any) {
    return {
      agua: emptySummary('agua', scopeLabel, 'error', error?.message || 'Falha ao carregar'),
      esgoto: emptySummary('esgoto', scopeLabel, 'error', error?.message || 'Falha ao carregar')
    }
  }
}

export function loadingSummaries (scopeLabel = 'Estado da Bahia'): {
  agua: SaneamentoSummary
  esgoto: SaneamentoSummary
} {
  return {
    agua: emptySummary('agua', scopeLabel, 'loading'),
    esgoto: emptySummary('esgoto', scopeLabel, 'loading')
  }
}
