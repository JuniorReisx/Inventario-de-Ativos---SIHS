import { loadArcGISJSAPIModules } from 'jimu-arcgis'
import { findLayer, findSemiaridoLayer, findTerritorioLayer } from './layers'
import { ASSET_DEFS } from './ativos'
import { withoutDefinitionExpression } from './map'
import { iconFromPreviewHtml } from './relatorio-pdf'

export interface AssetLegendItem {
  id: string
  label: string
  preview: string
  count: number
}

export interface AssetLegendGroup {
  id: string
  title: string
  items: AssetLegendItem[]
  showCount?: boolean
}

function normalizeValue (value: any): string {
  if (value == null) return ''
  return String(value).trim()
}

function rendererFields (renderer: any): string[] {
  return [renderer?.field, renderer?.field1, renderer?.field2, renderer?.field3]
    .filter(Boolean)
    .filter((field, index, all) => all.indexOf(field) === index)
}

function findCount (counts: Map<string, number>, value: any): number {
  const key = normalizeValue(value)
  if (counts.has(key)) return counts.get(key) || 0
  const upper = key.toUpperCase()
  for (const [name, total] of counts) {
    if (name.toUpperCase() === upper) return total
  }
  return 0
}

async function previewOf (symbol: any): Promise<string> {
  if (symbol) {
    try {
      const [symbolUtils] = await loadArcGISJSAPIModules(['esri/symbols/support/symbolUtils'])
      const node = await symbolUtils.renderPreviewHTML(symbol, { size: 18, maxSize: 20 })
      if (node?.outerHTML) return node.outerHTML
    } catch {
      // usa o fallback abaixo
    }
  }

  const color = symbol?.color
  const r = color?.r ?? color?.[0] ?? 47
  const g = color?.g ?? color?.[1] ?? 196
  const b = color?.b ?? color?.[2] ?? 255
  const a = color?.a ?? color?.[3] ?? 1
  return `<span class="infra-map-legend__fallback" style="background:rgba(${r},${g},${b},${a})"></span>`
}

function applyGeometry (query: any, geometry: any): void {
  if (!geometry) return
  query.geometry = geometry.clone?.() || geometry
  query.spatialRelationship = 'intersects'
}

async function countWhere (layer: any, where: string, geometry?: any): Promise<number> {
  if (typeof layer.queryFeatureCount !== 'function') return 0
  const query = layer.createQuery?.() || { where }
  query.where = where
  applyGeometry(query, geometry)
  const total = await layer.queryFeatureCount(query)
  return Number(total) || 0
}

async function groupedCounts (
  layer: any,
  fields: string[],
  where: string,
  delimiter: string,
  geometry?: any
): Promise<Map<string, number>> {
  const query = layer.createQuery()
  query.where = where
  query.returnGeometry = false
  applyGeometry(query, geometry)
  query.groupByFieldsForStatistics = fields
  query.outStatistics = [
    {
      statisticType: 'count',
      onStatisticField: layer.objectIdField || 'objectid',
      outStatisticFieldName: 'total'
    }
  ]

  const result = await layer.queryFeatures(query)
  const counts = new Map<string, number>()
  for (const feature of result.features || []) {
    const attrs = feature.attributes || {}
    const key = fields.map((field) => normalizeValue(attrs[field])).join(delimiter)
    const total = Number(attrs.total ?? attrs.TOTAL ?? 0) || 0
    if (!total) continue
    counts.set(key, (counts.get(key) || 0) + total)
  }
  return counts
}

async function attributeRows (
  layer: any,
  fields: string[],
  where: string,
  geometry?: any
): Promise<Record<string, any>[]> {
  const query = layer.createQuery()
  query.where = where
  query.returnGeometry = false
  query.outFields = Array.from(new Set(fields.filter(Boolean)))
  applyGeometry(query, geometry)
  query.num = 2000

  const rows: Record<string, any>[] = []
  let start = 0
  for (let page = 0; page < 12; page += 1) {
    query.start = start
    const result = await layer.queryFeatures(query)
    const features = result.features || []
    for (const feature of features) rows.push(feature.attributes || {})
    if (!features.length || !result.exceededTransferLimit) break
    start += features.length
  }
  return rows
}

