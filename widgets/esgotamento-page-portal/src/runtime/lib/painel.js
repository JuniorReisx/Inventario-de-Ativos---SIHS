/* Generated from js/painel.js — do not edit by hand. */
import { downloadRelatorioPdf, slugRelatorio } from './relatorio-pdf'
/**
 * @param {HTMLElement} root
 * @param {any} GEO
 * @param {any} PTS_DATA
 * @param {any} [mapApi]
 * @param {any} [SETORES]
 */
export function initPainelEsgoto (root, GEO, PTS_DATA, mapApi, SETORES) {
  if (!root || !GEO) return () => {}

  const qs = (sel) => root.querySelector(sel)
  const qsa = (sel) => Array.from(root.querySelectorAll(sel))
  const useWebMap = !!(mapApi && typeof mapApi.sync === 'function')
  SETORES = SETORES && Array.isArray(SETORES.features) ? SETORES : { features: [] }

  const genDate = qs('#'+'genDate');
  if (genDate) genDate.textContent = new Date().toLocaleDateString('pt-BR');
  
  // ---------------- estado ----------------
  let state = {
    tab: 'esgoto',
    groupBy: 'territorio',
    regiao: 'todas',
    selectedMun: null,
    semiOn: false,
  };
  
  function fmt(n){
    const v = Number(n);
    if(!Number.isFinite(v)) return '0';
    if(Math.abs(v - Math.round(v)) < 1e-9) return Math.round(v).toLocaleString('pt-BR');
    return v.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function fmt1(n){
    const v = Number(n);
    if(!Number.isFinite(v)) return '0,00';
    return v.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function sharePct(part, whole){
    if(!(Number(whole) > 0)) return null;
    return (Number(part)||0) / Number(whole) * 100;
  }
  function fmtShare(pct){
    return pct==null ? '—' : fmt1(pct) + '%';
  }
  
  /* Escala do mapa: déficit de adequação (0% = tudo adequado → 100% = nada adequado).
     Paleta marrom do esgotamento (escuro = adequado → claro = sem banheiro). */
  function colorForPct(p){
    const stops = [
      {v:0,  c:[26,15,8]},      // #1A0F08 — 100% adequado
      {v:25, c:[92,58,30]},     // #5C3A1E
      {v:50, c:[139,90,43]},    // #8B5A2B
      {v:75, c:[201,154,74]},   // #C99A4A
      {v:100,c:[245,235,221]},  // #F5EBDD — 0% adequado
    ];
    let lo=stops[0], hi=stops[stops.length-1];
    for(let i=0;i<stops.length-1;i++){ if(p>=stops[i].v && p<=stops[i+1].v){ lo=stops[i]; hi=stops[i+1]; break; } }
    const t = (hi.v===lo.v) ? 0 : (p-lo.v)/(hi.v-lo.v);
    const c = lo.c.map((x,i)=>Math.round(x + (hi.c[i]-x)*t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  
  /* Cores fixas por categoria SIDRA — paleta marrom do esgotamento */
  const ESG_CAT_COLORS = {
    esg_rede_pluvial: '#1A0F08',
    esg_fossa_ligada: '#5C3A1E',
    esg_rede:      '#1A0F08',
    esg_fossa_sep: '#8B5A2B',
    esg_fossa_rud: '#B8752F',
    esg_vala:      '#C99A4A',
    esg_rio:       '#D9BC8C',
    esg_outra:     '#E8D4B8',
    esg_sem:       '#F5EBDD',
  };
  function categoryColors(cats){
    return cats.map(c => ESG_CAT_COLORS[c.key] || '#6b7c8a');
  }
  
  // ---------------- agregação SIDRA 6805 ----------------
  const ESG_KEYS = ['esg_rede_pluvial','esg_fossa_ligada','esg_rede','esg_fossa_sep','esg_fossa_rud','esg_vala','esg_rio','esg_outra','esg_sem'];
  
  function sumEsg(feats){
    const out = { esg_total:0, total_domicilios:0 };
    ESG_KEYS.forEach(k=> out[k]=0);
    feats.forEach(f=>{
      const p = f.properties;
      out.esg_total += p.esg_total||0;
      out.total_domicilios += p.total_domicilios||0;
      ESG_KEYS.forEach(k=> out[k] += p[k]||0);
    });
    return out;
  }

  function totalDomicilios (v) {
    return (v.total_domicilios||0) > 0 ? v.total_domicilios : (v.esg_total||0);
  }

  function ligacaoEsg (v) {
    const pluvial = v.esg_rede_pluvial||0;
    const fossaLigada = v.esg_fossa_ligada||0;
    const split = pluvial + fossaLigada;
    const highlight = split > 0 ? split : (v.esg_rede||0);
    return { pluvial, fossaLigada, highlight };
  }
  
  function classifyEsg(v){
    const lig = ligacaoEsg(v);
    const inadequado = (v.esg_fossa_sep||0) + (v.esg_fossa_rud||0) + (v.esg_vala||0) + (v.esg_rio||0) + (v.esg_outra||0);
    const sem = v.esg_sem||0;
    const total = totalDomicilios(v) || (v.esg_total||0);
    return {
      adequado: lig.highlight, inadequado, sem, total,
      pctAdeq: total? lig.highlight/total*100:0,
      pctInadeq: total? inadequado/total*100:0,
      pctSem: total? sem/total*100:0,
    };
  }
  
  function mapMetricPct(p){
    return classifyEsg({
      esg_total: p.esg_total,
      total_domicilios: p.total_domicilios,
      esg_rede_pluvial: p.esg_rede_pluvial,
      esg_fossa_ligada: p.esg_fossa_ligada,
      esg_rede: p.esg_rede,
      esg_fossa_sep: p.esg_fossa_sep,
      esg_fossa_rud: p.esg_fossa_rud,
      esg_vala: p.esg_vala,
      esg_rio: p.esg_rio,
      esg_outra: p.esg_outra,
      esg_sem: p.esg_sem,
    });
  }
  
  const TERRITORIOS = [...new Set(GEO.features.map(f=>f.properties.territorio).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const N_MUN = GEO.features.length;
  const N_SEMI = GEO.features.filter(f=>f.properties.semiarido==='SIM').length;
  const N_FORA_SEMI = N_MUN - N_SEMI;
  
  function regiaoKey(){
    return 'territorio';
  }
  
  function currentSelectionFeatures(){
    let feats = GEO.features;
    if(state.selectedMun) return feats.filter(f=>f.properties.cod_mun===state.selectedMun);
    if(state.semiOn) feats = feats.filter(f=>f.properties.semiarido==='SIM');
    if(state.regiao!=='todas') feats = feats.filter(f=>f.properties.territorio===state.regiao);
    return feats;
  }
  function currentSelectionLabel(){
    if(state.selectedMun){
      const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
      return 'Município — ' + (f?f.properties.nm_mun:state.selectedMun);
    }
    if(state.semiOn && state.regiao==='todas'){
      return `Semiárido — ${fmt(N_SEMI)} municípios`;
    }
    if(state.regiao!=='todas'){
      return 'Território de Identidade — ' + state.regiao + (state.semiOn ? ' · Semiárido' : '');
    }
    return `Estado da Bahia — ${fmt(N_MUN)} municípios`;
  }
  
  function isFullState(){
    return !state.selectedMun && state.regiao === 'todas' && !state.semiOn;
  }
  
  function infoTip(text){
    return `<button type="button" class="info-tip" aria-label="Como foi pensado este indicador">
      <span class="info-tip-btn" aria-hidden="true">?</span>
      <span class="info-tip-pop" role="tooltip">${text}</span>
    </button>`;
  }
  
  function setPanelHeader(selector, title, tip){
    const header = qs(selector);
    if(!header) return;
    header.innerHTML = `<span class="panel-title-text">${title}</span>${infoTip(tip)}`;
  }
  
  /** Território de Identidade da seleção atual (útil p/ município → comparar com o TI). */
  function getTerritorioContext(){
    let terrName = null;
    if(state.selectedMun){
      const f = GEO.features.find(x=>x.properties.cod_mun===state.selectedMun);
      terrName = f?.properties?.territorio || null;
    } else if(state.regiao!=='todas'){
      return null; // a própria seleção já é o território
    }
    if(!terrName) return null;
    const feats = GEO.features.filter(x=>x.properties.territorio===terrName);
    const v = sumEsg(feats);
    const cl = classifyEsg(v);
    const pop = feats.reduce((s,f)=>s+(f.properties.populacao||0),0);
    return { name: terrName, feats, v, cl, pop };
  }
  
  /** Painel de contexto: metodologia (Bahia) ou comparação com TI + Estado. */
  function renderVsBahiaHtml({ label, feats, v, cl, pop, bahiaV, bahiaCl, bahiaPop, semLabel, terr }){
    if(isFullState()){
      return `<p><b>${label}</b><br><br>
        Dados SIDRA/IBGE (Censo 2022) — domicílios particulares permanentes ocupados por tipo de esgotamento sanitário.
        <br><br>
        <b>Adequado</b> = rede geral/pluvial ou fossa ligada à rede + fossa séptica/filtro não ligada à rede.
        <br><b>Inadequado</b> = fossa rudimentar, vala, rio/lago/mar ou outra forma.
      </p>`;
    }
  
    const shareDom = bahiaV.esg_total ? (v.esg_total||0)/bahiaV.esg_total*100 : 0;
    const sharePop = bahiaPop ? pop/bahiaPop*100 : 0;
    const shareMun = GEO.features.length ? feats.length/GEO.features.length*100 : 0;
    const shareDomTi = terr?.v?.esg_total ? (v.esg_total||0)/terr.v.esg_total*100 : null;
    const sharePopTi = terr?.pop ? pop/terr.pop*100 : null;
  
    const cell = (titulo, sel, ti, ba) => {
      return `
      <div class="cmp-cell">
        <div class="cmp-cell-lbl">${titulo}</div>
        <div class="cmp-cell-vals">
          <div><span class="cmp-k">Seleção</span><span class="cmp-n">${fmt1(sel)}%</span></div>
          ${ti!=null?`<div><span class="cmp-k">Território</span><span class="cmp-n muted">${fmt1(ti)}%</span></div>`:''}
          <div><span class="cmp-k">Bahia</span><span class="cmp-n muted">${fmt1(ba)}%</span></div>
        </div>
      </div>`;
    };
  
    return `
      <div class="cmp-wrap">
        <div class="cmp-label">${label}${terr?` <span class="cmp-label-sub">· TI ${terr.name}</span>`:''}</div>
        <div class="cmp-shares">
          <div class="cmp-share"><strong>${fmt1(shareDom)}%</strong><span>dos domicílios da Bahia</span></div>
          ${shareDomTi!=null?`<div class="cmp-share"><strong>${fmt1(shareDomTi)}%</strong><span>dos domicílios do território</span></div>`:''}
          <div class="cmp-share"><strong>${fmt1(sharePop)}%</strong><span>da população da Bahia</span></div>
          ${sharePopTi!=null?`<div class="cmp-share"><strong>${fmt1(sharePopTi)}%</strong><span>da população do território</span></div>`:''}
          <div class="cmp-share"><strong>${fmt(feats.length)}</strong><span>de ${fmt(GEO.features.length)} municípios</span></div>
        </div>
        <div class="cmp-grid ${terr?'has-ti':''}">
          ${cell('Rede, pluvial ou fossa ligada à rede', cl.pctAdeq, terr?terr.cl.pctAdeq:null, bahiaCl.pctAdeq)}
          ${cell('Inadequado', cl.pctInadeq, terr?terr.cl.pctInadeq:null, bahiaCl.pctInadeq)}
          ${cell(semLabel, cl.pctSem, terr?terr.cl.pctSem:null, bahiaCl.pctSem)}
        </div>
      </div>`;
  }
  
  function renderCompChart({ cats, colors, v, cl, bahiaV, bahiaCl, terr, lightColor, lightBorder, tip }){
    if(!(cl.total>0)) return '<div class="empty-msg">Sem dado para esta seleção.</div>';
    const showTi = !!(terr && terr.cl?.total);
    const showBa = !isFullState();
    const scopeLabel = state.selectedMun ? 'neste município' : 'nesta seleção';
    const tiLabel = showTi ? (terr.name || 'território de identidade') : '';

    const cards = cats.map((c,i)=>{
      const val = v[c.key]||0;
      const pct = cl.total ? val/cl.total*100 : 0;
      const light = String(colors[i]||'').toUpperCase() === String(lightColor||'').toUpperCase();
      const fillExtra = light ? `;box-shadow:inset 0 0 0 1px ${lightBorder}` : '';
      const tiVal = showTi ? (terr.v[c.key]||0) : 0;
      const baVal = bahiaV?.[c.key]||0;
      const tiShare = showTi ? sharePct(val, tiVal) : null;
      const baShare = showBa ? sharePct(val, baVal) : null;
      const why = [
        `<b>${c.label}</b>`,
        `Composição: ${fmt(val)} de ${fmt(cl.total)} domicílios ${scopeLabel} = ${fmt1(pct)}%.`,
        showTi ? `Peso no território (${tiLabel}): ${fmt(val)} ÷ ${fmt(tiVal)} = ${fmtShare(tiShare)}.` : '',
        showBa ? `Peso na Bahia: ${fmt(val)} ÷ ${fmt(baVal)} = ${fmtShare(baShare)}.` : ''
      ].filter(Boolean).join('<br>');
      return `<article class="comp-card">
        <div class="comp-card-head">
          <span class="comp-card-dot" style="background:${colors[i]}" aria-hidden="true"></span>
          <span class="comp-card-label" title="${c.label}">${c.label}</span>
          ${infoTip(why)}
        </div>
        <div class="comp-card-value" title="${fmt(val)} domicílios (${fmt1(pct)}%)">
          <strong>${fmt(val)}</strong>
          <em>(${fmt1(pct)}%)</em>
        </div>
        ${(showTi || showBa) ? `<div class="comp-card-refs">
          ${showTi ? `<span><b>${fmtShare(tiShare)}</b> território</span>` : ''}
          ${showBa ? `<span><b>${fmtShare(baShare)}</b> Bahia</span>` : ''}
        </div>` : ''}
        <div class="comp-card-bar" aria-hidden="true">
          <span style="width:${Math.min(100, pct)}%;background:${colors[i]}${fillExtra}"></span>
        </div>
      </article>`;
    }).join('');

    return `<div class="comp-cards">${cards}</div>
      <div class="comp-legend end">${infoTip(tip)}</div>`;
  }
  
  // ---------------- controles ----------------
  function renderControls(){
    const sel = qs('#'+'selectMicro');
    if (sel) {
      sel.innerHTML = '<option value="todas">Todo o Estado</option>' +
        TERRITORIOS.map(m=>`<option value="${m}">${m}</option>`).join('');
      sel.value = state.regiao;
    }
    const btn = qs('#'+'btnSemiToggle');
    if (btn) {
      btn.classList.toggle('is-on', !!state.semiOn);
      btn.setAttribute('aria-pressed', state.semiOn ? 'true' : 'false');
      const strong = btn.querySelector('strong');
      if (strong) strong.textContent = state.semiOn ? 'Desativar' : 'Ativar';
    }
  }
  qs('#'+'selectMicro')?.addEventListener('change', e=> applyRegiaoFilter(e.target.value));
  qs('#'+'btnSemiToggle')?.addEventListener('click', () => {
    if(!state.semiOn && N_SEMI === 0){
      window.alert('Não foi possível identificar municípios na camada Região Semiárida_BA.');
      return;
    }
    state.semiOn = !state.semiOn;
    state.selectedMun = null;
    const input = qs('#'+'muniSearch-esgoto');
    if (input) input.value = '';
    updateMuniSelectionUI();
    renderControls();
    zoomToRegiao();
    renderCurrentTab();
  });
  qs('#'+'muniClear')?.addEventListener('click', clearMunicipio);
  qs('#'+'muniDetailClose')?.addEventListener('click', clearMunicipio);
  function normMun(s){
    return String(s||'').trim().toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  }
  function pickMunicipioFromInput(){
    const input = qs('#'+'muniSearch-esgoto');
    if(!input) return;
    const n = normMun(input.value);
    if(!n) return;
    const f = GEO.features.find(f=>normMun(f.properties.nm_mun)===n);
    if(f) selectMunicipio(f.properties.cod_mun);
  }
  qs('#'+'muniSearch-esgoto')?.addEventListener('change', pickMunicipioFromInput);
  qs('#'+'muniSearch-esgoto')?.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); pickMunicipioFromInput(); }
  });
  function populateMuniList(){
    const list = qs('#'+'muniList-esgoto');
    if(!list) return;
    const names = GEO.features.map(f=>f.properties.nm_mun).filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR'));
    list.innerHTML = names.map(n=>`<option value="${n}"></option>`).join('');
  }
  
  // ---------------- projeção geográfica -> pixels ----------------
  let W=640, H=780, lonMin,lonMax,latMin,latMax;
  function computeBounds(){
    lonMin=Infinity; lonMax=-Infinity; latMin=Infinity; latMax=-Infinity;
    GEO.features.forEach(f=>{
      const polys = f.geometry.type==='Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(poly=>{ poly.forEach(ring=>{ ring.forEach(([lon,lat])=>{
        if(lon<lonMin)lonMin=lon; if(lon>lonMax)lonMax=lon;
        if(lat<latMin)latMin=lat; if(lat>latMax)latMax=lat;
      }); }); });
    });
    const padX=(lonMax-lonMin)*0.02, padY=(latMax-latMin)*0.02;
    lonMin-=padX; lonMax+=padX; latMin-=padY; latMax+=padY;
  }
  function proj(lon,lat){
    const x=(lon-lonMin)/(lonMax-lonMin)*W, y=(latMax-lat)/(latMax-latMin)*H;
    return [x.toFixed(1), y.toFixed(1)];
  }
  function ringToPath(ring){ return ring.map((pt,i)=>(i===0?'M':'L')+proj(pt[0],pt[1]).join(',')).join(' ')+' Z'; }
  function geomToPath(geom){
    const polys = geom.type==='Polygon' ? [geom.coordinates] : geom.coordinates;
    let d=''; polys.forEach(poly=>{ poly.forEach(ring=>{ d+=ringToPath(ring)+' '; }); }); return d.trim();
  }
  
  // ---------------- mapa ----------------
  let mapSvgEl = null;
  let currentZoomScale = 1;
  let touchHintTimer = null;
  const MUN_FILL_NEUTRAL = '#EFEFEF';
  const MUN_FILL_GRAYOUT = '#C7CDD3';
  
  function hintTextFromTarget(el){
    const mun = el?.closest?.('.mun-path');
    if(mun) return GEO.features[+mun.dataset.idx].properties.nm_mun;
    return null;
  }
  
  function hideAllMapHints(){
    qsa('.map-hint').forEach(h=>{
      h.classList.remove('visible');
      h.setAttribute('aria-hidden', 'true');
    });
  }
  
  function hideMapHint(){
    const wrap = qs('#'+'mapWrap-'+state.tab);
    const hint = wrap?.querySelector('.map-hint');
    if(hint){
      hint.classList.remove('visible');
      hint.setAttribute('aria-hidden', 'true');
    }
  }
  
  function showMapHint(clientX, clientY, text){
    const wrap = qs('#'+'mapWrap-'+state.tab);
    if(!wrap || !text) return;
    const hint = wrap.querySelector('.map-hint');
    if(!hint) return;
    hint.textContent = text;
    hint.classList.add('visible');
    hint.setAttribute('aria-hidden', 'false');
    const rect = wrap.getBoundingClientRect();
    let left = clientX - rect.left + 10;
    let top = clientY - rect.top + 8;
    hint.style.left = left + 'px';
    hint.style.top = top + 'px';
    requestAnimationFrame(()=>{
      const hw = hint.offsetWidth, hh = hint.offsetHeight;
      left = Math.max(6, Math.min(left, rect.width - hw - 6));
      top = Math.max(6, Math.min(top, rect.height - hh - 6));
      hint.style.left = left + 'px';
      hint.style.top = top + 'px';
    });
  }
  
  function handleMapPointerHint(e){
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const text = hintTextFromTarget(hit);
    if(!text){ hideMapHint(); return; }
    showMapHint(e.clientX, e.clientY, text);
  }
  
  function bindMapInteractions(){
    if(!mapSvgEl || mapSvgEl.dataset.bound === '1') return;
    mapSvgEl.dataset.bound = '1';
  
    mapSvgEl.addEventListener('pointermove', e=>{
      if(e.pointerType === 'touch') return;
      handleMapPointerHint(e);
    });
    mapSvgEl.addEventListener('mousemove', e=> handleMapPointerHint(e));
    mapSvgEl.addEventListener('pointerdown', e=>{
      if(e.pointerType !== 'touch') return;
      handleMapPointerHint(e);
      clearTimeout(touchHintTimer);
      touchHintTimer = setTimeout(hideMapHint, 2500);
    });
    mapSvgEl.addEventListener('pointerleave', ()=>{
      clearTimeout(touchHintTimer);
      hideMapHint();
    });
    mapSvgEl.addEventListener('mouseleave', hideMapHint);
    mapSvgEl.addEventListener('click', e=>{
      const target = e.target.closest('.mun-path');
      if(!target) return;
      toggleMunicipio(GEO.features[+target.dataset.idx].properties.cod_mun);
    });
  }
  
  function buildMapSkeleton(){
    computeBounds();
    let paths = '';
    GEO.features.forEach((f,idx)=>{ paths += `<path class="mun-path" data-idx="${idx}" d="${geomToPath(f.geometry)}" fill-rule="evenodd"></path>`; });
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<svg id="mapSvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg"><g id="zoomGroup"><g id="munLayer">${paths}</g></g></svg>`;
    mapSvgEl = wrapper.firstElementChild;
    bindMapInteractions();
  }
  
  function mountMapInActiveTab(){
    const slot = qs('#'+'mapWrap-'+state.tab);
    if(!slot) return;
    hideAllMapHints();
    clearTimeout(touchHintTimer);
    if(!mapSvgEl) buildMapSkeleton();
    if(mapSvgEl.parentElement !== slot) slot.appendChild(mapSvgEl);
    const hint = slot.querySelector('.map-hint');
    if(hint) slot.appendChild(hint);
  }
  
  function bboxPxOfFeatures(feats){
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    feats.forEach(f=>{
      const polys = f.geometry.type==='Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      polys.forEach(poly=>{ poly.forEach(ring=>{ ring.forEach(([lon,lat])=>{
        const [x,y] = proj(lon,lat).map(Number);
        if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
      }); }); });
    });
    return {minX,maxX,minY,maxY};
  }
  function applyZoomToBBox(bbox, pad, maxScale){
    const zg = qs('#'+'zoomGroup'); if(!zg||!bbox) return;
    const bw = Math.max(bbox.maxX-bbox.minX,6), bh = Math.max(bbox.maxY-bbox.minY,6);
    const cx=(bbox.minX+bbox.maxX)/2, cy=(bbox.minY+bbox.maxY)/2;
    let scale = Math.min(W/(bw*pad), H/(bh*pad));
    scale = Math.max(1, Math.min(scale, maxScale));
    currentZoomScale = scale;
    const tx=W/2-cx*scale, ty=H/2-cy*scale;
    zg.setAttribute('transform', `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(3)})`);
  }
  function zoomToMunicipio(codMun){
    if(useWebMap){ void mapApi.zoomToMun(codMun); return; }
    const f = GEO.features.find(f=>f.properties.cod_mun===codMun);
    if(f) applyZoomToBBox(bboxPxOfFeatures([f]), 1.7, 16);
  }
  function zoomToRegiao(){
    if(useWebMap){
      if(state.regiao==='todas' && !state.selectedMun && !state.semiOn){ void mapApi.zoomReset(); return; }
      void mapApi.zoomToState(state);
      return;
    }
    if(state.regiao==='todas' && !state.semiOn){ zoomReset(); return; }
    const feats = state.semiOn
      ? GEO.features.filter(f=>f.properties.semiarido==='SIM' && (state.regiao==='todas' || f.properties.territorio===state.regiao))
      : GEO.features.filter(f=>f.properties.territorio===state.regiao);
    applyZoomToBBox(bboxPxOfFeatures(feats), 1.15, 8);
  }
  function zoomReset(){
    if(useWebMap){ void mapApi.zoomReset(); return; }
    const zg = qs('#'+'zoomGroup'); currentZoomScale=1;
    if(zg) zg.setAttribute('transform','translate(0,0) scale(1)');
  }
  
  function renderMap(){
    if(useWebMap){
      mapApi.sync(state);
      return;
    }

    mountMapInActiveTab();
  
    qsa('#munLayer .mun-path').forEach(pathEl=>{
      const p = GEO.features[+pathEl.dataset.idx].properties;
      const isSelected = state.selectedMun===p.cod_mun;
      const r = mapMetricPct(p);
      const refColor = r.total ? colorForPct(100-r.pctAdeq) : MUN_FILL_NEUTRAL;
      if(state.selectedMun){
        pathEl.setAttribute('fill', isSelected ? refColor : MUN_FILL_GRAYOUT);
        pathEl.classList.toggle('selected', isSelected);
        pathEl.classList.remove('dim');
      } else {
        pathEl.setAttribute('fill', refColor);
        pathEl.classList.remove('selected');
        const inFilter = (state.regiao==='todas' || p.territorio===state.regiao)
          && (!state.semiOn || p.semiarido==='SIM');
        pathEl.classList.toggle('dim', !inFilter);
      }
    });
  }
  
  // ================= VIEW ESGOTO =================
  const ESG_COMP_CATS = [
    {key:'esg_rede_pluvial', label:'Rede geral ou pluvial', good:true},
    {key:'esg_fossa_ligada', label:'Fossa séptica ou fossa filtro ligada à rede', good:true},
    {key:'esg_fossa_sep', label:'Fossa séptica/filtro não ligada à rede', good:true},
    {key:'esg_fossa_rud', label:'Fossa rudimentar ou buraco', good:false},
    {key:'esg_vala', label:'Vala', good:false},
    {key:'esg_rio', label:'Rio, lago, córrego ou mar', good:false},
    {key:'esg_outra', label:'Outra forma', good:false},
    {key:'esg_sem', label:'Não tinham banheiro nem sanitário', good:false},
  ];
  const ESG_LEGACY_CATS = [
    {key:'esg_rede', label:'Rede geral / pluvial ou fossa ligada à rede', good:true},
    {key:'esg_fossa_sep', label:'Fossa séptica/filtro não ligada à rede', good:true},
    {key:'esg_fossa_rud', label:'Fossa rudimentar ou buraco', good:false},
    {key:'esg_vala', label:'Vala', good:false},
    {key:'esg_rio', label:'Rio, lago, córrego ou mar', good:false},
    {key:'esg_outra', label:'Outra forma', good:false},
    {key:'esg_sem', label:'Não tinham banheiro nem sanitário', good:false},
  ];
  // Setores só trazem rede × (banheiro sem rede) × sem banheiro — sem detalhe de fossa/vala/rio
  const ESG_SETORES_CATS = [
    {key:'esg_rede', label:'Rede geral / pluvial ou fossa ligada à rede', good:true},
    {key:'esg_outra', label:'Com banheiro, fora da rede (fossa, vala, rio ou outra)', good:false},
    {key:'esg_sem', label:'Não tinham banheiro nem sanitário', good:false},
  ];
  
  function currentSetoresFeatures(){
    const normCod = (c) => {
      const n = Number(c);
      return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : String(c || '');
    };
    const muns = new Set(currentSelectionFeatures().map(f=>normCod(f.properties.cod_mun)));
    return (SETORES.features||[]).filter(f=>muns.has(normCod(f.properties.cod_mun)));
  }

  function shortFormLabel(label){
    return String(label || '').trim();
  }

  function donutSlicePath(cx, cy, r, ri, a0, a1){
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + ri * Math.cos(a1), y2 = cy + ri * Math.sin(a1);
    const x3 = cx + ri * Math.cos(a0), y3 = cy + ri * Math.sin(a0);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${ri} ${ri} 0 ${large} 0 ${x3} ${y3} Z`;
  }

  /** Donut + legenda no estilo da infraestrutura (valor + %). */
  function renderInfraPie(slices, opts){
    opts = opts || {};
    const size = opts.size || 188;
    const unit = opts.unit || 'domicílios';
    const layout = opts.layout || 'row';
    const pieId = opts.id || ('pie-' + Math.random().toString(36).slice(2, 8));
    const visible = (slices || []).filter(s => (s.value || 0) > 0);
    const total = visible.reduce((s, x) => s + (x.value || 0), 0);
    if (!total) return '<div class="sihs-pie-empty">Sem dado neste recorte</div>';

    const cx = size / 2, cy = size / 2;
    const rOuter = size * 0.447, rInner = size * 0.277;
    const gap = visible.length > 1 ? 0.035 : 0;
    let angle = -Math.PI / 2;
    let paths = '';
    if (visible.length === 1) {
      paths = `<circle class="sihs-pie__slice" data-label="${escapeHtml(visible[0].label)}" data-value="${visible[0].value}" data-pct="100" cx="${cx}" cy="${cy}" r="${rOuter}" fill="${visible[0].color}"></circle>
        <circle cx="${cx}" cy="${cy}" r="${rInner}" fill="#f4f8fb"></circle>`;
    } else {
      visible.forEach(s => {
        const pct = s.value / total * 100;
        const sweep = Math.max(0, Math.min((pct / 100) * 2 * Math.PI, 2 * Math.PI - 1e-6) - gap);
        const a0 = angle + gap / 2;
        const a1 = a0 + sweep;
        angle += sweep + gap;
        paths += `<path class="sihs-pie__slice" data-label="${escapeHtml(s.label)}" data-value="${s.value}" data-pct="${pct}" d="${donutSlicePath(cx, cy, rOuter, rInner, a0, a1 || a0 + Math.PI * 2 - 1e-4)}" fill="${s.color}"></path>`;
      });
      paths = `<circle cx="${cx}" cy="${cy}" r="${rInner - 2}" fill="#f4f8fb"></circle>` + paths;
    }

    const legend = visible.map(s => {
      const pct = s.value / total * 100;
      const name = s.label || s.short || '';
      return `<li data-label="${escapeHtml(s.label)}">
        <button type="button" class="sihs-pie__leg" data-label="${escapeHtml(s.label)}" data-value="${s.value}" data-pct="${pct}" title="${escapeHtml(name)}">
          <i style="background:${s.color}"></i>
          <span>${escapeHtml(name)}</span>
          <b>${fmt(s.value)}</b>
          <em>${fmt1(pct)}%</em>
        </button>
      </li>`;
    }).join('');

    const layoutClass = layout === 'stack' ? ' sihs-pie--stack' : '';
    return `<div class="sihs-pie${layoutClass}" data-pie="${pieId}" data-total="${total}" data-unit="${escapeHtml(unit)}">
      <div class="sihs-pie__viz" style="width:${size}px;height:${size}px">
        <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Gráfico de distribuição">${paths}</svg>
        <div class="sihs-pie__center" data-pie-center>
          <span>Total</span>
          <strong>${fmt(total)}</strong>
          <em>${escapeHtml(unit)}</em>
        </div>
      </div>
      <ul class="sihs-pie__legend">${legend}</ul>
    </div>`;
  }

  function escapeHtml(text){
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bindPieInteractions(scope){
    if (!scope) return;
    scope.querySelectorAll('[data-pie]').forEach(pie => {
      if (pie.dataset.bound === '1') return;
      pie.dataset.bound = '1';
      const center = pie.querySelector('[data-pie-center]');
      const total = Number(pie.dataset.total) || 0;
      const unit = pie.dataset.unit || 'domicílios';
      const setActive = (label, value, pct) => {
        pie.querySelectorAll('.sihs-pie__slice, .sihs-pie__legend li').forEach(el => {
          const match = el.getAttribute('data-label') === label;
          el.classList.toggle('is-hot', !!label && match);
          el.classList.toggle('is-dim', !!label && !match);
        });
        if (!center) return;
        if (!label) {
          center.innerHTML = `<span>Total</span><strong>${fmt(total)}</strong><em>${escapeHtml(unit)}</em>`;
          return;
        }
        center.innerHTML = `<span>${escapeHtml(label)}</span><strong>${fmt(value)}</strong><em>${fmt1(pct)}%</em>`;
      };
      const clear = () => setActive(null);
      pie.addEventListener('mouseleave', clear);
      pie.querySelectorAll('.sihs-pie__slice, .sihs-pie__leg').forEach(el => {
        const activate = () => setActive(el.getAttribute('data-label'), Number(el.getAttribute('data-value')), Number(el.getAttribute('data-pct')));
        el.addEventListener('mouseenter', activate);
        el.addEventListener('focus', activate);
      });
    });
  }

  function formBundle(cats, agg, colorMap){
    const total = cats.reduce((s,c)=>s+(agg[c.key]||0),0);
    const all = cats.map(c=>({
      key: c.key,
      label: c.label,
      short: shortFormLabel(c.label),
      value: agg[c.key]||0,
      color: colorMap[c.key] || '#8aa0ab'
    })).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
    const minPct = 1; // só fatias relevantes no gráfico
    const slices = [];
    let minor = 0;
    const minorNames = [];
    all.forEach(x=>{
      const pct = total ? x.value/total*100 : 0;
      if(pct >= minPct) slices.push(x);
      else {
        minor += x.value;
        minorNames.push(x.label);
      }
    });
    if(minor > 0){
      slices.push({
        key: '_demais',
        label: 'Demais formas (<1% cada): ' + minorNames.join('; '),
        short: 'Demais (<1% cada)',
        value: minor,
        color: '#b8a890'
      });
    }
    return { total, all, slices };
  }

  function splitReading(uPct, tot){
    if(!tot) return 'Não há domicílios com forma declarada nesta seleção.';
    if(uPct>=90) return 'Quase todos os domicílios desta seleção estão em área urbana.';
    if(uPct>=75) return 'A maior parte dos domicílios está em área urbana.';
    if(uPct>=55) return 'Há mais domicílios urbanos do que rurais nesta seleção.';
    if(uPct>=45) return 'Domicílios urbanos e rurais estão em proporção semelhante.';
    if(uPct>=25) return 'Há mais domicílios rurais do que urbanos nesta seleção.';
    if(uPct>=10) return 'A maior parte dos domicílios está em área rural.';
    return 'Quase todos os domicílios desta seleção estão em área rural.';
  }

  function formInsight(bundle, place, verb){
    if(!bundle.slices.length || !bundle.total) return `Não há domicílios com forma declarada em área ${place}.`;
    const top = bundle.slices[0];
    const pct = top.value/bundle.total*100;
    return `Em área <b>${place}</b>, a forma mais comum é <b>${top.label || top.short}</b> (${fmt1(pct)}% ${verb}).`;
  }

  function renderSetoresUrChart(cats, urbColor, rurColor){
    const slot = qs('#'+'setoresChart-esgoto');
    if(!slot) return;
    if(SETORES.__loaded !== true){
      slot.innerHTML = `<div class="setores-loading" role="status" aria-live="polite">
        <span class="setores-loading__spin" aria-hidden="true"></span>
        <div>
          <strong>Carregando setores censitários…</strong>
          <p>Os indicadores acima já estão disponíveis. Urbano/rural aparece em seguida.</p>
        </div>
      </div>`;
      return;
    }
    const feats = currentSetoresFeatures();
    if(!feats.length){
      slot.innerHTML = '<div class="empty-msg">Sem setores censitários para esta seleção.</div>';
      return;
    }
    const urbFeats = feats.filter(f=>f.properties.situacao==='Urbana');
    const rurFeats = feats.filter(f=>f.properties.situacao==='Rural');
    const urb = sumEsg(urbFeats);
    const rur = sumEsg(rurFeats);
    const urbTot = urb.esg_total||0;
    const rurTot = rur.esg_total||0;
    const tot = urbTot + rurTot;
    const uPct = tot ? urbTot/tot*100 : 0;
    const urbCl = classifyEsg(urb);
    const rurCl = classifyEsg(rur);
    const urbForms = formBundle(cats, urb, ESG_CAT_COLORS);
    const rurForms = formBundle(cats, rur, ESG_CAT_COLORS);
    const splitSlices = [
      { label:'Urbano', short:'Urbano', value: urbTot, color: urbColor },
      { label:'Rural', short:'Rural', value: rurTot, color: rurColor }
    ];
    slot.innerHTML = `
      <div class="ur-board">
        <p class="ur-lead">Nos setores, o Censo detalha só <b>rede</b>, <b>com banheiro fora da rede</b> e <b>sem banheiro</b>. Fossa, vala e rio entram juntos no grupo “fora da rede” (o detalhe completo está nos cards de formas acima).</p>
        <section class="ur-panel ur-panel--split">
          <header class="ur-panel__head">
            <p class="ur-panel__eyebrow">Distribuição</p>
            <h3 class="ur-panel__title">Urbano e rural</h3>
          </header>
          ${renderInfraPie(splitSlices, { id: 'split-esgoto', unit: 'domicílios', size: 200 })}
          <p class="ur-read">${splitReading(uPct, tot)}</p>
        </section>
        <div class="ur-forms">
          <section class="ur-panel ur-panel--form">
            <header class="ur-panel__head">
              <p class="ur-panel__eyebrow">Área urbana · ${fmt1(urbCl.pctAdeq)}% adequado</p>
              <h3 class="ur-panel__title">Como esgotam</h3>
              <p class="ur-insight">${formInsight(urbForms, 'urbana', 'dos domicílios urbanos')}</p>
            </header>
            ${renderInfraPie(urbForms.slices, { id: 'urb-esgoto', unit: 'domicílios', size: 168, layout: 'stack' })}
          </section>
          <section class="ur-panel ur-panel--form ur-panel--rur">
            <header class="ur-panel__head">
              <p class="ur-panel__eyebrow">Área rural · ${fmt1(rurCl.pctAdeq)}% adequado</p>
              <h3 class="ur-panel__title">Como esgotam</h3>
              <p class="ur-insight">${formInsight(rurForms, 'rural', 'dos domicílios rurais')}</p>
            </header>
            ${renderInfraPie(rurForms.slices, { id: 'rur-esgoto', unit: 'domicílios', size: 168, layout: 'stack' })}
          </section>
        </div>
      </div>`;
    bindPieInteractions(slot);
  }

  function isEmbasaServed (value) {
    if (value == null || value === '') return false
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value === 1
    const normalized = String(value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase()
    if (!normalized || normalized === 'NAO' || normalized === 'N' || normalized === '0' || normalized.includes('NAO ATEND')) {
      return false
    }
    return (
      normalized === 'SIM' ||
      normalized === 'S' ||
      normalized === '1' ||
      normalized === 'TRUE' ||
      normalized === 'ATENDIDO' ||
      normalized.includes('ATENDIDO') ||
      normalized.includes('EMBASA')
    )
  }

  function embasaEsgotoStatus (value) {
    if (value == null || String(value).trim() === '') return { label: 'Sem informação', kind: 'unknown' }
    return isEmbasaServed(value)
      ? { label: 'Atendido', kind: 'yes' }
      : { label: 'Não atendido', kind: 'no' }
  }

  function renderTabEsgoto(){
    const feats = currentSelectionFeatures();
    const v = sumEsg(feats);
    const cl = classifyEsg(v);
    const pop = feats.reduce((s,f)=>s+(f.properties.populacao||0),0);
    const lig = ligacaoEsg(v);
    const tot = totalDomicilios(v);
    const pctHighlight = tot ? lig.highlight/tot*100 : 0;
    const pctSem = tot ? (v.esg_sem||0)/tot*100 : 0;
    const pctPluvial = tot ? lig.pluvial/tot*100 : 0;
    const pctFossaLig = tot ? lig.fossaLigada/tot*100 : 0;
    const formaCats = lig.pluvial + lig.fossaLigada > 0 ? ESG_COMP_CATS : ESG_LEGACY_CATS;
  
    const bahiaV = sumEsg(GEO.features);
    const bahiaCl = classifyEsg(bahiaV);
    const terr = getTerritorioContext();
  
    const kpiRow = qs('#'+'kpiRow-esgoto');
    if (kpiRow) kpiRow.innerHTML = `
      <div class="kpi">${infoTip('Quantidade de municípios incluídos no filtro ou município atualmente selecionado.')}
        <div class="val">${fmt(feats.length)}</div><div class="lbl">Municípios na seleção</div></div>
      <div class="kpi">${infoTip('População estimada IBGE 2026 somada dos municípios da seleção.')}
        <div class="val">${fmt(pop)}</div><div class="lbl">População (estimativa 2026)</div></div>
      <div class="kpi">${infoTip('Total de domicílios particulares permanentes recenseados no recorte (Censo IBGE 2022 · DPA Indicadores: total_domicílios_recenseados / dom_rec_2022).')}
        <div class="val">${fmt(tot)}</div><div class="lbl">Total de domicílios</div></div>
      <div class="kpi bom">${infoTip('Soma dos campos DPA “rede geral ou pluvial” e “fossa séptica ou fossa filtro ligada à rede” (SIDRA tabela 6805). É o mesmo destaque do card de esgoto no Inventário.')}
        <div class="val">${fmt(lig.highlight)}</div><div class="sub">${fmt1(pctHighlight)}%</div><div class="lbl">Rede geral, rede pluvial ou fossa ligada à rede</div></div>
      <div class="kpi alerta">${infoTip('Domicílios que não tinham banheiro nem sanitário, conforme SIDRA/Censo 2022 (esg_n_t_bs).')}
        <div class="val">${fmt(v.esg_sem)}</div><div class="sub">${fmt1(pctSem)}%</div><div class="lbl">Não tinham banheiro nem sanitário</div></div>
      <div class="kpi bom">${infoTip('Domicílios cuja forma de esgotamento é rede geral ou rede pluvial (campo DPA esg_rede_geral_ou_pluvia).')}
        <div class="val">${fmt(lig.pluvial)}</div>
        <div class="sub">${fmt1(pctPluvial)}%</div>
        <div class="lbl">Rede geral ou pluvial</div></div>
      <div class="kpi">${infoTip('Domicílios com fossa séptica ou fossa filtro ligada à rede (campo DPA esg_fossa_septica_ou_fossa_filtro_ligada_a_rede).')}
        <div class="val">${fmt(lig.fossaLigada)}</div>
        <div class="sub">${fmt1(pctFossaLig)}%</div>
        <div class="lbl">Fossa séptica ou fossa filtro ligada à rede</div></div>
    `;
  
    const colors = categoryColors(formaCats);
    const compTitle = 'Formas de esgotamento';
    setPanelHeader('#view-esgoto .area-comp .panel-header', compTitle,
      'Cada card mostra a quantidade de domicílios e a % na seleção. Quando há município ou recorte, também aparece o peso no território e na Bahia.');

    const compChart = qs('#'+'compChart-esgoto');
    if (compChart) compChart.innerHTML = renderCompChart({
      cats: formaCats, colors, v, cl, bahiaV, bahiaCl, terr,
      lightColor: '#F5EBDD', lightBorder: '#D9BC8C',
      tip: 'Valor = domicílios. % = participação na seleção. Território/Bahia = peso desta seleção no total daquela forma.',
    });

    setPanelHeader('#view-esgoto .area-setores .panel-header',
      'Urbano e rural — setores censitários · ' + currentSelectionLabel(),
      'Composição urbana e rural a partir da menor unidade do Censo (setor censitário). Campo Situação do Setor Censitário. Acompanha o recorte do mapa (território, semiárido ou município) e não aparece no mapa.');
    renderSetoresUrChart(ESG_SETORES_CATS, '#8B5A2B', '#D9BC8C');
  }
  
  // ================= município: detalhe =================
  function renderMuniDetail(){
    const panel = qs('#'+'muniDetailPanel');
    if(!state.selectedMun){ panel.style.display='none'; return; }
    const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
    if(!f){ panel.style.display='none'; return; }
    const p = f.properties;
    panel.style.display='';
  
    qs('#'+'muniDetailName').textContent = p.nm_mun;
  
    const embasa = embasaEsgotoStatus(p.embasa_esgoto);
    const meta = [p.territorio, p.semiarido==='SIM' ? 'Semiárido' : null].filter(Boolean).join(' · ');
    qs('#'+'muniDetailBody').innerHTML = `
      <p class="muni-detail-meta" title="${meta}">${meta}</p>
      <div class="embasa-status is-${embasa.kind}" role="status">
        <span class="embasa-status__brand">Embasa</span>
        <strong class="embasa-status__value">${embasa.label}</strong>
      </div>
      <div class="detail-grid">
        <div class="detail-item"><div class="v">${fmt(p.populacao)}</div><div class="l">População</div></div>
        <div class="detail-item"><div class="v">${fmt(p.total_domicilios || p.esg_total)}</div><div class="l">Domicílios</div></div>
        <div class="detail-item wide"><div class="v text">${p.territorio}</div><div class="l">Território de Identidade</div></div>
      </div>
    `;
  }
  
  function renderCurrentTab(){
    renderMap();
    renderTabEsgoto();
    renderMuniDetail();
  }
  
  function updateMuniSelectionUI(){
    const btn = qs('#'+'muniClear');
    const hasSelection = !!state.selectedMun;
    btn.classList.toggle('visible', hasSelection);
    btn.disabled = !hasSelection;
    btn.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');
  
    const btnAgl = qs('#'+'btnAglomerados');
    const hintAgl = qs('#'+'aglomeradosHint');
    if(btnAgl) btnAgl.disabled = !hasSelection;
    if(hintAgl) hintAgl.hidden = hasSelection;
    if(!hasSelection) closeAglomeradosModal();
  }
  
  function tipoAglomerado(nome){
    const s = String(nome||'').toLowerCase();
    if(/quilombola/.test(s)) return 'Comunidade quilombola';
    if(/aldeia|indígena|indigena/.test(s)) return 'Aldeia indígena';
    return 'Aglomerado rural';
  }
  
  function aglomeradosDoMunicipio(codMun){
    const pts = PTS_DATA || [];
    const cod = String(codMun||'');
    return pts
      .filter(p => String(p.m) === cod)
      .slice()
      .sort((a,b)=> String(a.n||'').localeCompare(String(b.n||''), 'pt-BR'));
  }
  
  function openAglomeradosModal(){
    if(!state.selectedMun) return;
    const modal = qs('#'+'aglomeradosModal');
    const btn = qs('#'+'btnAglomerados');
    if(modal?.classList.contains('is-open')){
      closeAglomeradosModal();
      return;
    }
  
    const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
    const nm = f ? f.properties.nm_mun : state.selectedMun;
    const rows = aglomeradosDoMunicipio(state.selectedMun);
    const title = qs('#'+'aglomeradosTitle');
    const tbody = qs('#'+'aglomeradosTbody');
    const empty = qs('#'+'aglomeradosEmpty');
    const table = qs('#'+'aglomeradosTable');
  
    const qtd = rows.length;
    title.textContent = `Aglomerados — ${nm} · ${qtd} ${qtd === 1 ? 'aglomerado' : 'aglomerados'}`;
    tbody.innerHTML = rows.map(p => `
      <tr>
        <td>${p.n || '—'}</td>
        <td>${tipoAglomerado(p.n)}</td>
        <td>${p.mn || nm}</td>
        <td class="num">${fmt(p.h)}</td>
      </tr>
    `).join('');
  
    const has = qtd > 0;
    table.style.display = has ? '' : 'none';
    empty.style.display = has ? 'none' : '';
    empty.textContent = 'Nenhum aglomerado encontrado para este município.';
    modal.hidden = false;
    if(btn) btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(()=> modal.classList.add('is-open'));
  }
  
  function closeAglomeradosModal(){
    const modal = qs('#'+'aglomeradosModal');
    const btn = qs('#'+'btnAglomerados');
    if(btn) btn.setAttribute('aria-expanded', 'false');
    if(!modal || !modal.classList.contains('is-open')) {
      if(modal) modal.hidden = true;
      return;
    }
    modal.classList.remove('is-open');
    const done = ()=>{
      modal.hidden = true;
      modal.removeEventListener('transitionend', done);
    };
    modal.addEventListener('transitionend', done);
    setTimeout(done, 280);
  }
  
  function toggleMunicipio(codMun){
    if(state.selectedMun === codMun) clearMunicipio();
    else selectMunicipio(codMun);
  }
  
  function selectMunicipio(codMun){
    state.selectedMun = codMun;
    const f = GEO.features.find(f=>f.properties.cod_mun===codMun);
    qs('#'+'muniSearch-esgoto').value = f?f.properties.nm_mun:'';
    updateMuniSelectionUI();
    zoomToMunicipio(codMun);
    renderCurrentTab();
  }
  function clearMunicipio(){
    state.selectedMun = null;
    qs('#'+'muniSearch-esgoto').value = '';
    updateMuniSelectionUI();
    zoomToRegiao();
    renderCurrentTab();
  }
  function applyRegiaoFilter(nome){
    state.regiao = nome;
    state.selectedMun = null;
    qs('#'+'muniSearch-esgoto').value = '';
    updateMuniSelectionUI();
    renderControls();
    zoomToRegiao();
    renderCurrentTab();
  }
  
  async function exportRelatorioPdf(){
    const btn = qs('#'+'btnExportPdf');
    if(btn){ btn.disabled = true; btn.textContent = 'Gerando PDF…'; }
    try {
      const feats = currentSelectionFeatures();
      const v = sumEsg(feats);
      const cl = classifyEsg(v);
      const pop = feats.reduce((s,f)=>s+(f.properties.populacao||0),0);
      const lig = ligacaoEsg(v);
      const tot = totalDomicilios(v);
      const pctHighlight = tot ? lig.highlight/tot*100 : 0;
      const pctSem = tot ? (v.esg_sem||0)/tot*100 : 0;
      const pctPluvial = tot ? lig.pluvial/tot*100 : 0;
      const pctFossaLig = tot ? lig.fossaLigada/tot*100 : 0;
      const formaCats = lig.pluvial + lig.fossaLigada > 0 ? ESG_COMP_CATS : ESG_LEGACY_CATS;
      const setorFeats = currentSetoresFeatures();
      const urbFeats = setorFeats.filter(f=>f.properties.situacao==='Urbana');
      const rurFeats = setorFeats.filter(f=>f.properties.situacao==='Rural');
      const urb = sumEsg(urbFeats);
      const rur = sumEsg(rurFeats);
      const urbTot = urb.esg_total||0;
      const rurTot = rur.esg_total||0;
      const setorTot = urbTot + rurTot;
      const uPct = setorTot ? urbTot/setorTot*100 : 0;
      const rPct = setorTot ? rurTot/setorTot*100 : 0;
      const pctIn = (part, tot) => tot ? fmt1(part/tot*100)+'% da área' : '—';
      const mapDataUrl = mapApi && typeof mapApi.capture === 'function' ? await mapApi.capture(state) : null;
      const mapLegend = mapApi && typeof mapApi.captureLegend === 'function' ? await mapApi.captureLegend() : [];
      const formaBars = formaCats.map(c=>{
        const val = v[c.key]||0;
        return {
          label: c.label,
          value: fmt(val),
          pct: tot ? val/tot*100 : 0,
          color: ESG_CAT_COLORS[c.key] || '#8B5A2B'
        };
      });
      await downloadRelatorioPdf({
        title: 'Relatório de esgotamento sanitário',
        theme: 'esgoto',
        scope: currentSelectionLabel(),
        source: 'DPA Indicadores (SIDRA / Censo IBGE 2022, município). Urbano/rural: setores censitários IBGE.',
        fileName: `relatorio-esgotamento-${slugRelatorio(currentSelectionLabel())}.pdf`,
        kpis: [
          { label: 'Municípios na seleção', value: fmt(feats.length) },
          { label: 'População (estimativa 2026)', value: fmt(pop) },
          { label: 'Total de domicílios', value: fmt(tot) },
          { label: 'Rede geral, rede pluvial ou fossa ligada à rede', value: fmt(lig.highlight), sub: fmt1(pctHighlight)+'%' },
          { label: 'Não tinham banheiro nem sanitário', value: fmt(v.esg_sem), sub: fmt1(pctSem)+'%' },
          { label: 'Rede geral ou pluvial', value: fmt(lig.pluvial), sub: fmt1(pctPluvial)+'%' },
          { label: 'Fossa séptica ou fossa filtro ligada à rede', value: fmt(lig.fossaLigada), sub: fmt1(pctFossaLig)+'%' },
        ],
        guide: {
          title: 'Como ler este relatório',
          items: [
            'A seção 1 traz o total oficial de cada forma no recorte (dado municipal). Rede, fossa e as demais formas desta seção são os números a citar.',
            'A seção 2 mostra só onde estão os domicílios (urbano ou rural) e como cada área esgota. Ali o 100% é a área urbana ou a área rural — não o município.',
            'Não some urbano + rural para conferir a seção 1. São tabelas diferentes do IBGE e os totais por forma não fecham entre si.'
          ]
        },
        mapCaption: currentSelectionLabel(),
        mapDataUrl,
        mapLegendTitle: 'Legenda do mapa',
        mapLegendNote: 'Símbolos e cores iguais aos da legenda do mapa na tela.',
        mapLegend,
        sections: [
          {
            title: '1. Domicílios por forma de esgotamento (dado municipal)',
            note: 'Fonte: SIDRA tabela 6805, compilada na camada DPA_Indicadores_Censo_2022. 100% = domicílios do recorte. Use estes valores como o total oficial de cada forma.',
            bars: formaBars,
            table: {
              headers: ['Forma de esgotamento', 'Domicílios', '% do recorte'],
              rows: formaBars.map(b=>[b.label, b.value, fmt1(b.pct)+'%'])
            }
          },
          {
            title: '2. Urbano e rural — onde estão os domicílios (setores)',
            note: 'Fonte: Censo IBGE 2022, camada Setores Censitarios_BA, campo Situação do setor. Esta seção não reproduz os totais da seção 1.',
            table: {
              headers: ['Leitura', 'Área urbana', 'Área rural'],
              rows: [
                ['Domicílios nos setores', fmt(urbTot), fmt(rurTot)],
                ['Participação nesta divisão', fmt1(uPct)+'%', fmt1(rPct)+'%']
              ]
            }
          },
          {
            title: '2b. Como cada área esgota (100% da área, não do município)',
            note: 'Percentual dentro do urbano e dentro do rural. Ex.: 40% no urbano = 40% dos domicílios urbanos usam aquela forma — não 40% do município. Os totais oficiais continuam na seção 1.',
            table: {
              headers: ['Forma de esgotamento', 'No urbano', 'No rural'],
              rows: ESG_SETORES_CATS.filter(c=>((urb[c.key]||0)+(rur[c.key]||0))>0).map(c=>[
                c.label,
                pctIn(urb[c.key]||0, urbTot),
                pctIn(rur[c.key]||0, rurTot)
              ])
            }
          },
          {
            title: 'Fontes dos indicadores',
            note: 'A camada DPA_Indicadores_Censo_2022 reúne indicadores SIDRA do Censo IBGE 2022 por município. O urbano/rural usa os setores censitários, outra tabela do mesmo Censo.',
            table: {
              headers: ['Indicador', 'Fonte'],
              colWeights: [1.15, 2.35],
              rows: [
                ['População', 'Estimativa IBGE 2026 · DPA Indicadores (população estimada)'],
                ['Total de domicílios', 'Censo IBGE 2022 · DPA Indicadores (total_domicílios_recenseados / dom_rec_2022)'],
                ['Municípios na seleção', 'Contagem do recorte no mapa · DPA_Indicadores_Censo_2022'],
                ['Rede geral, rede pluvial ou fossa ligada à rede', 'Soma DPA: esg_rede_geral_ou_pluvia + esg_fossa_septica_ou_fossa_filtro_ligada_a_rede (SIDRA 6805)'],
                ['Rede geral ou pluvial', 'SIDRA tabela 6805 · DPA Indicadores (esg_rede_geral_ou_pluvia)'],
                ['Fossa séptica ou fossa filtro ligada à rede', 'SIDRA tabela 6805 · DPA Indicadores (esg_fossa_septica_ou_fossa_filtro_ligada_a_rede)'],
                ['Não tinham banheiro nem sanitário', 'SIDRA tabela 6805 · DPA Indicadores (esg_n_t_bs)'],
                ['Domicílios urbanos e rurais', 'Censo IBGE 2022 · Setores Censitarios_BA (Situação do setor + v0002)'],
                ['Formas no urbano e no rural', 'Censo IBGE 2022 · Setores censitários (v00309 rede, v00232 banheiro). Não fecha com o total municipal da tabela 6805.'],
                ['Mapa da seleção', 'Web map de esgotamento · camada municipal DPA Indicadores']
              ]
            }
          }
        ]
      });
    } catch (error) {
      console.error('[esgotamento] Falha ao exportar PDF:', error);
      window.alert('Não foi possível gerar o PDF da seleção.');
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = 'Exportar PDF'; }
    }
  }

  qs('#'+'btnAglomerados')?.addEventListener('click', openAglomeradosModal);
  qs('#'+'btnExportPdf')?.addEventListener('click', () => { void exportRelatorioPdf(); });
  qs('#'+'aglomeradosClose')?.addEventListener('click', closeAglomeradosModal);
  renderControls();
  updateMuniSelectionUI();
  populateMuniList();
  if(!useWebMap) buildMapSkeleton();
  renderCurrentTab();

  const unbindMap = [];
  if(useWebMap){
    if(typeof mapApi.setMunicipios === 'function'){
      mapApi.setMunicipios(GEO.features.map(f => f.properties));
    }
    unbindMap.push(mapApi.onSelect(toggleMunicipio));
    unbindMap.push(mapApi.onHover((name, x, y)=>{
      if(!name){ hideMapHint(); return; }
      showMapHint(x, y, name);
    }));
  }
  

  function onDocClick (e) {
    const tip = e.target?.closest?.('.info-tip')
    qsa('.info-tip.is-open').forEach(el => {
      if (el !== tip) el.classList.remove('is-open')
    })
    if (tip && root.contains(tip)) {
      e.preventDefault()
      tip.classList.toggle('is-open')
    }
  }

  function onDocKeyDown (e) {
    if (e.key === 'Escape') {
      closeAglomeradosModal()
      qsa('.info-tip.is-open').forEach(el => el.classList.remove('is-open'))
    }
  }

  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onDocKeyDown)

  SETORES.__refresh = () => {
    try {
      setPanelHeader('#view-esgoto .area-setores .panel-header',
        'Urbano e rural — setores censitários · ' + currentSelectionLabel(),
        'Composição urbana e rural a partir da menor unidade do Censo (setor censitário). Campo Situação do Setor Censitário. Acompanha o recorte do mapa (território, semiárido ou município) e não aparece no mapa.');
      renderSetoresUrChart(ESG_SETORES_CATS, '#8B5A2B', '#D9BC8C');
    } catch (error) {
      console.warn('[esgotamento] refresh setores:', error);
    }
  }

  return function destroy () {
    document.removeEventListener('click', onDocClick)
    document.removeEventListener('keydown', onDocKeyDown)
    unbindMap.forEach(fn => { try { fn?.() } catch (_) {} })
    clearTimeout(touchHintTimer)
    if (mapSvgEl && mapSvgEl.parentElement) mapSvgEl.parentElement.removeChild(mapSvgEl)
    try { delete SETORES.__refresh } catch (_) { SETORES.__refresh = null }
  }
}
