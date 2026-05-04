-- =============================================================
-- FGTime - Database Schema
-- =============================================================

-- Rejestr serwerow
CREATE TABLE IF NOT EXISTS `fg_servers` (
    `id`            VARCHAR(64) NOT NULL COMMENT 'Unikalny ID serwera z configu',
    `name`          VARCHAR(128) NOT NULL,
    `last_seen`     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sesje graczy (kazde polaczenie = nowy rekord)
CREATE TABLE IF NOT EXISTS `fg_sessions` (
    `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `steamid`       VARCHAR(20) NOT NULL COMMENT 'SteamID64',
    `player_name`   VARCHAR(128) NOT NULL,
    `server_id`     VARCHAR(64) NOT NULL,
    `connected_at`  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `disconnected_at` TIMESTAMP NULL DEFAULT NULL,
    `duration_seconds` INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Czas trwania sesji w sekundach',
    PRIMARY KEY (`id`),
    INDEX `idx_steamid_server` (`steamid`, `server_id`),
    INDEX `idx_steamid` (`steamid`),
    INDEX `idx_connected` (`connected_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sumaryczny czas gracza per serwer
CREATE TABLE IF NOT EXISTS `fg_player_time` (
    `steamid`           VARCHAR(20) NOT NULL,
    `server_id`         VARCHAR(64) NOT NULL,
    `player_name`       VARCHAR(128) NOT NULL,
    `total_seconds`     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `first_seen`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `last_seen`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`steamid`, `server_id`),
    INDEX `idx_total_seconds` (`server_id`, `total_seconds` DESC),
    INDEX `idx_steamid` (`steamid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Widok: globalny czas gracza (suma po wszystkich serwerach)
CREATE OR REPLACE VIEW `fg_player_time_global` AS
    SELECT
        steamid,
        MAX(player_name) AS player_name,
        SUM(total_seconds) AS total_seconds_global,
        MIN(first_seen) AS first_seen,
        MAX(last_seen) AS last_seen
    FROM `fg_player_time`
    GROUP BY steamid;
