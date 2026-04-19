# MCK Progress Bridge — Google Sites ↔ Tampermonkey

Rozwiązanie składa się z dwóch części:

| Część | Co robi |
|---|---|
| **Google Apps Script** (`google-apps-script/`) | Serwer pośredniczący. Przyjmuje dane z Tampermonkey (POST), przechowuje je i serwuje stronę dashboard (GET). |
| **Userscript** (`userscript/`) | Zmodyfikowany skrypt Tampermonkey, który po każdym Refresh automatycznie wysyła liczby do Apps Script. |

---

## Architektura

```
[Strona wewnętrzna]
      ↓  (Tampermonkey odczytuje liczby)
[Userscript]
      ↓  GM_xmlhttpRequest POST (JSON)
[Google Apps Script Web App]
      ↓  PropertiesService (trwałe storage)
[dashboard.html serwowany przez Apps Script]
      ↑  co 60 s. fetch ?action=data
[Google Sites — embed iframe]
```

---

## Krok 1 — Utwórz projekt Google Apps Script

1. Wejdź na [script.google.com](https://script.google.com) i zaloguj się kontem Google.
2. Kliknij **Nowy projekt**.
3. Zmień nazwę projektu na np. `MCK Progress Bridge`.

---

## Krok 2 — Dodaj pliki projektu

### Code.gs

Skopiuj zawartość pliku `google-apps-script/Code.gs` do domyślnego pliku `Code.gs` w edytorze Apps Script.

### dashboard.html

1. W edytorze Apps Script kliknij **+** obok „Pliki" → **HTML**.
2. Nazwij plik `dashboard` (bez rozszerzenia — Apps Script doda `.html` sam).
3. Zastąp cały domyślny kod zawartością pliku `google-apps-script/dashboard.html`.

### appsscript.json (opcjonalnie)

Jeśli chcesz ręcznie ustawić strefę czasową i uprawnienia, włącz widok pliku manifestu:
**Ustawienia projektu** → zaznacz „Pokaż plik manifestu „appsscript.json" w edytorze".
Zastąp zawartość plikiem `google-apps-script/appsscript.json`.

---

## Krok 3 — Wdróż Web App

1. W edytorze kliknij **Wdróż** → **Nowe wdrożenie**.
2. Typ: **Aplikacja internetowa**.
3. Ustawienia:
   - **Wykonaj jako:** Ja (moje konto Google)
   - **Kto ma dostęp:** Wszyscy (lub „Wszyscy w organizacji" — zależy od polityki firmy)
4. Kliknij **Wdróż**.
5. **Skopiuj URL aplikacji internetowej** — wygląda mniej więcej tak:
   ```
   https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec
   ```

---

## Krok 4 — Wklej URL do userscriptu

Otwórz plik `userscript/progress-overview-with-push.user.js` i znajdź linię:

```js
const APPS_SCRIPT_URL = 'WKLEJ_URL_TUTAJ';
```

Zastąp `'WKLEJ_URL_TUTAJ'` skopiowanym URL-em, np.:

```js
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXXXXX/exec';
```

---

## Krok 5 — Zainstaluj/zaktualizuj skrypt w Tampermonkey

1. Otwórz Tampermonkey → **Dashboard**.
2. Jeśli masz stary skrypt MCK Progress, otwórz go i zastąp całą jego zawartość zawartością pliku `userscript/progress-overview-with-push.user.js`.
3. Zapisz (Ctrl+S).

> **Uwaga:** Skrypt wymaga uprawnienia `GM_xmlhttpRequest` (jest już zadeklarowane w nagłówku `@grant`). Tampermonkey zapyta o zgodę przy pierwszym uruchomieniu.

---

## Krok 6 — Osadź dashboard na Google Sites

1. Wejdź na [sites.google.com](https://sites.google.com) i otwórz swoją stronę.
2. W edytorze kliknij **Wstaw** → **Osadź URL** (lub naciśnij `</>` Embed).
3. Wklej URL swojego Web App (ten sam co w kroku 3):
   ```
   https://script.google.com/macros/s/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec
   ```
4. Kliknij **Wstaw** i dostosuj rozmiar iFrame (zalecane minimum: 720 × 380 px).
5. Opublikuj stronę.

---

## Jak to działa na co dzień

1. Otwierasz stronę `http://whds-batchoverviewprogress:8087/Batch/ProgressOverview` — widget pojawia się automatycznie.
2. Kliknij **Refresh** (albo odczekaj auto-refresh) — widget odczytuje liczby i natychmiast wysyła je do Google.
3. Dashboard na Google Sites odświeża się co 60 sekund automatycznie, albo kliknij **Odśwież** ręcznie.
4. Każda wartość na dashboardzie jest klikalna — kliknięcie kopiuje liczbę do schowka (bez spacji/przecinków).

---

## Pierwsze uruchomienie — autoryzacja Apps Script

Przy pierwszym wywołaniu Web App Google może wymagać autoryzacji:

1. Wejdź na URL Web App w przeglądarce.
2. Kliknij **Zezwól** i potwierdź uprawnienia.
3. Gotowe — kolejne wywołania (z Tampermonkey i z Google Sites) będą działać bez pytania.

---

## Rozwiązywanie problemów

| Objaw | Przyczyna | Rozwiązanie |
|---|---|---|
| Toast „Bridge: błąd połączenia" | Zły URL lub brak połączenia z internetem | Sprawdź `APPS_SCRIPT_URL` w skrypcie |
| Toast „Bridge: nieprawidłowa odpowiedź" | Apps Script zwrócił HTML zamiast JSON (niezatwierdzone uprawnienia) | Wejdź na URL Web App w przeglądarce i autoryzuj |
| Dashboard pokazuje „Brak danych" | Skrypt jeszcze nie wysłał danych | Kliknij Refresh w widgecie Tampermonkey |
| Google Sites blokuje iFrame | Polityka X-Frame-Options | Użyj `HtmlService.XFrameOptionsMode.ALLOWALL` — już ustawione w `Code.gs` |
| Nowe wdrożenie nie działa | Stary URL | Po każdej zmianie kodu utwórz **nowe wdrożenie** (lub aktualizuj istniejące) i skopiuj nowy URL |
