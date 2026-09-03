import { React } from 'jimu-core'
import type { PopupRow } from '../../lib/popup'
import PortalLoader from '../portal-loader'

export default function AtivoPopup (props: {
  title?: string
  folderUrl: string
  loading: boolean
  error?: string
  rows: PopupRow[]
}) {
  if (props.loading) {
    return (
      <div className="infra-ativo-popup" role="status">
        <PortalLoader folderUrl={props.folderUrl} compact label="Carregando detalhes" />
      </div>
    )
  }

  if (props.error) {
    return (
      <div className="infra-ativo-popup" role="status">
        <p className="infra-ativo-popup__status">{props.error}</p>
      </div>
    )
  }

  return (
    <div className="infra-ativo-popup">
      {props.title
        ? <p className="infra-ativo-popup__title">{props.title}</p>
        : null}
      <dl>
        {props.rows.map((row) => (
          <div key={row.label} className="infra-ativo-popup__row">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
