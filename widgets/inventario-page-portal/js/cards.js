/**
 * Renderização e atualização do dashboard (KPI, cards e gráfico).
 */

const ICONS = {
  territorios: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7.5 9 4l5 3.5L19 4v12.5L14 20l-5-3.5L4 20z"/>
      <path d="M9 4v12.5M14 7.5V20"/>
    </svg>`,
  municipios: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h16"/>
      <path d="M6 20V9l5-3 5 3v11"/>
      <path d="M10 20v-5h4v5"/>
      <path d="M9 11h.01M15 11h.01M9 14h.01M15 14h.01"/>
    </svg>`,
  semiarido: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="17" cy="7" r="3"/>
      <path d="M17 2v2M17 10v2M12 7h2M20 7h2"/>
      <path d="M5 20V10"/>
      <path d="M5 13H2"/>
      <path d="M5 16h3"/>
      <path d="M9 20V12"/>
      <path d="M9 14h3"/>
    </svg>`,
  reservatorios: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 10h18"/>
      <path d="M5 10V7h14v3"/>
      <path d="M4 10c1.5 4 3 7 8 7s6.5-3 8-7"/>
      <path d="M8 14.5c1 .8 2.2 1.2 4 1.2s3-.4 4-1.2"/>
    </svg>`,
  pocos: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 4h8v3H8z"/>
      <path d="M10 7v13"/>
      <path d="M14 7v13"/>
      <path d="M9 12h6"/>
      <path d="M9 16h6"/>
      <path d="M7 20h10"/>
    </svg>`,
  sistemas: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="8" width="5" height="10" rx="1"/>
      <rect x="10" y="5" width="5" height="13" rx="1"/>
      <rect x="17" y="9" width="4" height="9" rx="1"/>
      <path d="M5.5 8V5M12.5 5V3M19 9V7"/>
    </svg>`
};

/**
 * Renderiza a faixa superior de KPIs.
 * Indicadores com popup ficam clicáveis (sem botão separado embaixo).
 * @param {HTMLElement} container
 * @param {Array} definitions
 */
export function renderKpiStrip(container, definitions) {
  if (!container) return;

  container.innerHTML = definitions
    .map((item) => {
      const hasPopup = Boolean(item.popup);
      const tag = hasPopup ? "button" : "div";
      const interactiveAttrs = hasPopup
        ? `type="button" class="kpi-item kpi-item--interactive is-loading" aria-haspopup="true" aria-expanded="false"`
        : `class="kpi-item is-loading"`;

      return `
      <${tag} ${interactiveAttrs} data-card-id="${escapeHtml(item.id)}" aria-busy="true">
        <span class="kpi-icon">${ICONS[item.icon] || ICONS.municipios}</span>
        <span class="kpi-label">${escapeHtml(item.label)}</span>
        <span class="kpi-value" data-role="value">—</span>
        <span class="kpi-meta" data-role="meta" hidden></span>
        ${hasPopup ? `<span class="kpi-hint">Ver detalhes</span>` : ""}
      </${tag}>
    `;
    })
    .join("");
}

/** @type {string|null} */
let activeKpiId = null;

/**
 * Liga cliques dos KPIs interativos.
 * @param {HTMLElement} container
 * @param {(definitionId: string, anchorEl: HTMLElement) => void} onSelect
 * @param {HTMLElement} popupEl
 */
export function bindKpiClicks(container, onSelect, popupEl) {
  if (!container) return;

  container.addEventListener("click", (event) => {
    const item = event.target.closest(".kpi-item--interactive");
    if (!item || !container.contains(item)) return;

    event.stopPropagation();
    const id = item.getAttribute("data-card-id");
    if (!id) return;

    // Clica de novo no mesmo KPI → fecha
    if (activeKpiId === id && popupEl && !popupEl.hidden) {
      closeKpiPopup(popupEl, container);
      return;
    }

    onSelect(id, item);
  });
}

