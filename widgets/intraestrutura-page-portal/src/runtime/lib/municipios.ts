export const MUN_LAYER_TITLE = 'PDA_Indicadores_Censo_2022'
export const PAGE_SIZE = 7

export const MUN_FIELDS = {
  name: 'nome_do_municipio',
  territory: 'territorio_de_indentidade',
  semiarido: 'região_do_semiarida',
  population: 'pop_est_2026'
} as const

const MUN_FIELD_CANDIDATES = {
  name: ['nome_do_municipio', 'nm_mun_1', 'nm_mun', 'municipio', 'nome'],
  territory: ['territorio_de_indentidade', 'territorio_de_identidade', 'nm_ti', 'territorio'],
  semiarido: ['região_do_semiarida', 'regiao_do_semiarida', 'semiarido'],
  population: [
    'pop_est_2026',
    'estimativa_pop_2026',
    'estimativa_pop2026',
    'populacao_estimada_2026',
    'pop_2026',
    'populacao_estimada',
    'estimativa_pop_2025',
    'pop_est_2025',
    'estimativa_pop2025',
    'populacao_estimada_2025',
    'pop_2025',
    'população__2022_',
    'populacao__2022_',
    'pop_2022',
    'total_1'
  ]
} as const

export interface MunicipioItem {
  name: string
  territory: string
  semiarido: string
  population: number | null
  forcedSemiarido?: boolean
}

interface SemiaridoExtraGroup {
  canonical: string
  aliases: string[]
}

/**
 * Municípios da região semiárida que não estão como SIM na camada
 * (278 no webmap vs 287 oficiais). Inclusão só no código, sem editar o webmap.
 */
export const SEMIARIDO_EXTRA_GROUPS: SemiaridoExtraGroup[] = [
  { canonical: 'São Desidério', aliases: ['sao desiderio', 'são desidério'] },
  { canonical: 'Correntina', aliases: ['correntina'] },
  { canonical: 'Jaborandi', aliases: ['jaborandi'] },
  { canonical: 'Catolândia', aliases: ['catolandia', 'catolândia'] },
  { canonical: 'Irará', aliases: ['irara', 'irará'] },
  { canonical: 'Coração de Maria', aliases: ['coracao de maria', 'coração de maria'] },
  {
    canonical: 'São Gonçalo dos Campos',
    aliases: [
      'sao goncalo dos campos',
      'são gonçalo dos campos',
      's.g. campos',
      'sg campos',
      's g campos'
    ]
  },
  { canonical: 'Litauna', aliases: ['litauna', 'litaúna', 'itauna', 'itaúna'] },
  {
    canonical: 'Dário Meira',
    aliases: ['dario meira', 'dário meira', 'dario mera', 'dário mera']
  }
]

function text (value: any): string {
  const raw = value == null ? '' : String(value).trim()
  return raw || '—'
}

function numberOrNull (value: any): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

