import { React, type AllWidgetProps } from 'jimu-core'
import AtlasMap from './components/atlas-map'
import KaioChat from './components/kaio-chat'
import './style.css'

const Widget = (props: AllWidgetProps<any>) => {
  return (
    <div className="atlas-page jimu-widget">
      <div className="atlas-page__stage">
        <AtlasMap folderUrl={props.context.folderUrl} />
      </div>
      <KaioChat folderUrl={props.context.folderUrl} />
    </div>
  )
}

export default Widget