/**
 * Abre o popover ancorado abaixo do KPI clicado.
 * @param {HTMLElement} popupEl
 * @param {{ title: string, loading?: boolean, mode?: string, items?: Array<{label:string, total?:number}>, names?: string[], error?: string }} content
 * @param {HTMLElement} [anchorEl]
 * @param {HTMLElement} [kpiStrip]
 */
export function openKpiPopup(popupEl, content, anchorEl, kpiStrip) {
  if (!popupEl) return;

  const titleEl = popupEl.querySelector("#kpiPopupTitle");
  const bodyEl = popupEl.querySelector("#kpiPopupBody");

  if (titleEl) titleEl.textContent = content.title || "Detalhamento";
  if (bodyEl) bodyEl.innerHTML = buildPopupBodyHtml(content);

  if (anchorEl) {
    activeKpiId = anchorEl.getAttribute("data-card-id");
    kpiStrip
      ?.querySelectorAll(".kpi-item--interactive")
      .forEach((el) => el.setAttribute("aria-expanded", "false"));
    anchorEl.setAttribute("aria-expanded", "true");
    popupEl.dataset.anchorId = activeKpiId || "";
  }

  popupEl.hidden = false;
  positionKpiPopover(popupEl, anchorEl);
}

export function closeKpiPopup(popupEl, kpiStrip) {
  if (!popupEl) return;
  popupEl.hidden = true;
  activeKpiId = null;
  delete popupEl.dataset.anchorId;

  kpiStrip
    ?.querySelectorAll(".kpi-item--interactive")
    .forEach((el) => el.setAttribute("aria-expanded", "false"));
}

export function bindPopupClose(popupEl, kpiStrip) {
  if (!popupEl) return;

  popupEl.addEventListener("click", (event) => {
    if (event.target.closest("[data-popup-close]")) {
      closeKpiPopup(popupEl, kpiStrip);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popupEl.hidden) {
      closeKpiPopup(popupEl, kpiStrip);
    }
  });

  document.addEventListener("click", (event) => {
    if (popupEl.hidden) return;
    if (popupEl.contains(event.target)) return;
    if (event.target.closest(".kpi-item--interactive")) return;
    closeKpiPopup(popupEl, kpiStrip);
  });

  window.addEventListener(
    "resize",
    () => {
      if (popupEl.hidden || !activeKpiId) return;
      const anchor = kpiStrip?.querySelector(
        `[data-card-id="${cssEscape(activeKpiId)}"]`
      );
      if (anchor) positionKpiPopover(popupEl, anchor);
    },
    { passive: true }
  );

  window.addEventListener(
    "scroll",
    () => {
      if (popupEl.hidden || !activeKpiId) return;
      const anchor = kpiStrip?.querySelector(
        `[data-card-id="${cssEscape(activeKpiId)}"]`
      );
      if (anchor) positionKpiPopover(popupEl, anchor);
    },
    { passive: true }
  );
}

/**
 * Posiciona o popover logo abaixo do indicador clicado.
 * @param {HTMLElement} popupEl
 * @param {HTMLElement} [anchorEl]
 */
function positionKpiPopover(popupEl, anchorEl) {
  if (!popupEl || !anchorEl) return;

  const rect = anchorEl.getBoundingClientRect();
  const gap = 10;
  const margin = 8;

  // Mostra temporariamente para medir
  popupEl.style.visibility = "hidden";
  popupEl.hidden = false;

  const popWidth = popupEl.offsetWidth || 320;
  const popHeight = popupEl.offsetHeight || 200;

  let left = rect.left + rect.width / 2 - popWidth / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - popWidth - margin));

  let top = rect.bottom + gap;
  const spaceBelow = window.innerHeight - rect.bottom - gap;
  if (spaceBelow < Math.min(popHeight, 180) && rect.top > popHeight + gap) {
    top = rect.top - popHeight - gap;
    popupEl.classList.add("kpi-popover--above");
  } else {
    popupEl.classList.remove("kpi-popover--above");
  }

  const arrowCenter = rect.left + rect.width / 2 - left;
  popupEl.style.setProperty("--arrow-left", `${Math.max(18, Math.min(arrowCenter, popWidth - 18))}px`);
  popupEl.style.left = `${left}px`;
  popupEl.style.top = `${top}px`;
  popupEl.style.visibility = "visible";
}

