import { logger } from '../utils/logger.js';

export const botConfig = {
  // =========================
  // BOT PRESENCE
  // =========================
  presence: {
    status: "idle",

    activities: [
      {
        name: "Custom Status",
        state: "BAKA DAN YAN",
        type: 3,
      },
    ],
  },

  // =========================
  // COMMAND BEHAVIOR
  // =========================
  commands: {
    owners:
      process.env.OWNER_IDS
        ?.split(",")
        .map((id) => id.trim())
        .filter(Boolean) || [],

    defaultCooldown: 3,

    deleteCommands: false,

    testGuildId:
      process.env.TEST_GUILD_ID,

    maintenanceMode:
      process.env.MAINTENANCE_MODE === "true",

    prefix:
      process.env.PREFIX || "!",
  },

  // =========================
  // APPLICATIONS SYSTEM
  // =========================
  applications: {
    defaultQuestions: [
      {
        question: "What is your name?",
        required: true,
      },
      {
        question: "How old are you?",
        required: true,
      },
      {
        question: "Why do you want to join?",
        required: true,
      },
    ],

    statusColors: {
      pending: "#FFA500",
      approved: "#00FF00",
      denied: "#FF0000",
    },

    applicationCooldown: 24,

    deleteDeniedAfter: 7,

    deleteApprovedAfter: 30,

    managerRoles: [],
  },

  // =========================
  // EMBED COLORS & BRANDING
  // =========================
  embeds: {
    colors: {
      primary: "#336699",
      secondary: "#2F3136",

      success: "#57F287",
      error: "#ED4245",
      warning: "#FEE75C",
      info: "#3498DB",

      light: "#FFFFFF",
      dark: "#202225",
      gray: "#99AAB5",

      blurple: "#5865F2",
      green: "#57F287",
      yellow: "#FEE75C",
      fuchsia: "#EB459E",
      red: "#ED4245",
      black: "#000000",

      giveaway: {
        active: "#57F287",
        ended: "#ED4245",
      },

      ticket: {
        open: "#57F287",
        claimed: "#FAA61A",
        closed: "#ED4245",
        pending: "#99AAB5",
      },

      economy: "#F1C40F",
      birthday: "#E91E63",
      moderation: "#9B59B6",

      priority: {
        none: "#95A5A6",
        low: "#3498db",
        medium: "#2ecc71",
        high: "#f1c40f",
        urgent: "#e74c3c",
      },
    },

    footer: {
      text: "Titan Bot",
      icon: null,
    },

    thumbnail: null,

    author: {
      name: null,
      icon: null,
      url: null,
    },
  },

  // =========================
  // CRT TRADING SETTINGS
  // =========================
  crt: {
    enabled: true,
    autoAlerts: true,
    timezone: "Asia/Manila",

    // MEXC market data modes.
    // Spot uses symbols such as BTCUSDT.
    // Futures uses symbols such as BTC_USDT.
    markets: process.env.CRT_MARKETS || "spot,futures",

    autoSymbols: process.env.CRT_AUTO_SYMBOLS !== "false",
    quoteAsset: process.env.CRT_QUOTE_ASSET || "USDT",
    maxSymbolsPerMarket: Number(process.env.CRT_MAX_SYMBOLS_PER_MARKET || 30),
    symbolRefreshMs: Number(process.env.CRT_SYMBOL_REFRESH_MS || 900000),

    scanInterval: Number(process.env.CRT_SCAN_INTERVAL_MS || 30000),
    klineLimit: Number(process.env.CRT_KLINE_LIMIT || 100),

    // Optional manual symbol lists. Leave blank to auto-discover MEXC symbols.
    // Examples:
    // MEXC_SPOT_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT
    // MEXC_FUTURES_SYMBOLS=BTC_USDT,ETH_USDT,SOL_USDT,EUR_USDT

    rsi: {
      period: Number(process.env.CRT_RSI_PERIOD || 14),
      oversold: Number(process.env.CRT_RSI_OVERSOLD || 30),
      overbought: Number(process.env.CRT_RSI_OVERBOUGHT || 70),
    },

    // Standard CRT: sweep parent high/low and close back inside parent range.
    // Rachel_T exact parity requires the original TradingView source/script.
    requireCloseInside: process.env.CRT_REQUIRE_CLOSE_INSIDE !== "false",
    useCloseDirection: process.env.CRT_USE_CLOSE_DIRECTION === "true",
    minBodyRatio: Number(process.env.CRT_MIN_BODY_RATIO || 0),

    timeframes: {
      "5m": 5,
      "15m": 15,
      "1h": 60,
      "4h": 240,
      "1d": 1440,
    },

    channels: {
      "5m": "1536311840378986547",
      "15m": "1536085573691773060",
      "1h": "1536085667216367728",
      "4h": "1536085721192857600",
      "1d": "1536085794576404480",
    },

    color: "#5865F2",
    footer: "CRT • PDYN • MEXC",
  },

  // =========================
  // ECONOMY SETTINGS
  // =========================
  economy: {
    currency: {
      name: "coins",
      namePlural: "coins",
      symbol: "$",
    },

    startingBalance: 0,

    baseBankCapacity: 100000,

    dailyAmount: 100,

    workMin: 10,
    workMax: 100,

    begMin: 5,
    begMax: 50,

    cooldowns: {
      daily: 24 * 60 * 60 * 1000,
      work: 60 * 60 * 1000,
      crime: 2 * 60 * 60 * 1000,
      rob: 4 * 60 * 60 * 1000,
    },

    robSuccessRate: 0.4,

    robFailJailTime: 3600000,
  },

  // =========================
  // SHOP SETTINGS
  // =========================
  shop: {},

  // =========================
  // TICKET SYSTEM
  // =========================
  tickets: {
    defaultCategory: null,

    supportRoles: [],

    priorities: {
      none: {
        emoji: "⚪",
        color: "#95A5A6",
        label: "None",
      },

      low: {
        emoji: "🟢",
        color: "#2ECC71",
        label: "Low",
      },

      medium: {
        emoji: "🟡",
        color: "#F1C40F",
        label: "Medium",
      },

      high: {
        emoji: "🔴",
        color: "#E74C3C",
        label: "High",
      },

      urgent: {
        emoji: "🚨",
        color: "#E91E63",
        label: "Urgent",
      },
    },

    defaultPriority: "none",

    archiveCategory: null,

    logChannel: null,
  },

  // =========================
  // GIVEAWAY SETTINGS
  // =========================
  giveaways: {
    defaultDuration: 86400000,

    minimumWinners: 1,

    maximumWinners: 10,

    minimumDuration: 300000,

    maximumDuration: 2592000000,

    allowedRoles: [],

    bypassRoles: [],
  },

  // =========================
  // BIRTHDAY SETTINGS
  // =========================
  birthday: {
    defaultRole: null,

    announcementChannel: null,

    timezone: "Asia/Manila",
  },

  // =========================
  // VERIFICATION SETTINGS
  // =========================
  verification: {
    defaultMessage:
      "Click the button below to verify yourself and gain access to the server!",

    defaultButtonText: "Verify",

    autoVerify: {
      defaultCriteria: "none",

      defaultAccountAgeDays: 7,

      serverSizeThreshold: 1000,

      minAccountAge: 1,

      maxAccountAge: 365,

      sendDMNotification: true,

      criteria: {
        account_age:
          "Account must be older than specified days",

        server_size:
          "All users if server has less than 1000 members",

        none:
          "All users immediately",
      },
    },

    verificationCooldown: 5000,

    maxVerificationAttempts: 3,

    attemptWindow: 60000,

    maxCooldownEntries: 10000,

    maxAttemptEntries: 10000,

    cooldownCleanupInterval: 300000,

    maxAuditMetadataBytes: 4096,

    maxInMemoryAuditEntries: 1000,

    logAllVerifications: true,

    keepAuditTrail: true,
  },

  // =========================
  // WELCOME / GOODBYE
  // =========================
  welcome: {
    defaultWelcomeMessage:
      "Welcome {user} to {server}! We now have {memberCount} members!",

    defaultGoodbyeMessage:
      "{user} has left the server. We now have {memberCount} members.",

    defaultWelcomeChannel: null,

    defaultGoodbyeChannel: null,
  },

  // =========================
  // COUNTER CHANNELS
  // =========================
  counters: {
    defaults: {
      name: "{name} Counter",

      description:
        "Server {name} counter",

      type: "voice",

      channelName: "{name}-{count}",
    },

    permissions: {
      deny: ["VIEW_CHANNEL"],

      allow: [
        "VIEW_CHANNEL",
        "CONNECT",
        "SPEAK",
      ],
    },

    messages: {
      created:
        "✅ Created counter **{name}**",

      deleted:
        "🗑️ Deleted counter **{name}**",

      updated:
        "🔄 Updated counter **{name}**",
    },

    types: {
      members: {
        name: "👥 Members",

        description:
          "Total members in the server",

        getCount: (guild) =>
          guild.memberCount.toString(),
      },

      bots: {
        name: "🤖 Bots",

        description:
          "Total bot accounts in the server",

        getCount: (guild) =>
          guild.members.cache
            .filter((m) => m.user.bot)
            .size
            .toString(),
      },

      members_only: {
        name: "👤 Humans",

        description:
          "Total human members (non-bots)",

        getCount: (guild) =>
          guild.members.cache
            .filter((m) => !m.user.bot)
            .size
            .toString(),
      },
    },
  },

  // =========================
  // GENERIC BOT MESSAGES
  // =========================
  messages: {
    noPermission:
      "You do not have permission to use this command.",

    cooldownActive:
      "Please wait {time} before using this command again.",

    errorOccurred:
      "An error occurred while executing the command.",

    missingPermissions:
      "I am missing required permissions to perform this action.",

    commandDisabled:
      "This command has been disabled.",

    maintenanceMode:
      "The bot is currently in maintenance mode.",
  },

  // =========================
  // FEATURE TOGGLES
  // =========================
  features: {
    economy: true,

    leveling: true,

    moderation: true,

    logging: true,

    welcome: true,

    tickets: true,

    giveaways: true,

    birthday: true,

    counter: true,

    verification: true,

    reactionRoles: true,

    joinToCreate: true,

    voice: true,

    search: true,

    tools: true,

    utility: true,

    community: true,

    fun: true,

    music: true,

    crt: true,
  },
};


