# FGTime

Plugin do śledzenia czasu graczy na serwerach CS2 (CounterStrikeSharp).
Obsługuje wiele serwerów jednocześnie — gracz widzi swój czas na każdym serwerze osobno i globalnie.

Zaprojektowany jako **bazowy plugin** — inne pluginy (FGFaircoin, FGRanks) mogą z niego korzystać przez publiczne API (`IFGTimeApi`).

---

## Wymagania

- CounterStrikeSharp (najnowsza wersja)
- .NET 8 SDK (do kompilacji)
- MySQL 5.7+ lub MariaDB 10.3+

---

## Instalacja

### 1. Baza danych

```bash
mysql -u root -p fairplay < database/schema.sql
```

### 2. Skopiuj pliki na serwer

```
game/csgo/addons/counterstrikesharp/plugins/FGTime/
├── FGTime.dll
├── MySqlConnector.dll
└── Dapper.dll
```

### 3. Uruchom serwer — plugin wygeneruje config i plik językowy:

```
game/csgo/addons/counterstrikesharp/configs/FAIRGAME/FGTime/
├── FGTime.json        ← config
└── lang/
    └── FGTime.json    ← tłumaczenia
```

### 4. Uzupełnij config

```json
{
  "ServerID": "server1",
  "ServerName": "FairPlay #1 Competitive",
  "DatabaseHost": "localhost",
  "DatabasePort": 3306,
  "DatabaseName": "fairplay",
  "DatabaseUser": "cs2user",
  "DatabasePassword": "haslo",
  "SaveIntervalSeconds": 60,
  "ShowHud": true,
  "HudRefreshSeconds": 5.0,
  "HudText": "Czas: {time}",
  "ChatPrefix": "[FGTime]",
  "ChatPrefixColor": "#FFD700",
  "AdminFlag": "@css/admin",
  "TopCount": 10
}
```

> **Ważne:** Każdy serwer musi mieć unikalny `ServerID`!

---

## Komendy gracza

| Komenda | Opis |
|---------|------|
| `!czas` | Twój czas na tym serwerze + łącznie |
| `!czas <nick>` | Czas innego gracza |
| `!topczas` | Top 10 graczy na tym serwerze |
| `!topczas global` | Top 10 graczy globalnie |
| `!serwery` | Twój czas rozpisany per serwer |

## Komendy admina

| Komenda | Opis |
|---------|------|
| `!resetczas <nick>` | Resetuje czas gracza na tym serwerze |
| `!addczas <nick> <minuty>` | Dodaje czas graczowi |

---

## API dla innych pluginów

FGTime udostępnia interfejs `IFGTimeApi` dla innych pluginów:

```csharp
// Pobierz instancje API
var fgTime = capability.Get();

// Calkowity czas gracza na tym serwerze (sekund)
long secs = await fgTime.GetTotalTimeOnServerAsync(steamId);

// Calkowity czas globalny (sekund)
long global = await fgTime.GetTotalTimeGlobalAsync(steamId);

// Czas biezacej sesji (live, bez bazy)
int session = fgTime.GetCurrentSessionSeconds(steamId);

// Czy gracz jest online
bool online = fgTime.IsPlayerOnline(steamId);

// Event: gracz wyszedl z serwera
fgTime.OnSessionEnded += (steamId, sessionSecs, totalSecs) => { ... };

// Event: co SaveInterval (flush czasu)
fgTime.OnTimeFlushed += (steamId, currentSecs) => { ... };
```

---

## Struktura plików

```
FGTime/
├── database/
│   └── schema.sql
└── src/
    ├── FGTime.csproj
    ├── FGTime.cs            # Główny plugin
    ├── PluginConfig.cs      # Config + ścieżki
    ├── Api/
    │   └── IFGTimeApi.cs    # Publiczne API
    ├── Lang/
    │   └── Localizer.cs     # System tłumaczeń
    ├── Models/
    │   └── Models.cs
    └── Services/
        ├── DatabaseService.cs
        └── TimeService.cs
```
