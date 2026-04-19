# MCK Progress Bridge

## Jak to działa

```
[Strona WHDS]
  Widget MCK wyświetla liczby (Twój oryginalny skrypt — bez zmian)
      |
      |  mck-bridge-cloudflare.user.js  ← NOWY, osobny skrypt Tampermonkey
      |  co 60 sekund czyta liczby z widgetu i wysyła POST
      ▼
[Cloudflare Worker]
  worker.js  ← tu wklejasz kod
  Przechowuje dane w KV, serwuje stronę dashboard
      |
      ▼
[Google Sites — Embed]
  Wklejasz URL Workera → liczby widoczne na stronie
  Auto-odświeżanie co 60 sekund
```

---

## Co instalujesz

| Co | Gdzie |
|---|---|
| Twój oryginalny skrypt MCK | Tampermonkey — bez żadnych zmian |
| `userscript/mck-bridge-cloudflare.user.js` | Tampermonkey — jako drugi, osobny skrypt |
| `cloudflare-worker/worker.js` | Cloudflare — wklejasz w edytorze Workera |

---

## KROK 1 — Ustaw Cloudflare Worker

### Stwórz Worker

1. Wejdź na **[dash.cloudflare.com](https://dash.cloudflare.com)** (darmowe konto wystarczy)
2. Lewe menu → **Workers & Pages** → **Create** → **Create Worker**
3. Nazwij go np. `mck-progress` → kliknij **Deploy**
4. Kliknij **Edit code**
5. Zaznacz wszystko w edytorze (Ctrl+A) i wklej zawartość pliku `cloudflare-worker/worker.js`
6. Kliknij **Deploy** (prawy górny róg)

Twój URL wygląda tak — **zapisz go**:
```
https://mck-progress.TWOJLOGIN.workers.dev
```

### Stwórz magazyn danych (KV)

Worker musi gdzieś trzymać liczby — do tego służy KV.

1. Lewe menu → **Workers & Pages** → **KV**
2. **Create a namespace** → nazwa: `mck-progress-kv` → **Add**
3. Wróć do Workera: **Workers & Pages** → kliknij `mck-progress`
4. Zakładka **Settings** → **Bindings** → **Add** → **KV Namespace**
5. Wypełnij:
   - **Variable name:** `PROGRESS_KV`  ← dokładnie tak, z dużych liter
   - **KV Namespace:** wybierz `mck-progress-kv`
6. Kliknij **Save**

---

## KROK 2 — Zainstaluj skrypt Bridge w Tampermonkey

1. Otwórz plik `userscript/mck-bridge-cloudflare.user.js`
2. Znajdź linię 14 i wklej URL z Kroku 1:

```js
const WORKER_URL = 'https://mck-progress.TWOJLOGIN.workers.dev';
```

3. Otwórz **Tampermonkey** → **Dashboard** → zakładka **+** (Utwórz nowy skrypt)
4. Wklej cały plik → **Ctrl+S**

Masz teraz 2 skrypty w Tampermonkey — oba działają jednocześnie, nie przeszkadzają sobie.

Po otwarciu strony WHDS pojawi się mały punkt w prawym górnym rogu:
- **zielony** = dane wysłane do Cloudflare
- **czerwony** = błąd połączenia

---

## KROK 3 — Osadź dashboard na Google Sites

1. Wejdź na **[sites.google.com](https://sites.google.com)** i otwórz swoją stronę w edycji
2. Prawy panel → **Wstaw** → przewiń na dół → **Osadź**
3. Wybierz zakładkę **Przez URL**
4. Wklej URL Workera:
```
https://mck-progress.TWOJLOGIN.workers.dev
```
5. Kliknij **Wstaw** → dopasuj rozmiar bloku (minimum 700 × 360 px)
6. Kliknij **Opublikuj**

---

## Gotowe

Od teraz:
- Otwierasz stronę WHDS → widget działa normalnie
- Bridge co 60 sekund sam wysyła liczby do Cloudflare
- Na Google Sites liczby aktualizują się automatycznie
- Każda liczba jest klikalna i kopiuje wartość do schowka

---

## Problemy

| Objaw | Rozwiązanie |
|---|---|
| Czerwona kropka | Sprawdź czy URL w skrypcie jest poprawny |
| Dashboard: "Brak danych" | Otwórz stronę WHDS i poczekaj 60 s na pierwsze wysłanie |
| Cloudflare błąd 1101 | Nie podłączyłeś KV — wróć do Kroku 1 (Bindings) |
| Google Sites nie ładuje embeda | Upewnij się że URL jest poprawny i Worker jest wdrożony |
