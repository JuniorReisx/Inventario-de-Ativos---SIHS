export const DEFAULT_PORTAL_URL = 'https://portaldaagua.sihs.ba.gov.br/portal'
export const DEFAULT_WEB_MAP_ID = 'de4fe17750f04ab5b3385733684604c8'
export const DEFAULT_OAUTH_APP_ID = ''

/** Camada municipal atualizada (Censo 2022) — fonte de municípios (estado / TI). */
export const DPA_MUNICIPIO_LAYER_TITLE = 'PDA_Indicadores_Censo_2022'
/** População municipal estimada IBGE 2025 (último campo da camada de município). */
export const MUNICIPIO_POP_EST_2025_FIELD = 'estimativa_pop_2025'
/** Recorte oficial da região semiárida (abastecimento, esgotamento e demais indicadores). */
export const SEMIARIDO_LAYER_TITLE = 'Região Semiárida_BA'

export type PopupMode = 'list' | 'search' | 'types' | 'filterAction'

export interface IndicatorPopup {
  title: string
  mode: PopupMode
  field?: string
  orderByFields?: string[]
  selectable?: boolean
  filterType?: 'territorio' | 'municipio' | 'semiarido'
  hint?: string
  description?: string
  actionLabel?: string
  source?: string
  secondaryField?: string
  secondaryTitle?: string
}

export interface DualCountConfig {
  showPrimary: 'total' | 'geolocalized'
  geolocalizedFromLayer?: boolean
  additionalCountUrls?: string[]
  metaTemplate?: string
}

export interface IndicatorDefinition {
  id: string
  label: string
  layerTitle: string
  layerId?: string
  statisticType?: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'density'
  onStatisticField?: string
  numeratorField?: string
  denominatorField?: string
  where?: string
  decimals?: number
  unit?: string
  size?: 'large' | 'small'
  icon?: string
  popup?: IndicatorPopup
  dualCount?: DualCountConfig
  /** Quando true, o indicador só vale para o Estado (sem filtro territorial). */
  stateOnly?: boolean
  /** Recorte territorial: usa outra camada/campo (ex.: Censo municipal). */
  filteredScope?: {
    layerTitle: string
    onStatisticField?: string
    statisticType?: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'density'
    numeratorField?: string
    denominatorField?: string
    sourceLabel?: string
  }
}

export interface ChartSeriesDef {
  id: string
  label: string
  color: string
  field?: string
  where?: string
  filteredField?: string
}

export interface PopulationChartConfig {
  title: string
  layerTitle: string
  populationField?: string
  filteredLayerTitle?: string
  series: ChartSeriesDef[]
  source?: string
}

export const HEADER_INDICATORS: IndicatorDefinition[] = [
  {
    id: 'territorios',
    label: 'Território de\nIdentidades',
    layerTitle: 'Territórios de Identidade',
    statisticType: 'count',
    icon: 'territorios',
    popup: {
      title: 'Territórios de Identidade',
      mode: 'list',
      field: 'nm_ti',
      orderByFields: ['cd_ti ASC'],
      selectable: true,
      filterType: 'territorio',
      hint: 'Clique em um território para filtrar o painel'
    }
  },
  {
    id: 'municipios',
    label: 'Municípios',
    layerTitle: DPA_MUNICIPIO_LAYER_TITLE,
    statisticType: 'count',
    icon: 'municipios',
    popup: {
      title: 'Pesquisar município',
      mode: 'search',
      field: 'nome_do_municipio',
      filterType: 'municipio',
      hint: 'Digite o nome do município'
    }
  },
  {
    id: 'semiarido',
    label: 'Região\nSemiárida',
    layerTitle: SEMIARIDO_LAYER_TITLE,
    statisticType: 'count',
    icon: 'semiarido',
    popup: {
      title: 'Região Semiárida',
      mode: 'filterAction',
      filterType: 'semiarido',
      description:
        'Atualizar o mapa e o painel Bahia em Números com o recorte da região semiárida.',
      actionLabel: 'Aplicar filtro',
      source: 'infoSEMIARIDO da SEI · 2026'
    }
  },
  {
    id: 'reservatorios',
    label: 'Reservatórios',
    layerTitle: 'Reservatórios',
    statisticType: 'count',
    icon: 'reservatorios',
    popup: {
      title: 'Uso principal',
      mode: 'types',
      field: 'uso_princ',
      hint: 'Cada barragem tem um uso principal cadastrado. Isso não significa que ela sirva só para isso: a mesma barragem pode ter usos complementares.',
      secondaryField: 'uso_comp',
      secondaryTitle: 'Uso complementar',
      source: 'SNISB-ANA · 2026'
    }
  },
  {
    id: 'pocos',
    label: 'Poços',
    layerTitle: 'Poços',
    statisticType: 'count',
    icon: 'pocos',
    popup: {
      title: 'Tipos de Poços',
      mode: 'types',
      field: 'clas_poco',
      source: 'CERB · 2026'
    }
  },
  {
    id: 'sistemas',
    label: 'Sistemas de\nAbastecimento',
    layerTitle: 'Sistemas de Abastecimento',
    statisticType: 'count',
    icon: 'sistemas',
    dualCount: {
      showPrimary: 'total',
      geolocalizedFromLayer: true,
      additionalCountUrls: [
        'https://maps.sihs.ba.gov.br/server/rest/services/Sistemas/Sistemas/FeatureServer/1'
      ],
      metaTemplate: '{geolocalized} geolocalizados'
    },
    popup: {
      title: 'Tipos de Sistemas (geolocalizados)',
      mode: 'types',
      field: 'tipo_sistema',
      source: 'CERB · 2026'
    }
  }
]

