export function initPainelEsgoto (
  root: HTMLElement,
  geo: any,
  pts: any,
  mapApi?: any
): () => void

export {}

declare global {
  interface Window {
    GEO_DATA_ESGOTO?: any
    PTS_DATA_ESGOTO?: any[]
  }
}