export function escapeSqlString (value: string): string {
  return String(value ?? '').replace(/'/g, "''")
}

function sqlIdent (value: string): string {
  const name = String(value || '').trim()
  if (!name) return value
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
  return `"${name.replace(/"/g, '""')}"`
}

function normalizeKey (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

function pickLayerField (layer: any, candidates: readonly string[], fallback: string): string {
  const fields = (layer?.fields || []).map((field: any) => String(field?.name || '')).filter(Boolean)
  const byLower = new Map(fields.map((name: string) => [name.toLowerCase(), name]))
  const byNorm = new Map(fields.map((name: string) => [normalizeKey(name), name]))
  for (const candidate of candidates) {
    const exact = byLower.get(candidate.toLowerCase())
    if (exact) return exact
    const normalized = byNorm.get(normalizeKey(candidate))
    if (normalized) return normalized
  }
  return fallback
}

function pickPopulationField (layer: any, fallback: string): string {
  const exact = pickLayerField(layer, ['pop_est_2026', 'estimativa_pop_2026', 'populacao_estimada_2026', 'pop_2026'], '')
  if (exact) return exact
  const fields: any[] = layer?.fields || []
  const blob = (field: any) => `${normalizeKey(field?.name || '')} ${normalizeKey(field?.alias || '')}`
  const byYear = fields.find((field: any) => {
    const text = blob(field)
    return text.includes('2026') && (text.includes('pop') || text.includes('estimativ') || text.includes('populac'))
  })
  if (byYear?.name) return byYear.name
  return pickLayerField(layer, MUN_FIELD_CANDIDATES.population, fallback)
}

export function resolveMunFields (layer: any): typeof MUN_FIELDS {
  return {
    name: pickLayerField(layer, MUN_FIELD_CANDIDATES.name, MUN_FIELDS.name),
    territory: pickLayerField(layer, MUN_FIELD_CANDIDATES.territory, MUN_FIELDS.territory),
    semiarido: pickLayerField(layer, MUN_FIELD_CANDIDATES.semiarido, MUN_FIELDS.semiarido),
    population: pickPopulationField(layer, MUN_FIELDS.population)
  }
}

export function normalizeMunName (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function levenshtein (a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0))
  for (let i = 0; i < rows; i++) dp[i][0] = i
  for (let j = 0; j < cols; j++) dp[0][j] = j
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function matchesExtraGroup (name: string, group: SemiaridoExtraGroup): boolean {
  const normalized = normalizeMunName(name)
  if (!normalized) return false
  if (normalized === normalizeMunName(group.canonical)) return true
  if (group.aliases.includes(normalized)) return true
  if (normalized.includes('goncalo dos campos') && group.canonical === 'São Gonçalo dos Campos') {
    return true
  }
  return group.aliases.some((alias) => {
    const needle = normalizeMunName(alias)
    return needle.length >= 5 && (normalized.includes(needle) || needle.includes(normalized))
  })
}

export function isForcedSemiarido (name: string): boolean {
  return SEMIARIDO_EXTRA_GROUPS.some((group) => matchesExtraGroup(name, group))
}

export function resolveSemiaridoExtraNames (
  municipioNames: string[],
  fuzzyCandidates: string[] = []
): string[] {
  const remainingExact = [...municipioNames]
  const remainingFuzzy = [...fuzzyCandidates]
  const resolved: string[] = []

  for (const group of SEMIARIDO_EXTRA_GROUPS) {
    const exactIndex = remainingExact.findIndex((name) => matchesExtraGroup(name, group))
    if (exactIndex >= 0) {
      const name = remainingExact.splice(exactIndex, 1)[0]
      const fuzzyIndex = remainingFuzzy.findIndex((item) => normalizeMunName(item) === normalizeMunName(name))
      if (fuzzyIndex >= 0) remainingFuzzy.splice(fuzzyIndex, 1)
      resolved.push(name)
      continue
    }

    const allowFuzzy = group.canonical === 'Litauna'
    const target = normalizeMunName(group.canonical)
    let bestIndex = -1
    let bestDistance = 3
    if (allowFuzzy) {
      remainingFuzzy.forEach((name, index) => {
        const candidate = normalizeMunName(name)
        const distance = Math.min(
          levenshtein(target, candidate),
          ...group.aliases.map((alias) => levenshtein(normalizeMunName(alias), candidate))
        )
        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = index
        }
      })
    }

    if (bestIndex >= 0) {
      resolved.push(remainingFuzzy.splice(bestIndex, 1)[0])
    } else {
      resolved.push(group.canonical)
    }
  }

  return Array.from(new Set(resolved.filter(Boolean)))
}

export function semiaridoExtraWhere (nameField = MUN_FIELDS.name, extraNames?: string[]): string {
  const names = extraNames?.length
    ? extraNames
    : SEMIARIDO_EXTRA_GROUPS.flatMap((group) => [group.canonical, ...group.aliases])

  const unique = Array.from(new Set(names.map((name) => String(name || '').trim()).filter(Boolean)))
  if (!unique.length) return '1=0'

  const ident = sqlIdent(nameField)
  return unique
    .map((name) => `${ident} = '${escapeSqlString(name)}'`)
    .join(' OR ')
}

export function semiaridoSimWhere (nameField = MUN_FIELDS.name, extraNames?: string[], semiField = MUN_FIELDS.semiarido): string {
  const ident = sqlIdent(semiField)
  const flag = `(${ident} = 'SIM' OR ${ident} = 'Sim' OR ${ident} = 'sim')`
  const extras = semiaridoExtraWhere(nameField, extraNames)
  return extras === '1=0' ? flag : `(${flag} OR ${extras})`
}

export function formatPopulation (value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('pt-BR').format(value)
}

export function formatSemiarido (value: string): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
  if (normalized === 'SIM') return 'Sim'
  if (normalized === 'NAO' || normalized === 'NÃO') return 'Não'
  return value && value !== '—' ? value : 'Não'
}

