export type ParsedCoord = {
  lat: number
  lon: number
}

const HEMI_LAT: Record<string, 1 | -1> = {
  n: 1,
  norte: 1,
  s: -1,
  sul: -1
}

const HEMI_LON: Record<string, 1 | -1> = {
  e: 1,
  l: 1,
  leste: 1,
  este: 1,
  w: -1,
  o: -1,
  oeste: -1
}

function normalizeCoordText (value: string): string {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/coordenadas?/gi, ' ')
    .replace(/passe o cursor no mapa/gi, ' ')
    .replace(/[º˚]/g, '°')
    .replace(/[′´`ʼ＇]/g, "'")
    .replace(/[″“”＂]/g, '"')
    .replace(/''+/g, '"')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[,;/|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hemiKey (raw: string | undefined, kind: 'lat' | 'lon'): string {
  const key = String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
  if (!key) return ''
  if (kind === 'lat') return HEMI_LAT[key] ? key : (key.startsWith('s') ? 's' : key.startsWith('n') ? 'n' : '')
  if (HEMI_LON[key]) return key
  if (key.startsWith('o') || key.startsWith('w')) return 'o'
  if (key.startsWith('l') || key.startsWith('e')) return 'l'
  return ''
}

function applyHemi (value: number, hemi: string, kind: 'lat' | 'lon'): number {
  const mag = Math.abs(value)
  if (kind === 'lat') {
    const sign = HEMI_LAT[hemi]
    if (sign) return mag * sign
  } else {
    const sign = HEMI_LON[hemi]
    if (sign) return mag * sign
  }
  return value
}

function dmsValue (deg: string, min?: string, sec?: string): number {
  const d = Number(deg)
  const m = Number(min || 0)
  const s = Number(sec || 0)
  if (![d, m, s].every(Number.isFinite)) return NaN
  const sign = d < 0 ? -1 : 1
  return sign * (Math.abs(d) + Math.abs(m) / 60 + Math.abs(s) / 3600)
}

const HEMI_WORD = 'norte|sul|leste|oeste|este|[nsewol]'

function extractParts (text: string): Array<{ value: number, hemi: string }> {
  const packed = new RegExp(
    `(-?\\d{1,3}(?:\\.\\d+)?)\\s*°\\s*(\\d{1,2}(?:\\.\\d+)?)\\s*'\\s*(\\d{1,2}(?:\\.\\d+)?)\\s*"?\\s*(${HEMI_WORD})?`,
    'gi'
  )
  const packedParts: Array<{ value: number, hemi: string }> = []
  let packedMatch: RegExpExecArray | null
  while ((packedMatch = packed.exec(text)) && packedParts.length < 2) {
    const value = dmsValue(packedMatch[1], packedMatch[2], packedMatch[3])
    if (!Number.isFinite(value)) continue
    packedParts.push({ value, hemi: String(packedMatch[4] || '').toLowerCase() })
  }
  if (packedParts.length >= 2) return packedParts

  const spaced = new RegExp(
    `(-?\\d{1,3}(?:\\.\\d+)?)\\s+(\\d{1,2}(?:\\.\\d+)?)\\s+(\\d{1,2}(?:\\.\\d+)?)\\s*(${HEMI_WORD})`,
    'gi'
  )
  const spacedParts: Array<{ value: number, hemi: string }> = []
  let spacedMatch: RegExpExecArray | null
  while ((spacedMatch = spaced.exec(text)) && spacedParts.length < 2) {
    const value = dmsValue(spacedMatch[1], spacedMatch[2], spacedMatch[3])
    if (!Number.isFinite(value)) continue
    spacedParts.push({ value, hemi: String(spacedMatch[4] || '').toLowerCase() })
  }
  if (spacedParts.length >= 2) return spacedParts

  const dms = new RegExp(
    `(-?\\d{1,3}(?:\\.\\d+)?)(?:\\s*°\\s*(\\d{1,2}(?:\\.\\d+)?)(?:\\s*'\\s*(\\d{1,2}(?:\\.\\d+)?)(?:\\s*")?)?)?\\s*(${HEMI_WORD})?`,
    'gi'
  )
  const parts: Array<{ value: number, hemi: string }> = []
  let match: RegExpExecArray | null
  while ((match = dms.exec(text)) && parts.length < 2) {
    const hasDms = match[2] != null || /[°']/.test(match[0])
    const value = hasDms ? dmsValue(match[1], match[2], match[3]) : Number(match[1])
    if (!Number.isFinite(value)) continue
    parts.push({ value, hemi: String(match[4] || '').toLowerCase() })
  }
  return parts
}

export function parseGeoCoordinate (input: string): ParsedCoord | null {
  const text = normalizeCoordText(input)
  if (!text) return null

  const parts = extractParts(text)
  if (parts.length < 2) return null

  let lat = parts[0].value
  let lon = parts[1].value
  const hemi0 = hemiKey(parts[0].hemi, 'lat') || hemiKey(parts[0].hemi, 'lon')
  const hemi1 = hemiKey(parts[1].hemi, 'lon') || hemiKey(parts[1].hemi, 'lat')

  if (HEMI_LON[hemi0] && HEMI_LAT[hemi1]) {
    lon = applyHemi(parts[0].value, hemi0, 'lon')
    lat = applyHemi(parts[1].value, hemi1, 'lat')
  } else {
    lat = applyHemi(lat, hemiKey(parts[0].hemi, 'lat'), 'lat')
    lon = applyHemi(lon, hemiKey(parts[1].hemi, 'lon'), 'lon')
  }

  if (!parts[0].hemi && !parts[1].hemi && lat > 0 && lon > 0 && lat <= 18 && lon >= 30 && lon <= 48) {
    lat = -lat
    lon = -lon
  }

  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) {
    const swap = lat
    lat = lon
    lon = swap
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

export function formatCoordLabel (coord: ParsedCoord): string {
  return `${formatCoordDms(coord)}  (${coord.lat.toFixed(6)}, ${coord.lon.toFixed(6)})`
}

function webMercatorToLonLat (x: number, y: number): ParsedCoord {
  const lon = (x / 20037508.34) * 180
  const lat = (180 / Math.PI) * (2 * Math.atan(Math.exp(((y / 20037508.34) * 180) * Math.PI / 180)) - Math.PI / 2)
  return { lat, lon }
}

export function coordFromGeometry (geometry: any): ParsedCoord | null {
  if (!geometry) return null

  let lon = Number(geometry.longitude)
  let lat = Number(geometry.latitude)
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    const extent = geometry.extent
    const x = Number(geometry.x ?? extent?.center?.x ?? ((Number(extent?.xmin) + Number(extent?.xmax)) / 2))
    const y = Number(geometry.y ?? extent?.center?.y ?? ((Number(extent?.ymin) + Number(extent?.ymax)) / 2))
    const wkid = Number(geometry.spatialReference?.wkid || geometry.spatialReference?.latestWkid || extent?.spatialReference?.wkid)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    if (wkid === 4326 || wkid === 4674 || wkid === 4269) {
      lon = x
      lat = y
    } else if (wkid === 3857 || wkid === 102100 || wkid === 102113 || Math.abs(x) > 180) {
      const converted = webMercatorToLonLat(x, y)
      lon = converted.lon
      lat = converted.lat
    } else {
      lon = x
      lat = y
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}

function dmsPart (value: number, positive: string, negative: string): string {
  const hemi = value < 0 ? negative : positive
  let mag = Math.abs(value)
  let deg = Math.floor(mag)
  let minutes = (mag - deg) * 60
  let min = Math.floor(minutes)
  let sec = Math.round((minutes - min) * 60)
  if (sec === 60) {
    sec = 0
    min += 1
  }
  if (min === 60) {
    min = 0
    deg += 1
  }
  return `${deg}°${min}'${sec}"${hemi}`
}

export function formatCoordDms (coord: ParsedCoord): string {
  return `${dmsPart(coord.lat, 'N', 'S')} ${dmsPart(coord.lon, 'E', 'W')}`
}

export function formatGeometryCoord (geometry: any): string {
  const coord = coordFromGeometry(geometry)
  return coord ? formatCoordDms(coord) : ''
}
