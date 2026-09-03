/**
 * Consultas e estatísticas sobre FeatureLayers do Web Map.
 * Fonte dos dados: ArcGIS Enterprise (via queryFeatures / outStatistics).
 */

/**
 * Conta registros de uma camada.
 * @param {__esri.FeatureLayer} layer
 * @param {string} [where="1=1"]
 * @returns {Promise<number>}
 */
export async function countFeatures(layer, where = "1=1", geometry = null) {
  await layer.load();

  const params = { where };
  if (geometry) {
    params.geometry = geometry;
    params.spatialRelationship = "intersects";
  }

  if (typeof layer.queryFeatureCount === "function") {
    return layer.queryFeatureCount(params);
  }

  const result = await queryStatistics(layer, {
    where,
    geometry,
    statisticType: "count",
    onStatisticField: resolveCountField(layer),
    outStatisticFieldName: "total"
  });

  return Number(result?.total ?? 0);
}

/**
 * Executa uma consulta estatística com outStatistics.
 * @param {__esri.FeatureLayer} layer
 * @param {{
 *   where?: string,
 *   statisticType?: string,
 *   onStatisticField?: string,
 *   outStatisticFieldName?: string,
 *   geometry?: __esri.Geometry,
 *   spatialRelationship?: string
 * }} options
 * @returns {Promise<Record<string, number|string|null>|null>}
 */
export async function queryStatistics(layer, options = {}) {
  await layer.load();

  const {
    where = "1=1",
    statisticType = "count",
    onStatisticField = resolveCountField(layer),
    outStatisticFieldName = "value",
    geometry = null,
    spatialRelationship = "intersects"
  } = options;

  const query = layer.createQuery();
  query.where = where;
  query.returnGeometry = false;
  query.outStatistics = [
    {
      statisticType,
      onStatisticField,
      outStatisticFieldName
    }
  ];

  if (geometry) {
    query.geometry = geometry;
    query.spatialRelationship = spatialRelationship;
  }

  const result = await layer.queryFeatures(query);
  const attrs = result.features?.[0]?.attributes ?? null;

  if (!attrs) return null;

  // Normaliza chaves (alguns serviços retornam maiúsculas)
  const normalized = {};
  for (const [key, value] of Object.entries(attrs)) {
    normalized[key] = value;
    normalized[key.toLowerCase()] = value;
  }

  return normalized;
}

/**
 * Obtém atributos de feições (sem geometria por padrão).
 * @param {__esri.FeatureLayer} layer
 * @param {{
 *   where?: string,
 *   outFields?: string[] | string,
 *   num?: number,
 *   orderByFields?: string[],
 *   returnGeometry?: boolean,
 *   geometry?: __esri.Geometry,
 *   spatialRelationship?: string
 * }} options
 */
export async function queryAttributes(layer, options = {}) {
  await layer.load();

  const {
    where = "1=1",
    outFields = ["*"],
    num = 50,
    orderByFields,
    returnGeometry = false,
    geometry = null,
    spatialRelationship = "intersects"
  } = options;

  const query = layer.createQuery();
  query.where = where;
  query.outFields = outFields;
  query.returnGeometry = returnGeometry;
  query.num = num;

  if (orderByFields) {
    query.orderByFields = orderByFields;
  }

  if (geometry) {
    query.geometry = geometry;
    query.spatialRelationship = spatialRelationship;
  }

  const result = await layer.queryFeatures(query);
  return result.features.map((feature) => feature.attributes);
}

/**
 * Aplica filtro (where) e retorna feições.
 * @param {__esri.FeatureLayer} layer
 * @param {string} where
 * @param {object} [extraOptions]
 */
export async function queryWithFilter(layer, where, extraOptions = {}) {
  return queryAttributes(layer, { ...extraOptions, where });
}

/**
 * Consulta feições visíveis na extensão do mapa (preparado para uso futuro).
 * @param {__esri.FeatureLayer} layer
 * @param {import("@arcgis/core/views/MapView.js").default} view
 * @param {object} [extraOptions]
 */
export async function queryVisibleInExtent(layer, view, extraOptions = {}) {
  if (!view?.extent) {
    throw new Error("MapView sem extent disponível.");
  }

  return queryAttributes(layer, {
    ...extraOptions,
    geometry: view.extent.clone(),
    spatialRelationship: "intersects"
  });
}

/**
 * Conta feições na extensão atual do mapa.
 * @param {__esri.FeatureLayer} layer
 * @param {import("@arcgis/core/views/MapView.js").default} view
 * @param {string} [where="1=1"]
 */
export async function countVisibleInExtent(layer, view, where = "1=1") {
  if (!view?.extent) {
    throw new Error("MapView sem extent disponível.");
  }

  const result = await queryStatistics(layer, {
    where,
    statisticType: "count",
    onStatisticField: resolveCountField(layer),
    outStatisticFieldName: "total",
    geometry: view.extent.clone()
  });

  return Number(result?.total ?? 0);
}

/**
 * Consulta uma camada específica por título ou id.
 * @param {import("@arcgis/core/WebMap.js").default} webMap
 * @param {{ layerTitle?: string, layerId?: string }} criteria
 * @param {(layer: __esri.FeatureLayer) => Promise<any>} queryFn
 */
export async function queryLayerByCriteria(webMap, criteria, queryFn) {
  const { findLayer } = await import("./layers.js");
  const layer = findLayer(webMap, criteria);

  if (!layer) {
    throw new Error(
      `Camada não encontrada: ${criteria.layerTitle || criteria.layerId || "(critério vazio)"}`
    );
  }

  if (typeof layer.queryFeatures !== "function") {
    throw new Error(`A camada "${layer.title || layer.id}" não suporta queryFeatures.`);
  }

  return queryFn(layer);
}

