import { findLayer } from './layers'
import { withoutDefinitionExpression } from './map'
import { formatReservatorioPorte } from './charts'

export interface PopupRow {
  label: string
  value: string
}

export interface PopupFieldSpec {
  label: string
  candidates: string[]
}

export const POCO_POPUP_FIELDS: PopupFieldSpec[] = [
  { label: 'Data da perfuração', candidates: ['data_perfuracao', 'dt_perfuracao', 'data_perf', 'dt_perf', 'dataperf'] },
  { label: 'Profundidade', candidates: ['profundidade', 'profund', 'prof_m', 'prof'] },
  { label: 'Vazão', candidates: ['vazao', 'vazao_m3h', 'vazao_est', 'q_vazao'] },
  { label: 'Aquífero', candidates: ['aquifero', 'aq_ifero'] },
  { label: 'Finalidade', candidates: ['finalidade', 'finalid'] },
  { label: 'Condição', candidates: ['condicao', 'condicao_poco'] },
  { label: 'Estado qualitativo', candidates: ['estado_qualitativo', 'estado_qual', 'est_qual'] },
  { label: 'Data da coleta', candidates: ['data_coleta', 'dt_coleta', 'dat_coleta'] },
  { label: 'Data da análise', candidates: ['data_analise', 'dt_analise', 'dat_analise', 'data_anali'] }
]

export const SISTEMA_POPUP_FIELDS: PopupFieldSpec[] = [
  { label: 'Tipo de sistema', candidates: ['tipo_sistema', 'tipo_sist'] },
  { label: 'Data', candidates: ['data', 'dt', 'data_cadastro', 'data_impl', 'dt_impl', 'data_sistema'] },
  { label: 'Captação', candidates: ['captacao', 'tipo_captacao'] }
]

export const RESERVATORIO_POPUP_FIELDS: PopupFieldSpec[] = [
  { label: 'Empreendedor', candidates: ['empreendedor', 'nome_empreendedor', 'nm_empr'] },
  { label: 'Tipo empreendedor', candidates: ['tipo_empreendedor', 'tipo_empr', 'tp_empr'] },
  { label: 'Entidade fiscalizadora', candidates: ['entidade_fiscalizadora', 'ent_fiscal', 'org_fiscal', 'fiscalizador'] },
  { label: 'Uso principal', candidates: ['uso_princ', 'uso_principal'] },
  { label: 'Uso complementar', candidates: ['uso_compl', 'uso_complementar'] },
  { label: 'Categoria de risco', candidates: ['categoria_risco', 'cat_risco', 'clas_risco', 'classe_risco'] },
  { label: 'Curso d\'água', candidates: ['curso_dagua', 'curso_d_agua', 'nome_rio', 'rio'] },
  { label: 'Fase de vida', candidates: ['fase_vida', 'fase'] },
  { label: 'Altura máxima fundação', candidates: ['altura_max_fundacao', 'alt_max_fund', 'alt_max_f', 'altura_mf'] },
  { label: 'Altura máxima nível terreno', candidates: ['altura_max_terreno', 'alt_max_terr', 'alt_max_t', 'altura_mt'] },
  { label: 'Capacidade total', candidates: ['capacidade_t', 'capacidade_total', 'cap_total', 'volume', 'vol_total'] },
  { label: 'Comprimento do coroamento', candidates: ['comprimento_coroamento', 'comp_coroamento', 'comp_coro'] },
  { label: 'Tipo do coroamento', candidates: ['tipo_coroamento', 'tipo_coro'] },
  { label: 'Tipo de material', candidates: ['tipo_material', 'tipo_mat', 'material'] },
  { label: 'Domínio', candidates: ['dominio', 'dominio_barragem'] },
  { label: 'Região hidrográfica', candidates: ['regiao_hidrografica', 'regiao_hidro', 'rh', 'bacia'] }
]

export const SETOR_POPUP_FIELDS: PopupFieldSpec[] = [
  { label: 'Situação do setor censitário', candidates: ['sit_setor', 'situacao_setor', 'cd_sit', 'sit', 'nm_sit'] },
  { label: 'Situação detalhada do setor censitário', candidates: ['sit_detalhada', 'situacao_detalhada', 'sit_det', 'cd_sit_det'] },
  { label: 'Tipo de SC', candidates: ['tipo_sc', 'nm_tipo', 'tipo_setor', 'tipo'] },
  { label: 'Área', candidates: ['area', 'area_km2', 'ar_km2', 'a_km2'] },
  { label: 'Distrito', candidates: ['distrito', 'nm_dist', 'nm_distrito'] },
  { label: 'População', candidates: ['estimativa_pop_2025', 'pop_est_2025', 'pop_2025', 'populacao', 'pop', 'total', 'v0001', 'pessoas'] },
  { label: 'População indígena', candidates: ['pessoa_indigena', 'pop_indigena', 'indigena'] },
  { label: 'População quilombola', candidates: ['pessoa_quilombola', 'pop_quilombola', 'quilombola'] },
  { label: 'Total de domicílios', candidates: ['domicilios', 'total_domicilios', 'tot_dom', 'domicilios_recenseados', 'v0005'] }
]

