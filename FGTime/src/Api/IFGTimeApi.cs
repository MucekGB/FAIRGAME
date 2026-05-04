namespace FGTime.Api;

/// <summary>
/// Publiczne API FGTime - uzywane przez inne pluginy (FGFaircoin, FGRanks itp.)
/// </summary>
public interface IFGTimeApi
{
    /// <summary>Sumaryczny czas gracza na tym serwerze (z bazy + biezaca sesja) w sekundach.</summary>
    Task<long> GetTotalTimeOnServerAsync(string steamId);

    /// <summary>Sumaryczny czas gracza na wszystkich serwerach w sekundach.</summary>
    Task<long> GetTotalTimeGlobalAsync(string steamId);

    /// <summary>Czas biezacej sesji gracza w sekundach (live, bez bazy).</summary>
    int GetCurrentSessionSeconds(string steamId);

    /// <summary>Czy gracz ma aktywna sesje (jest na serwerze).</summary>
    bool IsPlayerOnline(string steamId);

    /// <summary>
    /// Event wywoływany po zakonczeniu sesji gracza.
    /// Parametry: steamId, sessionSeconds (czas tej sesji), totalSeconds (lacznie na tym serwerze)
    /// </summary>
    event Action<string, int, long>? OnSessionEnded;

    /// <summary>
    /// Event wywoływany co SaveInterval (flush czasu).
    /// Parametry: steamId, currentSessionSeconds
    /// </summary>
    event Action<string, int>? OnTimeFlushed;
}
