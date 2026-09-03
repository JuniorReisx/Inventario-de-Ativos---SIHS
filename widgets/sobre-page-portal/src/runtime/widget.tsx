import { React, type AllWidgetProps } from 'jimu-core'
import HeroSobre from './components/hero-sobre'
import ConteudoSobre from './components/conteudo-sobre'
import './style.css'

const Widget = (_props: AllWidgetProps<any>) => {
  return (
    <div className="sobre-page jimu-widget">
      <div className="sobre-page__hero">
        <HeroSobre />
      </div>
      <div className="sobre-page__body">
        <ConteudoSobre />
      </div>
    </div>
  )
}

export default Widget
