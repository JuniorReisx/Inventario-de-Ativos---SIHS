import { loadArcGISJSAPIModules } from 'jimu-arcgis'

export const PORTAL_URL = 'https://portaldaagua.sihs.ba.gov.br/portal'
export const ATLAS_WEB_MAP_ID = '6f5aef1406ce4dc985b9434575b5aa2b'

function normalizePortalUrl (value: string): string {
  return String(value || '').replace(/\/+$/, '')
}

export async function setupAuthentication (portalUrl = PORTAL_URL): Promise<void> {
  const [esriConfig] = await loadArcGISJSAPIModules(['esri/config'])
  esriConfig.portalUrl = normalizePortalUrl(portalUrl)
}

export async function createWebMap (
  portalUrl = PORTAL_URL,
  webMapId = ATLAS_WEB_MAP_ID
): Promise<any> {
  const [WebMap] = await loadArcGISJSAPIModules(['esri/WebMap'])
  const webMap = new WebMap({
    portalItem: {
      id: webMapId,
      portal: { url: normalizePortalUrl(portalUrl) }
    }
  })
  await webMap.load()
  return webMap
}

function toolEnabled (bag: any, key: string, fallback: boolean): boolean {
  const value = bag?.[key]
  if (value == null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value.enabled === 'boolean') return value.enabled
  return true
}

function mergeWidgetFlags (webMap: any, data: any): Record<string, any> {
  return {
    ...(data?.applicationProperties?.viewing || {}),
    ...(data?.widgets || {}),
    ...(webMap?.applicationProperties?.viewing || {}),
    ...(webMap?.widgets || {})
  }
}

async function addWebMapTools (view: any, webMap: any): Promise<void> {
  const data = await webMap?.portalItem?.fetchData?.().catch(() => ({})) || {}
  const flags = mergeWidgetFlags(webMap, data)
  const on = (key: string, fallback = true) => toolEnabled(flags, key, fallback)

  const [
    Expand,
    Search,
    Home,
    Locate,
    Compass,
    Fullscreen,
    BasemapGallery,
    Bookmarks,
    Print,
    ScaleBar,
    Measurement
  ] = await loadArcGISJSAPIModules([
    'esri/widgets/Expand',
    'esri/widgets/Search',
    'esri/widgets/Home',
    'esri/widgets/Locate',
    'esri/widgets/Compass',
    'esri/widgets/Fullscreen',
    'esri/widgets/BasemapGallery',
    'esri/widgets/Bookmarks',
    'esri/widgets/Print',
    'esri/widgets/ScaleBar',
    'esri/widgets/Measurement'
  ])

  const expand = (content: any, expandTooltip: string) => new Expand({
    view,
    content,
    expandTooltip,
    expanded: false,
    mode: 'floating'
  })

  const add = (corner: string, widget: any) => {
    try { view.ui.add(widget, corner) } catch (_) {}
  }

  if (on('home')) add('top-left', new Home({ view }))
  if (on('compass')) add('top-left', new Compass({ view }))
  if (on('locate')) add('top-left', new Locate({ view }))
  if (on('fullscreen')) add('top-left', new Fullscreen({ view }))

  if (on('search')) {
    const search = new Search({
      view,
      includeDefaultSources: false,
      locationEnabled: false,
      popupEnabled: false,
      resultGraphicEnabled: false
    })
    view.__atlasSearch = search
    add('top-right', search)
  }
  if (on('basemapGallery')) add('top-right', expand(new BasemapGallery({ view }), 'Mapa de fundo'))
  if (on('bookmarks', false) && webMap?.bookmarks?.length) {
    add('top-right', expand(new Bookmarks({ view }), 'Marcadores'))
  }
  if (on('measure') || on('measurement')) {
    add('top-right', expand(new Measurement({ view }), 'Medir'))
  }
  if (on('print', false)) {
    add('top-right', expand(new Print({
      view,
      printServiceUrl: 'https://utility.arcgisonline.com/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task'
    }), 'Imprimir'))
  }
  if (on('scaleBar')) add('bottom-left', new ScaleBar({ view, unit: 'metric' }))
}

