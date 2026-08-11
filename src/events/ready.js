import { Events } from "discord.js";

import {
  logger,
  startupLog,
} from "../utils/logger.js";

import config from "../config/application.js";

import {
  reconcileReactionRoleMessages,
} from "../services/reactionRoleService.js";

import {
  reconcileTicketPanels,
  reconcileVerificationPanels,
  reconcileReactionRolePanelHealth,
} from "../services/panelHealthService.js";

import {
  reconcileLevelRoles,
} from "../services/leveling/levelRoleSyncService.js";

import {
  initRiffyAfterReady,
} from "../services/music/riffySetup.js";

import {
  startCRTMonitor,
} from "../services/crt/crtService.js";


// ============================================================
// PDYN-BOT — READY EVENT
// ============================================================

export default {
  name: Events.ClientReady,

  once: true,

  async execute(client) {
    try {

      // ========================================================
      // BOT PRESENCE
      // ========================================================

      client.user.setPresence(
        config.bot.presence
      );


      // ========================================================
      // STARTUP INFORMATION
      // ========================================================

      startupLog(
        `Ready! Logged in as ${client.user.tag}`
      );

      startupLog(
        `Serving ${client.guilds.cache.size} guild(s)`
      );

      startupLog(
        `Loaded ${client.commands.size} commands`
      );


      // ========================================================
      // CRT TRADING SYSTEM
      // ========================================================

      if (
        client.config?.features?.crt === true
      ) {

        startCRTMonitor(
          client
        );

        startupLog(
          "CRT monitor started."
        );

      } else {

        startupLog(
          "CRT monitor is disabled."
        );
      }


      // ========================================================
      // MUSIC SYSTEM
      // ========================================================

      if (
        client.config?.features?.music === true
      ) {

        initRiffyAfterReady(
          client
        );

        startupLog(
          "Music system initialized."
        );

      } else {

        startupLog(
          "Music system is disabled."
        );
      }


      // ========================================================
      // REACTION ROLES
      // ========================================================

      const reconciliationSummary =
        await reconcileReactionRoleMessages(
          client
        );

      startupLog(
        `Reaction role reconciliation: ` +
        `scanned ${reconciliationSummary.scannedMessages}, ` +
        `removed ${reconciliationSummary.removedMessages}, ` +
        `errors ${reconciliationSummary.errors}`
      );


      // ========================================================
      // TICKET PANELS
      // ========================================================

      const ticketPanelSummary =
        await reconcileTicketPanels(
          client
        );

      startupLog(
        `Ticket panel health: ` +
        `scanned ${ticketPanelSummary.scannedGuilds} guilds, ` +
        `healthy ${ticketPanelSummary.healthyPanels}, ` +
        `deleted ${ticketPanelSummary.deletedPanels}, ` +
        `missing channel ${ticketPanelSummary.missingChannels}, ` +
        `recovered ${ticketPanelSummary.recoveredIds}, ` +
        `errors ${ticketPanelSummary.errors}`
      );


      // ========================================================
      // VERIFICATION PANELS
      // ========================================================

      const verificationPanelSummary =
        await reconcileVerificationPanels(
          client
        );

      startupLog(
        `Verification panel health: ` +
        `scanned ${verificationPanelSummary.scannedGuilds} guilds, ` +
        `healthy ${verificationPanelSummary.healthyPanels}, ` +
        `deleted ${verificationPanelSummary.deletedPanels}, ` +
        `missing channel ${verificationPanelSummary.missingChannels}, ` +
        `recovered ${verificationPanelSummary.recoveredIds}, ` +
        `errors ${verificationPanelSummary.errors}`
      );


      // ========================================================
      // REACTION ROLE PANEL HEALTH
      // ========================================================

      const reactionRolePanelSummary =
        await reconcileReactionRolePanelHealth(
          client
        );

      startupLog(
        `Reaction role panel health: ` +
        `scanned ${reactionRolePanelSummary.scannedPanels} panels, ` +
        `healthy ${reactionRolePanelSummary.healthyPanels}, ` +
        `deleted ${reactionRolePanelSummary.deletedPanels}, ` +
        `missing channel ${reactionRolePanelSummary.missingChannels}, ` +
        `recovered ${reactionRolePanelSummary.recoveredIds}, ` +
        `errors ${reactionRolePanelSummary.errors}`
      );


      // ========================================================
      // LEVEL ROLES
      // ========================================================

      const levelRoleSummary =
        await reconcileLevelRoles(
          client
        );

      startupLog(
        `Level role sync: ` +
        `scanned ${levelRoleSummary.scannedGuilds} guilds, ` +
        `pruned ${levelRoleSummary.prunedRewardEntries} stale rewards, ` +
        `re-awarded ${levelRoleSummary.rolesReAwarded} roles, ` +
        `errors ${levelRoleSummary.errors}`
      );


      // ========================================================
      // STARTUP COMPLETE
      // ========================================================

      startupLog(
        "All startup systems initialized successfully."
      );

    } catch (error) {

      // ========================================================
      // ERROR HANDLING
      // ========================================================

      logger.error(
        "Error in ready event:",
        error
      );
    }
  },
};
