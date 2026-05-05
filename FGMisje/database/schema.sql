-- =============================================================
-- FairPlay CS2 Missions System - Database Schema
-- =============================================================

CREATE TABLE IF NOT EXISTS `mission_pools` (
    `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `name`          VARCHAR(100) NOT NULL COMMENT 'Nazwa puli misji, np. "Pula Styczen 2026"',
    `type`          ENUM('daily', 'weekly') NOT NULL,
    `active_from`   DATE NOT NULL COMMENT 'Od kiedy pula jest aktywna',
    `active_to`     DATE NOT NULL COMMENT 'Do kiedy pula jest aktywna (2 tygodnie)',
    `is_active`     TINYINT(1) NOT NULL DEFAULT 1,
    `created_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_active_dates` (`type`, `active_from`, `active_to`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Definicje misji - tworzone przez admina na stronie
CREATE TABLE IF NOT EXISTS `missions` (
    `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
    `pool_id`           INT UNSIGNED NOT NULL,
    `name`              VARCHAR(150) NOT NULL COMMENT 'Wyswietlana nazwa misji',
    `description`       VARCHAR(500) NOT NULL COMMENT 'Opis misji dla gracza',
    `type`              ENUM(
                            'kills',
                            'headshots',
                            'rounds_won',
                            'bombs_planted',
                            'bombs_defused',
                            'assists',
                            'rounds_survived'
                        ) NOT NULL,
    `required_amount`   INT UNSIGNED NOT NULL COMMENT 'Ile razy wykonac akcje',
    `reward_xp`         INT UNSIGNED NOT NULL DEFAULT 0,
    `reward_faircoin`   INT UNSIGNED NOT NULL DEFAULT 0,
    `reward_ticket`     INT UNSIGNED NOT NULL DEFAULT 0,
    `is_active`         TINYINT(1) NOT NULL DEFAULT 1,
    `created_at`        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    CONSTRAINT `fk_missions_pool` FOREIGN KEY (`pool_id`) REFERENCES `mission_pools`(`id`) ON DELETE CASCADE,
    INDEX `idx_pool_active` (`pool_id`, `is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Przypisanie misji do graczy + postep
CREATE TABLE IF NOT EXISTS `player_missions` (
    `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `steamid`       VARCHAR(20) NOT NULL COMMENT 'SteamID64',
    `mission_id`    INT UNSIGNED NOT NULL,
    `progress`      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Aktualny postep',
    `is_completed`  TINYINT(1) NOT NULL DEFAULT 0,
    `is_claimed`    TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Czy gracz odebral nagrode na stronie',
    `assigned_at`   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `completed_at`  TIMESTAMP NULL DEFAULT NULL,
    `claimed_at`    TIMESTAMP NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_player_mission` (`steamid`, `mission_id`),
    CONSTRAINT `fk_pm_mission` FOREIGN KEY (`mission_id`) REFERENCES `missions`(`id`) ON DELETE CASCADE,
    INDEX `idx_steamid_completed` (`steamid`, `is_completed`, `is_claimed`),
    INDEX `idx_mission_progress` (`mission_id`, `is_completed`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Portfel gracza (XP, Faircoin, Ticket)
CREATE TABLE IF NOT EXISTS `player_wallet` (
    `steamid`       VARCHAR(20) NOT NULL,
    `xp`            BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `faircoin`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `ticket`        INT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`steamid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Log transakcji nagrod (do weryfikacji na stronie)
CREATE TABLE IF NOT EXISTS `mission_rewards_log` (
    `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `steamid`       VARCHAR(20) NOT NULL,
    `mission_id`    INT UNSIGNED NOT NULL,
    `xp_given`      INT UNSIGNED NOT NULL DEFAULT 0,
    `faircoin_given` INT UNSIGNED NOT NULL DEFAULT 0,
    `ticket_given`  INT UNSIGNED NOT NULL DEFAULT 0,
    `claimed_at`    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    INDEX `idx_steamid` (`steamid`),
    INDEX `idx_mission` (`mission_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
