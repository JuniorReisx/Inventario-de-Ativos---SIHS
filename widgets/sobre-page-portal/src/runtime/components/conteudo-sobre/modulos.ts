export type ModuleItem = {
  index: string
  title: string
  text: string
  pageLabel: string
  pageId: string
  matchStartsWith?: boolean
}

export const PORTAL_MODULOS: ModuleItem[] = [
  {
    index: '01',
    title: 'Início',
    text: 'Apresenta o Portal e leva às demais telas. Use os cartões para abrir infraestrutura, abastecimento, esgotamento ou o Atlas.',
    pageLabel: 'Ínicio',
    pageId: 'page_45'
  },
  {
    index: '02',
    title: 'Infraestrutura hídrica',
    text: 'Inventário no mapa: reservatórios, sistemas de abastecimento e poços. Filtre por território, semiárido ou município e leia os gráficos do recorte.',
    pageLabel: 'Infraestrutura Hídrica',
    pageId: 'page_41'
  },
  {
    index: '03',
    title: 'Abastecimento de água',
    text: 'Indicadores municipais de forma de abastecimento (SIDRA 6803). KPIs, composição, mapa e a divisão urbano/rural pelos setores censitários.',
    pageLabel: 'Abastecimento de Água',
    pageId: 'page_39'
  },
  {
    index: '04',
    title: 'Esgotamento sanitário',
    text: 'Indicadores municipais de tipo de esgoto (SIDRA 6805). Mesma lógica da água: totais oficiais no município e composição urbano/rural nos setores.',
    pageLabel: 'Esgotamento Sanitário',
    pageId: 'page_40'
  },
  {
    index: '05',
    title: 'Atlas',
    text: 'Mapas territoriais para consulta espacial da infraestrutura hídrica e do saneamento no Estado.',
    pageLabel: 'Atlas',
    pageId: 'page_52',
    matchStartsWith: true
  }
]
