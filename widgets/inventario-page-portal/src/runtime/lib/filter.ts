export type FilterType = 'all' | 'territorio' | 'municipio' | 'semiarido'

export interface DashboardFilter {
  type: FilterType
  label: string
  munWhere: string
  setoresWhere: string
  zoomLayerTitle?: string
  zoomWhere?: string
  geometry?: any
  /** Geometria só para camadas de pontos/setores; municípios usam SQL. */
  skipMunicipalGeometry?: boolean
}

interface SemiaridoExtraGroup {
  canonical: string
  aliases: string[]
}

/**
 * Municípios da região semiárida ausentes na camada (278 no webmap vs 287 oficiais).
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

export function escapeSqlString (value: string): string {
  return String(value ?? '').replaceAll("'", "''")
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

export function sqlIdent (name: string): string {
  const value = String(name || '')
  if (!value) return value
  if (/[\s"'();]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function simFlagWhere (field: string): string {
  const ident = sqlIdent(field)
  return `(${ident} = 'SIM' OR ${ident} = 'Sim' OR ${ident} = 'sim')`
}

function normalizeFieldText (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function pickLayerField (layer: any, ...candidates: string[]): string | null {
  const available = new Map(
    (layer?.fields || []).map((field: any) => [
      String(field?.name || '').toLowerCase(),
      String(field?.name || '')
    ])
  )
  for (const candidate of candidates) {
    if (!candidate) continue
    const match = available.get(candidate.toLowerCase())
    if (match) return match
  }
  return null
}

/** Resolve o campo de população estimada 2025 na camada municipal (nome ou alias). */
export function pickMunicipioPopEst2025Field (
  layer: any,
  fallback = 'estimativa_pop_2025'
): string {
  const byName = pickLayerField(
    layer,
    'estimativa_pop_2025',
    'pop_est_2025',
    'estimativa_pop2025',
    'populacao_estimada_2025'
  )
  if (byName) return byName

  const fields = layer?.fields || []
  const byAlias = fields.find((field: any) => {
    const alias = normalizeFieldText(field?.alias || '')
    return alias === 'populacao total (estimativa - 2025)' ||
      alias === 'populacao total (estimativa 2025)'
  })
  if (byAlias?.name) return byAlias.name

  const fuzzy = fields.find((field: any) => {
    const text = `${normalizeFieldText(field?.name || '')} ${normalizeFieldText(field?.alias || '')}`
    const isPop = text.includes('populac') || text.includes('pop')
    return isPop && text.includes('estimativ') && text.includes('2025')
  })
  return fuzzy?.name || fallback
}

export function pickMunicipioNameField (layer: any, fallback = 'nome_do_municipio'): string {
  return pickLayerField(
    layer,
    'nome_do_municipio',
    'nm_mun_1',
    'nm_mun',
    'municipio',
    'nome'
  ) || fallback
}

