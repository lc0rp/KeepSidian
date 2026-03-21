import { browser } from "@wdio/globals";
import fs from "node:fs/promises";
import path from "node:path";

type StepStatus = "passed" | "failed" | "skipped";
type ScenarioStatus = StepStatus;
type SubscriptionMode = "active" | "inactive";
type SyncMode = "import" | "push" | "two-way";
type DownloadScopeKind = "last-sync" | "all" | "custom-since";

interface RunbookStep {
	id: string;
	title: string;
	status: StepStatus;
	at: string;
	details?: string;
	screenshot?: string;
}

interface ScenarioRecord {
	id: string;
	title: string;
	subscriptionMode: SubscriptionMode;
	status: ScenarioStatus;
	startedAt: string;
	finishedAt?: string;
	details?: string;
	steps: RunbookStep[];
}

interface CorpusFilterCandidates {
	includeExclude?: {
		includeTerm: string;
		includeTitle: string;
		excludeTerm: string;
		excludeTitle: string;
	} | null;
	color?: {
		color: string;
		title: string;
	} | null;
	pinned?: {
		title: string;
	} | null;
	archived?: {
		title: string;
	} | null;
}

interface CorpusSummary {
	noteCount: number;
	pinnedCount: number;
	archivedCount: number;
	colors: string[];
	oldestCreated?: string | null;
	newestUpdated?: string | null;
	filterCandidates?: CorpusFilterCandidates;
	sampleTitles?: string[];
}

interface ModalEntrySnapshot {
	id: string;
	title: string;
	path?: string;
	label: string;
	action: string;
	selectable: boolean;
	selected: boolean;
	selectionLocked: boolean;
	selectionLockedReason?: string;
	metaDetail?: string;
}

interface PlanSnapshot {
	mode: SyncMode;
	stage: "import" | "upload";
	title: string;
	counts: Record<string, number>;
	selectedCount: number;
	actionableCount: number;
	entries: ModalEntrySnapshot[];
}

interface ModalSnapshot {
	open: boolean;
	surface: "setup" | "review" | "running" | "result" | null;
	selectedMode: SyncMode | null;
	downloadScopeKind: DownloadScopeKind | null;
	showSyncOptions: boolean;
	hasDownloadOptions: boolean;
	hasGateMessage: boolean;
	gateText?: string | null;
	preparedPlan: PlanSnapshot | null;
	executionPlan: PlanSnapshot | null;
	modalAlert?: {
		title: string;
		message: string;
	} | null;
	lastSyncSummary?: {
		timestamp: number;
		processedNotes: number;
		totalNotes?: number | null;
		success: boolean;
		mode: SyncMode;
	} | null;
	lastSyncLogPath?: string | null;
	saveLocation?: string;
	subscriptionStatus?: string | null;
	settings?: {
		autoSyncEnabled: boolean;
		autoSyncIntervalHours: number;
		twoWaySyncBackupAcknowledged: boolean;
		twoWaySyncEnabled: boolean;
		twoWaySyncAutoSyncEnabled: boolean;
		keepSidianLastSuccessfulSyncDate?: string | null;
		premiumFeatures?: {
			includeNotesTerms: string[];
			excludeNotesTerms: string[];
			includeColors: string[];
			pinnedStatus: string;
			archivedStatus: string;
			updateTitle: boolean;
			suggestTags: boolean;
			maxTags: number;
			tagPrefix: string;
			limitToExistingTags: boolean;
		};
	};
}

interface ScenarioContext {
	subscriptionMode: SubscriptionMode;
	corpus: CorpusSummary | null;
	saveLocation: string;
	absoluteSaveLocation: string;
	downloadedNotePath?: string;
}

interface ScenarioDefinition {
	id: string;
	title: string;
	subscriptionMode: SubscriptionMode;
	run: (context: ScenarioContext) => Promise<void>;
}

const defaultVaultPath = path.resolve(process.env.HOME ?? "", "Documents/Obsidian-Test-Vault");
const outputDir =
	process.env.KEEPSIDIAN_E2E_OUTPUT_DIR ??
	path.resolve(process.cwd(), "output/live-e2e", new Date().toISOString().replace(/[:.]/g, "-"));
const screenshotDir = path.join(outputDir, "screenshots");
const runbookJsonPath = path.join(outputDir, "runbook.json");
const runbookMarkdownPath = path.join(outputDir, "runbook.md");
const preflightPath = path.join(outputDir, "preflight.json");
const waitTimeoutMs = Number.parseInt(process.env.KEEPSIDIAN_LIVE_TIMEOUT_MS ?? "180000", 10);
const executeSync = /^(1|true|yes)$/i.test(process.env.KEEPSIDIAN_LIVE_EXECUTE ?? "");
const vaultPath = process.env.KEEPSIDIAN_E2E_VAULT ?? defaultVaultPath;
const serverUrl =
	process.env.KEEPSIDIAN_TEST_SERVER_URL ??
	process.env.KEEPSIDIAN_SERVER_URL ??
	"http://127.0.0.1:8080";
const subscriptionMode: SubscriptionMode =
	process.env.KEEPSIDIAN_LIVE_SUBSCRIPTION_MODE === "inactive" ? "inactive" : "active";
const saveLocation = `/KeepSidian-Live-E2E/${subscriptionMode}`;
const absoluteSaveLocation = path.join(vaultPath, saveLocation.replace(/^\/+/, ""));

const runMetadata: Record<string, string | boolean | undefined | null> = {
	vaultPath,
	serverUrl,
	executeSync,
	subscriptionMode,
	saveLocation,
};

const scenarioRecords: ScenarioRecord[] = [];
let currentScenario: ScenarioRecord | null = null;
let artifactCounter = 0;
const liveBrowser = browser as unknown as {
	saveScreenshot: (filePath: string) => Promise<void>;
	executeObsidian: <T>(fn: (...args: any[]) => T | Promise<T>, ...args: any[]) => Promise<T>;
	executeObsidianCommand: (commandId: string) => Promise<void>;
	execute: <T>(fn: (...args: any[]) => T, ...args: any[]) => Promise<T>;
	waitUntil: (condition: () => Promise<boolean>, options: { timeout: number; interval: number }) => Promise<boolean>;
	reloadObsidian: (options: { vault: string }) => Promise<void>;
	setWindowSize?: (width: number, height: number) => Promise<void>;
	$: (selector: string) => { waitForExist: (options: { timeout: number }) => Promise<void> };
};

