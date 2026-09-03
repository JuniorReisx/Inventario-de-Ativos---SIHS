function layerLabel (layer: any): string {
  return layer?.title || layer?.name || ''
}

function isQueryableLayer (layer: any): boolean {
  return !!(layer && typeof layer.queryFeatures === 'function')
}

function getSublayers (layer: any): any[] {
  return layer?.allSublayers?.toArray?.() || layer?.sublayers?.toArray?.() || []
}

function normalizeText (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

export function getAllLayers (webMap: any): any[] {
  const collected: any[] = []
  const root = webMap?.allLayers?.toArray?.() || []
  for (const layer of root) {
    collected.push(layer)
    for (const sub of getSublayers(layer)) {
      collected.push(sub)
    }
  }
  return collected
}

export function findLayer (
  webMap: any,
  { layerTitle, layerId }: { layerTitle?: string, layerId?: string } = {}
): any | null {
  const layers = getAllLayers(webMap)

  if (layerId) {
    const byId = layers.find((layer) => layer.id === layerId)
    if (byId) {
      if (isQueryableLayer(byId)) return byId
      const queryableSub = getSublayers(byId).find(isQueryableLayer)
      if (queryableSub) return queryableSub
    }
  }

  if (layerTitle) {
    const target = normalizeText(layerTitle)
    const scored = layers.map((layer) => {
      const title = normalizeText(layerLabel(layer))
      const exact = title === target
      const partial = title.includes(target) || target.includes(title)
      return { layer, exact, partial, queryable: isQueryableLayer(layer) }
    }).filter((item) => item.exact || item.partial)

    const exactQueryable = scored.find((item) => item.exact && item.queryable)
    if (exactQueryable) return exactQueryable.layer

    const partialQueryable = scored.find((item) => item.partial && item.queryable)
    if (partialQueryable) return partialQueryable.layer

    for (const item of scored) {
      const queryableSub = getSublayers(item.layer).find(isQueryableLayer)
      if (queryableSub) return queryableSub
    }

    return scored.find((item) => item.exact)?.layer || scored[0]?.layer || null
  }

  return null
}

function compactLayerName (value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, '')
}

function isCensoMunicipioLayer (layer: any): boolean {
  const name = compactLayerName(layerLabel(layer))
  const url = compactLayerName(String(layer?.url || ''))
  return name.includes('pdaindicadorescenso')
    || name.includes('dpaindicadorescenso')
    || url.includes('pdaindicadorescenso')
    || url.includes('dpaindicadorescenso')
}

export function findMunicipioLayer (webMap: any): any | null {
  const direct =
    findLayer(webMap, { layerTitle: 'PDA_Indicadores_Censo_2022' })
    || findLayer(webMap, { layerTitle: 'DPA_Indicadores_Censo_2022' })
  if (direct && isCensoMunicipioLayer(direct)) return direct
  if (direct) return direct

  const scored = getAllLayers(webMap).map((layer) => ({
    layer,
    censo: isCensoMunicipioLayer(layer),
    queryable: isQueryableLayer(layer)
  }))
  return scored.find((item) => item.censo && item.queryable)?.layer
    || scored.find((item) => item.censo)?.layer
    || null
}

export function findSemiaridoLayer (webMap: any): any | null {
  const scored = getAllLayers(webMap).map((layer) => {
    const name = compactLayerName(layerLabel(layer))
    return {
      layer,
      ba: name === 'regiaosemiaridaba' || name.includes('semiaridaba'),
      old: name === 'regiaosemiarida',
      queryable: isQueryableLayer(layer)
    }
  })
  return scored.find((item) => item.ba && item.queryable)?.layer
    || scored.find((item) => item.ba)?.layer
    || scored.find((item) => item.old && item.queryable)?.layer
    || scored.find((item) => item.old)?.layer
    || null
}

export function findTerritorioLayer (webMap: any): any | null {
  const scored = getAllLayers(webMap).map((layer) => {
    const name = compactLayerName(layerLabel(layer))
    return {
      layer,
      match: name.includes('territori') && name.includes('identidad'),
      queryable: isQueryableLayer(layer)
    }
  }).filter((item) => item.match)
  return scored.find((item) => item.queryable)?.layer || scored[0]?.layer || null
}