// ============================================================
// CONFIG VALIDATION
// ============================================================

export function validateConfig(config) {
  const errors = [];

  if (process.env.NODE_ENV !== "production") {
    logger.debug(
      "Environment variables check:"
    );

    logger.debug(
      "DISCORD_TOKEN exists:",
      !!process.env.DISCORD_TOKEN
    );

    logger.debug(
      "TOKEN exists:",
      !!process.env.TOKEN
    );

    logger.debug(
      "CLIENT_ID exists:",
      !!process.env.CLIENT_ID
    );

    logger.debug(
      "GUILD_ID exists:",
      !!process.env.GUILD_ID
    );

    logger.debug(
      "POSTGRES_HOST exists:",
      !!process.env.POSTGRES_HOST
    );

    logger.debug(
      "NODE_ENV:",
      process.env.NODE_ENV
    );
  }

  if (
    !process.env.DISCORD_TOKEN &&
    !process.env.TOKEN
  ) {
    errors.push(
      "Bot token is required (DISCORD_TOKEN or TOKEN environment variable)"
    );
  }

  if (!process.env.CLIENT_ID) {
    errors.push(
      "Client ID is required (CLIENT_ID environment variable)"
    );
  }

  if (
    process.env.NODE_ENV === "production"
  ) {
    const hasConnectionUrl =
      Boolean(
        process.env.POSTGRES_URL ||
        process.env.DATABASE_URL
      );

    if (!hasConnectionUrl) {
      if (!process.env.POSTGRES_HOST) {
        errors.push(
          "PostgreSQL connection is required in production (set DATABASE_URL/POSTGRES_URL, or POSTGRES_HOST)"
        );
      }

      if (!process.env.POSTGRES_USER) {
        errors.push(
          "PostgreSQL user is required in production (set DATABASE_URL/POSTGRES_URL, or POSTGRES_USER)"
        );
      }

      if (!process.env.POSTGRES_PASSWORD) {
        errors.push(
          "PostgreSQL password is required in production (set DATABASE_URL/POSTGRES_URL, or POSTGRES_PASSWORD)"
        );
      }
    }
  }

  return errors;
}


