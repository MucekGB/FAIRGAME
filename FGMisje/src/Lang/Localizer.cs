using System.Text.Json;

namespace FGMisje.Lang;

public class FgLocalizer
{
    private Dictionary<string, Dictionary<string, string>> _translations = new();
    private const string DefaultLang = "pl";

    public void Load(string langDirectory)
    {
        Directory.CreateDirectory(langDirectory);
        var file = Path.Combine(langDirectory, "FGMisje.json");
        if (!File.Exists(file))
            WriteDefaultLangFile(file);

        _translations = JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, string>>>(
            File.ReadAllText(file)) ?? new();
    }

    public string Get(string key, string lang = DefaultLang,
        params (string token, string value)[] replacements)
    {
        if (!_translations.TryGetValue(lang, out var dict))
            dict = _translations.TryGetValue(DefaultLang, out var def) ? def : new();

        if (!dict.TryGetValue(key, out var text))
            return key;

        foreach (var (token, value) in replacements)
            text = text.Replace("{" + token + "}", value);

        return text;
    }

    private static void WriteDefaultLangFile(string path)
    {
        var data = new Dictionary<string, Dictionary<string, string>>
        {
            ["pl"] = new()
            {
                ["header"]            = "===== Twoje misje =====",
                ["daily_header"]      = "[ Dzienne ]",
                ["weekly_header"]     = "[ Tygodniowe ]",
                ["no_missions"]       = "Brak aktywnych misji. Sprawdz pozniej.",
                ["claim_hint"]        = "Ukonczone misje odbierz na stronie lub uzyj !odbierz <id>",
                ["mission_line"]      = "#{id} {name} {status} {rewards}",
                ["status_active"]     = "[{progress}/{required}]",
                ["status_claimed"]    = "[Odebrana]",
                ["status_to_claim"]   = "[Do odebrania]",
                ["completed_msg"]     = "Ukonczona misja: {name}! Nagroda: {xp} XP, {faircoin} Faircoin, {ticket} Ticket - odbierz na stronie!",
                ["claimed_msg"]       = "Odebrano nagrode za misje '{name}'! +{xp} XP, +{faircoin} Faircoin, +{ticket} Ticket",
                ["claim_fail"]        = "Nie mozna odebrac tej nagrody (juz odebrana lub misja nie ukonczona).",
                ["claim_usage"]       = "Podaj numer misji: !odbierz <numer>",
                ["unclaimed_notify"]  = "Masz {count} ukonczone misje do odebrania! Uzyj !misje."
            },
            ["en"] = new()
            {
                ["header"]            = "===== Your Missions =====",
                ["daily_header"]      = "[ Daily ]",
                ["weekly_header"]     = "[ Weekly ]",
                ["no_missions"]       = "No active missions. Check back later.",
                ["claim_hint"]        = "Claim completed missions on the website or use !claim <id>",
                ["mission_line"]      = "#{id} {name} {status} {rewards}",
                ["status_active"]     = "[{progress}/{required}]",
                ["status_claimed"]    = "[Claimed]",
                ["status_to_claim"]   = "[Claim Now]",
                ["completed_msg"]     = "Mission completed: {name}! Reward: {xp} XP, {faircoin} Faircoin, {ticket} Ticket - claim on website!",
                ["claimed_msg"]       = "Claimed reward for '{name}'! +{xp} XP, +{faircoin} Faircoin, +{ticket} Ticket",
                ["claim_fail"]        = "Cannot claim this reward (already claimed or mission not completed).",
                ["claim_usage"]       = "Usage: !claim <mission_id>",
                ["unclaimed_notify"]  = "You have {count} completed missions to claim! Use !misje."
            }
        };

        File.WriteAllText(path, JsonSerializer.Serialize(data,
            new JsonSerializerOptions { WriteIndented = true }));
    }
}
