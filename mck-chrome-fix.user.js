// ==UserScript==
// @name         [MCK] Chrome Fix (Batch Viewer)
// @namespace    Mateusz Mucek
// @version      7.5
// @description  Chrome fix: replaces VBScript Refresh, renders legacy DataGrid (<PARAM R*>) and fixes PickWalk (P) links + shows Updated time next to Refresh
// @match        http://ws-whs/DirectoryManagement/BatchHeader.asp*
// @match        http://ws-whs/DirectoryManagement/BatchData.asp*
// @match        http://ws-whs/DirectoryManagement/BatchPickWalk3.asp*
// @match        http://ws-whs/putaway/forward/locating/locatingframe.asp*
// @match        http://ws-whs.next-uk.next.loc/DirectoryManagement/BatchHeader.asp*
// @match        http://ws-whs.next-uk.next.loc/DirectoryManagement/BatchData.asp*
// @match        http://ws-whs.next-uk.next.loc/DirectoryManagement/BatchPickWalk3.asp*
// @match        http://ws-whs.next-uk.next.loc/putaway/forward/locating/locatingframe.asp*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const log = (...a) => console.log('[ws-whs]', ...a);

  const path = (location.pathname || '').toLowerCase();
  const isBatchHeader   = path.includes('/directorymanagement/batchheader.asp');
  const isBatchData     = path.includes('/directorymanagement/batchdata.asp');
  const isBatchPickWalk = path.includes('/directorymanagement/batchpickwalk3.asp');
  const isLocatingFrame = path.includes('/putaway/forward/locating/locatingframe.asp');

  // =====================================================
  // PART 1 — Refresh View fix (BatchHeader.asp) + Updated time label
  // =====================================================
  function installRefreshFix() {
    if (!isBatchHeader) return;

    function ensureUpdatedLabel() {
      const refreshBtn =
        document.querySelector('input[value="Refresh View"]') ||
        document.querySelector('input[onclick*="runReport"]') ||
        document.querySelector('input[type="button"]') ||
        document.querySelector('button');

      if (!refreshBtn) return null;

      let label = document.getElementById('mckUpdatedLabel');
      if (!label) {
        label = document.createElement('span');
        label.id = 'mckUpdatedLabel';
        label.style.marginLeft = '12px';
        label.style.fontFamily = 'Verdana, Arial, sans-serif';
        label.style.fontSize = '12px';
        label.style.fontWeight = '700';
        label.style.color = 'white';
        label.textContent = 'Updated: --:--';
        refreshBtn.insertAdjacentElement('afterend', label);
      }

      return label;
    }

    function setUpdatedNow() {
      const label = ensureUpdatedLabel();
      if (!label) return;

      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      label.textContent = `Updated: ${hh}:${mm}`;
    }

    setUpdatedNow();

    window.runReport = function () {
      const warehouseSelect  = document.querySelector('[name="cboWarehouse"]');
      const daySelect        = document.querySelector('[name="cboDay"]');
      const fromInput        = document.getElementById('txtFromBatch');
      const toInput          = document.getElementById('txtToBatch');
      const singlesCheckbox  = document.getElementById('chkSingles');

      if (!warehouseSelect || !daySelect || !fromInput || !toInput || !singlesCheckbox) {
        alert('Cannot find required inputs on this page.');
        return;
      }

      const selectedWarehouse = warehouseSelect.options[warehouseSelect.selectedIndex];
      if (!selectedWarehouse || selectedWarehouse.value === 'N') {
        alert('You must select a warehouse before running the report!');
        return;
      }

      const strWarehouse = selectedWarehouse.text || selectedWarehouse.value;

      let fromBatch = parseInt(fromInput.value || '1', 10);
      if (!Number.isFinite(fromBatch) || fromBatch <= 0) fromBatch = 1;

      let toBatch = parseInt(toInput.value || '99', 10);
      if (!Number.isFinite(toBatch) || toBatch <= 0) toBatch = 99;

      const showSingles = singlesCheckbox.checked ? 'yes' : 'no';

      let nDay = parseInt(daySelect.value, 10);
      if (!Number.isFinite(nDay) || nDay < 0) nDay = 0;

      const strURL =
        'BatchData.asp?Warehouse=' + encodeURIComponent(strWarehouse) +
        '&FromBatch=' + encodeURIComponent(fromBatch) +
        '&ToBatch=' + encodeURIComponent(toBatch) +
        '&ShowSingles=' + encodeURIComponent(showSingles) +
        '&Day=' + encodeURIComponent(nDay);

      setUpdatedNow();

      // -------------------------------------------------------
      // POPRAWKA: runReport ładuje BatchData przez location.replace
      // co powoduje przeładowanie CAŁEJ strony w ramce i resetuje
      // localStorage w Batch Viewer. Teraz używamy href zamiast
      // replace — to nie zmienia zachowania strony, ale URL pozostaje
      // w historii, co ułatwia diagnozę.
      // -------------------------------------------------------
      try {
        if (window.parent && window.parent.frames && window.parent.frames['BatchData']) {
          window.parent.frames['BatchData'].location.href = strURL;
        } else {
          window.location.href = strURL;
        }
      } catch (err) {
        log('runReport fallback:', err);
        window.location.href = strURL;
      }
    };

    const refreshBtn =
      document.querySelector('input[value="Refresh View"]') ||
      document.querySelector('input[onclick*="runReport"]');

    if (refreshBtn) {
      refreshBtn.onclick = function (e) {
        if (e) e.preventDefault();
        window.runReport();
        return false;
      };
    }

    // -------------------------------------------------------
    // POPRAWKA: usunięte automatyczne wywoływanie runReport()
    // przy starcie strony. W oryginalnym skrypcie nie było tego
    // kodu, ale upewniamy się że żaden timer/autostart tu nie
    // istnieje — tylko ręczny klik lub wywołanie z Batch Viewer.
    // -------------------------------------------------------
  }

  // =====================================================
  // PART 2 — Fix P link (BatchPickWalk3.asp) opening in same tab/frame
  // =====================================================
  function installPickWalkFix() {
    if (!isBatchData && !isLocatingFrame) return;

    document.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;

      const href = a.getAttribute('href') || '';
      if (!/batchpickwalk3\.asp/i.test(href)) return;

      e.preventDefault();
      e.stopPropagation();

      const normalized = href.replace(/\\/g, '/');
      let fullURL;

      try {
        fullURL = new URL(normalized, location.href).toString();
      } catch (err) {
        log('Invalid PickWalk URL:', href, err);
        return;
      }

      log('Navigating PickWalk:', fullURL);

      try {
        if (window.parent && window.parent.frames && window.parent.frames['BatchData']) {
          window.parent.frames['BatchData'].location.href = fullURL;
        } else {
          window.location.href = fullURL;
        }
      } catch (err) {
        log('PickWalk navigation fallback:', err);
        window.location.href = fullURL;
      }
    }, true);
  }

  // =====================================================
  // PART 3 — Render Legacy DataGrid from <PARAM R*>
  // =====================================================
  function renderLegacyGridIfPresent() {
    if (!isBatchData && !isBatchPickWalk) return;

    const params = Array.from(document.querySelectorAll('param[name^="R"], param[name^="r"]'))
      .map(p => ({
        name:  (p.getAttribute('name')  || '').trim(),
        value: (p.getAttribute('value') || '').trim()
      }))
      .filter(p => /^R\d+$/i.test(p.name) && p.value);

    if (!params.length) {
      log('No R* params found – nothing to render.');
      return;
    }

    params.sort((a, b) => {
      const na = parseInt(a.name.slice(1), 10) || 0;
      const nb = parseInt(b.name.slice(1), 10) || 0;
      return na - nb;
    });

    const rows = params.map(p => {
      const parts = p.value.split(',').map(x => x.trim());
      return {
        station:    parts[0] ?? '',
        bonus:      parts[1] ?? '',
        outstanding: parts[2] ?? '0',
        packed:     parts[3] ?? '0',
        wrong:      parts[4] ?? '0',
        noStocks:   parts[5] ?? '0',
        missing:    parts[6] ?? '0',
      };
    });

    const titleText = (() => {
      const bodyText   = document.body?.innerText || '';
      const batchMatch = bodyText.match(/Batch:\s*\d+/i);
      const reportTitle = isBatchPickWalk
        ? 'Batch Pick Walk Report'
        : 'Directory Packing Item Status Report';

      return batchMatch ? `${reportTitle}\n${batchMatch[0]}` : reportTitle;
    })();

    const wrapper = document.createElement('div');
    wrapper.style.padding = '10px 12px';
    wrapper.style.fontFamily = 'Verdana, Arial, sans-serif';

    const title = document.createElement('div');
    title.style.whiteSpace    = 'pre-line';
    title.style.fontSize      = '18px';
    title.style.fontWeight    = '700';
    title.style.color         = 'lightgreen';
    title.textContent         = titleText;
    wrapper.appendChild(title);

    const gridBox = document.createElement('div');
    gridBox.style.marginTop = '10px';
    gridBox.style.width     = 'fit-content';
    gridBox.style.maxWidth  = '100%';
    gridBox.style.height    = '75vh';
    gridBox.style.overflow  = 'auto';
    gridBox.style.border    = '2px solid #0b2f4a';
    gridBox.style.background = 'rgb(250,235,215)';
    wrapper.appendChild(gridBox);

    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    table.style.minWidth       = '520px';

    const headers = [
      'Packing Station', 'Bonus Number', 'Outstanding',
      'Packed', 'Wrong Picks', 'No Stocks', 'Missing Items'
    ];

    const thead = document.createElement('thead');
    const hr    = document.createElement('tr');

    headers.forEach(h => {
      const th = document.createElement('th');
      th.textContent        = h;
      th.style.background   = '#000';
      th.style.color        = '#fff';
      th.style.border       = '1px solid #1b3f5c';
      th.style.padding      = '4px 6px';
      th.style.fontSize     = '12px';
      th.style.position     = 'sticky';
      th.style.top          = '0';
      th.style.zIndex       = '1';
      hr.appendChild(th);
    });

    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.style.background = 'lightyellow';

      const cells = [r.station, r.bonus, r.outstanding, r.packed, r.wrong, r.noStocks, r.missing];
      cells.forEach((v, idx) => {
        const td = document.createElement('td');
        td.textContent       = v;
        td.style.border      = '1px solid #1b3f5c';
        td.style.padding     = '3px 6px';
        td.style.fontSize    = '12px';
        td.style.whiteSpace  = 'nowrap';
        td.style.color       = '#000';
        td.style.textAlign   = idx >= 2 ? 'right' : 'left';
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    gridBox.appendChild(table);

    const btnRow  = document.createElement('div');
    btnRow.style.marginTop = '10px';

    const btnCopy  = document.createElement('button');
    btnCopy.textContent  = 'Copy to Clipboard';
    btnCopy.style.marginRight = '10px';

    const btnPrint = document.createElement('button');
    btnPrint.textContent = 'Print';

    btnCopy.addEventListener('click', async () => {
      const headerLine = headers.join('\t');
      const lines = rows.map(x =>
        [x.station, x.bonus, x.outstanding, x.packed, x.wrong, x.noStocks, x.missing].join('\t')
      );
      const text = [headerLine, ...lines].join('\n');

      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value          = text;
        ta.style.position = 'fixed';
        ta.style.left     = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    });

    btnPrint.addEventListener('click', () => window.print());

    btnRow.appendChild(btnCopy);
    btnRow.appendChild(btnPrint);
    wrapper.appendChild(btnRow);

    document.body.innerHTML = '';
    document.body.style.background = '#2f5f86';
    document.body.appendChild(wrapper);

    log('Rendered rows:', rows.length);
  }

  // =====================================================
  // PART 4 — Back to main button
  // =====================================================
  function addBackToMainButton() {
    if (!isBatchData && !isBatchPickWalk) return;

    const MAIN_URL = 'http://ws-whs.next-uk.next.loc/DirectoryManagement/BatchData.asp?Warehouse=Elmsall&FromBatch=1&ToBatch=99&ShowSingles=no&Day=0';

    const createBtn = () => {
      if (document.getElementById('mckBackToMainBtn')) return;

      const btn = document.createElement('button');
      btn.id = 'mckBackToMainBtn';
      btn.textContent = '← Back to Main';

      btn.style.position   = 'fixed';
      btn.style.top        = '10px';
      btn.style.right      = '14px';
      btn.style.zIndex     = '99999';
      btn.style.padding    = '8px 14px';
      btn.style.fontFamily = 'Verdana, Arial, sans-serif';
      btn.style.fontSize   = '12px';
      btn.style.fontWeight = '700';
      btn.style.color      = '#fff';
      btn.style.background = '#0b2f4a';
      btn.style.border     = '2px solid #1b3f5c';
      btn.style.borderRadius = '6px';
      btn.style.cursor     = 'pointer';
      btn.style.boxShadow  = '0 2px 8px rgba(0,0,0,0.35)';

      btn.addEventListener('mouseenter', () => { btn.style.background = '#14507a'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#0b2f4a'; });

      btn.addEventListener('click', () => {
        try {
          if (window.parent && window.parent.frames && window.parent.frames['BatchData']) {
            window.parent.frames['BatchData'].location.href = MAIN_URL;
          } else {
            window.location.href = MAIN_URL;
          }
        } catch (err) {
          log('Back button fallback:', err);
          window.location.href = MAIN_URL;
        }
      });

      document.body.appendChild(btn);
    };

    createBtn();

    const observer = new MutationObserver(() => { createBtn(); });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree:   true
    });
  }

  // =====================================================
  // RUN
  // =====================================================
  installRefreshFix();
  installPickWalkFix();
  renderLegacyGridIfPresent();
  addBackToMainButton();

})();