function classBreakIndex (infos: any[], value: number): number {
  if (!Number.isFinite(value)) return -1
  for (let i = 0; i < infos.length; i += 1) {
    const min = Number(infos[i].minValue)
    const max = Number(infos[i].maxValue)
    const last = i === infos.length - 1
    if (Number.isFinite(min) && value < min) continue
    if (Number.isFinite(max) && last && value > max) continue
    if (Number.isFinite(max) && !last && value >= max) continue
    return i
  }
  return -1
}

async function itemsForLayer (
  layer: any,
  defId: string,
  title: string,
  where: string,
  geometry?: any
): Promise<AssetLegendItem[]> {
  const renderer = layer.renderer
  const type = renderer?.type

  if (type === 'unique-value') {
    const fields = rendererFields(renderer)
    if (!fields.length) return []
    const delimiter = renderer.fieldDelimiter || ', '
    let counts = new Map<string, number>()
    if (geometry) {
      const rows = await attributeRows(layer, fields, where, geometry)
      for (const attrs of rows) {
        const key = fields.map((field) => normalizeValue(attrs[field])).join(delimiter)
        counts.set(key, (counts.get(key) || 0) + 1)
      }
    } else {
      try {
        counts = await groupedCounts(layer, fields, where, delimiter)
      } catch {
        counts = new Map()
      }
      if (!counts.size) {
        const rows = await attributeRows(layer, fields, where)
        for (const attrs of rows) {
          const key = fields.map((field) => normalizeValue(attrs[field])).join(delimiter)
          counts.set(key, (counts.get(key) || 0) + 1)
        }
      }
    }
    const items: AssetLegendItem[] = []
    const matched = new Set<string>()

    for (const info of renderer.uniqueValueInfos || []) {
      const count = findCount(counts, info.value)
      if (!count) continue
      matched.add(normalizeValue(info.value).toUpperCase())
      items.push({
        id: `${defId}-${normalizeValue(info.value)}`,
        label: info.label || normalizeValue(info.value) || 'Não informado',
        preview: await previewOf(info.symbol),
        count
      })
    }

    let other = 0
    counts.forEach((total, key) => {
      if (!matched.has(key.toUpperCase())) other += total
    })
    if (other) {
      items.push({
        id: `${defId}-outros`,
        label: renderer.defaultLabel || 'Outros',
        preview: await previewOf(renderer.defaultSymbol),
        count: other
      })
    }
    return items
  }

  if (type === 'class-breaks' && renderer.field) {
    const infos = renderer.classBreakInfos || []
    const counts = new Array(infos.length).fill(0)
    let other = 0
    const rows = await attributeRows(layer, [renderer.field], where, geometry)
    for (const attrs of rows) {
      const value = Number(attrs[renderer.field])
      const index = classBreakIndex(infos, value)
      if (index >= 0) counts[index] += 1
      else other += 1
    }

    const items: AssetLegendItem[] = []
    for (let i = 0; i < infos.length; i += 1) {
      if (!counts[i]) continue
      const info = infos[i]
      items.push({
        id: `${defId}-${info.minValue}-${info.maxValue}`,
        label: info.label || `${info.minValue}–${info.maxValue}`,
        preview: await previewOf(info.symbol),
        count: counts[i]
      })
    }
    if (other) {
      items.push({
        id: `${defId}-outros`,
        label: renderer.defaultLabel || 'Outros',
        preview: await previewOf(renderer.defaultSymbol),
        count: other
      })
    }
    return items
  }

  const count = await countWhere(layer, where, geometry)
  if (!count) return []
  return [{
    id: defId,
    label: title,
    preview: await previewOf(renderer?.symbol),
    count
  }]
}

function isVisibleOnMap (layer: any): boolean {
  if (!layer || layer.visible === false) return false
  let parent = layer.parent
  for (let i = 0; i < 8 && parent; i += 1) {
    if (parent.visible === false) return false
    parent = parent.parent
  }
  return true
}

function combineWhere (left: string, right: string): string {
  const a = String(left || '').trim() || '1=1'
  const b = String(right || '').trim() || '1=1'
  if (b === '1=1') return a
  if (a === '1=1') return b
  if (a === b) return a
  return `(${a}) AND (${b})`
}

