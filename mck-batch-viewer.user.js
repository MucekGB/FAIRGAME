// ==UserScript==
// @name         [MCK] Batch Viwer (PACK)
// @namespace    Mateusz Mucek
// @version      2.3.0
// @description  Batch click-to-copy numbers + sticky top header + sticky bottom ALL + saved filters + hourly auto refresh toggle + custom batch range + styled day selector
// @match        http://ws-whs/DirectoryManagement/*BatchData.asp*
// @match        http://ws-whs.next-uk.next.loc/DirectoryManagement/*BatchData.asp*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    const BOX_ID = "mck-batch-viewer";
    const LS_MIN = "mck_batchviewer_minimized";
    const LS_EXPANDED = "mck_batchviewer_expanded";
    const LS_FILTER = "mck_batchviewer_filter";
    const LS_FROM = "mck_batchviewer_from_batch";
    const LS_TO = "mck_batchviewer_to_batch";
    const LS_DAY = "mck_batchviewer_day";
    const LS_AUTOREFRESH = "mck_batchviewer_autorefresh";

    let hourlyRefreshTimer = null;

    if (document.getElementById(BOX_ID)) return;

    function ensureFontAwesome() {
        if (document.getElementById("mck-fontawesome-cdn")) return;
        const link = document.createElement("link");
        link.id = "mck-fontawesome-cdn";
        link.rel = "stylesheet";
        link.href = "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css";
        document.head.appendChild(link);
    }
    ensureFontAwesome();

    function normalizeNumber(v) {
        const s = String(v ?? "").replace(/,/g, "").trim();
        const cleaned = s.match(/-?\d+(\.\d+)?/g);
        return cleaned ? cleaned.join("") : "0";
    }

    function formatNowTime() {
        return new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        });
    }

    function setStatusTime() {
        const status = document.getElementById("mck-status");
        if (status) status.textContent = formatNowTime();
    }

    function getDayLabel(day) {
        const d = String(day);
        if (d === "0") return "0 - Today";
        if (d === "1") return "1 - Yesterday";
        if (d === "2") return "2 - 2 days ago";
        if (d === "3") return "3 - 3 days ago";
        if (d === "4") return "4 - 4 days ago";
        if (d === "5") return "5 - 5 days ago";
        if (d === "6") return "6 - 6 days ago";
        return "0 - Today";
    }

    function showToast(message) {
        let toast = document.getElementById("mck-toast");
        const box = document.getElementById(BOX_ID);

        if (!toast) {
            toast = document.createElement("div");
            toast.id = "mck-toast";
            toast.style.cssText = `
                position: fixed;
                background: rgba(255, 166, 0, 0.14);
                border: 1px solid rgba(255, 166, 0, 0.72);
                color: #fff;
                padding: 8px 14px;
                border-radius: 8px;
                font-family: Segoe UI, Arial, sans-serif;
                font-size: 13px;
                font-weight: 700;
                z-index: 2147483647;
                backdrop-filter: blur(8px);
                box-shadow: 0 8px 20px rgba(0,0,0,.35);
                opacity: 0;
                transition: opacity .16s ease;
                pointer-events: none;
                white-space: nowrap;
            `;
            document.body.appendChild(toast);
        }

        if (box) {
            const rect = box.getBoundingClientRect();
            toast.style.left = (rect.left + 12) + "px";
            toast.style.top = Math.max(8, rect.top - 42) + "px";
            toast.style.transform = "none";
        } else {
            toast.style.left = "50%";
            toast.style.top = "54px";
            toast.style.transform = "translateX(-50%)";
        }

        toast.textContent = message;
        toast.style.opacity = "1";

        clearTimeout(showToast._t);
        showToast._t = setTimeout(function () {
            toast.style.opacity = "0";
        }, 1100);
    }

    function fallbackCopyText(t) {
        try {
            const ta = document.createElement("textarea");
            ta.value = t;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.top = "-9999px";
            ta.style.left = "-9999px";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, ta.value.length);

            const ok = document.execCommand("copy");
            ta.remove();

            showToast(ok ? "Copied: " + t : "Copy failed");
            return ok;
        } catch (err) {
            console.error("Copy failed:", err);
            showToast("Copy failed");
            return false;
        }
    }

    function copyText(text) {
        const t = String(text ?? "").trim();
        if (!t) return false;

        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(t).then(function () {
                showToast("Copied: " + t);
            }).catch(function () {
                fallbackCopyText(t);
            });
            return true;
        }

        return fallbackCopyText(t);
    }

    function getValues(cell) {
        if (!cell) return ["0"];
        const raw = cell.innerHTML
            .replace(/,/g, "")
            .split("<br>")
            .map(function (v) {
                return v.replace(/<[^>]*>/g, "").trim();
            })
            .filter(function (v) {
                return v !== "";
            });
        return raw.length ? raw : ["0"];
    }

    function isMinimized() {
        return localStorage.getItem(LS_MIN) === "1";
    }

    function setMinimized(flag) {
        localStorage.setItem(LS_MIN, flag ? "1" : "0");
    }

    function isExpanded() {
        return localStorage.getItem(LS_EXPANDED) === "1";
    }

    function setExpanded(flag) {
        localStorage.setItem(LS_EXPANDED, flag ? "1" : "0");
    }

    function getFilterMode() {
        return localStorage.getItem(LS_FILTER) || "ALL";
    }

    function setFilterMode(mode) {
        localStorage.setItem(LS_FILTER, mode);
    }

    function isAutoRefreshEnabled() {
        return localStorage.getItem(LS_AUTOREFRESH) === "1";
    }

    function setAutoRefreshEnabled(flag) {
        localStorage.setItem(LS_AUTOREFRESH, flag ? "1" : "0");
    }

    function getCurrentUrlParams() {
        const url = new URL(window.location.href);
        return url.searchParams;
    }

    function getSavedFromBatch() {
        const params = getCurrentUrlParams();
        return localStorage.getItem(LS_FROM) || params.get("FromBatch") || "1";
    }

    function getSavedToBatch() {
        const params = getCurrentUrlParams();
        return localStorage.getItem(LS_TO) || params.get("ToBatch") || "99";
    }

    function getSavedDay() {
        const params = getCurrentUrlParams();
        return localStorage.getItem(LS_DAY) || params.get("Day") || "0";
    }

    function setSavedBatchRange(fromBatch, toBatch) {
        localStorage.setItem(LS_FROM, String(fromBatch));
        localStorage.setItem(LS_TO, String(toBatch));
    }

    function setSavedDay(day) {
        localStorage.setItem(LS_DAY, String(day));
    }

    function sanitizeBatchRangeValue(value, fallback) {
        const n = parseInt(String(value || "").trim(), 10);
        if (isNaN(n)) return fallback;
        if (n < 0) return 0;
        return n;
    }

    function sanitizeDayValue(value, fallback) {
        const n = parseInt(String(value || "").trim(), 10);
        if (isNaN(n)) return fallback;
        if (n < 0) return 0;
        if (n > 6) return 6;
        return n;
    }

    function batchMatchesFilter(batchValue, mode) {
        const n = parseInt(batchValue, 10);
        if (isNaN(n)) return true;

        if (mode === "PR") return n >= 1 && n <= 39;
        if (mode === "OB") return n >= 40 && n <= 79;
        if (mode === "BPP") return n >= 80 && n <= 89;
        return true;
    }

    function getHeaderWindow() {
        try {
            if (window.parent && window.parent.frames) {
                if (window.parent.frames["BatchHeader"]) return window.parent.frames["BatchHeader"];
                if (window.parent.frames["Header"]) return window.parent.frames["Header"];

                for (let i = 0; i < window.parent.frames.length; i++) {
                    const fr = window.parent.frames[i];
                    try {
                        const href = fr.location && fr.location.href ? fr.location.href : "";
                        if (/BatchHeader\.asp/i.test(href)) return fr;
                    } catch (e) {}
                }
            }
        } catch (e) {}

        return null;
    }

    function clickRealRefreshButton() {
        try {
            const headerWin = getHeaderWindow();

            if (headerWin && headerWin.document) {
                const btn =
                    headerWin.document.querySelector('input[name="btnRun"]') ||
                    headerWin.document.querySelector('input[value="Refresh View"]') ||
                    headerWin.document.getElementById('RefreshButton');

                if (btn) {
                    btn.disabled = false;
                    btn.click();
                    return true;
                }

                if (typeof headerWin.runReport === "function") {
                    headerWin.runReport();
                    return true;
                }
            }

            if (window.parent && window.parent.frames) {
                const batchHeader = window.parent.frames["BatchHeader"];
                if (batchHeader && batchHeader.document) {
                    const btn =
                        batchHeader.document.querySelector('input[name="btnRun"]') ||
                        batchHeader.document.querySelector('input[value="Refresh View"]') ||
                        batchHeader.document.getElementById('RefreshButton');

                    if (btn) {
                        btn.disabled = false;
                        btn.click();
                        return true;
                    }

                    if (typeof batchHeader.runReport === "function") {
                        batchHeader.runReport();
                        return true;
                    }
                }
            }
        } catch (err) {
            console.error("[MCK] Refresh click failed:", err);
        }

        return false;
    }

    function buildBatchUrl(fromBatch, toBatch, day) {
        const url = new URL(window.location.href);
        url.searchParams.set("FromBatch", String(fromBatch));
        url.searchParams.set("ToBatch", String(toBatch));
        url.searchParams.set("Day", String(day));

        if (!url.searchParams.get("Warehouse")) url.searchParams.set("Warehouse", "Elmsall");
        if (!url.searchParams.get("ShowSingles")) url.searchParams.set("ShowSingles", "no");

        return url.toString();
    }

    function getRangeInputs() {
        return {
            fromInput: document.getElementById("mck-from-batch"),
            toInput: document.getElementById("mck-to-batch"),
            dayInput: document.getElementById("mck-day-trigger")
        };
    }

    function getBatchRangeFromUI() {
        const { fromInput, toInput, dayInput } = getRangeInputs();

        const fromBatch = sanitizeBatchRangeValue(fromInput ? fromInput.value : getSavedFromBatch(), 1);
        const toBatch = sanitizeBatchRangeValue(toInput ? toInput.value : getSavedToBatch(), 99);
        const day = sanitizeDayValue(dayInput ? dayInput.getAttribute("data-value") : getSavedDay(), 0);

        return {
            fromBatch: Math.min(fromBatch, toBatch),
            toBatch: Math.max(fromBatch, toBatch),
            day
        };
    }

    function refreshFromPageButton(sourceLabel) {
        const range = getBatchRangeFromUI();
        setSavedBatchRange(range.fromBatch, range.toBatch);
        setSavedDay(range.day);

        const currentUrl = new URL(window.location.href);
        const currentFrom = currentUrl.searchParams.get("FromBatch") || "1";
        const currentTo = currentUrl.searchParams.get("ToBatch") || "99";
        const currentDay = currentUrl.searchParams.get("Day") || "0";

        if (
            String(currentFrom) !== String(range.fromBatch) ||
            String(currentTo) !== String(range.toBatch) ||
            String(currentDay) !== String(range.day)
        ) {
            window.location.href = buildBatchUrl(range.fromBatch, range.toBatch, range.day);
            return;
        }

        const clicked = clickRealRefreshButton();

        if (!clicked) {
            try {
                window.location.reload();
                return;
            } catch (e) {}
            showToast("Refresh button not found");
            return;
        }

        setTimeout(function () {
            render();
            setStatusTime();

            if (sourceLabel === "auto") {
                showToast("Auto: " + formatNowTime());
            } else {
                showToast("Refresh: " + formatNowTime());
            }
        }, 1700);
    }

    function msUntilNextFullHour() {
        const now = new Date();
        const next = new Date(now);
        next.setMinutes(60, 0, 0);
        return next.getTime() - now.getTime();
    }

    function clearHourlySchedule() {
        if (hourlyRefreshTimer) {
            clearTimeout(hourlyRefreshTimer);
            hourlyRefreshTimer = null;
        }
    }

    function scheduleHourlyRefresh() {
        clearHourlySchedule();

        const delay = msUntilNextFullHour();
        hourlyRefreshTimer = setTimeout(function runHourly() {
            refreshFromPageButton("auto");
            scheduleHourlyRefresh();
        }, delay);
    }

    function applyAutoRefreshState() {
        const enabled = isAutoRefreshEnabled();
        const btn = document.getElementById("mck-autorefresh-toggle");

        if (enabled) {
            scheduleHourlyRefresh();
        } else {
            clearHourlySchedule();
        }

        if (btn) {
            btn.classList.toggle("active", enabled);
            btn.title = enabled ? "Auto-odświeżanie: WŁ (kliknij aby wyłączyć)" : "Auto-odświeżanie: WYŁ (kliknij aby włączyć)";
            btn.innerHTML = enabled
                ? '<i class="fa-solid fa-clock"></i><span class="autorefresh-label">Auto ON</span>'
                : '<i class="fa-regular fa-clock"></i><span class="autorefresh-label">Auto OFF</span>';
        }
    }

    const style = document.createElement("style");
    style.textContent = `
        #${BOX_ID} {
            --col-batch: 54px;
            --col-os: 108px;
            --col-wait: 108px;
            --col-complete: 108px;
            --col-copy: 54px;

            position: fixed;
            right: 12px;
            bottom: 12px;
            z-index: 2147483646;
            width: min(520px, 94vw);
            height: calc(100vh - 24px);
            min-height: 520px;
            max-height: calc(100vh - 24px);
            background: rgba(10, 10, 12, 0.96);
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 14px;
            box-shadow: 0 10px 28px rgba(0,0,0,0.34);
            backdrop-filter: blur(8px);
            font-family: Segoe UI, Arial, sans-serif;
            color: #fff;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transition: width .16s ease, height .16s ease;
        }

        #${BOX_ID}.expanded {
            width: min(680px, 97vw);
        }

        #${BOX_ID}.minimized {
            width: auto;
            min-width: 0;
            height: auto;
            min-height: unset;
            max-height: unset;
            padding: 0;
        }

        #${BOX_ID} .head {
            display: grid;
            grid-template-columns: 1fr 72px auto;
            gap: 8px;
            align-items: center;
            padding: 8px 10px 8px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            flex-shrink: 0;
            background: transparent;
        }

        #${BOX_ID} .titleArea {
            display: flex;
            align-items: center;
            min-width: 0;
        }

        #${BOX_ID} .filterBar {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: nowrap;
        }

        #${BOX_ID} .filterBtn {
            height: 28px;
            min-width: 42px;
            padding: 0 10px;
            border-radius: 8px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.07);
            color: #fff;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
            transition: .14s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            box-sizing: border-box;
            letter-spacing: .2px;
        }

        #${BOX_ID} .filterBtn:hover {
            background: rgba(255,166,0,.16);
            border-color: rgba(255,166,0,.62);
        }

        #${BOX_ID} .filterBtn.active {
            background: rgba(255,166,0,.18);
            border-color: rgba(255,166,0,.72);
            color: #ffd27a;
            box-shadow: 0 0 0 1px rgba(255,166,0,.10) inset;
        }

        #${BOX_ID} .statusWrap {
            display: flex;
            justify-content: center;
            align-items: center;
            width: 72px;
            min-width: 72px;
        }

        #${BOX_ID} .sub {
            font-size: 11px;
            color: rgba(255,255,255,.68);
            white-space: nowrap;
            text-align: center;
            letter-spacing: .1px;
            width: 100%;
        }

        #${BOX_ID} .actions {
            display: flex;
            align-items: center;
            gap: 8px;
            justify-content: flex-end;
        }

        #${BOX_ID} .rangeBar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px;
            border-bottom: 1px solid rgba(255,255,255,0.06);
            background: rgba(255,255,255,0.02);
            flex-shrink: 0;
            flex-wrap: wrap;
        }

        #${BOX_ID} .rangeBar label {
            font-size: 11px;
            font-weight: 700;
            color: rgba(255,255,255,.74);
            white-space: nowrap;
        }

        #${BOX_ID} .rangeInput {
            width: 62px;
            height: 30px;
            border-radius: 9px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.07);
            color: #fff;
            font-size: 13px;
            font-weight: 800;
            text-align: center;
            outline: none;
            box-sizing: border-box;
        }

        #${BOX_ID} .rangeInput:focus {
            border-color: rgba(255,166,0,.62);
            box-shadow: 0 0 0 1px rgba(255,166,0,.08) inset;
        }

        #${BOX_ID} .rangeSpacer {
            width: 14px;
            min-width: 14px;
            height: 1px;
        }

        #${BOX_ID} .mck-day-select {
            position: relative;
            width: 150px;
        }

        #${BOX_ID} .mck-day-trigger {
            width: 100%;
            height: 30px;
            border-radius: 9px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.07);
            color: #fff;
            font-size: 13px;
            font-weight: 800;
            padding: 0 10px;
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            text-align: left;
        }

        #${BOX_ID} .mck-day-trigger:hover {
            background: rgba(255,166,0,.12);
            border-color: rgba(255,166,0,.58);
        }

        #${BOX_ID} .mck-day-trigger:focus {
            border-color: rgba(255,166,0,.62);
            box-shadow: 0 0 0 1px rgba(255,166,0,.08) inset;
        }

        #${BOX_ID} .mck-day-menu {
            position: absolute;
            top: calc(100% + 6px);
            left: 0;
            width: 100%;
            background: rgba(10, 10, 12, 0.98);
            border: 1px solid rgba(255,255,255,0.10);
            border-radius: 10px;
            box-shadow: 0 12px 28px rgba(0,0,0,.42);
            overflow: hidden;
            display: none;
            z-index: 2147483647;
            backdrop-filter: blur(8px);
        }

        #${BOX_ID} .mck-day-select.open .mck-day-menu {
            display: block;
        }

        #${BOX_ID} .mck-day-option {
            width: 100%;
            height: 34px;
            border: none;
            background: transparent;
            color: #fff;
            font-size: 13px;
            font-weight: 700;
            text-align: left;
            padding: 0 10px;
            cursor: pointer;
            display: flex;
            align-items: center;
            border-radius: 0;
        }

        #${BOX_ID} .mck-day-option:hover {
            background: rgba(255,166,0,.16);
            color: #ffd27a;
        }

        #${BOX_ID} .mck-day-option.active {
            background: rgba(255,166,0,.18);
            color: #ffd27a;
        }

        #${BOX_ID} .mck-btn,
        #${BOX_ID} button {
            height: 30px;
            min-width: 36px;
            padding: 0 10px;
            border-radius: 9px;
            border: 1px solid rgba(255,255,255,0.12);
            background: rgba(255,255,255,0.07);
            color: #fff;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
            transition: .14s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            box-sizing: border-box;
        }

        #${BOX_ID} .mck-btn:hover,
        #${BOX_ID} button:hover {
            background: rgba(255,166,0,.16);
            border-color: rgba(255,166,0,.62);
            box-shadow: 0 0 0 1px rgba(255,166,0,.08) inset;
        }

        #${BOX_ID} .mck-btn.sizeBtn {
            min-width: 40px;
            padding: 0 8px;
        }

        /* NIEBIESKI SEARCH BUTTON */
        #${BOX_ID} #mck-apply-range {
            background: linear-gradient(180deg, rgba(62,156,255,0.34), rgba(18,105,224,0.28));
            border: 1px solid rgba(94,177,255,0.85);
            color: #eaf6ff;
            box-shadow:
                0 0 0 1px rgba(133, 201, 255, 0.14) inset,
                0 6px 16px rgba(30, 120, 255, 0.18);
        }

        #${BOX_ID} #mck-apply-range:hover {
            background: linear-gradient(180deg, rgba(86,174,255,0.44), rgba(25,119,242,0.36));
            border-color: rgba(143,210,255,0.98);
            color: #ffffff;
            box-shadow:
                0 0 0 1px rgba(170, 220, 255, 0.18) inset,
                0 8px 20px rgba(30, 120, 255, 0.24);
        }

        #${BOX_ID} #mck-apply-range:active {
            background: linear-gradient(180deg, rgba(35,125,236,0.40), rgba(17,92,198,0.34));
            border-color: rgba(110,190,255,0.95);
            transform: translateY(1px);
        }

        /* AUTO-REFRESH TOGGLE — szary gdy wyłączony */
        #${BOX_ID} #mck-autorefresh-toggle {
            background: rgba(255,255,255,0.07);
            border: 1px solid rgba(255,255,255,0.14);
            color: rgba(255,255,255,0.45);
            min-width: 90px;
            padding: 0 10px;
            gap: 5px;
        }

        #${BOX_ID} #mck-autorefresh-toggle .autorefresh-label {
            font-size: 11px;
            font-weight: 800;
            letter-spacing: .2px;
        }

        #${BOX_ID} #mck-autorefresh-toggle:hover {
            background: rgba(255,255,255,0.12);
            border-color: rgba(255,255,255,0.28);
            color: #fff;
        }

        /* Zielony gdy włączony */
        #${BOX_ID} #mck-autorefresh-toggle.active {
            background: linear-gradient(180deg, rgba(40,200,100,0.28), rgba(20,160,70,0.22));
            border: 1px solid rgba(60,220,120,0.80);
            color: #a0ffc8;
            box-shadow:
                0 0 0 1px rgba(80,240,140,0.10) inset,
                0 4px 14px rgba(20,180,80,0.18);
        }

        #${BOX_ID} #mck-autorefresh-toggle.active:hover {
            background: linear-gradient(180deg, rgba(55,220,115,0.36), rgba(28,180,80,0.30));
            border-color: rgba(90,240,150,0.95);
            color: #ccffe0;
        }

        #${BOX_ID} .body {
            flex: 1;
            min-height: 0;
            display: flex;
            flex-direction: column;
        }

        #${BOX_ID}.minimized .body,
        #${BOX_ID}.minimized .rangeBar {
            display: none;
        }

        #${BOX_ID} .topDock {
            flex-shrink: 0;
            padding: 0 8px 0 8px;
            background: transparent;
            margin-top: -1px;
        }

        #${BOX_ID} .listWrap {
            flex: 1;
            min-height: 0;
            overflow-y: auto;
            padding: 0 8px 6px 8px;
            background: transparent;
        }

        #${BOX_ID} .allDock {
            flex-shrink: 0;
            padding: 8px;
            border-top: 1px solid rgba(255,255,255,0.06);
            background: rgba(255,255,255,0.02);
            box-shadow: 0 -8px 18px rgba(0,0,0,.22);
        }

        #${BOX_ID} table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            background: rgba(255,255,255,0.025);
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 12px;
            overflow: hidden;
            table-layout: fixed;
        }

        #${BOX_ID} .headerTable {
            border-top-left-radius: 0;
            border-top-right-radius: 0;
            border-bottom-left-radius: 0;
            border-bottom-right-radius: 0;
            border-top: none;
            margin-top: 0;
        }

        #${BOX_ID} .listTable {
            border-top-left-radius: 0;
            border-top-right-radius: 0;
            border-top: none;
            margin-top: 0;
        }

        #${BOX_ID} .headerTable col.col-batch,
        #${BOX_ID} .listTable col.col-batch,
        #${BOX_ID} .allTable col.col-batch {
            width: var(--col-batch);
        }

        #${BOX_ID} .headerTable col.col-os,
        #${BOX_ID} .listTable col.col-os,
        #${BOX_ID} .allTable col.col-os {
            width: var(--col-os);
        }

        #${BOX_ID} .headerTable col.col-wait,
        #${BOX_ID} .listTable col.col-wait,
        #${BOX_ID} .allTable col.col-wait {
            width: var(--col-wait);
        }

        #${BOX_ID} .headerTable col.col-complete,
        #${BOX_ID} .listTable col.col-complete,
        #${BOX_ID} .allTable col.col-complete {
            width: var(--col-complete);
        }

        #${BOX_ID} .headerTable col.col-copy,
        #${BOX_ID} .listTable col.col-copy,
        #${BOX_ID} .allTable col.col-copy {
            width: var(--col-copy);
        }

        #${BOX_ID} thead th,
        #${BOX_ID} .fakeHead th {
            background: rgba(255,255,255,0.04);
            border-bottom: 1px solid rgba(255,255,255,0.06);
            color: rgba(255,255,255,.74);
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: .35px;
            text-align: center;
            padding: 9px 4px;
            font-family: Segoe UI, Arial, sans-serif;
        }

        #${BOX_ID} tbody td {
            padding: 8px 4px;
            text-align: center;
            vertical-align: middle;
            border-bottom: 1px solid rgba(255,255,255,0.05);
            font-family: Segoe UI, Arial, sans-serif;
        }

        #${BOX_ID} tbody tr:last-child td {
            border-bottom: none;
        }

        #${BOX_ID} tbody tr.batchA td {
            background: rgba(255,255,255,0.018);
        }

        #${BOX_ID} tbody tr.batchB td {
            background: rgba(255,255,255,0.040);
        }

        #${BOX_ID} td.batchCellA,
        #${BOX_ID} td.batchCellB,
        #${BOX_ID} #mck-allWrap td:first-child {
            background: rgba(255,166,0,.08) !important;
            color: #ffd27a;
            font-size: 16px;
            font-weight: 900;
            border-right: 1px solid rgba(255,255,255,0.07);
            letter-spacing: .2px;
            text-align: center;
        }

        #${BOX_ID} .num {
            height: 30px;
            width: 100%;
            min-width: 0;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0 8px;
            border-radius: 11px;
            background: rgba(255,255,255,0.06);
            border: 1px solid rgba(255,255,255,0.10);
            color: #ffffff;
            font-size: 14px;
            font-weight: 800;
            user-select: none;
            cursor: pointer;
            box-sizing: border-box;
            transition: .14s ease;
            font-family: Segoe UI, Arial, sans-serif;
            text-align: center;
        }

        #${BOX_ID} .num:hover {
            background: rgba(255,166,0,.12);
            border-color: rgba(255,166,0,.58);
        }

        #${BOX_ID} .copyRowBtn {
            height: 30px;
            width: 100%;
            min-width: 0;
            padding: 0 8px;
            border-radius: 11px;
            border: 1px solid rgba(255,255,255,0.10);
            background: rgba(255,255,255,0.07);
            color: #fff;
            font-size: 12px;
            font-weight: 800;
            cursor: pointer;
            transition: .14s ease;
            font-family: Segoe UI, Arial, sans-serif;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto;
        }

        #${BOX_ID} .copyRowBtn:hover {
            background: rgba(255,166,0,.16);
            border-color: rgba(255,166,0,.62);
        }

        #${BOX_ID} .allDock .copyRowBtn {
            display: none !important;
        }

        #${BOX_ID} .listWrap::-webkit-scrollbar {
            width: 10px;
        }

        #${BOX_ID} .listWrap::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.03);
            border-radius: 10px;
        }

        #${BOX_ID} .listWrap::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.14);
            border-radius: 10px;
            border: 2px solid transparent;
            background-clip: padding-box;
        }

        #${BOX_ID} .listWrap::-webkit-scrollbar-thumb:hover {
            background: rgba(255,166,0,.35);
            background-clip: padding-box;
        }

        #${BOX_ID}.minimized .head {
            border-bottom: none;
            padding: 8px;
            display: flex;
            justify-content: center;
            align-items: center;
        }

        #${BOX_ID}.minimized .statusWrap,
        #${BOX_ID}.minimized .sub {
            display: none;
        }

        #${BOX_ID}.minimized .actions > * {
            display: none;
        }

        #${BOX_ID}.minimized .actions #mck-min {
            display: inline-flex;
        }

        @media (max-width: 720px) {
            #${BOX_ID} {
                width: 96vw;
                --col-batch: 48px;
                --col-os: 88px;
                --col-wait: 88px;
                --col-complete: 88px;
                --col-copy: 48px;
            }

            #${BOX_ID}.expanded {
                width: 98vw;
            }

            #${BOX_ID} .sub {
                display: none;
            }

            #${BOX_ID} .statusWrap {
                display: none;
            }

            #${BOX_ID} .num {
                font-size: 13px;
            }

            #${BOX_ID} .filterBar {
                gap: 4px;
            }

            #${BOX_ID} .filterBtn {
                min-width: 40px;
                padding: 0 8px;
            }

            #${BOX_ID} .head {
                grid-template-columns: 1fr auto;
            }

            #${BOX_ID} #mck-autorefresh-toggle .autorefresh-label {
                display: none;
            }

            #${BOX_ID} #mck-autorefresh-toggle {
                min-width: 36px;
                padding: 0 8px;
            }
        }
    `;
    document.head.appendChild(style);

    const box = document.createElement("div");
    box.id = BOX_ID;
    box.innerHTML = `
        <div class="head">
            <div class="titleArea">
                <div class="filterBar">
                    <button class="filterBtn" data-filter="ALL" title="All Batches">ALL</button>
                    <button class="filterBtn" data-filter="PR" title="Promise Batch">PR</button>
                    <button class="filterBtn" data-filter="BPP" title="Bulk">BPP</button>
                    <button class="filterBtn" data-filter="OB" title="Other Batch">OB</button>
                </div>
            </div>

            <div class="statusWrap">
                <div class="sub" id="mck-status">--:--:--</div>
            </div>

            <div class="actions">
                <button class="mck-btn" id="mck-autorefresh-toggle" title="Auto-odświeżanie: WYŁ">
                    <i class="fa-regular fa-clock"></i>
                    <span class="autorefresh-label">Auto OFF</span>
                </button>
                <button class="mck-btn sizeBtn" id="mck-size" title="Resize panel">
                    <i class="fa-solid fa-expand"></i>
                </button>
                <button class="mck-btn" id="mck-refresh" title="Refresh">
                    <i class="fa-solid fa-rotate-right"></i>
                </button>
                <button class="mck-btn" id="mck-min" title="Minimize / Expand">
                    <i class="fa-solid fa-compress"></i>
                </button>
            </div>
        </div>

        <div class="rangeBar">
            <label for="mck-from-batch">Batch</label>
            <label for="mck-from-batch">F</label>
            <input id="mck-from-batch" class="rangeInput" type="number" min="0" step="1" value="${getSavedFromBatch()}">

            <label for="mck-to-batch">T</label>
            <input id="mck-to-batch" class="rangeInput" type="number" min="0" step="1" value="${getSavedToBatch()}">

            <span class="rangeSpacer"></span>

            <label for="mck-day-trigger">Day</label>
            <div class="mck-day-select" id="mck-day-select">
                <button type="button" id="mck-day-trigger" class="mck-day-trigger" data-value="${getSavedDay()}">
                    <span id="mck-day-label">${getDayLabel(getSavedDay())}</span>
                    <i class="fa-solid fa-chevron-down"></i>
                </button>

                <div class="mck-day-menu" id="mck-day-menu">
                    <button type="button" class="mck-day-option${getSavedDay() === "0" ? " active" : ""}" data-day="0">0 - Today</button>
                    <button type="button" class="mck-day-option${getSavedDay() === "1" ? " active" : ""}" data-day="1">1 - Yesterday</button>
                    <button type="button" class="mck-day-option${getSavedDay() === "2" ? " active" : ""}" data-day="2">2 - 2 days ago</button>
                    <button type="button" class="mck-day-option${getSavedDay() === "3" ? " active" : ""}" data-day="3">3 - 3 days ago</button>
                    <button type="button" class="mck-day-option${getSavedDay() === "4" ? " active" : ""}" data-day="4">4 - 4 days ago</button>
                    <button type="button" class="mck-day-option${getSavedDay() === "5" ? " active" : ""}" data-day="5">5 - 5 days ago</button>
                    <button type="button" class="mck-day-option${getSavedDay() === "6" ? " active" : ""}" data-day="6">6 - 6 days ago</button>
                </div>
            </div>

            <button class="mck-btn" id="mck-apply-range" title="Search">
                <i class="fa-solid fa-magnifying-glass"></i>
                Search
            </button>
        </div>

        <div class="body">
            <div class="topDock">
                <div id="mck-headerWrap"></div>
            </div>

            <div class="listWrap">
                <div id="mck-tableWrap"></div>
            </div>

            <div class="allDock">
                <div id="mck-allWrap"></div>
            </div>
        </div>
    `;
    document.body.appendChild(box);

    function updateFilterButtons() {
        const mode = getFilterMode();
        document.querySelectorAll("#" + BOX_ID + " .filterBtn").forEach(function (btn) {
            btn.classList.toggle("active", btn.getAttribute("data-filter") === mode);
        });
    }

    function extractBatches() {
        const table = document.querySelector("#tMain");
        if (!table) return [];

        const rows = table.querySelectorAll("tbody tr");
        const map = new Map();
        const mode = getFilterMode();

        rows.forEach(function (row) {
            const cells = row.querySelectorAll("td");
            if (cells.length < 27) return;

            const batch = cells[0].innerText.trim();
            if (!batch || batch === "999") return;
            if (String(batch).toLowerCase() !== "all" && !batchMatchesFilter(batch, mode)) return;

            const osVals = getValues(cells[22]);
            const waitVals = getValues(cells[24]);
            const compVals = getValues(cells[26]);

            const max = Math.max(osVals.length, waitVals.length, compVals.length);
            if (!map.has(batch)) map.set(batch, []);

            for (let i = 0; i < max; i++) {
                map.get(batch).push({
                    os: osVals[i] || "0",
                    wait: waitVals[i] || "0",
                    comp: compVals[i] || "0"
                });
            }
        });

        return Array.from(map.entries())
            .map(function (entry) {
                return { batch: entry[0], lines: entry[1] };
            })
            .sort(function (a, b) {
                const aIsAll = String(a.batch).toLowerCase() === "all";
                const bIsAll = String(b.batch).toLowerCase() === "all";
                if (aIsAll && !bIsAll) return 1;
                if (!aIsAll && bIsAll) return -1;

                const na = parseInt(a.batch, 10);
                const nb = parseInt(b.batch, 10);

                if (!isNaN(na) && !isNaN(nb)) return nb - na;
                return String(b.batch).localeCompare(String(a.batch), undefined, { numeric: true, sensitivity: "base" });
            });
    }

    function renderStickyHeader() {
        const headerWrap = document.getElementById("mck-headerWrap");
        if (!headerWrap) return;

        const table = document.createElement("table");
        table.className = "headerTable";
        table.innerHTML = `
            <colgroup>
                <col class="col-batch">
                <col class="col-os">
                <col class="col-wait">
                <col class="col-complete">
                <col class="col-copy">
            </colgroup>
            <thead class="fakeHead">
                <tr>
                    <th>B</th>
                    <th>O/S</th>
                    <th>Wait</th>
                    <th>Complete</th>
                    <th>Copy</th>
                </tr>
            </thead>
        `;

        headerWrap.innerHTML = "";
        headerWrap.appendChild(table);
    }

    function renderMainTable() {
        const wrap = document.getElementById("mck-tableWrap");
        if (!wrap) return;

        const batches = extractBatches();

        const table = document.createElement("table");
        table.className = "listTable";
        table.innerHTML = `
            <colgroup>
                <col class="col-batch">
                <col class="col-os">
                <col class="col-wait">
                <col class="col-complete">
                <col class="col-copy">
            </colgroup>
            <tbody></tbody>
        `;

        const tbody = table.querySelector("tbody");

        batches.forEach(function (b, idx) {
            const isA = idx % 2 === 0;
            const rowClass = isA ? "batchA" : "batchB";
            const batchCellClass = isA ? "batchCellA" : "batchCellB";

            b.lines.forEach(function (line, lineIdx) {
                const tr = document.createElement("tr");
                tr.className = rowClass;

                if (lineIdx === 0) {
                    const tdBatch = document.createElement("td");
                    tdBatch.className = batchCellClass;
                    tdBatch.setAttribute("rowspan", String(b.lines.length));
                    tdBatch.textContent = b.batch;
                    tr.appendChild(tdBatch);
                }

                const os = normalizeNumber(line.os);
                const wa = normalizeNumber(line.wait);
                const co = normalizeNumber(line.comp);
                const formula = "=" + os + "+" + wa + "+" + co;

                const tdOS = document.createElement("td");
                tdOS.innerHTML = '<span class="num" data-copy="' + os + '" title="Copy number">' + os + '</span>';
                tr.appendChild(tdOS);

                const tdWait = document.createElement("td");
                tdWait.innerHTML = '<span class="num" data-copy="' + wa + '" title="Copy number">' + wa + '</span>';
                tr.appendChild(tdWait);

                const tdComp = document.createElement("td");
                tdComp.innerHTML = '<span class="num" data-copy="' + co + '" title="Copy number">' + co + '</span>';
                tr.appendChild(tdComp);

                const tdCopy = document.createElement("td");
                tdCopy.innerHTML = '<button class="copyRowBtn" data-rowcopy="' + formula + '" title="Copy formula"><i class="fa-regular fa-copy"></i></button>';
                tr.appendChild(tdCopy);

                tbody.appendChild(tr);
            });

            const sep = document.createElement("tr");
            sep.className = "mck-sep";
            sep.innerHTML = '<td colspan="5" style="height:8px; padding:0; border-bottom:none; background:transparent;"></td>';
            tbody.appendChild(sep);
        });

        wrap.innerHTML = "";
        wrap.appendChild(table);
    }

    function moveExistingAllBlock() {
        const mainTable = document.querySelector("#mck-tableWrap table");
        const allWrap = document.getElementById("mck-allWrap");
        if (!mainTable || !allWrap) return;

        allWrap.innerHTML = "";

        const tbody = mainTable.querySelector("tbody");
        if (!tbody) return;

        const rows = Array.from(tbody.querySelectorAll("tr"));
        let allStartIndex = -1;
        let allRowspan = 0;

        for (let i = 0; i < rows.length; i++) {
            const firstCell = rows[i].querySelector("td");
            if (!firstCell) continue;

            const text = firstCell.textContent.trim().toLowerCase();
            if (text === "all") {
                allStartIndex = i;
                allRowspan = parseInt(firstCell.getAttribute("rowspan") || "1", 10);
                break;
            }
        }

        if (allStartIndex === -1) return;

        const movedTable = document.createElement("table");
        movedTable.className = "allTable";
        movedTable.innerHTML = `
            <colgroup>
                <col class="col-batch">
                <col class="col-os">
                <col class="col-wait">
                <col class="col-complete">
                <col class="col-copy">
            </colgroup>
            <tbody></tbody>
        `;
        const movedTbody = movedTable.querySelector("tbody");

        const rowsToMove = [];
        for (let i = 0; i < allRowspan; i++) {
            if (rows[allStartIndex + i]) rowsToMove.push(rows[allStartIndex + i]);
        }

        rowsToMove.forEach(function (row) {
            const copyBtn = row.querySelector(".copyRowBtn");
            if (copyBtn) copyBtn.remove();
            movedTbody.appendChild(row);
        });

        const maybeSep = rows[allStartIndex + allRowspan];
        if (maybeSep && maybeSep.classList.contains("mck-sep")) {
            maybeSep.remove();
        }

        allWrap.appendChild(movedTable);
    }

    function render() {
        updateFilterButtons();
        renderStickyHeader();
        renderMainTable();
        moveExistingAllBlock();
        setStatusTime();
    }

    box.addEventListener("click", function (e) {
        const dayTrigger = e.target.closest("#mck-day-trigger");
        if (dayTrigger) {
            const wrap = document.getElementById("mck-day-select");
            if (wrap) wrap.classList.toggle("open");
            return;
        }

        const dayOption = e.target.closest(".mck-day-option[data-day]");
        if (dayOption) {
            const value = dayOption.getAttribute("data-day");
            const trigger = document.getElementById("mck-day-trigger");
            const label = document.getElementById("mck-day-label");
            const wrap = document.getElementById("mck-day-select");

            if (trigger) trigger.setAttribute("data-value", value);
            if (label) label.textContent = getDayLabel(value);

            document.querySelectorAll("#" + BOX_ID + " .mck-day-option").forEach(function (btn) {
                btn.classList.toggle("active", btn.getAttribute("data-day") === value);
            });

            if (wrap) wrap.classList.remove("open");
            return;
        }

        const num = e.target.closest(".num[data-copy]");
        if (num) {
            copyText(num.getAttribute("data-copy"));
            return;
        }

        const btn = e.target.closest(".copyRowBtn[data-rowcopy]");
        if (btn) {
            copyText(btn.getAttribute("data-rowcopy"));
            return;
        }

        const filterBtn = e.target.closest(".filterBtn[data-filter]");
        if (filterBtn) {
            const mode = filterBtn.getAttribute("data-filter");
            setFilterMode(mode);
            render();
            showToast("Filter: " + mode);
            return;
        }

        if (e.target.closest("#mck-autorefresh-toggle")) {
            const next = !isAutoRefreshEnabled();
            setAutoRefreshEnabled(next);
            applyAutoRefreshState();
            showToast(next ? "Auto-odświeżanie: WŁ" : "Auto-odświeżanie: WYŁ");
            return;
        }

        if (e.target.closest("#mck-refresh")) {
            refreshFromPageButton("manual");
            return;
        }

        if (e.target.closest("#mck-apply-range")) {
            const range = getBatchRangeFromUI();
            setSavedBatchRange(range.fromBatch, range.toBatch);
            setSavedDay(range.day);
            window.location.href = buildBatchUrl(range.fromBatch, range.toBatch, range.day);
            return;
        }

        if (e.target.closest("#mck-min")) {
            const nextState = !isMinimized();
            setMinimized(nextState);
            applyMinState();
            return;
        }

        if (e.target.closest("#mck-size")) {
            const nextState = !isExpanded();
            setExpanded(nextState);
            applyExpandedState();
            return;
        }
    });

    document.addEventListener("click", function (e) {
        const wrap = document.getElementById("mck-day-select");
        if (!wrap) return;

        if (!wrap.contains(e.target)) {
            wrap.classList.remove("open");
        }
    });

    document.addEventListener("keydown", function (e) {
        const active = document.activeElement;
        const isRangeInput = active && (
            active.id === "mck-from-batch" ||
            active.id === "mck-to-batch" ||
            active.id === "mck-day-trigger"
        );

        if (isRangeInput && e.key === "Enter") {
            const range = getBatchRangeFromUI();
            setSavedBatchRange(range.fromBatch, range.toBatch);
            setSavedDay(range.day);
            window.location.href = buildBatchUrl(range.fromBatch, range.toBatch, range.day);
        }

        if (e.key === "Escape") {
            const wrap = document.getElementById("mck-day-select");
            if (wrap) wrap.classList.remove("open");
        }
    });

    function applyMinState() {
        const minimized = isMinimized();
        const minBtn = document.getElementById("mck-min");

        box.classList.toggle("minimized", minimized);

        if (minBtn) {
            minBtn.title = minimized ? "Expand" : "Minimize";
            minBtn.innerHTML = minimized
                ? '<i class="fa-solid fa-expand"></i>'
                : '<i class="fa-solid fa-compress"></i>';
        }
    }

    function applyExpandedState() {
        const expanded = isExpanded();
        const sizeBtn = document.getElementById("mck-size");

        box.classList.toggle("expanded", expanded);

        if (sizeBtn) {
            sizeBtn.title = expanded ? "Back to normal size" : "Make panel bigger";
            sizeBtn.innerHTML = expanded
                ? '<i class="fa-solid fa-minimize"></i>'
                : '<i class="fa-solid fa-expand"></i>';
        }
    }

    applyMinState();
    applyExpandedState();
    applyAutoRefreshState();
    render();
})();
