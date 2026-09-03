function layerLabel (layer: any): string {
  return layer?.title || layer?.name || ''
}

function isQueryableLayer (layer: any): boolean {
  return !!(layer && typeof layer.queryFeatures === 'function')
}

function getSublayers (layer: any): any[] {
  return layer?.allSublayers?.toArray?.() || layer?.sublayers?.toArray?.() || []
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

export function getQueryableLayers (webMap: any): any[] {
  return getAllLayers(webMap).filter((layer) => {
    return (
      isQueryableLayer(layer) &&
      (layer.type === 'feature' ||
        layer.type === 'subtype-group' ||
        layer.type === 'sublayer' ||
        typeof layer.queryFeatures === 'function')
    )
  })
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

    const exact = scored.find((item) => item.exact)
    if (exact) return exact.layer

    const partial = scored[0]
    if (partial) return partial.layer
  }

  return null
}

export function isTerritorioLayerTitle (title: string): boolean {
  const name = normalizeText(title)
  return name.includes('territori') && name.includes('identidad')
}

function isMapImageLayer (layer: any): boolean {
  if (!layer) return false
  if (layer.type === 'map-image') return true
  return /\/MapServer\/?$/i.test(String(layer.url || ''))
}

function territorioMatches (layer: any): boolean {
  return isTerritorioLayerTitle(layerLabel(layer))
}

/**
 * Camada visual no mapa (MapImageLayer / FeatureLayer / Sublayer).
 * Preferência: FeatureLayer > Sublayer consultável > MapImageLayer > qualquer match.
 */
export function findTerritorioLayer (webMap: any): any | null {
  const matches = getAllLayers(webMap).filter(territorioMatches)
  if (!matches.length) return null

  const feature = matches.find((layer) => layer.type === 'feature' && isQueryableLayer(layer))
  if (feature) return feature

  const queryableSub = matches.find((layer) => layer.type === 'sublayer' && isQueryableLayer(layer))
  if (queryableSub) return queryableSub

  const anySub = matches.find((layer) => layer.type === 'sublayer')
  if (anySub) return anySub

  for (const layer of matches) {
    if (!isMapImageLayer(layer)) continue
    const subs = getSublayers(layer)
    const preferred = subs.find(isQueryableLayer) || subs[0]
    if (preferred) return preferred
  }

  return matches.find(isQueryableLayer) || matches.find(isMapImageLayer) || matches[0] || null
}

/**
 * Resolve uma camada consultável para o KPI/lista de Territórios de Identidade.
 * O WebMap traz MapServer (map-image); neste caso carrega a sublayer ou cria FeatureLayer em /MapServer/0.
 */
export async function resolveTerritorioQueryableLayer (webMap: any): Promise<any | null> {
  const display = findTerritorioLayer(webMap)
  const mapImage =
    (display && isMapImageLayer(display) ? display : null) ||
    (display?.parent && isMapImageLayer(display.parent) ? display.parent : null) ||
    getAllLayers(webMap).find((layer) => isMapImageLayer(layer) && territorioMatches(layer)) ||
    null

  if (mapImage) {
    try { await mapImage.load?.() } catch (_) {}
  }

  let candidate = findTerritorioLayer(webMap) || display
  if (!candidate && mapImage) {
    const subs = getSublayers(mapImage)
    candidate = subs.find(isQueryableLayer) || subs[0] || mapImage
  }
  if (!candidate) return null

  try { await candidate.load?.() } catch (_) {}

  if (typeof candidate.queryFeatures === 'function') {
    if (typeof candidate.createFeatureLayer === 'function') {
      if (!candidate.__sihsFeatureLayer) {
        try {
          const featureLayer = await candidate.createFeatureLayer()
          await featureLayer.load?.()
          candidate.__sihsFeatureLayer = featureLayer
        } catch (_) {}
      }
      if (candidate.__sihsFeatureLayer) return candidate.__sihsFeatureLayer
    }
    return candidate
  }

  if (!mapImage?.url) return null
  if (mapImage.__sihsFeatureLayer) return mapImage.__sihsFeatureLayer

  try {
    const { loadArcGISJSAPIModules } = await import('jimu-arcgis')
    const [FeatureLayer] = await loadArcGISJSAPIModules(['esri/layers/FeatureLayer'])
    const base = String(mapImage.url).replace(/\/+$/, '')
    const featureLayer = new FeatureLayer({
      url: `${base}/0`,
      title: layerLabel(mapImage) || 'Territórios de Identidade'
    })
    await featureLayer.load()
    mapImage.__sihsFeatureLayer = featureLayer
    return featureLayer
  } catch (error) {
    console.warn('[sihs-dash] Falha ao criar FeatureLayer dos territórios:', error)
    return null
  }
}

export function isSemiaridoLayerTitle (title: string): boolean {
  const name = normalizeText(title)
  return name === 'regiaosemiaridaba' || name.includes('semiaridaba') || name === 'regiaosemiarida'
}