export function pickSemiaridoField (layer: any, fallback = 'região_do_semiarida'): string {
  const direct = pickLayerField(
    layer,
    'região_do_semiarida',
    'regiao_do_semiarida',
    'semiarido'
  )
  if (direct) return direct

  const hit = (layer?.fields || []).find((field: any) => {
    const name = String(field?.name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
    const alias = String(field?.alias || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
    return name.includes('semiarid') || alias.includes('semiarid')
  })
  return hit?.name || fallback
}

export function pickTerritorioMunField (layer: any, fallback = 'territorio_de_indentidade'): string {
  const byName = pickLayerField(
    layer,
    'territorio_de_indentidade',
    'territorio_de_identidade',
    'nom_ti',
    'nm_ti',
    'territorio'
  )
  if (byName) return byName

  const hit = (layer?.fields || []).find((field: any) => {
    const name = normalizeFieldText(field?.name || '')
    const alias = normalizeFieldText(field?.alias || '')
    const text = `${name} ${alias}`
    if (text.includes('cod') || /\bcd\b/.test(text)) return false
    return (text.includes('territori') && text.includes('identidad')) || name === 'territorio'
  })
  return hit?.name || fallback
}

export function pickTerritorioNameField (layer: any, fallback = 'nm_ti'): string {
  const byName = pickLayerField(
    layer,
    'nm_ti',
    'nom_ti',
    'nome_ti',
    'territorio',
    'territorio_de_identidade',
    'territorio_de_indentidade'
  )
  if (byName) return byName

  const hit = (layer?.fields || []).find((field: any) => {
    const name = normalizeFieldText(field?.name || '')
    const alias = normalizeFieldText(field?.alias || '')
    const text = `${name} ${alias}`
    if (text.includes('cod') || /\bcd\b/.test(text)) return false
    return (
      (text.includes('territori') && text.includes('identidad')) ||
      name === 'nomti' ||
      name === 'nmti' ||
      alias.includes('territorio')
    )
  })
  return hit?.name || fallback
}

export function pickTerritorioCodeField (layer: any): string | null {
  return pickLayerField(layer, 'cod_tii', 'cd_ti', 'cod_ti', 'cd_tii', 'codigo_ti')
}

function extraNamesWhere (nameField: string, extraNames?: string[]): string {
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

export function semiaridoMunicipiosWhere (layerOrField?: any, extraNames?: string[]): string {
  const field = typeof layerOrField === 'string' || layerOrField == null
    ? (layerOrField || 'região_do_semiarida')
    : pickSemiaridoField(layerOrField)
  const flagWhere = simFlagWhere(field)
  if (!extraNames?.length) return flagWhere
  const nameField = typeof layerOrField === 'object'
    ? pickMunicipioNameField(layerOrField)
    : 'nome_do_municipio'
  return `(${flagWhere} OR ${extraNamesWhere(nameField, extraNames)})`
}

export const SEMIARIDO_MUNICIPIOS_WHERE = semiaridoMunicipiosWhere('região_do_semiarida')

export const FILTER_ALL: DashboardFilter = {
  type: 'all',
  label: 'Estado da Bahia',
  munWhere: '1=1',
  setoresWhere: '1=1',
  zoomLayerTitle: 'Limite Bahia',
  zoomWhere: '1=1',
  geometry: null
}

export function createTerritoryFilter (
  territoryName: string,
  options?: { munLayer?: any, tiLayer?: any }
): DashboardFilter {
  const name = escapeSqlString(territoryName)
  const munField = sqlIdent(pickTerritorioMunField(options?.munLayer))
  const tiNameField = sqlIdent(pickTerritorioNameField(options?.tiLayer))
  return {
    type: 'territorio',
    label: territoryName,
    munWhere: `${munField} = '${name}'`,
    setoresWhere: `${tiNameField} = '${name}'`,
    zoomLayerTitle: options?.tiLayer?.title || 'Territórios de Identidade',
    zoomWhere: `${tiNameField} = '${name}'`,
    geometry: null
  }
}

export function createMunicipalityFilter (
  municipalityName: string,
  nameField = 'nome_do_municipio'
): DashboardFilter {
  const name = escapeSqlString(municipalityName)
  const munEq = `UPPER(${sqlIdent(nameField)}) = UPPER('${name}')`
  return {
    type: 'municipio',
    label: municipalityName,
    munWhere: munEq,
    setoresWhere: `UPPER(nm_mun) = UPPER('${name}') OR UPPER(nm_mun_1) = UPPER('${name}')`,
    zoomLayerTitle: 'PDA_Indicadores_Censo_2022',
    zoomWhere: munEq,
    geometry: null
  }
}

export function createSemiaridoFilter (
  geometry: any = null,
  extraNames?: string[],
  munLayer?: any
): DashboardFilter {
  const munWhere = semiaridoMunicipiosWhere(munLayer || 'região_do_semiarida', extraNames)
  return {
    type: 'semiarido',
    label: 'Região Semiárida',
    munWhere,
    setoresWhere: '1=1',
    zoomLayerTitle: 'Região Semiárida_BA',
    zoomWhere: '1=1',
    geometry,
    skipMunicipalGeometry: true
  }
}

export function combineWhere (...parts: Array<string | null | undefined>): string {
  const valid = parts
    .map((part) => (part || '').trim())
    .filter((part) => part && part !== '1=1')

  if (!valid.length) return '1=1'
  if (valid.length === 1) return valid[0]
  return valid.map((part) => `(${part})`).join(' AND ')
}

export function getStatsPanelTitle (filter: DashboardFilter): string {
  if (!filter || filter.type === 'all') return 'BAHIA EM NÚMEROS'
  if (filter.type === 'territorio') {
    return `${String(filter.label).toUpperCase()} EM NÚMEROS`
  }
  if (filter.type === 'municipio') {
    return `${String(filter.label).toUpperCase()} EM NÚMEROS`
  }
  if (filter.type === 'semiarido') return 'REGIÃO SEMIÁRIDA EM NÚMEROS'
  return 'BAHIA EM NÚMEROS'
}

export async function resolveSemiaridoExtraNamesFromLayer (layer: any): Promise<string[]> {
  if (!layer || typeof layer.queryFeatures !== 'function') {
    return SEMIARIDO_EXTRA_GROUPS.map((group) => group.canonical)
  }

  await layer.load()
  const nameField = pickMunicipioNameField(layer)
  const semiField = pickSemiaridoField(layer)

  const query = layer.createQuery()
  query.where = '1=1'
  query.returnGeometry = false
  query.outFields = [nameField, ...(semiField ? [semiField] : [])]
  query.num = 500

  const result = await layer.queryFeatures(query)
  const features = result.features || []
  const names = features
    .map((feature: any) => String(feature.attributes?.[nameField] || '').trim())
    .filter(Boolean)

  const notSemiarido = features
    .filter((feature: any) => {
      const flag = String(feature.attributes?.[semiField || ''] || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
      return flag !== 'SIM'
    })
    .map((feature: any) => String(feature.attributes?.[nameField] || '').trim())
    .filter(Boolean)

  return resolveSemiaridoExtraNames(names, notSemiarido)
}

export async function queryMunicipioGeometries (
  layer: any,
  extraNames: string[]
): Promise<any[]> {
  if (!layer || !extraNames.length || typeof layer.queryFeatures !== 'function') return []

  await layer.load()
  const nameField = pickMunicipioNameField(layer)
  const query = layer.createQuery()
  query.where = extraNames
    .map((name) => `UPPER(${nameField}) = UPPER('${escapeSqlString(name)}')`)
    .join(' OR ')
  query.returnGeometry = true
  query.outFields = [nameField]
  query.num = 20

  const result = await layer.queryFeatures(query)
  return (result.features || []).map((feature: any) => feature.geometry).filter(Boolean)
}
