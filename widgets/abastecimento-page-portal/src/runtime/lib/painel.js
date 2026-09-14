/* Generated from js/painel.js — do not edit by hand. */
import { downloadRelatorioPdf, slugRelatorio } from './relatorio-pdf'
/**
 * @param {HTMLElement} root
 * @param {any} GEO
 * @param {any} PTS_DATA
 * @param {any} [mapApi]
 * @param {any} [SETORES]
 */
export function initPainelAgua (root, GEO, PTS_DATA, mapApi, SETORES) {
  if (!root || !GEO) return () => {}

  const qs = (sel) => root.querySelector(sel)
  const qsa = (sel) => Array.from(root.querySelectorAll(sel))
  const useWebMap = !!(mapApi && typeof mapApi.sync === 'function')
  SETORES = SETORES && Array.isArray(SETORES.features) ? SETORES : { features: [] }

  const genDate = qs('#'+'genDate');
  if (genDate) genDate.textContent = new Date().toLocaleDateString('pt-BR');
  
  // ---------------- estado ----------------
  let state = {
    tab: 'agua',
    groupBy: 'territorio',
    regiao: 'todas',
    selectedMun: null,
    semiOn: false,
  };
  
  function fmt(n){
    const v = Number(n);
    if(!Number.isFinite(v)) return 'Sem dado';
    if(Math.abs(v - Math.round(v)) < 1e-9) return Math.round(v).toLocaleString('pt-BR');
    return v.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function fmt1(n){
    const v = Number(n);
    if(!Number.isFinite(v)) return 'Sem dado';
    return v.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
  }
  function sharePct(part, whole){
    if(!(Number(whole) > 0)) return null;
    return (Number(part)||0) / Number(whole) * 100;
  }
  function fmtShare(pct){
    if(pct==null || !Number.isFinite(Number(pct))) return 'Sem dado';
    return fmt1(pct) + '%';
  }

  function formatCodigo(value){
    const raw = String(value ?? '').trim();
    if(!raw || raw === '—') return '—';
    const sci = raw.replace(/\s/g, '').replace(',', '.');
    if(/e[+-]?\d+/i.test(sci) || typeof value === 'number'){
      const n = typeof value === 'number' ? value : Number(sci);
      if(Number.isFinite(n)){
        return Math.round(n).toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 });
      }
    }
    return raw;
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

  function embasaAguaStatus (value) {
    if (value == null || String(value).trim() === '') return { label: 'Sem informação', kind: 'unknown' }
    return isEmbasaServed(value)
      ? { label: 'Atendido', kind: 'yes' }
      : { label: 'Não atendido', kind: 'no' }
  }
  
  /* Escala do mapa: déficit de adequação (0% = tudo adequado → 100% = nada adequado).
     Paleta azul do abastecimento (escuro = adequado → claro = sem ligação). */
  function colorForPct(p){
    const stops = [
      {v:0,  c:[7,28,51]},      // #071C33 — 100% adequado
      {v:25, c:[27,95,160]},    // #1B5FA0
      {v:50, c:[76,163,222]},   // #4CA3DE
      {v:75, c:[163,212,240]},  // #A3D4F0
      {v:100,c:[239,247,252]},  // #EFF7FC — 0% adequado
    ];
    let lo=stops[0], hi=stops[stops.length-1];
    for(let i=0;i<stops.length-1;i++){ if(p>=stops[i].v && p<=stops[i+1].v){ lo=stops[i]; hi=stops[i+1]; break; } }
    const t = (hi.v===lo.v) ? 0 : (p-lo.v)/(hi.v-lo.v);
    const c = lo.c.map((x,i)=>Math.round(x + (hi.c[i]-x)*t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }
  
  /* Cores fixas por categoria SIDRA — paleta azul de abastecimento */
  const AA_CAT_COLORS = {
    aa_rede:      '#071C33', // Rede geral de distribuição
    aa_poco_prof: '#0F3D66', // Poço profundo ou artesiano
    aa_fonte:     '#1B5FA0', // Fonte, nascente ou mina
    aa_chuva:     '#2B82C9', // Água de chuva armazenada
    aa_poco_raso: '#4CA3DE', // Poço raso, freático ou cacimba
    aa_pipa:      '#78BFE8', // Carro-pipa
    aa_rio:       '#A3D4F0', // Rios, açudes, córregos e lagos
    aa_outra:     '#C9E4F5', // Outra forma
    aa_sem_rede:  '#EFF7FC', // Não possui ligação à rede geral
  };
  function categoryColors(cats){
    return cats.map(c => AA_CAT_COLORS[c.key] || '#6b7c8a');
  }
  
  // ---------------- agregação SIDRA — abastecimento de água ----------------
  const AA_KEYS = ['aa_rede','aa_poco_prof','aa_poco_raso','aa_fonte','aa_pipa','aa_chuva','aa_rio','aa_outra','aa_sem_rede'];
  
  function sumAa(feats){
    const out = { aa_total:0, total_domicilios:0 };
    AA_KEYS.forEach(k=> out[k]=0);
    feats.forEach(f=>{
      const p = f.properties;
      out.aa_total += p.aa_total||0;
      out.total_domicilios += p.total_domicilios||0;
      AA_KEYS.forEach(k=> out[k] += p[k]||0);
    });
    const sem = out.aa_sem_rede||0;
    out.aa_total = sidraPossuiLigacao(out) + sem;
    return out;
  }

  function sidraPossuiLigacao (v) {
    return Math.max(0, (v.aa_total||0) - (v.aa_sem_rede||0));
  }

  function totalDomicilios (v) {
    return sidraPossuiLigacao(v) + (v.aa_sem_rede||0);
  }
  
  function classifyAa(v){
    const adequado = (v.aa_rede||0) + (v.aa_poco_prof||0) + (v.aa_poco_raso||0);
    const inadequado = (v.aa_fonte||0) + (v.aa_pipa||0) + (v.aa_chuva||0) + (v.aa_rio||0) + (v.aa_outra||0);
    const sem = v.aa_sem_rede||0;
    const total = v.aa_total||0;
    return {
      adequado, inadequado, sem, total,
      pctAdeq: total? adequado/total*100:0,
      pctInadeq: total? inadequado/total*100:0,
      pctSem: total? sem/total*100:0,
    };
  }
  
  function mapMetricPct(p){
    return classifyAa({
      aa_total: p.aa_total,
      aa_rede: p.aa_rede,
      aa_poco_prof: p.aa_poco_prof,
      aa_poco_raso: p.aa_poco_raso,
      aa_fonte: p.aa_fonte,
      aa_pipa: p.aa_pipa,
      aa_chuva: p.aa_chuva,
      aa_rio: p.aa_rio,
      aa_outra: p.aa_outra,
      aa_sem_rede: p.aa_sem_rede,
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
  function currentScopeTitle(){
    if(state.selectedMun){
      const f = GEO.features.find(x=>x.properties.cod_mun===state.selectedMun);
      return f?f.properties.nm_mun:state.selectedMun;
    }
    if(state.semiOn && state.regiao==='todas'){
      return 'Região Semiárida';
    }
    if(state.regiao!=='todas'){
      return state.regiao;
    }
    return 'Estado da Bahia';
  }

  function currentScopeKicker(){
    if(state.selectedMun) return 'Município';
    if(state.semiOn && state.regiao==='todas') return 'Recorte atual';
    if(state.regiao!=='todas') return state.semiOn ? 'Território · Semiárido' : 'Território de Identidade';
    return 'Recorte atual';
  }

  function currentSelectionLabel(){
    if(state.selectedMun){
      const f = GEO.features.find(x=>x.properties.cod_mun===state.selectedMun);
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
  
  function setPanelHeader(selector, title, tip, kicker){
    const header = qs(selector);
    if(!header) return;
    const kickerHtml = kicker
      ? `<span class="panel-kicker">${kicker}</span>`
      : '';
    header.innerHTML = `<span class="panel-title-stack">${kickerHtml}<span class="panel-title-text">${title}</span></span>${infoTip(tip)}`;
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
    const v = sumAa(feats);
    const cl = classifyAa(v);
    const pop = feats.reduce((s,f)=>s+(f.properties.populacao||0),0);
    return { name: terrName, feats, v, cl, pop };
  }
  
  /** Painel de contexto: metodologia (Bahia) ou comparação com TI + Estado. */
  function renderVsBahiaHtml({ label, feats, v, cl, pop, bahiaV, bahiaCl, bahiaPop, semLabel, terr }){
    if(isFullState()){
      return `<p><b>${label}</b><br><br>
        Dados SIDRA/IBGE (Censo 2022) — domicílios particulares permanentes ocupados por forma de abastecimento de água.
        <br><br>
        <b>Adequado</b> = rede geral de distribuição + poço profundo/artesiano + poço raso/freático/cacimba.
        <br><b>Inadequado</b> = fonte/nascente, carro-pipa, água de chuva, rios/açudes ou outra forma.
      </p>`;
    }
  
    const shareDom = bahiaV.aa_total ? (v.aa_total||0)/bahiaV.aa_total*100 : 0;
    const sharePop = bahiaPop ? pop/bahiaPop*100 : 0;
    const shareDomTi = terr?.v?.aa_total ? (v.aa_total||0)/terr.v.aa_total*100 : null;
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
          ${cell('Atendimento adequado', cl.pctAdeq, terr?terr.cl.pctAdeq:null, bahiaCl.pctAdeq)}
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
      const color = colors[i];
      const light = String(color||'').toUpperCase() === String(lightColor||'').toUpperCase();
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
      return `<article class="comp-card" style="--card-accent:${color}">
        <div class="comp-card-head">
          <span class="comp-card-swatch" aria-hidden="true"></span>
          <span class="comp-card-label" title="${c.label}">${c.label}</span>
          ${infoTip(why)}
        </div>
        <div class="comp-card-metrics">
          <p class="comp-card-pct" title="${fmt(val)} domicílios (${fmt1(pct)}%)">${fmt1(pct)}<small>%</small></p>
          <p class="comp-card-count"><strong>${fmt(val)}</strong><span>domicílios</span></p>
        </div>
        ${(showTi || showBa) ? `<div class="comp-card-refs">
          ${showTi ? `<span><b>${fmtShare(tiShare)}</b> território</span>` : ''}
          ${showBa ? `<span><b>${fmtShare(baShare)}</b> Bahia</span>` : ''}
        </div>` : ''}
        <div class="comp-card-bar" aria-hidden="true">
          <span style="width:${Math.min(100, pct)}%;background:${color}${fillExtra}"></span>
        </div>
      </article>`;
    }).join('');

    return `<div class="comp-stage">
      <div class="comp-cards">${cards}</div>
      <div class="comp-legend end">${infoTip(tip)}</div>
    </div>`;
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
    const input = qs('#'+'muniSearch-agua');
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
    const input = qs('#'+'muniSearch-agua');
    if(!input) return;
    const n = normMun(input.value);
    if(!n) return;
    const f = GEO.features.find(f=>normMun(f.properties.nm_mun)===n);
    if(f) selectMunicipio(f.properties.cod_mun);
  }
  qs('#'+'muniSearch-agua')?.addEventListener('change', pickMunicipioFromInput);
  qs('#'+'muniSearch-agua')?.addEventListener('keydown', e=>{
    if(e.key==='Enter'){ e.preventDefault(); pickMunicipioFromInput(); }
  });
  function populateMuniList(){
    const list = qs('#'+'muniList-agua');
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
    if(state.selectedMun){ hideMapHint(); return; }
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
    if(state.selectedMun){ hideMapHint(); return; }
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
        pathEl.classList.remove('dim', 'in-territorio');
      } else {
        pathEl.setAttribute('fill', refColor);
        pathEl.classList.remove('selected');
        const inFilter = (state.regiao==='todas' || p.territorio===state.regiao)
          && (!state.semiOn || p.semiarido==='SIM');
        pathEl.classList.toggle('dim', !inFilter);
        pathEl.classList.toggle('in-territorio', inFilter && state.regiao !== 'todas');
      }
    });
  }
  
  // ================= VIEW ÁGUA =================
  const AA_COMP_CATS = [
    {key:'aa_rede', label:'Rede geral de distribuição', good:true},
    {key:'aa_poco_prof', label:'Poço profundo ou artesiano', good:true},
    {key:'aa_poco_raso', label:'Poço raso, freático ou cacimba', good:true},
    {key:'aa_fonte', label:'Fonte, nascente ou mina', good:false},
    {key:'aa_pipa', label:'Carro-pipa', good:false},
    {key:'aa_chuva', label:'Água de chuva armazenada', good:false},
    {key:'aa_rio', label:'Rios, açudes, córregos e lagos', good:false},
    {key:'aa_outra', label:'Outra forma (categoria do Censo)', good:false},
    {key:'aa_sem_rede', label:'Não possui ligação à rede geral', good:false},
  ];
  // Camada de setores só tem v00111–v00117 (sem “Outra”). O residual NÃO é categoria do Censo.
  const AA_SETORES_CATS = [
    {key:'aa_rede', label:'Rede geral de distribuição', good:true},
    {key:'aa_poco_prof', label:'Poço profundo ou artesiano', good:true},
    {key:'aa_poco_raso', label:'Poço raso, freático ou cacimba', good:true},
    {key:'aa_fonte', label:'Fonte, nascente ou mina', good:false},
    {key:'aa_pipa', label:'Carro-pipa', good:false},
    {key:'aa_chuva', label:'Água de chuva armazenada', good:false},
    {key:'aa_rio', label:'Rios, açudes, córregos e lagos', good:false},
  ];

  function classifyAaSetores(v){
    const adequado = (v.aa_rede||0) + (v.aa_poco_prof||0) + (v.aa_poco_raso||0);
    const inadequado = (v.aa_fonte||0) + (v.aa_pipa||0) + (v.aa_chuva||0) + (v.aa_rio||0);
    const known = adequado + inadequado;
    const gap = Math.max(0, (v.aa_total||0) - known);
    return {
      adequado, inadequado, known, gap,
      pctAdeq: known ? adequado/known*100 : 0,
      pctGap: (v.aa_total||0) ? gap/(v.aa_total||0)*100 : 0
    };
  }
  
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
        color: '#9aafbc'
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

  function setoresGapNote(cl, place){
    if(!cl.gap) return '';
    return `<p class="ur-gap"><b>${fmt(cl.gap)}</b> domicílios (${fmt1(cl.pctGap)}% do total ${place}) ficam fora destas formas: a camada de setores <b>não traz</b> a categoria “Outra” do Censo — por isso esse resto não entra no gráfico.</p>`;
  }

  function renderSetoresUrChart(cats, urbColor, rurColor){
    const slot = qs('#'+'setoresChart-agua');
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
    const urb = sumAa(urbFeats);
    const rur = sumAa(rurFeats);
    const urbTot = urb.aa_total||0;
    const rurTot = rur.aa_total||0;
    const tot = urbTot + rurTot;
    const uPct = tot ? urbTot/tot*100 : 0;
    const urbCl = classifyAaSetores(urb);
    const rurCl = classifyAaSetores(rur);
    const urbForms = formBundle(cats, urb, AA_CAT_COLORS);
    const rurForms = formBundle(cats, rur, AA_CAT_COLORS);
    const splitSlices = [
      { label:'Urbano', short:'Urbano', value: urbTot, color: urbColor },
      { label:'Rural', short:'Rural', value: rurTot, color: rurColor }
    ];
    slot.innerHTML = `
      <div class="ur-board">
        <p class="ur-lead">Nos setores o IBGE publica só 7 formas (rede, poços, fonte, pipa, chuva e rios). O gráfico usa <b>só essas</b>. O detalhe “Outra forma” do Censo aparece nos cards de formas do município, não nesta camada.</p>
        <section class="ur-panel ur-panel--split">
          <header class="ur-panel__head">
            <p class="ur-panel__eyebrow">Distribuição</p>
            <h3 class="ur-panel__title">Urbano e rural</h3>
          </header>
          ${renderInfraPie(splitSlices, { id: 'split-agua', unit: 'domicílios', size: 200 })}
          <p class="ur-read">${splitReading(uPct, tot)}</p>
        </section>
        <div class="ur-forms">
          <section class="ur-panel ur-panel--form">
            <header class="ur-panel__head">
              <p class="ur-panel__eyebrow">Área urbana · ${fmt1(urbCl.pctAdeq)}% adequado entre as formas detalhadas</p>
              <h3 class="ur-panel__title">Como se abastecem</h3>
              <p class="ur-insight">${formInsight(urbForms, 'urbana', 'das formas detalhadas')}</p>
            </header>
            ${renderInfraPie(urbForms.slices, { id: 'urb-agua', unit: 'domicílios', size: 168, layout: 'stack' })}
            ${setoresGapNote(urbCl, 'urbano')}
          </section>
          <section class="ur-panel ur-panel--form ur-panel--rur">
            <header class="ur-panel__head">
              <p class="ur-panel__eyebrow">Área rural · ${fmt1(rurCl.pctAdeq)}% adequado entre as formas detalhadas</p>
              <h3 class="ur-panel__title">Como se abastecem</h3>
              <p class="ur-insight">${formInsight(rurForms, 'rural', 'das formas detalhadas')}</p>
            </header>
            ${renderInfraPie(rurForms.slices, { id: 'rur-agua', unit: 'domicílios', size: 168, layout: 'stack' })}
            ${setoresGapNote(rurCl, 'rural')}
          </section>
        </div>
      </div>`;
    bindPieInteractions(slot);
  }

  function renderTabAgua(){
    const feats = currentSelectionFeatures();
    const v = sumAa(feats);
    const cl = classifyAa(v);
    const pop = feats.reduce((s,f)=>s+(f.properties.populacao||0),0);
    const comForma = sidraPossuiLigacao(v);
    const outraForma = Math.max(0, comForma - (v.aa_rede||0));
    const totSidra = totalDomicilios(v);
    const pctCom = totSidra ? comForma/totSidra*100 : 0;
    const pctSem = totSidra ? (v.aa_sem_rede||0)/totSidra*100 : 0;
    const pctRede = totSidra ? (v.aa_rede||0)/totSidra*100 : 0;
    const pctOutra = totSidra ? outraForma/totSidra*100 : 0;
  
    const bahiaV = sumAa(GEO.features);
    const bahiaCl = classifyAa(bahiaV);
    const terr = getTerritorioContext();
  
    const pctUsaLig = comForma ? (v.aa_rede||0)/comForma*100 : 0;
    const pctOutraLig = comForma ? outraForma/comForma*100 : 0;
    const kpiRow = qs('#'+'kpiRow-agua');
    if (kpiRow) kpiRow.innerHTML = `
      <article class="ligacao-group">
        <header class="ligacao-group__head">
          ${infoTip('Domicílios que possuem ligação à rede geral de distribuição (SIDRA): total menos a categoria “não possui ligação à rede geral”.')}
          <p class="ligacao-group__label">Possui ligação à rede geral</p>
          <p class="ligacao-group__value">${fmt(comForma)}</p>
          <p class="ligacao-group__share">${fmt1(pctCom)}% dos domicílios ocupados</p>
        </header>
        <p class="ligacao-group__caption">Desses, a forma principal de abastecimento é:</p>
        <div class="ligacao-group__parts">
          <div class="ligacao-part ligacao-part--rede ${pctUsaLig >= pctOutraLig ? 'is-major' : 'is-minor'}">
            ${infoTip('Domicílios cuja forma principal de abastecimento é a rede geral de distribuição (SIDRA / Censo 2022).')}
            <p class="ligacao-part__name">Usa a rede como forma principal</p>
            <p class="ligacao-part__value">${fmt(v.aa_rede)}</p>
            <p class="ligacao-part__share">${fmt1(pctUsaLig)}% de quem tem ligação</p>
          </div>
          <div class="ligacao-part ligacao-part--outra ${pctOutraLig > pctUsaLig ? 'is-major' : 'is-minor'}">
            ${infoTip('Domicílios com ligação à rede geral que declaram outra forma como principal: quem possui ligação menos quem usa a rede como forma principal.')}
            <p class="ligacao-part__name">Tem ligação, mas usa outra forma</p>
            <p class="ligacao-part__value">${fmt(outraForma)}</p>
            <p class="ligacao-part__share">${fmt1(pctOutraLig)}% de quem tem ligação</p>
          </div>
        </div>
        <div class="ligacao-split" aria-hidden="true">
          <span class="ligacao-split__rede ${pctUsaLig >= pctOutraLig ? 'is-major' : 'is-minor'}" style="width:${Math.max(2, pctUsaLig)}%"></span>
          <span class="ligacao-split__outra ${pctOutraLig > pctUsaLig ? 'is-major' : 'is-minor'}" style="width:${Math.max(2, pctOutraLig)}%"></span>
        </div>
      </article>
      <article class="ligacao-peer">
        ${infoTip('Domicílios sem ligação à rede geral de distribuição, conforme SIDRA/Censo 2022.')}
        <p class="ligacao-group__label">Sem ligação à rede geral</p>
        <p class="ligacao-group__value">${fmt(v.aa_sem_rede)}</p>
        <p class="ligacao-group__share">${fmt1(pctSem)}% dos domicílios ocupados</p>
      </article>
    `;
  
    const colors = categoryColors(AA_COMP_CATS);
    const compTitle = 'Formas de abastecimento';
    setPanelHeader('#view-agua .area-comp .panel-header', compTitle,
      'Cada card mostra a participação da forma na seleção. Quando há município ou recorte, também aparece o peso no território e na Bahia.',
      'Indicador principal');

    const compChart = qs('#'+'compChart-agua');
    if (compChart) compChart.innerHTML = renderCompChart({
      cats: AA_COMP_CATS, colors, v, cl, bahiaV, bahiaCl, terr,
      lightColor: '#EFF7FC', lightBorder: '#C9E4F5',
      tip: 'Valor = domicílios. % = participação na seleção. Território/Bahia = peso desta seleção no total daquela forma.',
    });

    setPanelHeader('#view-agua .area-setores .panel-header',
      'Urbano e rural — setores censitários · ' + currentSelectionLabel(),
      'Composição urbana e rural a partir da menor unidade do Censo (setor censitário). Campo Situação do Setor Censitário. Acompanha o recorte do mapa (território, semiárido ou município) e não aparece no mapa.');
    renderSetoresUrChart(AA_SETORES_CATS, '#1B5FA0', '#8EC8EE');
  }
  
  // ================= município: detalhe =================
  function renderMuniDetail(){
    const panel = qs('#'+'muniDetailPanel');
    if(!panel) return;
    panel.style.display = '';
    const closeBtn = qs('#'+'muniDetailClose');
    const titleEl = qs('#'+'muniDetailTitle');
    const bodyEl = qs('#'+'muniDetailBody');
    const feats = currentSelectionFeatures();
    const v = sumAa(feats);
    const pop = feats.reduce((s,f)=>s+(f.properties.populacao||0),0);
    const kickerEl = panel.querySelector('.recorte-panel__kicker');
    const statsHtml = `
      <div class="recorte-stats">
        <div class="recorte-stat">
          <span class="recorte-stat__label">
            <span class="recorte-stat__name">Municípios</span>
            ${infoTip('Quantidade de municípios incluídos no recorte atual.')}
          </span>
          <strong class="recorte-stat__value">${fmt(feats.length)}</strong>
        </div>
        <div class="recorte-stat">
          <span class="recorte-stat__label">
            <span class="recorte-stat__name">População</span>
            ${infoTip('Estimativa IBGE 2026 somada dos municípios do recorte.')}
            <span class="recorte-stat__hint">2026</span>
          </span>
          <strong class="recorte-stat__value">${fmt(pop)}</strong>
        </div>
        <div class="recorte-stat">
          <span class="recorte-stat__label">
            <span class="recorte-stat__name">Domicílios ocupados</span>
            ${infoTip('SIDRA 6803: soma de quem possui ligação à rede geral e de quem não possui.')}
            <span class="recorte-stat__hint">SIDRA</span>
          </span>
          <strong class="recorte-stat__value">${fmt(totalDomicilios(v))}</strong>
        </div>
      </div>
    `;

    if(kickerEl) kickerEl.textContent = currentScopeKicker();
    if(titleEl) titleEl.textContent = currentScopeTitle();

    if(state.selectedMun){
      const f = GEO.features.find(x=>x.properties.cod_mun===state.selectedMun);
      const p = f?.properties;
      if(closeBtn){
        closeBtn.hidden = false;
        closeBtn.classList.add('visible');
      }
      if(!p){
        if(bodyEl) bodyEl.innerHTML = statsHtml;
        return;
      }
      const embasa = embasaAguaStatus(p.embasa_agua);
      const meta = [p.territorio, p.semiarido==='SIM' ? 'Semiárido' : null].filter(Boolean).join(' · ');
      if(bodyEl) bodyEl.innerHTML = `
        ${statsHtml}
        <div class="recorte-extra">
          <p class="muni-detail-meta" title="${meta}">${meta}</p>
          <div class="embasa-status is-${embasa.kind}" role="status">
            <span class="embasa-status__brand">Embasa</span>
            <strong class="embasa-status__value">${embasa.label}</strong>
          </div>
        </div>
      `;
      return;
    }

    if(closeBtn){
      closeBtn.hidden = true;
      closeBtn.classList.remove('visible');
    }
    if(bodyEl) bodyEl.innerHTML = statsHtml;
  }
  
  function renderCurrentTab(){
    renderMap();
    renderTabAgua();
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
  
  let setoresModalSeq = 0;
  let setoresModalAll = [];
  let setoresModalPlace = '';

  function normalizeSearch(value){
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function resetSetoresFilters(){
    const tipo = qs('#'+'aglomeradosTipoFilter');
    const search = qs('#'+'aglomeradosSearch');
    if(tipo) tipo.value = '';
    if(search) search.value = '';
  }

  function fillSetoresTipoOptions(rows){
    const sel = qs('#'+'aglomeradosTipoFilter');
    if(!sel) return;
    const previous = sel.value;
    const tipos = [...new Set((rows || []).map((row) => String(row.tipo || '').trim()).filter((tipo) => tipo && tipo !== '—'))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    sel.innerHTML = '';
    const all = document.createElement('option');
    all.value = '';
    all.textContent = 'Todos os tipos';
    sel.appendChild(all);
    tipos.forEach((tipo) => {
      const option = document.createElement('option');
      option.value = tipo;
      option.textContent = tipo;
      sel.appendChild(option);
    });
    if(tipos.includes(previous)) sel.value = previous;
  }

  function renderSetoresModalRows(rows, nm, total){
    const tbody = qs('#'+'aglomeradosTbody');
    const empty = qs('#'+'aglomeradosEmpty');
    const table = qs('#'+'aglomeradosTable');
    const title = qs('#'+'aglomeradosTitle');
    const qtd = rows.length;
    const totalAll = Number(total) > 0 ? Number(total) : qtd;
    if(title){
      const countLabel = qtd === totalAll
        ? `${fmt(qtd)} ${qtd === 1 ? 'setor' : 'setores'}`
        : `${fmt(qtd)} de ${fmt(totalAll)}`;
      title.textContent = `Setores censitários — ${nm} · ${countLabel}`;
    }
    if(tbody) tbody.innerHTML = rows.map(r => {
      const codigo = String(r.codigo || '').replace(/"/g, '&quot;');
      const oid = Number(r.oid) > 0 ? String(Math.round(Number(r.oid))) : '';
      const tipo = String(r.tipo || '—').replace(/</g, '&lt;');
      const nome = String(r.nome || '—').replace(/</g, '&lt;');
      const situacao = String(r.situacao || '—').replace(/</g, '&lt;');
      const codAglom = formatCodigo(r.codAglom || r.codigo).replace(/</g, '&lt;');
      return `
      <tr class="aglomerado-row" data-codigo="${codigo}" data-oid="${oid}" tabindex="0" role="button" title="Selecionar no mapa">
        <td class="cod-aglom">${codAglom}</td>
        <td>${nome}</td>
        <td>${tipo}</td>
        <td>${situacao}</td>
        <td class="num">${fmt(r.populacao)}</td>
        <td class="num">${fmt(r.domicilios)}</td>
      </tr>`;
    }).join('');
    const has = qtd > 0;
    if(table) table.style.display = has ? '' : 'none';
    if(empty){
      empty.style.display = has ? 'none' : '';
      empty.textContent = totalAll === 0
        ? 'Nenhum setor censitário encontrado para este município.'
        : 'Nenhum setor corresponde ao filtro ou à pesquisa.';
    }
  }

  function applySetoresModalFilter(){
    const tipo = qs('#'+'aglomeradosTipoFilter')?.value || '';
    const query = normalizeSearch(qs('#'+'aglomeradosSearch')?.value);
    const queryDigits = query.replace(/\D/g, '');
    const filtered = setoresModalAll.filter((row) => {
      if(tipo && String(row.tipo || '') !== tipo) return false;
      if(!query) return true;
      const nome = normalizeSearch(row.nome);
      const codigo = normalizeSearch(formatCodigo(row.codAglom || row.codigo));
      const codigoRaw = normalizeSearch(row.codigo);
      const digits = String(row.codAglom || row.codigo || '').replace(/\D/g, '');
      if(nome.includes(query) || codigo.includes(query) || codigoRaw.includes(query)) return true;
      if(queryDigits && digits.includes(queryDigits)) return true;
      return false;
    });
    renderSetoresModalRows(filtered, setoresModalPlace, setoresModalAll.length);
  }

  function fillSetoresModalRows(rows, nm){
    setoresModalAll = Array.isArray(rows) ? rows : [];
    setoresModalPlace = nm;
    fillSetoresTipoOptions(setoresModalAll);
    applySetoresModalFilter();
  }

  function selectAglomeradoFromList(tr){
    if(!tr) return;
    const tbody = qs('#'+'aglomeradosTbody');
    tbody?.querySelectorAll('tr.is-selected').forEach((el) => el.classList.remove('is-selected'));
    tr.classList.add('is-selected');
    const codigo = tr.getAttribute('data-codigo');
    const oid = Number(tr.getAttribute('data-oid') || 0);
    if((!codigo || codigo === '—') && !(oid > 0)) return;
    if(useWebMap && typeof mapApi.selectSetorByCodigo === 'function'){
      void mapApi.selectSetorByCodigo(codigo, oid);
    }
  }

  async function openAglomeradosModal(){
    if(!state.selectedMun) return;
    const modal = qs('#'+'aglomeradosModal');
    const btn = qs('#'+'btnAglomerados');
    if(modal?.classList.contains('is-open')){
      closeAglomeradosModal();
      return;
    }

    const f = GEO.features.find(x=>x.properties.cod_mun===state.selectedMun);
    const nm = f ? f.properties.nm_mun : state.selectedMun;
    const tbody = qs('#'+'aglomeradosTbody');
    const empty = qs('#'+'aglomeradosEmpty');
    const table = qs('#'+'aglomeradosTable');
    const title = qs('#'+'aglomeradosTitle');
    if(title) title.textContent = `Setores censitários — ${nm}`;
    if(tbody) tbody.innerHTML = `<tr><td colspan="6">Carregando setores censitários…</td></tr>`;
    if(table) table.style.display = '';
    if(empty) empty.style.display = 'none';
    resetSetoresFilters();
    setoresModalAll = [];
    modal.hidden = false;
    if(btn) btn.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(()=> modal.classList.add('is-open'));
    if(useWebMap && typeof mapApi.showSetores === 'function'){
      void mapApi.showSetores(state.selectedMun, nm);
    }

    const seq = ++setoresModalSeq;
    const queryMun = SETORES && typeof SETORES.__queryMun === 'function' ? SETORES.__queryMun : null;
    try {
      const rows = queryMun
        ? await queryMun(state.selectedMun, nm)
        : [];
      if(seq !== setoresModalSeq || !state.selectedMun) return;
      fillSetoresModalRows(rows || [], nm);
    } catch (error) {
      console.warn('[painel] setores do município:', error);
      if(seq !== setoresModalSeq) return;
      if(tbody) tbody.innerHTML = '';
      if(table) table.style.display = 'none';
      if(empty){
        empty.style.display = '';
        empty.textContent = 'Não foi possível carregar os setores censitários deste município.';
      }
    }
  }
  
  function closeAglomeradosModal(){
    setoresModalSeq++;
    if(useWebMap && typeof mapApi.hideSetores === 'function'){
      mapApi.hideSetores();
    }
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
    hideMapHint();
    const f = GEO.features.find(f=>f.properties.cod_mun===codMun);
    qs('#'+'muniSearch-agua').value = f?f.properties.nm_mun:'';
    updateMuniSelectionUI();
    renderCurrentTab();
    zoomToMunicipio(codMun);
  }
  function clearMunicipio(){
    state.selectedMun = null;
    qs('#'+'muniSearch-agua').value = '';
    updateMuniSelectionUI();
    renderCurrentTab();
    zoomToRegiao();
  }
  function applyRegiaoFilter(nome){
    state.regiao = nome;
    state.selectedMun = null;
    qs('#'+'muniSearch-agua').value = '';
    updateMuniSelectionUI();
    renderControls();
    renderCurrentTab();
    zoomToRegiao();
  }
  
  async function exportRelatorioPdf(){
    const btn = qs('#'+'btnExportPdf');
    if(btn){ btn.disabled = true; btn.textContent = 'Gerando PDF…'; }
    try {
      const feats = currentSelectionFeatures();
      const v = sumAa(feats);
      const cl = classifyAa(v);
      const pop = feats.reduce((s,f)=>s+(f.properties.populacao||0),0);
      const comForma = Math.max(0, (v.aa_total||0) - (v.aa_sem_rede||0));
      const pctCom = v.aa_total ? comForma/v.aa_total*100 : 0;
      const pctSem = v.aa_total ? (v.aa_sem_rede||0)/v.aa_total*100 : 0;
      const setorFeats = currentSetoresFeatures();
      const urbFeats = setorFeats.filter(f=>f.properties.situacao==='Urbana');
      const rurFeats = setorFeats.filter(f=>f.properties.situacao==='Rural');
      const urb = sumAa(urbFeats);
      const rur = sumAa(rurFeats);
      const urbTot = urb.aa_total||0;
      const rurTot = rur.aa_total||0;
      const setorTot = urbTot + rurTot;
      const uPct = setorTot ? urbTot/setorTot*100 : 0;
      const rPct = setorTot ? rurTot/setorTot*100 : 0;
      const pctIn = (part, tot) => tot ? fmt1(part/tot*100)+'% da área' : '—';
      const mapDataUrl = mapApi && typeof mapApi.capture === 'function' ? await mapApi.capture(state) : null;
      const mapLegend = mapApi && typeof mapApi.captureLegend === 'function' ? await mapApi.captureLegend() : [];
      const formaBars = AA_COMP_CATS.map(c=>{
        const val = v[c.key]||0;
        return {
          label: c.label,
          value: fmt(val),
          pct: v.aa_total ? val/v.aa_total*100 : 0,
          color: AA_CAT_COLORS[c.key] || '#1B5FA0'
        };
      });
      await downloadRelatorioPdf({
        title: 'Relatório de abastecimento de água',
        theme: 'agua',
        scope: currentSelectionLabel(),
        source: 'DPA Indicadores (SIDRA / Censo IBGE 2022, município). Urbano/rural: setores censitários IBGE.',
        fileName: `relatorio-abastecimento-${slugRelatorio(currentSelectionLabel())}.pdf`,
        kpis: [
          { label: 'Municípios na seleção', value: fmt(feats.length) },
          { label: 'População (estimativa 2026)', value: fmt(pop) },
          { label: 'Total de domicílios ocupados', value: fmt(totalDomicilios(v)) },
          { label: 'Possui ligação à rede geral', value: fmt(comForma), sub: fmt1(pctCom)+'%' },
          { label: 'Sem ligação à rede geral', value: fmt(v.aa_sem_rede), sub: fmt1(pctSem)+'%' },
          { label: 'Possui ligação à rede geral e a utiliza como forma principal', value: fmt(v.aa_rede), sub: fmt1((v.aa_total ? (v.aa_rede||0)/v.aa_total*100 : 0))+'%' },
          { label: 'Possui ligação à rede geral, mas utiliza principalmente outra forma', value: fmt(Math.max(0, comForma - (v.aa_rede||0))), sub: fmt1((v.aa_total ? Math.max(0, comForma - (v.aa_rede||0))/v.aa_total*100 : 0))+'%' },
        ],
        guide: {
          title: 'Como ler este relatório',
          items: [
            'A seção 1 traz o total oficial de cada forma no recorte (dado municipal). Poço profundo, rede geral e as demais formas desta seção são os números a citar.',
            'A seção 2 mostra só onde estão os domicílios (urbano ou rural) e como cada área se abastece. Ali o 100% é a área urbana ou a área rural — não o município.',
            'Não some urbano + rural para conferir a seção 1. São tabelas diferentes do IBGE e os totais por forma (rede, poço profundo etc.) não fecham entre si.'
          ]
        },
        mapCaption: currentSelectionLabel(),
        mapDataUrl,
        mapLegendTitle: 'Legenda do mapa',
        mapLegendNote: 'Símbolos e cores iguais aos da legenda do mapa na tela.',
        mapLegend,
        sections: [
          {
            title: '1. Domicílios por forma de abastecimento (dado municipal)',
            note: 'Fonte: SIDRA tabela 6803, compilada na camada DPA_Indicadores_Censo_2022. 100% = domicílios do recorte. Use estes valores como o total oficial de cada forma.',
            bars: formaBars,
            table: {
              headers: ['Forma de abastecimento', 'Domicílios', '% do recorte'],
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
            title: '2b. Como cada área se abastece (100% da área, não do município)',
            note: 'Percentual dentro do urbano e dentro do rural. Ex.: 40% no urbano = 40% dos domicílios urbanos usam aquela forma — não 40% do município. Os totais oficiais continuam na seção 1.',
            table: {
              headers: ['Forma de abastecimento', 'No urbano', 'No rural'],
              rows: AA_COMP_CATS.filter(c=>((urb[c.key]||0)+(rur[c.key]||0))>0).map(c=>[
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
                ['Total de domicílios ocupados', 'SIDRA tabela 6803 · DPA Indicadores: possui ligação à rede geral + sem ligação à rede geral'],
                ['Municípios na seleção', 'Contagem do recorte no mapa · DPA_Indicadores_Censo_2022'],
                ['Rede, poço profundo, poço raso, fonte, pipa, chuva, rio e outra forma', 'SIDRA tabela 6803 · Censo IBGE 2022 · DPA Indicadores (campos aa_*)'],
                ['Sem ligação à rede geral', 'SIDRA tabela 6803 · DPA Indicadores (aa_npl_rg)'],
                ['Possui ligação à rede geral', 'SIDRA tabela 6803 · DPA Indicadores: total menos “não possui ligação à rede geral” (aa_npl_rg)'],
                ['Possui ligação à rede geral e a utiliza como forma principal', 'SIDRA tabela 6803 · DPA Indicadores (aa_l_r_g)'],
                ['Possui ligação à rede geral, mas utiliza principalmente outra forma', 'Calculado no painel: quem possui ligação (total − aa_npl_rg) menos quem usa a rede como forma principal (aa_l_r_g)'],
                ['Domicílios urbanos e rurais', 'Censo IBGE 2022 · Setores Censitarios_BA (Situação do setor + v0002)'],
                ['Formas no urbano e no rural', 'Censo IBGE 2022 · Setores censitários (v00111 a v00117). Não fecha com o total municipal da tabela 6803.'],
                ['Mapa da seleção', 'Web map de abastecimento · camada municipal DPA Indicadores']
              ]
            }
          }
        ]
      });
    } catch (error) {
      console.error('[abastecimento] Falha ao exportar PDF:', error);
      window.alert('Não foi possível gerar o PDF da seleção.');
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = 'Exportar PDF'; }
    }
  }

  qs('#'+'btnAglomerados')?.addEventListener('click', openAglomeradosModal);
  qs('#'+'btnExportPdf')?.addEventListener('click', () => { void exportRelatorioPdf(); });
  qs('#'+'aglomeradosClose')?.addEventListener('click', closeAglomeradosModal);
  qs('#'+'aglomeradosTipoFilter')?.addEventListener('change', applySetoresModalFilter);
  qs('#'+'aglomeradosSearch')?.addEventListener('input', applySetoresModalFilter);
  root.addEventListener('click', (event) => {
    const tr = event.target?.closest?.('#aglomeradosTbody tr[data-codigo], #aglomeradosModal tr.aglomerado-row');
    if(!tr || !root.contains(tr)) return;
    selectAglomeradoFromList(tr);
  });
  root.addEventListener('keydown', (event) => {
    if(event.key !== 'Enter' && event.key !== ' ') return;
    const tr = event.target?.closest?.('#aglomeradosTbody tr[data-codigo], #aglomeradosModal tr.aglomerado-row');
    if(!tr || !root.contains(tr)) return;
    event.preventDefault();
    selectAglomeradoFromList(tr);
  });
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
      if(state.selectedMun || !name){ hideMapHint(); return; }
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

  // Permite o carregamento em background atualizar só o bloco de setores
  SETORES.__refresh = () => {
    try {
      setPanelHeader('#view-agua .area-setores .panel-header',
        'Urbano e rural — setores censitários · ' + currentSelectionLabel(),
        'Composição urbana e rural a partir da menor unidade do Censo (setor censitário). Campo Situação do Setor Censitário. Acompanha o recorte do mapa (território, semiárido ou município) e não aparece no mapa.');
      renderSetoresUrChart(AA_SETORES_CATS, '#1B5FA0', '#8EC8EE');
    } catch (error) {
      console.warn('[abastecimento] refresh setores:', error);
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
