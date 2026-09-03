export function formatValue (value: number | string | null | undefined, decimals?: number): string {
  if (value === null || value === undefined || Number.isNaN(value as number)) {
    return '—'
  }

  if (typeof value === 'number') {
    if (typeof decimals === 'number') {
      return new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(value)
    }
    return new Intl.NumberFormat('pt-BR').format(value)
  }

  return String(value)
}

/** Ícones em imagem (arquivo em src/runtime/assets) */
export const KPI_ICON_IMAGES: Record<string, string> = {
  territorios: 'ti-ba.png',
  sistemas: 'sistema-agua.png',
  semiarido: 'semiarido.png',
  pocos: 'pocos.png',
  reservatorios: 'barragens.png',
  municipios: 'municipios.png'
}

export const KPI_ICONS: Record<string, string> = {
  territorios: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7.5 9 4l5 3.5L19 4v12.5L14 20l-5-3.5L4 20z"/>
      <path d="M9 4v12.5M14 7.5V20"/>
    </svg>`,
  municipios: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h16"/>
      <path d="M6 20V9l5-3 5 3v11"/>
      <path d="M10 20v-5h4v5"/>
      <path d="M9 11h.01M15 11h.01M9 14h.01M15 14h.01"/>
    </svg>`,
  semiarido: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="17" cy="7" r="3"/>
      <path d="M17 2v2M17 10v2M12 7h2M20 7h2"/>
      <path d="M5 20V10"/>
      <path d="M5 13H2"/>
      <path d="M5 16h3"/>
      <path d="M9 20V12"/>
      <path d="M9 14h3"/>
    </svg>`,
  reservatorios: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10h18"/>
      <path d="M5 10V7h14v3"/>
      <path d="M4 10c1.5 4 3 7 8 7s6.5-3 8-7"/>
      <path d="M8 14.5c1 .8 2.2 1.2 4 1.2s3-.4 4-1.2"/>
    </svg>`,
  pocos: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h8v3H8z"/>
      <path d="M10 7v13"/>
      <path d="M14 7v13"/>
      <path d="M9 12h6"/>
      <path d="M9 16h6"/>
      <path d="M7 20h10"/>
    </svg>`,
  sistemas: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="8" width="5" height="10" rx="1"/>
      <rect x="10" y="5" width="5" height="13" rx="1"/>
      <rect x="17" y="9" width="4" height="9" rx="1"/>
      <path d="M5.5 8V5M12.5 5V3M19 9V7"/>
    </svg>`
}

export function getKpiIconHtml (iconKey: string | undefined, folderUrl: string): string {
  const key = iconKey || 'municipios'
  const imageName = KPI_ICON_IMAGES[key]
  if (imageName) {
    const src = `${folderUrl}dist/runtime/assets/${imageName}`
    return `<img class="kpi-icon__img" src="${src}" alt="" aria-hidden="true" />`
  }
  return KPI_ICONS[key] || KPI_ICONS.municipios
}
