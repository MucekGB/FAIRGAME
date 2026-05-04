using CS2MissionsPlugin.Models;
using CS2MissionsPlugin.Services;
using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Utils;
using Microsoft.Extensions.Logging;

namespace CS2MissionsPlugin;

public class CS2MissionsPlugin : BasePlugin, IPluginConfig<PluginConfig>
{
    public override string ModuleName    => "CS2 Missions Plugin";
    public override string ModuleVersion => "1.0.0";
    public override string ModuleAuthor  => "FairPlay";
    public override string ModuleDescription => "System misji dziennych i tygodniowych z nagrodami XP/Faircoin/Ticket";

    public PluginConfig Config { get; set; } = new();

    private DatabaseService _db = null!;
    private MissionService  _missions = null!;

    // Sledzenie rundy: czy gracz przezyl runde
    private readonly HashSet<string> _survivedThisRound = new();
    // Sledzenie rundy: steamid wygrywajacego teamu (do nagradzania)
    private CsTeam _roundWinnerTeam = CsTeam.None;

    public void OnConfigParsed(PluginConfig config)
    {
        Config = config;
    }

    public override void Load(bool hotReload)
    {
        _db = new DatabaseService(Config);
        _missions = new MissionService(_db, Config, Logger);

        // Test polaczenia z baza
        _ = Task.Run(async () =>
        {
            var ok = await _db.TestConnectionAsync();
            if (!ok)
                Logger.LogError("[Misje] Nie mozna polaczyc sie z baza danych! Sprawdz konfiguracje.");
            else
                Logger.LogInformation("[Misje] Polaczono z baza danych.");
        });

        RegisterEventHandler<EventPlayerConnectFull>(OnPlayerConnect);
        RegisterEventHandler<EventPlayerDisconnect>(OnPlayerDisconnect);
        RegisterEventHandler<EventPlayerDeath>(OnPlayerDeath);
        RegisterEventHandler<EventPlayerHurt>(OnPlayerHurt);
        RegisterEventHandler<EventBombPlanted>(OnBombPlanted);
        RegisterEventHandler<EventBombDefused>(OnBombDefused);
        RegisterEventHandler<EventRoundEnd>(OnRoundEnd);
        RegisterEventHandler<EventRoundStart>(OnRoundStart);

        AddTimer(Config.SyncIntervalSeconds, OnSyncTimer, CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT);
        AddTimer(Config.HudRefreshSeconds, OnHudTimer, CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT);

        if (hotReload)
        {
            foreach (var player in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot))
            {
                _ = _missions.LoadPlayerMissionsAsync(GetSteamId(player));
            }
        }

