using Dapper;
using FGTime.Models;
using MySqlConnector;

namespace FGTime.Services;

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

    private MySqlConnection GetConnection() => new(_connectionString);

    public async Task<bool> TestConnectionAsync()
    {
        try
        {
            using var conn = GetConnection();
            await conn.OpenAsync();
            return true;
        }
        catch { return false; }
    }

    // Zarejestruj/zaktualizuj serwer
    public async Task UpsertServerAsync(string serverId, string serverName)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(@"
            INSERT INTO fg_servers (id, name) VALUES (@id, @name)
            ON DUPLICATE KEY UPDATE name = VALUES(name), last_seen = NOW()",
            new { id = serverId, name = serverName });
    }

    // Rozpocznij sesje gracza, zwraca ID sesji
    public async Task<long> StartSessionAsync(string steamId, string playerName, string serverId)
    {
        using var conn = GetConnection();
        return await conn.ExecuteScalarAsync<long>(@"
            INSERT INTO fg_sessions (steamid, player_name, server_id)
            VALUES (@steamId, @playerName, @serverId);
            SELECT LAST_INSERT_ID();",
            new { steamId, playerName, serverId });
    }

    // Zakoncz sesje gracza
    public async Task EndSessionAsync(long sessionId, int durationSeconds)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(@"
            UPDATE fg_sessions
            SET disconnected_at = NOW(), duration_seconds = @durationSeconds
            WHERE id = @sessionId",
            new { sessionId, durationSeconds });

        // Zaktualizuj sumaryczny czas
        await conn.ExecuteAsync(@"
            INSERT INTO fg_player_time (steamid, server_id, player_name, total_seconds)
            SELECT steamid, server_id, player_name, @durationSeconds
            FROM fg_sessions WHERE id = @sessionId
            ON DUPLICATE KEY UPDATE
                total_seconds = total_seconds + VALUES(total_seconds),
                player_name   = VALUES(player_name),
                last_seen     = NOW()",
            new { sessionId, durationSeconds });
    }

    // Zapisz postep sesji (co SaveInterval sekund - ochrona przed crashem)
    public async Task SaveSessionProgressAsync(long sessionId, string steamId, string serverId,
        string playerName, int durationSeconds)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(@"
            UPDATE fg_sessions SET duration_seconds = @durationSeconds WHERE id = @sessionId",
            new { sessionId, durationSeconds });

        // Zaktualizuj sumaryczny czas (inkrementalnie od ostatniego zapisu)
        await conn.ExecuteAsync(@"
            INSERT INTO fg_player_time (steamid, server_id, player_name, total_seconds)
            VALUES (@steamId, @serverId, @playerName, 0)
            ON DUPLICATE KEY UPDATE player_name = VALUES(player_name)",
            new { steamId, serverId, playerName });
    }

    // Pobierz czas gracza na tym serwerze
    public async Task<FgPlayerTime?> GetPlayerTimeOnServerAsync(string steamId, string serverId)
    {
        using var conn = GetConnection();
        return await conn.QueryFirstOrDefaultAsync<FgPlayerTime>(@"
            SELECT steamid AS SteamId, server_id AS ServerId, player_name AS PlayerName,
                   total_seconds AS TotalSeconds, first_seen AS FirstSeen, last_seen AS LastSeen
            FROM fg_player_time
            WHERE steamid = @steamId AND server_id = @serverId",
            new { steamId, serverId });
    }

    // Pobierz globalny czas gracza (suma wszystkich serwerow)
    public async Task<FgPlayerTimeGlobal?> GetPlayerTimeGlobalAsync(string steamId)
    {
        using var conn = GetConnection();
        return await conn.QueryFirstOrDefaultAsync<FgPlayerTimeGlobal>(@"
            SELECT steamid AS SteamId, player_name AS PlayerName,
                   total_seconds_global AS TotalSecondsGlobal,
                   first_seen AS FirstSeen, last_seen AS LastSeen
            FROM fg_player_time_global
            WHERE steamid = @steamId",
            new { steamId });
    }

    // Pobierz czas gracza per serwer
    public async Task<List<(string ServerName, long TotalSeconds)>> GetPlayerTimePerServerAsync(string steamId)
    {
        using var conn = GetConnection();
        var rows = await conn.QueryAsync(@"
            SELECT s.name AS ServerName, pt.total_seconds AS TotalSeconds
            FROM fg_player_time pt
            INNER JOIN fg_servers s ON s.id = pt.server_id
            WHERE pt.steamid = @steamId
            ORDER BY pt.total_seconds DESC",
            new { steamId });
        return rows.Select(r => ((string)r.ServerName, (long)r.TotalSeconds)).ToList();
    }

    // Top graczy na tym serwerze
    public async Task<List<TopEntry>> GetTopByServerAsync(string serverId, int count)
    {
        using var conn = GetConnection();
        var rows = await conn.QueryAsync<TopEntry>(@"
            SELECT ROW_NUMBER() OVER (ORDER BY total_seconds DESC) AS Position,
                   steamid AS SteamId, player_name AS PlayerName, total_seconds AS TotalSeconds
            FROM fg_player_time
            WHERE server_id = @serverId
            ORDER BY total_seconds DESC
            LIMIT @count",
            new { serverId, count });
        return rows.AsList();
    }

    // Top graczy globalnie
    public async Task<List<TopEntry>> GetTopGlobalAsync(int count)
    {
        using var conn = GetConnection();
        var rows = await conn.QueryAsync<TopEntry>(@"
            SELECT ROW_NUMBER() OVER (ORDER BY total_seconds_global DESC) AS Position,
                   steamid AS SteamId, player_name AS PlayerName,
                   total_seconds_global AS TotalSeconds
            FROM fg_player_time_global
            ORDER BY total_seconds_global DESC
            LIMIT @count",
            new { count });
        return rows.AsList();
    }

    // Szukaj gracza po nicku (do komend admina)
    public async Task<FgPlayerTimeGlobal?> FindPlayerByNameAsync(string name)
    {
        using var conn = GetConnection();
        return await conn.QueryFirstOrDefaultAsync<FgPlayerTimeGlobal>(@"
            SELECT steamid AS SteamId, player_name AS PlayerName,
                   total_seconds_global AS TotalSecondsGlobal,
                   first_seen AS FirstSeen, last_seen AS LastSeen
            FROM fg_player_time_global
            WHERE player_name LIKE @pattern
            LIMIT 1",
            new { pattern = $"%{name}%" });
    }

    // Resetuj czas gracza na tym serwerze
    public async Task ResetPlayerTimeOnServerAsync(string steamId, string serverId)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(@"
            UPDATE fg_player_time SET total_seconds = 0
            WHERE steamid = @steamId AND server_id = @serverId",
            new { steamId, serverId });
    }

    // Dodaj czas graczowi na tym serwerze
    public async Task AddTimeToPlayerAsync(string steamId, string serverId,
        string playerName, int seconds)
    {
        using var conn = GetConnection();
        await conn.ExecuteAsync(@"
            INSERT INTO fg_player_time (steamid, server_id, player_name, total_seconds)
            VALUES (@steamId, @serverId, @playerName, @seconds)
            ON DUPLICATE KEY UPDATE total_seconds = total_seconds + @seconds",
            new { steamId, serverId, playerName, seconds });
    }

    // Pobierz sumaryczny czas z fg_player_time (uzywane przy finalnym save sesji)
    public async Task FlushSessionTimeAsync(string steamId, string serverId,
        string playerName, int deltaSeconds)
    {
        if (deltaSeconds <= 0) return;
        using var conn = GetConnection();
        await conn.ExecuteAsync(@"
            INSERT INTO fg_player_time (steamid, server_id, player_name, total_seconds)
            VALUES (@steamId, @serverId, @playerName, @deltaSeconds)
            ON DUPLICATE KEY UPDATE
                total_seconds = total_seconds + @deltaSeconds,
                player_name   = VALUES(player_name),
                last_seen     = NOW()",
            new { steamId, serverId, playerName, deltaSeconds });
    }
}
