import {
  loadData, getPlaces, getCategories, getPlaceById, getNode, getStats, getCampusName,
  searchPlaces, filterByCategory, getRoute,
} from './placesApi.js';

const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const isPhone = () => window.matchMedia('(max-width: 991.98px)').matches;
const toLatLng = (n) => [100 - n.y, n.x]; // map = 0-100 percentages, y runs top to bottom
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => 1 - Math.pow(1 - t, 3);
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduced = () => REDUCED.matches;

const LABEL_ZOOM = 2.5;      // pin names and segment lengths show from this zoom level
const ROUTE_COLOR = '#E8445A';
const M_PER_UNIT = 4;        // places.json: 1 map unit = 4 m

const state = { query: '', category: 'all', selectedId: null, route: null, step: -1, favs: [], recent: [] };
const KEYS = { favs: 'campusway.favourites', recent: 'campusway.recent' };
const markers = new Map();
let map, markerLayer, routeLayer, scaleCtl, toolsCtl;
let view = 'places', mapFitted = false, wasPhone = isPhone(), hoverId = null;
let rt = null; // geometry + layers of the route currently on the map
const anim = { draw: 0, move: 0, playing: false };

const GLYPHS = {
  academic: '<path d="M3 5.5C5.6 4.4 8.6 4.6 12 6.6c3.4-2 6.4-2.2 9-1.1V19c-2.6-1.1-5.6-.9-9 1.1-3.4-2-6.4-2.2-9-1.1z"/>',
  hostel: '<path d="M3 11.5 12 4l9 7.5V20h-6v-6H9v6H3z"/>',
  food: '<path d="M4 4h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M16 6h1.5a2.5 2.5 0 0 1 0 5H16V9.3h1.5a.8.8 0 0 0 0-1.6H16z"/><path d="M3 19h14v1.8H3z"/>',
  admin: '<path fill-rule="evenodd" d="M5 21V3h9v6h5v12zM7.5 6h2v2h-2zM7.5 10h2v2h-2zM7.5 14h2v2h-2z"/>',
  sports: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 4v16M4 12h16" stroke="currentColor" stroke-width="1.6" fill="none"/>',
};
const glyph = (cat) => `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${GLYPHS[cat] ?? '<circle cx="12" cy="12" r="5"/>'}</svg>`;
const ICONS = {
  reset: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
  fs: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  exit: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>',
};

/* ---------- messages, toast ---------- */
function showAlert(box, parts, type = 'info') {
  box.replaceChildren();
  if (!parts) return;
  box.append(el('div', { className: `alert alert-${type} mb-2`, role: type === 'danger' ? 'alert' : 'status' }, ...parts));
}
function toast(text) {
  const t = el('div', { className: 'toast text-bg-dark', role: 'status' }, el('div', { className: 'toast-body', textContent: text }));
  $('#toasts').append(t);
  t.addEventListener('hidden.bs.toast', () => t.remove());
  new bootstrap.Toast(t, { delay: 2500 }).show();
}

/* ---------- LocalStorage (optional favourites + recent searches) ---------- */
function storageProblem() {
  const retry = el('button', { type: 'button', className: 'btn btn-sm btn-dark ms-2', textContent: 'Try again' });
  const reset = el('button', { type: 'button', className: 'btn btn-sm btn-outline-dark ms-2', textContent: 'Reset saved data' });
  retry.addEventListener('click', () => { showAlert($('#storage-alert'), null); loadSaved(); render(); });
  reset.addEventListener('click', () => {
    try { Object.values(KEYS).forEach((k) => localStorage.removeItem(k)); } catch { /* still blocked */ }
    state.favs = []; state.recent = []; showAlert($('#storage-alert'), null); render();
  });
  showAlert($('#storage-alert'), ['Saved places and recent searches could not be read or saved in this browser.', retry, reset], 'warning');
}
function readList(key) {
  try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; }
  catch { storageProblem(); return []; }
}
function writeList(key, list) { try { localStorage.setItem(key, JSON.stringify(list)); } catch { storageProblem(); } }
function loadSaved() {
  state.favs = readList(KEYS.favs).filter((id) => getPlaceById(id));
  state.recent = readList(KEYS.recent).filter((q) => typeof q === 'string').slice(0, 5);
}
function rememberSearch(q) {
  q = q.trim();
  if (q.length < 2) return;
  state.recent = [q, ...state.recent.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, 5);
  writeList(KEYS.recent, state.recent);
}
function toggleFav(id) {
  state.favs = state.favs.includes(id) ? state.favs.filter((f) => f !== id) : [...state.favs, id];
  writeList(KEYS.favs, state.favs);
  render();
}

/* ---------- places list, filters ---------- */
const categoryLabel = (id) => getCategories().find((c) => c.categoryId === id)?.label ?? id;

