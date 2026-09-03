import { React, type AllWidgetProps } from 'jimu-core'
import HeroAbastecimento from './components/hero-abastecimento'
import PainelAgua from './components/painel-agua'
import KaioChat from './components/kaio-chat'
import './style.css'

const Widget = (props: AllWidgetProps<any>) => {
  return (
    <div className="abas-page jimu-widget">
      <div className="abas-page__hero">
        <HeroAbastecimento />
      </div>
      <div className="abas-page__painel">
        <PainelAgua folderUrl={props.context.folderUrl} />
      </div>
      <KaioChat folderUrl={props.context.folderUrl} />
    </div>
  )
}

export default Widget