export function findSemiaridoLayer (webMap: any): any | null {
  const scored = getAllLayers(webMap).map((layer) => {
    const name = normalizeText(layerLabel(layer))
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

export function findMunicipioLayer (webMap: any): any | null {
  const layers = getQueryableLayers(webMap)
  const scored = layers.map((layer) => {
    const title = normalizeText(layerLabel(layer))
    const url = normalizeText(String(layer?.url || ''))
    const dpa =
      title.includes('pdaindicadorescenso') ||
      title.includes('dpaindicadorescenso') ||
      url.includes('pdaindicadorescenso') ||
      url.includes('dpaindicadorescenso')
    const exact =
      title === 'municipios' ||
      title === 'limitesmunicipais' ||
      title === 'limitemunicipal'
    const extraTheme = /sistema|setor|saneamento|aglomerado|abastec|esgoto/.test(title)
    return { layer, dpa, exact, extraTheme, title }
  })

  const dpa = scored.find((item) => item.dpa)
  if (dpa) return dpa.layer

  const exact = scored.find((item) => item.exact)
  if (exact) return exact.layer

  const municipal = scored.find((item) => {
    return !item.extraTheme && item.title.includes('municip')
  })
  return municipal?.layer || null
}

function normalizeText (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .trim()
    .toLowerCase()
}

export function isMunicipioLayerTitle (title: string): boolean {
  const name = normalizeText(title)
  if (!name) return false
  if (name.includes('pdaindicadorescenso') || name.includes('dpaindicadorescenso')) return true
  if (name === 'municipios' || name === 'limitesmunicipais' || name === 'limitemunicipal') return true
  if (name.includes('municip') && !/sistema|setor|saneamento|aglomerado|abastec|esgoto/.test(name)) {
    return true
  }
  return false
}

function rememberOriginalVisible (layer: any): void {
  if (!layer || layer.__sihsOrigVisible !== undefined) return
  layer.__sihsOrigVisible = layer.visible !== false
}

function showLayer (layer: any, visible: boolean): void {
  if (!layer) return
  rememberOriginalVisible(layer)
  layer.visible = visible
  if (!visible) return
  let parent = layer.parent
  while (parent && typeof parent === 'object' && 'visible' in parent) {
    parent.visible = true
    parent = parent.parent
  }
}

const ORIG_WHERE = '__sihsOrigWhere'

function definitionTargets (layer: any): any[] {
  if (!layer) return []
  if (typeof layer.queryFeatures === 'function' || 'definitionExpression' in layer) {
    return [layer]
  }
  if (isMapImageLayer(layer)) {
    const subs = getSublayers(layer)
    if (subs.length) return subs
  }
  return [layer]
}

export function setLayerDefinition (layer: any, where?: string | null): void {
  if (!layer) return
  const next = String(where || '').trim()
  for (const target of definitionTargets(layer)) {
    if (target[ORIG_WHERE] == null) {
      target[ORIG_WHERE] = target.definitionExpression || '1=1'
    }
    if (!next || next === '1=1') {
      target.definitionExpression = target[ORIG_WHERE] === '1=1' ? null : target[ORIG_WHERE]
      continue
    }
    target.definitionExpression = next
  }
}

export function restoreLayerDefinition (layer: any): void {
  setLayerDefinition(layer, null)
}

export function setTerritorialLayerFocus (
  webMap: any,
  focus: 'all' | 'semiarido' | 'territorio' | 'municipio'
): { semi: any, ti: any, mun: any, limite: any } {
  const semi = findSemiaridoLayer(webMap)
  const ti =
    getAllLayers(webMap).find((layer) => isMapImageLayer(layer) && territorioMatches(layer)) ||
    findTerritorioLayer(webMap)
  const mun = findMunicipioLayer(webMap)
  const limite = findLayer(webMap, { layerTitle: 'Limite Bahia' })
  rememberOriginalVisible(semi)
  rememberOriginalVisible(ti)
  rememberOriginalVisible(mun)
  rememberOriginalVisible(limite)

  if (focus === 'all') {
    showLayer(semi, false)
    showLayer(ti, ti ? ti.__sihsOrigVisible !== false : false)
    // Municípios ficam sempre visíveis no estado para permitir clique/seleção no mapa
    showLayer(mun, true)
    showLayer(limite, limite ? limite.__sihsOrigVisible !== false : false)
    return { semi, ti, mun, limite }
  }

  showLayer(semi, focus === 'semiarido')
  showLayer(ti, focus === 'territorio')
  showLayer(mun, focus === 'municipio' || focus === 'semiarido' || focus === 'territorio')
  showLayer(limite, focus !== 'territorio' && (limite ? limite.__sihsOrigVisible !== false : false))
  return { semi, ti, mun, limite }
}

export async function logWebMapLayers (webMap: any): Promise<any[]> {
  const layers = getAllLayers(webMap)
  console.group(`[layers] Camadas do Web Map (${layers.length})`)
  for (const layer of layers) {
    try {
      await layer.load?.()
    } catch (_) {}
    console.log(
      layerLabel(layer),
      layer.type,
      isQueryableLayer(layer) ? 'queryable' : 'not-queryable',
      layer.url || null
    )
  }
  console.groupEnd()
  return layers
}