async function groupFromVisibleLayer (
  layer: any,
  id: string,
  title: string,
  territorialWhere: string,
  options?: { showCount?: boolean }
): Promise<AssetLegendGroup | null> {
  if (!isVisibleOnMap(layer) || typeof layer.queryFeatures !== 'function') return null
  await layer.load?.()
  const where = combineWhere(layer.definitionExpression || '1=1', territorialWhere)
  const items = await withoutDefinitionExpression(layer, () => itemsForLayer(layer, id, title, where))
  if (!items.length) return null
  if (options?.showCount === false) {
    items.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
  }
  return {
    id,
    title,
    items,
    showCount: options?.showCount
  }
}

export async function loadLayerLegendInView (
  layer: any,
  view: any,
  options?: { showCount?: boolean }
): Promise<AssetLegendGroup | null> {
  if (!isVisibleOnMap(layer) || typeof layer.queryFeatures !== 'function') return null
  await layer.load?.()
  const geometry = view?.extent?.clone?.() || view?.extent || null
  const where = layer.definitionExpression || '1=1'
  const title = String(layer.title || 'Camada')
  const items = await withoutDefinitionExpression(layer, () => (
    itemsForLayer(layer, layer.id || title, title, where, geometry)
  ))
  if (!items.length) return null
  return {
    id: layer.id || title,
    title,
    items,
    showCount: options?.showCount
  }
}

export async function loadAssetLegend (
  webMap: any,
  territorialWhere: (layer: any) => string
): Promise<AssetLegendGroup[]> {
  const tiLayer = findTerritorioLayer(webMap)
  const semiLayer = findSemiaridoLayer(webMap)

  const boundaries = await Promise.all([
    groupFromVisibleLayer(
      tiLayer,
      'territorios',
      'Território de Identidade',
      tiLayer ? territorialWhere(tiLayer) : '1=1',
      { showCount: false }
    ).catch((err) => {
      console.error('[infra-page] Falha ao montar legenda de Território de Identidade:', err)
      return null
    }),
    groupFromVisibleLayer(
      semiLayer,
      'semiarido',
      'Região Semiárida',
      semiLayer ? territorialWhere(semiLayer) : '1=1',
      { showCount: false }
    ).catch((err) => {
      console.error('[infra-page] Falha ao montar legenda de Região Semiárida:', err)
      return null
    })
  ])

  const groups = await Promise.all(
    ASSET_DEFS.map(async (def) => {
      const layer = findLayer(webMap, { layerTitle: def.layerTitle })
      try {
        return await groupFromVisibleLayer(
          layer,
          def.id,
          def.title,
          layer ? territorialWhere(layer) : '1=1',
          { showCount: true }
        )
      } catch (err) {
        console.error(`[infra-page] Falha ao montar legenda de ${def.title}:`, err)
        return null
      }
    })
  )

  return [...boundaries, ...groups].filter(Boolean) as AssetLegendGroup[]
}

export function legendColorFromPreview (preview: string): string {
  const html = String(preview || '')
  const rgba = html.match(/rgba?\(\s*[\d.]+(?:\s*,\s*[\d.]+){2,3}\s*\)/i)
  if (rgba) return rgba[0]
  const hex = html.match(/#([0-9a-fA-F]{3,8})\b/)
  if (hex) return hex[0]
  return '#1aa8c8'
}

export async function legendGroupsForPdf (groups: AssetLegendGroup[]): Promise<Array<{
  title?: string
  items: Array<{ label: string, color: string, icon?: string | null }>
}>> {
  const out: Array<{ title?: string, items: Array<{ label: string, color: string, icon?: string | null }> }> = []
  for (const group of groups.filter((item) => item.items?.length)) {
    const items = []
    for (const item of group.items) {
      items.push({
        label: group.showCount === false ? item.label : `${item.label} (${item.count})`,
        color: legendColorFromPreview(item.preview),
        icon: await iconFromPreviewHtml(item.preview)
      })
    }
    out.push({ title: group.title, items })
  }
  return out
}
