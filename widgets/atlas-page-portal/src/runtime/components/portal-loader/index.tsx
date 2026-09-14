import { React } from 'jimu-core'
import './style.css'

export default function PortalLoader (props: {
  folderUrl?: string
  label?: string
  compact?: boolean
  overlay?: boolean
}) {
  const label = props.label || 'Carregando'
  const mark = (
    <div
      className={`portal-loader-atlas${props.compact ? ' is-compact' : ''}`}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="portal-loader__bowl">
        <div className="portal-loader__waves" />
      </div>
      {!props.compact
        ? <span className="portal-loader-atlas__label">{label}</span>
        : null}
    </div>
  )
  if (!props.overlay) return mark
  return <div className="portal-loader-atlas-overlay">{mark}</div>
}
