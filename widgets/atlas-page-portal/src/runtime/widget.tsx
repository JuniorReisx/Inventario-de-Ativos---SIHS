import { React, type AllWidgetProps } from 'jimu-core'
import AtlasMap from './components/atlas-map'
import './style.css'

const Widget = (props: AllWidgetProps<any>) => {
  return (
    <div className="atlas-page jimu-widget">
      <div className="atlas-page__stage">
        <AtlasMap folderUrl={props.context.folderUrl} />
      </div>
    </div>
  )
}

export default Widget
