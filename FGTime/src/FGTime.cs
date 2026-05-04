using CounterStrikeSharp.API;
using CounterStrikeSharp.API.Core;
using CounterStrikeSharp.API.Core.Attributes.Registration;
using CounterStrikeSharp.API.Modules.Admin;
using CounterStrikeSharp.API.Modules.Commands;
using FGTime.Api;
using FGTime.Lang;
using FGTime.Services;
using Microsoft.Extensions.Logging;

namespace FGTime;

public class FGTimePlugin : BasePlugin, IFGTimeApi
{
    public override string ModuleName        => "FGTime";
    public override string ModuleVersion     => "1.0.0";
    public override string ModuleAuthor      => "FairPlay";
    public override string ModuleDescription => "Sledzenie czasu graczy — multi-server, open API";

    private PluginConfig   _config   = new();
    private DatabaseService _db      = null!;
    private TimeService    _time     = null!;
    private FgLocalizer    _lang     = new();

    // IFGTimeApi events
    public event Action<string, int, long>? OnSessionEnded;
    public event Action<string, int>?       OnTimeFlushed;

    public override void Load(bool hotReload)
    {
        _config = PluginConfig.Load(Server.GameDirectory);
        _db     = new DatabaseService(_config);
        _time   = new TimeService(_db, _config, Logger);
        _lang.Load(PluginConfig.GetLangDirectory(Server.GameDirectory));

        _ = Task.Run(async () =>
        {
            var ok = await _db.TestConnectionAsync();
            if (!ok)
            {
                Logger.LogError("[FGTime] Brak polaczenia z baza! Sprawdz FGTime.json.");
                return;
            }
            await _db.UpsertServerAsync(_config.ServerId, _config.ServerName);
            Logger.LogInformation("[FGTime] Polaczono z baza. Serwer: {Id} ({Name})",
                _config.ServerId, _config.ServerName);
        });

        RegisterEventHandler<EventPlayerConnectFull>(OnPlayerConnect);
        RegisterEventHandler<EventPlayerDisconnect>(OnPlayerDisconnect);

        AddTimer(_config.SaveIntervalSeconds, OnSaveTimer,
            CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT);

        if (_config.ShowHud)
            AddTimer(_config.HudRefreshSeconds, OnHudTimer,
                CounterStrikeSharp.API.Modules.Timers.TimerFlags.REPEAT);

        if (hotReload)
        {
            foreach (var p in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot))
                _ = _time.StartSessionAsync(GetSteamId(p), p.PlayerName ?? "Unknown");
        }