export async function createAtlasView (container: HTMLElement, webMap: any): Promise<any> {
  const [MapView] = await loadArcGISJSAPIModules(['esri/views/MapView'])

  container.replaceChildren()

  const view = new MapView({
    container,
    map: webMap,
    constraints: { snapToZoom: false },
    popupEnabled: false,
    popup: {
      dockEnabled: false,
      autoOpenEnabled: false
    }
  })

  await view.when()
  await resizeMapView(view)

  if (view.highlightOptions) {
    view.highlightOptions = {
      color: [47, 196, 255],
      haloOpacity: 0.95,
      fillOpacity: 0.18
    }
  }

  if (view.extent) {
    await view.goTo(view.extent.clone().expand(1.02), { animate: false })
  }

  await addWebMapTools(view, webMap).catch((err) => {
    console.warn('[atlas] Não foi possível montar as ferramentas do web map:', err)
  })
  await bindAtlasMunicipioSearch(view, webMap).catch(() => {})
  return view
}

export function layersForAtlasLegend (webMap: any): any[] {
  const found: any[] = []

  const visit = (layer: any, parentOn: boolean) => {
    if (!shouldList(layer)) return
    const on = parentOn && layer.visible !== false
    if (!on) return
    const title = String(layer.title || layer.name || '')
    if (isTerritorioTotalLayer(title)) return
    if (isTerritorioLayer(title) || aliasKey(title) === 'territorio') {
      found.push(layer)
      return
    }
    for (const child of childCollection(layer).filter(shouldList)) visit(child, true)
  }

  for (const layer of webMap?.layers?.toArray?.() || []) visit(layer, true)
  const withClasses = found.find((layer) => (layer?.renderer?.uniqueValueInfos || []).length >= 10)
  return withClasses ? [withClasses] : found
}

export function atlasLegendLayerInfos (webMap: any): Array<{ layer: any, title: string }> {
  return layersForAtlasLegend(webMap).map((layer) => ({ layer, title: '' }))
}

