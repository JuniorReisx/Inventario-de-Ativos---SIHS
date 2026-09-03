import { React, type AllWidgetProps } from 'jimu-core'
import './style.css'

const Widget = (props: AllWidgetProps<any>) => {
  const year = new Date().getFullYear()

  const portalUrl = `${props.context.folderUrl}dist/runtime/assets/portal.png`
  const brasaoUrl = `${props.context.folderUrl}dist/runtime/assets/brasao.png`

  return (
    <div className="fp-footer jimu-widget">
      <footer className="fp-footer__shell">
        <div className="fp-footer__main">
          <section className="fp-footer__brand">
            <div className="fp-footer__logos">
              <img className="fp-footer__portal" src={portalUrl} alt="Portal da Água" />
              <img className="fp-footer__brasao" src={brasaoUrl} alt="Brasão do Estado da Bahia" />
            </div>
            <div className="fp-footer__brand-text">
              <p className="fp-footer__eyebrow">Governo do Estado da Bahia</p>
              <h2 className="fp-footer__title">SIHS — Secretaria de Infraestrutura Hídrica e Saneamento</h2>
              <p className="fp-footer__desc">
                Inventário de ativos de infraestrutura hídrica e saneamento para apoiar a gestão,
                o planejamento e a tomada de decisão na Bahia.
              </p>
            </div>
          </section>

          <section>
            <h3 className="fp-footer__col-title">Endereço</h3>
            <div className="fp-footer__info">
              <p>
                3ª Avenida, nº 390, Ala Norte, 2º andar — CAB
                <br />
                CEP 41.745-005 — Salvador — Bahia
              </p>
            </div>
          </section>
        </div>

        <div className="fp-footer__bottom">
          <p className="fp-footer__copy">
            © {year} SIHS — Secretaria de Infraestrutura Hídrica e Saneamento — Bahia
          </p>
        </div>
      </footer>
    </div>
  )
}

export default Widget