        Logger.LogInformation("[FGTime] Plugin zaladowany v{Version}", ModuleVersion);
    }

    public override void Unload(bool hotReload)
    {
        var players = Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot).ToList();
        foreach (var p in players)
            _ = _time.EndSessionAsync(GetSteamId(p));

        Logger.LogInformation("[FGTime] Plugin wylaczony.");
    }

    // -------------------------------------------------------------------------
    // Eventy gracza
    // -------------------------------------------------------------------------

    private HookResult OnPlayerConnect(EventPlayerConnectFull ev, GameEventInfo info)
    {
        var player = ev.Userid;
        if (player == null || !player.IsValid || player.IsBot) return HookResult.Continue;

        var steamId = GetSteamId(player);
        var name    = player.PlayerName ?? "Unknown";
        _ = Task.Run(() => _time.StartSessionAsync(steamId, name));

        return HookResult.Continue;
    }

    private HookResult OnPlayerDisconnect(EventPlayerDisconnect ev, GameEventInfo info)
    {
        var player = ev.Userid;
        if (player == null || player.IsBot) return HookResult.Continue;

        var steamId = GetSteamId(player);
        var sessionSecs = _time.GetCurrentSessionSeconds(steamId);

        _ = Task.Run(async () =>
        {
            await _time.EndSessionAsync(steamId);
            var total = await _db.GetPlayerTimeOnServerAsync(steamId, _config.ServerId);
            var totalSecs = total?.TotalSeconds ?? 0;
            OnSessionEnded?.Invoke(steamId, sessionSecs, totalSecs);
        });

        return HookResult.Continue;
    }

    // -------------------------------------------------------------------------
    // Timery
    // -------------------------------------------------------------------------

    private void OnSaveTimer()
    {
        _ = Task.Run(async () =>
        {
            await _time.FlushAllSessionsAsync();

            var players = Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot).ToList();
            foreach (var p in players)
            {
                var steamId = GetSteamId(p);
                var secs    = _time.GetCurrentSessionSeconds(steamId);
                OnTimeFlushed?.Invoke(steamId, secs);
            }
        });
    }

    private void OnHudTimer()
    {
        foreach (var player in Utilities.GetPlayers().Where(p => p.IsValid && !p.IsBot && p.PawnIsAlive))
        {
            var steamId  = GetSteamId(player);
            var sessSecs = _time.GetCurrentSessionSeconds(steamId);
            var text     = _config.HudText
                .Replace("{time}", FormatTime(sessSecs))
                .Replace("{time_total}", FormatTime(sessSecs));
            player.PrintToCenter(text);
        }
    }

    // -------------------------------------------------------------------------
    // Komendy gracza
    // -------------------------------------------------------------------------

    [ConsoleCommand("css_czas", "Sprawdz swoj czas na serwerze")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void CommandCzas(CCSPlayerController? player, CommandInfo info)
    {
        if (player == null || !player.IsValid) return;

        var target  = info.ArgCount > 1 ? info.GetArg(1) : null;
        var steamId = GetSteamId(player);

        if (target == null)
        {
            ShowTimeForSteamId(player, steamId, null);
        }
        else
        {
            var found = Utilities.GetPlayers()
                .FirstOrDefault(p => p.IsValid && !p.IsBot &&
                    (p.PlayerName ?? "").Contains(target, StringComparison.OrdinalIgnoreCase));

            if (found != null)
            {
                ShowTimeForSteamId(player, GetSteamId(found), found.PlayerName);
            }
            else
            {
                _ = Task.Run(async () =>
                {
                    var result = await _db.FindPlayerByNameAsync(target);
                    Server.NextFrame(() =>
                    {
                        if (!player.IsValid) return;
                        if (result == null)
                        {
                            player.PrintToChat(Prefix() + _lang.Get("player_not_found"));
                            return;
                        }
                        var serverSecs = 0L;
                        player.PrintToChat(Prefix() + _lang.Get("time_other",
                            replacements: new[]
                            {
                                ("player", result.PlayerName),
                                ("server", _config.ServerName),
                                ("time_server", FormatTime((int)serverSecs)),
                                ("time_total", FormatTime((int)result.TotalSecondsGlobal))
                            }));
                    });
                });
            }
        }
    }

    [ConsoleCommand("css_topczas", "Top graczy z najwiekszym czasem")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void CommandTopCzas(CCSPlayerController? player, CommandInfo info)
    {
        if (player == null || !player.IsValid) return;

        var isGlobal = info.ArgCount > 1 &&
            info.GetArg(1).Equals("global", StringComparison.OrdinalIgnoreCase);

        _ = Task.Run(async () =>
        {
            var top = isGlobal
                ? await _db.GetTopGlobalAsync(_config.TopCount)
                : await _db.GetTopByServerAsync(_config.ServerId, _config.TopCount);

            Server.NextFrame(() =>
            {
                if (!player.IsValid) return;
                var header = isGlobal
                    ? _lang.Get("top_global_header", replacements: new[] { ("count", _config.TopCount.ToString()) })
                    : _lang.Get("top_header", replacements: new[] { ("count", _config.TopCount.ToString()), ("server", _config.ServerName) });

                player.PrintToChat(Prefix() + header);
                foreach (var entry in top)
                {
                    player.PrintToChat(Prefix() + _lang.Get("top_entry",
                        replacements: new[]
                        {
                            ("pos",    entry.Position.ToString()),
                            ("player", entry.PlayerName),
                            ("time",   FormatTime((int)entry.TotalSeconds))
                        }));
                }
            });
        });
    }

    [ConsoleCommand("css_serwery", "Twoj czas na wszystkich serwerach")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_ONLY)]
    public void CommandSerwery(CCSPlayerController? player, CommandInfo info)
    {
        if (player == null || !player.IsValid) return;
        var steamId = GetSteamId(player);

        _ = Task.Run(async () =>
        {
            var list = await _db.GetPlayerTimePerServerAsync(steamId);
            Server.NextFrame(() =>
            {
                if (!player.IsValid) return;
                player.PrintToChat(Prefix() + _lang.Get("servers_header"));
                if (list.Count == 0)
                {
                    player.PrintToChat(Prefix() + _lang.Get("no_data"));
                    return;
                }
                foreach (var (serverName, secs) in list)
                {
                    player.PrintToChat(Prefix() + _lang.Get("servers_entry",
                        replacements: new[]
                        {
                            ("server", serverName),
                            ("time",   FormatTime((int)secs))
                        }));
                }
            });
        });
    }

    // -------------------------------------------------------------------------
    // Komendy admina
    // -------------------------------------------------------------------------

    [ConsoleCommand("css_resetczas", "Resetuj czas gracza na tym serwerze")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_AND_SERVER)]
    public void CommandResetCzas(CCSPlayerController? player, CommandInfo info)
    {
        if (!HasAdminPermission(player))
        {
            player?.PrintToChat(Prefix() + _lang.Get("no_permission"));
            return;
        }
        if (info.ArgCount < 2)
        {
            player?.PrintToChat(Prefix() + _lang.Get("usage_reset"));
            return;
        }

        var targetName = info.GetArg(1);
        var target = Utilities.GetPlayers()
            .FirstOrDefault(p => p.IsValid && !p.IsBot &&
                (p.PlayerName ?? "").Contains(targetName, StringComparison.OrdinalIgnoreCase));

        if (target == null)
        {
            player?.PrintToChat(Prefix() + _lang.Get("player_not_found"));
            return;
        }

        var targetSteamId = GetSteamId(target);
        _ = Task.Run(async () =>
        {
            await _db.ResetPlayerTimeOnServerAsync(targetSteamId, _config.ServerId);
            Server.NextFrame(() =>
            {
                player?.PrintToChat(Prefix() + _lang.Get("reset_success",
                    replacements: new[] { ("player", target.PlayerName ?? targetName) }));
            });
        });
    }

    [ConsoleCommand("css_addczas", "Dodaj czas graczowi")]
    [CommandHelper(whoCanExecute: CommandUsage.CLIENT_AND_SERVER)]
    public void CommandAddCzas(CCSPlayerController? player, CommandInfo info)
    {
        if (!HasAdminPermission(player))
        {
            player?.PrintToChat(Prefix() + _lang.Get("no_permission"));
            return;
        }
        if (info.ArgCount < 3 || !int.TryParse(info.GetArg(2), out var minutes))
        {
            player?.PrintToChat(Prefix() + _lang.Get("usage_add"));
            return;
        }

        var targetName = info.GetArg(1);
        var target = Utilities.GetPlayers()
            .FirstOrDefault(p => p.IsValid && !p.IsBot &&
                (p.PlayerName ?? "").Contains(targetName, StringComparison.OrdinalIgnoreCase));

        if (target == null)
        {
            player?.PrintToChat(Prefix() + _lang.Get("player_not_found"));
            return;
        }

        var targetSteamId = GetSteamId(target);
        var pName = target.PlayerName ?? targetName;

        _ = Task.Run(async () =>
        {
            await _db.AddTimeToPlayerAsync(targetSteamId, _config.ServerId, pName, minutes * 60);
            Server.NextFrame(() =>
            {
                player?.PrintToChat(Prefix() + _lang.Get("add_success",
                    replacements: new[]
                    {
                        ("player",  pName),
                        ("minutes", minutes.ToString())
                    }));
            });
        });
    }

    // -------------------------------------------------------------------------
    // IFGTimeApi implementacja
    // -------------------------------------------------------------------------

    public async Task<long> GetTotalTimeOnServerAsync(string steamId)
    {
        var row = await _db.GetPlayerTimeOnServerAsync(steamId, _config.ServerId);
        var saved = row?.TotalSeconds ?? 0;
        var session = _time.GetCurrentSessionSeconds(steamId);
        return saved + session;
    }

    public async Task<long> GetTotalTimeGlobalAsync(string steamId)
    {
        var row = await _db.GetPlayerTimeGlobalAsync(steamId);
        var saved = row?.TotalSecondsGlobal ?? 0;
        var session = _time.GetCurrentSessionSeconds(steamId);
        return saved + session;
    }

    public int GetCurrentSessionSeconds(string steamId) =>
        _time.GetCurrentSessionSeconds(steamId);

    public bool IsPlayerOnline(string steamId) =>
        _time.HasActiveSession(steamId);

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private void ShowTimeForSteamId(CCSPlayerController requester, string steamId, string? displayName)
    {
        var sessionSecs = _time.GetCurrentSessionSeconds(steamId);
        _ = Task.Run(async () =>
        {
            var serverRow = await _db.GetPlayerTimeOnServerAsync(steamId, _config.ServerId);
            var globalRow = await _db.GetPlayerTimeGlobalAsync(steamId);

            var serverTotal = (serverRow?.TotalSeconds ?? 0) + sessionSecs;
            var globalTotal = (globalRow?.TotalSecondsGlobal ?? 0) + sessionSecs;

            Server.NextFrame(() =>
            {
                if (!requester.IsValid) return;
                var isSelf = steamId == GetSteamId(requester);
                var key    = isSelf ? "time_self" : "time_other";
                var name   = displayName ?? globalRow?.PlayerName ?? steamId;

                requester.PrintToChat(Prefix() + _lang.Get(key,
                    replacements: new[]
                    {
                        ("player",      name),
                        ("server",      _config.ServerName),
                        ("time_server", FormatTime((int)serverTotal)),
                        ("time_total",  FormatTime((int)globalTotal))
                    }));
            });
        });
    }

    private bool HasAdminPermission(CCSPlayerController? player)
    {
        if (player == null) return true; // konsola serwera
        return AdminManager.PlayerHasPermissions(player, _config.AdminFlag);
    }

    private string Prefix() => $" \x08{_config.ChatPrefix}\x01 ";

    private static string GetSteamId(CCSPlayerController player) =>
        player.SteamID.ToString();

    public static string FormatTime(int totalSeconds)
    {
        if (totalSeconds <= 0) return "0min";
        var ts = TimeSpan.FromSeconds(totalSeconds);
        if (ts.TotalHours >= 1)
            return $"{(int)ts.TotalHours}h {ts.Minutes}min";
        return $"{ts.Minutes}min {ts.Seconds}s";
    }
}
