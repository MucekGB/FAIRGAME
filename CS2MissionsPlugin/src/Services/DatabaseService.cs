using System.Data;
using CS2MissionsPlugin.Models;
using Dapper;
using MySqlConnector;

namespace CS2MissionsPlugin.Services;

public class DatabaseService
{
    private readonly string _connectionString;

    public DatabaseService(PluginConfig config)
    {
        _connectionString = new MySqlConnectionStringBuilder
        {
            Server = config.DatabaseHost,
            Port = (uint)config.DatabasePort,
            Database = config.DatabaseName,
            UserID = config.DatabaseUser,
            Password = config.DatabasePassword,
            CharacterSet = "utf8mb4",
            ConnectionTimeout = 10,
        }.ConnectionString;
    }

    private IDbConnection GetConnection() => new MySqlConnection(_connectionString);

    public async Task<bool> TestConnectionAsync()
    {
        try
        {
            using var conn = GetConnection();
            await ((MySqlConnection)conn).OpenAsync();
            return true;
        }
        catch
        {
            return false;
        }
    }

    // Pobierz aktywne misje z aktywnej puli (daily lub weekly)
    public async Task<List<Mission>> GetActiveMissionsFromPoolAsync(string poolType)
    {
        using var conn = GetConnection();
        var sql = @"
            SELECT m.id AS Id,
                   m.pool_id AS PoolId,
                   m.name AS Name,
                   m.description AS Description,
                   m.type AS Type,
                   m.required_amount AS RequiredAmount,
                   m.reward_xp AS RewardXp,
                   m.reward_faircoin AS RewardFaircoin,
                   m.reward_ticket AS RewardTicket,
                   m.is_active AS IsActive,
                   mp.type AS PoolType
            FROM missions m
            INNER JOIN mission_pools mp ON mp.id = m.pool_id
            WHERE mp.type = @poolType
              AND mp.is_active = 1
              AND CURDATE() BETWEEN mp.active_from AND mp.active_to
              AND m.is_active = 1
            ORDER BY m.id";
        var result = await conn.QueryAsync<Mission>(sql, new { poolType });
        return result.AsList();
    }

    // Pobierz misje gracza (z danymi misji) - aktywna pula
    public async Task<List<PlayerMissionWithData>> GetPlayerMissionsAsync(string steamId)
    {
        using var conn = GetConnection();
        var sql = @"
            SELECT pm.id AS PlayerMissionId,
                   pm.steamid AS SteamId,
                   pm.mission_id AS MissionId,
                   m.name AS MissionName,
                   m.description AS Description,
                   m.type AS Type,
                   m.required_amount AS RequiredAmount,
                   pm.progress AS Progress,
                   pm.is_completed AS IsCompleted,
                   pm.is_claimed AS IsClaimed,
                   m.reward_xp AS RewardXp,
                   m.reward_faircoin AS RewardFaircoin,
                   m.reward_ticket AS RewardTicket,
                   mp.type AS PoolType
            FROM player_missions pm
            INNER JOIN missions m ON m.id = pm.mission_id
            INNER JOIN mission_pools mp ON mp.id = m.pool_id
            WHERE pm.steamid = @steamId
              AND mp.is_active = 1
              AND CURDATE() BETWEEN mp.active_from AND mp.active_to
            ORDER BY mp.type, pm.is_completed, m.id";
        var result = await conn.QueryAsync<PlayerMissionWithData>(sql, new { steamId });
        return result.AsList();
    }

    // Przypisz misje graczowi jesli ich nie ma jeszcze w tej puli
    public async Task AssignMissionsToPlayerAsync(string steamId, List<Mission> missions)
    {
        if (missions.Count == 0) return;
        using var conn = GetConnection();
        var sql = @"
            INSERT IGNORE INTO player_missions (steamid, mission_id)
            VALUES (@SteamId, @MissionId)";
        var rows = missions.Select(m => new { SteamId = steamId, MissionId = m.Id });
        await conn.ExecuteAsync(sql, rows);
    }

    // Zaktualizuj postep misji gracza
    public async Task<bool> UpdateProgressAsync(string steamId, int missionId, int increment)
    {
        using var conn = GetConnection();
        var sql = @"
            UPDATE player_missions pm
            INNER JOIN missions m ON m.id = pm.mission_id
            SET pm.progress = LEAST(pm.progress + @increment, m.required_amount),
                pm.is_completed = IF(pm.progress + @increment >= m.required_amount, 1, 0),
                pm.completed_at = IF(pm.progress + @increment >= m.required_amount AND pm.completed_at IS NULL, NOW(), pm.completed_at)
            WHERE pm.steamid = @steamId
              AND pm.mission_id = @missionId
              AND pm.is_completed = 0";
        var affected = await conn.ExecuteAsync(sql, new { steamId, missionId, increment });
        return affected > 0;
    }

