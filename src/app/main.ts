import { Notice, Plugin } from "obsidian";
import type { KeepSidianPluginSettings } from "../types/keepsidian-plugin-settings";
import { DEFAULT_SETTINGS } from "../types/keepsidian-plugin-settings";
import { SubscriptionService } from "@services/subscription";
import { NoteImportOptions, NoteImportOptionsModal } from "@ui/modals/NoteImportOptionsModal";
import { SyncProgressModal } from "@ui/modals/SyncProgressModal";
import { startSyncUI, finishSyncUI, setTotalNotes as uiSetTotalNotes, reportSyncProgress } from "@app/sync-ui";
import { logSync } from "@app/logging";
import { KeepSidianSettingsTab } from "@ui/settings/KeepSidianSettingsTab";
import { registerRibbonAndCommands } from "@app/commands";
import { importGoogleKeepNotes, importGoogleKeepNotesWithOptions } from "@features/keep/sync";

export default class KeepSidianPlugin extends Plugin {
  settings: KeepSidianPluginSettings;
  subscriptionService: SubscriptionService;
  statusBarItemEl: HTMLElement | null = null;
  // Elements for visual status in the status bar
  statusTextEl: HTMLSpanElement | null = null;
  progressContainerEl: HTMLDivElement | null = null;
  progressBarEl: HTMLDivElement | null = null;
  progressModal: SyncProgressModal | null = null;
  progressNotice: Notice | null = null;
  processedNotes = 0;
  totalNotes: number | null = null;
  private autoSyncInterval?: number;

  async onload() {
    await this.loadSettings();

    this.subscriptionService = new SubscriptionService(
      () => this.settings.email,
      () => this.settings.subscriptionCache,
      async (cache) => {
        this.settings.subscriptionCache = cache;
        await this.saveSettings();
      }
    );

    registerRibbonAndCommands(this);
    this.initializeSettings();

    if (this.settings.autoSyncEnabled) {
      this.startAutoSync();
    }
  }

  private initializeSettings() {
    this.addSettingTab(new KeepSidianSettingsTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async showImportOptionsModal(): Promise<void> {
    return new Promise((resolve) => {
      new NoteImportOptionsModal(
        this.app,
        this,
        async (options: NoteImportOptions) => {
          startSyncUI(this);
          try {
            const count = await importGoogleKeepNotesWithOptions(this, options, {
              setTotalNotes: (n) => uiSetTotalNotes(this, n),
              reportProgress: () => reportSyncProgress(this),
            });
            await logSync(this, `Manual sync successful: ${count} notes`);
            finishSyncUI(this, true);
          } catch (error) {
            finishSyncUI(this, false);
            await logSync(
              this,
              "Failed to import Google Keep notes: " + (error as Error).message
            );
            resolve();
          }
        }
      ).open();
    });
  }

  async importNotes(auto = false) {
    try {
      const isSubscriptionActive = await this.subscriptionService.isSubscriptionActive();

      if (!auto && isSubscriptionActive) {
        await this.showImportOptionsModal();
        return;
      } else {
        startSyncUI(this);
        try {
          const count = await importGoogleKeepNotes(this, {
            setTotalNotes: (n) => uiSetTotalNotes(this, n),
            reportProgress: () => reportSyncProgress(this),
          });
          await logSync(
            this,
            `${auto ? "Auto" : "Manual"} sync successful: ${count} notes`
          );
          finishSyncUI(this, true);
        } catch (error: any) {
          finishSyncUI(this, false);
          await logSync(
            this,
            `${auto ? "Auto" : "Manual"} sync failed: ${error.message}`
          );
        }
      }
    } catch (error: any) {
      await logSync(
        this,
        `${auto ? "Auto" : "Manual"} sync failed: ${error.message}`
      );
    }
  }

  startAutoSync() {
    this.stopAutoSync();
    const intervalMs = this.settings.autoSyncIntervalHours * 60 * 60 * 1000;
    this.autoSyncInterval = window.setInterval(() => {
      this.importNotes(true);
    }, intervalMs);
    if (typeof (this as any).registerInterval === "function") {
      (this as any).registerInterval(this.autoSyncInterval);
    }
  }

  stopAutoSync() {
    if (this.autoSyncInterval) {
      window.clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = undefined;
    }
  }

  private async logSync(message: string) {
    /* moved to app/logging.ts */
  }
}