function buildPopupBodyHtml(content) {
  if (content.loading) {
    return `<p class="kpi-popover__loading">Carregando…</p>`;
  }

  if (content.error) {
    return `<p class="kpi-popover__error">${escapeHtml(content.error)}</p>`;
  }

  if (content.mode === "list" && content.names?.length) {
    const selectable = Boolean(content.selectable);
    return `
      ${content.hint ? `<p class="kpi-popover__hint">${escapeHtml(content.hint)}</p>` : ""}
      <ul class="kpi-popover__list ${selectable ? "is-selectable" : ""}">
        ${content.names
          .map((name, index) => {
            if (selectable) {
              return `
                <li>
                  <button type="button" class="kpi-popover__option" data-filter-value="${escapeHtml(name)}">
                    <span>${index + 1}</span>${escapeHtml(name)}
                  </button>
                </li>
              `;
            }
            return `<li><span>${index + 1}</span>${escapeHtml(name)}</li>`;
          })
          .join("")}
      </ul>
    `;
  }

  if (content.mode === "search") {
    return `
      ${content.hint ? `<p class="kpi-popover__hint">${escapeHtml(content.hint)}</p>` : ""}
      <label class="kpi-search">
        <input
          id="kpiSearchInput"
          type="search"
          placeholder="Ex.: Salvador, Feira de Santana…"
          autocomplete="off"
        />
      </label>
      <ul id="kpiSearchResults" class="kpi-popover__list is-selectable kpi-search-results">
        <li class="kpi-popover__empty">Digite ao menos 2 letras</li>
      </ul>
    `;
  }

  if (content.mode === "filterAction") {
    return `
      <p class="kpi-popover__hint">${escapeHtml(content.description || "")}</p>
      <button type="button" class="kpi-action-btn" data-filter-action>
        ${escapeHtml(content.actionLabel || "Aplicar filtro")}
      </button>
    `;
  }

  if (content.mode === "types" && content.items?.length) {
    const max = Math.max(...content.items.map((item) => item.total || 0), 1);
    return `
      <ul class="kpi-popover__types">
        ${content.items
          .map((item) => {
            const pct = Math.max(6, Math.round(((item.total || 0) / max) * 100));
            return `
              <li>
                <div class="type-row">
                  <span class="type-label">${escapeHtml(item.label)}</span>
                  <strong class="type-total">${formatValue(item.total)}</strong>
                </div>
                <div class="type-bar"><i style="width:${pct}%"></i></div>
              </li>
            `;
          })
          .join("")}
      </ul>
    `;
  }

  return `<p class="kpi-popover__error">Nenhum dado encontrado.</p>`;
}

/**
 * Liga ações do popover (seleção de território, busca, filtro semiárido).
 * @param {HTMLElement} popupEl
 * @param {{
 *   onSelectValue?: (value: string) => void,
 *   onFilterAction?: () => void,
 *   onSearch?: (term: string) => Promise<string[]>
 * }} handlers
 */
