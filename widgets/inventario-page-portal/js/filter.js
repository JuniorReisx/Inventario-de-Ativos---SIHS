/**
 * Estado e construção de filtros para o painel "Bahia em Números".
 */

/** @typedef {'all'|'territorio'|'municipio'|'semiarido'} FilterType */

/**
 * @typedef {Object} DashboardFilter
 * @property {FilterType} type
 * @property {string} label
 * @property {string} munWhere        where para Limites Municipais
 * @property {string} setoresWhere    where para Setores Censitários
 * @property {string} [zoomLayerTitle]
 * @property {string} [zoomWhere]
 * @property {__esri.Geometry|null} [geometry] geometria espacial (ex.: polígono semiárido)
 */

/** @type {DashboardFilter} */
export const FILTER_ALL = {
  type: "all",
  label: "Estado da Bahia",
  munWhere: "1=1",
  setoresWhere: "1=1",
  zoomLayerTitle: "LIMITE_BAHIA",
  zoomWhere: "1=1",
  geometry: null
};

/**
 * @param {string} territoryName
 * @returns {DashboardFilter}
 */
export function createTerritoryFilter(territoryName) {
  const name = escapeSqlString(territoryName);
  return {
    type: "territorio",
    label: territoryName,
    munWhere: `nm_ti = '${name}'`,
    setoresWhere: `nm_ti = '${name}'`,
    zoomLayerTitle: "Territórios de identidade",
    zoomWhere: `nom_ti = '${name}'`,
    geometry: null
  };
}

/**
 * @param {string} municipalityName
 * @returns {DashboardFilter}
 */
export function createMunicipalityFilter(municipalityName) {
  const name = escapeSqlString(municipalityName);
  return {
    type: "municipio",
    label: municipalityName,
    munWhere: `nm_mun_1 = '${name}'`,
    setoresWhere: `nm_mun = '${name}'`,
    zoomLayerTitle: "Limites Municipais",
    zoomWhere: `nm_mun_1 = '${name}'`,
    geometry: null
  };
}

/**
 * Filtro da região semiárida.
 * Preferir geometria da camada "Região Semiárida" (oficial do Web Map).
 * @param {__esri.Geometry|null} [geometry]
 * @returns {DashboardFilter}
 */
export function createSemiaridoFilter(geometry = null) {
  return {
    type: "semiarido",
    label: "Região Semiárida",
    // Quando há geometria, o recorte espacial é a fonte da verdade (283 mun.).
    munWhere: geometry ? "1=1" : "semiarido = 'SIM'",
    setoresWhere: geometry ? "1=1" : "semiarido = 'SIM'",
    zoomLayerTitle: "Região Semiárida",
    zoomWhere: "1=1",
    geometry
  };
}

/**
 * Combina cláusulas where com AND.
 * @param {...(string|null|undefined)} parts
 */
export function combineWhere(...parts) {
  const valid = parts
    .map((part) => (part || "").trim())
    .filter((part) => part && part !== "1=1");

  if (!valid.length) return "1=1";
  if (valid.length === 1) return valid[0];
  return valid.map((part) => `(${part})`).join(" AND ");
}

/**
 * @param {string} value
 */
export function escapeSqlString(value) {
  return String(value ?? "").replaceAll("'", "''");
}

/**
 * Título do painel conforme o filtro.
 * @param {DashboardFilter} filter
 */
export function getStatsPanelTitle(filter) {
  if (!filter || filter.type === "all") return "BAHIA EM NÚMEROS";
  if (filter.type === "territorio") {
    return `${String(filter.label).toUpperCase()} EM NÚMEROS`;
  }
  if (filter.type === "municipio") {
    return `${String(filter.label).toUpperCase()} EM NÚMEROS`;
  }
  if (filter.type === "semiarido") return "REGIÃO SEMIÁRIDA EM NÚMEROS";
  return "BAHIA EM NÚMEROS";
}
