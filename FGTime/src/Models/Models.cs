namespace FGTime.Models;

public class FgServer
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
}

public class FgSession
{
    public long Id { get; set; }
    public string SteamId { get; set; } = "";
    public string PlayerName { get; set; } = "";
    public string ServerId { get; set; } = "";
    public DateTime ConnectedAt { get; set; }
    public DateTime? DisconnectedAt { get; set; }
    public int DurationSeconds { get; set; }
}

public class FgPlayerTime
{
    public string SteamId { get; set; } = "";
    public string ServerId { get; set; } = "";
    public string PlayerName { get; set; } = "";
    public long TotalSeconds { get; set; }
    public DateTime FirstSeen { get; set; }
    public DateTime LastSeen { get; set; }
}

public class FgPlayerTimeGlobal
{
    public string SteamId { get; set; } = "";
    public string PlayerName { get; set; } = "";
    public long TotalSecondsGlobal { get; set; }
    public DateTime FirstSeen { get; set; }
    public DateTime LastSeen { get; set; }
}

public class TopEntry
{
    public int Position { get; set; }
    public string SteamId { get; set; } = "";
    public string PlayerName { get; set; } = "";
    public long TotalSeconds { get; set; }
}
