using System.Text.Json;
using System.Text.Json.Serialization;
using CounterStrikeSharp.API.Core;

namespace FGTime;

public class PluginConfig
{
    [JsonPropertyName("ServerID")]
    public string ServerId { get; set; } = "server1";

    [JsonPropertyName("ServerName")]
    public string ServerName { get; set; } = "FairPlay #1";

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

    // Co ile sekund zapisuje czas sesji do bazy (ochrona przed crashem serwera)
    [JsonPropertyName("SaveIntervalSeconds")]
    public int SaveIntervalSeconds { get; set; } = 60;

    [JsonPropertyName("ShowHud")]
    public bool ShowHud { get; set; } = true;

    [JsonPropertyName("HudRefreshSeconds")]
    public float HudRefreshSeconds { get; set; } = 5.0f;

    // {time} = czas gracza, {time_total} = globalny czas
    [JsonPropertyName("HudText")]
    public string HudText { get; set; } = "Czas: {time}";

    [JsonPropertyName("ChatPrefix")]
    public string ChatPrefix { get; set; } = "[FGTime]";

    [JsonPropertyName("ChatPrefixColor")]
    public string ChatPrefixColor { get; set; } = "#FFD700";

    // Flaga admina do komend !resetczas i !addczas
    [JsonPropertyName("AdminFlag")]
    public string AdminFlag { get; set; } = "@css/admin";

    // Ile pozycji pokazuje !topczas
    [JsonPropertyName("TopCount")]
    public int TopCount { get; set; } = 10;

    [JsonPropertyName("ConfigVersion")]
    public int ConfigVersion { get; set; } = 1;

    // Sciezka do pliku configu: configs/FAIRGAME/FGTime/FGTime.json
    public static string GetConfigPath(string gameDirectory)
    {
        return Path.Combine(gameDirectory, "csgo", "addons", "counterstrikesharp",
            "configs", "FAIRGAME", "FGTime", "FGTime.json");
    }

    // Sciezka do folderu lang: configs/FAIRGAME/FGTime/lang/
    public static string GetLangDirectory(string gameDirectory)
    {
        return Path.Combine(gameDirectory, "csgo", "addons", "counterstrikesharp",
            "configs", "FAIRGAME", "FGTime", "lang");
    }

    public static PluginConfig Load(string gameDirectory)
    {
        var path = GetConfigPath(gameDirectory);
        var dir = Path.GetDirectoryName(path)!;
        Directory.CreateDirectory(dir);

        if (!File.Exists(path))
        {
            var defaults = new PluginConfig();
            var json = JsonSerializer.Serialize(defaults, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(path, json);
            return defaults;
        }

        var content = File.ReadAllText(path);
        return JsonSerializer.Deserialize<PluginConfig>(content) ?? new PluginConfig();
    }

    public void Save(string gameDirectory)
    {
        var path = GetConfigPath(gameDirectory);
        var json = JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json);
    }
}
