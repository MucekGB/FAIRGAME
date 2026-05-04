using System.Text.Json.Serialization;
using CounterStrikeSharp.API.Core;

namespace CS2MissionsPlugin;

public class PluginConfig : BasePluginConfig
{
    [JsonPropertyName("DatabaseHost")]
    public string DatabaseHost { get; set; } = "localhost";

    [JsonPropertyName("DatabasePort")]
    public int DatabasePort { get; set; } = 3306;

    [JsonPropertyName("DatabaseName")]
    public string DatabaseName { get; set; } = "fairplay";

    [JsonPropertyName("DatabaseUser")]
    public string DatabaseUser { get; set; } = "root";

    [JsonPropertyName("DatabasePassword")]
    public string DatabasePassword { get; set; } = "";

    // Ile misji dziennych przypisujemy graczowi z aktywnej puli
    [JsonPropertyName("DailyMissionsPerPlayer")]
    public int DailyMissionsPerPlayer { get; set; } = 3;

    // Ile misji tygodniowych przypisujemy graczowi z aktywnej puli
    [JsonPropertyName("WeeklyMissionsPerPlayer")]
    public int WeeklyMissionsPerPlayer { get; set; } = 1;

    // Co ile sekund odswieza misje gracza z bazy (dla synchronizacji z web)
    [JsonPropertyName("SyncIntervalSeconds")]
    public int SyncIntervalSeconds { get; set; } = 60;

    // Kolor prefixu w czacie (HTML color)
    [JsonPropertyName("ChatPrefixColor")]
    public string ChatPrefixColor { get; set; } = "#FFD700";

    // Prefix wyswietlany w czacie
    [JsonPropertyName("ChatPrefix")]
    public string ChatPrefix { get; set; } = "[Misje]";

    // Czy pokazywac HUD z postepem aktywnych misji
    [JsonPropertyName("ShowHud")]
    public bool ShowHud { get; set; } = true;

    // Co ile sekund odswiezac HUD
    [JsonPropertyName("HudRefreshSeconds")]
    public float HudRefreshSeconds { get; set; } = 3.0f;

    // Ile misji pokazywac w HUD naraz
    [JsonPropertyName("HudMaxMissions")]
    public int HudMaxMissions { get; set; } = 3;
}