function visiblePlaces() {
  const base = state.category === 'saved' ? state.favs.map(getPlaceById).filter(Boolean) : filterByCategory(state.category);
  const ids = new Set(base.map((p) => p.placeId));
  return searchPlaces(state.query).filter((p) => ids.has(p.placeId));
}

function setHover(id, on) {
  hoverId = on ? id : null;
  markers.get(id)?.getElement()?.classList.toggle('pin-hover', on);
}

function renderList() {
  const places = visiblePlaces();
  const total = getPlaces().length;
  hoverId = null;
  $('#count').textContent = places.length === total ? `${plural(total, 'place')}` : `${places.length} of ${plural(total, 'place')}`;
  $('#place-list').replaceChildren(...places.map((p) => {
    const b = el('button', { type: 'button', className: 'list-group-item list-group-item-action place-item' },
      el('span', { textContent: p.name }), el('br'), el('span', { className: 'place-cat', textContent: categoryLabel(p.category) }));
    if (p.placeId === state.selectedId) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => selectPlace(p.placeId, { fromList: true }));
    b.addEventListener('mouseenter', () => setHover(p.placeId, true));
    b.addEventListener('mouseleave', () => setHover(p.placeId, false));
    b.addEventListener('focus', () => setHover(p.placeId, true));
    b.addEventListener('blur', () => setHover(p.placeId, false));
    return el('li', { className: 'list-group-item p-0 border-0' }, b);
  }));
  if (places.length) { showAlert($('#message'), null); return; }
  if (state.category === 'saved' && !state.query && !state.favs.length) {
    showAlert($('#message'), ['You have not saved any places yet. Select a place and choose "Save place".']);
    return;
  }
  const reset = el('button', { type: 'button', className: 'btn btn-sm btn-dark ms-2', textContent: 'Clear search and filter' });
  reset.addEventListener('click', clearFilters);
  showAlert($('#message'), ['Nothing matched your search. Clear it or browse by category.', reset]);
}

function renderRecent() {
  const box = $('#recent');
  box.replaceChildren();
  if (!state.recent.length) return;
  const clear = el('button', { type: 'button', className: 'btn btn-link btn-sm', textContent: 'Clear recent' });
  clear.addEventListener('click', () => { state.recent = []; writeList(KEYS.recent, []); renderRecent(); });
  box.append(el('span', { className: 'small text-secondary me-1', textContent: 'Recent:' }),
    ...state.recent.map((q) => {
      const c = el('button', { type: 'button', className: 'chip chip-dark me-1 mb-1', textContent: q });
      c.addEventListener('click', () => { state.query = q; $('#search').value = q; render(); });
      return c;
    }), clear);
}

function clearFilters() {
  state.query = ''; state.category = 'all';
  $('#search').value = ''; $('#category').value = 'all';
  render();
}

function setCategory(id) {
  state.category = id;
  $('#category').value = id;
  render();
  if (map && !state.route) fitVisible();
}

/* ---------- selection + details card ---------- */
function renderCard() {
  const card = $('#place-card');
  const p = state.selectedId && getPlaceById(state.selectedId);
  if (!p || !visiblePlaces().some((v) => v.placeId === p.placeId)) { card.hidden = true; return; }
  const saved = state.favs.includes(p.placeId);
  const save = el('button', { type: 'button', className: 'btn btn-outline-secondary', textContent: saved ? 'Saved' : 'Save place' });
  save.setAttribute('aria-pressed', String(saved));
  save.addEventListener('click', () => toggleFav(p.placeId));
  const from = el('button', { type: 'button', className: 'btn btn-outline-secondary', textContent: 'Start from here' });
  from.addEventListener('click', () => setRouteEnds({ start: p.placeId }));
  const to = el('button', { type: 'button', className: 'btn btn-primary', textContent: 'Directions to here' });
  to.addEventListener('click', () => setRouteEnds({ end: p.placeId }));
  const close = el('button', { type: 'button', className: 'card-close', innerHTML: '&times;' });
  close.setAttribute('aria-label', 'Close place details');
  close.addEventListener('click', () => { state.selectedId = null; render(); });
  card.replaceChildren(el('div', { className: 'card-body' },
    close,
    el('h2', { className: 'h5 card-title', textContent: p.name }),
    el('span', { className: 'badge badge-cat mb-2', textContent: categoryLabel(p.category) }),
    el('p', { className: 'mb-2', textContent: p.description }),
    el('p', { className: 'mb-1' }, el('strong', { textContent: 'Entrance: ' }), p.entranceNote),
    el('p', { className: 'mb-3', textContent: p.accessible ? 'Step-free access available.' : 'Step-free access not confirmed.' }),
    el('div', { className: 'd-flex flex-wrap gap-2' }, to, from, save)));
  card.hidden = false;
}

