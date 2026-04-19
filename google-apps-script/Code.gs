/**
 * MCK Progress Bridge — Google Apps Script
 *
 * Deploy as Web App:
 *   Execute as: Me
 *   Who has access: Anyone (or "Anyone within [your org]")
 *
 * After deploying, copy the Web App URL and put it in the userscript
 * as APPS_SCRIPT_URL.
 */

const PROP_KEY = 'MCK_PROGRESS_DATA';

// ─── Receive data from Tampermonkey userscript ───────────────────────────────

function doPost(e) {
  try {
    const json = JSON.parse(e.postData.contents);
    const stored = {
      today:     json.today     || { pack: '0', bpp: '0', pick: '0' },
      yesterday: json.yesterday || { pack: '0', bpp: '0', pick: '0' },
      dby:       json.dby       || { pack: '0', bpp: '0', pick: '0' },
      updatedAt: new Date().toISOString()
    };
    PropertiesService.getScriptProperties().setProperty(
      PROP_KEY,
      JSON.stringify(stored)
    );
    return buildJsonResponse({ ok: true, updatedAt: stored.updatedAt });
  } catch (err) {
    return buildJsonResponse({ ok: false, error: String(err) }, 500);
  }
}

// ─── Serve the embedded dashboard page ───────────────────────────────────────

function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  // ?action=data — return raw JSON (used by the embed page to poll)
  if (action === 'data') {
    const raw = PropertiesService.getScriptProperties().getProperty(PROP_KEY);
    if (!raw) {
      return buildJsonResponse({ ok: false, error: 'No data yet' });
    }
    return buildJsonResponse({ ok: true, data: JSON.parse(raw) });
  }

  // Default — serve the HTML dashboard
  return HtmlService
    .createHtmlOutputFromFile('dashboard')
    .setTitle('MCK Progress Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildJsonResponse(payload, statusCode) {
  const output = ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}
