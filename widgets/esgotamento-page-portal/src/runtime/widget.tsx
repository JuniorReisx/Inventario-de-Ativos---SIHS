import { React, type AllWidgetProps } from 'jimu-core'
import HeroEsgotamento from './components/hero-esgotamento'
import PainelEsgoto from './components/painel-esgoto'
import './style.css'

const Widget = (props: AllWidgetProps<any>) => {
  return (
    <div className="esgo-page jimu-widget">
      <div className="esgo-page__hero">
        <HeroEsgotamento />
      </div>
      <div className="esgo-page__painel">
        <PainelEsgoto folderUrl={props.context.folderUrl} />
      </div>
    </div>
  )
}

export default Widget