function selectPlace(id, { fromList = false, fly = false } = {}) {
  state.selectedId = id;
  if (state.query) rememberSearch(state.query);
  render();
  if (fromList && isPhone()) setView('map');
  else if (fly || !state.route) focusPlace(id);
}

/* ---------- animation helpers ---------- */
function run(key, ms, onFrame, onDone) {
  cancelAnimationFrame(anim[key]); anim[key] = 0;
  if (ms <= 0) { onFrame(1); if (onDone) onDone(); return; }
  const t0 = performance.now();
  const tick = (now) => {
    const t = clamp((now - t0) / ms, 0, 1);
    onFrame(t);
    if (t < 1) anim[key] = requestAnimationFrame(tick);
    else { anim[key] = 0; if (onDone) onDone(); }
  };
  anim[key] = requestAnimationFrame(tick);
}
function cancelMove() {
  cancelAnimationFrame(anim.move); anim.move = 0;
  if (anim.playing) { anim.playing = false; updatePlayButton(); }
}

/* ---------- map camera ---------- */
const mapVisible = () => !!map && mapFitted && $('#map').offsetWidth > 0;
const pad = () => ({ paddingTopLeft: [40, isPhone() ? 100 : 150], paddingBottomRight: [70, 40] });
const fitCampus = () => map.fitBounds([[0, 0], [100, 100]]);

function camBounds(b, animate = true, extra = {}) {
  if (!mapVisible()) return;
  const o = { ...pad(), maxZoom: 4, ...extra };
  if (animate && !reduced()) map.flyToBounds(b, { ...o, duration: 0.8 });
  else map.fitBounds(b, { ...o, animate: false });
}
function camFocus(ll, animate, zoom) {
  if (!mapVisible()) return;
  const z = Math.max(map.getZoom(), zoom);
  if (animate && !reduced()) map.flyTo(ll, z, { duration: 0.8 });
  else map.setView(ll, z, { animate: false });
}
function focusPlace(id, animate = true) { camFocus(toLatLng(getNode(id)), animate, 3.25); }

function fitVisible() {
  if (!mapVisible()) return;
  const ps = visiblePlaces();
  if (!ps.length) return;
  const small = { paddingTopLeft: [50, 110], paddingBottomRight: [70, 50] };
  if (state.category === 'all' && !state.query) camBounds(L.latLngBounds([[0, 0], [100, 100]]), true, small);
  else camBounds(L.latLngBounds(ps.map(toLatLng)), true, { ...small, maxZoom: 3.25 });
}

function resetView() {
  if (rt) { cancelMove(); setActive(-1, { camera: true, walker: true }); return; }
  camBounds(L.latLngBounds([[0, 0], [100, 100]]), true, { paddingTopLeft: [10, 10], paddingBottomRight: [10, 10] });
}

function applyCamera(animate = true) {
  if (!rt || !state.route || !mapVisible()) return;
  const n = state.route.steps.length, i = state.step;
  if (i < 0) camBounds(L.latLngBounds(rt.pts), animate);
  else if (i < n) camBounds(L.latLngBounds([rt.pts[i], rt.pts[i + 1]]), animate, { maxZoom: 3.5 });
  else camFocus(rt.pts[n], animate, 3.5);
}

/* ---------- map setup ---------- */
function pinIcon(p) {
  const dot = el('span', { className: 'pin-dot' });
  dot.innerHTML = glyph(p.category);
  const inner = el('span', { className: 'pin-inner' }, dot, el('span', { className: 'pin-label', textContent: p.name }));
  return L.divIcon({ className: `pin pin-cat-${p.category}`, html: inner, iconSize: [44, 44], iconAnchor: [22, 22] });
}

function addControls() {
  const Scale = L.Control.extend({
    onAdd() {
      const c = L.DomUtil.create('div', 'map-scale');
      c.setAttribute('aria-hidden', 'true');
      this._label = L.DomUtil.create('span', '', c);
      this._bar = L.DomUtil.create('div', 'map-scale-bar', c);
      return c;
    },
    update(zoom) {
      const mpp = M_PER_UNIT / Math.pow(2, zoom); // CRS.Simple: 2^zoom pixels per map unit
      const max = 110 * mpp;
      const pow = Math.pow(10, Math.floor(Math.log10(max)));
      const len = [5, 2, 1].map((b) => b * pow).find((v) => v <= max) ?? pow;
      this._bar.style.width = `${len / mpp}px`;
      this._label.textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
    },
  });
  const Tools = L.Control.extend({
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar');
      this._reset = this._btn(bar, 'Reset view', ICONS.reset, resetView);
      this._fs = this._btn(bar, 'Full screen', ICONS.fs, () => toggleFs());
      return bar;
    },
    _btn(bar, title, svg, fn) {
      const a = L.DomUtil.create('a', 'map-tool', bar);
      a.href = '#'; a.title = title; a.innerHTML = svg;
      a.setAttribute('role', 'button'); a.setAttribute('aria-label', title);
      L.DomEvent.disableClickPropagation(a);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); fn(); });
      L.DomEvent.on(a, 'keydown', (e) => { if (e.key === ' ') { L.DomEvent.preventDefault(e); fn(); } });
      return a;
    },
    setFs(on) {
      this._fs.innerHTML = on ? ICONS.exit : ICONS.fs;
      const t = on ? 'Exit full screen' : 'Full screen';
      this._fs.title = t; this._fs.setAttribute('aria-label', t);
    },
  });
  // bottom-right stack, first added = lowest: attribution, scale, tools, zoom
  scaleCtl = new Scale({ position: 'bottomright' }).addTo(map);
  toolsCtl = new Tools({ position: 'bottomright' }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
}

