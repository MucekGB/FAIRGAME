# MCK Progress Bridge — Cloudflare Worker + Google Sites

## Jak to działa (3 elementy)

```
[Strona WHDS z widgetem MCK]
         |
         |  Skrypt Bridge (Tampermonkey) czyta liczby z widgetu
         |  i wysyła POST co 60 sekund
         ▼
[Cloudflare Worker]  ←── przechowuje dane w KV
         |
         |  GET / → serwuje stronę dashboard
         ▼
[Google Sites — embed iframe]
         wyświetla liczby, auto-odświeża co 60 s
```

**Masz 3 pliki:**

| Plik | Co z nim robisz |
|---|---|
| Twój oryginalny skrypt MCK | Zostawiasz bez zmian w Tampermonkey |
| `userscript/mck-bridge-cloudflare.user.js` | Instalujesz jako DRUGI skrypt w Tampermonkey |
| `cloudflare-worker/worker.js` | Wklejasz do Cloudflare (instrukcja poniżej) |

---

## KROK 1 — Cloudflare Worker (5 minut)

### 1a. Utwórz konto i Worker

1. Wejdź na [dash.cloudflare.com](https://dash.cloudflare.com) i zaloguj się (konto darmowe wystarczy)
2. W lewym menu kliknij **Workers & Pages**
3. Kliknij **Create** → **Create Worker**
4. Nadaj nazwę np. `mck-progress`
5. Kliknij **Deploy** (nie przejmuj się domyślnym kodem — zaraz go zastąpimy)
6. Kliknij **Edit code**
7. Zaznacz wszystko (Ctrl+A) i wklej całą zawartość pliku `cloudflare-worker/worker.js`
8. Kliknij **Deploy** (prawy górny róg)

Twój Worker URL wygląda tak:
```
https://mck-progress.TWOJLOGIN.workers.dev
```
**Skopiuj go — będzie potrzebny w Kroku 2.**

### 1b. Utwórz KV (magazyn danych)

Worker potrzebuje miejsca do przechowywania liczb.

1. W lewym menu Cloudflare kliknij **Workers & Pages** → **KV**
2. Kliknij **Create a namespace**
3. Nazwa: `mck-progress-kv` → kliknij **Add**
4. Wróć do swojego Workera (Workers & Pages → mck-progress)
5. Kliknij zakładkę **Settings** → **Bindings**
6. Kliknij **Add** → **KV Namespace**
7. Ustaw:
   - **Variable name:** `PROGRESS_KV` (dokładnie tak, z dużych liter)
   - **KV Namespace:** wybierz `mck-progress-kv`
8. Kliknij **Save**

---

## KROK 2 — Bridge Tampermonkey (1 minuta)

1. Otwórz plik `userscript/mck-bridge-cloudflare.user.js`
2. Znajdź linię:
   ```js
   const WORKER_URL = 'WKLEJ_URL_TUTAJ';
   ```
3. Wklej URL z Kroku 1, np.:
   ```js
   const WORKER_URL = 'https://mck-progress.twojlogin.workers.dev';
   ```
4. Otwórz Tampermonkey → **Utwórz nowy skrypt**
5. Wklej cały zmodyfikowany plik i zapisz (Ctrl+S)

Od teraz masz **2 skrypty** w Tampermonkey działające jednocześnie:
- Oryginalny MCK Progress — wyświetla widget (bez zmian)
- MCK Bridge → Cloudflare — wysyła dane (nowy)

Mały zielony punkt pojawi się w prawym górnym rogu strony gdy dane zostaną wysłane.

---

## KROK 3 — Google Sites embed (1 minuta)

1. Otwórz swój Google Sites w trybie edycji
2. Kliknij **Wstaw** (prawy panel) → przewiń na dół → **Osadź**
3. Wybierz **Przez URL**
4. Wklej URL swojego Workera (ten sam z Kroku 1):
   ```
   https://mck-progress.twojlogin.workers.dev
   ```
5. Kliknij **Wstaw** i opublikuj stronę

---

## Gotowe — jak to działa na co dzień

1. Otwierasz stronę WHDS — oba skrypty Tampermonkey startują automatycznie
2. Widget MCK odświeża liczby (jak zawsze)
3. Bridge co 60 sekund czyta liczby z widgetu i wysyła je do Cloudflare
4. Dashboard na Google Sites pokazuje aktualne liczby (odświeża się sam co 60 s)
5. Każda liczba na dashboardzie jest klikalna — kopiuje wartość do schowka

---

## Rozwiązywanie problemów

| Objaw | Rozwiązanie |
|---|---|
| Czerwona kropka zamiast zielonej | Sprawdź czy URL w skrypcie jest poprawny |
| Dashboard pokazuje "Brak danych" | Otwórz stronę WHDS — bridge wyśle dane po pierwszym odświeżeniu widgetu |
| Google Sites blokuje embed | Worker ma ustawiony `X-Frame-Options: ALLOWALL` — powinno działać |
| 1101 error w Cloudflare | Nie podłączyłeś KV Namespace (wróć do Kroku 1b) |