// ============================================================
// VALIDATE CONFIGURATION
// ============================================================

const configErrors =
  validateConfig(botConfig);

if (configErrors.length > 0) {
  logger.error(
    "Bot configuration errors:",
    configErrors.join("\n")
  );

  if (
    process.env.NODE_ENV === "production"
  ) {
    process.exit(1);
  }
}


// ============================================================
// BOT CONFIG EXPORT
// ============================================================

export const BotConfig =
  botConfig;


// ============================================================
// COMMAND CATEGORY → FEATURE MAP
// ============================================================

const COMMAND_CATEGORY_FEATURE_MAP = {
  birthday: "birthday",

  community: "community",

  economy: "economy",

  fun: "fun",

  giveaway: "giveaways",

  jointocreate: "joinToCreate",

  leveling: "leveling",

  logging: "logging",

  moderation: "moderation",

  music: "music",

  reaction_roles: "reactionRoles",

  search: "search",

  serverstats: "counter",

  ticket: "tickets",

  tools: "tools",

  utility: "utility",

  verification: "verification",

  welcome: "welcome",

  crt: "crt",
};


// ============================================================
// CATEGORY NORMALIZATION
// ============================================================

function normalizeCategoryKey(
  category
) {
  return String(category || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}


// ============================================================
// COMMAND PREFIX
// ============================================================

export function getCommandPrefix() {
  return (
    botConfig.commands?.prefix ??
    "!"
  );
}


// ============================================================
// BOT OWNERS
// ============================================================

export function getBotOwners() {
  return (
    botConfig.commands?.owners ??
    []
  )
    .map((id) =>
      String(id).trim()
    )
    .filter(Boolean);
}


export function isBotOwner(userId) {
  if (!userId) {
    return false;
  }

  return getBotOwners().includes(
    String(userId)
  );
}


// ============================================================
// MAINTENANCE MODE
// ============================================================

export function isMaintenanceMode() {
  return (
    botConfig.commands
      ?.maintenanceMode === true
  );
}


// ============================================================
// BOT MESSAGES
// ============================================================

export function getBotMessage(
  key,
  replacements = {}
) {
  let message =
    botConfig.messages?.[key] ||
    key;

  for (
    const [
      placeholder,
      value,
    ] of Object.entries(
      replacements
    )
  ) {
    message =
      message.replace(
        new RegExp(
          `\\{${placeholder}\\}`,
          "g"
        ),
        String(value)
      );
  }

  return message;
}


// ============================================================
// FEATURE CHECK
// ============================================================

export function isFeatureEnabled(
  featureKey
) {
  if (!featureKey) {
    return true;
  }

  return (
    botConfig.features?.[
      featureKey
    ] !== false
  );
}


// ============================================================
// COMMAND CATEGORY CHECK
// ============================================================

export function isCommandCategoryEnabled(
  category
) {
  const normalized =
    normalizeCategoryKey(
      category
    );

  if (
    !normalized ||
    normalized === "core"
  ) {
    return true;
  }

  const featureKey =
    COMMAND_CATEGORY_FEATURE_MAP[
      normalized
    ];

  if (!featureKey) {
    return true;
  }

  return isFeatureEnabled(
    featureKey
  );
}


// ============================================================
// APPLICATION STATUS COLOR
// ============================================================

export function getApplicationStatusColor(
  status
) {
  const colors =
    botConfig.applications
      ?.statusColors || {};

  const hex =
    colors[status];

  return hex
    ? getColor(hex)
    : getColor(
        status === "approved"
          ? "success"
          : status === "denied"
            ? "error"
            : "warning"
      );
}


// ============================================================
// DEFAULT APPLICATION QUESTIONS
// ============================================================

export function getDefaultApplicationQuestions() {
  return (
    botConfig.applications
      ?.defaultQuestions || []
  )
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : entry.question
    )
    .filter(Boolean);
}


// ============================================================
// COLOR HELPER
// ============================================================

export function getColor(
  path,
  fallback = "#99AAB5"
) {
  if (typeof path === "number") {
    return path;
  }

  if (
    typeof path === "string" &&
    path.startsWith("#")
  ) {
    return parseInt(
      path.replace("#", ""),
      16
    );
  }

  if (
    typeof path !== "string"
  ) {
    return getColor(
      fallback
    );
  }

  const result =
    path.split(".").reduce(
      (obj, key) =>
        obj &&
        obj[key] !== undefined
          ? obj[key]
          : fallback,
      botConfig.embeds.colors
    );

  if (
    typeof result === "string" &&
    result.startsWith("#")
  ) {
    return parseInt(
      result.replace("#", ""),
      16
    );
  }

  return result;
}


// ============================================================
// RANDOM COLOR
// ============================================================

export function getRandomColor() {
  const colors =
    Object.values(
      botConfig.embeds.colors
    ).flatMap((color) =>
      typeof color === "string"
        ? color
        : Object.values(color)
    );

  return colors[
    Math.floor(
      Math.random() *
      colors.length
    )
  ];
}


// ============================================================
// DEFAULT EXPORT
// ============================================================

export default botConfig;
