// ==UserScript==
// @name         [MCK] Bridge → Cloudflare
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Odczytuje liczby z widgetu MCK Progress i wysyła je do Cloudflare Worker (most do Google Sites)
// @author       Mateusz Mucek
// @match        http://whds-batchoverviewprogress:8087/Batch/ProgressOverview
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════
    //  WKLEJ TU URL swojego Cloudflare Worker
    //  Przykład: https://mck-progress.twojlogin.workers.dev
    const WORKER_URL = 'WKLEJ_URL_TUTAJ';
    // ═══════════════════════════════════════════════════════════════════

    // Co ile sekund wysyłać dane (domyślnie 60 s)
    const PUSH_INTERVAL_MS = 60 * 1000;

    // ─── Odczyt wartości z DOM widgetu MCK ──────────────────────────────

    function readValue(dataCopy) {
        const el = document.querySelector(`[data-copy="${dataCopy}"]`);
        if (!el) return '0';
        return el.textContent.trim() || '0';
    }

    function readState() {
        return {
            today: {
                pack: readValue('today:pack'),
                bpp:  readValue('today:bpp'),
                pick: readValue('today:pick'),
            },
            yesterday: {
                pack: readValue('yesterday:pack'),
                bpp:  readValue('yesterday:bpp'),
                pick: readValue('yesterday:pick'),
            },
            dby: {
                pack: readValue('dby:pack'),
                bpp:  readValue('dby:bpp'),
                pick: readValue('dby:pick'),
            },
        };
    }

    function hasAnyData(state) {
        // Nie wysyłaj jeśli wszystko jest zerami (widget jeszcze się nie odświeżył)
        const vals = [
            state.today.pack, state.today.bpp, state.today.pick,
            state.yesterday.pack, state.yesterday.bpp, state.yesterday.pick,
        ];
        return vals.some(v => parseInt(v.replace(/,/g, ''), 10) > 0);
    }

    // ─── Push do Cloudflare ─────────────────────────────────────────────

    function pushToCloudflare() {
        if (!WORKER_URL || WORKER_URL === 'WKLEJ_URL_TUTAJ') return;

        const state = readState();
        if (!hasAnyData(state)) return;

        GM_xmlhttpRequest({
            method:  'POST',
            url:     WORKER_URL,
            headers: { 'Content-Type': 'application/json' },
            data:    JSON.stringify(state),
            onload(res) {
                try {
                    const json = JSON.parse(res.responseText);
                    showBridgeStatus(json.ok ? 'ok' : 'error');
                } catch {
                    showBridgeStatus('error');
                }
            },
            onerror() {
                showBridgeStatus('error');
            },
        });
    }

    // ─── Mały wskaźnik statusu w widgecie ───────────────────────────────

    function showBridgeStatus(status) {
        let dot = document.getElementById('mck-bridge-dot');
        if (!dot) {
            dot = document.createElement('div');
            dot.id = 'mck-bridge-dot';
            dot.title = 'MCK Bridge → Cloudflare';
            dot.style.cssText = `
                position: fixed;
                top: 6px;
                right: 10px;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                z-index: 9999999;
                transition: background .3s;
                cursor: default;
            `;
            document.body.appendChild(dot);
        }

        if (status === 'ok') {
            dot.style.background = '#4caf50';
            dot.title = 'Bridge: dane wysłane ✓';
        } else {
            dot.style.background = '#f44336';
            dot.title = 'Bridge: błąd wysyłania';
        }

        // Po 4 sekundach zgaś wskaźnik do szarego
        clearTimeout(dot._timer);
        dot._timer = setTimeout(() => {
            dot.style.background = 'rgba(255,255,255,0.2)';
        }, 4000);
    }

    // ─── Start — czekaj aż widget MCK będzie gotowy ─────────────────────

    function waitForWidget() {
        // Widget MCK jest gotowy gdy pojawią się elementy [data-copy]
        const el = document.querySelector('[data-copy="today:pack"]');
        if (el) {
            // Pierwsze wysłanie po 5 sekundach (dajemy czas na pierwsze odświeżenie widgetu)
            setTimeout(pushToCloudflare, 5000);
            // Następne co PUSH_INTERVAL_MS
            setInterval(pushToCloudflare, PUSH_INTERVAL_MS);
        } else {
            setTimeout(waitForWidget, 1000);
        }
    }

    waitForWidget();

})();
