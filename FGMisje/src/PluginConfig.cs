using System.Text.Json;
using System.Text.Json.Serialization;

namespace FGMisje;

public class PluginConfig
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

    [JsonPropertyName("DailyMissionsPerPlayer")]
    public int DailyMissionsPerPlayer { get; set; } = 3;

    [JsonPropertyName("WeeklyMissionsPerPlayer")]
    public int WeeklyMissionsPerPlayer { get; set; } = 1;

    [JsonPropertyName("SyncIntervalSeconds")]
    public int SyncIntervalSeconds { get; set; } = 60;

    [JsonPropertyName("ChatPrefix")]
    public string ChatPrefix { get; set; } = "[FGMisje]";

    [JsonPropertyName("ChatPrefixColor")]
    public string ChatPrefixColor { get; set; } = "#FFD700";

    [JsonPropertyName("ShowHud")]
    public bool ShowHud { get; set; } = true;

    [JsonPropertyName("HudRefreshSeconds")]
    public float HudRefreshSeconds { get; set; } = 3.0f;

    [JsonPropertyName("HudMaxMissions")]
    public int HudMaxMissions { get; set; } = 3;

    [JsonPropertyName("ConfigVersion")]
    public int ConfigVersion { get; set; } = 1;

    // configs/FAIRGAME/FGMisje/FGMisje.json
    public static string GetConfigPath(string gameDirectory) =>
        Path.Combine(gameDirectory, "csgo", "addons", "counterstrikesharp",
            "configs", "FAIRGAME", "FGMisje", "FGMisje.json");

    // configs/FAIRGAME/FGMisje/lang/
    public static string GetLangDirectory(string gameDirectory) =>
        Path.Combine(gameDirectory, "csgo", "addons", "counterstrikesharp",
            "configs", "FAIRGAME", "FGMisje", "lang");

    public static PluginConfig Load(string gameDirectory)
    {
        var path = GetConfigPath(gameDirectory);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        if (!File.Exists(path))
        {
            var json = JsonSerializer.Serialize(new PluginConfig(),
                new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(path, json);
            return new PluginConfig();
        }

        return JsonSerializer.Deserialize<PluginConfig>(File.ReadAllText(path))
               ?? new PluginConfig();
    }
}
