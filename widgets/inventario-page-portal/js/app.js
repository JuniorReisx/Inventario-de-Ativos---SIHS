/**
 * Inicialização do dashboard SIHS — Estado da Bahia.
 */

import {
  HEADER_INDICATORS,
  STAT_CARDS,
  POPULATION_CHART,
  PORTAL_URL,
  WEB_MAP_ID
} from "./config.js";
import {
  setupAuthentication,
  createWebMap,
  createMapView,
  enableFeatureSelection,
  zoomToWhere
} from "./map.js";
import { logWebMapLayers, findLayer } from "./layers.js";
import {
  countFeatures,
  queryStatistics,
  queryDensity,
  queryFieldValues,
  queryTypeBreakdown,
  queryRestCount,
  searchFieldValues
} from "./statistics.js";
import {
  FILTER_ALL,
  combineWhere,
  createTerritoryFilter,
  createMunicipalityFilter,
  createSemiaridoFilter,
  getStatsPanelTitle
} from "./filter.js";
import {
  renderKpiStrip,
  bindKpiClicks,
  bindPopupClose,
  bindPopupActions,
  openKpiPopup,
  closeKpiPopup,
  renderStatCards,
  updateCardValue,
  setCardError,
  setCardUnavailable,
  renderPopulationChart,
  updateFilterBanner
} from "./cards.js";

