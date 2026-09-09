import { React } from 'jimu-core'
import type { AssetLegendGroup } from '../../lib/legend'
import './style.css'

const { useState } = React

export default function MapLegend (props: {
  place: string
  loading: boolean
  groups: AssetLegendGroup[]
}) {
  const [open, setOpen] = useState(false)
  const total = props.groups.reduce((sum, group) => (
    group.showCount === false
      ? sum
      : sum + group.items.reduce((acc, item) => acc + item.count, 0)
  ), 0)

  return (
    <aside className={`infra-map-legend${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="infra-map-legend__toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>
          <small>Legenda</small>
          <strong>{props.place}</strong>
        </span>
        <em>{open ? '−' : '+'}</em>
      </button>
      {open
        ? (
          <div className="infra-map-legend__body">
            {props.loading
              ? <p className="infra-map-legend__empty">Atualizando legenda…</p>
              : !props.groups.length
                ? <p className="infra-map-legend__empty">Nada visível neste recorte</p>
                : props.groups.map((group) => (
                  <section key={group.id}>
                    <h4>{group.title}</h4>
                    <ul>
                      {group.items.map((item) => (
                        <li key={item.id} className={group.showCount === false ? 'is-swatch-only' : ''}>
                          <span
                            className="infra-map-legend__swatch"
                            dangerouslySetInnerHTML={{ __html: item.preview }}
                          />
                          <span className="infra-map-legend__label">{item.label}</span>
                          {group.showCount === false
                            ? null
                            : <span className="infra-map-legend__count">{item.count}</span>}
                        </li>
                      ))}
                    </ul>
                  </section>
                  ))}
            {!props.loading && total
              ? <p className="infra-map-legend__total">{total} ativos</p>
              : null}
          </div>
          )
        : null}
    </aside>
  )
}
