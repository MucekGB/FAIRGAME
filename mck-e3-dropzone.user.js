// ==UserScript==
// @name         [MCK] E3 Dropzone
// @namespace    http://tampermonkey.net/
// @version      4.8
// @description
// @author       Mucek
// @match        https://pon-wpws27/Whds.Dashboard.Web/e3/dropzone
// @grant        GM_xmlhttpRequest
// @connect      script.google.com
// @connect      script.googleusercontent.com
// ==/UserScript==

(function () {
  'use strict';

  /**************** CONFIG ****************/
  const WEB_APP_URL =
    "https://script.google.com/a/macros/next.co.uk/s/AKfycbyOvsue4d3_oOrGYsT8qBwLECyHsLQz9JCbL_e84SrFAIu89yTdyxYkew0jYF03GSLk/exec";

  const CLEAR_INTERVAL_DAYS = 2;

  // How long (ms) to wait for the table to update after clicking a label.
  // After midnight the page may be slower to re-render, so we poll instead of
  // relying on a single fixed delay.
  const POLL_TIMEOUT_MS   = 5000;   // give up after this
  const POLL_INTERVAL_MS  = 100;    // check this often

  /**************** AUTO-CLEAR LOGS ****************/
  const lastClear = localStorage.getItem('TY_Logs_LastClear');
  const nowTs = Date.now();

  if (!lastClear || (nowTs - Number(lastClear)) > CLEAR_INTERVAL_DAYS * 86400000) {
    localStorage.removeItem('TY_Logs');
    localStorage.setItem('TY_Logs_LastClear', nowTs.toString());
    console.log('[DZ] Local logs auto-cleared');
  }

  /**************** UI CSS ****************/
  const style = document.createElement('style');
  style.textContent = `
  /* ===== TOP CENTER BAR ===== */
  .dz-bar{
    position: fixed;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;

    display: flex;
    align-items: center;
    gap: 10px;

    width: 940px;
    max-width: calc(100vw - 24px);

    padding: 12px 14px;
    background: rgba(10,10,12,0.82);
    color: #fff;
    border: 1px solid rgba(255,255,255,0.16);
    border-top: 0;
    border-radius: 0 0 14px 14px;

    font-family: "Roboto Mono", monospace;
    font-weight: 800;
    letter-spacing: .2px;

    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 2px 10px rgba(0,0,0,0.55);

    overflow: hidden;
  }

  .dz-left{
    display:flex;
    align-items:center;
    gap: 10px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .dz-title{
    font-size: 12px;
    opacity: .9;
    white-space: nowrap;
    flex: 0 0 auto;
  }

  .dz-pills{
    display:flex;
    align-items:center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
    white-space: nowrap;
  }

  .dz-pill{
    display:flex;
    align-items:center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.06);
    cursor: pointer;
    user-select: none;
    transition: transform .12s ease, background .12s ease, border-color .12s ease, box-shadow .12s ease;

    flex: 1 1 0;
    min-width: 0;
  }
  .dz-pill:hover{
    background: rgba(255,255,255,0.10);
    border-color: rgba(255,255,255,0.22);
    transform: translateY(-1px);
  }
  .dz-pill:active{ transform: translateY(0px) scale(0.99); }

  .dz-pill.active{
    border-color: rgba(0,200,255,0.45);
    background: rgba(0,200,255,0.14);
    box-shadow: 0 0 0 2px rgba(0,200,255,0.10) inset;
  }

  .dz-badge{
    width: 18px;
    height: 18px;
    border-radius: 6px;
    display:flex;
    align-items:center;
    justify-content:center;
    background: rgba(0,0,0,0.22);
    border: 1px solid rgba(255,255,255,0.14);
    font-size: 11px;
    flex: 0 0 auto;
  }

  .dz-label{
    font-size: 12px;
    opacity: .92;
    flex: 0 0 auto;
  }

  .dz-val{
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-left: auto;
    text-align: right;
    max-width: 300px;
    flex: 1 1 auto;
  }

  .dz-val.y{ color: #ffd800; }
  .dz-val.t{ color: #87cefa; }

  .dz-actions{
    display:flex;
    align-items:center;
    gap: 8px;
    flex: 0 0 auto;
  }

  .dz-chip{
    width: 34px;
    height: 30px;
    display:flex;
    align-items:center;
    justify-content:center;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.14);
    background: rgba(255,255,255,0.06);
    cursor:pointer;
    user-select:none;
    transition: transform .12s ease, background .12s ease, border-color .12s ease, box-shadow .12s ease;
    flex: 0 0 auto;
  }
  .dz-chip:hover{ background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.22); transform: translateY(-1px); }
  .dz-chip:active{ transform: translateY(0px) scale(0.98); }
  .dz-chip input{ display:none; }

  /* Green highlight on buttons when enabled */
  .dz-chip.on{
    background: rgba(0, 255, 120, 0.16);
    border-color: rgba(0, 255, 120, 0.40);
    box-shadow: 0 0 0 2px rgba(0, 255, 120, 0.10) inset;
  }

  /* ===== TOAST / STATUS ===== */
  .dz-status{
    position: fixed;
    left: 50%;
    transform: translateX(-50%) translateY(8px);
    z-index: 10001;

    display: flex;
    align-items: center;
    gap: 10px;

    padding: 8px 16px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.16);
    background: rgba(20,20,24,0.90);
    color: #fff;

    font-family: "Roboto Mono", monospace;
    font-size: 13px;
    font-weight: 700;

    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    box-shadow: 0 4px 18px rgba(0,0,0,0.50);

    opacity: 0;
    pointer-events: none;
    transition: opacity .22s ease, transform .22s ease;
  }
  .dz-status.show{
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
  .dz-status.info   { border-color: rgba(0,200,255,0.40); }
  .dz-status.infoOff{ border-color: rgba(180,180,180,0.30); }
  .dz-status.fail   { border-color: rgba(255,80,80,0.50); color: #ff8080; }

  .dz-status .right{
    opacity: .70;
    font-size: 12px;
  }
  `;
  document.documentElement.appendChild(style);

  /**************** WIDGET DOM ****************/
  const bar = document.createElement('div');
  bar.className = 'dz-bar';
  document.body.appendChild(bar);

  const left = document.createElement('div');
  left.className = 'dz-left';
  bar.appendChild(left);

  const title = document.createElement('div');
  title.className = 'dz-title';
  title.textContent = 'E3 Dropzone';
  left.appendChild(title);

  const pills = document.createElement('div');
  pills.className = 'dz-pills';
  left.appendChild(pills);

  function makePill(key, label, valClass) {
    const pill = document.createElement('div');
    pill.className = 'dz-pill';
    pill.dataset.key = key;
    pill.innerHTML = `
      <span class="dz-badge">${key}</span>
      <span class="dz-label">${label}</span>
      <span class="dz-val ${valClass || ''}" data-val>--</span>
    `;
    pills.appendChild(pill);
    return pill;
  }

  const pillAll = makePill('A', 'ALL', '');
  const pillY   = makePill('Y', 'YEST', 'y');
  const pillT   = makePill('T', 'TODAY', 't');

  const actions = document.createElement('div');
  actions.className = 'dz-actions';
  bar.appendChild(actions);

  const downloadBtn = document.createElement('div');
  downloadBtn.className = 'dz-chip';
  downloadBtn.title = 'Download log';
  downloadBtn.textContent = '📃';
  actions.appendChild(downloadBtn);

  const combinedChip = document.createElement('label');
  combinedChip.className = 'dz-chip';
  combinedChip.title = 'Auto run+refresh (30m aligned)';
  combinedChip.innerHTML = `<input type="checkbox" id="dz-auto-30m"> ⏱`;
  actions.appendChild(combinedChip);

  const status = document.createElement('div');
  status.className = 'dz-status';
  status.innerHTML = `<span class="left">Ready</span><span class="right">--</span>`;
  document.body.appendChild(status);

  const statusLeft  = status.querySelector('.left');
  const statusRight = status.querySelector('.right');

  /**************** STATE ****************/
  // Store raw integers (no formatting) so copy logic never has to strip commas.
  let yesterdayValue = null;   // number | null
  let todayValue     = null;   // number | null
  let isRunning      = false;
  let lastPushedSlot = null;
  let alignedTimeout  = null;
  let alignedInterval = null;

  /**************** HELPERS ****************/
  const pad = n => String(n).padStart(2, '0');

  function formatTimestamp(d) {
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ` +
           `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function formatNumber(n) {
    if (n === null || n === undefined || n === '' || isNaN(Number(n))) return '--';
    return Number(n).toLocaleString('en-GB');
  }

  // Returns a plain integer string (no commas, no spaces) ready to copy.
  function toPlainInt(n) {
    if (n === null || n === undefined || isNaN(Number(n))) return '';
    return String(Math.round(Number(n)));
  }

  async function copyText(text) {
    const v = (text ?? '').toString().trim();
    if (!v) return false;

    try {
      await navigator.clipboard.writeText(v);
      return true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = v;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
      } catch (e) {
        return false;
      }
    }
  }

  function toast(type, leftText, rightText) {
    clearTimeout(status._t);

    status.classList.remove('info', 'infoOff', 'fail');
    if (type === 'info')    status.classList.add('info');
    if (type === 'infoOff') status.classList.add('infoOff');
    if (type === 'fail')    status.classList.add('fail');

    statusLeft.textContent  = leftText  || '';
    statusRight.textContent = rightText || '--';

    try {
      const r = bar.getBoundingClientRect();
      status.style.top = Math.round(r.bottom + 10) + 'px';
    } catch (e) {}

    status.classList.add('show');
    status._t = setTimeout(() => status.classList.remove('show'), 2300);
  }

  function setActive(key) {
    [pillAll, pillY, pillT].forEach(p => p.classList.remove('active'));
    const map = { A: pillAll, Y: pillY, T: pillT };
    if (map[key]) map[key].classList.add('active');
  }

  function setChipOn(chipEl, isOn) {
    chipEl.classList.toggle('on', !!isOn);
  }

  function updateWidget() {
    pillY.querySelector('[data-val]').textContent   = formatNumber(yesterdayValue);
    pillT.querySelector('[data-val]').textContent   = formatNumber(todayValue);

    const both = (yesterdayValue !== null && todayValue !== null);
    const sum  = both ? (Number(yesterdayValue) + Number(todayValue)) : null;
    pillAll.querySelector('[data-val]').textContent = formatNumber(sum);
  }

  function logLocal(y, t) {
    const logs = JSON.parse(localStorage.getItem('TY_Logs') || '[]');
    logs.push({ timestamp: formatTimestamp(new Date()), Y: y, T: t });
    localStorage.setItem('TY_Logs', JSON.stringify(logs));
  }

  function clearTimers() {
    if (alignedTimeout)  clearTimeout(alignedTimeout);
    if (alignedInterval) clearInterval(alignedInterval);
    alignedTimeout  = null;
    alignedInterval = null;
  }

  /**************** DOM READING (with polling) ****************/
  // Snapshot the current text of the last expanded complete cell.
  function snapshotLastCell() {
    const tds = document.querySelectorAll('td.mat-column-complete.expanded');
    if (!tds.length) return null;
    const div = tds[tds.length - 1].querySelector('div.complete-column > div');
    if (!div) return null;
    const raw = div.textContent.trim().replace(/,/g, '').replace(/\s+/g, '');
    const num = Number(raw);
    return isNaN(num) ? null : num;
  }

  // Click a label, then poll until the last cell text changes (or we time out),
  // and return the new numeric value.  This replaces the brittle fixed 500 ms delay
  // that caused zeros right after midnight when the Angular data refresh is slower.
  function clickLabelAndWait(text) {
    return new Promise((resolve) => {
      const label = [...document.querySelectorAll('div.label-content.ng-star-inserted')]
        .find(d => d.textContent.trim() === text);

      if (!label) {
        console.warn('[DZ] Label not found:', text);
        return resolve(null);
      }

      // Remember the value *before* clicking so we can detect a change.
      const before = snapshotLastCell();

      label.click();

      const deadline = Date.now() + POLL_TIMEOUT_MS;

      const poll = setInterval(() => {
        const after = snapshotLastCell();

        // Accept new value when it differs from what was there before the click.
        // Special-case null→null as "still loading", not a real change.
        const changed = (after !== before) && !(after === null && before === null);

        if (changed || Date.now() >= deadline) {
          clearInterval(poll);

          if (!changed) {
            console.warn('[DZ] Poll timeout waiting for', text, '— using last snapshot');
          }

          resolve(after);
        }
      }, POLL_INTERVAL_MS);
    });
  }

  /**************** GOOGLE SHEET PUSH ****************/
  function pushToSheetIfDue() {
    if (!combinedCheckbox.checked) return;

    const d = new Date();
    const m = d.getMinutes();
    if (m !== 0 && m !== 30) return;

    const slot = `${d.getHours()}:${m}`;
    if (slot === lastPushedSlot) return;
    lastPushedSlot = slot;

    GM_xmlhttpRequest({
      method: 'POST',
      url: WEB_APP_URL,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({
        timestamp: formatTimestamp(d),
        y: yesterdayValue,
        t: todayValue
      }),
      onload: () => console.log('[DZ] Sheet push OK @', slot),
      onerror: e => console.error('[DZ] Sheet push error', e)
    });
  }

  /**************** MAIN SEQUENCE ****************/
  async function runSequence() {
    if (isRunning) return false;
    isRunning = true;

    try {
      // Click YESTERDAY, wait for table to update, read the value.
      yesterdayValue = await clickLabelAndWait('YESTERDAY');
      updateWidget();

      // Click TODAY, wait for table to update, read the value.
      todayValue = await clickLabelAndWait('TODAY');
      updateWidget();

      logLocal(yesterdayValue, todayValue);
      pushToSheetIfDue();

      console.log('[DZ] Cycle complete  Y=%s  T=%s', yesterdayValue, todayValue);
      return true;
    } catch (e) {
      console.error('[DZ] runSequence error', e);
      return false;
    } finally {
      // Always release the lock so a future run is never permanently blocked.
      isRunning = false;
    }
  }

  /**************** 30-MIN COMBINED SCHEDULER ****************/
  function scheduleCombinedRunner() {
    clearTimers();
    if (!combinedCheckbox.checked) return;

    const now  = new Date();
    const next = new Date(now);
    next.setSeconds(0, 0);

    if (now.getMinutes() < 30) next.setMinutes(30);
    else                        next.setMinutes(60);   // rolls to next hour automatically

    const delay = next - now;

    alignedTimeout = setTimeout(async () => {
      if (!combinedCheckbox.checked) return;

      await runSequence();
      try { location.reload(true); } catch (e) { location.reload(); }

      alignedInterval = setInterval(async () => {
        if (!combinedCheckbox.checked) return;
        await runSequence();
        try { location.reload(true); } catch (e) { location.reload(); }
      }, 30 * 60 * 1000);

    }, delay);
  }

  /**************** MIDNIGHT HARD REFRESH ****************/
  // Schedule a reload at 00:00:05 (5-second buffer so the server has time to
  // roll its date before we scrape).  The 30-min scheduler is cleared first to
  // avoid a double reload race.
  (function scheduleMidnightRefresh() {
    const now      = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 5, 0);   // 00:00:05 of the next calendar day

    setTimeout(() => {
      console.log('[DZ] Midnight refresh');
      clearTimers();   // stop the 30-min scheduler before reloading
      location.reload(true);
    }, midnight - now);
  })();

  /**************** DOWNLOAD LOG ****************/
  downloadBtn.addEventListener('click', () => {
    const logs = JSON.parse(localStorage.getItem('TY_Logs') || '[]');
    if (!logs.length) return alert('No logs to download.');

    const text = logs.map(l => `Time: ${l.timestamp}, Y: ${l.Y}, T: ${l.T}`).join('\n');

    const blob = new Blob([text], { type: 'text/plain' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `TY_Log_${formatTimestamp(new Date()).replace(/[/ :]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);

    toast('info', 'ℹ️ Log downloaded', '📃');
  });

  /**************** CLICK-TO-COPY (ALL / Y / T) ****************/
  // Copy is done from the raw numeric state variables, NOT from the formatted
  // display text, so there is never a comma in the copied value.
  async function handleCopy(key) {
    if (key === 'Y') {
      if (yesterdayValue === null) return toast('fail', '⚠️ Copy failed (Y)', '--');
      const plain = toPlainInt(yesterdayValue);
      const ok    = await copyText(plain);
      setActive('Y');
      return ok
        ? toast('', '✅ Copied (Y)', plain)
        : toast('fail', '⚠️ Copy failed (Y)', plain);
    }

    if (key === 'T') {
      if (todayValue === null) return toast('fail', '⚠️ Copy failed (T)', '--');
      const plain = toPlainInt(todayValue);
      const ok    = await copyText(plain);
      setActive('T');
      return ok
        ? toast('', '✅ Copied (T)', plain)
        : toast('fail', '⚠️ Copy failed (T)', plain);
    }

    if (key === 'A') {
      if (yesterdayValue === null || todayValue === null) {
        return toast('fail', '⚠️ Copy failed (ALL)', '--');
      }
      // Copy a plain integer sum — no commas, no formula, just the number.
      const sum   = Math.round(Number(yesterdayValue) + Number(todayValue));
      const plain = String(sum);
      const ok    = await copyText(plain);
      setActive('A');
      return ok
        ? toast('', '✅ Copied (ALL)', plain)
        : toast('fail', '⚠️ Copy failed (ALL)', plain);
    }
  }

  pills.addEventListener('click', (e) => {
    const pill = e.target.closest('.dz-pill');
    if (!pill) return;
    handleCopy(pill.dataset.key);
  }, true);

  /**************** COMBINED AUTO CHECKBOX ****************/
  const combinedCheckbox = combinedChip.querySelector('#dz-auto-30m');

  const prevRun      = sessionStorage.getItem('DZ_AUTO_RUN')     === 'true';
  const prevRefresh  = sessionStorage.getItem('DZ_AUTO_REFRESH') === 'true';
  const prevCombined = sessionStorage.getItem('DZ_AUTO_30M')     === 'true';
  combinedCheckbox.checked = prevCombined || prevRun || prevRefresh;

  sessionStorage.setItem('DZ_AUTO_30M', combinedCheckbox.checked ? 'true' : 'false');
  setChipOn(combinedChip, combinedCheckbox.checked);

  combinedCheckbox.addEventListener('change', () => {
    sessionStorage.setItem('DZ_AUTO_30M', combinedCheckbox.checked ? 'true' : 'false');
    if (combinedCheckbox.checked) {
      sessionStorage.setItem('DZ_AUTO_RUN',     'true');
      sessionStorage.setItem('DZ_AUTO_REFRESH', 'true');
    } else {
      sessionStorage.removeItem('DZ_AUTO_RUN');
      sessionStorage.removeItem('DZ_AUTO_REFRESH');
    }

    setChipOn(combinedChip, combinedCheckbox.checked);

    if (combinedCheckbox.checked) {
      scheduleCombinedRunner();
      toast('info', 'ℹ️ Auto 30m enabled', '⏱');
    } else {
      clearTimers();
      toast('infoOff', 'ℹ️ Auto 30m disabled', '⏱');
    }
  });

  /**************** INIT ****************/
  const wait = setInterval(() => {
    if (document.querySelectorAll('td.mat-column-complete.expanded').length) {
      clearInterval(wait);

      (async () => { await runSequence(); })();

      if (combinedCheckbox.checked) scheduleCombinedRunner();
    }
  }, 500);

})();