const ui = {
  kpiStrip: document.getElementById("kpiStrip"),
  statsGrid: document.getElementById("statsGrid"),
  statsRoot: document.querySelector(".panel-stats"),
  statsTitle: document.getElementById("statsPanelTitle"),
  filterBanner: document.getElementById("filterBanner"),
  filterBannerText: document.getElementById("filterBannerText"),
  clearFilterBtn: document.getElementById("clearFilterBtn"),
  chart: document.getElementById("populationChart"),
  chartLegend: document.getElementById("chartLegend"),
  chartTitle: document.getElementById("chartTitle"),
  overlay: document.getElementById("mapOverlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayMessage: document.getElementById("overlayMessage"),
  popup: document.getElementById("kpiPopup"),
  dashboard: document.querySelector(".dashboard")
};

/** @type {any} */
let webMapRef = null;
/** @type {any} */
let viewRef = null;
/** @type {import('./filter.js').DashboardFilter} */
let activeFilter = { ...FILTER_ALL };
/** @type {any} */
let popupContext = null;

async function main() {
  renderKpiStrip(ui.kpiStrip, HEADER_INDICATORS);
  renderStatCards(ui.statsGrid, STAT_CARDS);
  bindPopupClose(ui.popup, ui.kpiStrip);
  bindPopupActions(ui.popup, {
    onSelectValue: (value) => handlePopupSelection(value),
    onFilterAction: () => handleFilterAction(),
    onSearch: (term) => searchMunicipalities(term)
  });

  bindKpiClicks(
    ui.kpiStrip,
    (id, anchorEl) => {
      const definition = HEADER_INDICATORS.find((item) => item.id === id);
      if (definition?.popup) {
        openIndicatorPopup(definition, anchorEl);
      }
    },
    ui.popup
  );

  ui.clearFilterBtn?.addEventListener("click", () => applyFilter(FILTER_ALL));

  try {
    console.group("[app] Configuração");
    console.log("PORTAL_URL:", PORTAL_URL);
    console.log("WEB_MAP_ID:", WEB_MAP_ID);
    console.groupEnd();

    await setupAuthentication();
    showOverlay("Carregando mapa", "Conectando ao ArcGIS Enterprise…");

    const webMap = await createWebMap();
    const view = await createMapView("viewDiv", webMap);
    webMapRef = webMap;
    viewRef = view;

    hideOverlay();
    await logWebMapLayers(webMap);

    enableFeatureSelection(view, (payload) => {
      if (payload?.attributes) {
        console.group("[map] Feição selecionada");
        console.log("layer:", payload.layer?.title || payload.layer?.id);
        console.log("attributes:", payload.attributes);
        console.groupEnd();
      }
    });

    await loadHeaderIndicators(webMap);
    await loadBahiaNumeros(webMap, activeFilter);
    syncFilterUi();
    console.info("[app] Dashboard inicializado.");
  } catch (error) {
    console.error("[app] Falha na inicialização:", error);
    showOverlay("Não foi possível carregar o mapa", buildFriendlyError(error));
  }
}

async function openIndicatorPopup(definition, anchorEl) {
  const popupConfig = definition.popup;
  if (!popupConfig || !webMapRef) return;

  popupContext = { definition, popupConfig };

  openKpiPopup(
    ui.popup,
    {
      title: popupConfig.title || definition.label,
      loading: true
    },
    anchorEl,
    ui.kpiStrip
  );

  try {
    const layer = findLayer(webMapRef, {
      layerTitle: definition.layerTitle,
      layerId: definition.layerId
    });

    if (!layer || typeof layer.queryFeatures !== "function") {
      throw new Error("Camada não encontrada para detalhamento.");
    }

    if (popupConfig.mode === "list") {
      const names = await queryFieldValues(layer, {
        field: popupConfig.field,
        where: definition.where || "1=1",
        orderByFields: popupConfig.orderByFields,
        num: 200
      });

      openKpiPopup(
        ui.popup,
        {
          title: popupConfig.title || definition.label,
          mode: "list",
          names,
          selectable: Boolean(popupConfig.selectable),
          hint: popupConfig.hint
        },
        anchorEl,
        ui.kpiStrip
      );
      return;
    }

    if (popupConfig.mode === "search") {
      openKpiPopup(
        ui.popup,
        {
          title: popupConfig.title || definition.label,
          mode: "search",
          hint: popupConfig.hint
        },
        anchorEl,
        ui.kpiStrip
      );
      ui.popup.querySelector("#kpiSearchInput")?.focus();
      return;
    }

    if (popupConfig.mode === "filterAction") {
      openKpiPopup(
        ui.popup,
        {
          title: popupConfig.title || definition.label,
          mode: "filterAction",
          description: popupConfig.description,
          actionLabel: popupConfig.actionLabel
        },
        anchorEl,
        ui.kpiStrip
      );
      return;
    }

    if (popupConfig.mode === "types") {
      const items = await queryTypeBreakdown(layer, {
        field: popupConfig.field,
        where: definition.where || "1=1"
      });

      openKpiPopup(
        ui.popup,
        {
          title: popupConfig.title || definition.label,
          mode: "types",
          items
        },
        anchorEl,
        ui.kpiStrip
      );
      return;
    }

    throw new Error("Tipo de popup não suportado.");
  } catch (error) {
    console.error("[app] Erro no popup do indicador:", error);
    openKpiPopup(
      ui.popup,
      {
        title: popupConfig.title || definition.label,
        error: error?.message || "Falha ao consultar detalhamento."
      },
      anchorEl,
      ui.kpiStrip
    );
  }
}

async function handlePopupSelection(value) {
  if (!value || !popupContext) return;

  const filterType = popupContext.popupConfig?.filterType;
  closeKpiPopup(ui.popup, ui.kpiStrip);

  if (filterType === "territorio") {
    await applyFilter(createTerritoryFilter(value));
    return;
  }

  if (filterType === "municipio") {
    await applyFilter(createMunicipalityFilter(value));
  }
}

async function handleFilterAction() {
  if (!popupContext) return;
  const filterType = popupContext.popupConfig?.filterType;
  closeKpiPopup(ui.popup, ui.kpiStrip);

  if (filterType === "semiarido") {
    const geometry = await loadSemiaridoGeometry();
    await applyFilter(createSemiaridoFilter(geometry));
  }
}

/** Geometria oficial da camada Região Semiárida do Web Map. */
async function loadSemiaridoGeometry() {
  if (!webMapRef) return null;

  const layer = findLayer(webMapRef, { layerTitle: "Região Semiárida" });
  if (!layer || typeof layer.queryFeatures !== "function") {
    console.warn("[app] Camada Região Semiárida não encontrada para geometria.");
    return null;
  }

  await layer.load();
  const result = await layer.queryFeatures({
    where: "1=1",
    returnGeometry: true,
    outFields: ["objectid"],
    num: 1
  });

  return result.features?.[0]?.geometry || null;
}

async function searchMunicipalities(term) {
  if (!webMapRef || !popupContext) return [];

  const layer = findLayer(webMapRef, {
    layerTitle: popupContext.definition.layerTitle
  });
  if (!layer) return [];

  return searchFieldValues(layer, {
    field: popupContext.popupConfig.field || "nm_mun_1",
    term,
    num: 12
  });
}

async function applyFilter(filter) {
  if (!webMapRef || !viewRef) return;

  activeFilter = filter;
  syncFilterUi();

  // Zoom (não bloqueia a atualização dos números se falhar)
  try {
    const zoomLayer =
      findLayer(webMapRef, { layerTitle: filter.zoomLayerTitle }) ||
      findLayer(webMapRef, { layerTitle: "Limites Municipais" });

    if (zoomLayer) {
      const ok = await zoomToWhere(viewRef, zoomLayer, filter.zoomWhere || "1=1");
      if (!ok && filter.type !== "all") {
        console.warn("[app] Não foi possível zoomar no filtro:", filter.label);
      }
    }
  } catch (error) {
    console.warn("[app] Falha no zoom do filtro:", error);
  }

  await loadBahiaNumeros(webMapRef, activeFilter);
}

function syncFilterUi() {
  updateFilterBanner(ui.filterBanner, ui.filterBannerText, ui.statsTitle, {
    active: activeFilter.type !== "all",
    label: activeFilter.label,
    title: getStatsPanelTitle(activeFilter)
  });
}

/** KPIs do topo: sempre totais gerais (não mudam com filtro espacial). */
async function loadHeaderIndicators(webMap) {
  await loadDefinitionGroup(webMap, HEADER_INDICATORS, ui.dashboard, FILTER_ALL);
}

/** Painel direito + gráfico: respeitam o filtro ativo. */
async function loadBahiaNumeros(webMap, filter) {
  ui.statsRoot?.classList.add("is-refreshing");
  try {
    await Promise.all([
      loadDefinitionGroup(webMap, STAT_CARDS, ui.statsRoot || ui.dashboard, filter),
      loadPopulationChart(webMap, filter)
    ]);
  } finally {
    ui.statsRoot?.classList.remove("is-refreshing");
  }
}

async function loadDefinitionGroup(webMap, definitions, root, filter = FILTER_ALL) {
  await Promise.all(
    definitions.map(async (definition) => {
      try {
        const result = await resolveIndicatorValue(webMap, definition, filter);
        const value = result && typeof result === "object" ? result.value : result;
        const meta = result && typeof result === "object" ? result.meta : null;
        const unavailable =
          result && typeof result === "object" ? result.unavailable : false;

        if (unavailable) {
          setCardUnavailable(
            root,
            definition.id,
            result.message || "Dado indisponível para este filtro"
          );
          return;
        }

        updateCardValue(root, definition.id, value, {
          decimals: definition.decimals,
          meta
        });
      } catch (error) {
        console.error(`[app] Erro no indicador "${definition.id}":`, error);
        setCardError(root, definition.id, error?.message || "Falha na consulta");
      }
    })
  );
}

/**
 * @returns {Promise<number|null|{ value: number|null, meta?: string|null, unavailable?: boolean, message?: string }>}
 */
async function resolveIndicatorValue(webMap, definition, filter = FILTER_ALL) {
  const layer = findLayer(webMap, {
    layerTitle: definition.layerTitle,
    layerId: definition.layerId
  });

  if (!layer) {
    throw new Error(`Camada não encontrada: ${definition.layerTitle || definition.layerId}`);
  }

  if (typeof layer.queryFeatures !== "function") {
    throw new Error(`Camada não consultável: ${layer.title || layer.id}`);
  }

  const scopeWhere = getScopeWhere(definition, filter);
  const where = combineWhere(definition.where || "1=1", scopeWhere);
  const geometry = filter?.geometry || null;
  const statisticType = definition.statisticType || "count";

  // dualCount (sistemas) só no header — sem filtro espacial
  if (definition.dualCount) {
    return resolveDualCount(layer, definition, definition.where || "1=1");
  }

  // Verifica existência no recorte (sem o where específico do card, ex.: Embasa)
  if (filter.type !== "all" && isMunicipalStatsLayer(definition.layerTitle)) {
    const scopeCount = await countFeatures(layer, scopeWhere, geometry);
    if (!scopeCount) {
      return {
        unavailable: true,
        message: "Dado indisponível para este filtro"
      };
    }
  }

  if (statisticType === "count") {
    return countFeatures(layer, where, geometry);
  }

  if (statisticType === "density") {
    const value = await queryDensity(layer, {
      where,
      geometry,
      numeratorField: definition.numeratorField,
      denominatorField: definition.denominatorField
    });

    if (value == null || !Number.isFinite(value)) {
      return {
        unavailable: true,
        message: "Dado indisponível para este filtro"
      };
    }

    return value;
  }

  const stats = await queryStatistics(layer, {
    where,
    geometry,
    statisticType,
    onStatisticField: definition.onStatisticField,
    outStatisticFieldName: "value"
  });

  const value = stats?.value;
  if (value == null || value === "" || Number.isNaN(Number(value))) {
    return {
      unavailable: true,
      message: "Dado indisponível para este filtro"
    };
  }

  return Number(value);
}

function getScopeWhere(definition, filter) {
  if (!filter || filter.type === "all") return "1=1";

  const title = normalize(definition.layerTitle);
  if (title.includes("limites municipais") || title.includes("municip")) {
    return filter.munWhere || "1=1";
  }
  if (title.includes("setores")) {
    return filter.setoresWhere || "1=1";
  }

  // Outras camadas de stats (se houver) não recebem filtro espacial aqui
  return "1=1";
}

function isMunicipalStatsLayer(layerTitle) {
  const title = normalize(layerTitle);
  return title.includes("limites municipais") || title.includes("municip");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function resolveDualCount(layer, definition, where) {
  const dual = definition.dualCount;
  const geolocalized = await countFeatures(layer, where);

  const extraCounts = await Promise.all(
    (dual.additionalCountUrls || []).map((url) => queryRestCount(url, "1=1"))
  );
  const extraTotal = extraCounts.reduce((sum, n) => sum + (Number(n) || 0), 0);
  const total = geolocalized + extraTotal;

  const format = (n) => new Intl.NumberFormat("pt-BR").format(n);
  const meta = String(dual.metaTemplate || "{geolocalized} geolocalizados")
    .replaceAll("{geolocalized}", format(geolocalized))
    .replaceAll("{total}", format(total))
    .replaceAll("{extra}", format(extraTotal));

  const primary = dual.showPrimary === "geolocalized" ? geolocalized : total;

  return { value: primary, meta };
}

async function loadPopulationChart(webMap, filter = FILTER_ALL) {
  const config = POPULATION_CHART;
  const layer = findLayer(webMap, { layerTitle: config.layerTitle });

  if (!layer || typeof layer.queryFeatures !== "function") {
    renderPopulationChart(ui.chart, ui.chartLegend, ui.chartTitle, {
      title: config.title,
      series: config.series.map((item) => ({ ...item, value: null })),
      emptyMessage: "Camada do gráfico não encontrada"
    });
    return;
  }

  const series = await Promise.all(
    config.series.map(async (item) => {
      try {
        const where = combineWhere(item.where || "1=1", filter.setoresWhere || "1=1");
        const stats = await queryStatistics(layer, {
          where,
          geometry: filter.geometry || null,
          statisticType: "sum",
          onStatisticField: config.populationField,
          outStatisticFieldName: "value"
        });
        const value = stats?.value;
        return {
          ...item,
          value: value == null ? null : Number(value)
        };
      } catch (error) {
        console.error(`[app] Erro na série "${item.id}":`, error);
        return { ...item, value: null };
      }
    })
  );

  const hasData = series.some((item) => item.value != null && item.value > 0);
  const chartTitle =
    filter.type === "all"
      ? config.title
      : `${config.title} — ${filter.label}`;

  renderPopulationChart(ui.chart, ui.chartLegend, ui.chartTitle, {
    title: chartTitle,
    series,
    emptyMessage: hasData ? null : "Dado indisponível para este filtro"
  });
}

function showOverlay(title, message) {
  if (!ui.overlay) return;
  ui.overlay.classList.add("is-visible");
  if (ui.overlayTitle) ui.overlayTitle.textContent = title;
  if (ui.overlayMessage) ui.overlayMessage.textContent = message;
}

function hideOverlay() {
  ui.overlay?.classList.remove("is-visible");
}

function buildFriendlyError(error) {
  const message = error?.message || String(error);

  if (/Failed to fetch|NetworkError|CORS|cross-origin/i.test(message)) {
    return `${message} — Use http://localhost:5500 (não file://) e verifique CORS.`;
  }

  return message;
}

main();
