# CS2 Missions Plugin

Plugin misji dziennych i tygodniowych dla CS2 (CounterStrikeSharp). Gracz wykonuje misje na serwerze, a nagrody (XP, Faircoin, Ticket) odbiera przez stronę webową.

---

## Wymagania

- CounterStrikeSharp (najnowsza wersja)
- .NET 8 SDK (do kompilacji)
- MySQL 5.7+ lub MariaDB 10.3+
- Serwer CS2 z Metamod:Source

---

## Instalacja

### 1. Baza danych

Wykonaj skrypt SQL:

```bash
mysql -u root -p fairplay < database/schema.sql
```

Tworzy tabele:
- `mission_pools` – pule misji (tworzone przez admina na stronie)
- `missions` – definicje misji z nagrodami
- `player_missions` – postęp graczy
- `player_wallet` – portfel gracza (XP, Faircoin, Ticket)
- `mission_rewards_log` – log odebranych nagród

### 2. Kompilacja

```bash
cd src
dotnet build -c Release
```

Plik DLL znajdziesz w `src/bin/Release/net8.0/CS2MissionsPlugin.dll`.

### 3. Instalacja na serwer

Skopiuj `CS2MissionsPlugin.dll` i wszystkie pliki `.dll` z folderu build do:

```
game/csgo/addons/counterstrikesharp/plugins/CS2MissionsPlugin/
```

### 4. Konfiguracja

Po pierwszym uruchomieniu CounterStrikeSharp wygeneruje plik konfiguracyjny:

```
game/csgo/addons/counterstrikesharp/configs/plugins/CS2MissionsPlugin/CS2MissionsPlugin.json
```

Uzupełnij dane bazy danych:

```json
{
  "DatabaseHost": "localhost",
  "DatabasePort": 3306,
  "DatabaseName": "fairplay",
  "DatabaseUser": "cs2user",
  "DatabasePassword": "haslo",
  "DailyMissionsPerPlayer": 3,
  "WeeklyMissionsPerPlayer": 1,
  "SyncIntervalSeconds": 60,
  "ChatPrefix": "[Misje]",
  "ChatPrefixColor": "#FFD700",
  "ShowHud": true,
  "HudRefreshSeconds": 3.0,
  "HudMaxMissions": 3
}
```

---

## Komendy dla graczy

| Komenda | Opis |
|---------|------|
| `!misje` | Wyświetl swoje aktualne misje |
| `!odbierz <id>` | Odbierz nagrodę za ukończoną misję (też przez stronę) |

---

## Zarządzanie misjami przez stronę

### Struktura puli misji

1. **Utwórz pulę** w tabeli `mission_pools`:
   - `type` = `daily` lub `weekly`
   - `active_from` / `active_to` – zakres dat (np. 2 tygodnie)
   - `is_active` = 1

2. **Dodaj misje** do puli w tabeli `missions`:

```sql
-- Przykład: dzienna misja na 10 zabojstw
INSERT INTO missions (pool_id, name, description, type, required_amount, reward_xp, reward_faircoin, reward_ticket)
VALUES (1, '10 Zabójstw', 'Zabij 10 graczy w dowolnej rundzie', 'kills', 10, 100, 50, 0);

-- Przykład: tygodniowa misja headshot
INSERT INTO missions (pool_id, name, description, type, required_amount, reward_xp, reward_faircoin, reward_ticket)
VALUES (2, 'Snajper', 'Wykonaj 25 headshot-ów', 'headshots', 25, 500, 200, 1);
```

### Typy misji (`type`)

| Wartość | Opis |
|---------|------|
| `kills` | Zabójstwa |
| `headshots` | Headshooty |
| `rounds_won` | Wygrane rundy |
| `bombs_planted` | Podłożone bomby |
| `bombs_defused` | Rozbrojone bomby |
| `assists` | Asysty |
| `rounds_survived` | Przeżyte rundy |

### Reset puli co 2 tygodnie

Aby zresetować pule, ustaw `is_active = 0` na starej puli i utwórz nową z nowym zakresem dat. Plugin automatycznie przypisze graczom misje z nowej aktywnej puli przy następnym połączeniu.

---

## Odbiór nagród przez stronę (integracja API)

Plugin oznacza misję jako `is_completed = 1` po wykonaniu. Nagroda jest przypisana w momencie odebrania (`is_claimed = 1`).

**Endpoint strony powinien:**

1. Pobrać misje gracza: `SELECT * FROM player_missions pm JOIN missions m ON m.id = pm.mission_id WHERE pm.steamid = ? AND pm.is_completed = 1 AND pm.is_claimed = 0`
2. Przy odebraniu nagrody przez gracza – wywołać `ClaimMissionRewardAsync` lub wykonać bezpośrednio w SQL:

```sql
START TRANSACTION;

UPDATE player_missions SET is_claimed = 1, claimed_at = NOW()
WHERE steamid = ? AND mission_id = ? AND is_completed = 1 AND is_claimed = 0;

INSERT INTO player_wallet (steamid, xp, faircoin, ticket)
VALUES (?, <xp>, <faircoin>, <ticket>)
ON DUPLICATE KEY UPDATE
    xp = xp + VALUES(xp),
    faircoin = faircoin + VALUES(faircoin),
    ticket = ticket + VALUES(ticket);

INSERT INTO mission_rewards_log (steamid, mission_id, xp_given, faircoin_given, ticket_given)
VALUES (?, ?, <xp>, <faircoin>, <ticket>);

COMMIT;
```

---

## Powiadomienia

- **Czat** – gdy misja zostaje ukończona, gracz dostaje wiadomość z nazwą misji i nagrodami
- **HUD** – na ekranie wyświetlają się aktywne misje z postępem (`!misje` lub HUD timer)
- **Przy logowaniu** – jeśli gracz ma nieodebrane nagrody, dostaje przypomnienie na czacie

---

## Struktura plików

```
CS2MissionsPlugin/
├── database/
│   └── schema.sql              # Schemat bazy danych
└── src/
    ├── CS2MissionsPlugin.csproj
    ├── CS2MissionsPlugin.cs     # Główny plugin, eventy
    ├── PluginConfig.cs          # Konfiguracja
    ├── Models/
    │   └── Models.cs            # Modele danych
    └── Services/
        ├── DatabaseService.cs   # Operacje na bazie
        └── MissionService.cs    # Logika misji, cache
```
