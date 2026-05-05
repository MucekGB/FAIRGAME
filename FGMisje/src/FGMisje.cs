using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Commands;
using CounterStrikeSharp.API.Modules.Utils;
using FGMisje.Lang;
using FGMisje.Models;
using FGMisje.Services;
using Microsoft.Extensions.Logging;

namespace FGMisje;

public class FGMisjePlugin : BasePlugin
{
    public override string ModuleName        => "FGMisje";
    public override string ModuleVersion     => "1.0.0";
    public override string ModuleAuthor      => "FairPlay";
    public override string ModuleDescription => "System misji dziennych i tygodniowych z nagrodami XP/Faircoin/Ticket";

    private PluginConfig   _config   = new();
    private DatabaseService _db      = null!;
    private MissionService  _missions = null!;
    private FgLocalizer     _lang    = new();

    private readonly HashSet<string> _survivedThisRound = new();
    private CsTeam _roundWinnerTeam = CsTeam.None;

    public override void Load(bool hotReload)
    {
        _config  = PluginConfig.Load(Server.GameDirectory);
        _db      = new DatabaseService(_config);
        _missions = new MissionService(_db, _config, Logger);
        _lang.Load(PluginConfig.GetLangDirectory(Server.GameDirectory));

        _ = Task.Run(async () =>
        {
            var ok = await _db.TestConnectionAsync();
            if (!ok)
                Logger.LogError("[FGMisje] Brak polaczenia z baza! Sprawdz FGMisje.json.");
            else
                Logger.LogInformation("[FGMisje] Polaczono z baza danych.");
        });

        RegisterEventHandler<EventPlayerConnectFull>(OnPlayerConnect);
        RegisterEventHandler<EventPlayerDisconnect>(OnPlayerDisconnect);
        RegisterEventHandler<EventPlayerDeath>(OnPlayerDeath);
        RegisterEventHandler<EventPlayerHurt>(OnPlayerHurt);
        RegisterEventHandler<EventBombPlanted>(OnBombPlanted);
        RegisterEventHandler<EventBombDefused>(OnBombDefused);
        RegisterEventHandler<EventRoundEnd>(OnRoundEnd);
        RegisterEventHandler<EventRoundStart>(OnRoundStart);

        AddTimer(_config.SyncIntervalSeconds, OnSyncTimer,
            CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT);

        if (_config.ShowHud)
            AddTimer(_config.HudRefreshSeconds, OnHudTimer,
                CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT);

        if (hotReload)
        {
            foreach (var p in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot))
                _ = _missions.LoadPlayerMissionsAsync(GetSteamId(p));
        }

