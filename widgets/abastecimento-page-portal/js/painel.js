const GEO = window.GEO_DATA;
document.getElementById('genDate').textContent = new Date().toLocaleDateString('pt-BR');

// ---------------- estado ----------------
let state = {
  tab: 'agua',
  groupBy: 'territorio',
  regiao: 'todas',
  selectedMun: null,
};

function fmt(n){ return Math.round(n||0).toLocaleString('pt-BR'); }
function fmt1(n){ return (n||0).toLocaleString('pt-BR', {minimumFractionDigits:1, maximumFractionDigits:1}); }

function isEmbasaServed (value) {
  if (value == null || value === '') return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const normalized = String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
  if (!normalized || normalized === 'NAO' || normalized === 'N' || normalized === '0' || normalized.includes('NAO ATEND')) {
    return false;
  }
  return (
    normalized === 'SIM' ||
    normalized === 'S' ||
    normalized === '1' ||
    normalized === 'TRUE' ||
    normalized === 'ATENDIDO' ||
    normalized.includes('ATENDIDO') ||
    normalized.includes('EMBASA')
  );
}

function embasaAguaStatus (value) {
  if (value == null || String(value).trim() === '') return { label: 'Sem informação', kind: 'unknown' };
  return isEmbasaServed(value)
    ? { label: 'Atendido', kind: 'yes' }
    : { label: 'Não atendido', kind: 'no' };
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
  return out;
}

function totalDomicilios (v) {
  return (v.total_domicilios||0) > 0 ? v.total_domicilios : (v.aa_total||0);
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
  return state.groupBy === 'semiarido' ? 'semiarido' : 'territorio';
}

function currentSelectionFeatures(){
  if(state.selectedMun) return GEO.features.filter(f=>f.properties.cod_mun===state.selectedMun);
  if(state.regiao!=='todas') return GEO.features.filter(f=>f.properties[regiaoKey()]===state.regiao);
  return GEO.features;
}
function currentSelectionLabel(){
  if(state.selectedMun){
    const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
    return 'Município — ' + (f?f.properties.nm_mun:state.selectedMun);
  }
  if(state.regiao!=='todas'){
    if(state.groupBy==='semiarido'){
      return (state.regiao==='SIM'
        ? `Semiárido — ${fmt(N_SEMI)} municípios`
        : `Fora do Semiárido — ${fmt(N_FORA_SEMI)} municípios`);
    }
    return 'Território de Identidade — ' + state.regiao;
  }
  return `Estado da Bahia — ${fmt(N_MUN)} municípios`;
}

function isFullState(){
  return !state.selectedMun && state.regiao === 'todas';
}

/** Diferença clara: "11,6 abaixo da Bahia" / "do território" (sem "p.p."). */
function fmtDeltaVs(pp, ref){
  const fem = ref === 'Bahia';
  const art = fem ? 'da' : 'do';
  const artEq = fem ? 'à' : 'ao';
  if(Math.abs(pp) < 0.05) return `igual ${artEq} ${ref}`;
  if(pp > 0) return `${fmt1(pp)} acima ${art} ${ref}`;
  return `${fmt1(Math.abs(pp))} abaixo ${art} ${ref}`;
}

function deltaClass(pp, higherIsBetter){
  if(Math.abs(pp) < 0.05) return 'neu';
  const better = higherIsBetter ? pp > 0 : pp < 0;
  return better ? 'up' : 'down';
}

function infoTip(text){
  return `<button type="button" class="info-tip" aria-label="Como foi pensado este indicador">
    <span class="info-tip-btn" aria-hidden="true">?</span>
    <span class="info-tip-pop" role="tooltip">${text}</span>
  </button>`;
}

function setPanelHeader(selector, title, tip){
  const header = document.querySelector(selector);
  if(!header) return;
  header.innerHTML = `<span class="panel-title-text">${title}</span>${infoTip(tip)}`;
}

