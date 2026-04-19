/**
 * MCK Progress Bridge — Cloudflare Worker
 *
 * Endpoints:
 *   POST /         — przyjmuje JSON z Tampermonkey, zapisuje w KV
 *   GET  /         — serwuje stronę dashboard (do osadzenia na Google Sites / Notion / wszędzie)
 *   GET  /?data=1  — zwraca ostatnio zapisane dane jako JSON (używane przez dashboard)
 *
 * Wymagane:
 *   KV Namespace o nazwie "PROGRESS_KV" powiązany z Workerem (patrz README).
 *
 * Opcjonalne zabezpieczenie:
 *   W zmiennej środowiskowej "SECRET" ustaw dowolny token.
 *   Tampermonkey musi wtedy wysyłać nagłówek:  X-Secret: <twój-token>
 *   Jeśli SECRET nie jest ustawiony, endpoint jest otwarty.
 */

const KV_KEY = 'mck_progress';

// ─── Routing ─────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS — dashboard odpytuje endpoint z tego samego workera, ale
    // Sites embed działa z innego origin, więc potrzebujemy CORS.
    const corsHeaders = {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Secret',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // POST — zapis danych z Tampermonkey
    if (method === 'POST') {
      return handlePost(request, env, corsHeaders);
    }

    // GET /?data=1 — zwróć JSON z KV
    if (url.searchParams.has('data')) {
      return handleGetData(env, corsHeaders);
    }

    // GET / — serwuj stronę dashboard
    return new Response(dashboardHTML(request.url), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        ...corsHeaders,
      },
    });
  },
};

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handlePost(request, env, corsHeaders) {
  // Opcjonalne sprawdzenie tokenu
  if (env.SECRET) {
    const header = request.headers.get('X-Secret') || '';
    if (header !== env.SECRET) {
      return jsonResponse({ ok: false, error: 'Unauthorized' }, 401, corsHeaders);
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400, corsHeaders);
  }

  const stored = {
    today:     body.today     || { pack: '0', bpp: '0', pick: '0' },
    yesterday: body.yesterday || { pack: '0', bpp: '0', pick: '0' },
    dby:       body.dby       || { pack: '0', bpp: '0', pick: '0' },
    updatedAt: new Date().toISOString(),
  };

  // KV: zapis z TTL 48 h (dane nigdy nie są starsze niż 2 dni)
  await env.PROGRESS_KV.put(KV_KEY, JSON.stringify(stored), {
    expirationTtl: 60 * 60 * 48,
  });

  return jsonResponse({ ok: true, updatedAt: stored.updatedAt }, 200, corsHeaders);
}

async function handleGetData(env, corsHeaders) {
  const raw = await env.PROGRESS_KV.get(KV_KEY);
  if (!raw) {
    return jsonResponse({ ok: false, error: 'No data yet' }, 404, corsHeaders);
  }
  return jsonResponse({ ok: true, data: JSON.parse(raw) }, 200, corsHeaders);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(payload, status = 200, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extra,
    },
  });
}

// ─── Embedded dashboard HTML ─────────────────────────────────────────────────

