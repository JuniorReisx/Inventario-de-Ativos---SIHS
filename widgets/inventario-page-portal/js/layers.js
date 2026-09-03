/**
 * Descoberta e acesso às camadas do Web Map.
 * Não cria FeatureLayers manuais — usa as camadas já configuradas no Web Map.
 */

/**
 * Lista plana de todas as camadas, incluindo as dentro de GroupLayers.
 * @param {import("@arcgis/core/WebMap.js").default} webMap
 * @returns {__esri.Layer[]}
 */
export function getAllLayers(webMap) {
  return webMap.allLayers.toArray();
}

/**
 * Retorna apenas camadas consultáveis via queryFeatures (FeatureLayer / SubtypeGroupLayer).
 * @param {import("@arcgis/core/WebMap.js").default} webMap
 * @returns {__esri.FeatureLayer[]}
 */
export function getQueryableLayers(webMap) {
  return getAllLayers(webMap).filter((layer) => {
    return (
      layer &&
      (layer.type === "feature" || layer.type === "subtype-group") &&
      typeof layer.queryFeatures === "function"
    );
  });
}

/**
 * Localiza uma camada pelo título (case-insensitive) ou pelo id.
 * @param {import("@arcgis/core/WebMap.js").default} webMap
 * @param {{ layerTitle?: string, layerId?: string }} criteria
 * @returns {__esri.Layer | null}
 */
export function findLayer(webMap, { layerTitle, layerId } = {}) {
  const layers = getAllLayers(webMap);

  if (layerId) {
    const byId = layers.find((layer) => layer.id === layerId);
    if (byId) return byId;
  }

  if (layerTitle) {
    const target = normalizeText(layerTitle);
    const exact = layers.find((layer) => {
      return normalizeText(layer.title || layer.name || "") === target;
    });
    if (exact) return exact;

    const partial = layers.find((layer) => {
      const title = normalizeText(layer.title || layer.name || "");
      return title.includes(target) || target.includes(title);
    });
    if (partial) return partial;
  }

  return null;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Extrai metadados úteis de uma camada para log/diagnóstico.
 * @param {__esri.Layer} layer
 */
export async function getLayerInfo(layer) {
  try {
    await layer.load();
  } catch (error) {
    return {
      id: layer.id,
      title: layer.title || layer.name || "(sem título)",
      type: layer.type,
      url: layer.url || null,
      loadError: error?.message || String(error),
      fieldCount: 0,
      fields: []
    };
  }

  const fields = Array.isArray(layer.fields)
    ? layer.fields.map((field) => ({
        name: field.name,
        alias: field.alias,
        type: field.type
      }))
    : [];

  return {
    id: layer.id,
    title: layer.title || layer.name || "(sem título)",
    name: layer.name || null,
    type: layer.type,
    url: layer.url || null,
    visible: layer.visible,
    opacity: layer.opacity,
    fieldCount: fields.length,
    fields
  };
}

/**
 * Percorre as camadas do Web Map e imprime no console:
 * nome, título, URL, tipo, quantidade de campos e campos.
 * @param {import("@arcgis/core/WebMap.js").default} webMap
 */
export async function logWebMapLayers(webMap) {
  const layers = getAllLayers(webMap);
  console.group(`[layers] Camadas do Web Map (${layers.length})`);

  for (const layer of layers) {
    const info = await getLayerInfo(layer);
    console.group(`${info.title} [${info.type}]`);
    console.log("id:", info.id);
    console.log("name:", info.name);
    console.log("title:", info.title);
    console.log("type:", info.type);
    console.log("url:", info.url);
    console.log("visible:", info.visible);
    console.log("fieldCount:", info.fieldCount);
    console.log("fields:", info.fields);
    if (info.loadError) {
      console.warn("loadError:", info.loadError);
    }
    console.groupEnd();
  }

  console.groupEnd();
  return layers;
}

/**
 * Resumo leve para exibir no painel lateral.
 * @param {import("@arcgis/core/WebMap.js").default} webMap
 */
export async function listLayerSummaries(webMap) {
  const layers = getAllLayers(webMap);
  const summaries = [];

  for (const layer of layers) {
    const info = await getLayerInfo(layer);
    summaries.push({
      id: info.id,
      title: info.title,
      type: info.type,
      url: info.url,
      fieldCount: info.fieldCount,
      visible: info.visible
    });
  }

  return summaries;
}
