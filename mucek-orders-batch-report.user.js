// ==UserScript==
// @name         [MCK] Orders Batch Report / Volume Predictor
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  Volume Predictor + Collation (Courier/NDTS/INT) with pill alignment fix. Adds Monday Courier & Sat Cou visible only on Saturdays. On Saturdays the column min-width is reduced so the grid doesn't spill. Collation (orders & items) follows Saturday formula when datepicker is Saturday: Courier + Courier Sunday - Depot 33 - Sale. STS/Sale brane z prawej karty aktywnego taba (kolumna ITEMS, nie %). Collation Courier: odejmuje Evri + Sale (Orders i Items) i kopiuje jako formuły (=Orig-Evri-Sale) otherwise.
// @author       Mucek & Pak
// @match        https://pon-wpws27/Whds.Dashboard.Web/reports/OrdersBatchReport*
// @grant        GM_setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY_COLLAPSE = 'mucek_bottom_bar_collapsed';

  // --- Twoje stare selektory (fallback) ---
  const STS_RIGHT_SELECTOR  = '#mat-tab-content-1-9 > div > div > div > mat-card:nth-child(6) > app-section-card:nth-child(3) > mat-table > mat-row:nth-child(6) > mat-cell.cdk-column-items.mat-column-items span';
  const SALE_RIGHT_SELECTOR = '#mat-tab-content-1-9 > div > div > div > mat-card:nth-child(6) > app-section-card:nth-child(3) > mat-table > mat-row:nth-child(5) > mat-cell.cdk-column_items.mat-column_items span, ' +
                              '#mat-tab-content-1-9 > div > div > div > mat-card:nth-child(6) > app-section-card:nth-child(3) > mat-table > mat-row:nth-child(5) > mat-cell.cdk-column-items.mat-column-items span';

  function onReady(fn) {
    if (document.readyState === 'complete' || document.readyState === 'interactive') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  onReady(() => {
    const fa = document.createElement('link');
    fa.rel = 'stylesheet';
    fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    document.head.appendChild(fa);

    // Insert new columns: Monday Courier between Stated and NDTS,
    // and Sat Cou between STS minus and E3 Gen
    const columns = [
      'Actual','Actual Minus','Stated','Monday Courier','NDTS','Int','DPD','B/H',
      'Retail Total','GAP online','Joules online','JMB online',
      'VS online','Fat Face Online','STS','Sale','Stores','STS minus','Sat Cou','E3 Gen'
    ];

    // Actual Minus ma detail box
    const DETAIL_COLS = new Set(['Actual', 'Actual Minus', 'Stated', 'STS minus', 'E3 Gen']);

    const values = {};
    columns.forEach(c => values[c] = '0');

    let copyMainBtn, copyCollBtn, refreshBtn, hideBtn;

    // Variables for main formulas (kept from original)
    let lastActualRawOriginal   = 0;
    let lastStoresRaw           = 0;
    let lastStatedRawOriginal   = 0;
    let lastEvriRaw             = 0; // Evri Items
    let lastSaleRaw             = 0; // Sale Items
    let lastE3Part1             = 0;
    let lastE3Part2             = 0;
    let lastE3Part3             = 0;

    // Collation
    let lastEvriOrdersRaw       = 0; // Evri Orders
    let lastSaleOrdersRaw       = 0; // Sale Orders (jeśli brak -> 0)
    let lastCourierOrdersOrig   = 0;
    let lastCourierItemsOrig    = 0;

    // Additional fields for Saturday logic (orders + items for courier sunday & depot33)
    let lastCourierSundayItemsRaw  = 0;
    let lastCourierSundayOrdersRaw = 0;
    let lastDepot33ItemsRaw        = 0;
    let lastDepot33OrdersRaw       = 0;
    let lastCourierItemsRaw        = 0; // courier items (orig)

    // ==== HTML paska ====
    const bar = document.createElement('div');
    bar.id = 'mucek-bottom-bar';

    const colHtml = columns.map(name => {
      return `
        <div class="mucek-col" data-mucek-col="${name}">
          <div class="mucek-col-name">${name}</div>
          <div class="mucek-col-value" data-mucek-name="${name}">0</div>
        </div>`;
    }).join('');

    // detail boxes - only for DETAIL_COLS. include data-col attribute so we can toggle visibility
    const detailHtml = columns.map(name => {
      if (!DETAIL_COLS.has(name)) return `<div class="mucek-detail-spacer"></div>`;

      let id = '';
      if (name === 'Actual') id = 'mucek-detail-actual';
      if (name === 'Actual Minus') id = 'mucek-detail-actualminus';
      if (name === 'Stated') id = 'mucek-detail-stated';
      if (name === 'STS minus') id = 'mucek-detail-stsminus';
      if (name === 'E3 Gen') id = 'mucek-detail-e3';

      // attach both id and data-col for easy lookup
      return `<div id="${id}" data-col="${name}" class="mucek-detail-box"></div>`;
    }).join('');

    bar.innerHTML = `
      <div id="mucek-topbar">
        <div id="mucek-topbar-left">
          <div class="mucek-brand-dot"></div>
          <span class="mucek-topbar-title">MCK <span class="mucek-topbar-accent">STATYSTYKI</span></span>
          <div class="mucek-legend" title="Niebieskie kolumny pokazują wartość przed odliczeniem">
            <i class="fa-solid fa-circle-info mucek-legend-ico"></i>
            <span class="mucek-legend-text">Niebieskie = wartość oryginalna (przed odliczeniem)</span>
          </div>
        </div>
        <div id="mucek-topbar-right">
          <button id="mucek-refresh" title="Odśwież / Run">
            <i class="fa-solid fa-rotate-right"></i><span class="mucek-tbtn-label">Odśwież</span>
          </button>
          <button id="mucek-min" title="Minimalizuj">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        </div>
      </div>

      <div id="mucek-bottom-bar-inner">

        <div id="mucek-panels">
          <div class="mucek-panel mucek-panel-top" id="mucek-panel-volume">
            <div class="mucek-panel-header">
              <span class="mucek-panel-title"><i class="fa-solid fa-chart-bar" style="margin-right:5px;color:#e07b39;"></i>Volume Predictor</span>
              <button class="mucek-copy-btn" id="mucek-copy-main" title="Kopiuj Volume Predictor">
                <i class="fa-solid fa-copy"></i><span class="mucek-btn-label"> Kopiuj</span>
              </button>
            </div>
            <div class="mucek-panel-body">
              <div id="mucek-cols-wrapper">${colHtml}</div>
              <div id="mucek-detail-grid">${detailHtml}</div>
            </div>
          </div>

          <div class="mucek-panel mucek-panel-bottom">
            <div class="mucek-panel-header">
              <span class="mucek-panel-title"><i class="fa-solid fa-layer-group" style="margin-right:5px;color:#e07b39;"></i>Collation</span>
              <button class="mucek-copy-btn" id="mucek-copy-collation" title="Kopiuj Collation">
                <i class="fa-solid fa-copy"></i><span class="mucek-btn-label"> Kopiuj</span>
              </button>
            </div>
            <div class="mucek-panel-body">
              <div id="mucek-collation-cols">

                <div class="mucek-coll-group">
                  <div class="mucek-coll-group-title">Courier</div>
                  <div class="mucek-coll-cells">
                    <div class="mucek-coll-cell">
                      <div class="mucek-coll-label">Orders</div>
                      <div id="mucek-extra-courier-orders" class="mucek-coll-value">0</div>
                    </div>
                    <div class="mucek-coll-cell">
                      <div class="mucek-coll-label">Items</div>
                      <div id="mucek-extra-courier-items" class="mucek-coll-value">0</div>
                    </div>
                    <div class="mucek-coll-cell">
                      <div class="mucek-coll-label">Collation</div>
                      <div id="mucek-extra-courier-collation" class="mucek-coll-value"></div>
                    </div>
                  </div>
                </div>

                <div class="mucek-coll-group">
                  <div class="mucek-coll-group-title">NDTS</div>
                  <div class="mucek-coll-cells">
                    <div class="mucek-coll-cell">
                      <div class="mucek-coll-label">Orders</div>
                      <div id="mucek-extra-ndd-orders" class="mucek-coll-value">0</div>
                    </div>
                    <div class="mucek-coll-cell">
                      <div class="mucek-coll-label">Items</div>
                      <div id="mucek-extra-ndd-items" class="mucek-coll-value">0</div>
                    </div>
                    <div class="mucek-coll-cell">
                      <div class="mucek-coll-label">Collation</div>
                      <div id="mucek-extra-ndd-collation" class="mucek-coll-value"></div>
                    </div>
                  </div>
                </div>

                <div class="mucek-coll-group">
                  <div class="mucek-coll-group-title">INT</div>
                  <div class="mucek-coll-cells">
                    <div class="mucek-coll-cell">
                      <div class="mucek-coll-label">Orders</div>
                      <div id="mucek-extra-int-orders" class="mucek-coll-value">0</div>
                    </div>
                    <div class="mucek-coll-cell">
                      <div class="mucek-coll-label">Items</div>
                      <div id="mucek-extra-int-items" class="mucek-coll-value">0</div>
                    </div>
                    <div class="mucek-coll-cell">
                      <div class="mucek-coll-label">Collation</div>
                      <div id="mucek-extra-int-collation" class="mucek-coll-value"></div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        </div>

      </div>

      <div id="mucek-mini">
        <div class="mucek-mini-block">
          <div class="mucek-mini-title">Volume Predictor</div>
          <button class="mucek-copy-btn mucek-mini-copy" id="mucek-mini-copy-main" title="Kopiuj Volume Predictor">
            <i class="fa-solid fa-copy"></i><span class="mucek-btn-label"> Kopiuj</span>
          </button>
        </div>
        <div class="mucek-mini-block">
          <div class="mucek-mini-title">Collation</div>
          <button class="mucek-copy-btn mucek-mini-copy" id="mucek-mini-copy-collation" title="Kopiuj Collation">
            <i class="fa-solid fa-copy"></i><span class="mucek-btn-label"> Kopiuj</span>
          </button>
        </div>
        <button id="mucek-mini-refresh" title="Odśwież">
          <i class="fa-solid fa-rotate-right"></i>
        </button>
        <button id="mucek-mini-min" title="Rozwiń">
          <i class="fa-solid fa-chevron-up"></i>
        </button>
      </div>
    `;

    document.body.appendChild(bar);

    // ==== STYLE ====
    const style = document.createElement('style');
    style.textContent = `
      :root{
        --mucek-col-min: 80px;
        --mucek-gap: 5px;
        --mucek-grid: repeat(auto-fit, minmax(var(--mucek-col-min), 1fr));
        --mucek-orange: #e07b39;
        --mucek-orange-dim: rgba(224,123,57,.18);
        --mucek-orange-border: rgba(224,123,57,.45);
        --mucek-bg: #141414;
        --mucek-panel-bg: #1a1a1a;
        --mucek-card-bg: #111111;
        --mucek-border: rgba(255,255,255,.07);
        --mucek-topbar-h: 38px;
      }

      #mucek-cols-wrapper.mucek-saturday,
      #mucek-detail-grid.mucek-saturday {
        --mucek-col-min: 60px;
      }

      /* ===== OUTER BAR ===== */
      #mucek-bottom-bar{
        position: fixed;
        bottom: 0; left: 0; right: 0;
        background: var(--mucek-bg);
        color: #e8e8e8;
        font-family: 'Arial', sans-serif;
        font-size: 11px;
        z-index: 9999999;
        box-shadow: 0 -4px 24px rgba(0,0,0,.85), 0 -1px 0 var(--mucek-orange-border);
        border-top: 2px solid var(--mucek-orange);
        border-radius: 0;
        padding: 0;
        overflow: hidden;
      }

      /* ===== TOP BAR (title + refresh + minimize) ===== */
      #mucek-topbar{
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: var(--mucek-topbar-h);
        padding: 0 12px;
        background: linear-gradient(90deg, #1e1e1e 0%, #1a1a1a 60%, #181818 100%);
        border-bottom: 1px solid rgba(224,123,57,.30);
        gap: 12px;
        flex-shrink: 0;
      }
      #mucek-topbar-left{
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
      }
      .mucek-brand-dot{
        width: 8px; height: 8px;
        border-radius: 50%;
        background: var(--mucek-orange);
        box-shadow: 0 0 8px rgba(224,123,57,.7);
        flex-shrink: 0;
      }
      .mucek-topbar-title{
        font-size: 12px;
        font-weight: 900;
        letter-spacing: .10em;
        text-transform: uppercase;
        color: #ccc;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .mucek-topbar-accent{
        color: var(--mucek-orange);
        letter-spacing: .08em;
      }
      .mucek-legend{
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        padding: 2px 8px;
        border-radius: 6px;
        background: rgba(255,255,255,.04);
        border: 1px solid rgba(255,255,255,.10);
      }
      .mucek-legend-ico{
        color: var(--mucek-orange);
        font-size: 11px;
        flex: 0 0 auto;
      }
      .mucek-legend-text{
        font-size: 10px;
        font-weight: 600;
        color: rgba(200,200,200,.85);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #mucek-topbar-right{
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      /* ===== TOPBAR BUTTONS (Refresh, Minimize) ===== */
      #mucek-refresh{
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 26px;
        padding: 0 10px;
        border: 1px solid var(--mucek-orange-border);
        border-radius: 5px;
        background: var(--mucek-orange-dim);
        color: var(--mucek-orange);
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        letter-spacing: .04em;
        text-transform: uppercase;
        transition: background .15s, border-color .15s, color .15s, transform .1s;
        flex-shrink: 0;
      }
      #mucek-refresh:hover{
        background: rgba(224,123,57,.32);
        border-color: var(--mucek-orange);
        color: #fff;
        transform: translateY(-1px);
      }
      #mucek-refresh.mucek-refreshing{ opacity:.7; transform: scale(.95); }
      .mucek-tbtn-label{ font-size:10px; }

      #mucek-min{
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 26px; height: 26px;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 5px;
        background: rgba(255,255,255,.05);
        color: #aaa;
        font-size: 11px;
        cursor: pointer;
        transition: background .15s, color .15s, transform .1s;
        flex-shrink: 0;
      }
      #mucek-min:hover{ background: rgba(255,255,255,.10); color: #fff; transform: translateY(-1px); }
      #mucek-min:active{ transform: translateY(0); }

      /* ===== CONTENT AREA ===== */
      #mucek-bottom-bar-inner{
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 8px 10px 8px;
        width: 100%;
        box-sizing: border-box;
      }

      #mucek-panels{ display:flex; flex-direction:column; gap:6px; flex:1 1 auto; min-width:0; }

      /* ===== PANELS ===== */
      .mucek-panel{
        background: var(--mucek-panel-bg);
        border: 1px solid var(--mucek-border);
        border-radius: 8px;
        padding: 6px 8px 8px;
        display: flex;
        flex-direction: column;
        gap: 5px;
      }
      .mucek-panel-top{ border-left: 2px solid var(--mucek-orange); }
      .mucek-panel-bottom{ border-left: 2px solid rgba(56,189,248,.55); }

      .mucek-panel-header{
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding-bottom: 5px;
        border-bottom: 1px solid rgba(255,255,255,.06);
        margin-bottom: 2px;
      }
      .mucek-panel-title{
        font-weight: 800;
        font-size: 10.5px;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: #ccc;
        white-space: nowrap;
      }

      /* ===== COPY BUTTON ===== */
      .mucek-copy-btn{
        border: 1px solid rgba(34,197,94,.40);
        border-radius: 5px;
        padding: 3px 9px;
        font-size: 10px;
        font-weight: 700;
        cursor: pointer;
        background: rgba(34,197,94,.12);
        color: #22c55e;
        display: inline-flex;
        align-items: center;
        gap: 5px;
        transition: background .15s, border-color .15s, color .15s, transform .1s;
        flex: 0 0 auto;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .mucek-copy-btn:hover{
        background: rgba(34,197,94,.28);
        border-color: #22c55e;
        color: #fff;
        transform: translateY(-1px);
      }
      .mucek-copy-btn:active{ transform: translateY(0); }
      .mucek-copy-btn.mucek-copied{
        background: rgba(21,128,61,.25);
        border-color: #15803d;
        color: #86efac;
      }

      /* ===== COLUMN GRID ===== */
      #mucek-cols-wrapper{
        display: grid;
        grid-template-columns: var(--mucek-grid);
        gap: var(--mucek-gap);
        align-items: stretch;
        overflow-x: auto;
      }
      #mucek-detail-grid{
        display: grid;
        grid-template-columns: var(--mucek-grid);
        gap: var(--mucek-gap);
        margin-top: 5px;
        align-items: stretch;
      }

      /* ===== COLUMN CARD ===== */
      .mucek-col{
        background: var(--mucek-card-bg);
        border: 1px solid var(--mucek-border);
        border-top: 1px solid rgba(255,255,255,.10);
        border-radius: 6px;
        padding: 5px 5px 6px;
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: stretch;
        box-sizing: border-box;
      }
      .mucek-col-name{
        font-weight: 700;
        font-size: 9.5px;
        text-align: center;
        letter-spacing: .05em;
        text-transform: uppercase;
        color: rgba(180,180,180,.80);
        border-bottom: 1px solid rgba(255,255,255,.07);
        padding-bottom: 3px;
        margin-bottom: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .mucek-col-value{
        font-size: 12px;
        font-weight: 800;
        text-align: center;
        color: #e8e8e8;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: .02em;
      }

      /* ===== DETAIL BOX ===== */
      .mucek-detail-spacer{ min-height: 44px; }
      .mucek-detail-box{
        min-height: 44px;
        padding: 4px 5px;
        border-radius: 6px;
        background: #0d0d0d;
        border: 1px solid rgba(255,255,255,.06);
        border-top: 1px solid rgba(255,255,255,.10);
        font-size: 9.5px;
        font-weight: 700;
        line-height: 1.3;
        text-align: center;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        align-items: stretch;
        box-sizing: border-box;
        min-width: 0;
      }

      /* ===== BADGE ===== */
      .mucek-badge-blue{
        display: inline-flex;
        margin: 2px auto 0;
        padding: 1px 6px;
        border-radius: 4px;
        background: rgba(14,165,233,.10);
        border: 1px solid rgba(14,165,233,.38);
        color: #38BDF8;
        font-weight: 800;
        font-size: 10px;
        line-height: 1.2;
        justify-content: center;
        text-align: center;
      }

      /* ===== COLLATION SECTION ===== */
      #mucek-collation-cols{ display:flex; flex-wrap:nowrap; gap:7px; }
      .mucek-coll-group{
        flex: 1 1 0;
        background: var(--mucek-card-bg);
        border-radius: 6px;
        padding: 4px 6px 6px;
        border: 1px solid var(--mucek-border);
        border-top: 1px solid rgba(56,189,248,.25);
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .mucek-coll-group-title{
        font-size: 10px;
        font-weight: 800;
        text-align: center;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: #38BDF8;
        border-bottom: 1px solid rgba(56,189,248,.18);
        padding-bottom: 2px;
      }
      .mucek-coll-cells{ display:flex; gap:4px; margin-top:2px; }
      .mucek-coll-cell{
        flex: 1 1 0;
        background: #0d0d0d;
        border-radius: 5px;
        padding: 2px 3px 3px;
        border: 1px solid rgba(255,255,255,.06);
        display: flex;
        flex-direction: column;
        gap: 1px;
        font-size: 10px;
        box-sizing: border-box;
        justify-content: flex-start;
        align-items: stretch;
      }
      .mucek-coll-label{
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .05em;
        text-transform: uppercase;
        opacity: .55;
        text-align: center;
      }
      .mucek-coll-value{
        font-weight: 700;
        text-align: center;
        font-size: 11px;
        color: #e8e8e8;
      }

      /* ===== COLUMN HIGHLIGHT: STS & Sale (orange/gold) ===== */
      .mucek-col:has(.mucek-col-value[data-mucek-name="STS"]),
      .mucek-col:has(.mucek-col-value[data-mucek-name="Sale"]) {
        background: rgba(224,123,57,.08);
        border-color: var(--mucek-orange-border);
        border-top-color: rgba(224,123,57,.50);
      }
      .mucek-col-value[data-mucek-name="STS"],
      .mucek-col-value[data-mucek-name="Sale"] {
        color: #f5a050;
        text-shadow: 0 0 8px rgba(224,123,57,.35);
      }

      /* ===== COLUMN HIGHLIGHT: online brands (muted white) ===== */
      .mucek-col:has(.mucek-col-value[data-mucek-name="GAP online"]),
      .mucek-col:has(.mucek-col-value[data-mucek-name="Joules online"]),
      .mucek-col:has(.mucek-col-value[data-mucek-name="JMB online"]),
      .mucek-col:has(.mucek-col-value[data-mucek-name="VS online"]),
      .mucek-col:has(.mucek-col-value[data-mucek-name="Fat Face Online"]) {
        background: rgba(255,255,255,.04);
        border-color: rgba(255,255,255,.14);
      }
      .mucek-col-value[data-mucek-name="GAP online"],
      .mucek-col-value[data-mucek-name="Joules online"],
      .mucek-col-value[data-mucek-name="JMB online"],
      .mucek-col-value[data-mucek-name="VS online"],
      .mucek-col-value[data-mucek-name="Fat Face Online"] {
        color: rgba(230,230,230,.90);
      }

      /* ensure hidden columns do not leave gaps */
      .mucek-col[style*="display: none"] { display: none !important; }
      .mucek-detail-box[style*="display: none"] { display: none !important; }

      /* Alignment fix */
      #mucek-cols-wrapper .mucek-col .mucek-col-name,
      #mucek-cols-wrapper .mucek-col .mucek-col-value { align-self: stretch; }
      .mucek-detail-box { align-items: stretch; justify-content: flex-start; }
      .mucek-subline, .mucek-subline-wrap, .mucek-badge-blue {
        display: inline-flex; align-self: flex-start; margin-top: 3px;
      }

      /* ===== COLLAPSED STATE ===== */
      #mucek-bottom-bar.mucek-collapsed #mucek-bottom-bar-inner { display: none; }
      #mucek-bottom-bar.mucek-collapsed #mucek-mini { display: flex; }
      #mucek-bottom-bar.mucek-collapsed #mucek-topbar{
        border-bottom: none;
      }

      /* ===== MINI BAR (shown when collapsed) ===== */
      #mucek-mini{
        display: none;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 5px 10px;
        min-width: 0;
        background: var(--mucek-bg);
        border-top: 1px solid rgba(255,255,255,.06);
      }
      .mucek-mini-block{
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 3px 10px;
        background: #1a1a1a;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 6px;
      }
      .mucek-mini-title{
        font-weight: 800;
        font-size: 10px;
        letter-spacing: .06em;
        text-transform: uppercase;
        color: #aaa;
        white-space: nowrap;
      }
      .mucek-mini-copy{ height: 26px; padding: 0 9px; font-size: 10px; border-radius: 5px; }

      #mucek-mini-refresh,
      #mucek-mini-min{
        height: 28px; width: 28px;
        border-radius: 5px; border: none; cursor: pointer;
        font-size: 12px;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
        transition: background .15s, transform .1s;
      }
      #mucek-mini-refresh{ background: var(--mucek-orange-dim); border: 1px solid var(--mucek-orange-border); color: var(--mucek-orange); }
      #mucek-mini-refresh:hover{ background: rgba(224,123,57,.28); color: #fff; }
      #mucek-mini-min{ background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.10); color: #aaa; }
      #mucek-mini-min:hover{ background: rgba(255,255,255,.10); color: #fff; }
    `;
    document.head.appendChild(style);

    refreshBtn  = document.getElementById('mucek-refresh');
    copyMainBtn = document.getElementById('mucek-copy-main');
    copyCollBtn = document.getElementById('mucek-copy-collation');
    hideBtn     = document.getElementById('mucek-min');

    const miniCopyMainBtn = document.getElementById('mucek-mini-copy-main');
    const miniCopyCollBtn = document.getElementById('mucek-mini-copy-collation');

    function setCollapsed(isCollapsed) {
      if (!bar || !hideBtn) return;

      if (isCollapsed) {
        bar.classList.add('mucek-collapsed');
        try { localStorage.setItem(STORAGE_KEY_COLLAPSE, '1'); } catch (e) {}
      } else {
        bar.classList.remove('mucek-collapsed');
        try { localStorage.setItem(STORAGE_KEY_COLLAPSE, '0'); } catch (e) {}
      }

      const ico = hideBtn.querySelector('i');
      if (ico) ico.className = isCollapsed ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down';
      hideBtn.title = isCollapsed ? 'Expand' : 'Minimize';
    }

    function applyCollapsedFromStorage() {
      let saved = null;
      try { saved = localStorage.getItem(STORAGE_KEY_COLLAPSE); } catch (e) { saved = null; }
      setCollapsed(saved === '1');
    }

    function textToRawNumber(txt) {
      if (!txt) return 0;
      const cleaned = String(txt).replace(/,/g, '').trim();
      if (cleaned === '') return 0;
      const n = Number(cleaned);
      if (Number.isNaN(n)) return 0;
      return n;
    }
    function safeTextToNumber(txt) {
      return textToRawNumber(txt).toLocaleString('en-GB');
    }

    function renderValues() {
      document.querySelectorAll('.mucek-col-value').forEach(div => {
        const name = div.getAttribute('data-mucek-name');
        let val = values[name];
        if (val === undefined || val === null || String(val).trim() === '') val = '0';
        div.textContent = String(val);
      });
    }

    // toggle visibility helper for Saturday-only columns
    function toggleColumnVisibility(colName, show) {
      const col = document.querySelector(`.mucek-col[data-mucek-col="${colName}"]`);
      const detail = document.querySelector(`.mucek-detail-box[data-col="${colName}"]`);
      if (col) col.style.display = show ? '' : 'none';
      if (detail) detail.style.display = show ? '' : 'none';
    }

    // --- Robust helpers to find rows in arbitrary mat-tables using a predicate on the row label ---
    function getRowByPredicate(baseSelector, predicate) {
      try {
        const rows = document.querySelectorAll(`${baseSelector} mat-row`);
        for (const row of rows) {
          const firstCell = row.querySelector('mat-cell');
          if (!firstCell) continue;
          const rawLabel = (firstCell.textContent || '').trim().replace(/\s+/g,' ');
          if (!rawLabel) continue;
          const labelUpper = rawLabel.toUpperCase();
          try {
            if (predicate(labelUpper, rawLabel)) return row;
          } catch (e) {}
        }
      } catch (e) {}
      return null;
    }

    function getItemsFromRow(row) {
      if (!row) return '0';
      const sel = [
        'mat-cell.cdk-column-items.mat-column-items span',
        'mat-cell.cdk-column_items.mat-column_items span',
        'mat-cell[class*="cdk-column-items"] span',
        'mat-cell[class*="mat-column-items"] span',
        'mat-cell[class*="cdk-column_items"] span',
        'mat-cell[class*="mat-column_items"] span'
      ].join(',');
      const cell = row.querySelector(sel);
      if (cell) return (cell.textContent || '').trim() || '0';

      const spans = Array.from(row.querySelectorAll('mat-cell span'));
      for (const sp of spans) {
        const t = (sp.textContent || '').trim();
        if (!t || t.includes('%')) continue;
        const cleaned = t.replace(/,/g,'').trim();
        if (/^\d+(\.\d+)?$/.test(cleaned)) return cleaned;
      }
      return '0';
    }

    function getOrdersFromRow(row) {
      if (!row) return '0';
      const sel = [
        'mat-cell.cdk-column-orders.mat-column-orders span',
        'mat-cell.cdk-column_orders.mat-column_orders span',
        'mat-cell[class*="cdk-column-orders"] span',
        'mat-cell[class*="mat-column-orders"] span',
        'mat-cell[class*="cdk-column_orders"] span',
        'mat-cell[class*="mat-column_orders"] span'
      ].join(',');
      const cell = row.querySelector(sel);
      if (cell) return (cell.textContent || '').trim() || '0';

      const spans = Array.from(row.querySelectorAll('mat-cell span'));
      const nums = spans
        .map(s => (s.textContent || '').trim())
        .filter(t => t && !t.includes('%'))
        .map(t => t.replace(/,/g,'').trim())
        .filter(t => /^\d+(\.\d+)?$/.test(t));
      return nums.length >= 2 ? nums[1] : (nums[0] || '0');
    }

    // Flexible label matchers (contains tokens)
    function rowLabelContainsAllTokens(labelUpper, tokens) {
      const toks = tokens.map(t => String(t).toUpperCase());
      return toks.every(tok => labelUpper.includes(tok));
    }

    // convenience wrappers
    function getItemsByPredicate(baseSelector, predicate, fallbackSelector) {
      const row = getRowByPredicate(baseSelector, predicate);
      if (row) return getItemsFromRow(row);
      if (fallbackSelector) {
        const el = document.querySelector(fallbackSelector);
        if (el) return (el.textContent || '').trim() || '0';
      }
      return '0';
    }

    function getOrdersByPredicate(baseSelector, predicate, fallbackSelector) {
      const row = getRowByPredicate(baseSelector, predicate);
      if (row) return getOrdersFromRow(row);
      if (fallbackSelector) {
        const el = document.querySelector(fallbackSelector);
        if (el) return (el.textContent || '').trim() || '0';
      }
      return '0';
    }

    // Existing helpers (kept)
    function getItemsByLabel(baseSelector, labels, fallbackSelector, useLastSpan = false) {
      const labelsUpper = labels.map(l => String(l).toUpperCase());
      try {
        const rows = document.querySelectorAll(`${baseSelector} mat-row`);
        for (const row of rows) {
          const firstCell = row.querySelector('mat-cell');
          if (!firstCell) continue;

          const rawLabel = (firstCell.textContent || '').trim();
          const mainPart = rawLabel.split('-')[0].trim().toUpperCase();

          if (labelsUpper.includes(mainPart)) {
            let itemsCell = row.querySelector('mat-cell.cdk-column-items.mat-column-items span');
            if (!itemsCell) {
              const spans = row.querySelectorAll('mat-cell span');
              if (spans.length > 0) itemsCell = useLastSpan ? spans[spans.length - 1] : spans[0];
            }
            if (itemsCell) return (itemsCell.textContent || '').trim() || '0';
          }
        }
      } catch (e) {}

      if (fallbackSelector) {
        const el = document.querySelector(fallbackSelector);
        if (el) return (el.textContent || '').trim() || '0';
      }
      return '0';
    }

    function getOrdersByLabel(baseSelector, labels, fallbackSelector) {
      const labelsUpper = labels.map(l => String(l).toUpperCase());
      try {
        const rows = document.querySelectorAll(`${baseSelector} mat-row`);
        for (const row of rows) {
          const firstCell = row.querySelector('mat-cell');
          if (!firstCell) continue;

          const rawLabel = (firstCell.textContent || '').trim();
          const mainPart = rawLabel.split('-')[0].trim().toUpperCase();

          if (labelsUpper.includes(mainPart)) {
            let ordersCell = row.querySelector('mat-cell.cdk-column-orders.mat-column-orders span');
            if (!ordersCell) {
              const spans = row.querySelectorAll('mat-cell span');
              if (spans.length > 1) ordersCell = spans[1];
            }
            if (ordersCell) return (ordersCell.textContent || '').trim() || '0';
          }
        }
      } catch (e) {}

      if (fallbackSelector) {
        const el = document.querySelector(fallbackSelector);
        if (el) return (el.textContent || '').trim() || '0';
      }
      return '0';
    }

    function getOrdersAndItemsByLabel(baseSelector, labels, fallbackOrdersSelector, fallbackItemsSelector) {
      const labelsUpper = labels.map(l => String(l).toUpperCase());
      try {
        const rows = document.querySelectorAll(`${baseSelector} mat-row`);
        for (const row of rows) {
          const firstCell = row.querySelector('mat-cell');
          if (!firstCell) continue;

          const rawLabel = (firstCell.textContent || '').trim();
          const mainPart = rawLabel.split('-')[0].trim().toUpperCase();

          if (labelsUpper.includes(mainPart)) {
            let ordersCell = row.querySelector('mat-cell.cdk-column-orders.mat-column-orders span');
            if (!ordersCell) {
              const spans = row.querySelectorAll('mat-cell span');
              if (spans.length >= 2) ordersCell = spans[1];
            }

            let itemsCell = row.querySelector('mat-cell.cdk-column-items.mat-column-items span');
            if (!itemsCell) {
              const spans = row.querySelectorAll('mat-cell span');
              if (spans.length > 0) itemsCell = spans[spans.length - 1];
            }

            return {
              orders: ordersCell ? (ordersCell.textContent || '').trim() || '0' : '0',
              items:  itemsCell  ? (itemsCell.textContent  || '').trim() || '0' : '0',
            };
          }
        }
      } catch (e) {}

      let orders = '0';
      let items = '0';
      if (fallbackOrdersSelector) {
        const elO = document.querySelector(fallbackOrdersSelector);
        if (elO) orders = (elO.textContent || '').trim() || '0';
      }
      if (fallbackItemsSelector) {
        const elI = document.querySelector(fallbackItemsSelector);
        if (elI) items = (elI.textContent || '').trim() || '0';
      }
      return { orders, items };
    }

    function setExtraPanelValue(prefix, ordersTxt, itemsTxt) {
      const ordersEl = document.getElementById(`mucek-extra-${prefix}-orders`);
      const itemsEl  = document.getElementById(`mucek-extra-${prefix}-items`);
      const collEl   = document.getElementById(`mucek-extra-${prefix}-collation`);

      if (ordersEl) ordersEl.textContent = safeTextToNumber(ordersTxt);
      if (itemsEl)  itemsEl.textContent  = safeTextToNumber(itemsTxt);

      if (collEl) {
        const o = textToRawNumber(ordersTxt);
        const i = textToRawNumber(itemsTxt);
        collEl.textContent = (o > 0 && i > 0) ? (i / o).toFixed(2) : '';
      }
    }

    function getOnlineBrandMap() {
      const map = {};
      try {
        const rows = document.querySelectorAll('mat-card:nth-child(16) app-section-card mat-table mat-row');
        for (const row of rows) {
          const firstCell = row.querySelector('mat-cell');
          if (!firstCell) continue;
          const raw = (firstCell.textContent || '').trim();
          const label = raw.split('-')[0].trim().toUpperCase();
          if (!label) continue;

          let itemsCell = row.querySelector('mat-cell.cdk-column-items.mat-column-items span');
          if (!itemsCell) {
            const spans = row.querySelectorAll('mat-cell span');
            if (spans.length > 0) itemsCell = spans[spans.length - 1];
          }
          if (!itemsCell) continue;
          map[label] = (itemsCell.textContent || '').trim() || '0';
        }
      } catch (e) {}
      return map;
    }

    function flashCopyState(btn) {
      if (!btn) return;
      const original = btn.innerHTML;
      btn.classList.add('mucek-copied');
      btn.innerHTML = '<i class="fa-solid fa-check"></i><span class="mucek-btn-label"> Copied</span>';
      setTimeout(() => {
        btn.classList.remove('mucek-copied');
        btn.innerHTML = original;
      }, 1000);
    }

    function getActiveTabRoot() {
      return document.querySelector('mat-tab-body.mat-tab-body-active')
          || document.querySelector('.mat-tab-body-active')
          || document;
    }

    function getRightBatchTableFromActiveTab() {
      const root = getActiveTabRoot();
      const card = root.querySelector('mat-card:nth-child(6)');
      if (!card) return null;
      const table = card.querySelector('app-section-card:nth-child(3) mat-table');
      return table || null;
    }

    function getItemsCellTextFromRow(row) {
      if (!row) return '0';
      const sel = [
        'mat-cell.cdk-column-items.mat-column-items span',
        'mat-cell.cdk-column_items.mat-column_items span',
        'mat-cell[class*="cdk-column-items"] span',
        'mat-cell[class*="mat-column-items"] span',
        'mat-cell[class*="cdk-column_items"] span',
        'mat-cell[class*="mat-column_items"] span'
      ].join(',');
      const cell = row.querySelector(sel);
      if (cell) return (cell.textContent || '').trim() || '0';

      const spans = Array.from(row.querySelectorAll('mat-cell span'));
      for (const sp of spans) {
        const t = (sp.textContent || '').trim();
        if (!t || t.includes('%')) continue;
        const cleaned = t.replace(/,/g,'').trim();
        if (/^\d+(\.\d+)?$/.test(cleaned)) return cleaned;
      }
      return '0';
    }

    function getOrdersCellTextFromRow(row) {
      if (!row) return '0';
      const sel = [
        'mat-cell.cdk-column-orders.mat-column-orders span',
        'mat-cell.cdk-column_orders.mat-column_orders span',
        'mat-cell[class*="cdk-column-orders"] span',
        'mat-cell[class*="mat-column-orders"] span',
        'mat-cell[class*="cdk-column_orders"] span',
        'mat-cell[class*="mat-column_orders"] span'
      ].join(',');
      const cell = row.querySelector(sel);
      if (cell) return (cell.textContent || '').trim() || '0';

      const spans = Array.from(row.querySelectorAll('mat-cell span'));
      const nums = spans
        .map(s => (s.textContent || '').trim())
        .filter(t => t && !t.includes('%'))
        .map(t => t.replace(/,/g,'').trim())
        .filter(t => /^\d+(\.\d+)?$/.test(t));
      return nums.length >= 2 ? nums[1] : (nums[0] || '0');
    }

    function getRightRowByLabel(tableEl, matchers) {
      const m = matchers.map(x => String(x).toUpperCase());
      const rows = Array.from(tableEl.querySelectorAll('mat-row'));
      for (const row of rows) {
        const firstCell = row.querySelector('mat-cell');
        if (!firstCell) continue;
        const label = (firstCell.textContent || '').replace(/\s+/g,' ').trim().toUpperCase();
        if (!label) continue;
        if (m.some(mm => label.includes(mm))) return row;
      }
      return null;
    }

    function readStsSaleRobust() {
      const table = getRightBatchTableFromActiveTab();
      if (table) {
        const stsRow  = getRightRowByLabel(table, ['STS']);
        const saleRow = getRightRowByLabel(table, ['SALE','SALES']);

        const stsTxt  = stsRow  ? getItemsCellTextFromRow(stsRow)  : '0';
        const saleTxt = saleRow ? getItemsCellTextFromRow(saleRow) : '0';

        const saleOrdersTxt = saleRow ? getOrdersCellTextFromRow(saleRow) : '0';

        return {
          stsRaw: textToRawNumber(stsTxt),
          saleRaw: textToRawNumber(saleTxt),
          saleOrdersRaw: textToRawNumber(saleOrdersTxt),
        };
      }

      const stsEl  = document.querySelector(STS_RIGHT_SELECTOR);
      const saleEl = document.querySelector(SALE_RIGHT_SELECTOR);
      return {
        stsRaw: textToRawNumber(stsEl ? stsEl.textContent : '0'),
        saleRaw: textToRawNumber(saleEl ? saleEl.textContent : '0'),
        saleOrdersRaw: 0,
      };
    }

    let retryTimer = null;
    function scheduleRetrySTS() {
      if (retryTimer) return;
      let tries = 0;
      retryTimer = setInterval(() => {
        tries++;
        updateFromPage(true);
        if (tries >= 6) {
          clearInterval(retryTimer);
          retryTimer = null;
        }
      }, 250);
    }

    // --- Datepicker detection & parsing ---
    function parseDateStringLoose(s) {
      if (!s) return null;
      s = String(s).trim();
      if (!s) return null;

      if (/^\d{4}[-\/]\d{1,2}[-\/]\d{1,2}$/.test(s)) {
        const iso = Date.parse(s);
        if (!isNaN(iso)) return new Date(iso);
      }

      const uk = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (uk) {
        let day = parseInt(uk[1], 10);
        let month = parseInt(uk[2], 10) - 1;
        let year = parseInt(uk[3], 10);
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }

      if (/[A-Za-z]/.test(s) || /^\d{4}[-T]/.test(s) || /\d{4}$/.test(s)) {
        const parsed = Date.parse(s);
        if (!isNaN(parsed)) return new Date(parsed);
      }

      const us = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (us) {
        let month = parseInt(us[1], 10) - 1;
        let day = parseInt(us[2], 10);
        let year = parseInt(us[3], 10);
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        if (!isNaN(d.getTime())) return d;
      }

      return null;
    }

    function getSelectedDateFromDatepicker() {
      try {
        const candidates = [
          'input[matInput][matDatepicker]',
          'input[matdatepicker]',
          'input[matDatepicker]',
          'input.mat-datepicker-input',
          'input.mat-input-element',
          'input[type="text"]'
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (!el) continue;
          if (el.value) {
            const d = parseDateStringLoose(el.value);
            if (d) return d;
          }
          const attrs = ['ng-reflect-model', 'ng-reflect-value', 'value'];
          for (const a of attrs) {
            const vv = el.getAttribute(a);
            if (vv) {
              const d = parseDateStringLoose(vv);
              if (d) return d;
            }
          }
        }

        const datepickers = document.querySelectorAll('mat-datepicker, mat-date-range-input, mat-date-range-picker');
        if (datepickers && datepickers.length > 0) {
          for (const dp of datepickers) {
            const inputNear = dp.closest('div')?.querySelector('input') || document.querySelector('input[matDatepicker]');
            if (inputNear) {
              if (inputNear.value) {
                const d = parseDateStringLoose(inputNear.value);
                if (d) return d;
              }
            }
          }
        }
      } catch (e) {
        console.warn('[MUCEK] date read error', e);
      }
      return null;
    }

    function isSelectedDateSaturday() {
      const d = getSelectedDateFromDatepicker();
      if (!d) return false;
      return d.getDay() === 6;
    }

    function updateFromPage(isRetry = false) {
      try {
        const saturday = isSelectedDateSaturday();

        toggleColumnVisibility('Monday Courier', saturday);
        toggleColumnVisibility('Sat Cou', saturday);

        const colsWrapper = document.getElementById('mucek-cols-wrapper');
        const detailGrid = document.getElementById('mucek-detail-grid');
        if (colsWrapper) colsWrapper.classList.toggle('mucek-saturday', saturday);
        if (detailGrid) detailGrid.classList.toggle('mucek-saturday', saturday);

        const footerSpans = document.querySelectorAll(
          'mat-card:nth-child(4) app-section-card mat-table mat-footer-row mat-footer-cell.cdk-column-items.mat-column-items span'
        );
        let actualTxt = '0';
        if (footerSpans.length > 0) {
          actualTxt = (footerSpans[footerSpans.length - 1].textContent || '').trim() || '0';
        }

        const statedTxt = getItemsByLabel(
          'mat-card:nth-child(4) app-section-card mat-table',
          ['Courier'],
          'mat-card:nth-child(4) app-section-card mat-table mat-row:nth-child(2) mat-cell.cdk-column-items.mat-column-items span'
        );

        const evriTxt = getItemsByLabel(
          'mat-card:nth-child(14) app-section-card mat-table',
          ['Evri','EVR'],
          null,
          false
        );
        const evriRaw = textToRawNumber(evriTxt);
        lastEvriRaw = evriRaw;

        const { stsRaw, saleRaw, saleOrdersRaw } = readStsSaleRobust();
        lastSaleOrdersRaw = saleOrdersRaw;

        values['STS']  = stsRaw.toLocaleString('en-GB');
        values['Sale'] = saleRaw.toLocaleString('en-GB');
        lastSaleRaw = saleRaw;

        if (!isRetry && (stsRaw === 0 || saleRaw === 0)) scheduleRetrySTS();

        const ndtsTxt = getItemsByLabel(
          'mat-card:nth-child(4) app-section-card mat-table',
          ['NDTS'],
          'mat-card:nth-child(4) app-section-card mat-table mat-row:nth-child(4) mat-cell.cdk-column-items.mat-column-items span'
        );
        values['NDTS'] = safeTextToNumber(ndtsTxt);

        const intFooterItems = document.querySelectorAll(
          'mat-card:nth-child(14) app-section-card mat-table mat-footer-row mat-footer-cell.cdk-column-items.mat-column-items span'
        );
        let intTxt = '0';
        if (intFooterItems.length > 0) intTxt = (intFooterItems[intFooterItems.length - 1].textContent || '').trim() || '0';
        values['Int'] = safeTextToNumber(intTxt);

        const dpdTxt = getItemsByLabel(
          'mat-card:nth-child(6) app-section-card:nth-child(3) mat-table',
          ['DPD'],
          'mat-card:nth-child(6) app-section-card:nth-child(3) mat-table mat-row:nth-child(3) mat-cell.cdk-column-items.mat-column-items span'
        );
        values['DPD'] = safeTextToNumber(dpdTxt);

        const bhTxt = getItemsByLabel(
          'mat-card:nth-child(6) app-section-card:nth-child(4) mat-table',
          ['B/H','Boxed Hanging','Boxed/Hanging','BH'],
          'mat-card:nth-child(6) app-section-card:nth-child(4) mat-table mat-row mat-cell.cdk-column-items.mat-column-items span'
        );
        values['B/H'] = safeTextToNumber(bhTxt);

        const onlineMap = getOnlineBrandMap();
        values['Fat Face Online'] = safeTextToNumber(onlineMap['FF'] || '0');
        values['GAP online']      = safeTextToNumber(onlineMap['GA'] || '0');
        values['Joules online']   = safeTextToNumber(onlineMap['JL'] || '0');
        values['JMB online']      = safeTextToNumber(onlineMap['JM'] || '0');

        const vsTxt = onlineMap['VS'] || getItemsByLabel(
          'mat-card:nth-child(16) app-section-card mat-table',
          ['VS'],
          'mat-card:nth-child(16) app-section-card mat-table mat-row:nth-child(14) mat-cell.cdk-column-items.mat-column-items span'
        );
        values['VS online'] = safeTextToNumber(vsTxt);

        const storesTxt = getItemsByLabel(
          'mat-card:nth-child(4) app-section-card mat-table',
          ['Shop','Stores','Store'],
          'mat-card:nth-child(4) app-section-card mat-table mat-row:nth-child(4) mat-cell.cdk-column-items.mat-column-items span'
        );
        values['Stores'] = safeTextToNumber(storesTxt);

        const storesRaw = textToRawNumber(storesTxt);
        const actualRawOriginal = textToRawNumber(actualTxt);
        lastActualRawOriginal = actualRawOriginal;
        lastStoresRaw = storesRaw;

        const actualAfterStoreRaw = Math.max(actualRawOriginal - storesRaw, 0);
        values['Actual'] = actualAfterStoreRaw.toLocaleString('en-GB');

        const actualMinusRaw = Math.max(actualAfterStoreRaw - saleRaw, 0);
        values['Actual Minus'] = actualMinusRaw.toLocaleString('en-GB');

        const badgeActual = `<span class="mucek-badge-blue">${actualRawOriginal.toLocaleString('en-GB')}</span>`;
        const subLineHtmlActual =
          `<div style="color:${storesRaw > 0 ? '#ff4d4d' : '#dddddd'};">- ${storesRaw.toLocaleString('en-GB')} (Store)</div>${badgeActual}`;

        const badgeActualMinus = `<span class="mucek-badge-blue">${actualAfterStoreRaw.toLocaleString('en-GB')}</span>`;
        const subLineHtmlActualMinus =
          `<div style="color:${saleRaw > 0 ? '#ff4d4d' : '#dddddd'};">- ${saleRaw.toLocaleString('en-GB')} (Sale)</div>${badgeActualMinus}`;

        const statedRaw = textToRawNumber(statedTxt);
        lastStatedRawOriginal = statedRaw;
        lastSaleRaw = saleRaw;

        const courierPair = getOrdersAndItemsByLabel(
          'mat-card:nth-child(4) app-section-card mat-table',
          ['Courier'],
          '#mat-tab-content-2-9 > div > div > div > mat-card:nth-child(4) > app-section-card > mat-table > mat-row:nth-child(2) > mat-cell.cdk-column-orders.mat-column-orders span',
          '#mat-tab-content-2-9 > div > div > div > mat-card:nth-child(4) > app-section-card > mat-table > mat-row:nth-child(2) > mat-cell.cdk-column-items.mat-column-items span'
        );

        lastCourierOrdersOrig = textToRawNumber(courierPair.orders);
        lastCourierItemsOrig  = textToRawNumber(courierPair.items);
        lastCourierItemsRaw   = lastCourierItemsOrig;

        const courierSundayRow = getRowByPredicate('mat-card:nth-child(4) app-section-card mat-table', (labelUpper) => {
          return labelUpper.includes('COURIER') && (labelUpper.includes('SUN') || labelUpper.includes('SUNDAY'));
        });

        const courierSundayItemsTxt = courierSundayRow ? getItemsFromRow(courierSundayRow) : '0';
        const courierSundayOrdersTxt = courierSundayRow ? getOrdersFromRow(courierSundayRow) : '0';
        lastCourierSundayItemsRaw = textToRawNumber(courierSundayItemsTxt);
        lastCourierSundayOrdersRaw = textToRawNumber(courierSundayOrdersTxt);

        const depot33Row = getRowByPredicate('mat-card:nth-child(14) app-section-card mat-table, mat-card:nth-child(4) app-section-card mat-table', (labelUpper) => {
          return labelUpper.includes('EVR') && labelUpper.includes('33');
        });

        const depot33ItemsTxt = depot33Row ? getItemsFromRow(depot33Row) : '0';
        const depot33OrdersTxt = depot33Row ? getOrdersFromRow(depot33Row) : '0';
        lastDepot33ItemsRaw = textToRawNumber(depot33ItemsTxt);
        lastDepot33OrdersRaw = textToRawNumber(depot33OrdersTxt);

        const statedMinusRawNormal = Math.max(statedRaw - lastEvriRaw - lastSaleRaw, 0);

        if (saturday) {
          const statedSatRaw = Math.max(
            lastCourierItemsRaw + lastCourierSundayItemsRaw - lastDepot33ItemsRaw - lastSaleRaw,
            0
          );
          values['Stated'] = statedSatRaw.toLocaleString('en-GB');

          const mondayCourierRaw = Math.max(lastCourierItemsRaw - lastDepot33ItemsRaw - lastSaleRaw, 0);
          values['Monday Courier'] = mondayCourierRaw.toLocaleString('en-GB');

          values['Sat Cou'] = lastCourierSundayItemsRaw.toLocaleString('en-GB');

          const badgeStated = `<span class="mucek-badge-blue">${lastCourierItemsRaw.toLocaleString('en-GB')}</span>`;
          const subLineHtmlStated =
            `<div style="color:${lastCourierSundayItemsRaw > 0 ? '#00ff00' : '#aaaaaa'};">+ ${lastCourierSundayItemsRaw.toLocaleString('en-GB')} (Courier Sunday)</div>` +
            `<div style="color:${lastDepot33ItemsRaw > 0 ? '#ff4d4d' : '#dddddd'};">- ${lastDepot33ItemsRaw.toLocaleString('en-GB')} (Depot 33)</div>` +
            `<div style="color:${lastSaleRaw > 0 ? '#ff4d4d' : '#dddddd'};">- ${lastSaleRaw.toLocaleString('en-GB')} (Sale)</div>` +
            `${badgeStated}`;

          const boxStated = document.getElementById('mucek-detail-stated');
          if (boxStated) boxStated.innerHTML = subLineHtmlStated;
        } else {
          values['Stated'] = statedMinusRawNormal.toLocaleString('en-GB');

          values['Monday Courier'] = '0';
          values['Sat Cou'] = '0';

          const badgeStated = `<span class="mucek-badge-blue">${statedRaw.toLocaleString('en-GB')}</span>`;
          const subLineHtmlStated =
            `<div style="color:${lastEvriRaw > 0 ? '#ff4d4d' : '#dddddd'};">- ${lastEvriRaw.toLocaleString('en-GB')} (Evri)</div>` +
            `<div style="color:${lastSaleRaw > 0 ? '#ff4d4d' : '#dddddd'};">- ${lastSaleRaw.toLocaleString('en-GB')} (Sale)</div>` +
            `${badgeStated}`;
          const boxStated = document.getElementById('mucek-detail-stated');
          if (boxStated) boxStated.innerHTML = subLineHtmlStated;
        }

        const stsMinusResultRaw = Math.max(storesRaw - stsRaw, 0);
        values['STS minus'] = stsMinusResultRaw.toLocaleString('en-GB');

        const badgeStsMinus = `<span class="mucek-badge-blue">${storesRaw.toLocaleString('en-GB')}</span>`;
        const subLineHtmlStsMinus =
          `<div style="color:${stsRaw > 0 ? '#ff4d4d' : '#dddddd'};">- ${stsRaw.toLocaleString('en-GB')} (STS)</div>${badgeStsMinus}`;
        const boxStsMinus = document.getElementById('mucek-detail-stsminus');
        if (boxStsMinus) boxStsMinus.innerHTML = subLineHtmlStsMinus;

        const e3Row8  = document.querySelector('mat-card:nth-child(10) app-section-card mat-table mat-row:nth-child(8)');
        const e3Row9  = document.querySelector('mat-card:nth-child(10) app-section-card mat-table mat-row:nth-child(9)');
        const e3Row10 = document.querySelector('mat-card:nth-child(10) app-section-card mat-table mat-row:nth-child(10)');

        function getLabelAndValue(row, defLabel) {
          if (!row) return { label: defLabel, value: 0 };
          const labelCell = row.querySelector('mat-cell');
          let label = labelCell ? (labelCell.textContent || '').trim() : defLabel;
          if (!label) label = defLabel;
          const itemsCell = row.querySelector('mat-cell.cdk-column-items.mat-column-items span') || row.querySelector('mat-cell span');
          const value = itemsCell ? textToRawNumber(itemsCell.textContent || '') : 0;
          return { label, value };
        }

        const part1 = getLabelAndValue(e3Row8,  'Courier');
        const part2 = getLabelAndValue(e3Row9,  'Store');
        const part3 = getLabelAndValue(e3Row10, 'NDTS');

        lastE3Part1 = part1.value;
        lastE3Part2 = part2.value;
        lastE3Part3 = part3.value;

        values['E3 Gen'] = (part1.value + part2.value + part3.value).toLocaleString('en-GB');

        function makeE3Line(part, labelText) {
          const colour = part.value > 0 ? '#00ff00' : '#aaaaaa';
          return `<div style="color:${colour};">+ ${part.value.toLocaleString('en-GB')} (${labelText})</div>`;
        }
        const e3InfoHtml = [ makeE3Line(part1,'Courier'), makeE3Line(part2,'Store'), makeE3Line(part3,'NDTS') ].join('');

        const boxActual      = document.getElementById('mucek-detail-actual');
        const boxActualMinus = document.getElementById('mucek-detail-actualminus');
        const boxStatedBox   = document.getElementById('mucek-detail-stated');
        const boxStsMinus2   = document.getElementById('mucek-detail-stsminus');
        const boxE3          = document.getElementById('mucek-detail-e3');

        if (boxActual)      boxActual.innerHTML      = subLineHtmlActual;
        if (boxActualMinus) boxActualMinus.innerHTML = subLineHtmlActualMinus;
        if (!saturday && boxStatedBox) boxStatedBox.innerHTML = boxStatedBox.innerHTML;
        if (boxStsMinus2)   boxStsMinus2.innerHTML   = subLineHtmlStsMinus;
        if (boxE3)          boxE3.innerHTML          = e3InfoHtml;

        const evriOrdersTxt = getOrdersByLabel('mat-card:nth-child(14) app-section-card mat-table', ['Evri','EVR'], null);
        const evriOrdersRaw = textToRawNumber(evriOrdersTxt);
        lastEvriOrdersRaw = evriOrdersRaw;

        let courierOrdersAdj = 0;
        let courierItemsAdj = 0;

        const courierOrdersEl = document.getElementById('mucek-extra-courier-orders');
        const courierItemsEl  = document.getElementById('mucek-extra-courier-items');
        const courierCollEl   = document.getElementById('mucek-extra-courier-collation');

        if (saturday) {
          courierOrdersAdj = Math.max(
            lastCourierOrdersOrig + lastCourierSundayOrdersRaw - lastDepot33OrdersRaw - lastSaleOrdersRaw,
            0
          );
          courierItemsAdj = Math.max(
            lastCourierItemsOrig + lastCourierSundayItemsRaw - lastDepot33ItemsRaw - lastSaleRaw,
            0
          );

          if (courierOrdersEl) {
            courierOrdersEl.innerHTML =
              `${lastCourierOrdersOrig.toLocaleString('en-GB')} + ` +
              `<span style="color:#00ff00;">${lastCourierSundayOrdersRaw.toLocaleString('en-GB')} (Courier Sun)</span>` +
              ` - <span style="color:#ff4d4d;">${lastDepot33OrdersRaw.toLocaleString('en-GB')} (Evri 33)</span>` +
              ` - <span style="color:#ff4d4d;">${lastSaleOrdersRaw.toLocaleString('en-GB')} (Sale)</span>`;
          }

          if (courierItemsEl) {
            courierItemsEl.innerHTML =
              `${lastCourierItemsOrig.toLocaleString('en-GB')} + ` +
              `<span style="color:#00ff00;">${lastCourierSundayItemsRaw.toLocaleString('en-GB')} (Courier Sun)</span>` +
              ` - <span style="color:#ff4d4d;">${lastDepot33ItemsRaw.toLocaleString('en-GB')} (Evri 33)</span>` +
              ` - <span style="color:#ff4d4d;">${lastSaleRaw.toLocaleString('en-GB')} (Sale)</span>`;
          }
        } else {
          courierOrdersAdj = Math.max(lastCourierOrdersOrig - evriOrdersRaw - lastSaleOrdersRaw, 0);
          courierItemsAdj  = Math.max(lastCourierItemsOrig - lastEvriRaw - lastSaleRaw, 0);

          if (courierOrdersEl) {
            courierOrdersEl.innerHTML =
              `${lastCourierOrdersOrig.toLocaleString('en-GB')} - ` +
              `<span style="color:#ff4d4d;">${evriOrdersRaw.toLocaleString('en-GB')} (Evri)</span>` +
              ` - <span style="color:#ff4d4d;">${lastSaleOrdersRaw.toLocaleString('en-GB')} (Sale)</span>`;
          }
          if (courierItemsEl) {
            courierItemsEl.innerHTML =
              `${lastCourierItemsOrig.toLocaleString('en-GB')} - ` +
              `<span style="color:#ff4d4d;">${lastEvriRaw.toLocaleString('en-GB')} (Evri)</span>` +
              ` - <span style="color:#ff4d4d;">${lastSaleRaw.toLocaleString('en-GB')} (Sale)</span>`;
          }
        }

        if (courierCollEl) {
          courierCollEl.textContent = (courierOrdersAdj > 0 && courierItemsAdj > 0) ? (courierItemsAdj / courierOrdersAdj).toFixed(2) : '';
        }

        const nddPair = getOrdersAndItemsByLabel('mat-card:nth-child(4) app-section-card mat-table', ['NDTS'], null, null);
        setExtraPanelValue('ndd', nddPair.orders, nddPair.items);

        const intOrdersEl = document.querySelector('mat-card:nth-child(14) app-section-card mat-table mat-footer-row mat-footer-cell.cdk-column-orders.mat-column-orders span');
        const intItemsEl  = document.querySelector('mat-card:nth-child(14) app-section-card mat-table mat-footer-row mat-footer-cell.cdk-column-items.mat-column-items span');
        setExtraPanelValue('int',
          intOrdersEl ? (intOrdersEl.textContent || '').trim() || '0' : '0',
          intItemsEl  ? (intItemsEl.textContent  || '').trim() || '0' : '0'
        );

        if (values['Monday Courier'] === undefined) values['Monday Courier'] = '0';
        if (values['Sat Cou'] === undefined) values['Sat Cou'] = '0';

        renderValues();
      } catch (err) {
        console.error('[MUCEK] Error in updateFromPage:', err);
      }
    }

    function copyMainLine() {
      const saturday = isSelectedDateSaturday();
      const columnsToCopy = saturday ? columns.slice() : columns.filter(c => c !== 'Monday Courier' && c !== 'Sat Cou');

      const line = columnsToCopy.map(name => {
        if (name === 'Actual') return '=' + lastActualRawOriginal + '-' + lastStoresRaw;
        if (name === 'Stated') {
          if (saturday) {
            return '=' + lastCourierItemsOrig + '+' + lastCourierSundayItemsRaw + '-' + lastDepot33ItemsRaw + '-' + lastSaleRaw;
          } else {
            return '=' + lastStatedRawOriginal + '-' + lastEvriRaw + '-' + lastSaleRaw;
          }
        }
        if (name === 'Monday Courier') {
          if (saturday) {
            return '=' + lastCourierItemsOrig + '-' + lastDepot33ItemsRaw + '-' + lastSaleRaw;
          }
          return '0';
        }
        if (name === 'Sat Cou') {
          if (saturday) return '=' + lastCourierSundayItemsRaw;
          return '0';
        }
        if (name === 'E3 Gen' && (lastE3Part1 || lastE3Part2 || lastE3Part3)) return '=' + lastE3Part1 + '+' + lastE3Part2 + '+' + lastE3Part3;
        return String(textToRawNumber(values[name] || '0'));
      }).join('\t');

      try {
        if (typeof GM_setClipboard === 'function') GM_setClipboard(line);
        else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(line);
        flashCopyState(copyMainBtn);
      } catch (err) {
        console.error('[MUCEK] Copy main error:', err);
      }
    }

    function copyCollationLine() {
      let courierOrdersCell;
      let courierItemsCell;

      if (isSelectedDateSaturday()) {
        courierOrdersCell = '=' + lastCourierOrdersOrig + '+' + lastCourierSundayOrdersRaw + '-' + lastDepot33OrdersRaw + '-' + lastSaleOrdersRaw;
        courierItemsCell  = '=' + lastCourierItemsOrig  + '+' + lastCourierSundayItemsRaw + '-' + lastDepot33ItemsRaw + '-' + lastSaleRaw;
      } else {
        courierOrdersCell = '=' + lastCourierOrdersOrig + '-' + lastEvriOrdersRaw + '-' + lastSaleOrdersRaw;
        courierItemsCell  = '=' + lastCourierItemsOrig  + '-' + lastEvriRaw + '-' + lastSaleRaw;
      }

      const courierCollEl = document.getElementById('mucek-extra-courier-collation');
      const courierCollCell = String(textToRawNumber(courierCollEl ? (courierCollEl.textContent || '0') : '0'));

      function numFromId(id) {
        const el = document.getElementById(id);
        return String(textToRawNumber(el ? (el.textContent || '0') : '0'));
      }

      const line = [
        courierOrdersCell, courierItemsCell, courierCollCell,
        numFromId('mucek-extra-ndd-orders'), numFromId('mucek-extra-ndd-items'), numFromId('mucek-extra-ndd-collation'),
        numFromId('mucek-extra-int-orders'), numFromId('mucek-extra-int-items'), numFromId('mucek-extra-int-collation')
      ].join('\t');

      try {
        if (typeof GM_setClipboard === 'function') GM_setClipboard(line);
        else if (navigator.clipboard?.writeText) navigator.clipboard.writeText(line);
        flashCopyState(copyCollBtn);
      } catch (err) {
        console.error('[MUCEK] Copy collation error:', err);
      }
    }

    function clickRunButton() {
      try {
        const labels = Array.from(document.querySelectorAll('.mdc-button__label'));
        for (const label of labels) {
          if ((label.textContent || '').trim().toUpperCase() === 'RUN') {
            const btn = label.closest('button, a, [role="button"], .mdc-button') || label.parentElement;
            if (btn) { btn.click(); return true; }
          }
        }

        const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .mdc-button'));
        for (const el of candidates) {
          const text = (el.textContent || '').trim();
          if (!text) continue;
          if (text.toUpperCase() === 'RUN' || /\bRUN\b/i.test(text)) {
            el.click();
            return true;
          }
        }
      } catch (e) {
        console.warn('[MUCEK] clickRunButton error', e);
      }
      return false;
    }

    refreshBtn.addEventListener('click', () => {
      refreshBtn.classList.add('mucek-refreshing');

      const didClickRun = clickRunButton();

      if (didClickRun) {
        setTimeout(() => {
          updateFromPage(false);
          refreshBtn.classList.remove('mucek-refreshing');
        }, 1000);
      } else {
        updateFromPage(false);
        setTimeout(() => refreshBtn.classList.remove('mucek-refreshing'), 150);
      }
    });

    copyMainBtn.addEventListener('click', copyMainLine);
    copyCollBtn.addEventListener('click', copyCollationLine);

    if (miniCopyMainBtn) miniCopyMainBtn.addEventListener('click', () => {
      copyMainLine();
      flashCopyState(miniCopyMainBtn);
    });
    if (miniCopyCollBtn) miniCopyCollBtn.addEventListener('click', () => {
      copyCollationLine();
      flashCopyState(miniCopyCollBtn);
    });

    // Mini-bar refresh & minimize delegate to their main counterparts
    const miniRefreshBtn = document.getElementById('mucek-mini-refresh');
    const miniHideBtn    = document.getElementById('mucek-mini-min');
    if (miniRefreshBtn) miniRefreshBtn.addEventListener('click', () => refreshBtn && refreshBtn.click());
    if (miniHideBtn)    miniHideBtn.addEventListener('click',    () => hideBtn    && hideBtn.click());

    hideBtn.addEventListener('click', () => {
      const nowCollapsed = !bar.classList.contains('mucek-collapsed');
      setCollapsed(nowCollapsed);
    });

    applyCollapsedFromStorage();

    const obs = new MutationObserver(() => {
      if (window.__mucekObsTimer) clearTimeout(window.__mucekObsTimer);
      window.__mucekObsTimer = setTimeout(() => updateFromPage(false), 200);
    });
    obs.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => updateFromPage(false), 800);
    setInterval(() => updateFromPage(false), 10000);
  });

})();