function toggleFs(force) {
  const wrap = $('#map-wrap');
  const on = force === undefined ? !wrap.classList.contains('is-fs') : force;
  wrap.classList.toggle('is-fs', on);
  document.body.classList.toggle('map-fs', on);
  if (toolsCtl) toolsCtl.setFs(on);
  setTimeout(() => { if (map) map.invalidateSize(); }, 0);
}

function updateMapUi() {
  if (!map) return;
  const z = map.getZoom();
  if (z === undefined) return;
  $('#map').classList.toggle('map-labels', z >= LABEL_ZOOM);
  if (scaleCtl) scaleCtl.update(z);
}

function initMap() {
  map = L.map('map', {
    crs: L.CRS.Simple, minZoom: -1, maxZoom: 5, zoomSnap: 0.25, zoomDelta: 0.5,
    wheelPxPerZoomLevel: 100, scrollWheelZoom: true, zoomControl: false, maxBoundsViscosity: 0.7,
  });
  L.imageOverlay('campus-map.svg', [[0, 0], [100, 100]]).addTo(map);
  map.setMaxBounds([[-15, -15], [115, 115]]);
  markerLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  addControls();
  for (const p of getPlaces()) {
    const m = L.marker(toLatLng(p), { icon: pinIcon(p) });
    m.on('click', () => selectPlace(p.placeId));
    markers.set(p.placeId, m);
  }
  map.on('zoom zoomend', updateMapUi);
  map.on('click', () => { if (state.selectedId) { state.selectedId = null; render(); } });
  if (!isPhone()) { fitCampus(); mapFitted = true; }
  updateMapUi();
}

function renderPins() {
  const r = state.route;
  const show = new Set(visiblePlaces().map((p) => p.placeId));
  if (r) { show.add(r.startId); show.add(r.endId); }
  markers.forEach((m, id) => {
    if (show.has(id)) { if (!markerLayer.hasLayer(m)) markerLayer.addLayer(m); } else markerLayer.removeLayer(m);
    const n = m.getElement();
    if (n) {
      n.classList.toggle('pin-selected', id === state.selectedId);
      n.classList.toggle('pin-start', !!r && id === r.startId);
      n.classList.toggle('pin-end', !!r && id === r.endId);
      n.classList.toggle('pin-hover', id === hoverId);
      n.setAttribute('aria-label', `${getPlaceById(id).name}, ${categoryLabel(getPlaceById(id).category)}`);
    }
    m.setZIndexOffset(id === state.selectedId || (r && (id === r.startId || id === r.endId)) ? 1000 : 0);
  });
}

/* ---------- route on the map ---------- */
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function partial(pts, cum, d) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (cum[i] <= d) { out.push(pts[i]); continue; }
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
    break;
  }
  return out;
}

function pointAt(d) {
  const { pts, cum } = rt;
  for (let i = 1; i < pts.length; i++) {
    if (d <= cum[i] || i === pts.length - 1) {
      const t = clamp((d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), 0, 1);
      return { seg: i - 1, ll: [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t] };
    }
  }
  return { seg: 0, ll: pts[0] };
}

