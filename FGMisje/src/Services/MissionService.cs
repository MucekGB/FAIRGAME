using FGMisje.Models;
using Microsoft.Extensions.Logging;

namespace FGMisje.Services;

public class MissionService
{
    private readonly DatabaseService _db;
    private readonly PluginConfig _config;
    private readonly ILogger _logger;

    // Cache: steamid -> lista misji gracza (zeby nie laczyc sie z baza na kazdym zabojstwie)
    private readonly Dictionary<string, List<PlayerMissionWithData>> _playerMissionsCache = new();
    private readonly object _cacheLock = new();

    public MissionService(DatabaseService db, PluginConfig config, ILogger logger)
    {
        _db = db;
        _config = config;
        _logger = logger;
    }

    // Zaladuj/odswiedz misje gracza do cache (wywolywane przy laczeniu i co SyncInterval)
    public async Task LoadPlayerMissionsAsync(string steamId)
    {
        try
        {
            // Przypisz misje z aktywnej puli jesli gracz ich nie ma
            await AssignMissingMissionsAsync(steamId);

            var missions = await _db.GetPlayerMissionsAsync(steamId);
            lock (_cacheLock)
            {
                _playerMissionsCache[steamId] = missions;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[Misje] Blad ladowania misji gracza {SteamId}", steamId);
        }
    }

    public void RemovePlayerFromCache(string steamId)
    {
        lock (_cacheLock)
        {
            _playerMissionsCache.Remove(steamId);
        }
    }

    public List<PlayerMissionWithData> GetCachedMissions(string steamId)
    {
        lock (_cacheLock)
        {
            return _playerMissionsCache.TryGetValue(steamId, out var missions)
                ? missions
                : new List<PlayerMissionWithData>();
        }
    }

    // Zarejestruj zdarzenie gry i zaktualizuj postep misji pasujacego typu
    // Zwraca liste misji ktore zostaly ukonczone tym zdarzeniem
    public async Task<List<PlayerMissionWithData>> RegisterEventAsync(string steamId, MissionType eventType, int amount = 1)
    {
        var completed = new List<PlayerMissionWithData>();
        List<PlayerMissionWithData> toUpdate;

        lock (_cacheLock)
        {
            if (!_playerMissionsCache.TryGetValue(steamId, out var missions))
                return completed;

            // Filtruj aktywne (nie ukonczone) misje pasujacego typu
            toUpdate = missions
                .Where(m => !m.IsCompleted && m.Type == eventType)
                .ToList();
        }

        foreach (var mission in toUpdate)
        {
            try
            {
                var updated = await _db.UpdateProgressAsync(steamId, mission.MissionId, amount);
                if (!updated) continue;

                // Odswiedz cache dla tej misji
                var newProgress = Math.Min(mission.Progress + amount, mission.RequiredAmount);
                var justCompleted = newProgress >= mission.RequiredAmount && !mission.IsCompleted;

                lock (_cacheLock)
                {
                    if (_playerMissionsCache.TryGetValue(steamId, out var cached))
                    {
                        var cachedMission = cached.FirstOrDefault(m => m.MissionId == mission.MissionId);
                        if (cachedMission != null)
                        {
                            cachedMission.Progress = newProgress;
                            if (justCompleted)
                            {
                                cachedMission.IsCompleted = true;
                            }
                        }
                    }
                }

                if (justCompleted)
                {
                    completed.Add(new PlayerMissionWithData
                    {
                        PlayerMissionId = mission.PlayerMissionId,
                        SteamId = mission.SteamId,
                        MissionId = mission.MissionId,
                        MissionName = mission.MissionName,
                        Description = mission.Description,
                        Type = mission.Type,
                        RequiredAmount = mission.RequiredAmount,
                        Progress = newProgress,
                        IsCompleted = true,
                        IsClaimed = mission.IsClaimed,
                        RewardXp = mission.RewardXp,
                        RewardFaircoin = mission.RewardFaircoin,
                        RewardTicket = mission.RewardTicket,
                        PoolType = mission.PoolType
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Misje] Blad aktualizacji postępu misji {MissionId} dla {SteamId}", mission.MissionId, steamId);
            }
        }

        return completed;
    }

    public async Task<bool> ClaimRewardAsync(string steamId, int missionId)
    {
        var result = await _db.ClaimMissionRewardAsync(steamId, missionId);
        if (result)
        {
            // Odswiedz cache
            await LoadPlayerMissionsAsync(steamId);
        }
        return result;
    }

    private async Task AssignMissingMissionsAsync(string steamId)
    {
        foreach (var poolType in new[] { "daily", "weekly" })
        {
            var limit = poolType == "daily"
                ? _config.DailyMissionsPerPlayer
                : _config.WeeklyMissionsPerPlayer;

            var allPoolMissions = await _db.GetActiveMissionsFromPoolAsync(poolType);
            if (allPoolMissions.Count == 0) continue;

            var existingMissions = await _db.GetPlayerMissionsAsync(steamId);
            var existingInPool = existingMissions
                .Where(m => m.PoolType == poolType)
                .Select(m => m.MissionId)
                .ToHashSet();

            // Misje z puli ktore nie sa jeszcze przypisane graczowi
            var unassigned = allPoolMissions
                .Where(m => !existingInPool.Contains(m.Id))
                .ToList();

            // Ile brakuje do limitu
            var currentCount = existingInPool.Count;
            var needed = limit - currentCount;
            if (needed <= 0 || unassigned.Count == 0) continue;

            // Losowo wybierz misje (shuffle)
            var rnd = new Random();
            var toAssign = unassigned
                .OrderBy(_ => rnd.Next())
                .Take(needed)
                .ToList();

            await _db.AssignMissionsToPlayerAsync(steamId, toAssign);
        }
    }

    public string GetMissionTypeName(MissionType type) => type switch
    {
        MissionType.kills => "Zabójstwa",
        MissionType.headshots => "Headshooty",
        MissionType.rounds_won => "Wygrane rundy",
        MissionType.bombs_planted => "Podłożone bomby",
        MissionType.bombs_defused => "Rozbrojone bomby",
        MissionType.assists => "Asysty",
        MissionType.rounds_survived => "Przeżyte rundy",
        _ => type.ToString()
    };
}
