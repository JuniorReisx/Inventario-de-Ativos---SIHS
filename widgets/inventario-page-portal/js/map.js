/**
 * Criação do WebMap / MapView e interações com o mapa.
 */

import { PORTAL_URL, WEB_MAP_ID, OAUTH_APP_ID } from "./config.js";

/**
 * Carrega módulos do ArcGIS Maps SDK 4.x via AMD (CDN clássico).
 * @param {string[]} modulePaths caminhos no formato "esri/..."
 */
function loadModules(modulePaths) {
  return new Promise((resolve, reject) => {
    if (typeof window.require !== "function") {
      reject(
        new Error(
          "ArcGIS Maps SDK não carregou (require indisponível). Verifique o script do CDN em index.html e a rede."
        )
      );
      return;
    }

    window.require(
      modulePaths,
      (...modules) => resolve(modules),
      (err) =>
        reject(
          err || new Error(`Falha ao carregar módulos: ${modulePaths.join(", ")}`)
        )
    );
  });
}

/**
 * Configura portalUrl e autenticação (IdentityManager / OAuth).
 * Não embute usuário ou senha — o login é feito pelo diálogo do SDK quando necessário.
 */
export async function setupAuthentication() {
  const [esriConfig, identityManager, OAuthInfo] = await loadModules([
    "esri/config",
    "esri/identity/IdentityManager",
    "esri/identity/OAuthInfo"
  ]);

  const portalUrl = normalizePortalUrl(PORTAL_URL);

  if (!isPlaceholder(PORTAL_URL)) {
    esriConfig.portalUrl = portalUrl;
  } else {
    console.warn(
      "[map] PORTAL_URL ainda é placeholder. Defina a URL do ArcGIS Enterprise em js/config.js."
    );
  }

  if (!isPlaceholder(OAUTH_APP_ID)) {
    const info = new OAuthInfo({
      appId: OAUTH_APP_ID,
      portalUrl,
      popup: true
    });
    identityManager.registerOAuthInfos([info]);
    console.info("[map] OAuth registrado. O IdentityManager gerenciará o login.");
  } else {
    console.info(
      "[map] OAUTH_APP_ID vazio (ok). Se algum serviço for protegido, o IdentityManager poderá pedir login."
    );
  }

  return { esriConfig, identityManager };
}

/**
 * Cria o WebMap a partir do portalItem.id (não recria camadas manualmente).
 */
export async function createWebMap() {
  if (isPlaceholder(WEB_MAP_ID)) {
    throw new Error(
      "WEB_MAP_ID não configurado. Informe o ID do Web Map em js/config.js."
    );
  }

  if (isPlaceholder(PORTAL_URL)) {
    throw new Error(
      "PORTAL_URL não configurada. Informe a URL do Portal Enterprise em js/config.js."
    );
  }

  const [WebMap] = await loadModules(["esri/WebMap"]);
  const portalUrl = normalizePortalUrl(PORTAL_URL);

  const webMap = new WebMap({
    portalItem: {
      id: WEB_MAP_ID,
      portal: {
        url: portalUrl
      }
    }
  });

  await webMap.load();
  console.info("[map] Web Map carregado:", webMap.portalItem?.title || WEB_MAP_ID);
  return webMap;
}

/**
 * Cria o MapView e adiciona controles úteis (zoom, home, legend).
 * @param {HTMLElement|string} container
 * @param {__esri.WebMap} webMap
 */
export async function createMapView(container, webMap) {
  const [MapView, Zoom, Home, Legend, Expand] = await loadModules([
    "esri/views/MapView",
    "esri/widgets/Zoom",
    "esri/widgets/Home",
    "esri/widgets/Legend",
    "esri/widgets/Expand"
  ]);

  const view = new MapView({
    container,
    map: webMap,
    constraints: {
      snapToZoom: false
    },
    ui: {
      components: ["attribution"]
    }
  });

  await view.when();

  // Garante que o mapa ocupe o card após o layout flex calcular a altura
  await resizeMapView(view);

  const zoom = new Zoom({ view });
  const home = new Home({ view });
  const legend = new Legend({ view });
  const legendExpand = new Expand({
    view,
    content: legend,
    expanded: false,
    expandTooltip: "Legenda",
    group: "top-left"
  });

  view.ui.add([zoom, home, legendExpand], "top-left");

  // Recentrar na extensão do Web Map depois do resize do container
  if (view.extent) {
    await view.goTo(view.extent.clone().expand(1.02), { animate: false });
  }

  window.addEventListener("resize", () => {
    resizeMapView(view);
  });

  console.info("[map] MapView pronto.");
  return view;
}

async function resizeMapView(view) {
  if (!view) return;

  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (typeof view.resize === "function") {
    view.resize();
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  if (typeof view.resize === "function") {
    view.resize();
  }
}

/**
 * Faz zoom na extensão resultante de uma consulta na camada.
 * @param {__esri.MapView} view
 * @param {__esri.FeatureLayer} layer
 * @param {string} [where="1=1"]
 * @returns {Promise<boolean>}
 */
export async function zoomToWhere(view, layer, where = "1=1") {
  if (!view || !layer || typeof layer.queryExtent !== "function") {
    return false;
  }

  await layer.load();

  const result = await layer.queryExtent({ where });
  if (!result?.extent || result.count === 0) {
    console.warn("[map] Extensão vazia para where:", where);
    return false;
  }

  await view.goTo(result.extent.expand(1.12), { duration: 800 });
  return true;
}

/**
 * Seleção de feição no mapa (hitTest).
 * @param {__esri.MapView} view
 * @param {(payload: { graphic: __esri.Graphic, layer: __esri.Layer, attributes: object } | null) => void} [onSelect]
 */
export function enableFeatureSelection(view, onSelect) {
  view.on("click", async (event) => {
    try {
      const response = await view.hitTest(event, {
        include: view.map.allLayers
      });

      const hit = response.results.find((result) => {
        return (
          result.type === "graphic" &&
          result.graphic &&
          result.graphic.layer &&
          result.graphic.attributes &&
          (result.graphic.layer.type === "feature" ||
            result.graphic.layer.type === "subtype-group")
        );
      });

      if (!hit) {
        console.info("[map] Clique sem feição selecionada.");
        onSelect?.(null);
        return;
      }

      const { graphic } = hit;
      const layer = graphic.layer;
      const attributes = graphic.attributes;

      console.group("[map] Feição selecionada");
      console.log("layer:", layer.title || layer.id);
      console.log("layerType:", layer.type);
      console.log("attributes:", attributes);
      console.groupEnd();

      onSelect?.({
        graphic,
        layer,
        attributes
      });
    } catch (error) {
      console.error("[map] Erro no hitTest/seleção:", error);
    }
  });
}

function normalizePortalUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function isPlaceholder(value) {
  if (!value || typeof value !== "string") return true;
  const normalized = value.trim().toUpperCase();
  return (
    normalized.length === 0 ||
    normalized.startsWith("COLOCAR_") ||
    normalized.includes("AQUI")
  );
}