function drawRoute() {
  cancelAnimationFrame(anim.draw); anim.draw = 0;
  cancelMove();
  routeLayer.clearLayers();
  rt = null;
  const r = state.route;
  if (!r) { renderBanner(); return; }
  const pts = r.nodeIds.map((id) => toLatLng(getNode(id)));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const base = { lineCap: 'round', lineJoin: 'round', interactive: false };
  const glow = L.polyline([], { ...base, color: '#FFBF69', weight: 18, opacity: 0.6 }).addTo(routeLayer);
  const casing = L.polyline([], { ...base, color: '#FFFFFF', weight: 11, opacity: 0.95 }).addTo(routeLayer);
  const line = L.polyline([], { ...base, color: ROUTE_COLOR, weight: 6 }).addTo(routeLayer);
  const flow = L.polyline([], { ...base, color: '#FFFFFF', weight: 3, dashArray: '1 10', className: 'route-flow' }).addTo(routeLayer);
  const walker = L.marker(pts[0], {
    icon: L.divIcon({ className: 'walker', html: '<span class="walker-dot"></span>', iconSize: [28, 28], iconAnchor: [14, 14] }),
    interactive: false, keyboard: false, zIndexOffset: 2000,
  }).addTo(routeLayer);
  const mine = { pts, cum, total, glow, casing, line, flow, walker };
  rt = mine;
  state.step = -1;
  renderBanner(); markActiveStep(); updatePlayButton();
  camBounds(L.latLngBounds(pts), true);
  run('draw', reduced() ? 0 : 1000, (t) => {
    const part = partial(pts, cum, ease(t) * total);
    casing.setLatLngs(part); line.setLatLngs(part); flow.setLatLngs(part);
  }, () => { if (rt === mine) addRouteDecorations(); });
}

function addRouteDecorations() {
  const r = state.route;
  if (!r || !rt) return;
  r.nodeIds.forEach((id, k) => {
    if (k === 0 || k === r.nodeIds.length - 1) return;
    const dot = L.circleMarker(rt.pts[k], { radius: 6, weight: 3, color: ROUTE_COLOR, fillColor: '#fff', fillOpacity: 1, bubblingMouseEvents: false })
      .bindTooltip(getNode(id).name, { direction: 'top', offset: [0, -6] });
    dot.on('click', () => goStep(k));
    dot.addTo(routeLayer);
  });
  r.steps.forEach((s, i) => {
    const a = rt.pts[i], b = rt.pts[i + 1];
    L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], {
      icon: L.divIcon({ className: 'seg-label', html: el('span', { textContent: `${s.meters} m` }), iconSize: [0, 0], iconAnchor: [0, 0] }),
      interactive: false, keyboard: false, zIndexOffset: 500,
    }).addTo(routeLayer);
  });
  rt.walker.setZIndexOffset(2000);
}

function moveWalker(to, animate) {
  const w = rt.walker, from = w.getLatLng();
  if (!animate || reduced()) { cancelMove(); w.setLatLng(to); return; }
  run('move', 450, (t) => {
    const e = ease(t);
    w.setLatLng([from.lat + (to[0] - from.lat) * e, from.lng + (to[1] - from.lng) * e]);
  });
}

/* step -1 = overview, 0..n-1 = a walking step, n = arrived */
function setActive(i, { camera = false, walker = false } = {}) {
  const r = state.route;
  if (!r || !rt) return;
  const n = r.steps.length;
  i = clamp(i, -1, n);
  state.step = i;
  rt.glow.setLatLngs(i >= 0 && i < n ? [rt.pts[i], rt.pts[i + 1]] : []);
  renderBanner();
  markActiveStep();
  if (walker) moveWalker(rt.pts[i < 0 ? 0 : i], true);
  if (camera) applyCamera(true);
}

function goStep(i) {
  if (!rt) return;
  cancelMove();
  setActive(i, { camera: true, walker: true });
}

function playRoute() {
  if (!rt || !state.route || reduced()) return;
  if (anim.playing) { cancelMove(); return; }
  cancelMove();
  anim.playing = true;
  const r = state.route, n = r.steps.length, mine = rt;
  setActive(0);
  rt.walker.setLatLng(rt.pts[0]);
  camBounds(L.latLngBounds(rt.pts), false);
  updatePlayButton();
  run('move', clamp(r.totalMeters * 25, 4000, 14000), (t) => {
    const { ll, seg } = pointAt(t * mine.total);
    mine.walker.setLatLng(ll);
    if (seg !== state.step) setActive(seg);
    if (mapVisible()) map.panInside(ll, { ...pad(), animate: false });
  }, () => {
    anim.playing = false;
    if (rt === mine) setActive(n);
    updatePlayButton();
  });
}

function updatePlayButton() {
  const b = $('#rb-play');
  b.hidden = reduced();
  b.textContent = anim.playing ? 'Stop' : 'Preview';
}

