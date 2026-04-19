// ==UserScript==
// @name         [MCK] Progress Overview / PACK /PICK /BBP
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Compact top widget with PACK / BPP / PICK, copy on click, refresh, minimize, resize and hourly auto refresh
// @author       Mateusz Mucek
// @match        http://whds-batchoverviewprogress:8087/Batch/ProgressOverview
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY_MINIMIZED   = 'PROGRESS_WIDGET_MINIMIZED_V21';
    const STORAGE_KEY_EXPANDED    = 'PROGRESS_WIDGET_EXPANDED_V21';
    const STORAGE_KEY_AUTOREFRESH = 'PROGRESS_WIDGET_AUTOREFRESH_V21';
    const STORAGE_KEY_PICKMODE    = 'PROGRESS_WIDGET_PICKMODE_V21'; // 1 = ON, 0 = OFF

    // Maximum ms to wait after switching the day-selector before reading the DOM.
    // The page updates asynchronously; we poll until the data fingerprint changes
    // or we reach this timeout.
    const READ_TIMEOUT_MS  = 8000;
    const READ_POLL_MS     = 80;

    let autoRefreshTimeout = null;

    const state = {
        today:     { pack: '0', bpp: '0', pick: '0' },
        yesterday: { pack: '0', bpp: '0', pick: '0' },
        dby:       { pack: '0', bpp: '0', pick: '0' }
    };

    function ensureFontAwesome() {
        if (document.getElementById('mck-fontawesome-cdn')) return;

        const link = document.createElement('link');
        link.id = 'mck-fontawesome-cdn';
        link.rel = 'stylesheet';
        link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css';
        document.head.appendChild(link);
    }

    function removeCommas(value) {
        return String(value ?? '').replace(/,/g, '').trim();
    }

    function copyText(text) {
        const value = removeCommas(text);

        if (!value || value === '0') {
            showToast('Nothing to copy');
            return;
        }

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(value)
                .then(() => showToast(`Copied: ${value}`))
                .catch(() => fallbackCopyText(value));
            return;
        }

        fallbackCopyText(value);
    }

    function fallbackCopyText(value) {
        try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-9999px';
            ta.style.left = '-9999px';
            ta.style.opacity = '0';
            document.body.appendChild(ta);

            ta.focus();
            ta.select();
            ta.setSelectionRange(0, ta.value.length);

            const ok = document.execCommand('copy');
            document.body.removeChild(ta);

            showToast(ok ? `Copied: ${value}` : 'Copy failed');
        } catch (err) {
            console.error('Copy failed:', err);
            showToast('Copy failed');
        }
    }

    function showToast(message) {
        let toast = document.getElementById('progress-copy-toast');

        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'progress-copy-toast';
            toast.style.cssText = `
                position: fixed;
                top: 54px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(255, 153, 0, 0.14);
                border: 1px solid rgba(255, 153, 0, 0.72);
                color: #fff;
                padding: 8px 14px;
                border-radius: 8px;
                font-family: Segoe UI, Arial, sans-serif;
                font-size: 13px;
                font-weight: 700;
                z-index: 9999999;
                backdrop-filter: blur(8px);
                box-shadow: 0 8px 20px rgba(0,0,0,.35);
                opacity: 0;
                transition: opacity .16s ease;
                pointer-events: none;
                white-space: nowrap;
            `;
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.style.opacity = '1';

        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => {
            toast.style.opacity = '0';
        }, 1100);
    }

    function toNumberString(raw) {
        if (!raw) return '0';
        const m = String(raw).match(/[\d,]+/);
        return m ? m[0] : '0';
    }

    // Extract the number from a Packing / Int'l Packing bar-label.
    // Those labels contain the completed count inside parentheses, e.g. "5,000 (3,120)".
    // BPP and Picking labels show the number directly (no parentheses), so they
    // keep using toNumberString() instead of this function.
    function extractPackingValue(raw) {
        if (!raw) return '0';
        const s = String(raw).trim();
        const parenMatch = s.match(/\(([\d,]+)\)\s*$/);
        if (parenMatch) return parenMatch[1];
        return toNumberString(s);
    }

    function parseNumber(value) {
        return parseInt(String(value).replace(/,/g, ''), 10) || 0;
    }

    function sumValues(a, b, c) {
        const n1 = parseNumber(a);
        const n2 = parseNumber(b);
        const n3 = parseNumber(c);
        return (n1 + n2 + n3).toLocaleString();
    }

    function getAllForType(type) {
        return sumValues(
            state.today[type],
            state.yesterday[type],
            state.dby[type]
        );
    }

    function zeroRow() {
        return { pack: '0', bpp: '0', pick: '0' };
    }

    function isRowZero(row) {
        return parseNumber(row.pack) === 0 &&
               parseNumber(row.bpp)  === 0 &&
               parseNumber(row.pick) === 0;
    }

    function isSameRow(a, b) {
        return parseNumber(a.pack) === parseNumber(b.pack) &&
               parseNumber(a.bpp)  === parseNumber(b.bpp)  &&
               parseNumber(a.pick) === parseNumber(b.pick);
    }

    function isMidnightWindow() {
        const hour = new Date().getHours();
        return hour >= 0 && hour < 6; // 00:00 – 05:59
    }

    function loadPickModeState() {
        const raw = localStorage.getItem(STORAGE_KEY_PICKMODE);
        return raw !== '0'; // domyślnie ON
    }

    function savePickModeState(isEnabled) {
        localStorage.setItem(STORAGE_KEY_PICKMODE, isEnabled ? '1' : '0');
    }

    function isPickModeOn() {
        return loadPickModeState();
    }

    function extractProgressContainer() {
        const totalsNode = [...document.querySelectorAll('span.batchNo')]
            .find(el => el.textContent.trim() === 'Totals');

        if (!totalsNode) return null;

        const batchCol = totalsNode.closest('div.batch-number-column');
        if (!batchCol) return null;

        const idMatch = (batchCol.id || '').match(/BatchNoCol-(\d+)/);
        if (!idMatch) return null;

        return document.querySelector(`#BatchProgress-${idMatch[1]}`);
    }

    // Returns a stable "fingerprint" string of the current progress numbers so we
    // can detect when the page has actually finished re-rendering after a day switch.
    function getProgressFingerprint(progressEl) {
        if (!progressEl) return '';
        const ids = [
            '#ProgRow-Totals_Picking-999999999 .bar-label',
            '#ProgRow-Totals_BPP-999999999 .bar-label',
            '#ProgRow-Totals_Packing-999999999 .bar-label',
            '#ProgRow-Totals_Int_l_Packing-999999999 .bar-label'
        ];
        return ids.map(sel => progressEl.querySelector(sel)?.textContent?.trim() || '').join('|');
    }

    // PACK  = Packing completed + Int'l Packing completed
    // BPP   = BPP completed
    // PICK  = Picking completed
    // All three use extractBarValue() so parenthesised and plain formats both work.
    function extractValuesFromProgress(progressEl) {
        if (!progressEl) return zeroRow();

        const pickRaw    = progressEl.querySelector('#ProgRow-Totals_Picking-999999999 .bar-label')?.textContent?.trim()        || '0';
        const bppRaw     = progressEl.querySelector('#ProgRow-Totals_BPP-999999999 .bar-label')?.textContent?.trim()            || '0';
        const packingRaw = progressEl.querySelector('#ProgRow-Totals_Packing-999999999 .bar-label')?.textContent?.trim()        || '0';
        const intlRaw    = progressEl.querySelector('#ProgRow-Totals_Int_l_Packing-999999999 .bar-label')?.textContent?.trim()  || '0';

        const packing = extractPackingValue(packingRaw);
        const intl    = extractPackingValue(intlRaw);
        const packSum = (parseNumber(packing) + parseNumber(intl)).toLocaleString();

        return {
            pack: packSum,
            bpp:  toNumberString(bppRaw),
            pick: toNumberString(pickRaw)
        };
    }

    function setProgressDayByIndex(index) {
        const sel = document.querySelector('#ProgressDay');
        if (!sel) return false;

        const opt = sel.querySelectorAll('option')[index];
        if (!opt) return false;

        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Switch to day <index> and then POLL until the progress container fingerprint
    // actually changes from what it was before the switch, or READ_TIMEOUT_MS elapses.
    // This replaces the original fixed 1100 ms sleep which was the primary cause of
    // stale / wrong numbers being displayed when the page rendered slower than expected.
    async function readDay(index) {
        const ok = setProgressDayByIndex(index);
        if (!ok) return zeroRow();

        // Capture the fingerprint that was on screen BEFORE the day switch.
        const before = getProgressFingerprint(extractProgressContainer());

        const deadline = Date.now() + READ_TIMEOUT_MS;
        let progressEl = null;

        while (Date.now() < deadline) {
            await wait(READ_POLL_MS);
            progressEl = extractProgressContainer();
            const after = getProgressFingerprint(progressEl);

            // Treat a change in fingerprint as "page has re-rendered".
            if (after !== before) break;
        }

        if (!progressEl) return zeroRow();
        return extractValuesFromProgress(progressEl);
    }

    function applyPickModeRules(todayData, yesterdayData, dbyData) {
        const pickModeOn    = isPickModeOn();
        const midnightWindow = isMidnightWindow();

        if (pickModeOn) {
            return {
                today:     todayData,
                yesterday: yesterdayData,
                dby:       midnightWindow ? dbyData : zeroRow()
            };
        }

        // PICK MODE OFF:
        // Today   – normal (all columns)
        // Yest    – PICK only visible 00:00–05:59
        // DBY     – PICK always 0
        return {
            today: {
                pack: todayData.pack,
                bpp:  todayData.bpp,
                pick: todayData.pick
            },
            yesterday: {
                pack: yesterdayData.pack,
                bpp:  yesterdayData.bpp,
                pick: midnightWindow ? yesterdayData.pick : '0'
            },
            dby: {
                pack: dbyData.pack,
                bpp:  dbyData.bpp,
                pick: '0'
            }
        };
    }

    function applyMidnightTodayZeroFix(data) {
        if (!isMidnightWindow()) return data;

        // If "Today" looks like a carbon-copy of "Yesterday" it is almost certainly
        // stale data carried over from the previous day — zero it out until the new
        // day's numbers appear.
        const todayLooksCopiedFromYesterday =
            isSameRow(data.today, data.yesterday) && !isRowZero(data.today);

        if (todayLooksCopiedFromYesterday) {
            data.today = zeroRow();
        }

        return data;
    }

    async function refreshAllDays() {
        try {
            setRefreshState(true);

            const midnightWindow = isMidnightWindow();

            let rawDby = zeroRow();
            if (midnightWindow) {
                rawDby = await readDay(2);
            }

            const rawYesterday = await readDay(1);
            const rawToday     = await readDay(0);

            let nextData = applyPickModeRules(rawToday, rawYesterday, rawDby);
            nextData = applyMidnightTodayZeroFix(nextData);

            state.today     = nextData.today;
            state.yesterday = nextData.yesterday;
            state.dby       = nextData.dby;

            renderValues();

            const pickText = isPickModeOn() ? 'PICK ON' : 'PICK OFF';
            showToast(`Data refreshed (${pickText})`);
        } catch (err) {
            console.error(err);
            showToast('Refresh error');
        } finally {
            setRefreshState(false);
        }
    }

    function injectStyles() {
        if (document.getElementById('progress-top-widget-style')) return;

        const style = document.createElement('style');
        style.id = 'progress-top-widget-style';
        style.textContent = `
            #progress-top-widget {
                position: fixed;
                top: 0;
                left: 50%;
                transform: translateX(-50%);
                z-index: 999999;
                width: min(760px, 96vw);
                padding: 8px 10px 10px;
                background: rgba(10, 10, 12, 0.96);
                border: 1px solid rgba(255,255,255,0.08);
                border-top: none;
                border-radius: 0 0 14px 14px;
                box-shadow: 0 10px 28px rgba(0,0,0,0.34);
                backdrop-filter: blur(8px);
                font-family: Segoe UI, Arial, sans-serif;
                color: #fff;
                transition: width .16s ease;
            }

            #progress-top-widget.progress-expanded:not(.progress-minimized) {
                width: min(980px, 98vw);
            }

            #progress-top-widget.progress-minimized {
                width: auto;
                min-width: 0;
                padding: 8px;
            }

            #progress-top-widget .progress-main {
                display: block;
            }

            #progress-top-widget.progress-minimized .progress-main {
                display: none;
            }

            #progress-top-widget .progress-grid {
                display: grid;
                grid-template-columns: repeat(3, 1fr);
                gap: 8px;
            }

            #progress-top-widget.progress-expanded:not(.progress-minimized) .progress-grid {
                gap: 10px;
            }

            #progress-top-widget .progress-card {
                background: rgba(255,255,255,0.035);
                border: 1px solid rgba(255,255,255,0.06);
                border-radius: 10px;
                padding: 8px;
            }

            #progress-top-widget.progress-expanded:not(.progress-minimized) .progress-card {
                padding: 10px;
            }

            #progress-top-widget .progress-card-title {
                text-align: center;
                font-size: 13px;
                font-weight: 800;
                letter-spacing: .5px;
                color: #ffcf70;
                margin-bottom: 8px;
            }

            #progress-top-widget.progress-expanded:not(.progress-minimized) .progress-card-title {
                font-size: 14px;
                margin-bottom: 10px;
            }

            #progress-top-widget .progress-card-title-row {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 8px;
                flex-wrap: nowrap;
            }

            #progress-top-widget .pick-toggle-wrap {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                margin-left: 2px;
            }

            #progress-top-widget .pick-toggle-text {
                font-size: 10px;
                font-weight: 800;
                color: rgba(255,255,255,0.78);
                letter-spacing: .4px;
            }

            #progress-top-widget .pick-switch {
                position: relative;
                display: inline-block;
                width: 36px;
                height: 20px;
                flex: 0 0 auto;
            }

            #progress-top-widget .pick-switch input {
                opacity: 0;
                width: 0;
                height: 0;
                position: absolute;
            }

            #progress-top-widget .pick-slider {
                position: absolute;
                inset: 0;
                cursor: pointer;
                background: rgba(255,255,255,0.14);
                border: 1px solid rgba(255,255,255,0.12);
                border-radius: 999px;
                transition: .16s ease;
            }

            #progress-top-widget .pick-slider::before {
                content: "";
                position: absolute;
                height: 14px;
                width: 14px;
                left: 2px;
                top: 2px;
                border-radius: 50%;
                background: #fff;
                box-shadow: 0 1px 6px rgba(0,0,0,.35);
                transition: .16s ease;
            }

            #progress-top-widget .pick-switch input:checked + .pick-slider {
                background: rgba(255,166,0,.22);
                border-color: rgba(255,166,0,.70);
            }

            #progress-top-widget .pick-switch input:checked + .pick-slider::before {
                transform: translateX(16px);
            }

            #progress-top-widget .progress-rows {
                display: grid;
                gap: 6px;
            }

            #progress-top-widget.progress-expanded:not(.progress-minimized) .progress-rows {
                gap: 8px;
            }

            #progress-top-widget .progress-row {
                display: grid;
                grid-template-columns: 62px 1fr;
                gap: 6px;
                align-items: center;
            }

            #progress-top-widget.progress-expanded:not(.progress-minimized) .progress-row {
                grid-template-columns: 72px 1fr;
                gap: 8px;
            }

            #progress-top-widget .progress-label {
                font-size: 11px;
                font-weight: 700;
                color: rgba(255,255,255,.72);
                text-transform: uppercase;
            }

            #progress-top-widget.progress-expanded:not(.progress-minimized) .progress-label {
                font-size: 12px;
            }

            #progress-top-widget .progress-value {
                height: 28px;
                display: flex;
                align-items: center;
                justify-content: flex-end;
                padding: 0 10px;
                border-radius: 8px;
                background: rgba(255,255,255,0.05);
                border: 1px solid rgba(255,255,255,0.08);
                font-size: 14px;
                font-weight: 800;
                cursor: pointer;
                user-select: none;
                transition: .14s ease;
            }

            #progress-top-widget.progress-expanded:not(.progress-minimized) .progress-value {
                height: 34px;
                font-size: 16px;
                padding: 0 12px;
            }

            #progress-top-widget .progress-value:hover {
                background: rgba(255,166,0,.10);
                border-color: rgba(255,166,0,.55);
            }

            #progress-top-widget .progress-bottom {
                display: grid;
                grid-template-columns: 1fr auto 1fr;
                align-items: center;
                gap: 10px;
                margin-top: 8px;
            }

            #progress-top-widget.progress-minimized .progress-bottom {
                display: flex;
                justify-content: center;
                align-items: center;
                margin-top: 0;
                gap: 0;
            }

            #progress-top-widget .progress-status {
                font-size: 11px;
                color: rgba(255,255,255,.68);
                white-space: nowrap;
                justify-self: start;
            }

            #progress-top-widget.progress-minimized .progress-status {
                display: none;
            }

            #progress-top-widget .progress-center-actions {
                display: flex;
                justify-content: center;
                align-items: center;
                gap: 6px;
            }

            #progress-top-widget.progress-minimized .progress-center-actions {
                display: none;
            }

            #progress-top-widget .progress-actions {
                display: flex;
                align-items: center;
                gap: 6px;
                justify-self: end;
            }

            #progress-top-widget.progress-minimized .progress-actions {
                justify-content: center;
            }

            #progress-top-widget.progress-minimized .progress-actions > * {
                display: none;
            }

            #progress-top-widget.progress-minimized .progress-actions #progress-minimize {
                display: inline-flex;
            }

            #progress-top-widget .progress-btn {
                height: 28px;
                min-width: 34px;
                padding: 0 10px;
                border-radius: 8px;
                border: 1px solid rgba(255,255,255,0.10);
                background: rgba(255,255,255,0.06);
                color: #fff;
                font-size: 12px;
                font-weight: 800;
                cursor: pointer;
                transition: .14s ease;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }

            #progress-top-widget .progress-btn:hover {
                background: rgba(255,166,0,.12);
                border-color: rgba(255,166,0,.55);
            }

            #progress-top-widget .progress-btn.progress-size-btn {
                min-width: 54px;
                padding: 0 12px;
            }

            #progress-top-widget .progress-btn.progress-auto-btn.active {
                background: rgba(255,166,0,.16);
                border-color: rgba(255,166,0,.70);
                color: #ffd27a;
            }

            #progress-top-widget .progress-btn.icon-only {
                width: 34px;
                min-width: 34px;
                padding: 0;
            }

            #progress-top-widget .progress-btn i {
                font-size: 12px;
                line-height: 1;
                pointer-events: none;
            }

            @media (max-width: 720px) {
                #progress-top-widget {
                    width: 98vw;
                }

                #progress-top-widget.progress-expanded:not(.progress-minimized) {
                    width: 99vw;
                }

                #progress-top-widget .progress-grid {
                    grid-template-columns: 1fr;
                }

                #progress-top-widget .progress-bottom {
                    grid-template-columns: 1fr;
                    gap: 8px;
                }

                #progress-top-widget .progress-status,
                #progress-top-widget .progress-center-actions,
                #progress-top-widget .progress-actions {
                    justify-self: stretch;
                }

                #progress-top-widget .progress-center-actions {
                    justify-content: center;
                }

                #progress-top-widget .progress-actions {
                    justify-content: flex-end;
                    flex-wrap: wrap;
                }

                #progress-top-widget.progress-minimized .progress-bottom {
                    display: flex;
                    justify-content: center;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function createWidget() {
        if (document.getElementById('progress-top-widget')) return;

        ensureFontAwesome();
        injectStyles();

        const wrap = document.createElement('div');
        wrap.id = 'progress-top-widget';
        wrap.innerHTML = `
            <div class="progress-main">
                <div class="progress-grid">
                    <div class="progress-card">
                        <div class="progress-card-title">PACK</div>
                        <div class="progress-rows">
                            <div class="progress-row"><div class="progress-label">Today</div><div class="progress-value" data-copy="today:pack">0</div></div>
                            <div class="progress-row"><div class="progress-label">Yest</div><div class="progress-value" data-copy="yesterday:pack">0</div></div>
                            <div class="progress-row"><div class="progress-label">DBY</div><div class="progress-value" data-copy="dby:pack">0</div></div>
                            <div class="progress-row"><div class="progress-label">All</div><div class="progress-value" data-copy="all:pack">0</div></div>
                        </div>
                    </div>

                    <div class="progress-card">
                        <div class="progress-card-title">BPP</div>
                        <div class="progress-rows">
                            <div class="progress-row"><div class="progress-label">Today</div><div class="progress-value" data-copy="today:bpp">0</div></div>
                            <div class="progress-row"><div class="progress-label">Yest</div><div class="progress-value" data-copy="yesterday:bpp">0</div></div>
                            <div class="progress-row"><div class="progress-label">DBY</div><div class="progress-value" data-copy="dby:bpp">0</div></div>
                            <div class="progress-row"><div class="progress-label">All</div><div class="progress-value" data-copy="all:bpp">0</div></div>
                        </div>
                    </div>

                    <div class="progress-card">
                        <div class="progress-card-title">
                            <div class="progress-card-title-row">
                                <span>PICK</span>
                                <div class="pick-toggle-wrap" title="PICK special mode On / Off">
                                    <span class="pick-toggle-text" id="pick-toggle-text">ON</span>
                                    <label class="pick-switch">
                                        <input type="checkbox" id="pick-mode-toggle" checked>
                                        <span class="pick-slider"></span>
                                    </label>
                                </div>
                            </div>
                        </div>
                        <div class="progress-rows">
                            <div class="progress-row"><div class="progress-label">Today</div><div class="progress-value" data-copy="today:pick">0</div></div>
                            <div class="progress-row"><div class="progress-label">Yest</div><div class="progress-value" data-copy="yesterday:pick">0</div></div>
                            <div class="progress-row"><div class="progress-label">DBY</div><div class="progress-value" data-copy="dby:pick">0</div></div>
                            <div class="progress-row"><div class="progress-label">All</div><div class="progress-value" data-copy="all:pick">0</div></div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="progress-bottom">
                <div class="progress-status" id="progress-status">Waiting for refresh...</div>

                <div class="progress-center-actions">
                    <button class="progress-btn progress-size-btn" id="progress-size-toggle" title="Resize panel">Size</button>
                </div>

                <div class="progress-actions">
                    <button class="progress-btn progress-auto-btn" id="progress-auto-refresh" title="Auto refresh every full hour">Auto</button>
                    <button class="progress-btn" id="progress-refresh">Refresh</button>
                    <button class="progress-btn icon-only" id="progress-minimize" title="Minimize / Expand">
                        <i class="fa-solid fa-compress"></i>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(wrap);
        applyMinimizedState(loadMinimizedState());
        applyExpandedState(loadExpandedState());
        applyAutoRefreshState(loadAutoRefreshState());
        applyPickModeState(loadPickModeState());
        bindEvents();
    }

    function loadMinimizedState() {
        return localStorage.getItem(STORAGE_KEY_MINIMIZED) === '1';
    }

    function saveMinimizedState(isMinimized) {
        localStorage.setItem(STORAGE_KEY_MINIMIZED, isMinimized ? '1' : '0');
    }

    function loadExpandedState() {
        return localStorage.getItem(STORAGE_KEY_EXPANDED) === '1';
    }

    function saveExpandedState(isExpanded) {
        localStorage.setItem(STORAGE_KEY_EXPANDED, isExpanded ? '1' : '0');
    }

    function loadAutoRefreshState() {
        return localStorage.getItem(STORAGE_KEY_AUTOREFRESH) === '1';
    }

    function saveAutoRefreshState(isEnabled) {
        localStorage.setItem(STORAGE_KEY_AUTOREFRESH, isEnabled ? '1' : '0');
    }

    function applyMinimizedState(isMinimized) {
        const widget = document.getElementById('progress-top-widget');
        const btn    = document.getElementById('progress-minimize');
        if (!widget || !btn) return;

        widget.classList.toggle('progress-minimized', isMinimized);
        btn.title = isMinimized ? 'Expand' : 'Minimize';
        btn.innerHTML = isMinimized
            ? '<i class="fa-solid fa-expand"></i>'
            : '<i class="fa-solid fa-compress"></i>';
    }

    function applyExpandedState(isExpanded) {
        const widget = document.getElementById('progress-top-widget');
        const btn    = document.getElementById('progress-size-toggle');
        if (!widget || !btn) return;

        widget.classList.toggle('progress-expanded', isExpanded);
        btn.textContent = isExpanded ? 'Small' : 'Size';
        btn.title = isExpanded ? 'Back to normal size' : 'Make panel bigger';
    }

    function applyAutoRefreshState(isEnabled) {
        const btn = document.getElementById('progress-auto-refresh');
        if (!btn) return;

        btn.classList.toggle('active', isEnabled);
        btn.textContent = isEnabled ? 'Auto On' : 'Auto';
        btn.title = isEnabled ? 'Auto refresh is enabled' : 'Auto refresh every full hour';
    }

    function applyPickModeState(isEnabled) {
        const input = document.getElementById('pick-mode-toggle');
        const text  = document.getElementById('pick-toggle-text');
        if (!input || !text) return;

        input.checked    = isEnabled;
        text.textContent = isEnabled ? 'ON' : 'OFF';
    }

    function toggleMinimizedState() {
        const widget = document.getElementById('progress-top-widget');
        if (!widget) return;

        const isMinimized = !widget.classList.contains('progress-minimized');
        applyMinimizedState(isMinimized);
        saveMinimizedState(isMinimized);
    }

    function toggleExpandedState() {
        const widget = document.getElementById('progress-top-widget');
        if (!widget) return;

        const isExpanded = !widget.classList.contains('progress-expanded');
        applyExpandedState(isExpanded);
        saveExpandedState(isExpanded);
    }

    function togglePickModeState() {
        const enabled = !isPickModeOn();
        savePickModeState(enabled);
        applyPickModeState(enabled);
        showToast(enabled ? 'PICK mode ON' : 'PICK mode OFF');
        refreshAllDays();
    }

    function isAutoRefreshEnabled() {
        return loadAutoRefreshState();
    }

    function getMsUntilNextFullHour() {
        const now  = new Date();
        const next = new Date(now);
        next.setMinutes(60, 0, 0);
        return next.getTime() - now.getTime();
    }

    function clearAutoRefreshTimer() {
        if (autoRefreshTimeout) {
            clearTimeout(autoRefreshTimeout);
            autoRefreshTimeout = null;
        }
    }

    function scheduleNextAutoRefresh() {
        clearAutoRefreshTimer();

        if (!isAutoRefreshEnabled()) return;

        const msUntilNextHour = getMsUntilNextFullHour();

        autoRefreshTimeout = setTimeout(async () => {
            if (isAutoRefreshEnabled()) {
                await refreshAllDays();
                scheduleNextAutoRefresh();
            }
        }, msUntilNextHour);
    }

    function toggleAutoRefresh() {
        const enabled = !isAutoRefreshEnabled();
        saveAutoRefreshState(enabled);
        applyAutoRefreshState(enabled);

        if (enabled) {
            scheduleNextAutoRefresh();
            showToast('Auto refresh enabled');
        } else {
            clearAutoRefreshTimer();
            showToast('Auto refresh disabled');
        }
    }

    function bindEvents() {
        const root = document.getElementById('progress-top-widget');
        if (!root) return;

        root.addEventListener('click', (e) => {
            const valueEl = e.target.closest('[data-copy]');
            if (valueEl) {
                const [group, key] = valueEl.getAttribute('data-copy').split(':');

                if (group === 'all') {
                    copyText(getAllForType(key));
                    return;
                }

                copyText(state[group][key]);
                return;
            }

            const btn = e.target.closest('button');
            if (btn) {
                if (btn.id === 'progress-refresh')      { refreshAllDays();       return; }
                if (btn.id === 'progress-minimize')     { toggleMinimizedState(); return; }
                if (btn.id === 'progress-size-toggle')  { toggleExpandedState();  return; }
                if (btn.id === 'progress-auto-refresh') { toggleAutoRefresh();    return; }
            }
        });

        const pickToggle = document.getElementById('pick-mode-toggle');
        if (pickToggle) {
            pickToggle.addEventListener('change', () => {
                togglePickModeState();
            });
        }
    }

    function renderValues() {
        const keys   = ['pack', 'bpp', 'pick'];
        const groups = ['today', 'yesterday', 'dby'];

        for (const group of groups) {
            for (const key of keys) {
                const el = document.querySelector(`[data-copy="${group}:${key}"]`);
                if (el) el.textContent = state[group][key] || '0';
            }
        }

        for (const key of keys) {
            const el = document.querySelector(`[data-copy="all:${key}"]`);
            if (el) el.textContent = getAllForType(key);
        }

        const status = document.getElementById('progress-status');
        if (status) {
            const pickModeText = isPickModeOn() ? 'PICK ON' : 'PICK OFF';
            status.textContent = `Refreshed: ${new Date().toLocaleTimeString()} | ${pickModeText}`;
        }
    }

    function setRefreshState(isLoading) {
        const btn    = document.getElementById('progress-refresh');
        const status = document.getElementById('progress-status');
        const widget = document.getElementById('progress-top-widget');

        if (btn) {
            btn.disabled    = isLoading;
            btn.textContent = isLoading ? 'Refreshing...' : 'Refresh';
        }

        if (status && widget && !widget.classList.contains('progress-minimized') && isLoading) {
            status.textContent = 'Refreshing data...';
        }
    }

    function init() {
        createWidget();
        renderValues();

        setTimeout(() => {
            refreshAllDays();
        }, 1200);

        scheduleNextAutoRefresh();
    }

    function waitForPage() {
        if (document.querySelector('#ProgressDay')) {
            init();
        } else {
            setTimeout(waitForPage, 1000);
        }
    }

    waitForPage();
})();
