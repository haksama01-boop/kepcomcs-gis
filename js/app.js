const REQUIRED_COLUMNS = ['계약번호', '검침원', '분구', '주소'];
const COLOR_LIST = ['#dc2626','#2563eb','#16a34a','#eab308','#7c3aed','#f59e0b'];
const SHAPE_LIST = ['circle','triangle','square','diamond','hexagon','star'];
const BLACK_COLOR = '#111827';
const GEO_CACHE_KEY = 'kakao_meter_geo_cache_v2';
const MAX_SUMMARY_LABELS = 600;
let map, geocoder, roadview, roadviewClient;
let roadviewVisible = true;
let roadviewAutoEnabled = true;
let rows = [];
let filteredRows = [];
let visibleRows = [];
let visibleGroups = [];
let markerSizePercent = 100;
let showSummaryLabels = true;
let colorMode = 'reader';
let valueColor = new Map();
let valueShape = new Map();
let readerColorMap = new Map();
let readerShapeMap = new Map();
let readerPatternMap = new Map();
let bunLetterMap = new Map();
let summaryOverlays = [];
let openedOverlay = null;
let openedGroupKey = null;
let drawTimer = null;
let memoMode = 'off';
let memoItems = [];
let currentMemoPath = null;
let memoInitialized = false;
let adminLoggedIn = false;
let adminPasswordCache = '';


const $ = id => document.getElementById(id);
function setMsg(text, isError=false) { $('message').innerHTML = text ? `<div class="${isError ? 'error' : 'notice'}">${text}</div>` : ''; }
function normalize(v) { return String(v ?? '').trim(); }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function cleanAddress(address) { return normalize(address).replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim(); }
function formatExcelDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,'0')}-${String(v.getDate()).padStart(2,'0')}`;
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d)) return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
  return normalize(v);
}
function toNumberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : null;
}
function readHeaderValue(row, candidates) {
  const keys = Object.keys(row || {});
  const normalizedMap = new Map(keys.map(k => [normalize(k).replace(/\s+/g,'').toLowerCase(), k]));
  for (const c of candidates) {
    const key = normalizedMap.get(normalize(c).replace(/\s+/g,'').toLowerCase());
    if (key !== undefined) return row[key];
  }
  return undefined;
}
function detectCoords(row) {
  let lng = toNumberOrNull(readHeaderValue(row, ['경도','X좌표','X 좌표','x좌표','x 좌표','X','lng','LNG','longitude','Longitude']));
  let lat = toNumberOrNull(readHeaderValue(row, ['위도','Y좌표','Y 좌표','y좌표','y 좌표','Y','lat','LAT','latitude','Latitude']));

  // 엑셀 컬럼명이 반대로 되어 있어도 한국 좌표 범위로 자동 보정
  if (lat !== null && lng !== null) {
    const looksReversed = lat > 100 && lng >= 20 && lng <= 50;
    if (looksReversed) [lat, lng] = [lng, lat];
  }
  if (lat !== null && lng !== null && lat >= 20 && lat <= 50 && lng >= 120 && lng <= 135) return { lat, lng };
  return { lat:null, lng:null };
}
function loadGeoCache(){ try { return JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); } catch { return {}; } }
function saveGeoCache(cache){ try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(cache)); } catch(e) { console.warn(e); } }
function getCacheKey(address){ return cleanAddress(address).toLowerCase(); }

$('loadMapBtn').addEventListener('click', () => {
  const key = normalize($('appKey').value) || 'e8d9861fc070c56c1c5f75bc24338f37';
  if (window.kakao && window.kakao.maps) return initMap();
  const script = document.createElement('script');
  script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services`;
  script.onload = () => kakao.maps.load(initMap);
  script.onerror = () => setMsg('카카오맵 스크립트를 불러오지 못했습니다. 앱 키와 도메인 등록을 확인해 주세요.', true);
  document.head.appendChild(script);
});

function initMap() {
  const center = new kakao.maps.LatLng(35.2285, 128.6811);
  map = new kakao.maps.Map($('map'), { center, level: 6 });
  geocoder = new kakao.maps.services.Geocoder();
  roadview = new kakao.maps.Roadview($('roadview'));
  roadviewClient = new kakao.maps.RoadviewClient();
  kakao.maps.event.addListener(map, 'idle', requestDraw);
  kakao.maps.event.addListener(map, 'click', onMapClick);
  setTimeout(() => { map.relayout(); if (roadview) roadview.relayout(); requestDraw(); }, 100);
  initMemoLayer();
  setMsg('지도 준비 완료. 엑셀 파일을 업로드해 주세요.');
}

async function parseExcelFileToRows(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type:'array', cellDates:true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(sheet, { defval:'' });
  const headers = Object.keys(json[0] || {}).map(h => h.trim());
  const missing = REQUIRED_COLUMNS.filter(c => !headers.includes(c));
  if (missing.length) {
    throw new Error(`필수 컬럼이 없습니다: ${missing.join(', ')}\n현재 컬럼: ${headers.join(', ')}`);
  }

  return json.map((r, idx) => {
    const coords = detectCoords(r);
    return {
      id: idx + 1,
      contractNo: normalize(r['계약번호']),
      reader: normalize(r['검침원']),
      meterDate: formatExcelDate(r['검침일'] ?? r['검침 일']),
      bun: normalize(r['분구']),
      address: normalize(r['주소']),
      type: normalize(r['계약종별']),
      power: normalize(r['계약전력'] ?? r['계약 전력']),
      method: normalize(r['계약검침방법'] ?? r['계약 검침 방법']),
      lat: coords.lat,
      lng: coords.lng,
      status: coords.lat && coords.lng ? '좌표있음' : '대기'
    };
  }).filter(r => r.address);
}

async function loadRowsIntoMap(newRows, sourceLabel='자료', updatedAt='') {
  rows = newRows || [];
  closeInfo();

  const coordCount = rows.filter(r => r.lat && r.lng).length;
  $('geocodeBtn').disabled = false;
  $('fitBtn').disabled = coordCount === 0;

  const mode = $('currentDataMode');
  if (mode) mode.textContent = sourceLabel;
  const updated = $('sharedUpdatedAt');
  if (updated && updatedAt) updated.textContent = updatedAt;

  setMsg(`${sourceLabel} ${rows.length.toLocaleString()}건 읽음. 좌표 인식 ${coordCount.toLocaleString()}건. 필터와 마커 기준을 준비하는 중입니다...`);

  await sleep(10);
  buildFilters();
  rebuildColorMap();
  applyFilters();

  setMsg(`${sourceLabel} ${rows.length.toLocaleString()}건 읽음. 좌표 인식 ${coordCount.toLocaleString()}건. 좌표가 있으면 바로 표시됩니다.`);
}


function setAdminMode(enabled) {
  adminLoggedIn = !!enabled;
  const loginBox = $('adminLoginBox');
  const form = $('adminLoginForm');
  const uploadBox = $('adminUploadBox');
  const toggleBtn = $('adminLoginToggleBtn');

  if (uploadBox) uploadBox.classList.toggle('hidden', !adminLoggedIn);
  if (form) form.classList.add('hidden');
  if (toggleBtn) toggleBtn.textContent = adminLoggedIn ? '관리자 로그인됨' : '관리자 로그인';
  if (loginBox) loginBox.classList.toggle('hidden', adminLoggedIn);
}

async function verifyAdminPassword(password) {
  const res = await fetch('/api/admin-check', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-password': password
    },
    body: JSON.stringify({ ok: true })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '관리자 인증에 실패했습니다.');
  return true;
}