        Logger.LogInformation("[FGMisje] Plugin zaladowany v{Version}", ModuleVersion);
    }

    public override void Unload(bool hotReload)
    {
        Logger.LogInformation("[FGMisje] Plugin wylaczony.");
    }

    // -------------------------------------------------------------------------
    // Komendy
    // -------------------------------------------------------------------------

    [ConsoleCommand("css_misje", "Wyswietl swoje aktualne misje")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void CommandMisje(CCSPlayerController? player, CommandInfo info)
    {
        if (player == null || !player.IsValid) return;
        ShowMissionsToPlayer(player);
    }

    [ConsoleCommand("css_odbierz", "Odbierz nagrode za ukonczona misje (!odbierz <id>)")]
    [CommandHelper(minArgs: 1, usage: "<mission_id>", whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void CommandOdbierz(CCSPlayerController? player, CommandInfo info)
    {
        if (player == null || !player.IsValid) return;

        if (!int.TryParse(info.GetArg(1), out var missionId))
        {
            player.PrintToChat(Prefix() + _lang.Get("claim_usage"));
            return;
        }

        var steamId = GetSteamId(player);
        _ = Task.Run(async () =>
        {
            var claimed = await _missions.ClaimRewardAsync(steamId, missionId);
            Server.NextFrame(() =>
            {
                if (!player.IsValid) return;
                if (claimed)
                {
                    var m = _missions.GetCachedMissions(steamId)
                        .FirstOrDefault(x => x.MissionId == missionId);
                    if (m != null)
                        player.PrintToChat(Prefix() + _lang.Get("claimed_msg",
                            replacements: new[]
                            {
                                ("name",     m.MissionName),
                                ("xp",       m.RewardXp.ToString()),
                                ("faircoin", m.RewardFaircoin.ToString()),
                                ("ticket",   m.RewardTicket.ToString())
                            }));
                    else
                        player.PrintToChat(Prefix() + _lang.Get("claimed_msg",
                            replacements: new[] { ("name", ""), ("xp", "?"), ("faircoin", "?"), ("ticket", "?") }));
                }
                else
                {
                    player.PrintToChat(Prefix() + _lang.Get("claim_fail"));
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
        _ = Task.Run(async () =>
        {
            await _missions.LoadPlayerMissionsAsync(steamId);
            Server.NextFrame(() =>
            {
                if (!player.IsValid) return;
                var unclaimed = _missions.GetCachedMissions(steamId)
                    .Count(m => m.IsCompleted && !m.IsClaimed);
                if (unclaimed > 0)
                    player.PrintToChat(Prefix() + _lang.Get("unclaimed_notify",
                        replacements: new[] { ("count", unclaimed.ToString()) }));
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

        if (attacker != null && attacker.IsValid && !attacker.IsBot && attacker != victim)
        {
            var steamId = GetSteamId(attacker);
            var killTask = HandleEventAsync(attacker, steamId, MissionType.kills);
            if (ev.Headshot)
            {
                var hsTask = HandleEventAsync(attacker, steamId, MissionType.headshots);
            }
        }

        if (assister != null && assister.IsValid && !assister.IsBot)
        {
            var assistTask = HandleEventAsync(assister, GetSteamId(assister), MissionType.assists);
        }

        if (victim != null && victim.IsValid && !victim.IsBot)
            _survivedThisRound.Remove(GetSteamId(victim));

        return HookResult.Continue;
    }

    private HookResult OnPlayerHurt(EventPlayerHurt ev, GameEventInfo info) => HookResult.Continue;

    private HookResult OnBombPlanted(EventBombPlanted ev, GameEventInfo info)
    {
        var player = ev.Userid;
        if (player == null || !player.IsValid || player.IsBot) return HookResult.Continue;
        var plantTask = HandleEventAsync(player, GetSteamId(player), MissionType.bombs_planted);
        return HookResult.Continue;
    }

    private HookResult OnBombDefused(EventBombDefused ev, GameEventInfo info)
    {
        var player = ev.Userid;
        if (player == null || !player.IsValid || player.IsBot) return HookResult.Continue;
        var defuseTask = HandleEventAsync(player, GetSteamId(player), MissionType.bombs_defused);
        return HookResult.Continue;
    }

    private HookResult OnRoundStart(EventRoundStart ev, GameEventInfo info)
    {
        _survivedThisRound.Clear();
        _roundWinnerTeam = CsTeam.None;
        foreach (var p in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot && p.PawnIsAlive))
            _survivedThisRound.Add(GetSteamId(p));
        return HookResult.Continue;
    }

    private HookResult OnRoundEnd(EventRoundEnd ev, GameEventInfo info)
    {
        _roundWinnerTeam = (CsTeam)ev.Winner;
        foreach (var player in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot))
        {
            var steamId = GetSteamId(player);
            if ((CsTeam)player.TeamNum == _roundWinnerTeam && _roundWinnerTeam != CsTeam.None)
            {
                var wonTask = HandleEventAsync(player, steamId, MissionType.rounds_won);
            }
            if (_survivedThisRound.Contains(steamId) && player.PawnIsAlive)
            {
                var survivedTask = HandleEventAsync(player, steamId, MissionType.rounds_survived);
            }
        }
        return HookResult.Continue;
    }

    // -------------------------------------------------------------------------
    // Timery
    // -------------------------------------------------------------------------

    private void OnSyncTimer()
    {
        foreach (var p in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot))
        {
            var steamId = GetSteamId(p);
            _ = Task.Run(() => _missions.LoadPlayerMissionsAsync(steamId));
        }
    }

    private void OnHudTimer()
    {
        foreach (var player in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot && p.PawnIsAlive))
        {
            var steamId  = GetSteamId(player);
            var missions = _missions.GetCachedMissions(steamId)
                .Where(m => !m.IsCompleted)
                .Take(_config.HudMaxMissions)
                .ToList();

            if (missions.Count == 0) continue;

            var sb = new System.Text.StringBuilder();
            sb.AppendLine("--- Misje ---");
            foreach (var m in missions)
            {
                var tag = m.PoolType == "daily" ? "[D]" : "[T]";
                sb.AppendLine($"{tag} {m.MissionName}: {m.Progress}/{m.RequiredAmount}");
            }
            player.PrintToCenter(sb.ToString().TrimEnd());
        }
    }

    // -------------------------------------------------------------------------
    // Logika ukonczenia misji
    // -------------------------------------------------------------------------

    private async Task HandleEventAsync(CCSPlayerController player, string steamId,
        MissionType type, int amount = 1)
    {
        var completed = await _missions.RegisterEventAsync(steamId, type, amount);
        if (completed.Count == 0) return;

        Server.NextFrame(() =>
        {
            if (!player.IsValid) return;
            foreach (var m in completed)
            {
                player.PrintToChat(Prefix() + _lang.Get("completed_msg",
                    replacements: new[]
                    {
                        ("name",     m.MissionName),
                        ("xp",       m.RewardXp.ToString()),
                        ("faircoin", m.RewardFaircoin.ToString()),
                        ("ticket",   m.RewardTicket.ToString())
                    }));
            }
        });
    }

    // -------------------------------------------------------------------------
    // Wyswietlanie listy misji
    // -------------------------------------------------------------------------

    private void ShowMissionsToPlayer(CCSPlayerController player)
    {
        var steamId  = GetSteamId(player);
        var missions = _missions.GetCachedMissions(steamId);

        if (missions.Count == 0)
        {
            player.PrintToChat(Prefix() + _lang.Get("no_missions"));
            return;
        }

        player.PrintToChat(Prefix() + _lang.Get("header"));

        var daily  = missions.Where(m => m.PoolType == "daily").ToList();
        var weekly = missions.Where(m => m.PoolType == "weekly").ToList();

        if (daily.Count > 0)
        {
            player.PrintToChat(Prefix() + _lang.Get("daily_header"));
            foreach (var m in daily)
                player.PrintToChat(FormatMissionLine(m));
        }

        if (weekly.Count > 0)
        {
            player.PrintToChat(Prefix() + _lang.Get("weekly_header"));
            foreach (var m in weekly)
                player.PrintToChat(FormatMissionLine(m));
        }

        player.PrintToChat(Prefix() + _lang.Get("claim_hint"));
    }

    private string FormatMissionLine(PlayerMissionWithData m)
    {
        string status;
        if (m.IsCompleted)
            status = m.IsClaimed
                ? _lang.Get("status_claimed")
                : _lang.Get("status_to_claim");
        else
            status = _lang.Get("status_active",
                replacements: new[]
                {
                    ("progress", m.Progress.ToString()),
                    ("required", m.RequiredAmount.ToString())
                });

        var rewards = $"+{m.RewardXp}XP +{m.RewardFaircoin}FC +{m.RewardTicket}T";

        return $" \x05#{m.MissionId}\x01 {m.MissionName} {status} {rewards}";
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private string Prefix() => $" \x08{_config.ChatPrefix}\x01 ";

    private static string GetSteamId(CCSPlayerController player) =>
        player.SteamID.ToString();
}