export function bindPopupActions(popupEl, handlers = {}) {
  if (!popupEl || popupEl.dataset.actionsBound === "1") return;
  popupEl.dataset.actionsBound = "1";

  let searchTimer = null;

  popupEl.addEventListener("click", (event) => {
    const option = event.target.closest("[data-filter-value]");
    if (option) {
      event.preventDefault();
      event.stopPropagation();
      handlers.onSelectValue?.(option.getAttribute("data-filter-value") || "");
      return;
    }

    if (event.target.closest("[data-filter-action]")) {
      event.preventDefault();
      event.stopPropagation();
      handlers.onFilterAction?.();
    }
  });

  popupEl.addEventListener("input", (event) => {
    const input = event.target.closest("#kpiSearchInput");
    if (!input) return;

    clearTimeout(searchTimer);
    const term = input.value;
    const list = popupEl.querySelector("#kpiSearchResults");

    if (!list) return;

    if (String(term).trim().length < 2) {
      list.innerHTML = `<li class="kpi-popover__empty">Digite ao menos 2 letras</li>`;
      return;
    }

    list.innerHTML = `<li class="kpi-popover__empty">Buscando…</li>`;
    searchTimer = setTimeout(async () => {
      try {
        const results = (await handlers.onSearch?.(term)) || [];
        if (!results.length) {
          list.innerHTML = `<li class="kpi-popover__empty">Nenhum município encontrado</li>`;
          return;
        }
        list.innerHTML = results
          .map(
            (name) => `
            <li>
              <button type="button" class="kpi-popover__option kpi-popover__option--plain" data-filter-value="${escapeHtml(name)}">
                ${escapeHtml(name)}
              </button>
            </li>
          `
          )
          .join("");
      } catch (error) {
        list.innerHTML = `<li class="kpi-popover__empty">Erro na busca</li>`;
        console.error(error);
      }
    }, 280);
  });
}

/**
 * Atualiza banner de filtro do painel de números.
 * @param {HTMLElement} bannerEl
 * @param {HTMLElement} textEl
 * @param {HTMLElement} titleEl
 * @param {{ active: boolean, label?: string, title?: string }} state
 */
export function updateFilterBanner(bannerEl, textEl, titleEl, state) {
  if (titleEl && state.title) {
    titleEl.textContent = state.title;
  }

  if (!bannerEl) return;

  if (state.active) {
    bannerEl.hidden = false;
    if (textEl) textEl.textContent = `Filtro: ${state.label || ""}`;
  } else {
    bannerEl.hidden = true;
  }
}

export function setCardUnavailable(root, cardId, message = "Dado indisponível") {
  const card = root?.querySelector?.(`[data-card-id="${cssEscape(cardId)}"]`);
  if (!card) return;

  card.classList.remove("is-loading", "is-error");
  card.classList.add("is-empty");
  card.setAttribute("aria-busy", "false");

  const valueEl = card.querySelector('[data-role="value"]');
  const metaEl = card.querySelector('[data-role="meta"]');
  if (valueEl) valueEl.textContent = "—";
  if (metaEl) {
    metaEl.hidden = false;
    metaEl.textContent = message;
  } else if (valueEl) {
    valueEl.title = message;
  }
}

/**
 * Renderiza os cards pequenos do painel direito.
 * O card grande (pop_total) já existe no HTML.
 * @param {HTMLElement} gridEl
 * @param {Array} definitions cards com size !== 'large'
 */
export function renderStatCards(gridEl, definitions) {
  if (!gridEl) return;

  const smallCards = definitions.filter((item) => item.size !== "large");

  gridEl.innerHTML = smallCards
    .map(
      (item, index) => `
      <article
        class="stat-card is-loading"
        data-card-id="${escapeHtml(item.id)}"
        data-tone="${(index % 3) + 1}"
        aria-busy="true"
        style="--delay: ${index * 40}ms"
      >
        <p class="stat-label">${escapeHtml(item.label)}</p>
        <p class="stat-value" data-role="value">—</p>
        <p class="stat-meta" data-role="meta" hidden></p>
      </article>
    `
    )
    .join("");
}

/**
 * Atualiza valor de um card/KPI em qualquer container raiz.
 * @param {ParentNode} root
 * @param {string} cardId
 * @param {number|string|null} value
 * @param {{ decimals?: number, meta?: string|null }} [options]
 */
