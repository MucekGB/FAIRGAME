using FGTime.Models;
using Microsoft.Extensions.Logging;

namespace FGTime.Services;

public class PlayerSession
{
    public long SessionId { get; set; }
    public string SteamId { get; set; } = "";
    public string PlayerName { get; set; } = "";
    public DateTime ConnectedAt { get; set; } = DateTime.UtcNow;
    public int LastSavedSeconds { get; set; } = 0;

    public int ElapsedSeconds => (int)(DateTime.UtcNow - ConnectedAt).TotalSeconds;
    public int UnflushedSeconds => ElapsedSeconds - LastSavedSeconds;
}

public class TimeService
{
    private readonly DatabaseService _db;
    private readonly PluginConfig _config;
    private readonly ILogger _logger;

    private readonly Dictionary<string, PlayerSession> _sessions = new();
    private readonly object _lock = new();

    public TimeService(DatabaseService db, PluginConfig config, ILogger logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    public async Task StartSessionAsync(string steamId, string playerName)
    {
        try
        {
            var sessionId = await _db.StartSessionAsync(steamId, playerName, _config.ServerId);
            lock (_lock)
            {
                _sessions[steamId] = new PlayerSession
                {
                    SessionId  = sessionId,
                    SteamId    = steamId,
                    PlayerName = playerName,
                    ConnectedAt = DateTime.UtcNow,
                    LastSavedSeconds = 0
                };
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[FGTime] Blad startu sesji gracza {SteamId}", steamId);
        }
    }

    public async Task EndSessionAsync(string steamId)
    {
        PlayerSession? session;
        lock (_lock)
        {
            if (!_sessions.TryGetValue(steamId, out session))
                return;
            _sessions.Remove(steamId);
        }

        try
        {
            var total = session.ElapsedSeconds;
            var unflushed = session.UnflushedSeconds;

            await _db.EndSessionAsync(session.SessionId, total);

            if (unflushed > 0)
                await _db.FlushSessionTimeAsync(steamId, _config.ServerId, session.PlayerName, unflushed);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[FGTime] Blad zakonczenia sesji gracza {SteamId}", steamId);
        }
    }

    // Wywolywane co SaveInterval — zapisuje niesflusowany czas
    public async Task FlushAllSessionsAsync()
    {
        List<PlayerSession> snapshot;
        lock (_lock)
        {
            snapshot = _sessions.Values.ToList();
        }

        foreach (var session in snapshot)
        {
            var unflushed = session.UnflushedSeconds;
            if (unflushed <= 0) continue;

            try
            {
                await _db.FlushSessionTimeAsync(
                    session.SteamId, _config.ServerId, session.PlayerName, unflushed);

                lock (_lock)
                {
                    if (_sessions.TryGetValue(session.SteamId, out var s))
                        s.LastSavedSeconds = s.ElapsedSeconds;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[FGTime] Blad flush sesji {SteamId}", session.SteamId);
            }
        }
    }

    // Biezacy czas sesji gracza (live, bez bazy)
    public int GetCurrentSessionSeconds(string steamId)
    {
        lock (_lock)
        {
            return _sessions.TryGetValue(steamId, out var s) ? s.ElapsedSeconds : 0;
        }
    }

    public bool HasActiveSession(string steamId)
    {
        lock (_lock)
        {
            return _sessions.ContainsKey(steamId);
        }
    }
}