function cleanLegendLabel (value: string): string {
  return String(value || '')
    .replace(/visualizar para\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function pruneAtlasLegendDom (container: HTMLElement | null): void {
  if (!container) return

  container.querySelectorAll('img').forEach((img) => {
    img.setAttribute('alt', '')
    img.removeAttribute('title')
  })

  container.querySelectorAll('.esri-legend__layer-caption, .esri-legend__service-label').forEach((node) => {
    (node as HTMLElement).style.display = 'none'
  })

  const seen = new Set<string>()
  container.querySelectorAll('.esri-legend__layer-row').forEach((node) => {
    const row = node as HTMLElement
    const info = row.querySelector('.esri-legend__layer-cell--info') as HTMLElement | null
    if (info) {
      const cleaned = cleanLegendLabel(info.textContent || '')
      if (info.textContent !== cleaned) info.textContent = cleaned
    }
    const key = cleanLegendLabel(row.textContent || '')
    if (!key || seen.has(key)) {
      row.style.display = 'none'
      return
    }
    seen.add(key)
    row.style.display = ''
  })
}

export function atlasSyncLegend (legend: any, webMap: any): void {
  if (!legend) return
  try {
    legend.layerInfos = atlasLegendLayerInfos(webMap)
  } catch (_) {}
  const container = legend.container instanceof HTMLElement ? legend.container : null
  window.setTimeout(() => pruneAtlasLegendDom(container), 80)
}

export async function atlasMountLegend (view: any, container: HTMLElement): Promise<() => void> {
  const [Legend] = await loadArcGISJSAPIModules(['esri/widgets/Legend'])
  const legend = new Legend({
    view,
    container,
    respectLayerVisibility: true,
    hideLayersNotInCurrentView: false,
    layerInfos: atlasLegendLayerInfos(view?.map)
  })
  view.__atlasLegend = legend

  const observer = new MutationObserver(() => pruneAtlasLegendDom(container))
  observer.observe(container, { childList: true, subtree: true })
  const handle = legend.watch?.('activeLayerInfos', () => pruneAtlasLegendDom(container))
  window.setTimeout(() => pruneAtlasLegendDom(container), 120)

  return () => {
    try { handle?.remove?.() } catch (_) {}
    try { observer.disconnect() } catch (_) {}
    try { legend.destroy() } catch (_) {}
    try { if (view.__atlasLegend === legend) view.__atlasLegend = null } catch (_) {}
  }
}

export async function resizeMapView (view: any): Promise<void> {
  if (!view) return
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (typeof view.resize === 'function') view.resize()
  await new Promise((resolve) => requestAnimationFrame(resolve))
  if (typeof view.resize === 'function') view.resize()
}

export type AtlasLayerNode = {
  id: string
  uid: string
  title: string
  visible: boolean
  type: string
  layer?: any
  children?: AtlasLayerNode[]
}

function shouldList (layer: any): boolean {
  if (!layer) return false
  const mode = String(layer.listMode || '').toLowerCase()
  if (mode === 'hide') return false
  const type = String(layer.type || '').toLowerCase()
  if (type === 'graphics') return false
  return Boolean(layer.title || layer.id)
}

function childCollection (layer: any): any[] {
  return layer?.layers?.toArray?.() || layer?.allSublayers?.toArray?.() || layer?.sublayers?.toArray?.() || []
}

function collectNodes (layers: any[], prefix: string): AtlasLayerNode[] {
  const listed = (layers || []).filter((layer: any) => {
    if (!shouldList(layer)) return false
    return !isTerritorioTotalLayer(String(layer.title || layer.name || ''))
  })
  return listed.map((layer: any, index: number) => {
    const uid = prefix === '' ? String(index) : `${prefix}/${index}`
    const kids = collectNodes(childCollection(layer), uid)
    return {
      id: String(layer.id || layer.title || uid),
      uid,
      title: String(layer.title || layer.name || 'Camada'),
      visible: layer.visible !== false,
      type: String(layer.type || ''),
      layer,
      children: kids.length ? kids : undefined
    }
  })
}

function normalizeLayerName (value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

export function atlasDisplayTitle (title: string): string {
  const name = normalizeLayerName(title)
  if (name.includes('reservator') && name.includes('snisb')) return 'Reservatórios'
  if (name.includes('pdaindicadorescenso') || name.includes('dpaindicadorescenso')) return 'Municípios'
  if (name.includes('semiarid')) return 'Região Semiárida'
  if (name.includes('limite') && name.includes('bahia')) return 'Bahia'
  if (name === 'lmestadual' || name === 'lmbahia' || name === 'limitebahia') return 'Bahia'
  return String(title || '').trim() || 'Camada'
}

function isSemiaridoLayer (title: string): boolean {
  return normalizeLayerName(title).includes('semiarid')
}

function isTerritorioTotalLayer (title: string): boolean {
  const name = normalizeLayerName(title)
  return name.includes('territorio') && name.includes('identidade') && name.includes('total')
}

function isTerritorioLayer (title: string): boolean {
  const name = normalizeLayerName(title)
  if (name.includes('total')) return false
  return name.includes('territorio') && name.includes('identidade')
}

/** Semiárido não pertence ao grupo Território de Identidade: sobe para a raiz da lista. */
function promoteSemiaridoToRoot (nodes: AtlasLayerNode[]): AtlasLayerNode[] {
  const lifted: AtlasLayerNode[] = []
  const prune = (list: AtlasLayerNode[], insideTi: boolean): AtlasLayerNode[] => {
    const next: AtlasLayerNode[] = []
    for (const node of list) {
      const inTi = insideTi || isTerritorioLayer(node.title)
      const kids = node.children?.length ? prune(node.children, inTi) : undefined
      if (insideTi && isSemiaridoLayer(node.title)) {
        lifted.push({ ...node, children: kids })
        continue
      }
      next.push({ ...node, children: kids?.length ? kids : undefined })
    }
    return next
  }

  const tree = prune(nodes, false)
  if (!lifted.length) return tree

  const out: AtlasLayerNode[] = []
  let inserted = false
  for (const node of tree) {
    if (!inserted && isTerritorioLayer(node.title)) {
      out.push(...lifted)
      inserted = true
    }
    out.push(node)
  }
  if (!inserted) out.push(...lifted)
  return out
}

function isReservatorioSnisbLayer (title: string): boolean {
  const name = normalizeLayerName(title)
  return name.includes('reservator') && name.includes('snisb')
}

function aliasKey (title: string): 'semiarido' | 'territorio' | 'reservatorio' | null {
  if (isSemiaridoLayer(title)) return 'semiarido'
  if (isTerritorioLayer(title)) return 'territorio'
  if (isReservatorioSnisbLayer(title)) return 'reservatorio'
  return null
}

function preferScore (node: AtlasLayerNode): number {
  const name = normalizeLayerName(node.title)
  if (name.includes('semiarid')) {
    if (name === 'regiaosemiaridaba' || name.endsWith('semiaridaba')) return 100
    if (name.includes('bahia')) return 20
    return 50
  }
  if (name.includes('territorio')) {
    return 30 + (node.children?.length || 0) * 8
  }
  if (name.includes('reservator') && name.includes('snisb')) {
    if (name === 'reservatoriossnisb') return 100
    return 40
  }
  return 0
}

function dedupeAtlasAliases (nodes: AtlasLayerNode[]): AtlasLayerNode[] {
  const groups = new Map<string, AtlasLayerNode[]>()
  const prepared = nodes.map((node) => ({
    ...node,
    children: node.children?.length ? node.children : undefined
  }))

  for (const node of prepared) {
    const key = aliasKey(node.title)
    if (!key) continue
    const list = groups.get(key) || []
    list.push(node)
    groups.set(key, list)
  }

  const winner = new Map<string, AtlasLayerNode>()
  for (const [key, list] of groups) {
    winner.set(key, [...list].sort((a, b) => preferScore(b) - preferScore(a))[0])
  }

  const emitted = new Set<string>()
  const out: AtlasLayerNode[] = []
  for (const node of prepared) {
    const key = aliasKey(node.title)
    if (!key) {
      out.push(node)
      continue
    }
    if (emitted.has(key)) continue
    emitted.add(key)
    out.push(winner.get(key)!)
  }
  return out
}

function walkListedLayers (layers: any[], visit: (layer: any) => void): void {
  for (const layer of (layers || []).filter(shouldList)) {
    visit(layer)
    walkListedLayers(childCollection(layer), visit)
  }
}

export function hideAtlasDuplicateAliases (webMap: any): void {
  const roots = (webMap?.layers?.toArray?.() || []).filter(shouldList)
  const groups = new Map<string, any[]>()
  for (const layer of roots) {
    const key = aliasKey(String(layer.title || layer.name || ''))
    if (!key) continue
    const list = groups.get(key) || []
    list.push(layer)
    groups.set(key, list)
  }
  for (const [, list] of groups) {
    if (list.length < 2) continue
    const ranked = [...list].sort((a, b) => {
      const kidsA = childCollection(a).length
      const kidsB = childCollection(b).length
      return kidsB - kidsA
    })
    const winner = ranked[0]
    for (const layer of list) {
      if (layer !== winner) layer.visible = false
    }
  }
}

function similarLayerName (a: string, b: string): boolean {
  const na = normalizeLayerName(a)
  const nb = normalizeLayerName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const ka = aliasKey(a)
  const kb = aliasKey(b)
  if (ka && ka === kb) return true
  const strip = (value: string) => value.replace(/bahia/g, '').replace(/ba$/, '')
  const sa = strip(na)
  const sb = strip(nb)
  return Boolean(sa && sb && sa === sb)
}

/** Grupo + subcamada com o mesmo nome vira um item só. */
function flattenWrapperLayers (nodes: AtlasLayerNode[]): AtlasLayerNode[] {
  const unwrap = (parentTitle: string, kids: AtlasLayerNode[]): AtlasLayerNode[] => {
    const out: AtlasLayerNode[] = []
    for (const child of kids) {
      const nested = child.children?.length ? unwrap(child.title, child.children) : []
      const next = { ...child, children: nested.length ? nested : undefined }
      if (similarLayerName(parentTitle, next.title)) {
        if (next.children?.length) out.push(...next.children)
        else out.push(next)
        continue
      }
      out.push(next)
    }
    return out
  }

  return nodes.map((node) => {
    const kids = node.children?.length ? flattenWrapperLayers(unwrap(node.title, node.children)) : []
    if (kids.length === 1 && similarLayerName(node.title, kids[0].title)) {
      return kids[0]
    }
    return { ...node, children: kids.length ? kids : undefined }
  })
}

export function listAtlasLayers (webMap: any): AtlasLayerNode[] {
  const root = webMap?.layers?.toArray?.() || []
  return flattenWrapperLayers(
    dedupeAtlasAliases(promoteSemiaridoToRoot(collectNodes(root, '').reverse()))
  )
}

function walkListedLayersKeep (
  layers: any[],
  kept: Set<string>,
  ancestorKept: boolean
): void {
  for (const layer of (layers || []).filter(shouldList)) {
    const title = String(layer?.title || layer?.name || '')
    const id = String(layer.id || layer.title || '')
    const isKept = kept.has(id)
    if (aliasKey(title) && !isKept && !ancestorKept) {
      layer.visible = false
    }
    walkListedLayersKeep(childCollection(layer), kept, ancestorKept || isKept)
  }
}

export function findAtlasLayer (webMap: any, uid: string): any | null {
  const parts = String(uid || '').split('/').filter(Boolean).map((part) => Number(part))
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null
  let pool = (webMap?.layers?.toArray?.() || []).filter(shouldList)
  let layer: any = null
  for (const index of parts) {
    layer = pool[index]
    if (!layer) return null
    pool = childCollection(layer).filter(shouldList)
  }
  return layer
}

export function atlasAncestorUids (uid: string): string[] {
  const parts = String(uid || '').split('/').filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < parts.length - 1; i++) {
    out.push(parts.slice(0, i + 1).join('/'))
  }
  return out
}

function setLayerTreeVisible (layer: any, visible: boolean): void {
  if (!layer) return
  const title = String(layer.title || layer.name || '')
  if (isTerritorioTotalLayer(title)) {
    layer.visible = false
    return
  }
  layer.visible = visible
  for (const child of childCollection(layer)) {
    if (shouldList(child)) setLayerTreeVisible(child, visible)
  }
}

function findNodeByUid (nodes: AtlasLayerNode[], uid: string): AtlasLayerNode | null {
  for (const node of nodes) {
    if (node.uid === uid) return node
    if (node.children?.length) {
      const nested = findNodeByUid(node.children, uid)
      if (nested) return nested
    }
  }
  return null
}

export function setAtlasLayerVisible (webMap: any, uid: string, visible: boolean): void {
  const node = findNodeByUid(listAtlasLayers(webMap), uid)
  const layer = node?.layer || findAtlasLayer(webMap, uid)
  if (!layer) return
  setLayerTreeVisible(layer, visible)
  if (visible) {
    let parent = layer.parent
    while (parent && parent !== webMap) {
      parent.visible = true
      parent = parent.parent
    }
    for (const ancestor of atlasAncestorUids(uid)) {
      const item = findAtlasLayer(webMap, ancestor)
      if (item) item.visible = true
    }
  }
}

function isMunicipiosLayer (title: string): boolean {
  if (atlasDisplayTitle(title) === 'Municípios') return true
  const name = normalizeLayerName(title)
  if (name === 'municipios') return true
  return name.includes('municipio') && (name.includes('censo') || name.includes('pda') || name.includes('dpa'))
}

function isStartupVisibleLayer (title: string, insideDefaultGroup: boolean): boolean {
  if (isSemiaridoLayer(title)) return false
  if (isTerritorioLayer(title) || isMunicipiosLayer(title)) return true
  return insideDefaultGroup
}

export function enableAtlasRootLayers (webMap: any): void {
  hideAtlasDuplicateAliases(webMap)

  const apply = (layers: any[], insideDefaultGroup: boolean): void => {
    for (const layer of (layers || []).filter(shouldList)) {
      const title = String(layer.title || layer.name || '')
      if (isTerritorioTotalLayer(title)) {
        layer.visible = false
        apply(childCollection(layer), false)
        continue
      }
      const visible = isStartupVisibleLayer(title, insideDefaultGroup)
      layer.visible = visible
      apply(childCollection(layer), visible)
    }
  }

  apply(webMap?.layers?.toArray?.() || [], false)

  const revealParents = (layers: any[]): boolean => {
    let anyVisible = false
    for (const layer of (layers || []).filter(shouldList)) {
      const childVisible = revealParents(childCollection(layer))
      if (childVisible) layer.visible = true
      if (layer.visible) anyVisible = true
    }
    return anyVisible
  }
  revealParents(webMap?.layers?.toArray?.() || [])

  hideAtlasDuplicateAliases(webMap)
}

export function layerHasMixedChildren (node: AtlasLayerNode): boolean {
  if (!node.children?.length) return false
  let on = 0
  let off = 0
  const walk = (list: AtlasLayerNode[]) => {
    for (const child of list) {
      if (child.visible) on += 1
      else off += 1
      if (child.children) walk(child.children)
    }
  }
  walk(node.children)
  return on > 0 && off > 0
}

export function setAllAtlasLayersVisible (webMap: any, visible: boolean): void {
  for (const node of listAtlasLayers(webMap)) {
    setAtlasLayerVisible(webMap, node.uid, visible)
  }
}

export function countVisibleLayers (nodes: AtlasLayerNode[]): { on: number, total: number } {
  let on = 0
  let total = 0
  const walk = (list: AtlasLayerNode[]) => {
    for (const node of list) {
      total += 1
      if (node.visible) on += 1
      if (node.children) walk(node.children)
    }
  }
  walk(nodes)
  return { on, total }
}

export function listAtlasLayerReportRows (nodes: AtlasLayerNode[]): string[][] {
  const rows: string[][] = []
  const walk = (list: AtlasLayerNode[], group: string) => {
    for (const node of list) {
      const name = atlasDisplayTitle(node.title)
      rows.push([name, node.visible ? 'Visível' : 'Oculta', group || '—'])
      if (node.children) walk(node.children, name)
    }
  }
  walk(nodes, '')
  return rows
}

export type AtlasMunicipioInfo = {
  nome: string
  codigo: string
  territorio: string
  semiarido: string
}

const NAME_FIELDS = ['nm_mun', 'nm_mun_1', 'municipio', 'nome_do_municipio', 'nome_municipio', 'nm_municipio', 'nom_municipio', 'nome']
const CODE_FIELDS = ['cd_mun', 'codibge', 'codigo_do_municipio', 'cd_ibge', 'geocodigo_ibge', 'cod_mun']
const TI_FIELDS = ['territorio_de_identidade', 'territorio', 'nm_ti', 'ti']
const SEMI_FIELDS = ['semiarido', 'regiao_semiarida', 'semi_arido']

function attrByCandidates (attrs: Record<string, any>, candidates: string[]): string {
  if (!attrs) return ''
  const keys = Object.keys(attrs)
  for (const candidate of candidates) {
    const want = normalizeLayerName(candidate)
    const hit = keys.find((key) => normalizeLayerName(key) === want)
    if (hit && attrs[hit] != null && String(attrs[hit]).trim()) return String(attrs[hit]).trim()
  }
  for (const candidate of candidates) {
    const want = normalizeLayerName(candidate)
    const hit = keys.find((key) => normalizeLayerName(key).includes(want))
    if (hit && attrs[hit] != null && String(attrs[hit]).trim()) return String(attrs[hit]).trim()
  }
  return ''
}

function pickDisplayField (layer: any): string {
  const names = (layer?.fields || []).map((field: any) => String(field?.name || ''))
  for (const candidate of NAME_FIELDS) {
    const hit = names.find((name) => normalizeLayerName(name) === normalizeLayerName(candidate))
    if (hit) return hit
  }
  for (const candidate of NAME_FIELDS) {
    const hit = names.find((name) => normalizeLayerName(name).includes(normalizeLayerName(candidate)))
    if (hit) return hit
  }
  return names[0] || 'nm_mun'
}

export function findAtlasMunicipioLayer (webMap: any): any | null {
  const found: any[] = []
  const visit = (layer: any) => {
    if (!layer) return
    const title = String(layer.title || layer.name || '')
    if (isMunicipiosLayer(title) || atlasDisplayTitle(title) === 'Municípios') found.push(layer)
    for (const child of childCollection(layer)) visit(child)
  }
  for (const layer of webMap?.layers?.toArray?.() || []) visit(layer)
  const asFeature = (layer: any): any | null => {
    if (!layer) return null
    if (/feature/i.test(String(layer.type || ''))) return layer
    for (const child of childCollection(layer)) {
      const nested = asFeature(child)
      if (nested) return nested
    }
    return null
  }
  for (const layer of found) {
    const feature = asFeature(layer)
    if (feature) return feature
  }
  return found[0] || null
}

function infoFromGraphic (graphic: any): AtlasMunicipioInfo {
  const attrs = graphic?.attributes || {}
  return {
    nome: attrByCandidates(attrs, NAME_FIELDS) || 'Município',
    codigo: attrByCandidates(attrs, CODE_FIELDS),
    territorio: attrByCandidates(attrs, TI_FIELDS),
    semiarido: attrByCandidates(attrs, SEMI_FIELDS)
  }
}

async function outlineMunicipio (view: any, graphic: any): Promise<void> {
  const [Graphic, GraphicsLayer] = await loadArcGISJSAPIModules(['esri/Graphic', 'esri/layers/GraphicsLayer'])
  if (!view.__atlasOutline) {
    view.__atlasOutline = new GraphicsLayer({ title: 'Município selecionado', listMode: 'hide' })
    view.map.add(view.__atlasOutline)
  }
  const layer = view.__atlasOutline
  try { view.map.reorder(layer, Math.max(0, (view.map?.layers?.length || 1) - 1)) } catch (_) {}
  layer.removeAll()
  if (!graphic?.geometry) return
  layer.add(new Graphic({
    geometry: graphic.geometry,
    symbol: {
      type: 'simple-fill',
      color: [47, 196, 255, 0.12],
      outline: { color: [255, 255, 255, 1], width: 3 }
    }
  }))
  layer.add(new Graphic({
    geometry: graphic.geometry,
    symbol: {
      type: 'simple-fill',
      color: [0, 0, 0, 0],
      outline: { color: [0, 34, 49, 1], width: 1.5 }
    }
  }))
}

export function clearAtlasMunicipio (view: any): void {
  try { view?.__atlasOutline?.removeAll?.() } catch (_) {}
}

export async function bindAtlasMunicipioSearch (view: any, webMap: any): Promise<void> {
  const search = view?.__atlasSearch
  const layer = findAtlasMunicipioLayer(webMap)
  if (!search || !layer) return
  await layer.load?.().catch(() => {})
  const displayField = pickDisplayField(layer)
  const names = (layer?.fields || []).map((field: any) => String(field?.name || ''))
  const searchFields = names.filter((name) => NAME_FIELDS.some((candidate) => {
    const a = normalizeLayerName(name)
    const b = normalizeLayerName(candidate)
    return a === b || a.includes(b) || b.includes(a)
  }))
  if (!searchFields.includes(displayField)) searchFields.unshift(displayField)
  search.sources = [{
    layer,
    searchFields: searchFields.length ? searchFields : [displayField],
    displayField,
    name: 'Municípios',
    placeholder: 'Buscar município…',
    maxResults: 12,
    maxSuggestions: 12,
    minSuggestCharacters: 2,
    exactMatch: false,
    outFields: ['*']
  }]
}

export function enableAtlasMunicipioSelect (
  view: any,
  webMap: any,
  onSelect: (info: AtlasMunicipioInfo) => void,
  onClear: () => void
): () => void {
  if (!view) return () => {}
  const search = view.__atlasSearch
  const selectGraphic = async (graphic: any, layer: any) => {
    if (!graphic) {
      clearAtlasMunicipio(view)
      onClear()
      return
    }
    await outlineMunicipio(view, graphic)
    if (graphic.geometry) {
      try {
        const target = graphic.geometry.extent
          ? graphic.geometry.extent.clone().expand(1.65)
          : graphic.geometry
        await view.goTo(target, { duration: 500 })
      } catch (_) {}
    }
    onSelect(infoFromGraphic(graphic))
    void layer
  }

  const searchHandle = search?.on?.('select-result', (event: any) => {
    const graphic = event?.result?.feature
    const layer = event?.result?.feature?.layer || findAtlasMunicipioLayer(webMap)
    void selectGraphic(graphic, layer)
  })

  const clickHandle = view.on('click', async (event: any) => {
    try {
      const layer = findAtlasMunicipioLayer(webMap)
      if (!layer) return
      const hit = await view.hitTest(event, { include: layer })
      const result = (hit?.results || []).find((item: any) => item?.graphic?.attributes)
      if (!result?.graphic) {
        clearAtlasMunicipio(view)
        onClear()
        return
      }
      await selectGraphic(result.graphic, layer)
    } catch (err) {
      console.warn('[atlas] Clique no município:', err)
    }
  })

  return () => {
    try { searchHandle?.remove?.() } catch (_) {}
    try { clickHandle?.remove?.() } catch (_) {}
  }
}