function renderBanner() {
  const r = state.route, banner = $('#route-banner'), top = $('#map-top');
  if (!r) { banner.hidden = true; top.classList.remove('has-route'); return; }
  const n = r.steps.length, i = state.step;
  const a = getPlaceById(r.startId), b = getPlaceById(r.endId);
  let kicker, text, meta;
  if (i < 0) {
    kicker = 'Route overview';
    text = `${a.name} to ${b.name}`;
    meta = `${r.totalMeters} m · About ${r.minutes} min walk${r.stepFree ? ' · Step-free' : ''}`;
  } else if (i < n) {
    const left = r.steps.slice(i).reduce((s, x) => s + x.meters, 0);
    kicker = `Step ${i + 1} of ${n}`;
    text = r.steps[i].text;
    meta = `${r.steps[i].meters} m · ${left} m left in total`;
  } else {
    kicker = 'Arrived';
    text = `You have arrived at ${b.name}`;
    meta = b.entranceNote;
  }
  $('#rb-kicker').textContent = kicker;
  $('#rb-text').textContent = text;
  $('#rb-meta').textContent = meta;
  const prev = $('#rb-prev'), next = $('#rb-next');
  prev.disabled = i < 0;
  next.disabled = i >= n;
  next.textContent = i < 0 ? 'Start' : 'Next';
  if (next.disabled && document.activeElement === next) prev.focus();
  updatePlayButton();
  banner.hidden = false;
  top.classList.add('has-route');
}

