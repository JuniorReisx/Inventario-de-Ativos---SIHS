/**
 * Configuração central da aplicação.
 * NÃO coloque usuário ou senha neste arquivo.
 */

/** URL do Portal ArcGIS Enterprise */
export const PORTAL_URL = "https://portaldaagua.sihs.ba.gov.br/portal";

/** ID do Web Map existente no Portal */
export const WEB_MAP_ID = "de4fe17750f04ab5b3385733684604c8";

/**
 * Client ID OAuth (opcional).
 * Deixe vazio se o Web Map/serviços forem públicos.
 */
export const OAUTH_APP_ID = "";

/**
 * Faixa superior de indicadores (contagens por camada).
 * Valores vêm de query no ArcGIS — nunca hardcoded.
 */
export const HEADER_INDICATORS = [
  {
    id: "territorios",
    label: "Território de\nIdentidades",
    layerTitle: "Territórios de identidade",
    statisticType: "count",
    icon: "territorios",
    popup: {
      title: "Territórios de Identidade",
      mode: "list",
      field: "nom_ti",
      orderByFields: ["cod_tii ASC"],
      selectable: true,
      filterType: "territorio",
      hint: "Clique em um território para filtrar o painel"
    }
  },
  {
    id: "municipios",
    label: "Municípios",
    layerTitle: "Limites Municipais",
    statisticType: "count",
    icon: "municipios",
    popup: {
      title: "Pesquisar município",
      mode: "search",
      field: "nm_mun_1",
      filterType: "municipio",
      hint: "Digite o nome do município"
    }
  },
  {
    id: "semiarido",
    label: "Região\nSemiárida",
    // Valor oficial do Web Map: campo total_mun da camada Região Semiárida (283)
    layerTitle: "Região Semiárida",
    statisticType: "sum",
    onStatisticField: "total_mun",
    icon: "semiarido",
    popup: {
      title: "Região Semiárida",
      mode: "filterAction",
      filterType: "semiarido",
      description:
        "Atualizar o mapa e o painel Bahia em Números com o recorte da região semiárida.",
      actionLabel: "Aplicar filtro",
      source: "infoSEMIARIDO da SEI"
    }
  },
  {
    id: "reservatorios",
    label: "Reservatórios",
    layerTitle: "Reservatórios Tratado",
    statisticType: "count",
    icon: "reservatorios",
    popup: {
      title: "Tipos de Reservatórios",
      mode: "types",
      field: "uso_princ",
      source: "SNISB-ANA"
    }
  },
  {
    id: "pocos",
    label: "Poços",
    layerTitle: "Poços",
    statisticType: "count",
    icon: "pocos",
    popup: {
      title: "Tipos de Poços",
      mode: "types",
      field: "clas_poco",
      source: "CERB"
    }
  },
  {
    id: "sistemas",
    label: "Sistemas de\nAbastecimento",
    layerTitle: "Sistemas de Abastecimento",
    statisticType: "count",
    icon: "sistemas",
    /**
     * Total cadastrado = pontos geolocalizados (Web Map) + tabela CERB (sem geometria).
     * O número grande mostra o TOTAL; o rodapé mostra quantos estão no mapa.
     */
    dualCount: {
      showPrimary: "total",
      geolocalizedFromLayer: true,
      additionalCountUrls: [
        "https://maps.sihs.ba.gov.br/server/rest/services/Sistemas/Sistemas/FeatureServer/1"
      ],
      metaTemplate: "{geolocalized} geolocalizados"
    },
    popup: {
      title: "Tipos de Sistemas (geolocalizados)",
      mode: "types",
      field: "tipo_sistema",
      source: "CERB"
    }
  }
];

/**
 * Painel "Bahia em Números".
 * Camada principal: Limites Municipais (atributos demográficos).
 *
 * statisticType:
 *   - count | sum | avg | min | max
 *   - density → sum(numeratorField) / sum(denominatorField)
 */
export const STAT_CARDS = [
  {
    id: "pop_total",
    label: "População total",
    layerTitle: "LIMITE_BAHIA",
    statisticType: "sum",
    onStatisticField: "pop_est_2026",
    size: "large",
    filteredScope: {
      layerTitle: "Limites Municipais",
      onStatisticField: "total_1",
      statisticType: "sum",
      sourceLabel: "Censo IBGE 2022"
    }
  },
  {
    id: "pop_indigena",
    label: "População Indígena",
    layerTitle: "Limites Municipais",
    statisticType: "sum",
    onStatisticField: "pessoa_indigena",
    size: "small"
  },
  {
    id: "pop_quilombola",
    label: "População Quilombola",
    layerTitle: "Limites Municipais",
    statisticType: "sum",
    onStatisticField: "pessoa_quilombola",
    size: "small"
  },
  {
    id: "pop_mulheres",
    label: "População Mulheres",
    layerTitle: "Limites Municipais",
    statisticType: "sum",
    onStatisticField: "total_mul_1",
    size: "small"
  },
  {
    id: "densidade",
    label: "Densidade Demográfica",
    layerTitle: "Limites Municipais",
    statisticType: "density",
    numeratorField: "total_1",
    denominatorField: "a_munkm2",
    decimals: 2,
    size: "small"
  },
  {
    id: "domicilios",
    label: "Domicílios Recenseados",
    layerTitle: "Limites Municipais",
    statisticType: "sum",
    onStatisticField: "domicilios_recenseados",
    size: "small"
  },
  {
    id: "pop_homens",
    label: "População Homens",
    layerTitle: "Limites Municipais",
    statisticType: "sum",
    onStatisticField: "total_hom_1",
    size: "small"
  }
];

/**
 * Gráfico Rural x Urbana a partir dos Setores Censitários (2022).
 */
export const POPULATION_CHART = {
  title: "Distribuição por População",
  layerTitle: "Setores Censitários",
  populationField: "v0001",
  source: "IBGE — Censo Demográfico 2022",
  series: [
    {
      id: "rural",
      label: "Rural",
      where: "situacao = 'Rural'",
      color: "#1eb1b9"
    },
    {
      id: "urbana",
      label: "Urbana",
      where: "situacao = 'Urbana'",
      color: "#00213b"
    }
  ]
};

/** Mantido por compatibilidade — o dashboard usa HEADER_INDICATORS + STAT_CARDS */
export const CARD_DEFINITIONS = [];
export const AUTO_CARD_LIMIT = 6;
export const ARCGIS_SDK_VERSION = "4.32";