function initAdminLoginUI() {
  const toggle = $('adminLoginToggleBtn');
  const form = $('adminLoginForm');
  const login = $('adminLoginBtn');
  const logout = $('adminLogoutBtn');

  if (toggle && form) {
    toggle.addEventListener('click', () => {
      form.classList.toggle('hidden');
      const input = $('adminPassword');
      if (input && !form.classList.contains('hidden')) input.focus();
    });
  }

  if (login) {
    login.addEventListener('click', async () => {
      const password = normalize($('adminPassword').value);
      if (!password) return setMsg('관리자 비밀번호를 입력해 주세요.', true);

      try {
        setMsg('관리자 확인 중...');
        await verifyAdminPassword(password);
        adminPasswordCache = password;
        setAdminMode(true);
        setMsg('관리자 로그인 완료. 공용자료 변경 메뉴가 활성화되었습니다.');
      } catch (err) {
        adminPasswordCache = '';
        setAdminMode(false);
        setMsg((err && err.message) ? err.message : String(err), true);
      }
    });
  }

  if (logout) {
    logout.addEventListener('click', () => {
      adminPasswordCache = '';
      setAdminMode(false);
      setMsg('관리자 로그아웃 완료.');
    });
  }
}


// 2번 개인자료 업로드: 업로드한 사람의 브라우저에서만 적용
$('excelFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    setMsg('개인자료 엑셀 읽는 중...');
    await sleep(20);
    const parsedRows = await parseExcelFileToRows(file);
    await loadRowsIntoMap(parsedRows, '개인자료');
  } catch (err) {
    setMsg(err.message || String(err), true);
  }
});

// 1번 공용자료 업로드: Cloudflare D1 데이터베이스에 저장되어 모든 접속자가 볼 수 있음
$('sharedUploadBtn').addEventListener('click', async () => {
  const file = $('sharedExcelFile').files[0];
  const password = adminPasswordCache;
  if (!file) return setMsg('공용자료로 올릴 엑셀 파일을 선택해 주세요.', true);
  if (!adminLoggedIn || !password) return setMsg('관리자 로그인이 필요합니다.', true);

  try {
    setMsg('공용자료 엑셀 읽는 중...');
    const parsedRows = await parseExcelFileToRows(file);

    setMsg(`공용자료 서버 저장 중... ${parsedRows.length.toLocaleString()}건`);
    const res = await fetch('/api/shared-data', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-admin-password': password
      },
      body: JSON.stringify({
        updatedAt: new Date().toISOString(),
        rows: parsedRows
      })
    });

    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((result.error || '공용자료 저장에 실패했습니다.') + (result.detail ? '\n상세: ' + result.detail : ''));

    const when = result.updatedAt ? new Date(result.updatedAt).toLocaleString() : new Date().toLocaleString();
    await loadRowsIntoMap(parsedRows, '공용자료', when);
    setMsg(`공용자료 업로드 완료. 모든 접속자가 최신 공용자료를 볼 수 있습니다. ${parsedRows.length.toLocaleString()}건`);
  } catch (err) {
    setMsg((err && err.message) ? err.message : String(err), true);
  }
});

// 공용자료 수동 다시 불러오기
$('loadSharedDataBtn').addEventListener('click', loadSharedData);