function markActiveStep() {
  const r = state.route, i = state.step, n = r ? r.steps.length : 0;
  $('#route-steps').querySelectorAll('li').forEach((li, k) => {
    li.classList.toggle('is-active', k === i);
    const b = li.querySelector('button');
    if (!b) return;
    if (k === i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  $('#route-arrival').classList.toggle('is-active', n > 0 && i === n);
}

/* ---------- views ---------- */
function setView(v) {
  if (v === 'map' && !isPhone()) v = 'places';
  view = v;
  for (const n of ['places', 'route', 'map']) {
    $(`#pane-${n}`).classList.toggle('is-active', n === v);
    const t = $(`#tab-${n}`);
    t.classList.toggle('active', n === v);
    t.setAttribute('aria-pressed', String(n === v));
  }
  if (v === 'map') {
    setTimeout(() => {
      map.invalidateSize();
      if (!mapFitted) { fitCampus(); mapFitted = true; }
      updateMapUi();
      if (rt) applyCamera(false);
      else if (state.selectedId) focusPlace(state.selectedId, false);
    }, 0);
  }
}

/* ---------- map search + category chips ---------- */
function setupChips() {
  const defs = [{ id: 'all', label: 'All' }, ...getCategories().map((c) => ({ id: c.categoryId, label: c.label })), { id: 'saved', label: 'Saved' }];
  $('#map-chips').replaceChildren(...defs.map((d) => {
    const b = el('button', { type: 'button', className: 'map-chip', textContent: d.label });
    b.dataset.cat = d.id;
    b.addEventListener('click', () => setCategory(state.category === d.id && d.id !== 'all' ? 'all' : d.id));
    return b;
  }));
}
function syncChips() {
  document.querySelectorAll('.map-chip').forEach((b) => {
    const on = b.dataset.cat === state.category;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function setupMapSearch() {
  const input = $('#map-q'), list = $('#map-suggest'), clear = $('#map-clear');
  let items = [], active = -1;
  const close = () => {
    list.hidden = true; active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };
  const mark = (i) => {
    active = i;
    list.querySelectorAll('.sg-item').forEach((li, k) => { li.classList.toggle('is-active', k === i); li.setAttribute('aria-selected', String(k === i)); });
    if (i >= 0) input.setAttribute('aria-activedescendant', `sg-${i}`); else input.removeAttribute('aria-activedescendant');
  };
  const pick = (id) => {
    const q = input.value;
    close();
    rememberSearch(q);
    if (!visiblePlaces().some((p) => p.placeId === id)) clearFilters();
    input.value = getPlaceById(id).name;
    clear.hidden = false;
    selectPlace(id, { fly: true });
    input.blur();
  };
  const refresh = () => {
    const q = input.value.trim();
    clear.hidden = !input.value;
    if (!q) { items = []; list.replaceChildren(); close(); return; }
    items = searchPlaces(q).slice(0, 6);
    if (!items.length) list.replaceChildren(el('li', { className: 'sg-empty', textContent: 'No matching place' }));
    else list.replaceChildren(...items.map((p, i) => {
      const li = el('li', { id: `sg-${i}`, className: 'sg-item' }, el('span', { className: 'sg-name', textContent: p.name }), el('span', { className: 'sg-cat', textContent: categoryLabel(p.category) }));
      li.setAttribute('role', 'option');
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => pick(p.placeId));
      return li;
    }));
    active = -1;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.removeAttribute('aria-activedescendant');
  };
  input.addEventListener('input', refresh);
  input.addEventListener('focus', () => { if (input.value.trim()) refresh(); });
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.hidden) refresh();
      if (!items.length) return;
      e.preventDefault();
      const n = items.length;
      mark(e.key === 'ArrowDown' ? (active + 1) % n : (active <= 0 ? n - 1 : active - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const it = items[active >= 0 ? active : 0];
      if (it) pick(it.placeId);
    } else if (e.key === 'Escape') {
      if (!list.hidden) { close(); e.stopPropagation(); }
      else if (input.value) { input.value = ''; refresh(); e.stopPropagation(); }
    }
  });
  clear.addEventListener('click', () => { input.value = ''; refresh(); input.focus(); });
  $('#map-search-form').addEventListener('submit', (e) => e.preventDefault());
}

/* ---------- route planner ---------- */
function fillSelect(sel, placeholder) {
  sel.replaceChildren(el('option', { value: '', textContent: placeholder }));
  for (const c of getCategories()) {
    const g = el('optgroup', { label: c.label });
    getPlaces().filter((p) => p.category === c.categoryId).sort((a, b) => a.name.localeCompare(b.name))
      .forEach((p) => g.append(el('option', { value: p.placeId, textContent: p.name })));
    if (g.children.length) sel.append(g);
  }
}
function fieldError(id, msg) {
  const f = $(`#${id}`);
  f.classList.toggle('is-invalid', !!msg);
  f.setAttribute('aria-invalid', String(!!msg));
  $(`#${id}-error`).textContent = msg || '';
}
function clearErrors() { fieldError('start', ''); fieldError('end', ''); showAlert($('#route-message'), null); }

function setRouteEnds({ start, end }) {
  if (start !== undefined) $('#start').value = start;
  if (end !== undefined) $('#end').value = end;
  if ($('#start').value && $('#start').value === $('#end').value) (start !== undefined ? $('#end') : $('#start')).value = '';
  setView('route');
  clearErrors();
  if ($('#start').value && $('#end').value) submitRoute();
  else (!$('#start').value ? $('#start') : $('#end')).focus();
}

function submitRoute(e) {
  if (e) e.preventDefault();
  const s = $('#start').value, d = $('#end').value, sf = $('#stepfree').checked;
  clearErrors();
  if (!s) fieldError('start', 'Choose a starting point.');
  if (!d) fieldError('end', 'Choose a destination.');
  else if (s === d) fieldError('end', 'Destination must be different from the start.');
  if (!s || !d || s === d) { clearRoute({ keepForm: true }); (!s ? $('#start') : $('#end')).focus(); return; }

  const r = getRoute(s, d, { stepFree: sf });
  if (!r.ok) {
    clearRoute({ keepForm: true });
    const a = getPlaceById(s).name, b = getPlaceById(d).name;
    const msg = r.error === 'no-route'
      ? (sf ? `No step-free route connects ${a} and ${b}. Turn off "Step-free route only" to see the shortest route.` : `No walkway connects ${a} and ${b}.`)
      : r.message;
    showAlert($('#route-message'), [msg], 'danger');
    return;
  }
  state.route = r;
  state.step = -1;
  renderRoute(); drawRoute(); renderPins();
  try { history.replaceState(null, '', `?from=${s}&to=${d}${sf ? '&stepFree=1' : ''}`); } catch { /* ignore */ }
  $('#route-title').focus();
}

function renderRoute() {
  const r = state.route, box = $('#route-result');
  if (!r) { box.hidden = true; return; }
  const a = getPlaceById(r.startId), b = getPlaceById(r.endId);
  $('#route-title').textContent = `${a.name} to ${b.name}`;
  const stat = (t) => el('span', { className: 'stat', textContent: t });
  $('#route-stats').replaceChildren(stat(`${r.totalMeters} m`), stat(`About ${r.minutes} min walk`), stat(plural(r.steps.length, 'step')), ...(r.stepFree ? [stat('Step-free')] : []));
  $('#route-steps').replaceChildren(...r.steps.map((s, i) => {
    const btn = el('button', { type: 'button', className: 'step-btn', textContent: s.text });
    btn.addEventListener('click', () => goStep(i));
    return el('li', {}, btn);
  }));
  $('#route-arrival').textContent = `You have arrived at ${b.name}. ${b.entranceNote}`;
  $('#route-status').textContent = `Route ready: ${plural(r.steps.length, 'step')}, ${r.totalMeters} metres, about ${r.minutes} minutes.`;
  markActiveStep();
  box.hidden = false;
}

function clearRoute({ keepForm = false } = {}) {
  cancelAnimationFrame(anim.draw); anim.draw = 0;
  cancelMove();
  state.route = null; state.step = -1; rt = null;
  $('#route-result').hidden = true;
  $('#route-status').textContent = '';
  if (routeLayer) { routeLayer.clearLayers(); renderPins(); }
  renderBanner();
  if (!keepForm) {
    clearErrors();
    try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  }
}

function resetRoute() {
  $('#start').value = ''; $('#end').value = ''; $('#stepfree').checked = false;
  clearRoute();
}

async function copyLink() {
  try { await navigator.clipboard.writeText(location.href); toast('Route link copied'); }
  catch { showAlert($('#route-message'), [`Copy this link: ${location.href}`]); }
}

function routeFromUrl() {
  const q = new URLSearchParams(location.search);
  if (!q.has('from') && !q.has('to')) return;
  const [s, d] = [q.get('from'), q.get('to')];
  setView('route');
  if (!getPlaceById(s) || !getPlaceById(d)) {
    showAlert($('#route-message'), ['This route link refers to a place that is not on the campus map. Choose a start and destination below.'], 'danger');
    return;
  }
  $('#start').value = s; $('#end').value = d; $('#stepfree').checked = q.get('stepFree') === '1';
  submitRoute();
}

/* ---------- render + start ---------- */
function render() { renderList(); renderRecent(); renderPins(); renderCard(); syncChips(); }

function setupStatic() {
  const pop = $('#popular');
  pop.replaceChildren(...['p01', 'p02', 'p04', 'p06', 'p09', 'p11', 'p13'].map(getPlaceById).filter(Boolean).map((p) => {
    const b = el('button', { type: 'button', className: 'chip', textContent: p.name });
    b.addEventListener('click', () => { setView('places'); selectPlace(p.placeId, { fromList: true }); $('#explore').scrollIntoView(); });
    return el('li', {}, b);
  }));
  $('#category').append(...getCategories().map((c) => el('option', { value: c.categoryId, textContent: c.label })), el('option', { value: 'saved', textContent: 'Saved places' }));
  fillSelect($('#start'), 'Choose a starting point');
  fillSelect($('#end'), 'Choose a destination');
  setupChips();
  setupMapSearch();
  const s = getStats();
  $('#stats').textContent = `${s.places} places, ${s.junctions} junctions and ${s.walkways} walkways.`;
  document.title = `CampusWay | ${getCampusName()}`;
}

async function start() {
  showAlert($('#message'), [el('span', { className: 'spinner-border spinner-border-sm me-2' }), 'Loading campus data...']);
  try { await loadData(); }
  catch (err) {
    const retry = el('button', { type: 'button', className: 'btn btn-sm btn-dark ms-2', textContent: 'Try again' });
    retry.addEventListener('click', start);
    showAlert($('#message'), [`The campus data could not be read (${err.message}). If you opened the file directly, run it through a local server.`, retry], 'danger');
    return;
  }
  if (!getPlaces().length) {
    const reload = el('button', { type: 'button', className: 'btn btn-sm btn-dark ms-2', textContent: 'Reload sample data' });
    reload.addEventListener('click', () => loadData(true).then(() => location.reload()).catch(start));
    showAlert($('#message'), ['No places were loaded.', reload]);
    return;
  }
  if (!map) { setupStatic(); initMap(); }
  loadSaved();
  render();
  routeFromUrl();
}

$('#search-form').addEventListener('submit', (e) => { e.preventDefault(); rememberSearch(state.query); renderRecent(); });
$('#search').addEventListener('input', (e) => { state.query = e.target.value; if (map) render(); });
$('#category').addEventListener('change', (e) => { if (map) setCategory(e.target.value); else state.category = e.target.value; });
$('#route-form').addEventListener('submit', submitRoute);
$('#swap').addEventListener('click', () => {
  const s = $('#start'), d = $('#end');
  [s.value, d.value] = [d.value, s.value];
  clearErrors();
  if (state.route) submitRoute();
});
$('#clear-route').addEventListener('click', resetRoute);
$('#stepfree').addEventListener('change', () => { if (state.route) submitRoute(); });
$('#copy-link').addEventListener('click', copyLink);
$('#print-route').addEventListener('click', () => window.print());
$('#view-on-map').addEventListener('click', () => setView('map'));
$('#rb-prev').addEventListener('click', () => goStep(state.step - 1));
$('#rb-next').addEventListener('click', () => goStep(state.step + 1));
$('#rb-play').addEventListener('click', playRoute);
$('#rb-close').addEventListener('click', resetRoute);
for (const n of ['places', 'route', 'map']) $(`#tab-${n}`).addEventListener('click', () => setView(n));
document.querySelectorAll('[data-view]').forEach((a) => a.addEventListener('click', () => {
  setView(a.dataset.view);
  const c = bootstrap.Collapse.getInstance($('#nav'));
  if (c) c.hide();
}));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#map-wrap').classList.contains('is-fs')) toggleFs(false);
});
window.addEventListener('resize', () => {
  if (!map) return;
  map.invalidateSize();
  const p = isPhone();
  if (p === wasPhone) return;
  wasPhone = p;
  setView(view);
  if (!p) {
    setTimeout(() => {
      map.invalidateSize();
      if (!mapFitted) { fitCampus(); mapFitted = true; }
      updateMapUi();
      if (rt) applyCamera(false);
    }, 0);
  }
});
start();