export const STAT_CARDS: IndicatorDefinition[] = [
  {
    id: 'pop_total',
    label: 'População total',
    layerTitle: 'Limite Bahia',
    statisticType: 'sum',
    onStatisticField: 'pop_est_2025',
    size: 'large',
    filteredScope: {
      layerTitle: DPA_MUNICIPIO_LAYER_TITLE,
      onStatisticField: MUNICIPIO_POP_EST_2025_FIELD,
      statisticType: 'sum',
      sourceLabel: 'Estimativa IBGE 2025'
    }
  },
  {
    id: 'pop_indigena',
    label: 'População Indígena',
    layerTitle: DPA_MUNICIPIO_LAYER_TITLE,
    statisticType: 'sum',
    onStatisticField: 'pessoas_indigenas__2022_',
    size: 'small'
  },
  {
    id: 'pop_quilombola',
    label: 'População Quilombola',
    layerTitle: DPA_MUNICIPIO_LAYER_TITLE,
    statisticType: 'sum',
    onStatisticField: 'pessoas_quilombolas__2022_',
    size: 'small'
  },
  {
    id: 'pop_mulheres',
    label: 'População Mulheres',
    layerTitle: DPA_MUNICIPIO_LAYER_TITLE,
    statisticType: 'sum',
    onStatisticField: 'população_mulheres__2022_',
    size: 'small'
  },
  {
    id: 'densidade',
    label: 'Densidade Demográfica',
    layerTitle: 'Limite Bahia',
    statisticType: 'avg',
    onStatisticField: 'densi_demografica_2022',
    decimals: 2,
    unit: 'hab/km²',
    size: 'small',
    filteredScope: {
      layerTitle: DPA_MUNICIPIO_LAYER_TITLE,
      statisticType: 'avg',
      onStatisticField: 'densidade_demografica_hab_km__2',
      sourceLabel: 'Censo IBGE 2022'
    }
  },
  {
    id: 'domicilios',
    label: 'Domicílios Recenseados',
    layerTitle: DPA_MUNICIPIO_LAYER_TITLE,
    statisticType: 'sum',
    onStatisticField: 'total_domicílios_recenseados__2',
    size: 'small'
  },
  {
    id: 'pop_homens',
    label: 'População Homens',
    layerTitle: DPA_MUNICIPIO_LAYER_TITLE,
    statisticType: 'sum',
    onStatisticField: 'população_de_homens__2022_',
    size: 'small'
  }
]

export const POPULATION_CHART: PopulationChartConfig = {
  title: 'Distribuição da População',
  layerTitle: 'Limite Bahia',
  filteredLayerTitle: DPA_MUNICIPIO_LAYER_TITLE,
  source: 'IBGE — Censo Demográfico 2022',
  series: [
    {
      id: 'rural',
      label: 'Rural',
      field: 'pop_rural_2022',
      filteredField: 'st_d_rural_1',
      color: '#1eb1b9'
    },
    {
      id: 'urbana',
      label: 'Urbana',
      field: 'pop_urb_2022',
      filteredField: 'st_d_urba_1',
      color: '#00213b'
    }
  ]
}