    // Pobierz postep konkretnej misji gracza
    public async Task<PlayerMission?> GetPlayerMissionAsync(string steamId, int missionId)
    {
        using var conn = GetConnection();
        var sql = @"
            SELECT id AS Id, steamid AS SteamId, mission_id AS MissionId,
                   progress AS Progress, is_completed AS IsCompleted,
                   is_claimed AS IsClaimed, assigned_at AS AssignedAt,
                   completed_at AS CompletedAt
            FROM player_missions
            WHERE steamid = @steamId AND mission_id = @missionId";
        return await conn.QueryFirstOrDefaultAsync<PlayerMission>(sql, new { steamId, missionId });
    }

    // Pobierz portfel gracza
    public async Task<PlayerWallet> GetOrCreateWalletAsync(string steamId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(@"
            INSERT IGNORE INTO player_wallet (steamid) VALUES (@steamId)",
            new { steamId });
        var wallet = await conn.QueryFirstAsync<PlayerWallet>(@"
            SELECT steamid AS SteamId, xp AS Xp, faircoin AS Faircoin, ticket AS Ticket
            FROM player_wallet WHERE steamid = @steamId",
            new { steamId });
        return wallet;
    }

    // Odbierz nagrode za misje (atomic: sprawdz czy nie odebrano, dodaj do portfela, oznacz jako claimed)
    public async Task<bool> ClaimMissionRewardAsync(string steamId, int missionId)
    {
        using var conn = new MySqlConnection(_connectionString);
        await conn.OpenAsync();
        using var tx = await conn.BeginTransactionAsync();
        try
        {
            var pm = await conn.QueryFirstOrDefaultAsync<PlayerMission>(@"
                SELECT id AS Id, is_completed AS IsCompleted, is_claimed AS IsClaimed
                FROM player_missions
                WHERE steamid = @steamId AND mission_id = @missionId
                FOR UPDATE",
                new { steamId, missionId }, tx);

            if (pm == null || !pm.IsCompleted || pm.IsClaimed)
            {
                await tx.RollbackAsync();
                return false;
            }

            var mission = await conn.QueryFirstOrDefaultAsync<Mission>(@"
                SELECT reward_xp AS RewardXp, reward_faircoin AS RewardFaircoin, reward_ticket AS RewardTicket
                FROM missions WHERE id = @missionId",
                new { missionId }, tx);
            if (mission == null)
            {
                await tx.RollbackAsync();
                return false;
            }

            await conn.ExecuteAsync(@"
                UPDATE player_missions SET is_claimed = 1, claimed_at = NOW()
                WHERE id = @id", new { id = pm.Id }, tx);

            await conn.ExecuteAsync(@"
                INSERT INTO player_wallet (steamid, xp, faircoin, ticket)
                VALUES (@steamId, @xp, @faircoin, @ticket)
                ON DUPLICATE KEY UPDATE
                    xp = xp + VALUES(xp),
                    faircoin = faircoin + VALUES(faircoin),
                    ticket = ticket + VALUES(ticket)",
                new
                {
                    steamId,
                    xp = mission.RewardXp,
                    faircoin = mission.RewardFaircoin,
                    ticket = mission.RewardTicket
                }, tx);

            await conn.ExecuteAsync(@"
                INSERT INTO mission_rewards_log (steamid, mission_id, xp_given, faircoin_given, ticket_given)
                VALUES (@steamId, @missionId, @xp, @faircoin, @ticket)",
                new
                {
                    steamId,
                    missionId,
                    xp = mission.RewardXp,
                    faircoin = mission.RewardFaircoin,
                    ticket = mission.RewardTicket
                }, tx);

            await tx.CommitAsync();
            return true;
        }
        catch
        {
            await tx.RollbackAsync();
            throw;
        }
    }

    // Pobierz misje ukonczone ale nie odebrane (do wyswietlenia na stronie)
    public async Task<List<PlayerMissionWithData>> GetCompletedUnclaimedAsync(string steamId)
    {
        using var conn = GetConnection();
        var sql = @"
            SELECT pm.id AS PlayerMissionId, pm.steamid AS SteamId, pm.mission_id AS MissionId,
                   m.name AS MissionName, m.description AS Description, m.type AS Type,
                   m.required_amount AS RequiredAmount, pm.progress AS Progress,
                   pm.is_completed AS IsCompleted, pm.is_claimed AS IsClaimed,
                   m.reward_xp AS RewardXp, m.reward_faircoin AS RewardFaircoin,
                   m.reward_ticket AS RewardTicket, mp.type AS PoolType
            FROM player_missions pm
            INNER JOIN missions m ON m.id = pm.mission_id
            INNER JOIN mission_pools mp ON mp.id = m.pool_id
            WHERE pm.steamid = @steamId
              AND pm.is_completed = 1
              AND pm.is_claimed = 0
            ORDER BY pm.completed_at DESC";
        var result = await conn.QueryAsync<PlayerMissionWithData>(sql, new { steamId });
        return result.AsList();
    }
}
