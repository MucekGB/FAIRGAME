namespace CS2MissionsPlugin.Models;

public enum MissionType
{
    kills,
    headshots,
    rounds_won,
    bombs_planted,
    bombs_defused,
    assists,
    rounds_survived
}

public class MissionPool
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Type { get; set; } = "daily";
    public DateTime ActiveFrom { get; set; }
    public DateTime ActiveTo { get; set; }
    public bool IsActive { get; set; }
}

public class Mission
{
    public int Id { get; set; }
    public int PoolId { get; set; }
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    public MissionType Type { get; set; }
    public int RequiredAmount { get; set; }
    public int RewardXp { get; set; }
    public int RewardFaircoin { get; set; }
    public int RewardTicket { get; set; }
    public bool IsActive { get; set; }
    public string PoolType { get; set; } = "daily";
}

public class PlayerMission
{
    public long Id { get; set; }
    public string SteamId { get; set; } = "";
    public int MissionId { get; set; }
    public int Progress { get; set; }
    public bool IsCompleted { get; set; }
    public bool IsClaimed { get; set; }
    public DateTime AssignedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
}

// Polaczony widok - postep gracza + dane misji (join)
public class PlayerMissionWithData
{
    public long PlayerMissionId { get; set; }
    public string SteamId { get; set; } = "";
    public int MissionId { get; set; }
    public string MissionName { get; set; } = "";
    public string Description { get; set; } = "";
    public MissionType Type { get; set; }
    public int RequiredAmount { get; set; }
    public int Progress { get; set; }
    public bool IsCompleted { get; set; }
    public bool IsClaimed { get; set; }
    public int RewardXp { get; set; }
    public int RewardFaircoin { get; set; }
    public int RewardTicket { get; set; }
    public string PoolType { get; set; } = "daily";
}

public class PlayerWallet
{
    public string SteamId { get; set; } = "";
    public long Xp { get; set; }
    public long Faircoin { get; set; }
    public int Ticket { get; set; }
}