/** Território de Identidade da seleção atual (útil p/ município → comparar com o TI). */
function getTerritorioContext(){
  let terrName = null;
  if(state.selectedMun){
    const f = GEO.features.find(x=>x.properties.cod_mun===state.selectedMun);
    terrName = f?.properties?.territorio || null;
  } else if(state.groupBy==='territorio' && state.regiao!=='todas'){
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

  const cell = (titulo, sel, ti, ba, betterHigher) => {
    const dBa = sel - ba;
    const dTi = ti==null ? null : sel - ti;
    return `
    <div class="cmp-cell">
      <div class="cmp-cell-lbl">${titulo}</div>
      <div class="cmp-cell-vals">
        <div><span class="cmp-k">Seleção</span><span class="cmp-n">${fmt1(sel)}%</span></div>
        ${ti!=null?`<div><span class="cmp-k">Território</span><span class="cmp-n muted">${fmt1(ti)}%</span></div>`:''}
        <div><span class="cmp-k">Bahia</span><span class="cmp-n muted">${fmt1(ba)}%</span></div>
      </div>
      <div class="cmp-deltas">
        ${dTi!=null?`<div class="cmp-delta ${deltaClass(dTi, betterHigher)}">${fmtDeltaVs(dTi, 'território')}</div>`:''}
        <div class="cmp-delta ${deltaClass(dBa, betterHigher)}">${fmtDeltaVs(dBa, 'Bahia')}</div>
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
        ${cell('Atendimento adequado', cl.pctAdeq, terr?terr.cl.pctAdeq:null, bahiaCl.pctAdeq, true)}
        ${cell('Inadequado', cl.pctInadeq, terr?terr.cl.pctInadeq:null, bahiaCl.pctInadeq, false)}
        ${cell(semLabel, cl.pctSem, terr?terr.cl.pctSem:null, bahiaCl.pctSem, false)}
      </div>
    </div>`;
}

function renderCompChart({ cats, colors, v, cl, bahiaV, bahiaCl, terr, lightColor, lightBorder, tip }){
  if(!(cl.total>0)) return '<div class="empty-msg">Sem dado para esta seleção.</div>';
  const showTi = !!(terr && terr.cl?.total);
  const showBa = !isFullState();
  const levels = showBa ? (showTi ? 3 : 2) : 1;

  const summary = showBa ? `
    <div class="comp-summary">
      <div class="comp-sum-item sel">
        <span class="k">Seleção</span>
        <strong>${fmt1(cl.pctAdeq)}%</strong>
        <span class="l">adequado</span>
      </div>
      ${showTi?`<div class="comp-sum-item ti">
        <span class="k">Território</span>
        <strong>${fmt1(terr.cl.pctAdeq)}%</strong>
        <span class="l">${terr.name}</span>
      </div>`:''}
      <div class="comp-sum-item ba">
        <span class="k">Bahia</span>
        <strong>${fmt1(bahiaCl.pctAdeq)}%</strong>
        <span class="l">estado</span>
      </div>
    </div>` : '';

  const legend = levels>1 ? `<div class="comp-legend">
      <span><span class="lg sel"></span> Seleção</span>
      ${showTi?`<span><span class="lg ti"></span> Território</span>`:''}
      <span><span class="lg ba"></span> Bahia</span>
      ${infoTip(tip)}
    </div>` : `<div class="comp-legend end">${infoTip(tip)}</div>`;

  const rows = cats.map((c,i)=>{
    const val = v[c.key]||0, pct = cl.total? val/cl.total*100:0;
    const baPct = bahiaCl.total ? (bahiaV[c.key]||0)/bahiaCl.total*100 : 0;
    const tiPct = showTi ? (terr.v[c.key]||0)/terr.cl.total*100 : 0;
    const light = colors[i].toUpperCase() === lightColor;
    const fillExtra = light ? `;box-shadow:inset 0 0 0 1px ${lightBorder}` : '';
    const dBa = pct - baPct;
    const dTi = showTi ? pct - tiPct : null;

    if(levels===1){
      return `<div class="chart-row"><div class="name" title="${c.label}">${c.label}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i]}${fillExtra}"></div></div>
        <div class="pct">${fmt(val)} (${fmt1(pct)}%)</div></div>`;
    }

    return `<div class="chart-row dual levels-${levels}">
      <div class="name" title="${c.label}">${c.label}</div>
      <div class="dual-bars">
        <div class="dual-line">
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${colors[i]}${fillExtra}"></div></div>
          <div class="pct">${fmt1(pct)}%</div>
        </div>
        ${showTi?`<div class="dual-line ti">
          <div class="bar-track"><div class="bar-fill ti" style="width:${tiPct}%"></div></div>
          <div class="pct">${fmt1(tiPct)}%</div>
        </div>`:''}
        <div class="dual-line ba">
          <div class="bar-track"><div class="bar-fill ba" style="width:${baPct}%"></div></div>
          <div class="pct">${fmt1(baPct)}%</div>
        </div>
      </div>
      <div class="pct abs">
        <div class="abs-n">${fmt(val)} <span class="abs-u">dom.</span></div>
        <div class="delta-mini ${deltaClass(dBa, c.good)}">${fmtDeltaVs(dBa, 'Bahia')}</div>
        ${dTi!=null?`<div class="delta-mini ${deltaClass(dTi, c.good)}">${fmtDeltaVs(dTi, 'território')}</div>`:''}
      </div>
    </div>`;
  }).join('');

  return summary + legend + rows;
}

// ---------------- controles ----------------
function renderControls(){
  document.querySelectorAll('#segGroupBy button').forEach(b=>b.classList.toggle('active', b.dataset.g===state.groupBy));
  const usaSelect = state.groupBy==='territorio';
  const usaChips = state.groupBy==='semiarido';
  document.getElementById('chipsPolo').style.display = usaChips ? 'flex' : 'none';
  document.getElementById('selectMicro').style.display = usaSelect ? '' : 'none';

  const chipsWrap = document.getElementById('chipsPolo');
  chipsWrap.innerHTML = '';
  if(usaChips){
    [['todas','Todo o Estado'],['SIM',`Semiárido (${fmt(N_SEMI)})`],['NÃO',`Fora do Semiárido (${fmt(N_FORA_SEMI)})`]].forEach(([val,lbl])=>{
      const b = document.createElement('button');
      b.className = 'chip' + (state.regiao===val ? ' active':'');
      b.textContent = lbl;
      b.onclick = ()=> applyRegiaoFilter(val);
      chipsWrap.appendChild(b);
    });
  }

  const sel = document.getElementById('selectMicro');
  sel.innerHTML = '<option value="todas">Todo o Estado</option>' +
    TERRITORIOS.map(m=>`<option value="${m}">${m}</option>`).join('');
  sel.value = usaSelect ? state.regiao : 'todas';
}
document.getElementById('segGroupBy').addEventListener('click', e=>{
  const btn = e.target.closest('button'); if(!btn) return;
  state.groupBy = btn.dataset.g;
  applyRegiaoFilter('todas');
});
document.getElementById('selectMicro').addEventListener('change', e=> applyRegiaoFilter(e.target.value));
document.getElementById('muniClear').addEventListener('click', clearMunicipio);
document.getElementById('muniDetailClose').addEventListener('click', clearMunicipio);
document.getElementById('muniSearch').addEventListener('change', e=>{
  const n = e.target.value.trim().toLowerCase();
  const f = GEO.features.find(f=>f.properties.nm_mun.toLowerCase()===n);
  if(f) selectMunicipio(f.properties.cod_mun);
});
function populateMuniList(){
  const list = document.getElementById('muniList');
  const names = GEO.features.map(f=>f.properties.nm_mun).sort((a,b)=>a.localeCompare(b,'pt-BR'));
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
  document.querySelectorAll('.map-hint').forEach(h=>{
    h.classList.remove('visible');
    h.setAttribute('aria-hidden', 'true');
  });
}

function hideMapHint(){
  const wrap = document.getElementById('mapWrap-'+state.tab);
  const hint = wrap?.querySelector('.map-hint');
  if(hint){
    hint.classList.remove('visible');
    hint.setAttribute('aria-hidden', 'true');
  }
}

function showMapHint(clientX, clientY, text){
  const wrap = document.getElementById('mapWrap-'+state.tab);
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
  const slot = document.getElementById('mapWrap-'+state.tab);
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
  const zg = document.getElementById('zoomGroup'); if(!zg||!bbox) return;
  const bw = Math.max(bbox.maxX-bbox.minX,6), bh = Math.max(bbox.maxY-bbox.minY,6);
  const cx=(bbox.minX+bbox.maxX)/2, cy=(bbox.minY+bbox.maxY)/2;
  let scale = Math.min(W/(bw*pad), H/(bh*pad));
  scale = Math.max(1, Math.min(scale, maxScale));
  currentZoomScale = scale;
  const tx=W/2-cx*scale, ty=H/2-cy*scale;
  zg.setAttribute('transform', `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(3)})`);
}
function zoomToMunicipio(codMun){
  const f = GEO.features.find(f=>f.properties.cod_mun===codMun);
  if(f) applyZoomToBBox(bboxPxOfFeatures([f]), 1.7, 16);
}
function zoomToRegiao(){
  if(state.regiao==='todas'){ zoomReset(); return; }
  applyZoomToBBox(bboxPxOfFeatures(GEO.features.filter(f=>f.properties[regiaoKey()]===state.regiao)), 1.15, 8);
}
function zoomReset(){
  const zg = document.getElementById('zoomGroup'); currentZoomScale=1;
  if(zg) zg.setAttribute('transform','translate(0,0) scale(1)');
}

function renderMap(){
  mountMapInActiveTab();

  document.querySelectorAll('#munLayer .mun-path').forEach(pathEl=>{
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
      const inFilter = (state.regiao==='todas' || p[regiaoKey()]===state.regiao);
      pathEl.classList.toggle('dim', !inFilter);
    }
  });

  const legendHtml = [['100% adequado',0],['75%',25],['50%',50],['25%',75],['0% adequado',100]].map(([lbl,v])=>
    `<span><span class="sw" style="background:${colorForPct(v)}"></span>${lbl}</span>`).join('') +
    `<span><span class="sw" style="background:${MUN_FILL_NEUTRAL}"></span>Sem dado</span>`;
  const legendSlot = document.querySelector('#view-'+state.tab+' .legend-slot');
  if(legendSlot) legendSlot.innerHTML = legendHtml;
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
  {key:'aa_outra', label:'Outra forma', good:false},
  {key:'aa_sem_rede', label:'Não possui ligação à rede geral', good:false},
];

function renderTabAgua(){
  const feats = currentSelectionFeatures();
  const v = sumAa(feats);
  const cl = classifyAa(v);
  const pop = feats.reduce((s,f)=>s+(f.properties.populacao||0),0);
  const popUrb = feats.reduce((s,f)=>s+(f.properties.pop_urbana||0),0);
  const popRur = feats.reduce((s,f)=>s+(f.properties.pop_rural||0),0);
  const comForma = Math.max(0, (v.aa_total||0) - (v.aa_sem_rede||0));
  const outraForma = Math.max(0, comForma - (v.aa_rede||0));
  const pctCom = v.aa_total ? comForma/v.aa_total*100 : 0;
  const pctSem = v.aa_total ? (v.aa_sem_rede||0)/v.aa_total*100 : 0;
  const pctRede = v.aa_total ? (v.aa_rede||0)/v.aa_total*100 : 0;
  const pctOutra = v.aa_total ? outraForma/v.aa_total*100 : 0;

  const bahiaV = sumAa(GEO.features);
  const bahiaCl = classifyAa(bahiaV);
  const bahiaPop = GEO.features.reduce((s,f)=>s+(f.properties.populacao||0),0);
  const terr = getTerritorioContext();
  const vsBa = !isFullState();
  const bahiaCom = Math.max(0, (bahiaV.aa_total||0) - (bahiaV.aa_sem_rede||0));
  const bahiaOutra = Math.max(0, bahiaCom - (bahiaV.aa_rede||0));
  const bahiaPctRede = bahiaV.aa_total ? (bahiaV.aa_rede||0)/bahiaV.aa_total*100 : 0;
  const bahiaPctOutra = bahiaV.aa_total ? bahiaOutra/bahiaV.aa_total*100 : 0;
  const terrCom = terr ? Math.max(0, (terr.v.aa_total||0) - (terr.v.aa_sem_rede||0)) : 0;
  const terrOutra = terr ? Math.max(0, terrCom - (terr.v.aa_rede||0)) : 0;
  const terrPctRede = terr && terr.v.aa_total ? (terr.v.aa_rede||0)/terr.v.aa_total*100 : null;
  const terrPctOutra = terr && terr.v.aa_total ? terrOutra/terr.v.aa_total*100 : null;
  const dRedeBa = pctRede - bahiaPctRede;
  const dRedeTi = terrPctRede != null ? pctRede - terrPctRede : null;
  const dOutraBa = pctOutra - bahiaPctOutra;
  const dOutraTi = terrPctOutra != null ? pctOutra - terrPctOutra : null;

  document.getElementById('kpiRow-agua').innerHTML = `
    <div class="kpi">${infoTip('Quantidade de municípios incluídos no filtro ou município atualmente selecionado.')}
      <div class="val">${fmt(feats.length)}</div><div class="lbl">Municípios na seleção</div></div>
    <div class="kpi">${infoTip('População residente (Censo IBGE 2022) somada dos municípios da seleção.')}
      <div class="val">${fmt(pop)}</div><div class="lbl">População (Censo 2022)</div></div>
    <div class="kpi">${infoTip('Total de domicílios particulares permanentes recenseados no recorte (Censo IBGE 2022 · DPA Indicadores: total_domicílios_recenseados / dom_rec_2022).')}
      <div class="val">${fmt(totalDomicilios(v))}</div><div class="lbl">Total de domicílios</div></div>
    <div class="kpi bom">${infoTip('Domicílios que possuem ligação à rede geral de distribuição (SIDRA): total menos a categoria “não possui ligação à rede geral”.')}
      <div class="val">${fmt(comForma)}</div><div class="sub">${fmt1(pctCom)}%</div><div class="lbl">Possui ligação à rede geral</div></div>
    <div class="kpi alerta">${infoTip('Domicílios sem ligação à rede geral de distribuição, conforme SIDRA/Censo 2022.')}
      <div class="val">${fmt(v.aa_sem_rede)}</div><div class="sub">${fmt1(pctSem)}%</div><div class="lbl">Sem ligação à rede geral</div></div>
    <div class="kpi bom">${infoTip('Domicílios cuja forma principal de abastecimento é a rede geral de distribuição (SIDRA / Censo 2022).')}
      <div class="val">${fmt(v.aa_rede)}</div>
      <div class="sub">${fmt1(pctRede)}%</div>
      ${vsBa?`<div class="sub vs-ba-kpi ${deltaClass(dRedeBa,true)}">${fmtDeltaVs(dRedeBa, 'Bahia')}</div>`:''}
      ${dRedeTi!=null?`<div class="sub vs-ba-kpi ${deltaClass(dRedeTi,true)}">${fmtDeltaVs(dRedeTi, 'território')}</div>`:''}
      <div class="lbl">Possui ligação à rede geral e a utiliza como forma principal</div></div>
    <div class="kpi">${infoTip('Domicílios com ligação à rede geral que, no entanto, declaram outra forma como principal: quem possui ligação menos quem usa a rede como forma principal.')}
      <div class="val">${fmt(outraForma)}</div>
      <div class="sub">${fmt1(pctOutra)}%</div>
      ${vsBa?`<div class="sub vs-ba-kpi ${deltaClass(dOutraBa,false)}">${fmtDeltaVs(dOutraBa, 'Bahia')}</div>`:''}
      ${dOutraTi!=null?`<div class="sub vs-ba-kpi ${deltaClass(dOutraTi,false)}">${fmtDeltaVs(dOutraTi, 'território')}</div>`:''}
      <div class="lbl">Possui ligação à rede geral, mas utiliza principalmente outra forma</div></div>
  `;

  const colors = categoryColors(AA_COMP_CATS);
  const compTitle = !vsBa
    ? 'Composição do abastecimento de água'
    : (terr ? 'Composição — seleção × território × Bahia' : 'Composição — seleção × Bahia');
  setPanelHeader('#view-agua .area-comp .panel-header', compTitle,
    'Cada barra é a % daquela forma de abastecimento no total de domicílios. As três faixas comparam município, Território de Identidade e Bahia. “Acima/abaixo” = diferença entre esses percentuais (ex.: 71% no município e 83% na Bahia → 12 abaixo da Bahia). O número com “dom.” é a quantidade de domicílios na seleção.');

  document.getElementById('compChart-agua').innerHTML = renderCompChart({
    cats: AA_COMP_CATS, colors, v, cl, bahiaV, bahiaCl, terr,
    lightColor: '#EFF7FC', lightBorder: '#C9E4F5',
    tip: 'Seleção = filtro atual. Território = Território de Identidade do município. Bahia = todos os 417 municípios. Adequado = rede + poço profundo + poço raso.',
  });

  setPanelHeader('#view-agua .area-rede .panel-header', 'Domicílios com e sem ligação à rede',
    'Barra empilhada com a proporção de domicílios com forma de abastecimento versus sem ligação à rede geral. Também exibe população urbana e rural da seleção.');

  document.getElementById('redeChart-agua').innerHTML = `
    <div class="banheiro-row">
      <div class="banheiro-label">Domicílios</div>
      <div class="bar2"><div class="seg-com lab" style="width:${pctCom}%">${pctCom>12?fmt1(pctCom)+'%':''}</div><div class="seg-sem lab" style="width:${pctSem}%">${pctSem>8?fmt1(pctSem)+'%':''}</div></div>
    </div>
    <div class="banheiro-stats">
      <span><span style="color:#071C33;font-weight:700;">●</span> ${fmt(comForma)} com forma de abastecimento (${fmt1(pctCom)}%)</span>
      <span><span style="color:#4CA3DE;font-weight:700;">●</span> ${fmt(v.aa_sem_rede)} sem ligação à rede (${fmt1(pctSem)}%)</span>
    </div>
    <div class="banheiro-stats" style="margin-top:10px;">
      <span>Pop. urbana: <b>${fmt(popUrb)}</b></span>
      <span>Pop. rural: <b>${fmt(popRur)}</b></span>
    </div>`;

  setPanelHeader('#view-agua .area-scope .panel-header',
    vsBa ? (terr ? 'Comparação · território e Bahia' : 'Comparação com a Bahia') : 'Nível selecionado',
    'Mostra o peso da seleção no Estado (e no Território, se houver município). “Acima/abaixo” compara o percentual da seleção com o do território e com o da Bahia.');

  document.getElementById('scopeInfo-agua').innerHTML = renderVsBahiaHtml({
    label: currentSelectionLabel(),
    feats, v, cl, pop, bahiaV, bahiaCl, bahiaPop, terr,
    semLabel: 'Sem ligação à rede',
  });
}

// ================= município: detalhe =================
function renderMuniDetail(){
  const panel = document.getElementById('muniDetailPanel');
  if(!state.selectedMun){ panel.style.display='none'; return; }
  const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
  if(!f){ panel.style.display='none'; return; }
  const p = f.properties;
  panel.style.display='';

  document.getElementById('muniDetailName').textContent = p.nm_mun;

  const embasa = embasaAguaStatus(p.embasa_agua);
  const meta = [p.territorio, p.semiarido==='SIM' ? 'Semiárido' : null].filter(Boolean).join(' · ');
  document.getElementById('muniDetailBody').innerHTML = `
    <p class="muni-detail-meta" title="${meta}">${meta}</p>
    <div class="detail-grid">
      <div class="detail-item is-embasa is-${embasa.kind}"><div class="v text">${embasa.label}</div><div class="l">Atendido pela Embasa</div></div>
      <div class="detail-item"><div class="v">${fmt(p.populacao)}</div><div class="l">População</div></div>
      <div class="detail-item"><div class="v">${fmt(p.aa_total)}</div><div class="l">Domicílios</div></div>
      <div class="detail-item wide"><div class="v text">${p.territorio}</div><div class="l">Território de Identidade</div></div>
    </div>
  `;
}

function renderCurrentTab(){
  renderMap();
  renderTabAgua();
  renderMuniDetail();
}

function updateMuniSelectionUI(){
  const btn = document.getElementById('muniClear');
  const hasSelection = !!state.selectedMun;
  btn.classList.toggle('visible', hasSelection);
  btn.disabled = !hasSelection;
  btn.setAttribute('aria-hidden', hasSelection ? 'false' : 'true');

  const btnAgl = document.getElementById('btnAglomerados');
  const hintAgl = document.getElementById('aglomeradosHint');
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
  const pts = window.PTS_DATA || [];
  const cod = String(codMun||'');
  return pts
    .filter(p => String(p.m) === cod)
    .slice()
    .sort((a,b)=> String(a.n||'').localeCompare(String(b.n||''), 'pt-BR'));
}

function openAglomeradosModal(){
  if(!state.selectedMun) return;
  const modal = document.getElementById('aglomeradosModal');
  const btn = document.getElementById('btnAglomerados');
  if(modal?.classList.contains('is-open')){
    closeAglomeradosModal();
    return;
  }

  const f = GEO.features.find(f=>f.properties.cod_mun===state.selectedMun);
  const nm = f ? f.properties.nm_mun : state.selectedMun;
  const rows = aglomeradosDoMunicipio(state.selectedMun);
  const title = document.getElementById('aglomeradosTitle');
  const tbody = document.getElementById('aglomeradosTbody');
  const empty = document.getElementById('aglomeradosEmpty');
  const table = document.getElementById('aglomeradosTable');

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
  const modal = document.getElementById('aglomeradosModal');
  const btn = document.getElementById('btnAglomerados');
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
  document.getElementById('muniSearch').value = f?f.properties.nm_mun:'';
  updateMuniSelectionUI();
  zoomToMunicipio(codMun);
  renderCurrentTab();
}
function clearMunicipio(){
  state.selectedMun = null;
  document.getElementById('muniSearch').value = '';
  updateMuniSelectionUI();
  zoomToRegiao();
  renderCurrentTab();
}
function applyRegiaoFilter(nome){
  state.regiao = nome;
  state.selectedMun = null;
  document.getElementById('muniSearch').value = '';
  updateMuniSelectionUI();
  renderControls();
  zoomToRegiao();
  renderCurrentTab();
}

document.getElementById('btnAglomerados')?.addEventListener('click', openAglomeradosModal);
document.getElementById('aglomeradosClose')?.addEventListener('click', closeAglomeradosModal);
document.addEventListener('click', e=>{
  const tip = e.target.closest('.info-tip');
  document.querySelectorAll('.info-tip.is-open').forEach(el=>{
    if(el !== tip) el.classList.remove('is-open');
  });
  if(tip){
    e.preventDefault();
    tip.classList.toggle('is-open');
  }
});
document.addEventListener('keydown', e=>{
  if(e.key === 'Escape'){
    closeAglomeradosModal();
    document.querySelectorAll('.info-tip.is-open').forEach(el=>el.classList.remove('is-open'));
  }
});

renderControls();
updateMuniSelectionUI();
populateMuniList();
buildMapSkeleton();
renderCurrentTab();
