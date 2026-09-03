export function initPainelAgua (
  root: HTMLElement,
  geo: any,
  pts: any,
  mapApi?: any
): () => void

export {}

declare global {
  interface Window {
    GEO_DATA_AGUA?: any
    PTS_DATA_AGUA?: any[]
  }
}