export function popupFieldsForAsset (type: 'pocos' | 'sistemas' | 'reservatorios' | 'setores'): PopupFieldSpec[] {
  if (type === 'pocos') return POCO_POPUP_FIELDS
  if (type === 'sistemas') return SISTEMA_POPUP_FIELDS
  if (type === 'reservatorios') return RESERVATORIO_POPUP_FIELDS
  return SETOR_POPUP_FIELDS
}

function normalizeLabel (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
}

function isEmpty (value: any): boolean {
  if (value == null) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

function formatDate (value: any): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString('pt-BR')
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN
    if (Number.isFinite(ms)) {
      const date = new Date(ms)
      if (!Number.isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2100) {
        return date.toLocaleDateString('pt-BR')
      }
    }
  }
  const text = String(value).trim()
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00`)
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('pt-BR')
  }
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return text
  return null
}

function formatNumber (value: number): string {
  const abs = Math.abs(value)
  const decimals = abs >= 100 || Number.isInteger(value) ? 0 : abs >= 10 ? 1 : 2
  return new Intl.NumberFormat('pt-BR', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0
  }).format(value)
}

function domainLabel (layer: any, fieldName: string, value: any): any {
  try {
    const field = typeof layer.getField === 'function'
      ? layer.getField(fieldName)
      : (layer.fields || []).find((item: any) => String(item?.name) === fieldName)
    const coded = field?.domain?.codedValues as Array<{ code: any, name: string }> | undefined
    if (!coded?.length) return value
    const match = coded.find((item) => String(item.code) === String(value))
    return match?.name || value
  } catch {
    return value
  }
}

function formatValue (layer: any, fieldName: string, raw: any): string {
  const value = domainLabel(layer, fieldName, raw)
  if (isEmpty(value)) return '—'
  const asDate = formatDate(value)
  if (asDate) return asDate
  if (typeof value === 'number' && Number.isFinite(value)) return formatNumber(value)
  const text = String(value).trim()
  return text || '—'
}

function labelsClose (left: string, right: string): boolean {
  if (!left || !right) return false
  if (left === right) return true
  const leftTokens = left.split(' ').filter((token) => token.length > 2)
  const rightTokens = right.split(' ').filter((token) => token.length > 2)
  if (!leftTokens.length || !rightTokens.length) return false
  const overlap = leftTokens.filter((token) => rightTokens.includes(token)).length
  return overlap >= Math.min(leftTokens.length, rightTokens.length) && overlap >= 2
}

function pickFieldName (
  layer: any,
  attrs: Record<string, any>,
  spec: PopupFieldSpec
): string | null {
  const fields = layer?.fields || []
  const attrKeys = Object.keys(attrs || {})
  const byLower = new Map<string, string>()
  for (const key of attrKeys) byLower.set(key.toLowerCase(), key)
  for (const field of fields) {
    if (field?.name) byLower.set(String(field.name).toLowerCase(), field.name)
  }

  for (const candidate of spec.candidates) {
    const actual = byLower.get(candidate.toLowerCase())
    if (actual) return actual
  }

  const wanted = normalizeLabel(spec.label)
  for (const field of fields) {
    const alias = normalizeLabel(field?.alias || '')
    const name = normalizeLabel(field?.name || '')
    if (labelsClose(alias, wanted) || labelsClose(name, wanted)) {
      return field.name
    }
  }

  return null
}

export async function loadPopupRows (
  webMap: any,
  options: {
    layerTitle: string
    layerId?: string
    where?: string
    objectId?: number
    fields: PopupFieldSpec[]
  }
): Promise<PopupRow[]> {
  const layer = findLayer(webMap, { layerId: options.layerId, layerTitle: options.layerTitle })
  if (!layer || typeof layer.queryFeatures !== 'function') {
    return options.fields.map((field) => ({ label: field.label, value: '—' }))
  }

  await layer.load?.()

  const result = await withoutDefinitionExpression(layer, async () => {
    const query = layer.createQuery()
    if (options.objectId != null && Number.isFinite(options.objectId)) {
      query.objectIds = [Number(options.objectId)]
    } else {
      query.where = options.where || '1=1'
    }
    query.returnGeometry = false
    query.outFields = ['*']
    query.num = 1
    return layer.queryFeatures(query)
  })

  const attrs = result?.features?.[0]?.attributes || {}

  const rows = options.fields.map((spec) => {
    const fieldName = pickFieldName(layer, attrs, spec)
    if (!fieldName) return { label: spec.label, value: '—' }
    const raw = attrs[fieldName] ?? attrs[fieldName.toLowerCase()]
    const value = formatValue(layer, fieldName, raw)
    return { label: spec.label, value: value || '—' }
  })

  const capacidadeSpec = options.fields.find((spec) => spec.label === 'Capacidade total')
  if (capacidadeSpec) {
    const volumeField = pickFieldName(layer, attrs, capacidadeSpec)
    const raw = volumeField
      ? (attrs[volumeField] ?? attrs[volumeField.toLowerCase()])
      : null
    const porteRow = { label: 'Porte', value: formatReservatorioPorte(raw) }
    const idx = rows.findIndex((row) => row.label === 'Capacidade total')
    if (idx >= 0) rows.splice(idx + 1, 0, porteRow)
    else rows.unshift(porteRow)
  }

  return rows
}
