using System.Text.Json;

namespace FGTime.Lang;

public class FgLocalizer
{
    private Dictionary<string, Dictionary<string, string>> _translations = new();
    private string _defaultLang = "pl";

    public void Load(string langDirectory)
    {
        Directory.CreateDirectory(langDirectory);

        var file = Path.Combine(langDirectory, "FGTime.json");
        if (!File.Exists(file))
        {
            WriteDefaultLangFile(file);
        }

        var content = File.ReadAllText(file);
        _translations = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(content)
                        ?? new();
    }

    public string Get(string key, string lang = "pl", params (string token, string value)[] replacements)
    {
        if (!_translations.TryGetValue(lang, out var langDict))
            langDict = _translations.TryGetValue(_defaultLang, out var def) ? def : new();

        if (!langDict.TryGetValue(key, out var text))
            return key;

        foreach (var (token, value) in replacements)
            text = text.Replace("{" + token + "}", value);

        return text;
    }

    private static void WriteDefaultLangFile(string path)
    {
        var defaults = new Dictionary<string, Dictionary<string, string>>
        {
            ["pl"] = new()
            {
                ["time_self"]        = "Twój czas na {server}: {time_server} | Łącznie: {time_total}",
                ["time_other"]       = "Czas gracza {player} na {server}: {time_server} | Łącznie: {time_total}",
                ["top_header"]       = "=== Top {count} - Czas na {server} ===",
                ["top_global_header"]= "=== Top {count} - Czas globalny ===",
                ["top_entry"]        = "#{pos} {player}: {time}",
                ["servers_header"]   = "=== Twój czas per serwer ===",
                ["servers_entry"]    = "{server}: {time}",
                ["no_data"]          = "Brak danych dla tego gracza.",
                ["player_not_found"] = "Nie znaleziono gracza.",
                ["reset_success"]    = "Zresetowano czas gracza {player} na tym serwerze.",
                ["add_success"]      = "Dodano {minutes} min graczowi {player}.",
                ["no_permission"]    = "Brak uprawnień.",
                ["usage_add"]        = "Użycie: !addczas <nick> <minuty>",
                ["usage_reset"]      = "Użycie: !resetczas <nick>"
            },
            ["en"] = new()
            {
                ["time_self"]        = "Your time on {server}: {time_server} | Total: {time_total}",
                ["time_other"]       = "Player {player} time on {server}: {time_server} | Total: {time_total}",
                ["top_header"]       = "=== Top {count} - Time on {server} ===",
                ["top_global_header"]= "=== Top {count} - Global Time ===",
                ["top_entry"]        = "#{pos} {player}: {time}",
                ["servers_header"]   = "=== Your time per server ===",
                ["servers_entry"]    = "{server}: {time}",
                ["no_data"]          = "No data found for this player.",
                ["player_not_found"] = "Player not found.",
                ["reset_success"]    = "Reset time for player {player} on this server.",
                ["add_success"]      = "Added {minutes} min to player {player}.",
                ["no_permission"]    = "No permission.",
                ["usage_add"]        = "Usage: !addczas <name> <minutes>",
                ["usage_reset"]      = "Usage: !resetczas <name>"
            }
        };

        var json = JsonSerializer.Serialize(defaults, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(path, json);
    }
}