export function updateCardValue(root, cardId, value, options = {}) {
  const card = root?.querySelector?.(`[data-card-id="${cssEscape(cardId)}"]`);
  if (!card) return;

  const valueEl = card.querySelector('[data-role="value"]');
  const metaEl = card.querySelector('[data-role="meta"]');
  card.classList.remove("is-loading", "is-error", "is-empty");
  card.setAttribute("aria-busy", "false");

  if (valueEl) {
    valueEl.textContent = formatValue(value, options.decimals);
  }

  if (metaEl) {
    if (options.meta) {
      metaEl.hidden = false;
      metaEl.textContent = options.meta;
    } else {
      metaEl.hidden = true;
      metaEl.textContent = "";
    }
  }
}

export function setCardError(root, cardId, message) {
  const card = root?.querySelector?.(`[data-card-id="${cssEscape(cardId)}"]`);
  if (!card) return;

  card.classList.remove("is-loading");
  card.classList.add("is-error");
  card.setAttribute("aria-busy", "false");

  const valueEl = card.querySelector('[data-role="value"]');
  if (valueEl) valueEl.textContent = "Erro";
  if (message) card.title = message;
}

/**
 * Renderiza o gráfico de barras horizontal Rural x Urbana.
 * @param {HTMLElement} chartEl
 * @param {HTMLElement} legendEl
 * @param {HTMLElement} titleEl
 * @param {{ title: string, series: Array<{id:string,label:string,color:string,value:number|null}> }} chartData
 */
export function renderPopulationChart(chartEl, legendEl, titleEl, chartData) {
  if (titleEl && chartData?.title) {
    titleEl.textContent = chartData.title;
  }

  if (!chartEl) return;

  const series = chartData?.series || [];
  const hasData = series.some((item) => item.value != null && Number(item.value) > 0);

  if (!hasData) {
    chartEl.innerHTML = `<p class="chart-empty">${escapeHtml(
      chartData.emptyMessage || "Dado indisponível para este filtro"
    )}</p>`;
    if (legendEl) legendEl.innerHTML = "";
    return;
  }

  const max = Math.max(...series.map((s) => Number(s.value) || 0), 1);
  const total = series.reduce((sum, item) => sum + (Number(item.value) || 0), 0);

  chartEl.innerHTML = series
    .map((item, index) => {
      const value = Number(item.value) || 0;
      const pct = Math.max(8, Math.round((value / max) * 100));
      const share = total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
      return `
        <div class="chart-row" data-series-id="${escapeHtml(item.id)}" style="--i:${index}">
          <div class="chart-row-top">
            <span class="chart-series-label">
              <i style="background:${escapeHtml(item.color)}"></i>
              ${escapeHtml(item.label)}
            </span>
            <span class="chart-bar-value">${formatValue(item.value)}</span>
          </div>
          <div class="chart-bar-track">
            <div
              class="chart-bar"
              style="--bar-color:${escapeHtml(item.color)};width:${pct}%"
            >
              <span class="chart-bar-share">${share.toLocaleString("pt-BR")}%</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  requestAnimationFrame(() => {
    chartEl.querySelectorAll(".chart-bar").forEach((bar) => {
      const width = bar.style.width;
      bar.style.width = "0";
      requestAnimationFrame(() => {
        bar.style.width = width;
      });
    });
  });

  if (legendEl) {
    legendEl.innerHTML = series
      .map(
        (item) => `
        <span class="legend-item">
          <span class="legend-swatch" style="background:${escapeHtml(item.color)}"></span>
          ${escapeHtml(item.label)}
        </span>
      `
      )
      .join("");
  }
}

/** Compat */
export function showCardSkeletons() {}
export function renderCards() {}
export function renderLayerList() {}
export function updateCardsFromResults() {}
export function renderSelectionAttributes() {}

function formatValue(value, decimals) {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(Number(value))) {
    if (typeof value === "string" && value.trim() && !/^nan$/i.test(value.trim()) && !/^-?\d/.test(value.trim())) {
      return value;
    }
    return "Sem dado";
  }

  if (typeof value === "number") {
    if (typeof decimals === "number") {
      return new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }).format(value);
    }
    return new Intl.NumberFormat("pt-BR").format(value);
  }

  return String(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replaceAll('"', '\\"');
}