export async function loadMunicipios (layer: any): Promise<MunicipioItem[]> {
  await layer.load()
  const fields = resolveMunFields(layer)

  const query = layer.createQuery()
  query.where = '1=1'
  query.returnGeometry = false
  query.outFields = [fields.name, fields.territory, fields.semiarido, fields.population]
  query.orderByFields = [`${sqlIdent(fields.name)} ASC`]
  query.num = 500

  const result = await layer.queryFeatures(query)
  const items = (result.features || []).map((feature: any) => {
    const attrs = feature.attributes || {}
    const name = text(attrs[fields.name])
    return {
      name,
      territory: text(attrs[fields.territory]),
      semiarido: formatSemiarido(text(attrs[fields.semiarido])),
      population: numberOrNull(attrs[fields.population])
    }
  }).filter((item: MunicipioItem) => item.name && item.name !== '—')

  const names = items.map((item) => item.name)
  const notSemiarido = items
    .filter((item) => item.semiarido !== 'Sim')
    .map((item) => item.name)
  const resolvedExtras = resolveSemiaridoExtraNames(names, notSemiarido)
  const extraSet = new Set(resolvedExtras.map(normalizeMunName))

  return items.map((item) => {
    const forcedSemiarido = extraSet.has(normalizeMunName(item.name)) || isForcedSemiarido(item.name)
    return forcedSemiarido
      ? { ...item, semiarido: 'Sim', forcedSemiarido: true }
      : item
  })
}

export async function applySemiaridoMembership (
  items: MunicipioItem[],
  semiLayer: any
): Promise<MunicipioItem[]> {
  if (!semiLayer || typeof semiLayer.queryFeatures !== 'function' || !items.length) {
    return items
  }

  try {
    await semiLayer.load?.()
    const fields = (semiLayer.fields || []).map((field: any) => String(field?.name || ''))
    const nameField = ['nome_do_municipio', 'nm_mun', 'nm_mun_1', 'municipio', 'nome']
      .find((name) => fields.some((field: string) => field.toLowerCase() === name.toLowerCase()))
      || fields.find((field: string) => /mun|nome/i.test(field))
      || 'nm_mun'

    const names = new Set<string>()
    let offset = 0
    const pageSize = 500
    while (true) {
      const query = semiLayer.createQuery ? semiLayer.createQuery() : {}
      query.where = '1=1'
      query.returnGeometry = false
      query.outFields = [nameField]
      query.num = pageSize
      query.start = offset
      const result = await semiLayer.queryFeatures(query)
      const page = result?.features || []
      for (const feature of page) {
        const name = String(feature?.attributes?.[nameField] || '').trim()
        if (name) names.add(normalizeMunName(name))
      }
      if (page.length < pageSize) break
      offset += page.length
      if (offset > 5000) break
    }

    if (!names.size) return items

    return items.map((item) => {
      const inSemi = names.has(normalizeMunName(item.name))
      return {
        ...item,
        semiarido: inSemi ? 'Sim' : 'Não',
        forcedSemiarido: false
      }
    })
  } catch (error) {
    console.warn('[infra] Região Semiárida_BA:', error)
    return items
  }
}

export function municipioWhere (name: string): string {
  return `${sqlIdent(MUN_FIELDS.name)} = '${escapeSqlString(name)}'`
}

export function territorioWhere (name: string): string {
  return `${sqlIdent(MUN_FIELDS.territory)} = '${escapeSqlString(name)}'`
}

export function semiaridoWhere (value: string, extraNames?: string[]): string {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase()
  const semiIdent = sqlIdent(MUN_FIELDS.semiarido)
  if (normalized === 'SIM') {
    return semiaridoSimWhere(MUN_FIELDS.name, extraNames, MUN_FIELDS.semiarido)
  }
  if (normalized === 'NAO') {
    return `(${semiIdent} = 'NÃO' OR ${semiIdent} = 'NAO' OR ${semiIdent} = 'Não' OR ${semiIdent} = 'Nao') AND NOT (${semiaridoExtraWhere(MUN_FIELDS.name, extraNames)})`
  }
  return `${semiIdent} = '${escapeSqlString(value)}'`
}