        Logger.LogInformation("[Misje] Plugin zaladowany v{Version}", ModuleVersion);
    }

    public override void Unload(bool hotReload)
    {
        Logger.LogInformation("[Misje] Plugin wylaczony.");
    }

    // -------------------------------------------------------------------------
    // Komendy czatu
    // -------------------------------------------------------------------------

    [ConsoleCommand("css_misje", "Wyswietl swoje aktualne misje")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void CommandMissions(CCSPlayerController? player, CommandInfo info)
    {
        if (player == null || !player.IsValid) return;
        ShowMissionsToPlayer(player);
    }

    [ConsoleCommand("css_odbierz", "Odbierz nagrode za ukonczona misje (!odbierz <id>)")]
    [CommandHelper(minArgs: 1, usage: "<mission_id>", whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void CommandClaim(CCSPlayerController? player, CommandInfo info)
    {
        if (player == null || !player.IsValid) return;
        var steamId = GetSteamId(player);

        if (!int.TryParse(info.GetArg(1), out var missionId))
        {
            player.PrintToChat(FormatChat("Podaj numer misji: !odbierz <numer>"));
            return;
        }

        _ = Task.Run(async () =>
        {
            var claimed = await _missions.ClaimRewardAsync(steamId, missionId);
            Server.NextFrame(() =>
            {
                if (claimed)
                {
                    var missions = _missions.GetCachedMissions(steamId);
                    var m = missions.FirstOrDefault(x => x.MissionId == missionId);
                    if (m != null)
                        player.PrintToChat(FormatChat($"Odebrano nagrode za misje '{m.MissionName}'! +{m.RewardXp} XP, +{m.RewardFaircoin} Faircoin, +{m.RewardTicket} Ticket"));
                    else
                        player.PrintToChat(FormatChat("Nagroda odebrana!"));
                }
                else
                {
                    player.PrintToChat(FormatChat("Nie mozna odebrac tej nagrody (juz odebrana lub misja nie ukonczona)."));
                }
            });
        });
    }

    // -------------------------------------------------------------------------
    // Eventy gry
    // -------------------------------------------------------------------------

    private HookResult OnPlayerConnect(EventPlayerConnectFull ev, GameEventInfo info)
    {
        var player = ev.Userid;
        if (player == null || !player.IsValid || player.IsBot) return HookResult.Continue;

        var steamId = GetSteamId(player);
        var loadTask = Task.Run(async () =>
        {
            await _missions.LoadPlayerMissionsAsync(steamId);
            Server.NextFrame(() =>
            {
                if (player.IsValid)
                {
                    var unclaimed = _missions.GetCachedMissions(steamId)
                        .Where(m => m.IsCompleted && !m.IsClaimed)
                        .ToList();
                    if (unclaimed.Count > 0)
                        player.PrintToChat(FormatChat($"Masz {unclaimed.Count} ukonczone misje do odebrania! Uzyj !misje aby je zobaczyc."));
                }
            });
        });

        return HookResult.Continue;
    }

    private HookResult OnPlayerDisconnect(EventPlayerDisconnect ev, GameEventInfo info)
    {
        var player = ev.Userid;
        if (player == null || player.IsBot) return HookResult.Continue;
        _missions.RemovePlayerFromCache(GetSteamId(player));
        return HookResult.Continue;
    }

    private HookResult OnPlayerDeath(EventPlayerDeath ev, GameEventInfo info)
    {
        var attacker = ev.Attacker;
        var victim   = ev.Userid;
        var assister = ev.Assister;

        // Zabojstwo
        if (attacker != null && attacker.IsValid && !attacker.IsBot && attacker != victim)
        {
            var steamId = GetSteamId(attacker);
            var killTask = HandleMissionEventAsync(attacker, steamId, MissionType.kills);

            // Headshot
            if (ev.Headshot)
            {
                var hsTask = HandleMissionEventAsync(attacker, steamId, MissionType.headshots);
            }
        }

        // Asysta
        if (assister != null && assister.IsValid && !assister.IsBot)
        {
            var steamId = GetSteamId(assister);
            var assistTask = HandleMissionEventAsync(assister, steamId, MissionType.assists);
        }

        // Ofiara zostaje usunieta z puli "przezylych rundy"
        if (victim != null && victim.IsValid && !victim.IsBot)
        {
            _survivedThisRound.Remove(GetSteamId(victim));
        }

        return HookResult.Continue;
    }

    private HookResult OnPlayerHurt(EventPlayerHurt ev, GameEventInfo info)
    {
        return HookResult.Continue;
    }

    private HookResult OnBombPlanted(EventBombPlanted ev, GameEventInfo info)
    {
        var player = ev.Userid;
        if (player == null || !player.IsValid || player.IsBot) return HookResult.Continue;
        var steamId = GetSteamId(player);
        var plantTask = HandleMissionEventAsync(player, steamId, MissionType.bombs_planted);
        return HookResult.Continue;
    }

    private HookResult OnBombDefused(EventBombDefused ev, GameEventInfo info)
    {
        var player = ev.Userid;
        if (player == null || !player.IsValid || player.IsBot) return HookResult.Continue;
        var steamId = GetSteamId(player);
        var defuseTask = HandleMissionEventAsync(player, steamId, MissionType.bombs_defused);
        return HookResult.Continue;
    }

    private HookResult OnRoundStart(EventRoundStart ev, GameEventInfo info)
    {
        _survivedThisRound.Clear();
        _roundWinnerTeam = CsTeam.None;

        // Wszyscy zywy gracze na poczatku rundy sa dodawani do puli "survivalow"
        foreach (var player in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot && p.PawnIsAlive))
        {
            _survivedThisRound.Add(GetSteamId(player));
        }

        return HookResult.Continue;
    }

    private HookResult OnRoundEnd(EventRoundEnd ev, GameEventInfo info)
    {
        _roundWinnerTeam = (CsTeam)ev.Winner;

        var players = Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot).ToList();

        foreach (var player in players)
        {
            var steamId = GetSteamId(player);

            // Wygrana runda
            if ((CsTeam)player.TeamNum == _roundWinnerTeam && _roundWinnerTeam != CsTeam.None)
            {
                var wonTask = HandleMissionEventAsync(player, steamId, MissionType.rounds_won);
            }

            // Przezyta runda (gracz byl zywy na poczatku i przetrzwal)
            if (_survivedThisRound.Contains(steamId) && player.PawnIsAlive)
            {
                var survivedTask = HandleMissionEventAsync(player, steamId, MissionType.rounds_survived);
            }
        }

        return HookResult.Continue;
    }

    // -------------------------------------------------------------------------
    // Logika powiadomien o ukonczonej misji
    // -------------------------------------------------------------------------

    private async Task HandleMissionEventAsync(CCSPlayerController player, string steamId, MissionType type, int amount = 1)
    {
        var completedMissions = await _missions.RegisterEventAsync(steamId, type, amount);

        if (completedMissions.Count > 0)
        {
            Server.NextFrame(() =>
            {
                if (!player.IsValid) return;
                foreach (var mission in completedMissions)
                {
                    // Powiadomienie na czacie
                    player.PrintToChat(FormatChat($" Ukonczona misja: \x04{mission.MissionName}\x01! Nagroda: \x06{mission.RewardXp} XP\x01, \x09{mission.RewardFaircoin} Faircoin\x01, \x0B{mission.RewardTicket} Ticket\x01 - odbierz na stronie!"));

                    // Powiadomienie do wszystkich (opcjonalne - mozna wylaczyc)
                    // Server.PrintToChatAll(FormatChat($"{player.PlayerName} ukonczone misje: {mission.MissionName}!"));
                }
            });
        }
    }

    // -------------------------------------------------------------------------
    // Timer: synchronizacja misji z baza
    // -------------------------------------------------------------------------

    private void OnSyncTimer()
    {
        var players = Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot).ToList();
        foreach (var player in players)
        {
            var steamId = GetSteamId(player);
            _ = Task.Run(async () => await _missions.LoadPlayerMissionsAsync(steamId));
        }
    }

    // -------------------------------------------------------------------------
    // Timer: HUD z postepem misji
    // -------------------------------------------------------------------------

    private void OnHudTimer()
    {
        if (!Config.ShowHud) return;

        foreach (var player in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot && p.PawnIsAlive))
        {
            var steamId = GetSteamId(player);
            var missions = _missions.GetCachedMissions(steamId)
                .Where(m => !m.IsCompleted)
                .Take(Config.HudMaxMissions)
                .ToList();

            if (missions.Count == 0) continue;

            var lines = new System.Text.StringBuilder();
            lines.AppendLine("--- Misje ---");
            foreach (var m in missions)
            {
                var poolLabel = m.PoolType == "daily" ? "[D]" : "[T]";
                lines.AppendLine($"{poolLabel} {m.MissionName}: {m.Progress}/{m.RequiredAmount}");
            }

            player.PrintToCenter(lines.ToString().TrimEnd());
        }
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private void ShowMissionsToPlayer(CCSPlayerController player)
    {
        var steamId = GetSteamId(player);
        var missions = _missions.GetCachedMissions(steamId);

        if (missions.Count == 0)
        {
            player.PrintToChat(FormatChat("Brak aktywnych misji. Sprawdz ponownie pozniej."));
            return;
        }

        player.PrintToChat(FormatChat("===== Twoje misje ====="));

        var daily = missions.Where(m => m.PoolType == "daily").ToList();
        var weekly = missions.Where(m => m.PoolType == "weekly").ToList();

        if (daily.Count > 0)
        {
            player.PrintToChat(FormatChat("[ Dzienne ]"));
            foreach (var m in daily)
                player.PrintToChat(FormatMissionLine(m));
        }

        if (weekly.Count > 0)
        {
            player.PrintToChat(FormatChat("[ Tygodniowe ]"));
            foreach (var m in weekly)
                player.PrintToChat(FormatMissionLine(m));
        }

        player.PrintToChat(FormatChat("Ukonczone misje odbierz na stronie lub uzyj !odbierz <id>"));
    }

    private string FormatMissionLine(PlayerMissionWithData m)
    {
        var status = m.IsCompleted
            ? (m.IsClaimed ? "\x04[Odebrana]" : "\x06[Do odebrania]")
            : $"\x01[{m.Progress}/{m.RequiredAmount}]";
        var rewards = $"+{m.RewardXp}XP +{m.RewardFaircoin}FC +{m.RewardTicket}T";
        return $" \x05#{m.MissionId}\x01 {m.MissionName} {status} {rewards}";
    }

    private string FormatChat(string message)
    {
        return $" \x08{Config.ChatPrefix}\x01 {message}";
    }

    private static string GetSteamId(CCSPlayerController player)
    {
        return player.SteamID.ToString();
    }
}