function dashboardHTML(workerUrl) {
  // Strip query params to get the clean base URL
  const baseUrl = workerUrl.split('?')[0];

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MCK Progress</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0c;color:#fff;font-family:'Segoe UI',Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px}
h1{font-size:14px;font-weight:800;color:#ffcf70;letter-spacing:.6px;margin-bottom:14px;text-transform:uppercase;text-align:center}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:100%;max-width:680px}
.card{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 10px}
.card-title{text-align:center;font-size:13px;font-weight:800;color:#ffcf70;letter-spacing:.5px;margin-bottom:10px}
.rows{display:grid;gap:6px}
.row{display:grid;grid-template-columns:52px 1fr;gap:6px;align-items:center}
.label{font-size:10px;font-weight:700;color:rgba(255,255,255,.6);text-transform:uppercase}
.value{height:28px;display:flex;align-items:center;justify-content:flex-end;padding:0 10px;border-radius:8px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);font-size:14px;font-weight:800;cursor:pointer;user-select:none;transition:.14s}
.value:hover{background:rgba(255,166,0,.12);border-color:rgba(255,166,0,.55)}
.value.all{background:rgba(255,166,0,.06);border-color:rgba(255,166,0,.18);color:#ffd27a}
.value.all:hover{background:rgba(255,166,0,.18);border-color:rgba(255,166,0,.7)}
.footer{margin-top:12px;display:flex;align-items:center;justify-content:space-between;width:100%;max-width:680px;gap:10px}
.status{font-size:11px;color:rgba(255,255,255,.5);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btn{flex:0 0 auto;height:28px;padding:0 14px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#fff;font-size:12px;font-weight:800;cursor:pointer;transition:.14s}
.btn:hover{background:rgba(255,166,0,.14);border-color:rgba(255,166,0,.6)}
.toast{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:rgba(255,153,0,.14);border:1px solid rgba(255,153,0,.7);color:#fff;padding:7px 14px;border-radius:8px;font-size:12px;font-weight:700;opacity:0;transition:opacity .16s;pointer-events:none;white-space:nowrap;z-index:9999}
@media(max-width:460px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<h1>MCK Progress</h1>
<div class="grid">
  <div class="card">
    <div class="card-title">PACK</div>
    <div class="rows">
      <div class="row"><div class="label">Today</div><div class="value" data-k="today:pack">—</div></div>
      <div class="row"><div class="label">Yest</div> <div class="value" data-k="yesterday:pack">—</div></div>
      <div class="row"><div class="label">DBY</div>  <div class="value" data-k="dby:pack">—</div></div>
      <div class="row"><div class="label">All</div>  <div class="value all" data-k="all:pack">—</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">BPP</div>
    <div class="rows">
      <div class="row"><div class="label">Today</div><div class="value" data-k="today:bpp">—</div></div>
      <div class="row"><div class="label">Yest</div> <div class="value" data-k="yesterday:bpp">—</div></div>
      <div class="row"><div class="label">DBY</div>  <div class="value" data-k="dby:bpp">—</div></div>
      <div class="row"><div class="label">All</div>  <div class="value all" data-k="all:bpp">—</div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-title">PICK</div>
    <div class="rows">
      <div class="row"><div class="label">Today</div><div class="value" data-k="today:pick">—</div></div>
      <div class="row"><div class="label">Yest</div> <div class="value" data-k="yesterday:pick">—</div></div>
      <div class="row"><div class="label">DBY</div>  <div class="value" data-k="dby:pick">—</div></div>
      <div class="row"><div class="label">All</div>  <div class="value all" data-k="all:pick">—</div></div>
    </div>
  </div>
</div>
<div class="footer">
  <div class="status" id="status">Ładowanie…</div>
  <button class="btn" id="refreshBtn">Odśwież</button>
</div>
<div class="toast" id="toast"></div>
<script>
const DATA_URL = '${baseUrl}?data=1';
const POLL_MS  = 60000;
let timer = null;

function num(v){ return parseInt(String(v||'0').replace(/,/g,''),10)||0; }
function sum(a,b,c){ return (num(a)+num(b)+num(c)).toLocaleString(); }

function set(key, val){
  const el = document.querySelector('[data-k="'+key+'"]');
  if(el) el.textContent = val||'0';
}

function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._t); t._t=setTimeout(()=>{t.style.opacity='0';},1400);
}

function copy(text){
  const clean=String(text).replace(/,/g,'');
  if(!clean||clean==='0'||clean==='—') return;
  navigator.clipboard?.writeText(clean).then(()=>toast('Skopiowano: '+clean)).catch(()=>toast('Błąd kopiowania'));
}

function render(d){
  ['pack','bpp','pick'].forEach(t=>{
    ['today','yesterday','dby'].forEach(g=>{ set(g+':'+t, d[g]&&d[g][t]); });
    set('all:'+t, sum(d.today&&d.today[t], d.yesterday&&d.yesterday[t], d.dby&&d.dby[t]));
  });
  const ts = new Date(d.updatedAt);
  document.getElementById('status').textContent =
    'Aktualizacja: '+(isNaN(ts)?'?':ts.toLocaleTimeString('pl-PL'));
}

async function load(feedback){
  try{
    const r = await fetch(DATA_URL,{cache:'no-store'});
    const j = await r.json();
    if(!j.ok){ document.getElementById('status').textContent='Brak danych — uruchom skrypt.'; return; }
    render(j.data);
    if(feedback) toast('Odświeżono');
  } catch(e){
    document.getElementById('status').textContent='Błąd: '+e.message;
  }
}

document.getElementById('refreshBtn').addEventListener('click',()=>load(true));
document.querySelectorAll('.value').forEach(el=>el.addEventListener('click',()=>copy(el.textContent)));

load(false);
timer = setInterval(()=>load(false), POLL_MS);
</script>
</body>
</html>`;
}