function rememberOriginalVisible (layer: any): void {
  if (!layer || layer.__sihsOrigVisible !== undefined) return
  layer.__sihsOrigVisible = layer.visible !== false
}

function showLayer (layer: any, visible: boolean, webMap?: any): void {
  if (!layer) return
  rememberOriginalVisible(layer)
  layer.visible = visible
  if (!visible) return
  let parent = layer.parent
  while (parent && parent !== webMap && parent !== webMap?.layers && typeof parent === 'object' && 'visible' in parent) {
    parent.visible = true
    parent = parent.parent
  }
}

const ORIG_WHERE = '__sihsOrigWhere'

export function setLayerDefinition (layer: any, where?: string | null): void {
  if (!layer) return
  if (layer[ORIG_WHERE] == null) {
    layer[ORIG_WHERE] = layer.definitionExpression || '1=1'
  }
  const next = String(where || '').trim()
  if (!next || next === '1=1') {
    layer.definitionExpression = layer[ORIG_WHERE] === '1=1' ? null : layer[ORIG_WHERE]
    return
  }
  layer.definitionExpression = next
}

export function restoreLayerDefinition (layer: any): void {
  setLayerDefinition(layer, null)
}

function quoteIdent (name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name
  return `"${String(name).replace(/"/g, '""')}"`
}

export function territorioLayerWhere (layer: any, territorio: string): string {
  const value = String(territorio || '').replace(/'/g, "''")
  const candidates = [
    'nom_ti', 'nm_ti', 'nome_ti', 'territorio',
    'territorio_de_identidade', 'territorio_de_indentidade'
  ]
  const fields = (layer?.fields || []).map((field: any) => String(field?.name || '')).filter(Boolean)
  const byLower = new Map(fields.map((name: string) => [name.toLowerCase(), name]))
  const field = candidates.map((name) => byLower.get(name.toLowerCase())).find(Boolean) || fields.find((name: string) => {
    const n = name.toLowerCase()
    return n.includes('territori') || n.includes('_ti') || n === 'nom_ti'
  }) || 'nom_ti'
  const ident = quoteIdent(field)
  return `(${ident} = '${value}' OR UPPER(${ident}) = UPPER('${value}'))`
}

export function setTerritorialLayerFocus (
  webMap: any,
  focus: 'all' | 'semiarido' | 'territorio' | 'municipio'
): { semi: any, ti: any, mun: any, limite: any } {
  const semi = findSemiaridoLayer(webMap)
  const ti = findTerritorioLayer(webMap)
  const mun = findMunicipioLayer(webMap)
  const limite = findLayer(webMap, { layerTitle: 'Limite Bahia' })
  rememberOriginalVisible(semi)
  rememberOriginalVisible(ti)
  rememberOriginalVisible(mun)
  rememberOriginalVisible(limite)

  if (focus === 'all') {
    showLayer(semi, false, webMap)
    showLayer(ti, ti ? ti.__sihsOrigVisible !== false : false, webMap)
    showLayer(mun, mun ? mun.__sihsOrigVisible !== false : true, webMap)
    showLayer(limite, limite ? limite.__sihsOrigVisible !== false : false, webMap)
    restoreLayerDefinition(ti)
    return { semi, ti, mun, limite }
  }

  showLayer(semi, focus === 'semiarido', webMap)
  showLayer(ti, focus === 'territorio', webMap)
  showLayer(mun, focus === 'municipio' || focus === 'semiarido' || focus === 'territorio', webMap)
  showLayer(limite, focus !== 'territorio' && (limite ? limite.__sihsOrigVisible !== false : false), webMap)
  if (focus !== 'territorio') restoreLayerDefinition(ti)
  return { semi, ti, mun, limite }
}

export function setSemiaridoLayerVisible (webMap: any, visible: boolean): any | null {
  const { semi } = setTerritorialLayerFocus(webMap, visible ? 'semiarido' : 'all')
  return semi
}