/**
 * Busca nomes em um campo (autocomplete).
 * @param {__esri.FeatureLayer} layer
 * @param {{
 *   field: string,
 *   term: string,
 *   where?: string,
 *   num?: number
 * }} options
 * @returns {Promise<string[]>}
 */
export async function searchFieldValues(layer, options = {}) {
  await layer.load();

  const { field, term, where = "1=1", num = 12 } = options;
  const cleaned = String(term || "").trim();
  if (cleaned.length < 2) return [];

  const { escapeSqlString, combineWhere } = await import("./filter.js");
  const like = escapeSqlString(cleaned);
  const searchWhere = combineWhere(
    where,
    `UPPER(${field}) LIKE UPPER('%${like}%')`
  );

  return queryFieldValues(layer, {
    field,
    where: searchWhere,
    orderByFields: [`${field} ASC`],
    num
  });
}

/**
 * Conta feições via REST (útil para tabelas fora do Web Map).
 * @param {string} layerOrTableUrl
 * @param {string} [where="1=1"]
 * @returns {Promise<number>}
 */
export async function queryRestCount(layerOrTableUrl, where = "1=1") {
  const endpoint = `${String(layerOrTableUrl).replace(/\/+$/, "")}/query`;
  const url = new URL(endpoint);
  url.searchParams.set("where", where);
  url.searchParams.set("returnCountOnly", "true");
  url.searchParams.set("f", "json");

  const response = await fetch(url.toString(), { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Falha na contagem REST (${response.status})`);
  }

  const data = await response.json();
  if (data?.error) {
    throw new Error(data.error.message || "Erro na contagem REST");
  }

  return Number(data.count ?? 0);
}

/**
 * Lista valores de um campo (ex.: nomes dos territórios).
 * @param {__esri.FeatureLayer} layer
 * @param {{
 *   field: string,
 *   where?: string,
 *   orderByFields?: string[],
 *   num?: number
 * }} options
 * @returns {Promise<string[]>}
 */
export async function queryFieldValues(layer, options = {}) {
  await layer.load();

  const {
    field,
    where = "1=1",
    orderByFields,
    num = 500
  } = options;

  const query = layer.createQuery();
  query.where = where;
  query.outFields = [field];
  query.returnGeometry = false;
  query.num = num;
  if (orderByFields?.length) {
    query.orderByFields = orderByFields;
  }

  const result = await layer.queryFeatures(query);
  const values = [];
  const seen = new Set();

  for (const feature of result.features || []) {
    const raw = feature.attributes?.[field];
    const text = raw == null || String(raw).trim() === "" ? null : String(raw).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    values.push(text);
  }

  return values;
}

/**
 * Agrupa contagens por tipo (groupByFieldsForStatistics).
 * @param {__esri.FeatureLayer} layer
 * @param {{
 *   field: string,
 *   where?: string
 * }} options
 * @returns {Promise<Array<{ label: string, total: number }>>}
 */
export async function queryTypeBreakdown(layer, options = {}) {
  await layer.load();

  const { field, where = "1=1" } = options;
  const countField = resolveCountField(layer);

  const query = layer.createQuery();
  query.where = where;
  query.returnGeometry = false;
  query.groupByFieldsForStatistics = [field];
  query.orderByFields = [`total DESC`];
  query.outStatistics = [
    {
      statisticType: "count",
      onStatisticField: countField,
      outStatisticFieldName: "total"
    }
  ];

  const result = await layer.queryFeatures(query);

  return (result.features || [])
    .map((feature) => {
      const attrs = feature.attributes || {};
      const labelRaw = attrs[field];
      const total = Number(attrs.total ?? attrs.TOTAL ?? attrs.Total ?? 0);
      return {
        label:
          labelRaw == null || String(labelRaw).trim() === ""
            ? "Não informado"
            : String(labelRaw).trim(),
        total: Number.isFinite(total) ? total : 0
      };
    })
    .filter((item) => item.total > 0);
}

/**
 * Densidade = sum(numeratorField) / sum(denominatorField).
 * @param {__esri.FeatureLayer} layer
 * @param {{
 *   numeratorField: string,
 *   denominatorField: string,
 *   where?: string
 * }} options
 * @returns {Promise<number|null>}
 */
export async function queryDensity(layer, options) {
  await layer.load();

  const {
    numeratorField,
    denominatorField,
    where = "1=1",
    geometry = null,
    spatialRelationship = "intersects"
  } = options;

  const query = layer.createQuery();
  query.where = where;
  query.returnGeometry = false;
  query.outStatistics = [
    {
      statisticType: "sum",
      onStatisticField: numeratorField,
      outStatisticFieldName: "numerator"
    },
    {
      statisticType: "sum",
      onStatisticField: denominatorField,
      outStatisticFieldName: "denominator"
    }
  ];

  if (geometry) {
    query.geometry = geometry;
    query.spatialRelationship = spatialRelationship;
  }

  const result = await layer.queryFeatures(query);
  const attrs = result.features?.[0]?.attributes;
  if (!attrs) return null;

  const numerator = Number(
    attrs.numerator ?? attrs.NUMERATOR ?? attrs.Numerator
  );
  const denominator = Number(
    attrs.denominator ?? attrs.DENOMINATOR ?? attrs.Denominator
  );

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

/**
 * Resolve um campo adequado para COUNT.
 * @param {__esri.FeatureLayer} layer
 */
function resolveCountField(layer) {
  const objectIdField = layer.objectIdField;
  if (objectIdField) return objectIdField;

  const fields = layer.fields || [];
  const oid = fields.find((field) => field.type === "oid");
  if (oid) return oid.name;

  return fields[0]?.name || "OBJECTID";
}