function sanitizeLabel(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

async function ensureOutputDir(): Promise<void> {
	await fs.mkdir(screenshotDir, { recursive: true });
}

async function takeScreenshot(label: string): Promise<string> {
	artifactCounter += 1;
	const fileName = `${String(artifactCounter).padStart(2, "0")}-${sanitizeLabel(label)}.png`;
	const filePath = path.join(screenshotDir, fileName);
	await liveBrowser.saveScreenshot(filePath);
	return filePath;
}

function beginScenario(definition: ScenarioDefinition): void {
	currentScenario = {
		id: definition.id,
		title: definition.title,
		subscriptionMode: definition.subscriptionMode,
		status: "passed",
		startedAt: new Date().toISOString(),
		steps: [],
	};
	scenarioRecords.push(currentScenario);
}

function finishScenario(status: ScenarioStatus, details?: string): void {
	if (!currentScenario) {
		return;
	}

	currentScenario.status = status;
	currentScenario.details = details;
	currentScenario.finishedAt = new Date().toISOString();
	currentScenario = null;
}

async function noteScenarioStep(
	id: string,
	title: string,
	status: StepStatus,
	details?: string,
	screenshotLabel?: string
): Promise<void> {
	if (!currentScenario) {
		throw new Error(`Scenario step recorded outside a scenario: ${id}`);
	}

	const screenshot = screenshotLabel ? await takeScreenshot(`${currentScenario.id}-${screenshotLabel}`) : undefined;
	currentScenario.steps.push({
		id,
		title,
		status,
		at: new Date().toISOString(),
		details,
		screenshot,
	});
	if (status === "failed" && currentScenario.status === "passed") {
		currentScenario.status = "failed";
	}
}

function requireCondition(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function buildDefaultPremiumFeatures(): {
	includeNotesTerms: string[];
	excludeNotesTerms: string[];
	includeColors: string[];
	pinnedStatus: string;
	archivedStatus: string;
	updateTitle: boolean;
	suggestTags: boolean;
	maxTags: number;
	tagPrefix: string;
	limitToExistingTags: boolean;
} {
	return {
		includeNotesTerms: [],
		excludeNotesTerms: [],
		includeColors: [],
		pinnedStatus: "all",
		archivedStatus: "active-only",
		updateTitle: false,
		suggestTags: false,
		maxTags: 5,
		tagPrefix: "auto-",
		limitToExistingTags: false,
	};
}

async function readPreflightCorpus(): Promise<CorpusSummary | null> {
	try {
		const raw = await fs.readFile(preflightPath, "utf8");
		const parsed = JSON.parse(raw) as { corpusSummary?: CorpusSummary };
		return parsed.corpusSummary ?? null;
	} catch {
		return null;
	}
}

async function pluginAction<T>(action: string, payload?: Record<string, unknown>): Promise<T> {
	return await liveBrowser.executeObsidian(
		async ({ app }, requestedAction, requestedPayload) => {
			type GenericRecord = Record<string, unknown>;
			type KeepSidianPluginLike = {
				settings: GenericRecord & {
					premiumFeatures?: GenericRecord;
					subscriptionCache?: GenericRecord;
				};
				subscriptionActive?: boolean | null;
				subscriptionService?: {
					checkSubscription?: (forceRefresh?: boolean) => Promise<GenericRecord | null>;
				};
				saveSettings?: () => Promise<void>;
				refreshAutoSyncSafeguards?: () => void;
				startAutoSync?: () => void;
				stopAutoSync?: () => void;
				openSyncCenter?: (options?: { mode?: SyncMode; autoStart?: boolean }) => void;
				progressModal?: GenericRecord | null;
				lastSyncSummary?: GenericRecord | null;
				lastSyncLogPath?: string | null;
				runAutoSyncTick?: () => Promise<void>;
				requireTwoWaySafeguards?: (options?: {
					requirePremium?: boolean;
					requireAutoSync?: boolean;
				}) => Promise<{ allowed: boolean; reasons: string[] }>;
				isSyncInProgress?: () => boolean;
			};

			const plugin = app.plugins.getPlugin("keepsidian") as KeepSidianPluginLike | undefined;
			if (!plugin) {
				throw new Error("KeepSidian plugin is not loaded");
			}

			const serializePlan = (plan: GenericRecord | null | undefined): PlanSnapshot | null => {
				if (!plan) {
					return null;
				}
				const entries = Array.isArray(plan.entries)
					? plan.entries.map((entry: GenericRecord) => ({
							id: String(entry.id ?? ""),
							title: String(entry.title ?? ""),
							path: typeof entry.path === "string" ? entry.path : undefined,
							label: String(entry.label ?? ""),
							action: String(entry.action ?? ""),
							selectable: Boolean(entry.selectable),
							selected: Boolean(entry.selected),
							selectionLocked: Boolean(entry.selectionLocked),
								selectionLockedReason:
									typeof entry.selectionLockedReason === "string" ? entry.selectionLockedReason : undefined,
								metaDetail:
									typeof entry.meta === "object" &&
									entry.meta &&
									typeof (entry.meta as Record<string, unknown>).detail === "string"
										? ((entry.meta as Record<string, unknown>).detail as string)
										: undefined,
					  }))
					: [];
				return {
					mode: String(plan.mode ?? "import") as SyncMode,
					stage: String(plan.stage ?? "import") as "import" | "upload",
					title: String(plan.title ?? ""),
					counts:
						typeof plan.counts === "object" && plan.counts
							? Object.fromEntries(
									Object.entries(plan.counts as Record<string, unknown>).map(([key, value]) => [
										key,
										Number(value ?? 0),
									])
							  )
							: {},
					selectedCount: Number(plan.selectedCount ?? 0),
					actionableCount: Number(plan.actionableCount ?? 0),
					entries,
				};
			};

			const getModal = (): GenericRecord | null => plugin.progressModal ?? null;
			const modalSnapshot = (): ModalSnapshot => {
				const modal = getModal();
				const modalElement = modal?.modalEl as HTMLElement | undefined;
				const doc = modalElement?.ownerDocument ?? document;
				const gateMessage = doc.querySelector(".keepsidian-modal-gate-message");
				return {
					open: Boolean(modal && modalElement?.isConnected),
					surface:
						typeof modal?.getSurface === "function" ? (modal.getSurface() as ModalSnapshot["surface"]) : null,
					selectedMode:
						typeof modal?.selectedMode === "string" ? (modal.selectedMode as SyncMode) : null,
					downloadScopeKind:
						typeof modal?.downloadScopeKind === "string"
							? (modal.downloadScopeKind as DownloadScopeKind)
							: null,
					showSyncOptions: Boolean(modal?.showSyncOptions),
					hasDownloadOptions: Boolean(doc.querySelector(".keepsidian-sync-center-download-options")),
					hasGateMessage: Boolean(gateMessage),
					gateText: gateMessage?.textContent?.trim() ?? null,
					preparedPlan: serializePlan((modal?.preparedPlan as GenericRecord | null | undefined)?.plan as GenericRecord),
					executionPlan: serializePlan(
						(modal?.executionSnapshot as GenericRecord | null | undefined)?.plan as GenericRecord
					),
					modalAlert:
						typeof modal?.modalAlert === "object" && modal.modalAlert
							? {
									title: String((modal.modalAlert as GenericRecord).title ?? ""),
									message: String((modal.modalAlert as GenericRecord).message ?? ""),
							  }
							: null,
					lastSyncSummary:
						typeof plugin.lastSyncSummary === "object" && plugin.lastSyncSummary
							? {
									timestamp: Number((plugin.lastSyncSummary as GenericRecord).timestamp ?? 0),
									processedNotes: Number((plugin.lastSyncSummary as GenericRecord).processedNotes ?? 0),
									totalNotes:
										typeof (plugin.lastSyncSummary as GenericRecord).totalNotes === "number"
											? Number((plugin.lastSyncSummary as GenericRecord).totalNotes)
											: null,
									success: Boolean((plugin.lastSyncSummary as GenericRecord).success),
									mode: String((plugin.lastSyncSummary as GenericRecord).mode ?? "import") as SyncMode,
							  }
							: null,
					lastSyncLogPath: plugin.lastSyncLogPath ?? null,
					saveLocation: typeof plugin.settings.saveLocation === "string" ? plugin.settings.saveLocation : undefined,
					subscriptionStatus:
						typeof plugin.settings.subscriptionCache === "object" &&
						plugin.settings.subscriptionCache &&
						typeof (plugin.settings.subscriptionCache as GenericRecord).info === "object" &&
						(plugin.settings.subscriptionCache as GenericRecord).info &&
						typeof ((plugin.settings.subscriptionCache as GenericRecord).info as GenericRecord).subscription_status ===
							"string"
							? String(
									((plugin.settings.subscriptionCache as GenericRecord).info as GenericRecord)
										.subscription_status
							  )
							: null,
					settings: {
						autoSyncEnabled: Boolean(plugin.settings.autoSyncEnabled),
						autoSyncIntervalHours: Number(plugin.settings.autoSyncIntervalHours ?? 0),
						twoWaySyncBackupAcknowledged: Boolean(plugin.settings.twoWaySyncBackupAcknowledged),
						twoWaySyncEnabled: Boolean(plugin.settings.twoWaySyncEnabled),
						twoWaySyncAutoSyncEnabled: Boolean(plugin.settings.twoWaySyncAutoSyncEnabled),
						keepSidianLastSuccessfulSyncDate:
							typeof plugin.settings.keepSidianLastSuccessfulSyncDate === "string" ||
							plugin.settings.keepSidianLastSuccessfulSyncDate === null
								? (plugin.settings.keepSidianLastSuccessfulSyncDate as string | null)
								: null,
						premiumFeatures:
							typeof plugin.settings.premiumFeatures === "object" && plugin.settings.premiumFeatures
								? {
										includeNotesTerms: Array.isArray(plugin.settings.premiumFeatures.includeNotesTerms)
											? (plugin.settings.premiumFeatures.includeNotesTerms as string[])
											: [],
										excludeNotesTerms: Array.isArray(plugin.settings.premiumFeatures.excludeNotesTerms)
											? (plugin.settings.premiumFeatures.excludeNotesTerms as string[])
											: [],
										includeColors: Array.isArray(plugin.settings.premiumFeatures.includeColors)
											? (plugin.settings.premiumFeatures.includeColors as string[])
											: [],
										pinnedStatus: String(plugin.settings.premiumFeatures.pinnedStatus ?? "all"),
										archivedStatus: String(plugin.settings.premiumFeatures.archivedStatus ?? "active-only"),
										updateTitle: Boolean(plugin.settings.premiumFeatures.updateTitle),
										suggestTags: Boolean(plugin.settings.premiumFeatures.suggestTags),
										maxTags: Number(plugin.settings.premiumFeatures.maxTags ?? 0),
										tagPrefix: String(plugin.settings.premiumFeatures.tagPrefix ?? ""),
										limitToExistingTags: Boolean(plugin.settings.premiumFeatures.limitToExistingTags),
								  }
								: undefined,
					},
				};
			};

			const mergeSettings = async () => {
				const patch = (requestedPayload ?? {}) as GenericRecord;
				plugin.stopAutoSync?.();

				if (typeof patch.email === "string") {
					plugin.settings.email = patch.email;
				}
				if (typeof patch.token === "string") {
					plugin.settings.token = patch.token;
				}
				if (typeof patch.saveLocation === "string") {
					plugin.settings.saveLocation = patch.saveLocation.startsWith("/")
						? patch.saveLocation
						: `/${patch.saveLocation}`;
				}
				if (typeof patch.autoSyncEnabled === "boolean") {
					plugin.settings.autoSyncEnabled = patch.autoSyncEnabled;
				}
				if (typeof patch.autoSyncIntervalHours === "number") {
					plugin.settings.autoSyncIntervalHours = patch.autoSyncIntervalHours;
				}
				if (typeof patch.keepSidianLastSuccessfulSyncDate === "string" || patch.keepSidianLastSuccessfulSyncDate === null) {
					plugin.settings.keepSidianLastSuccessfulSyncDate = patch.keepSidianLastSuccessfulSyncDate as
						| string
						| null;
				}
				if (typeof patch.lastSyncSummary === "object" || patch.lastSyncSummary === null) {
					plugin.lastSyncSummary = (patch.lastSyncSummary as GenericRecord | null) ?? null;
					plugin.settings.lastSyncSummary = (patch.lastSyncSummary as GenericRecord | null) ?? null;
				}
				if (typeof patch.lastSyncLogPath === "string" || patch.lastSyncLogPath === null) {
					plugin.lastSyncLogPath = (patch.lastSyncLogPath as string | null) ?? null;
					plugin.settings.lastSyncLogPath = (patch.lastSyncLogPath as string | null) ?? null;
				}
				if (typeof patch.twoWaySyncBackupAcknowledged === "boolean") {
					plugin.settings.twoWaySyncBackupAcknowledged = patch.twoWaySyncBackupAcknowledged;
				}
				if (typeof patch.twoWaySyncEnabled === "boolean") {
					plugin.settings.twoWaySyncEnabled = patch.twoWaySyncEnabled;
				}
				if (typeof patch.twoWaySyncAutoSyncEnabled === "boolean") {
					plugin.settings.twoWaySyncAutoSyncEnabled = patch.twoWaySyncAutoSyncEnabled;
				}
				if (patch.subscriptionCache === null) {
					plugin.settings.subscriptionCache = undefined;
				} else if (typeof patch.subscriptionCache === "object" && patch.subscriptionCache) {
					plugin.settings.subscriptionCache = patch.subscriptionCache as GenericRecord;
				}
				if (typeof patch.premiumFeatures === "object" && patch.premiumFeatures) {
					plugin.settings.premiumFeatures = {
						...(plugin.settings.premiumFeatures ?? {}),
						...(patch.premiumFeatures as GenericRecord),
					};
				}
				plugin.refreshAutoSyncSafeguards?.();
				await plugin.saveSettings?.();
				if (plugin.settings.autoSyncEnabled) {
					plugin.startAutoSync?.();
				}
				return modalSnapshot();
			};

			switch (requestedAction) {
				case "apply-settings":
					return (await mergeSettings()) as T;
				case "refresh-subscription": {
					const info = await plugin.subscriptionService?.checkSubscription?.(true);
					plugin.subscriptionActive =
						typeof info?.subscription_status === "string" ? info.subscription_status === "active" : null;
					await plugin.saveSettings?.();
					return {
						info,
						modal: modalSnapshot(),
					} as T;
				}
				case "open-sync-center": {
					const payload = (requestedPayload ?? {}) as GenericRecord;
					plugin.openSyncCenter?.({
						mode: (payload.mode as SyncMode | undefined) ?? "import",
						autoStart: Boolean(payload.autoStart),
					});
					const modal = getModal();
					if (modal) {
						modal.showSyncOptions = Boolean(payload.showSyncOptions);
						if (typeof modal.refreshUI === "function") {
							await modal.refreshUI();
						}
					}
					return modalSnapshot() as T;
				}
				case "configure-sync-center": {
					const payload = (requestedPayload ?? {}) as GenericRecord;
					const modal = getModal();
					if (!modal) {
						throw new Error("Sync center is not open");
					}
					if (typeof payload.mode === "string") {
						if (typeof modal.setSelectedMode === "function") {
							modal.setSelectedMode(payload.mode);
						} else {
							modal.selectedMode = payload.mode;
						}
					}
					if (typeof payload.showSyncOptions === "boolean") {
						modal.showSyncOptions = payload.showSyncOptions;
					}
					if (typeof payload.downloadScopeKind === "string") {
						modal.downloadScopeKind = payload.downloadScopeKind;
					}
					if (typeof payload.customSinceInput === "string") {
						modal.customSinceInput = payload.customSinceInput;
					}
					if (typeof modal.refreshUI === "function") {
						await modal.refreshUI();
					}
					return modalSnapshot() as T;
				}
				case "begin-review": {
					const payload = (requestedPayload ?? {}) as GenericRecord;
					const modal = getModal();
					if (!modal) {
						throw new Error("Sync center is not open");
					}
					if (typeof payload.downloadScopeKind === "string") {
						modal.downloadScopeKind = payload.downloadScopeKind;
					}
					if (typeof payload.customSinceInput === "string") {
						modal.customSinceInput = payload.customSinceInput;
					}
					if (typeof payload.showSyncOptions === "boolean") {
						modal.showSyncOptions = payload.showSyncOptions;
					}
						if (typeof modal.beginReview === "function") {
							await modal.beginReview((payload.mode as SyncMode | undefined) ?? modal.selectedMode ?? "import");
						}
						return modalSnapshot() as T;
					}
					case "run-current-plan": {
					const modal = getModal();
					if (!modal) {
						throw new Error("Sync center is not open");
					}
						if (typeof modal.runReviewedPlan === "function") {
							await modal.runReviewedPlan();
						}
						return modalSnapshot() as T;
					}
					case "close-sync-center": {
						const modal = getModal();
						if (modal && typeof modal.close === "function") {
							await modal.close();
						}
						return modalSnapshot() as T;
					}
				case "modal-snapshot":
					return modalSnapshot() as T;
				case "run-auto-sync-tick": {
					await plugin.runAutoSyncTick?.();
					return {
						modal: modalSnapshot(),
						isSyncInProgress: plugin.isSyncInProgress?.() ?? false,
					} as T;
				}
				case "require-two-way-gate": {
					const payload = (requestedPayload ?? {}) as GenericRecord;
					if (typeof plugin.requireTwoWaySafeguards !== "function") {
						throw new Error("Plugin does not expose requireTwoWaySafeguards");
					}
					return (await plugin.requireTwoWaySafeguards({
						requirePremium:
							typeof payload.requirePremium === "boolean" ? payload.requirePremium : undefined,
						requireAutoSync:
							typeof payload.requireAutoSync === "boolean" ? payload.requireAutoSync : undefined,
					})) as T;
				}
				case "list-markdown-files": {
					const payload = (requestedPayload ?? {}) as GenericRecord;
					const root = typeof payload.root === "string" ? payload.root : "";
					const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
					const adapter = app.vault.adapter as {
						list?: (folder: string) => Promise<{ files: string[]; folders: string[] }>;
					};
					const listRecursively = async (folder: string): Promise<string[]> => {
						if (typeof adapter.list !== "function") {
							return [];
						}
						try {
							const { files, folders } = await adapter.list(folder);
							const markdownFiles = files
								.map((file) => String(file))
								.filter(
									(file) =>
										file.toLowerCase().endsWith(".md") &&
										!file.includes("-conflict-") &&
										!file.includes("/_KeepSidianLogs/")
								);
							for (const subfolder of folders) {
								markdownFiles.push(...(await listRecursively(String(subfolder))));
							}
							return markdownFiles;
						} catch {
							return [];
						}
					};
					return (await listRecursively(normalizedRoot)) as T;
				}
				case "append-note": {
					const payload = (requestedPayload ?? {}) as GenericRecord;
					const filePath = typeof payload.filePath === "string" ? payload.filePath : "";
					const suffix = typeof payload.suffix === "string" ? payload.suffix : "";
					if (!filePath) {
						throw new Error("append-note requires filePath");
					}
					const adapter = app.vault.adapter as {
						read: (path: string) => Promise<string>;
						write: (path: string, data: string) => Promise<void>;
					};
					const existing = await adapter.read(filePath);
					await adapter.write(filePath, `${existing.trimEnd()}\n\n${suffix}\n`);
					return true as T;
				}
				default:
					throw new Error(`Unsupported live E2E action: ${requestedAction}`);
			}
		},
		action,
		payload ?? {}
	);
}

async function waitForModalSurface(
	surface: NonNullable<ModalSnapshot["surface"]>,
	stage?: "import" | "upload"
): Promise<ModalSnapshot> {
	await liveBrowser.waitUntil(
		async () => {
			const modal = await pluginAction<ModalSnapshot>("modal-snapshot");
			if (modal.surface !== surface) {
				return false;
			}
			if (stage && modal.preparedPlan?.stage !== stage && modal.executionPlan?.stage !== stage) {
				return false;
			}
			return true;
		},
		{ timeout: waitTimeoutMs, interval: 500 }
	);
	return await pluginAction<ModalSnapshot>("modal-snapshot");
}

async function ensureCredentials(): Promise<{ email: string; tokenLength: number }> {
	const configuredEmail = process.env.KEEPSIDIAN_TEST_EMAIL?.trim() || null;
	const configuredToken = process.env.KEEPSIDIAN_TEST_TOKEN?.trim() || null;

	return await liveBrowser.executeObsidian(
		async ({ app }, email, token) => {
			const plugin = app.plugins.getPlugin("keepsidian") as
				| {
						settings?: { email?: string; token?: string };
						saveSettings?: () => Promise<void>;
				  }
				| undefined;
			if (!plugin?.settings) {
				throw new Error("KeepSidian plugin settings are not available");
			}

			if (email) {
				plugin.settings.email = email;
			}
			if (token) {
				plugin.settings.token = token;
			}

			const currentEmail = plugin.settings.email?.trim() ?? "";
			const currentToken = plugin.settings.token?.trim() ?? "";
			if (!currentEmail || !currentToken) {
				throw new Error(
					"Missing KeepSidian credentials. Set KEEPSIDIAN_TEST_EMAIL and KEEPSIDIAN_TEST_TOKEN, or store email/token in the target vault before running the live lane."
				);
			}

			await plugin.saveSettings?.();
			return {
				email: currentEmail,
				tokenLength: currentToken.length,
			};
		},
		configuredEmail,
		configuredToken
	);
}

async function openKeepSidianSettingsTab(): Promise<void> {
	const settingsCommandId = await liveBrowser.execute(() => {
		type ObsidianWindow = Window & {
			app?: {
				commands?: {
					listCommands?: () => Array<{ id: string; name: string }>;
				};
			};
		};

		const commands = (window as ObsidianWindow).app?.commands?.listCommands?.() ?? [];
		const lower = (value: string) => value.toLowerCase();
		const match =
			commands.find((command) => command.id === "app:open-settings") ??
			commands.find((command) => lower(command.id).includes("open-settings")) ??
			commands.find((command) => lower(command.name).includes("settings"));
		return match?.id ?? null;
	});

	if (!settingsCommandId) {
		throw new Error("Could not find an Obsidian command to open settings");
	}

	await liveBrowser.executeObsidianCommand(settingsCommandId);
	await liveBrowser.executeObsidian(({ app }) => {
		app?.setting?.openTabById?.("keepsidian");
	});

	const emailSetting = liveBrowser.$(
		'//*[contains(@class,"setting-item-name") and normalize-space(.)="Email"]'
	);
	await emailSetting.waitForExist({ timeout: waitTimeoutMs });
}

async function clearScenarioSaveLocation(): Promise<void> {
	await fs.rm(absoluteSaveLocation, { recursive: true, force: true });
	await fs.mkdir(absoluteSaveLocation, { recursive: true });
}

async function chooseDownloadedNotePath(context: ScenarioContext): Promise<string | undefined> {
	const relativeRoot = context.saveLocation.replace(/^\/+/, "");
	const files = await pluginAction<string[]>("list-markdown-files", {
		root: relativeRoot,
	});
	context.downloadedNotePath = files.sort()[0];
	return context.downloadedNotePath;
}

async function appendToNote(filePath: string, suffix: string): Promise<void> {
	await pluginAction<boolean>("append-note", {
		filePath,
		suffix,
	});
}

async function forceSubscription(expectedMode: SubscriptionMode): Promise<void> {
	const refreshed = await pluginAction<{
		info?: { subscription_status?: string | null } | null;
		modal: ModalSnapshot;
	}>("refresh-subscription");
	const actualStatus = refreshed.info?.subscription_status ?? refreshed.modal.subscriptionStatus ?? null;
	if (actualStatus !== expectedMode) {
		throw new Error(`Expected subscription status '${expectedMode}', received '${actualStatus ?? "unknown"}'`);
	}
}

async function resetPluginState(): Promise<void> {
	const credentials = await ensureCredentials();
	await pluginAction<ModalSnapshot>("apply-settings", {
		email: credentials.email,
		saveLocation,
		autoSyncEnabled: false,
		autoSyncIntervalHours: 1,
		keepSidianLastSuccessfulSyncDate: null,
		lastSyncSummary: null,
		lastSyncLogPath: null,
		twoWaySyncBackupAcknowledged: false,
		twoWaySyncEnabled: false,
		twoWaySyncAutoSyncEnabled: false,
		subscriptionCache: null,
		premiumFeatures: buildDefaultPremiumFeatures(),
	});
	await clearScenarioSaveLocation();
}

async function renderSyncCenter(
	mode: SyncMode,
	showSyncOptions = true,
	downloadScopeKind: DownloadScopeKind = "last-sync",
	customSinceInput?: string
): Promise<ModalSnapshot> {
	await pluginAction<ModalSnapshot>("open-sync-center", {
		mode,
		autoStart: false,
		showSyncOptions,
	});
	return await pluginAction<ModalSnapshot>("configure-sync-center", {
		mode,
		showSyncOptions,
		downloadScopeKind,
		customSinceInput,
	});
}

async function beginReview(
	mode: SyncMode,
	downloadScopeKind: DownloadScopeKind = "last-sync",
	customSinceInput?: string
): Promise<ModalSnapshot> {
	await renderSyncCenter(mode, true, downloadScopeKind, customSinceInput);
	await pluginAction<ModalSnapshot>("begin-review", {
		mode,
		showSyncOptions: true,
		downloadScopeKind,
		customSinceInput,
	});
	return await waitForModalSurface("review");
}

async function runCurrentPlan(): Promise<ModalSnapshot> {
	await pluginAction<ModalSnapshot>("run-current-plan");
	return await liveBrowser.waitUntil(
		async () => {
			const modal = await pluginAction<ModalSnapshot>("modal-snapshot");
			return modal.surface === "review" || modal.surface === "result";
		},
		{ timeout: waitTimeoutMs, interval: 500 }
	).then(async () => await pluginAction<ModalSnapshot>("modal-snapshot"));
}

async function captureSettings(stepId: string, title: string): Promise<void> {
	await openKeepSidianSettingsTab();
	await noteScenarioStep(stepId, title, "passed", undefined, sanitizeLabel(stepId));
}

async function runActiveBaseline(context: ScenarioContext): Promise<void> {
	await captureSettings("active-settings", "Captured supporter settings");

	const setup = await renderSyncCenter("import", true, "last-sync");
	requireCondition(setup.hasDownloadOptions, "Supporter setup should render download options");
	await noteScenarioStep(
		"active-setup",
		"Captured supporter sync center setup",
		"passed",
		"Supporter download options are visible in the sync center.",
		"setup"
	);

	const review = await beginReview("import", "last-sync");
	requireCondition(review.preparedPlan, "Expected a download review plan");
	await noteScenarioStep(
		"active-review",
		"Captured supporter download review",
		"passed",
		`${review.preparedPlan.actionableCount} actionable changes; ${review.preparedPlan.entries.length} total rows.`,
		"review"
	);

	if (!executeSync) {
		await noteScenarioStep(
			"active-execution",
			"Skipped supporter baseline execution",
			"skipped",
			"Set KEEPSIDIAN_LIVE_EXECUTE=true to materialize downloaded notes for downstream scenarios."
		);
		return;
	}

	const result = await runCurrentPlan();
	requireCondition(result.surface === "result", "Expected a result surface after executing the download plan");
	await noteScenarioStep(
		"active-result",
		"Captured supporter download result",
		"passed",
		`Last sync mode: ${result.lastSyncSummary?.mode ?? "unknown"}.`,
		"result"
	);

	context.downloadedNotePath = await chooseDownloadedNotePath(context);
	requireCondition(context.downloadedNotePath, "No downloaded markdown note was found after baseline execution");
}

async function runFilterScenario(context: ScenarioContext): Promise<void> {
	await forceSubscription("active");
	const includeExclude = context.corpus?.filterCandidates?.includeExclude ?? null;
	if (!includeExclude) {
		await noteScenarioStep(
			"filters-unavailable",
			"Skipped filter combination review",
			"skipped",
			"Preflight could not verify a working include/exclude filter pair against the live premium endpoint."
		);
		return;
	}

	const premiumFeatures: Record<string, unknown> = {
		includeNotesTerms: [includeExclude.includeTerm],
		excludeNotesTerms: [includeExclude.excludeTerm],
		includeColors: [],
		pinnedStatus: "all",
		archivedStatus: "active-only",
		updateTitle: false,
		suggestTags: false,
		maxTags: 5,
		tagPrefix: "auto-",
		limitToExistingTags: false,
	};

	await pluginAction<ModalSnapshot>("apply-settings", {
		premiumFeatures,
		keepSidianLastSuccessfulSyncDate: null,
	});
	const setup = await renderSyncCenter("import", true, "all");
	requireCondition(setup.hasDownloadOptions, "Supporter filter scenario should still expose download options");
	const review = await beginReview("import", "all");
	requireCondition(review.preparedPlan, "Expected a filtered download review plan");

	const titles = review.preparedPlan.entries.map((entry) => entry.title.toLowerCase());
	requireCondition(
		titles.some((title) => title.includes(includeExclude.includeTitle.toLowerCase())),
		`Filtered review did not include '${includeExclude.includeTitle}'.`
	);
	requireCondition(
		!titles.some((title) => title.includes(includeExclude.excludeTitle.toLowerCase())),
		`Filtered review still included excluded note '${includeExclude.excludeTitle}'.`
	);

	await noteScenarioStep(
		"filter-review",
		"Captured supporter filtered download review",
		"passed",
		`Included term '${includeExclude.includeTerm}', excluded term '${includeExclude.excludeTerm}'.`,
		"filters"
	);

	const filterCandidates = context.corpus?.filterCandidates;
	const stateFilter = filterCandidates?.pinned
		? {
				label: "pinned",
				title: filterCandidates.pinned.title,
				premiumFeatures: {
					includeNotesTerms: [],
					excludeNotesTerms: [],
					includeColors: [],
					pinnedStatus: "pinned",
					archivedStatus: "all",
					updateTitle: false,
					suggestTags: false,
					maxTags: 5,
					tagPrefix: "auto-",
					limitToExistingTags: false,
				},
		  }
		: filterCandidates?.archived
			? {
					label: "archived",
					title: filterCandidates.archived.title,
					premiumFeatures: {
						includeNotesTerms: [],
						excludeNotesTerms: [],
						includeColors: [],
						pinnedStatus: "all",
						archivedStatus: "archived-only",
						updateTitle: false,
						suggestTags: false,
						maxTags: 5,
						tagPrefix: "auto-",
						limitToExistingTags: false,
					},
			  }
			: filterCandidates?.color
				? {
						label: `color ${filterCandidates.color.color}`,
						title: filterCandidates.color.title,
						premiumFeatures: {
							includeNotesTerms: [],
							excludeNotesTerms: [],
							includeColors: [filterCandidates.color.color],
							pinnedStatus: "all",
							archivedStatus: "all",
							updateTitle: false,
							suggestTags: false,
							maxTags: 5,
							tagPrefix: "auto-",
							limitToExistingTags: false,
						},
				  }
				: null;

	if (!stateFilter) {
		await noteScenarioStep(
			"state-filter-review",
			"Skipped state-filter review",
			"skipped",
			"Preflight did not find a pinned, archived, or colored candidate note."
		);
		return;
	}

	await pluginAction<ModalSnapshot>("apply-settings", {
		premiumFeatures: stateFilter.premiumFeatures,
		keepSidianLastSuccessfulSyncDate: null,
	});
	const stateReview = await beginReview("import", "all");
	requireCondition(stateReview.preparedPlan, "Expected a state-filtered download review plan");
	requireCondition(
		stateReview.preparedPlan.entries.some((entry) =>
			entry.title.toLowerCase().includes(stateFilter.title.toLowerCase())
		),
		`State-filtered review did not include '${stateFilter.title}'.`
	);
	await noteScenarioStep(
		"state-filter-review",
		"Captured supporter state-filter review",
		"passed",
		`Applied ${stateFilter.label} filter and confirmed '${stateFilter.title}' remains visible.`,
		"state-filters"
	);
}

async function runDuplicateReviewScenario(context: ScenarioContext): Promise<void> {
	if (!context.downloadedNotePath) {
		context.downloadedNotePath = await chooseDownloadedNotePath(context);
	}
	if (!context.downloadedNotePath) {
		await noteScenarioStep(
			"duplicate-prereq",
			"Skipped duplicate review",
			"skipped",
			"No downloaded note is available to mutate for duplicate/conflict coverage."
		);
		return;
	}

	await appendToNote(
		context.downloadedNotePath,
		"Live E2E duplicate probe: local-only edits intended to trigger merge or conflict-copy review."
	);
	await pluginAction<ModalSnapshot>("apply-settings", {
		keepSidianLastSuccessfulSyncDate: null,
		premiumFeatures: buildDefaultPremiumFeatures(),
	});
	const review = await beginReview("import", "all");
	requireCondition(review.preparedPlan, "Expected a duplicate download review plan");

	const relevantEntry = review.preparedPlan.entries.find((entry) => entry.path === context.downloadedNotePath);
	requireCondition(relevantEntry, "The mutated note did not appear in the duplicate review");
	requireCondition(
		relevantEntry.label === "Merge" || relevantEntry.label === "Conflict copy" || relevantEntry.label === "Overwrite",
		`Expected Merge, Conflict copy, or Overwrite for the duplicate review, received '${relevantEntry.label}'.`
	);

	await noteScenarioStep(
		"duplicate-review",
		"Captured duplicate handling review",
		"passed",
		`${path.basename(context.downloadedNotePath)} resolved as '${relevantEntry.label}'.`,
		"duplicate-review"
	);
}

async function runUploadScenario(context: ScenarioContext): Promise<void> {
	if (!context.downloadedNotePath) {
		context.downloadedNotePath = await chooseDownloadedNotePath(context);
	}
	if (!context.downloadedNotePath) {
		await noteScenarioStep(
			"upload-prereq",
			"Skipped upload review",
			"skipped",
			"No downloaded note is available to modify for upload coverage."
		);
		return;
	}

	await appendToNote(
		context.downloadedNotePath,
		"Live E2E upload probe: changed locally to verify upload review and execution."
	);
	await pluginAction<ModalSnapshot>("apply-settings", {
		premiumFeatures: buildDefaultPremiumFeatures(),
		twoWaySyncBackupAcknowledged: true,
		twoWaySyncEnabled: true,
		twoWaySyncAutoSyncEnabled: false,
		autoSyncEnabled: false,
	});
	const review = await beginReview("push");
	requireCondition(review.preparedPlan, "Expected an upload review plan");
	const uploadEntry = review.preparedPlan.entries.find((entry) => entry.path === context.downloadedNotePath);
	requireCondition(uploadEntry, "The modified note did not appear in the upload review");
	requireCondition(uploadEntry.label === "Upload", `Expected Upload label, received '${uploadEntry.label}'.`);

	await noteScenarioStep(
		"upload-review",
		"Captured upload review for a locally modified note",
		"passed",
		`${path.basename(context.downloadedNotePath)} is queued for upload.`,
		"upload-review"
	);

	if (!executeSync) {
		await noteScenarioStep(
			"upload-result",
			"Skipped upload execution",
			"skipped",
			"Set KEEPSIDIAN_LIVE_EXECUTE=true to verify upload completion."
		);
		return;
	}

	const result = await runCurrentPlan();
	requireCondition(result.surface === "result", "Expected upload result surface after execution");
	await noteScenarioStep(
		"upload-result",
		"Captured upload completion",
		"passed",
		`Upload result summary mode: ${result.lastSyncSummary?.mode ?? "unknown"}.`,
		"upload-result"
	);
}

async function runTwoWayScenario(context: ScenarioContext): Promise<void> {
	if (!context.downloadedNotePath) {
		context.downloadedNotePath = await chooseDownloadedNotePath(context);
	}
	if (!context.downloadedNotePath) {
		await noteScenarioStep(
			"two-way-prereq",
			"Skipped two-way sync review",
			"skipped",
			"No downloaded note is available to exercise staged two-way sync."
		);
		return;
	}

	await appendToNote(
		context.downloadedNotePath,
		"Live E2E two-way probe: local update before staged import/upload review."
	);
	await pluginAction<ModalSnapshot>("apply-settings", {
		premiumFeatures: buildDefaultPremiumFeatures(),
		twoWaySyncBackupAcknowledged: true,
		twoWaySyncEnabled: true,
		twoWaySyncAutoSyncEnabled: false,
		autoSyncEnabled: false,
	});
	const importReview = await beginReview("two-way", "last-sync");
	requireCondition(importReview.preparedPlan?.stage === "import", "Expected the first two-way review to be import");
	await noteScenarioStep(
		"two-way-import-review",
		"Captured staged two-way import review",
		"passed",
		`${importReview.preparedPlan?.entries.length ?? 0} rows shown in the import stage.`,
		"two-way-import-review"
	);

	if (!executeSync) {
		await noteScenarioStep(
			"two-way-execution",
			"Skipped two-way execution",
			"skipped",
			"Set KEEPSIDIAN_LIVE_EXECUTE=true to verify the upload-stage handoff."
		);
		return;
	}

	const uploadReview = await runCurrentPlan();
	requireCondition(uploadReview.surface === "review", "Expected the upload-stage review after the import stage");
	requireCondition(uploadReview.preparedPlan?.stage === "upload", "Expected upload-stage review for two-way sync");
	await noteScenarioStep(
		"two-way-upload-review",
		"Captured staged two-way upload review",
		"passed",
		`${uploadReview.preparedPlan?.actionableCount ?? 0} upload changes staged after import.`,
		"two-way-upload-review"
	);

	const result = await runCurrentPlan();
	requireCondition(result.surface === "result", "Expected final result after two-way upload stage");
	await noteScenarioStep(
		"two-way-result",
		"Captured two-way completion",
		"passed",
		`Last sync mode: ${result.lastSyncSummary?.mode ?? "unknown"}.`,
		"two-way-result"
	);
}

async function runBackgroundTwoWayScenario(context: ScenarioContext): Promise<void> {
	if (!context.downloadedNotePath) {
		context.downloadedNotePath = await chooseDownloadedNotePath(context);
	}
	if (!context.downloadedNotePath) {
		await noteScenarioStep(
			"background-supporter-prereq",
			"Skipped supporter background sync",
			"skipped",
			"No downloaded note is available to exercise background two-way sync."
		);
		return;
	}

	await appendToNote(
		context.downloadedNotePath,
		"Live E2E background two-way probe: local update before auto sync tick."
	);
	await pluginAction<ModalSnapshot>("apply-settings", {
		premiumFeatures: buildDefaultPremiumFeatures(),
		autoSyncEnabled: true,
		autoSyncIntervalHours: 1,
		twoWaySyncBackupAcknowledged: true,
		twoWaySyncEnabled: true,
		twoWaySyncAutoSyncEnabled: true,
	});
	const before = await pluginAction<ModalSnapshot>("modal-snapshot");
	const previousTimestamp = before.lastSyncSummary?.timestamp ?? 0;
	await pluginAction<{ modal: ModalSnapshot; isSyncInProgress: boolean }>("run-auto-sync-tick");
	await liveBrowser.waitUntil(
		async () => {
			const modal = await pluginAction<ModalSnapshot>("modal-snapshot");
			return (modal.lastSyncSummary?.timestamp ?? 0) > previousTimestamp && modal.surface !== "running";
		},
		{ timeout: waitTimeoutMs, interval: 500 }
	);
	const idle = await pluginAction<ModalSnapshot>("modal-snapshot");
	requireCondition(!idle.open, "Background sync should not auto-open the sync center");
	requireCondition(idle.lastSyncSummary?.mode === "two-way", "Expected supporter background sync to finish in two-way mode");
	await noteScenarioStep(
		"background-supporter-result",
		"Captured supporter background sync outcome",
		"passed",
		"Background two-way sync completed without auto-opening the sync center.",
		"background-supporter"
	);
}

async function runInactiveDownloadReview(): Promise<void> {
	await captureSettings("inactive-settings", "Captured non-supporter settings");

	const setup = await renderSyncCenter("import", true, "all");
	requireCondition(!setup.hasDownloadOptions, "Non-supporter setup should not render supporter download options");
	await noteScenarioStep(
		"inactive-setup",
		"Captured non-supporter sync center setup",
		"passed",
		"Supporter-only download options are hidden.",
		"inactive-setup"
	);

	const review = await beginReview("import", "all");
	requireCondition(review.preparedPlan, "Expected a non-supporter download review plan");
	const lockedEntries = review.preparedPlan.entries.filter((entry) => entry.selectionLocked);
	requireCondition(lockedEntries.length > 0, "Expected locked row selection for non-supporter actionable entries");
	await noteScenarioStep(
		"inactive-review",
		"Captured non-supporter download review",
		"passed",
		`${lockedEntries.length} actionable rows are locked for non-supporters.`,
		"inactive-review"
	);
}

async function runInactiveGateScenario(mode: SyncMode, stepPrefix: string, title: string): Promise<void> {
	await forceSubscription("inactive");
	await pluginAction<ModalSnapshot>("apply-settings", {
		autoSyncEnabled: false,
		twoWaySyncBackupAcknowledged: true,
		twoWaySyncEnabled: true,
		twoWaySyncAutoSyncEnabled: false,
	});
	const gate = await pluginAction<{ allowed: boolean; reasons: string[] }>("require-two-way-gate", {
		requirePremium: true,
	});
	requireCondition(gate.allowed === false, `Expected ${mode} safeguards to remain locked for non-supporters`);
	requireCondition(
		gate.reasons.some((reason) => reason.toLowerCase().includes("supporter")),
		`Expected non-supporter premium messaging in the ${mode} safeguard reasons`
	);
	const setup = await renderSyncCenter(mode, true);
	const gateSummary = gate.reasons.join(" | ");
	const detail = setup.hasGateMessage ? `${gateSummary} | Setup copy: ${setup.gateText ?? ""}` : gateSummary;
	await noteScenarioStep(stepPrefix, title, "passed", detail, stepPrefix);
}

async function runInactiveBackgroundScenario(): Promise<void> {
	await forceSubscription("inactive");
	await pluginAction<ModalSnapshot>("apply-settings", {
		autoSyncEnabled: true,
		autoSyncIntervalHours: 1,
		twoWaySyncBackupAcknowledged: true,
		twoWaySyncEnabled: true,
		twoWaySyncAutoSyncEnabled: true,
	});
	const before = await pluginAction<ModalSnapshot>("modal-snapshot");
	const previousTimestamp = before.lastSyncSummary?.timestamp ?? 0;
	await pluginAction<{ modal: ModalSnapshot; isSyncInProgress: boolean }>("run-auto-sync-tick");
	await liveBrowser.waitUntil(
		async () => {
			const modal = await pluginAction<ModalSnapshot>("modal-snapshot");
			return (modal.lastSyncSummary?.timestamp ?? 0) > previousTimestamp && modal.surface !== "running";
		},
		{ timeout: waitTimeoutMs, interval: 500 }
	);
	const idle = await pluginAction<ModalSnapshot>("modal-snapshot");
	requireCondition(!idle.open, "Background fallback should not auto-open the sync center");
	await noteScenarioStep(
		"inactive-background",
		"Captured non-supporter background fallback",
		"passed",
		`Background sync completed without auto-opening the sync center. Observed mode: ${
			idle.lastSyncSummary?.mode ?? "unknown"
		}.`,
		"inactive-background"
	);
}

const activeScenarios: ScenarioDefinition[] = [
	{
		id: "supporter-foreground-download",
		title: "Supporter foreground download baseline",
		subscriptionMode: "active",
		run: runActiveBaseline,
	},
	{
		id: "supporter-filter-combination",
		title: "Supporter filter combination review",
		subscriptionMode: "active",
		run: runFilterScenario,
	},
	{
		id: "supporter-duplicate-review",
		title: "Supporter duplicate and merge review",
		subscriptionMode: "active",
		run: runDuplicateReviewScenario,
	},
	{
		id: "supporter-upload-review",
		title: "Supporter upload review and execution",
		subscriptionMode: "active",
		run: runUploadScenario,
	},
	{
		id: "supporter-two-way-staged",
		title: "Supporter staged two-way review",
		subscriptionMode: "active",
		run: runTwoWayScenario,
	},
	{
		id: "supporter-background-two-way",
		title: "Supporter background two-way sync",
		subscriptionMode: "active",
		run: runBackgroundTwoWayScenario,
	},
];

const inactiveScenarios: ScenarioDefinition[] = [
	{
		id: "non-supporter-download-review",
		title: "Non-supporter download review",
		subscriptionMode: "inactive",
		run: async () => await runInactiveDownloadReview(),
	},
	{
		id: "non-supporter-upload-gate",
		title: "Non-supporter upload gate",
		subscriptionMode: "inactive",
		run: async () =>
			await runInactiveGateScenario("push", "inactive-upload-gate", "Captured non-supporter upload gate"),
	},
	{
		id: "non-supporter-two-way-gate",
		title: "Non-supporter two-way gate",
		subscriptionMode: "inactive",
		run: async () =>
			await runInactiveGateScenario("two-way", "inactive-two-way-gate", "Captured non-supporter two-way gate"),
	},
	{
		id: "non-supporter-background-fallback",
		title: "Non-supporter background fallback",
		subscriptionMode: "inactive",
		run: async () => await runInactiveBackgroundScenario(),
	},
];

async function writeRunbook(status: "passed" | "failed"): Promise<void> {
	const runbook = {
		status,
		startedAt: runMetadata.startedAt,
		finishedAt: new Date().toISOString(),
		meta: runMetadata,
		scenarios: scenarioRecords,
	};
	await fs.writeFile(runbookJsonPath, JSON.stringify(runbook, null, 2), "utf8");

	const markdown: string[] = [
		"# KeepSidian Live E2E Runbook",
		"",
		`- Status: ${status}`,
		`- Started: ${String(runMetadata.startedAt ?? "")}`,
		`- Finished: ${runbook.finishedAt}`,
		`- Vault: ${vaultPath}`,
		`- Server: ${serverUrl}`,
		`- Subscription mode: ${subscriptionMode}`,
		`- Execute sync: ${executeSync}`,
		`- Save location: ${saveLocation}`,
		"",
	];

	for (const scenario of scenarioRecords) {
		markdown.push(`## ${scenario.title}`);
		markdown.push("");
		markdown.push(`- Status: ${scenario.status}`);
		markdown.push(`- Started: ${scenario.startedAt}`);
		if (scenario.finishedAt) {
			markdown.push(`- Finished: ${scenario.finishedAt}`);
		}
		if (scenario.details) {
			markdown.push(`- Details: ${scenario.details}`);
		}
		markdown.push("");
		for (const step of scenario.steps) {
			markdown.push(
				`- [${step.status === "passed" ? "x" : step.status === "skipped" ? "-" : " "}] ${step.title}`
			);
			if (step.details) {
				markdown.push(`  - ${step.details}`);
			}
			if (step.screenshot) {
				markdown.push(`  - Screenshot: ${path.relative(outputDir, step.screenshot)}`);
			}
		}
		markdown.push("");
	}

	await fs.writeFile(runbookMarkdownPath, `${markdown.join("\n")}\n`, "utf8");
}

describe("KeepSidian live sync center scenario matrix", function () {
	before(async () => {
		runMetadata.startedAt = new Date().toISOString();
		await ensureOutputDir();
		await liveBrowser.reloadObsidian({ vault: vaultPath });
		if (typeof liveBrowser.setWindowSize === "function") {
			try {
				await liveBrowser.setWindowSize(1600, 1200);
			} catch {
				// The Electron target may reject resize in some environments.
			}
		}
	});

	it("covers the requested live sync dimensions", async () => {
		const pluginLoaded = await liveBrowser.execute(() => {
			type ObsidianWindow = Window & {
				app?: {
					plugins?: { getPlugin?: (id: string) => unknown };
				};
			};

			return Boolean((window as ObsidianWindow).app?.plugins?.getPlugin?.("keepsidian"));
		});
		requireCondition(pluginLoaded, "KeepSidian plugin is not loaded in the test vault");

		const credentials = await ensureCredentials();
		runMetadata.email = credentials.email;
		runMetadata.tokenLength = String(credentials.tokenLength);
		const corpus = await readPreflightCorpus();
		const context: ScenarioContext = {
			subscriptionMode,
			corpus,
			saveLocation,
			absoluteSaveLocation,
		};

		await resetPluginState();
		await forceSubscription(subscriptionMode);

		const scenarios = subscriptionMode === "active" ? activeScenarios : inactiveScenarios;
		const failures: string[] = [];

		for (const scenario of scenarios) {
			beginScenario(scenario);
			try {
				await scenario.run(context);
				finishScenario(currentScenario?.status ?? "passed");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				failures.push(`${scenario.id}: ${message}`);
				await noteScenarioStep("scenario-failed", "Scenario failed", "failed", message, "failed");
				finishScenario("failed", message);
			} finally {
				await pluginAction<ModalSnapshot>("close-sync-center");
			}
		}

		if (failures.length > 0) {
			throw new Error(failures.join("\n"));
		}
	});

	after(async function () {
		const failed = this.currentTest?.state === "failed" || scenarioRecords.some((scenario) => scenario.status === "failed");
		await writeRunbook(failed ? "failed" : "passed");
	});
});