async function loadSharedData(silent=false) {
  try {
    if (!silent) setMsg('공용자료 불러오는 중...');
    const res = await fetch('/api/shared-data', { method: 'GET', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '공용자료를 불러오지 못했습니다.');

    if (!data.rows || !Array.isArray(data.rows) || !data.rows.length) {
      const updated = $('sharedUpdatedAt');
      if (updated) updated.textContent = '-';
      if (!silent) setMsg('저장된 공용자료가 없습니다. 관리자가 1번 공용자료를 먼저 업로드해야 합니다.');
      return;
    }

    const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString() : '-';
    await loadRowsIntoMap(data.rows, '공용자료', when);
    if (!silent) setMsg(`공용자료 불러오기 완료. ${data.rows.length.toLocaleString()}건 · 등록일시 ${when}`);
  } catch (err) {
    if (!silent) setMsg((err && err.message) ? err.message : String(err), true);
    else console.warn('공용자료 자동 불러오기 실패:', err);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initAdminLoginUI();
  setAdminMode(false);
  // 접속 시 공용자료 자동 확인. 공용자료 보기가 기본 실행됩니다.
  setTimeout(() => loadSharedData(false), 500);
});


function geocode(address) {
  return new Promise(resolve => {
    geocoder.addressSearch(address, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result[0]) resolve({ lat:+result[0].y, lng:+result[0].x });
      else resolve(null);
    });
  });
}
$('geocodeBtn').addEventListener('click', async () => {
  if (!map || !geocoder) return setMsg('지도를 먼저 불러와 주세요.', true);
  const need = rows.filter(r => !r.lat || !r.lng);
  if (!need.length) { applyFilters(); $('fitBtn').disabled = false; return setMsg(`완료: 좌표 확보 ${rows.filter(r=>r.lat&&r.lng).length.toLocaleString()}건. 주소 변환 없이 바로 표시합니다.`); }

  const cache = loadGeoCache();
  const groups = new Map();
  need.forEach(r => { const k = getCacheKey(r.address); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
  let apiCalls = 0, fail = 0, cacheHit = 0;
  for (const [k, groupRows] of groups.entries()) {
    if (cache[k]) { groupRows.forEach(r => { r.lat = cache[k].lat; r.lng = cache[k].lng; r.status='캐시'; }); cacheHit += groupRows.length; }
  }
  const apiEntries = [...groups.entries()].filter(([k]) => !cache[k]);
  for (let i=0; i<apiEntries.length; i++) {
    const [k, groupRows] = apiEntries[i];
    setMsg(`주소 변환 중... ${i+1}/${apiEntries.length}<br>캐시 ${cacheHit.toLocaleString()}건 · API ${apiCalls.toLocaleString()}회`);
    let p = await geocode(groupRows[0].address);
    if (!p) p = await geocode(cleanAddress(groupRows[0].address));
    if (p) { cache[k] = p; groupRows.forEach(r => { r.lat=p.lat; r.lng=p.lng; r.status='성공'; }); }
    else { groupRows.forEach(r => r.status='실패'); fail += groupRows.length; }
    apiCalls++; if (apiCalls % 50 === 0) saveGeoCache(cache);
    await sleep(45);
  }
  saveGeoCache(cache);
  $('fitBtn').disabled = rows.filter(r=>r.lat&&r.lng).length === 0;
  applyFilters();
  setMsg(`완료: 좌표 확보 ${rows.filter(r=>r.lat&&r.lng).length.toLocaleString()}건, 실패 ${fail.toLocaleString()}건. API 호출 ${apiCalls.toLocaleString()}회.`);
});

function fillSelect(id, values, keepSelected=true) {
  const sel = $(id);
  const prev = keepSelected ? new Set(Array.from(sel.selectedOptions || []).map(o => normalize(o.value))) : new Set();
  sel.innerHTML = values.map(v => `<option value="${escapeHtml(v)}" ${prev.has(normalize(v)) ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

// 검침일 필터는 분구 필터의 상위 필터입니다.
// 예: 검침일 15 선택 → 분구 목록에는 15xxx 형태만 표시됩니다.
function getBunPrefixFromDate(value) {
  const v = normalize(value);
  if (!v) return '';
  const m = v.match(/(\d{1,2})$/); // 2026-05-15 같은 날짜면 마지막 15 사용
  if (m) return m[1].padStart(2, '0');
  const digits = v.replace(/\D/g, '');
  if (digits.length >= 2) return digits.slice(-2).padStart(2, '0');
  return v.slice(0, 2).padStart(2, '0');
}
function getAllowedBunValuesByDate() {
  const selectedDates = getSelectedValues('dateFilter');
  const allBuns = [...new Set(rows.map(r=>r.bun).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ko',{numeric:true}));
  if (!selectedDates.length) return allBuns;
  const prefixes = selectedDates.map(getBunPrefixFromDate).filter(Boolean);
  return allBuns.filter(bun => prefixes.some(prefix => normalize(bun).startsWith(prefix)));
}
function refreshBunFilterByDate() {
  const allowedBuns = getAllowedBunValuesByDate();
  fillSelect('bunFilter', allowedBuns, true);
}
function buildFilters() {
  fillSelect('readerFilter', [...new Set(rows.map(r=>r.reader).filter(Boolean))].sort(), false);
  fillSelect('dateFilter', [...new Set(rows.map(r=>r.meterDate).filter(Boolean))].sort(), false);
  refreshBunFilterByDate();
  fillSelect('typeFilter', [...new Set(rows.map(r=>r.type).filter(Boolean))].sort(), false);
  fillSelect('powerFilter', [...new Set(rows.map(r=>r.power).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ko',{numeric:true})), false);
  fillSelect('methodFilter', [...new Set(rows.map(r=>r.method).filter(Boolean))].sort(), false);
}
function getSelectedValues(id){ return Array.from($(id).selectedOptions || []).map(o => normalize(o.value)).filter(Boolean); }
function enableToggleMultiSelect(id) {
  const sel = $(id); if (!sel || sel.__ok) return; sel.__ok = true;
  sel.addEventListener('mousedown', e => {
    if (e.target && e.target.tagName === 'OPTION') { e.preventDefault(); e.target.selected = !e.target.selected; sel.focus(); sel.dispatchEvent(new Event('change', {bubbles:true})); }
  });
}
function matchMulti(value, selected) { const v = normalize(value); return selected.length === 0 || selected.includes(v); }
function getFilteredRows() {
  const readers = getSelectedValues('readerFilter');
  const dates = getSelectedValues('dateFilter');
  const buns = getSelectedValues('bunFilter');
  const types = getSelectedValues('typeFilter');
  const powers = getSelectedValues('powerFilter');
  const methods = getSelectedValues('methodFilter');
  const q = normalize($('searchInput').value).toLowerCase();
  return rows.filter(r =>
    matchMulti(r.reader, readers) && matchMulti(r.meterDate, dates) && matchMulti(r.bun, buns) &&
    matchMulti(r.type, types) && matchMulti(r.power, powers) && matchMulti(r.method, methods) &&
    (!q || `${r.contractNo} ${r.reader} ${r.meterDate} ${r.bun} ${r.address} ${r.type} ${r.power} ${r.method}`.toLowerCase().includes(q))
  );
}
function clearAllFilters(){ ['readerFilter','dateFilter','bunFilter','typeFilter','powerFilter','methodFilter'].forEach(id => Array.from($(id).options).forEach(o => o.selected=false)); $('searchInput').value=''; applyFilters(); }
['readerFilter','dateFilter','bunFilter','typeFilter','powerFilter','methodFilter'].forEach(id => enableToggleMultiSelect(id));
$('dateFilter').addEventListener('change', () => { refreshBunFilterByDate(); applyFilters(); });
['readerFilter','bunFilter','typeFilter','powerFilter','methodFilter'].forEach(id => $(id).addEventListener('change', applyFilters));
$('searchInput').addEventListener('input', debounce(applyFilters, 120));
$('clearFiltersBtn').addEventListener('click', clearAllFilters);
$('markerSizeRange').addEventListener('input', e => { markerSizePercent = Number(e.target.value); $('markerSizeValue').textContent = markerSizePercent + '%'; requestDraw(); });
$('colorModeSelect').addEventListener('change', e => { colorMode = e.target.value; rebuildColorMap(); requestDraw(); });
$('toggleSummaryBtn').addEventListener('click', () => { showSummaryLabels = !showSummaryLabels; $('toggleSummaryBtn').textContent = showSummaryLabels ? '검침원/분구/매수 표시창 끄기' : '검침원/분구/매수 표시창 켜기'; requestDraw(); });
function setRoadviewPanelVisible(visible) {
  roadviewVisible = visible;
  $('roadviewWrap').style.display = roadviewVisible ? 'block' : 'none';
  $('viewerWrap').style.gridTemplateColumns = roadviewVisible ? 'minmax(0, 1fr) 38%' : '1fr';
  setTimeout(() => { if (map) map.relayout(); if (roadview) roadview.relayout(); requestDraw(); }, 80);
}

$('toggleRoadviewBtn').addEventListener('click', () => {
  roadviewAutoEnabled = !roadviewAutoEnabled;
  $('toggleRoadviewBtn').textContent = roadviewAutoEnabled ? '로드뷰 자동표시 끄기' : '로드뷰 자동표시 켜기';
  setRoadviewPanelVisible(roadviewAutoEnabled);
});
$('fitBtn').addEventListener('click', () => {
  const valid = getFilteredRows().filter(r => r.lat && r.lng);
  if (!valid.length || !map) return;
  const bounds = new kakao.maps.LatLngBounds();
  valid.forEach(r => bounds.extend(new kakao.maps.LatLng(r.lat, r.lng)));
  map.setBounds(bounds);
  requestDraw();
});

function debounce(fn, ms){ let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }
function applyFilters(){ filteredRows = getFilteredRows(); updateSummary(filteredRows.filter(r=>r.lat&&r.lng)); renderList(filteredRows); requestDraw(); }
function countContracts(targetRows) {
  // 필터 조건을 만족하는 계약번호 개수 기준으로 집계합니다.
  // 계약번호가 비어있는 행은 행 ID로 보완해 누락되지 않게 처리합니다.
  return new Set(targetRows.map(r => normalize(r.contractNo) || `__row_${r.id}`)).size;
}
function updateSummary(targetRows) {
  $('readerCount').textContent = new Set(targetRows.map(r=>r.reader).filter(Boolean)).size;
  $('bunCount').textContent = new Set(targetRows.map(r=>r.bun).filter(Boolean)).size;
  $('shownCount').textContent = countContracts(targetRows).toLocaleString();
}
function getColorFieldValue(r) {
  return normalize(r.reader) || '검침원 없음';
}
function getAlphaLabel(index) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (index < letters.length) return letters[index];
  const first = letters[Math.floor(index / letters.length) - 1] || 'Z';
  const second = letters[index % letters.length];
  return first + second;
}
function makeReaderPattern(idx) {
  const color = COLOR_LIST[idx % COLOR_LIST.length];

  if (idx < 6) {
    return { shape: 'circle', split: 'solid', color1: color, color2: null };
  }
  if (idx < 12) {
    return { shape: 'triangle', split: 'leftRight', color1: color, color2: BLACK_COLOR };
  }
  if (idx < 18) {
    return { shape: 'triangle', split: 'leftRight', color1: BLACK_COLOR, color2: color };
  }
  if (idx < 24) {
    return { shape: 'square', split: 'topBottom', color1: BLACK_COLOR, color2: color };
  }
  if (idx < 30) {
    return { shape: 'square', split: 'topBottom', color1: color, color2: BLACK_COLOR };
  }
  return { shape: 'star', split: 'solid', color1: color, color2: null };
}
function rebuildColorMap() {
  valueColor.clear();
  valueShape.clear();
  readerColorMap.clear();
  readerShapeMap.clear();
  readerPatternMap.clear();
  bunLetterMap.clear();

  const readers = [...new Set(rows.map(r => normalize(r.reader)).filter(Boolean))]
    .sort((a,b)=>String(a).localeCompare(String(b),'ko',{numeric:true}));

  readers.forEach((reader, idx) => {
    const pattern = makeReaderPattern(idx);
    readerPatternMap.set(reader, pattern);
    readerColorMap.set(reader, pattern.color1);
    readerShapeMap.set(reader, pattern.shape);
    valueColor.set(reader, pattern.color1);
    valueShape.set(reader, pattern.shape);
  });

  const readerDateGroups = new Map();
  rows.forEach(r => {
    const reader = normalize(r.reader) || '검침원 없음';
    const date = normalize(r.meterDate) || '검침일 없음';
    const bun = normalize(r.bun) || '분구 없음';
    const groupKey = `${reader}||${date}`;
    if (!readerDateGroups.has(groupKey)) readerDateGroups.set(groupKey, new Set());
    readerDateGroups.get(groupKey).add(bun);
  });

  [...readerDateGroups.entries()].forEach(([groupKey, bunSet]) => {
    const buns = [...bunSet].sort((a,b)=>String(a).localeCompare(String(b),'ko',{numeric:true}));
    buns.forEach((bun, idx) => {
      const key = `${groupKey}||${bun}`;
      bunLetterMap.set(key, getAlphaLabel(idx));
    });
  });

  updateReaderColorLegend();
}
function getReaderPatternForRow(r) {
  const reader = normalize(r.reader) || '검침원 없음';
  return readerPatternMap.get(reader) || { shape: 'circle', split: 'solid', color1: '#111827', color2: null };
}
function getColorForRow(r){
  return getReaderPatternForRow(r).color1 || '#111827';
}
function getShapeForRow(r){
  return getReaderPatternForRow(r).shape || 'circle';
}
function getOutlineForRow(r){
  return false;
}
function getBunLetterForRow(r){
  const reader = normalize(r.reader) || '검침원 없음';
  const date = normalize(r.meterDate) || '검침일 없음';
  const bun = normalize(r.bun) || '분구 없음';
  const key = `${reader}||${date}||${bun}`;
  return bunLetterMap.get(key) || '';
}

function shapeSymbol(shape) {
  if (shape === 'triangle') return '▲';
  if (shape === 'square') return '■';
  if (shape === 'diamond') return '◆';
  if (shape === 'hexagon') return '⬢';
  if (shape === 'star') return '★';
  return '●';
}
function updateReaderColorLegend() {
  let box = $('readerColorLegend');
  if (!box) return;
  const readers = [...readerPatternMap.entries()];
  if (!readers.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = readers.map(([name, p]) => {
    const symbol = shapeSymbol(p.shape);
    let bg = p.color1;
    if (p.split === 'leftRight') bg = `linear-gradient(90deg, ${p.color1} 0 50%, ${p.color2} 50% 100%)`;
    if (p.split === 'topBottom') bg = `linear-gradient(180deg, ${p.color1} 0 50%, ${p.color2} 50% 100%)`;
    return `<span style="display:inline-flex;align-items:center;margin:2px 6px 2px 0;font-size:12px;">
      <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;background:${bg};color:white;font-size:10px;font-weight:900;margin-right:4px;border:1px solid rgba(0,0,0,.25);">${symbol}</span>${escapeHtml(name)}
    </span>`;
  }).join('');
}


function hexToRgba(hex, alpha) {
  const h = String(hex || '#111827').replace('#','');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h.padEnd(6, '0').slice(0,6);
  const r = parseInt(full.slice(0,2), 16);
  const g = parseInt(full.slice(2,4), 16);
  const b = parseInt(full.slice(4,6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function clearBunAreaPolygons() {}
function drawBunAreas(sourceRows) {}
function clearSummaryOverlays(){ summaryOverlays.forEach(o => o.setMap(null)); summaryOverlays = []; }
function closeInfo(){
  if (openedOverlay) openedOverlay.setMap(null);
  openedOverlay = null;
  openedGroupKey = null;
  const panel = $('floatingInfoPanel');
  if (panel) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    panel.dataset.groupKey = '';
  }
}

function clampFloatingInfoPanel(x, y) {
  const panel = $('floatingInfoPanel');
  const wrap = panel ? panel.closest('.mapWrap') : null;
  if (!panel || !wrap) return { x, y };
  const wrapRect = wrap.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const margin = 12;

  let cx = x;
  let cy = y;

  const halfW = Math.min(panelRect.width || 300, wrapRect.width - margin * 2) / 2;
  if (cx - halfW < margin) cx = margin + halfW;
  if (cx + halfW > wrapRect.width - margin) cx = wrapRect.width - margin - halfW;

  const panelH = panelRect.height || 180;
  if (cy - panelH - 24 < margin) {
    // 마커 위쪽 공간이 부족하면 마커 아래쪽에 표시
    panel.style.transform = 'translate(-50%, 18px)';
    panel.classList.add('below-marker');
  } else {
    panel.style.transform = 'translate(-50%, calc(-100% - 18px))';
    panel.classList.remove('below-marker');
  }

  return { x: cx, y: cy };
}
function positionFloatingInfoPanelByGroup(group) {
  const panel = $('floatingInfoPanel');
  if (!panel || !map || !group) return;
  const projection = map.getProjection();
  const p = projection.containerPointFromCoords(new kakao.maps.LatLng(group.lat, group.lng));
  const pos = clampFloatingInfoPanel(p.x, p.y);
  panel.style.left = pos.x + 'px';
  panel.style.top = pos.y + 'px';
}
function showFloatingInfoPanel(group) {
  const panel = $('floatingInfoPanel');
  if (!panel || !group) return false;
  panel.innerHTML = makeInfoContent(group);
  panel.dataset.groupKey = group.key || '';
  panel.classList.remove('hidden');
  // DOM 렌더링 후 크기를 계산해 화면 밖으로 나가지 않도록 보정
  requestAnimationFrame(() => positionFloatingInfoPanelByGroup(group));
  return true;
}

function requestDraw(){ clearTimeout(drawTimer); drawTimer = setTimeout(drawCanvas, 40); }
function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return { width: rect.width, height: rect.height, dpr };
}
function getVisibleRows() {
  if (!map) return [];
  const bounds = map.getBounds();
  return filteredRows.filter(r => r.lat && r.lng && bounds.contain(new kakao.maps.LatLng(r.lat, r.lng)));
}
function makeGroupKey(r){ return `${Number(r.lat).toFixed(7)}||${Number(r.lng).toFixed(7)}`; }
function buildVisibleGroups(sourceRows) {
  const groups = new Map();
  sourceRows.forEach(r => {
    const k = makeGroupKey(r);
    if (!groups.has(k)) groups.set(k, { key:k, lat:r.lat, lng:r.lng, rows:[] });
    groups.get(k).rows.push(r);
  });
  return [...groups.values()];
}
function drawCanvas() {
  const canvas = $('markerCanvas'); if (!canvas || !map) return;
  const { dpr } = resizeCanvas(canvas);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);
  clearSummaryOverlays();

  // 최적화: 지도 이동/확대 때마다 전체 필터를 다시 계산하지 않고 기존 filteredRows를 재사용합니다.
  visibleRows = getVisibleRows();
  visibleGroups = buildVisibleGroups(visibleRows);
  const projection = map.getProjection();

  // 지도 이동/확대·축소 시 열린 고객정보 창도 해당 마커 위치를 따라가도록 보정
  if (openedGroupKey) {
    const openedGroup = visibleGroups.find(g => g.key === openedGroupKey);
    if (openedGroup && !$('floatingInfoPanel')?.classList.contains('hidden')) {
      positionFloatingInfoPanelByGroup(openedGroup);
    }
  }
  const size = 13 * markerSizePercent / 100;

  // 너무 축소되어 화면 전체가 5만건이어도 Canvas는 빠르게 찍음
  visibleGroups.forEach(g => {
    const first = g.rows[0];
    const p = projection.containerPointFromCoords(new kakao.maps.LatLng(g.lat, g.lng));
    g.x = p.x; g.y = p.y; g.radius = Math.max(2, size + (g.rows.length > 1 ? 1 : 0));
    drawMarker(ctx, p.x, p.y, size, getReaderPatternForRow(first), g.rows.length, getBunLetterForRow(first));
  });

  if (showSummaryLabels) drawSummaryLabels(ctx, visibleRows, projection, filteredRows.filter(r=>r.lat&&r.lng));
  drawMemoLayer();
  setMsg(`필터 결과 계약번호 ${countContracts(filteredRows.filter(r=>r.lat&&r.lng)).toLocaleString()}건 · 현재 화면 ${visibleRows.length.toLocaleString()}건 표시 중입니다. Canvas 방식이라 필터/이동이 더 빠릅니다.`);
}
function drawShapePath(ctx, x, y, size, shape) {
  ctx.beginPath();
  if (shape === 'triangle') {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size * .95, y + size * .82);
    ctx.lineTo(x - size * .95, y + size * .82);
    ctx.closePath();
  } else if (shape === 'square') {
    ctx.rect(x - size * .82, y - size * .82, size * 1.64, size * 1.64);
  } else if (shape === 'diamond') {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
  } else if (shape === 'hexagon') {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      const px = x + Math.cos(a) * size;
      const py = y + Math.sin(a) * size;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  } else if (shape === 'star') {
    const spikes = 5, outer = size, inner = size * .45;
    let rot = Math.PI / 2 * 3;
    ctx.moveTo(x, y - outer);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(x + Math.cos(rot) * outer, y + Math.sin(rot) * outer);
      rot += Math.PI / spikes;
      ctx.lineTo(x + Math.cos(rot) * inner, y + Math.sin(rot) * inner);
      rot += Math.PI / spikes;
    }
    ctx.closePath();
  } else {
    ctx.arc(x, y, size, 0, Math.PI * 2);
  }
}
function fillShapeWithPattern(ctx, x, y, size, pattern) {
  const shape = pattern.shape || 'circle';
  const split = pattern.split || 'solid';
  const color1 = pattern.color1 || '#111827';
  const color2 = pattern.color2 || color1;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.18)';
  ctx.shadowBlur = 3;

  drawShapePath(ctx, x, y, size, shape);
  ctx.clip();

  if (split === 'leftRight') {
    ctx.fillStyle = color1;
    ctx.fillRect(x - size * 1.2, y - size * 1.2, size * 1.2, size * 2.4);
    ctx.fillStyle = color2;
    ctx.fillRect(x, y - size * 1.2, size * 1.2, size * 2.4);
  } else if (split === 'topBottom') {
    ctx.fillStyle = color1;
    ctx.fillRect(x - size * 1.2, y - size * 1.2, size * 2.4, size * 1.2);
    ctx.fillStyle = color2;
    ctx.fillRect(x - size * 1.2, y, size * 2.4, size * 1.2);
  } else {
    ctx.fillStyle = color1;
    ctx.fillRect(x - size * 1.2, y - size * 1.2, size * 2.4, size * 2.4);
  }

  // 아주 약한 입체감: 기능/색상 규칙 변경 없이 마커 상단에 하이라이트만 추가
  const highlight = ctx.createLinearGradient(x, y - size, x, y + size);
  highlight.addColorStop(0, 'rgba(255,255,255,.22)');
  highlight.addColorStop(0.42, 'rgba(255,255,255,.06)');
  highlight.addColorStop(1, 'rgba(0,0,0,.08)');
  ctx.fillStyle = highlight;
  ctx.fillRect(x - size * 1.2, y - size * 1.2, size * 2.4, size * 2.4);

  ctx.restore();

  ctx.save();
  ctx.shadowBlur = 0;
  drawShapePath(ctx, x, y, size, shape);
  ctx.lineWidth = Math.max(1.2, size * 0.10);
  ctx.strokeStyle = 'rgba(17,24,39,.55)';
  ctx.stroke();

  if (split === 'leftRight') {
    ctx.beginPath();
    ctx.moveTo(x, y - size * 1.05);
    ctx.lineTo(x, y + size * 1.05);
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.stroke();
  } else if (split === 'topBottom') {
    ctx.beginPath();
    ctx.moveTo(x - size * 1.05, y);
    ctx.lineTo(x + size * 1.05, y);
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.stroke();
  }
  ctx.restore();
}
function drawMarker(ctx, x, y, size, pattern, count, bunLetter='') {
  ctx.save();
  fillShapeWithPattern(ctx, x, y, size, pattern || {shape:'circle', split:'solid', color1:'#111827'});

  if (bunLetter) {
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.font = `900 ${Math.max(10, size * 1.05)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.lineWidth = Math.max(2.2, size * 0.12);
    ctx.strokeText(String(bunLetter), x, y);
    ctx.fillText(String(bunLetter), x, y);
    ctx.restore();
  }

  if (count > 1) {
    const txt = count > 99 ? '99+' : String(count);
    ctx.font = 'bold 10px system-ui';
    const w = Math.max(18, ctx.measureText(txt).width + 8);
    ctx.fillStyle = '#111827';
    roundRect(ctx, x + size*.35, y - size*1.2, w, 17, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x + size*.35 + w/2, y - size*1.2 + 8.5);
  }

  ctx.restore();
}


function drawMiniPatternIcon(ctx, x, y, size, pattern) {
  ctx.save();
  fillShapeWithPattern(ctx, x, y, size, pattern || {shape:'circle', split:'solid', color1:'#111827'});
  ctx.restore();
}



function drawSummaryMarkerIcon(ctx, x, y, size, pattern, bunLetter='') {
  ctx.save();
  drawMarker(ctx, x, y, size, pattern || {shape:'circle', split:'solid', color1:'#111827'}, 1, bunLetter || '');
  ctx.restore();
}


function labelRectsOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}
function findLabelPosition(baseX, baseY, w, h, placedRects, canvasW, canvasH, blockedRects = []) {
  const margin = 6;
  const candidates = [{x:0,y:0}];

  // 가까운 위치부터 나선형으로 탐색하되, 마커 영역과 표시창 영역을 모두 피합니다.
  for (let radius = 36; radius <= 520; radius += 34) {
    candidates.push(
      {x:0,y:-radius},
      {x:radius,y:-radius},
      {x:radius,y:0},
      {x:radius,y:radius},
      {x:0,y:radius},
      {x:-radius,y:radius},
      {x:-radius,y:0},
      {x:-radius,y:-radius},
      {x:radius * .6,y:-radius},
      {x:radius,y:-radius * .6},
      {x:radius * .6,y:radius},
      {x:-radius * .6,y:radius}
    );
  }

  const allBlocked = () => placedRects.concat(blockedRects);

  for (const off of candidates) {
    const cx = Math.min(Math.max(baseX + off.x, margin + w / 2), canvasW - margin - w / 2);
    const cy = Math.min(Math.max(baseY + off.y, margin + h / 2), canvasH - margin - h / 2);
    const rect = {
      left: cx - w / 2 - margin,
      right: cx + w / 2 + margin,
      top: cy - h / 2 - margin,
      bottom: cy + h / 2 + margin
    };
    if (!allBlocked().some(r => labelRectsOverlap(rect, r))) {
      placedRects.push(rect);
      return { x: cx - w / 2, y: cy - h / 2 };
    }
  }

  // 피할 곳이 너무 많으면 화면 안쪽에 최대한 배치
  const cx = Math.min(Math.max(baseX, margin + w / 2), canvasW - margin - w / 2);
  const cy = Math.min(Math.max(baseY, margin + h / 2), canvasH - margin - h / 2);
  placedRects.push({
    left: cx - w / 2 - margin,
    right: cx + w / 2 + margin,
    top: cy - h / 2 - margin,
    bottom: cy + h / 2 + margin
  });
  return { x: cx - w / 2, y: cy - h / 2 };
}


function roundRect(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function drawSummaryLabels(ctx, sourceRows, projection, countRows = sourceRows) {
  const groups = new Map();

  // 위치는 현재 화면에 보이는 행 기준으로 잡고,
  // 매수는 6개 필터가 적용된 전체 결과의 계약번호 개수 기준으로 계산합니다.
  sourceRows.forEach(r => {
    const key = `${r.reader}||${r.bun}`;
    if (!groups.has(key)) groups.set(key, { reader:r.reader, bun:r.bun, count:0, contractSet:new Set(), latSum:0, lngSum:0, pointCount:0, color:getColorForRow(r), pattern:getReaderPatternForRow(r), bunLetter:getBunLetterForRow(r) });
    const g = groups.get(key);
    g.latSum += r.lat;
    g.lngSum += r.lng;
    g.pointCount += 1;
  });

  countRows.forEach(r => {
    const key = `${r.reader}||${r.bun}`;
    const g = groups.get(key);
    if (!g) return; // 현재 화면에 없는 조합은 표시하지 않음
    g.contractSet.add(normalize(r.contractNo) || `__row_${r.id}`);
  });

  groups.forEach(g => { g.count = g.contractSet.size; });

  // 중요: 표시창은 Canvas에서 마커를 모두 그린 뒤 마지막에 다시 그립니다.
  // 그래서 항상 마커 위에 올라오고, 카카오 지도/Canvas 레이어에 가려지지 않습니다.
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 13px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
  const placedLabelRects = [];
  const labelCanvasW = ctx.canvas.clientWidth || ctx.canvas.width;
  const labelCanvasH = ctx.canvas.clientHeight || ctx.canvas.height;

  // 표시창이 마커 위를 덮지 않도록 현재 화면의 마커 영역을 회피 대상으로 등록
  const markerBlockedRects = (visibleGroups || [])
    .filter(m => Number.isFinite(m.x) && Number.isFinite(m.y))
    .map(m => {
      const r = Math.max(12, (m.radius || 8) + 12);
      return { left: m.x - r, right: m.x + r, top: m.y - r, bottom: m.y + r };
    });

  [...groups.values()].sort((a,b)=>b.count-a.count).slice(0, MAX_SUMMARY_LABELS).forEach(g => {
    const pos = new kakao.maps.LatLng(g.latSum/g.pointCount, g.lngSum/g.pointCount);
    const pt = projection.containerPointFromCoords(pos);
    const text = `${g.reader || '-'} ${g.bun || '-'} ${g.count}`;
    const textW = ctx.measureText(text).width;
    const w = Math.max(112, textW + 52);
    const h = 28;
    const labelPos = findLabelPosition(pt.x, pt.y, w, h, placedLabelRects, labelCanvasW, labelCanvasH, markerBlockedRects);
    const x = labelPos.x;
    const y = labelPos.y;

    ctx.shadowColor = 'rgba(0,0,0,.20)';
    ctx.shadowBlur = 5;
    ctx.fillStyle = 'rgba(255,235,59,.92)';
    roundRect(ctx, x, y, w, h, 14);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(202,138,4,.55)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 14);
    ctx.stroke();

    // 표시창 왼쪽에는 해당 분구의 실제 마커를 축소 표시
    drawSummaryMarkerIcon(ctx, x + 15, y + h / 2, 9, g.pattern, g.bunLetter);

    ctx.fillStyle = '#111827';
    ctx.textAlign = 'left';
    ctx.fillText(text, x + 32, y + h / 2);
  });
  ctx.restore();
}

function showSummaryOverlays(sourceRows) {
  // 이전 DOM 오버레이 방식은 Canvas 레이어 아래에 깔릴 수 있어서 사용하지 않습니다.
  // 호환을 위해 함수만 남겨둡니다.
}

function showRoadviewAt(lat, lng, row=null) {
  if (!roadviewAutoEnabled) return;
  if (!roadview || !roadviewClient || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return;
  if (!roadviewVisible) setRoadviewPanelVisible(true);
  const position = new kakao.maps.LatLng(lat, lng);
  const titleParts = [];
  if (row) {
    if (row.reader) titleParts.push(`검침원 ${escapeHtml(row.reader)}`);
    if (row.meterDate) titleParts.push(`검침일 ${escapeHtml(row.meterDate)}`);
    if (row.bun) titleParts.push(`분구 ${escapeHtml(row.bun)}`);
  }
  $('roadviewTitle').innerHTML = titleParts.length ? titleParts.join(' · ') : '로드뷰';
  $('roadviewEmpty').style.display = 'flex';
  $('roadviewEmpty').innerHTML = '로드뷰 위치를 찾는 중입니다...';
  roadviewClient.getNearestPanoId(position, 80, function(panoId) {
    if (panoId) {
      roadview.setPanoId(panoId, position);
      setTimeout(() => { if (roadview) roadview.relayout(); }, 80);
      $('roadviewEmpty').style.display = 'none';
    } else {
      $('roadviewEmpty').style.display = 'flex';
      $('roadviewEmpty').innerHTML = '이 위치 주변에는 로드뷰가 없습니다.<br>지도에서 가까운 도로 쪽 마커를 선택해 주세요.';
    }
  });
}

function makeCustomerCardHtml(row, countText='') {
  return `<div class="customer-info-card">
    <button class="close-btn" onclick="closeInfo()" title="닫기">×</button>
    <b class="contract-no">${escapeHtml(row.contractNo || countText || '-')}</b>
    <div class="info-row"><span class="info-label">검침원</span><span class="info-value">${escapeHtml(row.reader || '-')}</span></div>
    <div class="info-row"><span class="info-label">검침일</span><span class="info-value">${escapeHtml(row.meterDate || '-')}</span></div>
    <div class="info-row"><span class="info-label">분구</span><span class="info-value">${escapeHtml(row.bun || '-')}</span></div>
    <div class="info-row"><span class="info-label">계약종별</span><span class="info-value">${escapeHtml(row.type || '-')}</span></div>
    <div class="info-row"><span class="info-label">계약전력</span><span class="info-value">${escapeHtml(row.power || '-')}</span></div>
    <div class="info-row"><span class="info-label">검침방법</span><span class="info-value">${escapeHtml(row.method || '-')}</span></div>
    <div class="address">${escapeHtml(row.address || '')}</div>
  </div>`;
}
function makeInfoContent(group) {
  const first = group.rows[0] || {};
  if (group.rows.length === 1) return makeCustomerCardHtml(first);

  const rowsHtml = group.rows.slice(0, 300).map(r => 
    `<div class="group-row">
      <b>${escapeHtml(r.contractNo || '-')}</b><br>
      검침원: ${escapeHtml(r.reader || '-')} / 검침일: ${escapeHtml(r.meterDate || '-')} / 분구: ${escapeHtml(r.bun || '-')}<br>
      <small>${escapeHtml(r.type || '-')} / ${escapeHtml(r.power || '-')} / ${escapeHtml(r.method || '-')}</small>
    </div>`
  ).join('');
  const extra = group.rows.length > 300 ? `<div class="group-row">외 ${group.rows.length - 300}건 생략</div>` : '';
  return `<div class="customer-info-card" style="max-width:430px;">
    <button class="close-btn" onclick="closeInfo()" title="닫기">×</button>
    <b class="contract-no">동일 위치 ${group.rows.length}건</b>
    <div class="address">${escapeHtml(first.address || '')}</div>
    <div class="group-list">${rowsHtml}${extra}</div>
  </div>`;
}

function onMapClick(mouseEvent) {
  if (!visibleGroups.length) return;
  const p = map.getProjection().containerPointFromCoords(mouseEvent.latLng);
  let best = null, bestD = Infinity;
  for (const g of visibleGroups) {
    if (g.x === undefined) continue;
    const dx = g.x - p.x, dy = g.y - p.y, d = dx*dx + dy*dy;
    const hit = Math.max(6, g.radius + 6);
    if (d <= hit*hit && d < bestD) { best = g; bestD = d; }
  }
  if (!best) return closeInfo();
  if (openedGroupKey === best.key) return closeInfo();
  closeInfo();
  openedGroupKey = best.key;
  showFloatingInfoPanel(best);
  showRoadviewAt(best.lat, best.lng, best.rows && best.rows[0]);
}
function renderList(sourceRows = null) {
  const list = (sourceRows || filteredRows || []).slice(0, 500);
  $('resultList').innerHTML = list.map(r => `<div class="item" data-id="${r.id}"><span class="badge">${escapeHtml(r.reader||'-')}</span><span class="badge">${escapeHtml(r.meterDate||'-')}</span><span class="badge">${escapeHtml(r.bun||'-')}</span><br><b>${escapeHtml(r.contractNo)}</b><br>${escapeHtml(r.address)}<br><small>${escapeHtml(r.type||'-')} / ${escapeHtml(r.power||'-')} / ${escapeHtml(r.method||'-')} · 상태: ${r.status}</small></div>`).join('');
  document.querySelectorAll('.item').forEach(el => el.addEventListener('click', () => {
    const r = rows.find(x => x.id === +el.dataset.id); if (!r || !r.lat || !r.lng || !map) return;
    map.setCenter(new kakao.maps.LatLng(r.lat, r.lng));
    map.setLevel(3);
    const group = { key: makeGroupKey(r), lat: r.lat, lng: r.lng, rows: [r] };
    openedGroupKey = group.key;
    showFloatingInfoPanel(group);
    showRoadviewAt(r.lat, r.lng, r);
    requestDraw();
  }));
}

// 카카오 지도 타일은 브라우저 캡처 시 흰색으로 빠질 수 있어,
// PNG 출력 전용으로 OpenStreetMap 배경 타일을 새로 그립니다.
function lonLatToWorldPixel(lng, lat, zoom) {
  const sinLat = Math.sin(lat * Math.PI / 180);
  const n = Math.pow(2, zoom) * 256;
  const x = (lng + 180) / 360 * n;
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n;
  return { x, y };
}
function worldPixelToLonLat(x, y, zoom) {
  const n = Math.pow(2, zoom) * 256;
  const lng = x / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  const lat = latRad * 180 / Math.PI;
  return { lat, lng };
}
function kakaoLevelToOsmZoom(level) {
  // 카카오 레벨은 숫자가 작을수록 확대, OSM zoom은 숫자가 클수록 확대
  return Math.max(7, Math.min(18, 18 - Number(level || 6)));
}
function loadTileImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
function drawOsmMarker(ctx, x, y, size, pattern, count, bunLetter='') {
  drawMarker(ctx, x, y, size, pattern, count, bunLetter);
}

function makeDownload(canvas, prefix) {
  const a = document.createElement('a');
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  a.download = `${prefix}_${stamp}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
}
function getFilterSummaryText() {
  const parts = [];
  const mapNames = [
    ['readerFilter', '검침원'],
    ['dateFilter', '검침일'],
    ['bunFilter', '분구'],
    ['typeFilter', '계약종별'],
    ['powerFilter', '계약전력'],
    ['methodFilter', '계약검침방법']
  ];
  mapNames.forEach(([id, label]) => {
    const vals = getSelectedValues(id);
    if (vals.length) parts.push(`${label}: ${vals.slice(0, 8).join(', ')}${vals.length > 8 ? ' 외' : ''}`);
  });
  const q = normalize($('searchInput').value);
  if (q) parts.push(`검색: ${q}`);
  return parts.length ? parts.join(' / ') : '전체';
}
async function exportOsmReportPng() {
  if (!rows.length) return setMsg('엑셀 데이터를 먼저 업로드해 주세요.', true);

  const targetRows = getFilteredRows().filter(r => r.lat && r.lng);
  if (!targetRows.length) return setMsg('현재 필터 조건에 맞는 좌표 데이터가 없습니다.', true);

  // 현재 카카오 확대 수준을 OSM 줌으로 변환
  const zoom = kakaoLevelToOsmZoom(map && map.getLevel ? map.getLevel() : 6);
  const markerSize = Math.max(2, 13 * markerSizePercent / 100);

  const points = targetRows.map(r => {
    const p = lonLatToWorldPixel(r.lng, r.lat, zoom);
    return { ...p, row: r };
  });

  let minX = Math.min(...points.map(p => p.x));
  let maxX = Math.max(...points.map(p => p.x));
  let minY = Math.min(...points.map(p => p.y));
  let maxY = Math.max(...points.map(p => p.y));

  const padding = 260;
  minX -= padding; maxX += padding; minY -= padding; maxY += padding;

  let outW = Math.ceil(maxX - minX);
  let outH = Math.ceil(maxY - minY);

  // 너무 큰 이미지는 브라우저가 실패할 수 있어 최대 크기 제한
  const maxSide = 9000;
  let scale = 1;
  if (outW > maxSide || outH > maxSide) {
    scale = Math.min(maxSide / outW, maxSide / outH);
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(800, Math.ceil(outW * scale));
  canvas.height = Math.max(600, Math.ceil(outH * scale));
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tileMinX = Math.floor(minX / 256);
  const tileMaxX = Math.floor(maxX / 256);
  const tileMinY = Math.floor(minY / 256);
  const tileMaxY = Math.floor(maxY / 256);
  const totalTiles = (tileMaxX - tileMinX + 1) * (tileMaxY - tileMinY + 1);

  if (totalTiles > 220) {
    const ok = confirm(`출력용 배경지도 타일 ${totalTiles}장을 불러와야 합니다.\n시간이 걸릴 수 있습니다. 계속 진행할까요?`);
    if (!ok) return;
  }

  setMsg(`출력용 배경지도 생성 중... 타일 0 / ${totalTiles}`);

  let done = 0;
  for (let tx = tileMinX; tx <= tileMaxX; tx++) {
    for (let ty = tileMinY; ty <= tileMaxY; ty++) {
      const url = `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
      const img = await loadTileImage(url);
      const dx = Math.round((tx * 256 - minX) * scale);
      const dy = Math.round((ty * 256 - minY) * scale);
      const ds = Math.ceil(256 * scale);
      if (img) ctx.drawImage(img, dx, dy, ds, ds);
      else {
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(dx, dy, ds, ds);
      }
      done++;
      if (done % 10 === 0 || done === totalTiles) {
        setMsg(`출력용 배경지도 생성 중... 타일 ${done} / ${totalTiles}`);
        await sleep(1);
      }
    }
  }

  // 동일 좌표 그룹으로 마커 출력
  const markerGroups = new Map();
  targetRows.forEach(r => {
    const key = `${Number(r.lat).toFixed(7)}||${Number(r.lng).toFixed(7)}`;
    if (!markerGroups.has(key)) markerGroups.set(key, { lat: r.lat, lng: r.lng, rows: [] });
    markerGroups.get(key).rows.push(r);
  });

  [...markerGroups.values()].forEach(g => {
    const wp = lonLatToWorldPixel(g.lng, g.lat, zoom);
    const x = (wp.x - minX) * scale;
    const y = (wp.y - minY) * scale;
    const first = g.rows[0];
    drawOsmMarker(ctx, x, y, Math.max(2, markerSize * scale), getReaderPatternForRow(first), g.rows.length, getBunLetterForRow(first));
  });

  // 요약 표시창 출력
  if (showSummaryLabels) {
    const groups = new Map();
    targetRows.forEach(r => {
      const key = `${r.reader}||${r.bun}`;
      if (!groups.has(key)) groups.set(key, { reader: r.reader, bun: r.bun, latSum: 0, lngSum: 0, pointCount: 0, contracts: new Set(), color: getColorForRow(r), pattern: getReaderPatternForRow(r), bunLetter: getBunLetterForRow(r) });
      const g = groups.get(key);
      g.latSum += r.lat;
      g.lngSum += r.lng;
      g.pointCount++;
      g.contracts.add(normalize(r.contractNo) || `__row_${r.id}`);
    });

    ctx.save();
    ctx.font = `bold ${Math.max(11, 13 * scale)}px system-ui`;
    ctx.textBaseline = 'middle';
    const placedExportLabelRects = [];
    const exportMarkerBlockedRects = [...markerGroups.values()].map(g => {
      const wp = lonLatToWorldPixel(g.lng, g.lat, zoom);
      const mx = (wp.x - minX) * scale;
      const my = (wp.y - minY) * scale;
      const r = Math.max(10 * scale, markerSize * scale + 10 * scale);
      return { left: mx - r, right: mx + r, top: my - r, bottom: my + r };
    });

    [...groups.values()].sort((a, b) => b.contracts.size - a.contracts.size).slice(0, MAX_SUMMARY_LABELS).forEach(g => {
      const wp = lonLatToWorldPixel(g.lngSum / g.pointCount, g.latSum / g.pointCount, zoom);
      const x0 = (wp.x - minX) * scale;
      const y0 = (wp.y - minY) * scale;
      const text = `${g.reader || '-'} ${g.bun || '-'} ${g.contracts.size}`;
      const tw = ctx.measureText(text).width;
      const w = Math.max(112 * scale, tw + 52 * scale);
      const h = 28 * scale;
      const labelPos = findLabelPosition(x0, y0, w, h, placedExportLabelRects, canvas.width, canvas.height, exportMarkerBlockedRects);
      const x = labelPos.x;
      const y = labelPos.y;

      ctx.shadowColor = 'rgba(0,0,0,.20)';
      ctx.shadowBlur = 5 * scale;
      ctx.fillStyle = 'rgba(255,235,59,.92)';
      roundRect(ctx, x, y, w, h, 14 * scale);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(202,138,4,.55)';
      ctx.lineWidth = Math.max(1, scale);
      roundRect(ctx, x, y, w, h, 14 * scale);
      ctx.stroke();

      drawSummaryMarkerIcon(ctx, x + 15 * scale, y + h / 2, 9 * scale, g.pattern, g.bunLetter);

      ctx.fillStyle = '#111827';
      ctx.textAlign = 'left';
      ctx.fillText(text, x + 32 * scale, y + h / 2);
    });
    ctx.restore();
  }

  // 상단 정보 박스
  const boxH = 86;
  const overlay = document.createElement('canvas');
  overlay.width = canvas.width;
  overlay.height = canvas.height + boxH;
  const octx = overlay.getContext('2d');
  octx.fillStyle = '#ffffff';
  octx.fillRect(0, 0, overlay.width, overlay.height);
  octx.fillStyle = '#111827';
  octx.font = 'bold 24px system-ui';
  octx.fillText('검침업무 GIS 분석시스템 v1.0', 24, 34);
  octx.font = '13px system-ui';
  octx.fillStyle = '#374151';
  const filterText = getFilterSummaryText();
  octx.fillText(`필터: ${filterText}`, 24, 58);
  octx.fillText(`계약번호: ${countContracts(targetRows).toLocaleString()}건 · 출력: ${new Date().toLocaleString()} · 배경지도: OpenStreetMap`, 24, 78);
  octx.drawImage(canvas, 0, boxH);

  makeDownload(overlay, 'meter_gis_osm_report');
  setMsg(`출력용 PNG 저장 완료: ${overlay.width.toLocaleString()} × ${overlay.height.toLocaleString()}px<br>카카오 캡처 제한을 피하기 위해 OpenStreetMap 배경으로 저장했습니다.`);
}
if ($('osmReportCaptureBtn')) {
  $('osmReportCaptureBtn').addEventListener('click', exportOsmReportPng);
}



function resizeMemoCanvas() {
  const canvas = $('memoCanvas');
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.floor(rect.width * dpr));
  const h = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { canvas, ctx, width: rect.width, height: rect.height };
}
function setMemoMode(mode) {
  memoMode = mode;
  const mapWrap = document.querySelector('.mapWrap');
  if (mapWrap) mapWrap.classList.toggle('memo-on', mode !== 'off');
  $('toggleMemoDrawBtn').textContent = mode === 'draw' ? '메모 그리기 끄기' : '메모 그리기 켜기';
  $('memoEraseBtn').textContent = mode === 'erase' ? '메모 지우개 끄기' : '메모 지우개 켜기';
  $('memoTextBtn').textContent = mode === 'text' ? '텍스트 메모 대기 중' : '텍스트 메모 추가';
}
function containerPointToLatLng(x, y) {
  if (!map) return null;
  return map.getProjection().coordsFromContainerPoint(new kakao.maps.Point(x, y));
}
function latLngToContainerPoint(lat, lng) {
  if (!map) return null;
  return map.getProjection().containerPointFromCoords(new kakao.maps.LatLng(lat, lng));
}
function getMemoMousePoint(e) {
  const canvas = $('memoCanvas');
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
function drawMemoLayer() {
  const res = resizeMemoCanvas();
  if (!res || !map) return;
  const { ctx, width, height } = res;
  ctx.clearRect(0, 0, width, height);

  memoItems.forEach(item => {
    if (item.type === 'path') {
      if (!item.points || item.points.length < 2) return;
      ctx.save();
      ctx.strokeStyle = item.color || '#dc2626';
      ctx.lineWidth = item.width || 4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      item.points.forEach((p, i) => {
        const pt = latLngToContainerPoint(p.lat, p.lng);
        if (!pt) return;
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();
      ctx.restore();
    } else if (item.type === 'text') {
      const pt = latLngToContainerPoint(item.lat, item.lng);
      if (!pt) return;
      ctx.save();
      ctx.font = `bold ${item.size || 16}px system-ui`;
      ctx.textBaseline = 'top';
      const padding = 5;
      const metrics = ctx.measureText(item.text);
      const boxW = metrics.width + padding * 2;
      const boxH = (item.size || 16) + padding * 2;
      ctx.fillStyle = 'rgba(255,255,255,.86)';
      roundRect(ctx, pt.x - padding, pt.y - padding, boxW, boxH, 6);
      ctx.fill();
      ctx.fillStyle = item.color || '#111827';
      ctx.fillText(item.text, pt.x, pt.y);
      ctx.restore();
    }
  });
}
function distancePointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function eraseMemoAt(x, y) {
  const eraserSize = Math.max(12, Number($('memoWidth').value || 4) * 4);
  let removed = false;

  memoItems = memoItems.filter(item => {
    if (item.type === 'text') {
      const pt = latLngToContainerPoint(item.lat, item.lng);
      if (!pt) return true;
      const hit = Math.hypot(pt.x - x, pt.y - y) <= eraserSize * 1.5;
      if (hit) removed = true;
      return !hit;
    }
    if (item.type === 'path') {
      const pts = item.points.map(p => latLngToContainerPoint(p.lat, p.lng)).filter(Boolean);
      for (let i = 1; i < pts.length; i++) {
        if (distancePointToSegment(x, y, pts[i-1].x, pts[i-1].y, pts[i].x, pts[i].y) <= eraserSize) {
          removed = true;
          return false;
        }
      }
    }
    return true;
  });
  if (removed) drawMemoLayer();
}
function initMemoLayer() {
  if (memoInitialized) return;
  memoInitialized = true;
  const canvas = $('memoCanvas');
  if (!canvas) return;

  canvas.addEventListener('wheel', e => {
    canvas.style.pointerEvents = 'none';
    const ev = new WheelEvent('wheel', {
      deltaX: e.deltaX, deltaY: e.deltaY, deltaZ: e.deltaZ,
      clientX: e.clientX, clientY: e.clientY,
      bubbles: true, cancelable: true
    });
    $('map').dispatchEvent(ev);
    setTimeout(() => {
      if (memoMode !== 'off') canvas.style.pointerEvents = 'auto';
    }, 50);
  }, { passive: true });

  canvas.addEventListener('mousedown', e => {
    if (memoMode === 'off') return;
    const p = getMemoMousePoint(e);
    if (memoMode === 'draw') {
      const ll = containerPointToLatLng(p.x, p.y);
      if (!ll) return;
      currentMemoPath = {
        type: 'path',
        color: $('memoColor').value || '#dc2626',
        width: Number($('memoWidth').value || 4),
        points: [{ lat: ll.getLat(), lng: ll.getLng() }]
      };
      memoItems.push(currentMemoPath);
      drawMemoLayer();
    } else if (memoMode === 'erase') {
      eraseMemoAt(p.x, p.y);
    } else if (memoMode === 'text') {
      const text = prompt('지도에 표시할 메모를 입력하세요.');
      if (text) {
        const ll = containerPointToLatLng(p.x, p.y);
        if (ll) {
          memoItems.push({
            type: 'text',
            text,
            lat: ll.getLat(),
            lng: ll.getLng(),
            color: $('memoColor').value || '#111827',
            size: Math.max(12, Number($('memoWidth').value || 4) * 4)
          });
          drawMemoLayer();
        }
      }
      setMemoMode('off');
    }
  });

  canvas.addEventListener('mousemove', e => {
    if (memoMode === 'draw' && currentMemoPath) {
      const p = getMemoMousePoint(e);
      const ll = containerPointToLatLng(p.x, p.y);
      if (!ll) return;
      currentMemoPath.points.push({ lat: ll.getLat(), lng: ll.getLng() });
      drawMemoLayer();
    } else if (memoMode === 'erase' && e.buttons === 1) {
      const p = getMemoMousePoint(e);
      eraseMemoAt(p.x, p.y);
    }
  });

  window.addEventListener('mouseup', () => {
    currentMemoPath = null;
  });

  $('toggleMemoDrawBtn').addEventListener('click', () => {
    setMemoMode(memoMode === 'draw' ? 'off' : 'draw');
  });
  $('memoTextBtn').addEventListener('click', () => {
    setMemoMode(memoMode === 'text' ? 'off' : 'text');
  });
  $('memoEraseBtn').addEventListener('click', () => {
    setMemoMode(memoMode === 'erase' ? 'off' : 'erase');
  });
  $('memoUndoBtn').addEventListener('click', () => {
    memoItems.pop();
    drawMemoLayer();
  });
  $('memoClearBtn').addEventListener('click', () => {
    if (confirm('지도 메모를 모두 삭제할까요?')) {
      memoItems = [];
      drawMemoLayer();
    }
  });

  setMemoMode('off');
  drawMemoLayer();
}


window.addEventListener('resize', () => { if (map) { map.relayout(); if (roadview) roadview.relayout(); requestDraw(); drawMemoLayer(); } });
