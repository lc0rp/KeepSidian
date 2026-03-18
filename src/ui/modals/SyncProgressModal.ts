import { App, Modal } from "obsidian";
import type { DownloadScope, DownloadScopeKind, LastSyncSummary, SyncMode, SyncPlan, SyncPlanEntry } from "@types";
import type {
	PreparedSyncPlan,
	RunPreparedSyncPlanResult,
	SyncPlanBuildCallbacks,
	SyncPlanRunCallbacks,
} from "@app/main-sync-flows";
import { formatModalSummary } from "@app/sync-status";

interface CreateElOptions {
	text?: string;
	cls?: string | string[];
}

type MaybeObsidianElement = HTMLElement & {
	empty?: () => void;
	createEl?: <K extends keyof HTMLElementTagNameMap>(tagName: K, options?: CreateElOptions) => HTMLElementTagNameMap[K];
	setText?: (text: string) => void;
};

interface TwoWayGateState {
	allowed: boolean;
	reasons: string[];
}

interface SyncProgressModalOptions {
	buildSyncPlan: (
		mode: SyncMode,
		callbacks?: SyncPlanBuildCallbacks,
		downloadScope?: DownloadScope
	) => Promise<PreparedSyncPlan | null>;
	runSyncPlan: (preparedPlan: PreparedSyncPlan, callbacks?: SyncPlanRunCallbacks) => Promise<RunPreparedSyncPlanResult>;
	onOpenSyncLog: () => void | Promise<void>;
	onClose?: () => void;
	getTwoWayGate: () => TwoWayGateState;
	getLastSuccessfulDownloadDate: () => string | undefined;
	openTwoWaySettings: () => void;
	getCurrentMode: () => SyncMode | null;
	getCurrentPhaseLabel: () => string | null;
	isSupporterActive: () => Promise<boolean>;
	renderImportOptions: (containerEl: HTMLElement, isActive: boolean) => void | Promise<void>;
}

type ModalSurface = "setup" | "review" | "running" | "result";
type ChipKey =
	| "notes"
	| "create"
	| "merge"
	| "overwrite"
	| "upload"
	| "conflict-copy"
	| "already-up-to-date"
	| "unchecked";
type EntryRunState = "pending" | "done" | "failed" | "unchecked" | "instant";

interface ExecutionSnapshot {
	plan: SyncPlan;
	entryStates: Map<string, EntryRunState>;
}

interface ChipRenderState {
	key: ChipKey;
	label: string;
	numerator?: number;
	denominator?: number;
	count?: number;
	isActive: boolean;
}

interface ModalAlertState {
	title: string;
	message: string;
}

const CHIP_ORDER: ChipKey[] = [
	"notes",
	"create",
	"merge",
	"overwrite",
	"upload",
	"conflict-copy",
	"already-up-to-date",
	"unchecked",
];

const clearElement = (element: HTMLElement) => {
	const maybeObsidianElement = element as MaybeObsidianElement;
	if (typeof maybeObsidianElement.empty === "function") {
		maybeObsidianElement.empty();
		return;
	}
	element.innerHTML = "";
};

const createChild = <K extends keyof HTMLElementTagNameMap>(
	parent: HTMLElement,
	tagName: K,
	options?: CreateElOptions
): HTMLElementTagNameMap[K] => {
	const maybeObsidianParent = parent as MaybeObsidianElement;
	if (typeof maybeObsidianParent.createEl === "function") {
		return maybeObsidianParent.createEl(tagName, options);
	}
	const element = document.createElement(tagName);
	if (options?.text) {
		element.textContent = options.text;
	}
	if (options?.cls) {
		const classes = Array.isArray(options.cls) ? options.cls : [options.cls];
		for (const className of classes) {
			element.classList.add(className);
		}
	}
	parent.appendChild(element);
	return element;
};

function modeLabel(mode: SyncMode): string {
	switch (mode) {
		case "push":
			return "Upload";
		case "two-way":
			return "Two-way sync";
		case "import":
		default:
			return "Download";
	}
}

function modeUsesDownload(mode: SyncMode): boolean {
	return mode !== "push";
}

function modeRequiresTwoWayGate(mode: SyncMode): boolean {
	return mode === "push" || mode === "two-way";
}

function formatGeneratedAt(timestamp: number): string {
	try {
		return new Date(timestamp).toLocaleString();
	} catch {
		return new Date(timestamp).toISOString();
	}
}

function formatScopeTimestamp(isoString: string): string {
	try {
		return new Date(isoString).toLocaleString();
	} catch {
		return isoString;
	}
}

function toDatetimeLocalValue(isoString: string): string {
	const parsed = new Date(isoString);
	if (Number.isNaN(parsed.getTime())) {
		return "";
	}

	const offsetMs = parsed.getTimezoneOffset() * 60_000;
	return new Date(parsed.getTime() - offsetMs).toISOString().slice(0, 16);
}

function parseCustomScopeInput(value: string): { iso?: string; error?: string } {
	if (!value.trim()) {
		return {
			error: "Choose a custom date.",
		};
	}

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return {
			error: "Choose a valid custom date.",
		};
	}

	if (parsed.getTime() > Date.now()) {
		return {
			error: "Custom date must be in the past.",
		};
	}

	return { iso: parsed.toISOString() };
}

function clonePlan(plan: SyncPlan): SyncPlan {
	return {
		...plan,
		counts: { ...plan.counts },
		entries: plan.entries.map((entry) => ({
			...entry,
			meta: entry.meta ? { ...entry.meta } : undefined,
		})),
	};
}

function getChipKeyForEntry(entry: SyncPlanEntry): ChipKey {
	switch (entry.action) {
		case "create":
			return "create";
		case "merge":
			return "merge";
		case "overwrite":
			return "overwrite";
		case "upload":
			return "upload";
		case "conflict-copy":
		case "skipped-conflict-copy":
			return "conflict-copy";
		case "skipped-identical":
		case "skipped-up-to-date":
		default:
			return "already-up-to-date";
	}
}

function getReviewChipLabel(key: ChipKey): string {
	switch (key) {
		case "notes":
			return "Notes";
		case "create":
			return "Create";
		case "merge":
			return "Merge";
		case "overwrite":
			return "Overwrite";
		case "upload":
			return "Upload";
		case "conflict-copy":
			return "Conflict copy";
		case "already-up-to-date":
			return "Already up to date";
		case "unchecked":
			return "Unchecked";
	}
}

function getExecutionChipLabel(key: ChipKey): string {
	switch (key) {
		case "notes":
			return "Notes";
		case "create":
			return "Created";
		case "merge":
			return "Merged";
		case "overwrite":
			return "Overwritten";
		case "upload":
			return "Uploaded";
		case "conflict-copy":
			return "Conflict copy";
		case "already-up-to-date":
			return "Already up to date";
		case "unchecked":
			return "Unchecked";
	}
}

function getFriendlySyncCenterError(error: unknown, context: "review" | "run"): ModalAlertState {
	const rawMessage =
		error instanceof Error && error.message ? error.message : typeof error === "string" ? error : "Unknown error";
	const normalizedMessage = rawMessage.toLowerCase();
	const looksLikeConnectionProblem =
		normalizedMessage.includes("err_connection_refused") ||
		normalizedMessage.includes("failed to fetch") ||
		normalizedMessage.includes("networkerror") ||
		normalizedMessage.includes("network error") ||
		normalizedMessage.includes("econnrefused") ||
		normalizedMessage.includes("enotfound") ||
		normalizedMessage.includes("timed out") ||
		normalizedMessage.includes("etimedout");

	if (looksLikeConnectionProblem) {
		return {
			title: context === "review" ? "Couldn’t prepare the sync review" : "Couldn’t finish the sync",
			message:
				"The KeepSidian server could not be reached. Check your connection or make sure the sync server is running, then try again.",
		};
	}

	return {
		title: context === "review" ? "Couldn’t prepare the sync review" : "Couldn’t finish the sync",
		message: rawMessage || "An unexpected error occurred.",
	};
}

function getSetupPrimaryButtonLabel(isGeneratingReview: boolean, processed: number, total?: number): string {
	if (!isGeneratingReview) {
		return "Start sync";
	}
	if (typeof total === "number" && total > 0 && processed >= total) {
		return "Downloaded, please wait ...";
	}
	return "Preparing plan...";
}

function getPlanTitle(plan: SyncPlan): string {
	return plan.stage === "upload" ? "Review upload plan" : "Review download plan";
}

function getRunningTitle(plan: SyncPlan): string {
	return plan.stage === "upload" ? "Running upload plan" : "Running download plan";
}

function getResultTitle(plan: SyncPlan, success: boolean | null): string {
	if (success === false) {
		return plan.stage === "upload" ? "Upload failed" : "Download failed";
	}
	return plan.stage === "upload" ? "Upload complete" : "Download complete";
}

function getRuntimeStatusLabel(entry: SyncPlanEntry, state: EntryRunState): string {
	if (state === "unchecked") {
		return "Unchecked";
	}
	if (state === "failed") {
		return "Failed";
	}
	if (state === "pending") {
		return "Pending";
	}
	return getExecutionChipLabel(getChipKeyForEntry(entry));
}

function isInstantEntry(entry: SyncPlanEntry): boolean {
	if (!entry.selectable) {
		return true;
	}
	return getChipKeyForEntry(entry) === "conflict-copy";
}

export class SyncProgressModal extends Modal {
	private options: SyncProgressModalOptions;
	private selectedMode: SyncMode = "import";
	private downloadScopeKind: DownloadScopeKind = "last-sync";
	private customSinceInput = "";
	private showSyncOptions = false;
	private isSyncing = false;
	private isGeneratingReview = false;
	private processed = 0;
	private total: number | undefined;
	private lastResult: { success: boolean; processed: number } | null = null;
	private summary: LastSyncSummary | null = null;
	private preparedPlan: PreparedSyncPlan | null = null;
	private executionSnapshot: ExecutionSnapshot | null = null;
	private showExecutionResult = false;
	private reviewFilterKey: ChipKey = "notes";
	private planBuildProcessed = 0;
	private planBuildTotal: number | undefined;
	private modalAlert: ModalAlertState | null = null;
	private renderVersion = 0;

	constructor(app: App, options: SyncProgressModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen() {
		void this.refreshUI();
	}

	onClose() {
		clearElement(this.contentEl);
		this.options.onClose?.();
	}

	setSelectedMode(mode: SyncMode) {
		if (this.selectedMode === mode) {
			return;
		}
		this.selectedMode = mode;
		this.preparedPlan = null;
		this.executionSnapshot = null;
		this.showExecutionResult = false;
		this.reviewFilterKey = "notes";
		this.modalAlert = null;
		void this.refreshUI();
	}

	private getLastSuccessfulDownloadDate(): string | undefined {
		return this.options.getLastSuccessfulDownloadDate();
	}

	private setDownloadScopeKind(kind: DownloadScopeKind) {
		if (this.downloadScopeKind === kind) {
			return;
		}

		this.downloadScopeKind = kind;
		this.modalAlert = null;
		if (kind === "custom-since" && !this.customSinceInput) {
			const lastSuccessfulDownloadDate = this.getLastSuccessfulDownloadDate();
			if (lastSuccessfulDownloadDate) {
				this.customSinceInput = toDatetimeLocalValue(lastSuccessfulDownloadDate);
			}
		}
		void this.refreshUI();
	}

	private getDownloadScope(): DownloadScope {
		if (this.downloadScopeKind === "all") {
			return { kind: "all" };
		}

		if (this.downloadScopeKind === "custom-since") {
			const parsed = parseCustomScopeInput(this.customSinceInput);
			if (!parsed.iso) {
				throw new Error(parsed.error ?? "Choose a custom date.");
			}
			return {
				kind: "custom-since",
				since: parsed.iso,
			};
		}

		return { kind: "last-sync" };
	}

	private getCustomScopeError(): string | null {
		if (this.downloadScopeKind !== "custom-since") {
			return null;
		}
		return parseCustomScopeInput(this.customSinceInput).error ?? null;
	}

	async beginReview(mode = this.selectedMode) {
		if (this.isSyncing || this.isGeneratingReview) {
			return;
		}
		this.selectedMode = mode;
		this.isGeneratingReview = true;
		this.preparedPlan = null;
		this.executionSnapshot = null;
		this.showExecutionResult = false;
		this.lastResult = null;
		this.planBuildProcessed = 0;
		this.planBuildTotal = undefined;
		this.reviewFilterKey = "notes";
		this.modalAlert = null;
		await this.refreshUI();
		try {
			const downloadScope = modeUsesDownload(mode) ? this.getDownloadScope() : undefined;
			const preparedPlan = await this.options.buildSyncPlan(
				mode,
				{
					setTotalNotes: (total) => {
						this.planBuildTotal = total;
						void this.refreshUI();
					},
					reportPlanProgress: (processed, total) => {
						this.planBuildProcessed = processed;
						if (typeof total === "number" && total > 0) {
							this.planBuildTotal = total;
						}
						void this.refreshUI();
					},
				},
				downloadScope
			);
			if (preparedPlan) {
				preparedPlan.plan.title = getPlanTitle(preparedPlan.plan);
				this.preparedPlan = preparedPlan;
			}
		} catch (error) {
			this.modalAlert = getFriendlySyncCenterError(error, "review");
		} finally {
			this.isGeneratingReview = false;
			await this.refreshUI();
		}
	}

	private async runReviewedPlan() {
		if (!this.preparedPlan || this.isSyncing) {
			return;
		}

		this.initializeExecutionSnapshot(this.preparedPlan.plan);
		this.isSyncing = true;
		this.showExecutionResult = false;
		this.modalAlert = null;
		await this.refreshUI();

		try {
			const result = await this.options.runSyncPlan(this.preparedPlan, {
				onEntrySettled: (entryId: string, success: boolean) => {
					this.handleEntrySettled(entryId, success);
				},
			});
			if (result.nextPlan) {
				result.nextPlan.plan.title = getPlanTitle(result.nextPlan.plan);
				this.preparedPlan = result.nextPlan;
				this.executionSnapshot = null;
				this.showExecutionResult = false;
				this.reviewFilterKey = "notes";
				return;
			}
			this.preparedPlan = null;
			this.showExecutionResult = true;
		} catch (error) {
			this.modalAlert = getFriendlySyncCenterError(error, "run");
			this.showExecutionResult = false;
		} finally {
			this.isSyncing = false;
			await this.refreshUI();
		}
	}

	setProgress(processed: number, total?: number) {
		this.processed = processed;
		this.total = total;
		this.summary = null;
		this.lastResult = null;
		this.modalAlert = null;
		void this.refreshUI();
	}

	setComplete(success: boolean, processed: number) {
		this.lastResult = { success, processed };
		if (this.executionSnapshot) {
			this.showExecutionResult = true;
		}
		if (success) {
			this.modalAlert = null;
		}
		void this.refreshUI();
	}

	setIdleSummary(summary: LastSyncSummary | null) {
		this.summary = summary;
		if (!this.showExecutionResult) {
			this.lastResult = null;
		}
		if (summary?.success) {
			this.modalAlert = null;
		}
		void this.refreshUI();
	}

	private initializeExecutionSnapshot(plan: SyncPlan) {
		const snapshotPlan = clonePlan(plan);
		const entryStates = new Map<string, EntryRunState>();
		for (const entry of snapshotPlan.entries) {
			if (entry.selectable && !entry.selected) {
				entryStates.set(entry.id, "unchecked");
				continue;
			}
			if (isInstantEntry(entry)) {
				entryStates.set(entry.id, "instant");
				continue;
			}
			entryStates.set(entry.id, "pending");
		}
		this.executionSnapshot = {
			plan: snapshotPlan,
			entryStates,
		};
		this.reviewFilterKey = "notes";
	}

	private handleEntrySettled(entryId: string, success: boolean) {
		if (!this.executionSnapshot) {
			return;
		}
		const current = this.executionSnapshot.entryStates.get(entryId);
		if (!current || current === "unchecked" || current === "instant") {
			return;
		}
		this.executionSnapshot.entryStates.set(entryId, success ? "done" : "failed");
		void this.refreshUI();
	}

	private getSurface(): ModalSurface {
		if (this.isSyncing && this.executionSnapshot) {
			return "running";
		}
		if (this.preparedPlan) {
			return "review";
		}
		if (this.executionSnapshot && this.showExecutionResult) {
			return "result";
		}
		return "setup";
	}

	private async refreshUI() {
		const renderVersion = ++this.renderVersion;
		const surface = this.getSurface();
		clearElement(this.contentEl);
		this.contentEl.className = "keepsidian-modal";
		this.contentEl.classList.add(surface === "setup" ? "keepsidian-modal--compact" : "keepsidian-modal--plan");
		this.modalEl.classList.remove("keepsidian-modal-shell--compact", "keepsidian-modal-shell--plan");
		this.modalEl.classList.add(
			surface === "setup" ? "keepsidian-modal-shell--compact" : "keepsidian-modal-shell--plan"
		);

		const titleEl = createChild(this.contentEl, "h2", { text: this.getTitle(surface) });
		titleEl.classList.add("keepsidian-modal-title");

		this.renderStepper(surface);

		const statusEl = createChild(this.contentEl, "div", {
			text: this.getStatusCopy(surface),
		});
		statusEl.classList.add("keepsidian-modal-status");
		statusEl.setAttribute("aria-live", "polite");

		if (this.modalAlert) {
			this.renderAlert(this.modalAlert);
		}

		if (surface === "setup") {
			await this.renderSetupSurface(renderVersion);
			return;
		}

		this.renderPlanSurface(surface);
	}

	private renderAlert(alert: ModalAlertState) {
		const alertEl = createChild(this.contentEl, "div");
		alertEl.classList.add("keepsidian-modal-alert");
		alertEl.setAttribute("role", "alert");
		const titleEl = createChild(alertEl, "div", { text: alert.title });
		titleEl.classList.add("keepsidian-modal-alert-title");
		const messageEl = createChild(alertEl, "div", { text: alert.message });
		messageEl.classList.add("keepsidian-modal-alert-message");
	}

	private getTitle(surface: ModalSurface): string {
		if (surface === "setup") {
			return "Sync center";
		}
		const plan = this.preparedPlan?.plan ?? this.executionSnapshot?.plan;
		if (!plan) {
			return "Sync plan";
		}
		if (surface === "review") {
			return getPlanTitle(plan);
		}
		if (surface === "running") {
			return getRunningTitle(plan);
		}
		return getResultTitle(plan, this.lastResult?.success ?? null);
	}

	private getStatusCopy(surface: ModalSurface): string {
		if (surface === "setup") {
			if (this.isGeneratingReview) {
				if (typeof this.planBuildTotal === "number" && this.planBuildTotal > 0) {
					return `Prepared ${this.planBuildProcessed} of ${this.planBuildTotal} notes for review.`;
				}
				return `Preparing '${modeLabel(this.selectedMode).toLowerCase()}' plan...`;
			}
			if (this.isSyncing) {
				const phaseLabel = this.options.getCurrentPhaseLabel() ?? "Syncing";
				if (typeof this.total === "number" && this.total > 0) {
					return `${phaseLabel}: ${this.processed}/${this.total}`;
				}
				return `${phaseLabel}: ${this.processed}`;
			}
			if (this.summary) {
				return formatModalSummary(this.summary);
			}
			return "Start or customize sync.";
		}

		if (surface === "review" && this.preparedPlan) {
			return `Generated ${formatGeneratedAt(this.preparedPlan.plan.generatedAt)}. Review the plan below.`;
		}

		if ((surface === "running" || surface === "result") && this.executionSnapshot) {
			const selectedCount = this.executionSnapshot.plan.entries.filter(
				(entry) => entry.selectable && entry.selected
			).length;
			const handledCount = this.getExecutionHandledCount();
			const pendingCount = Math.max(0, selectedCount - handledCount);
			if (surface === "running") {
				return `${selectedCount} selected. ${pendingCount} pending.`;
			}
			if (this.summary) {
				return formatModalSummary(this.summary);
			}
			return this.lastResult?.success ? `Sync complete. Processed ${this.lastResult.processed} notes.` : "Sync failed.";
		}

		return "";
	}

	private renderStepper(surface: ModalSurface) {
		const stepperEl = createChild(this.contentEl, "div");
		stepperEl.classList.add("keepsidian-sync-stepper");

		const firstProgress = this.getStartStepProgress(surface);
		const secondProgress = this.getReviewStepProgress(surface);
		const isReviewReached = surface === "review" || surface === "running" || surface === "result";
		const isDoneReached = surface === "result";
		const steps: Array<{ label: string; state: "pending" | "active" | "complete" }> = [
			{
				label: "Start",
				state: surface === "setup" && !isReviewReached ? "active" : "complete",
			},
			{
				label: "Review",
				state: surface === "review" || surface === "running" ? "active" : isDoneReached ? "complete" : "pending",
			},
			{
				label: "Done",
				state: isDoneReached ? "active" : "pending",
			},
		];

		steps.forEach((step, index) => {
			const stepEl = createChild(stepperEl, "div");
			stepEl.classList.add("keepsidian-sync-stepper-step", `is-${step.state}`);
			const nodeEl = createChild(stepEl, "div");
			nodeEl.classList.add("keepsidian-sync-stepper-node");
			const labelEl = createChild(stepEl, "div", { text: step.label });
			labelEl.classList.add("keepsidian-sync-stepper-label");
			if (index < steps.length - 1) {
				const connectorEl = createChild(stepperEl, "div");
				connectorEl.classList.add("keepsidian-sync-stepper-connector");
				const fillEl = createChild(connectorEl, "div");
				fillEl.classList.add("keepsidian-sync-stepper-connector-fill");
				const progress = index === 0 ? firstProgress : secondProgress;
				fillEl.style.width = `${progress}%`;
				if (surface === "setup" && this.isGeneratingReview && index === 0 && firstProgress === 0) {
					connectorEl.classList.add("is-indeterminate");
				}
			}
		});
	}

	private getStartStepProgress(surface: ModalSurface): number {
		if (surface !== "setup") {
			return 100;
		}
		if (!this.isGeneratingReview) {
			return 0;
		}
		if (typeof this.planBuildTotal === "number" && this.planBuildTotal > 0) {
			return Math.max(0, Math.min(100, Math.round((this.planBuildProcessed / this.planBuildTotal) * 100)));
		}
		return 0;
	}

	private getReviewStepProgress(surface: ModalSurface): number {
		if (surface === "result") {
			return 100;
		}
		if (surface !== "running" || !this.executionSnapshot) {
			return 0;
		}
		const totalEntries = this.executionSnapshot.plan.entries.length;
		if (totalEntries <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, Math.round((this.getExecutionHandledCount() / totalEntries) * 100)));
	}

	private async renderSetupSurface(renderVersion: number) {
		const actionsEl = createChild(this.contentEl, "div");
		actionsEl.classList.add("keepsidian-modal-actions");

		const startButton = this.createActionButton(
			actionsEl,
			getSetupPrimaryButtonLabel(this.isGeneratingReview, this.planBuildProcessed, this.planBuildTotal),
			async () => {
				await this.beginReview();
			}
		);
		startButton.classList.add("mod-cta", "keepsidian-modal-action--primary");
		startButton.disabled = this.isGeneratingReview || this.isSyncing;

		const openLogButton = this.createActionButton(actionsEl, "Open sync log", async () => {
			await this.options.onOpenSyncLog();
		});
		openLogButton.classList.add("keepsidian-modal-action--open-log");
		openLogButton.disabled = this.isGeneratingReview;

		const syncOptionsButton = this.createActionButton(actionsEl, "Customize sync", async () => {
			this.showSyncOptions = !this.showSyncOptions;
			await this.refreshUI();
		});
		syncOptionsButton.classList.add("keepsidian-modal-action--sync-options", "keepsidian-modal-action--dropdown");
		syncOptionsButton.disabled = this.isGeneratingReview;
		syncOptionsButton.setAttribute("aria-expanded", this.showSyncOptions ? "true" : "false");
		syncOptionsButton.classList.toggle("is-expanded", this.showSyncOptions);

		const syncOptionsContainerEl = createChild(this.contentEl, "div");
		syncOptionsContainerEl.classList.add("keepsidian-sync-center-options");
		syncOptionsContainerEl.hidden = !this.showSyncOptions;

		if (this.showSyncOptions) {
			const modeSectionEl = createChild(syncOptionsContainerEl, "div");
			modeSectionEl.classList.add("keepsidian-sync-center-mode-section");
			const modeLabelEl = createChild(modeSectionEl, "div", { text: "Mode" });
			modeLabelEl.classList.add("keepsidian-sync-center-mode-label");
			const modePickerEl = createChild(syncOptionsContainerEl, "div");
			modePickerEl.classList.add("keepsidian-sync-center-modes");
			modePickerEl.setAttribute("role", "radiogroup");
			modePickerEl.setAttribute("aria-label", "Sync mode");
			modeSectionEl.appendChild(modePickerEl);

			(["import", "push", "two-way"] as SyncMode[]).forEach((mode) => {
				const button = this.createActionButton(modePickerEl, "", async () => {
					this.setSelectedMode(mode);
				});
				button.classList.add("keepsidian-sync-center-mode-button");
				button.classList.toggle("is-selected", this.selectedMode === mode);
				button.setAttribute("role", "radio");
				button.setAttribute("aria-checked", this.selectedMode === mode ? "true" : "false");
				const indicator = createChild(button, "span");
				indicator.classList.add("keepsidian-sync-center-mode-indicator");
				indicator.setAttribute("aria-hidden", "true");
				const labelEl = createChild(button, "span", { text: modeLabel(mode) });
				labelEl.classList.add("keepsidian-sync-center-mode-text");
			});

			if (modeUsesDownload(this.selectedMode)) {
				this.renderDownloadScopeSection(syncOptionsContainerEl);
				const isSupporterActive = await this.options.isSupporterActive();
				if (renderVersion !== this.renderVersion) {
					return;
				}
				if (isSupporterActive) {
					const importOptionsContainerEl = createChild(syncOptionsContainerEl, "div");
					importOptionsContainerEl.classList.add("keepsidian-sync-center-download-options");
					const heading = createChild(importOptionsContainerEl, "h3", {
						text: "Download options",
					});
					heading.classList.add("keepsidian-sync-center-download-options-title");
					const copy = createChild(importOptionsContainerEl, "p", {
						text: "Thanks for supporting KeepSidian! Customize your download below.",
					});
					copy.classList.add("keepsidian-sync-center-download-options-copy");
					const optionsBody = createChild(importOptionsContainerEl, "div");
					optionsBody.classList.add("keepsidian-sync-center-download-options-body");
					await this.options.renderImportOptions(optionsBody, true);
					if (renderVersion !== this.renderVersion) {
						return;
					}
				}
			}

			if (modeRequiresTwoWayGate(this.selectedMode)) {
				const gate = this.options.getTwoWayGate();
				if (!gate.allowed) {
					const gateMessageEl = createChild(syncOptionsContainerEl, "div");
					gateMessageEl.classList.add("keepsidian-modal-gate-message");
					const heading = createChild(gateMessageEl, "div", {
						text: "⚠️ Uploads are a beta feature. Follow the instructions below to enable them.",
					});
					heading.classList.add("keepsidian-modal-gate-heading");
					const list = createChild(gateMessageEl, "ul");
					for (const reason of gate.reasons) {
						createChild(list, "li", { text: reason });
					}
					const openSettings = createChild(gateMessageEl, "button", {
						text: "Open beta settings",
					});
					openSettings.type = "button";
					openSettings.addEventListener("click", () => {
						this.options.openTwoWaySettings();
					});
				}
			}
		}

		const closeButton = createChild(this.contentEl, "button", { text: "Close" });
		closeButton.type = "button";
		closeButton.classList.add("keepsidian-modal-close");
		closeButton.addEventListener("click", () => this.close());
	}

	private renderDownloadScopeSection(containerEl: HTMLElement) {
		const sectionEl = createChild(containerEl, "div");
		sectionEl.classList.add("keepsidian-sync-center-mode-section", "keepsidian-sync-center-scope-section");

		const heading = createChild(sectionEl, "div", { text: "Start date" });
		heading.classList.add("keepsidian-sync-center-mode-label");

		const optionsEl = createChild(sectionEl, "div");
		optionsEl.classList.add("keepsidian-sync-center-modes");
		optionsEl.setAttribute("role", "radiogroup");
		optionsEl.setAttribute("aria-label", "Start date");

		const lastSuccessfulDownloadDate = this.getLastSuccessfulDownloadDate();
		const lastSyncDescription = lastSuccessfulDownloadDate
			? `Last sync: ${formatScopeTimestamp(lastSuccessfulDownloadDate)}.`
			: "None yet.";

		this.renderDownloadScopeOption(optionsEl, "Last successful sync", "last-sync", lastSyncDescription);
		this.renderDownloadScopeOption(optionsEl, "All dates", "all", "");
		this.renderDownloadScopeOption(optionsEl, "Custom", "custom-since", "");

		if (this.downloadScopeKind === "custom-since") {
			const inputWrap = createChild(sectionEl, "label");
			inputWrap.classList.add("keepsidian-sync-center-scope-input-wrap");

			const input = createChild(inputWrap, "input");
			input.type = "datetime-local";
			input.value = this.customSinceInput;
			input.classList.add("keepsidian-sync-center-scope-input");
			input.addEventListener("input", () => {
				this.customSinceInput = input.value;
				this.modalAlert = null;
			});
			input.addEventListener("change", () => {
				this.customSinceInput = input.value;
				this.modalAlert = null;
				void this.refreshUI();
			});

			const error = this.getCustomScopeError();
			const helperText = error ?? "Notes changed after this date will be included.";
			const helper = createChild(sectionEl, "div", { text: helperText });
			helper.classList.add("keepsidian-sync-center-scope-helper");
			if (error) {
				helper.classList.add("is-warning");
			}
		}
	}

	private renderDownloadScopeOption(
		containerEl: HTMLElement,
		label: string,
		kind: DownloadScopeKind,
		description: string
	) {
		const button = this.createActionButton(containerEl, "", async () => {
			this.setDownloadScopeKind(kind);
		});
		button.classList.add("keepsidian-sync-center-mode-button", "keepsidian-sync-center-scope-button");
		button.classList.toggle("is-selected", this.downloadScopeKind === kind);
		button.setAttribute("role", "radio");
		button.setAttribute("aria-checked", this.downloadScopeKind === kind ? "true" : "false");

		const indicator = createChild(button, "span");
		indicator.classList.add("keepsidian-sync-center-mode-indicator");
		indicator.setAttribute("aria-hidden", "true");

		const body = createChild(button, "span");
		body.classList.add("keepsidian-sync-center-scope-option-body");

		const title = createChild(body, "span", { text: label });
		title.classList.add("keepsidian-sync-center-mode-text");

		const copy = createChild(body, "span", { text: description });
		copy.classList.add("keepsidian-sync-center-scope-option-copy");
	}

	private renderPlanSurface(surface: "review" | "running" | "result") {
		const actionsEl = createChild(this.contentEl, "div");
		actionsEl.classList.add("keepsidian-modal-actions");

		if (surface === "review") {
			const backButton = this.createActionButton(actionsEl, "◀︎ Back", async () => {
				this.preparedPlan = null;
				this.executionSnapshot = null;
				this.showExecutionResult = false;
				this.reviewFilterKey = "notes";
				await this.refreshUI();
			});
			backButton.classList.add("keepsidian-modal-action--back");

			const refreshButton = this.createActionButton(actionsEl, "↻ Refresh", async () => {
				await this.refreshCurrentReview();
			});
			refreshButton.classList.add("keepsidian-modal-action--refresh-review");

			const runButton = this.createActionButton(actionsEl, "Execute ▶︎", async () => {
				await this.runReviewedPlan();
			});
			runButton.classList.add("mod-cta", "keepsidian-modal-action--primary");
			runButton.disabled =
				this.isGeneratingReview ||
				!this.preparedPlan ||
				this.preparedPlan.plan.entries.every((entry) => !entry.selectable || !entry.selected);
		}

		const panelEl = createChild(this.contentEl, "div");
		panelEl.classList.add("keepsidian-sync-plan");
		const summaryEl = createChild(panelEl, "div");
		summaryEl.classList.add("keepsidian-sync-plan-summary");

		if (surface === "review" && this.preparedPlan) {
			const reviewCopy = createChild(summaryEl, "div", {
				text: `${this.preparedPlan.plan.actionableCount} changes found.`,
			});
			reviewCopy.classList.add("keepsidian-sync-plan-summary-copy");
		}

		if ((surface === "running" || surface === "result") && this.executionSnapshot) {
			const selectedCount = this.executionSnapshot.plan.entries.filter(
				(entry) => entry.selectable && entry.selected
			).length;
			const handledCount = this.getExecutionHandledCount();
			const runtimeCopy = createChild(summaryEl, "div", {
				text:
					surface === "running"
						? `${handledCount} of ${selectedCount} selected notes dealt with.`
						: `${handledCount} of ${selectedCount} selected notes dealt with.`,
			});
			runtimeCopy.classList.add("keepsidian-sync-plan-summary-copy");
		}

		this.renderChips(summaryEl, surface);
		this.renderSelectionSummary(panelEl, surface);
		this.renderEntries(panelEl, surface);

		if (surface === "result") {
			const footerEl = createChild(this.contentEl, "div");
			footerEl.classList.add("keepsidian-modal-actions");
			const openLogButton = this.createActionButton(footerEl, "Open sync log", async () => {
				await this.options.onOpenSyncLog();
			});
			openLogButton.classList.add("keepsidian-modal-action--open-log");
			const closeButton = this.createActionButton(footerEl, "Close", async () => {
				this.close();
			});
			closeButton.classList.add("mod-cta", "keepsidian-modal-action--primary");
		}
	}

	private async refreshCurrentReview() {
		if (!this.preparedPlan) {
			await this.beginReview();
			return;
		}

		if (this.preparedPlan.mode === "two-way" && this.preparedPlan.stage === "upload") {
			const refreshedPlan = await this.options.buildSyncPlan("push");
			if (!refreshedPlan) {
				return;
			}
			refreshedPlan.mode = "two-way";
			refreshedPlan.plan = {
				...refreshedPlan.plan,
				mode: "two-way",
				title: getPlanTitle({
					...refreshedPlan.plan,
					mode: "two-way",
				}),
				entries: refreshedPlan.plan.entries.map((entry) => ({
					...entry,
					mode: "two-way",
				})),
			};
			this.preparedPlan = refreshedPlan;
			this.executionSnapshot = null;
			this.showExecutionResult = false;
			this.reviewFilterKey = "notes";
			await this.refreshUI();
			return;
		}

		await this.beginReview(this.preparedPlan.mode);
	}

	private renderChips(containerEl: HTMLElement, surface: "review" | "running" | "result") {
		const countsEl = createChild(containerEl, "div");
		countsEl.classList.add("keepsidian-sync-plan-counts");
		for (const chip of this.getChipRenderStates(surface)) {
			const chipButton = createChild(countsEl, "button", {
				text:
					typeof chip.count === "number"
						? `${chip.label} ${chip.count}`
						: `${chip.label} ${chip.numerator ?? 0}/${chip.denominator ?? 0}`,
			});
			chipButton.type = "button";
			chipButton.classList.add("keepsidian-sync-plan-chip");
			chipButton.classList.toggle("is-active", chip.isActive);
			chipButton.addEventListener("click", () => {
				this.reviewFilterKey = chip.key;
				void this.refreshUI();
			});
		}
	}

	private renderSelectionSummary(containerEl: HTMLElement, surface: "review" | "running" | "result") {
		if (surface !== "review" || !this.preparedPlan) {
			return;
		}
		const entries = this.preparedPlan.plan.entries;
		const canBulkToggle = entries.some((entry) => entry.selectable && !entry.selectionLocked);
		const selectedCount = entries.filter((entry) => entry.selectable && entry.selected).length;
		const summaryEl = createChild(containerEl, "div");
		summaryEl.classList.add("keepsidian-sync-plan-selection-summary");
		createChild(summaryEl, "div", {
			text: `${selectedCount} of ${this.preparedPlan.plan.actionableCount} changes selected.`,
		});
		if (!canBulkToggle) {
			createChild(summaryEl, "div", {
				text: "Per-note selection is available to project supporters.",
			}).classList.add("keepsidian-sync-plan-selection-caption");
			return;
		}

		const toggleWrap = createChild(summaryEl, "label");
		toggleWrap.classList.add("keepsidian-sync-plan-select-all");
		const checkbox = createChild(toggleWrap, "input");
		checkbox.type = "checkbox";
		const selectableEntries = entries.filter((entry) => entry.selectable && !entry.selectionLocked);
		const selectedSelectableCount = selectableEntries.filter((entry) => entry.selected).length;
		checkbox.checked = selectedSelectableCount > 0 && selectedSelectableCount === selectableEntries.length;
		checkbox.indeterminate = selectedSelectableCount > 0 && selectedSelectableCount < selectableEntries.length;
		checkbox.addEventListener("change", () => {
			for (const entry of selectableEntries) {
				entry.selected = checkbox.checked;
			}
			this.preparedPlan!.plan.selectedCount = this.preparedPlan!.plan.entries.filter(
				(entry) => entry.selectable && entry.selected
			).length;
			void this.refreshUI();
		});
		createChild(toggleWrap, "span", { text: "Select all" });
	}

	private renderEntries(containerEl: HTMLElement, surface: "review" | "running" | "result") {
		const listEl = createChild(containerEl, "div");
		listEl.classList.add("keepsidian-sync-plan-list");
		for (const entry of this.getFilteredEntries(surface)) {
			const row = createChild(listEl, "div");
			row.classList.add("keepsidian-sync-plan-row");
			const chipKey = getChipKeyForEntry(entry);
			row.classList.add(`is-group-${chipKey}`);
			if (surface === "review" && entry.selectable) {
				row.classList.add("is-actionable");
			}

			if (surface === "review") {
				this.renderReviewRow(row, entry);
				continue;
			}

			this.renderExecutionRow(row, entry);
		}
	}

	private renderReviewRow(row: HTMLElement, entry: SyncPlanEntry) {
		if (entry.selectionLocked) {
			row.classList.add("is-locked");
			if (entry.selectionLockedReason) {
				row.setAttribute("title", entry.selectionLockedReason);
			}
		}

		const toggleWrap = createChild(row, "div");
		toggleWrap.classList.add("keepsidian-sync-plan-row-toggle");
		const toggle = createChild(toggleWrap, "input");
		toggle.type = "checkbox";
		toggle.checked = entry.selected;
		toggle.disabled = !entry.selectable || entry.selectionLocked || this.isGeneratingReview;
		if (entry.selectionLockedReason) {
			toggle.title = entry.selectionLockedReason;
		}
		toggle.addEventListener("change", () => {
			entry.selected = toggle.checked;
			if (this.preparedPlan) {
				this.preparedPlan.plan.selectedCount = this.preparedPlan.plan.entries.filter(
					(candidate) => candidate.selectable && candidate.selected
				).length;
			}
			void this.refreshUI();
		});

		const body = createChild(row, "div");
		body.classList.add("keepsidian-sync-plan-row-body");
		this.renderEntryBody(body, entry, entry.label);
	}

	private renderExecutionRow(row: HTMLElement, entry: SyncPlanEntry) {
		if (!this.executionSnapshot) {
			return;
		}
		const state = this.executionSnapshot.entryStates.get(entry.id) ?? "pending";
		row.classList.add(`is-${state}`);
		const statusEl = createChild(row, "div");
		statusEl.classList.add("keepsidian-sync-plan-row-status");
		createChild(statusEl, "span", {
			text:
				state === "done" || state === "instant" ? "✓" : state === "failed" ? "!" : state === "unchecked" ? "–" : "…",
		});

		const body = createChild(row, "div");
		body.classList.add("keepsidian-sync-plan-row-body");
		this.renderEntryBody(body, entry, getRuntimeStatusLabel(entry, state));
	}

	private renderEntryBody(body: HTMLElement, entry: SyncPlanEntry, badgeText: string) {
		const titleLine = createChild(body, "div");
		titleLine.classList.add("keepsidian-sync-plan-row-title-line");
		const title = createChild(titleLine, "div", { text: entry.title });
		title.classList.add("keepsidian-sync-plan-row-title");
		const badge = createChild(titleLine, "span", { text: badgeText });
		badge.classList.add("keepsidian-sync-plan-row-badge");
		const path = createChild(body, "div", { text: entry.path });
		path.classList.add("keepsidian-sync-plan-row-path");
		if (entry.meta?.detail) {
			const detail = createChild(body, "div", { text: entry.meta.detail });
			detail.classList.add("keepsidian-sync-plan-row-detail");
		}
	}

	private getFilteredEntries(surface: "review" | "running" | "result"): SyncPlanEntry[] {
		const entries =
			surface === "review" ? (this.preparedPlan?.plan.entries ?? []) : (this.executionSnapshot?.plan.entries ?? []);
		if (this.reviewFilterKey === "notes") {
			return entries;
		}
		if (surface !== "review" && this.reviewFilterKey === "unchecked") {
			return entries.filter((entry) => this.executionSnapshot?.entryStates.get(entry.id) === "unchecked");
		}
		return entries.filter((entry) => getChipKeyForEntry(entry) === this.reviewFilterKey);
	}

	private getChipRenderStates(surface: "review" | "running" | "result"): ChipRenderState[] {
		return surface === "review" ? this.getReviewChipStates() : this.getExecutionChipStates();
	}

	private getReviewChipStates(): ChipRenderState[] {
		if (!this.preparedPlan) {
			return [];
		}
		const counts = new Map<ChipKey, number>();
		counts.set("notes", this.preparedPlan.plan.entries.length);
		for (const entry of this.preparedPlan.plan.entries) {
			const key = getChipKeyForEntry(entry);
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
		return CHIP_ORDER.filter((key) => (counts.get(key) ?? 0) > 0 || key === "notes").map((key) => ({
			key,
			label: getReviewChipLabel(key),
			count: counts.get(key) ?? 0,
			isActive: this.reviewFilterKey === key,
		}));
	}

	private getExecutionChipStates(): ChipRenderState[] {
		if (!this.executionSnapshot) {
			return [];
		}
		const denominators = new Map<ChipKey, number>();
		const numerators = new Map<ChipKey, number>();
		const entries = this.executionSnapshot.plan.entries;
		denominators.set("notes", entries.length);
		numerators.set("notes", 0);

		for (const entry of entries) {
			const key = getChipKeyForEntry(entry);
			denominators.set(key, (denominators.get(key) ?? 0) + 1);
			const state = this.executionSnapshot.entryStates.get(entry.id) ?? "pending";
			if (state !== "pending") {
				numerators.set(key, (numerators.get(key) ?? 0) + 1);
				numerators.set("notes", (numerators.get("notes") ?? 0) + 1);
			}
		}

		const uncheckedCount = entries.filter(
			(entry) => this.executionSnapshot?.entryStates.get(entry.id) === "unchecked"
		).length;
		if (uncheckedCount > 0) {
			denominators.set("unchecked", uncheckedCount);
			numerators.set("unchecked", uncheckedCount);
		}

		return CHIP_ORDER.filter((key) => (denominators.get(key) ?? 0) > 0 || key === "notes").map((key) => ({
			key,
			label: getExecutionChipLabel(key),
			numerator: numerators.get(key) ?? 0,
			denominator: denominators.get(key) ?? 0,
			isActive: this.reviewFilterKey === key,
		}));
	}

	private getExecutionHandledCount(): number {
		if (!this.executionSnapshot) {
			return 0;
		}
		let handledCount = 0;
		for (const state of this.executionSnapshot.entryStates.values()) {
			if (state !== "pending") {
				handledCount += 1;
			}
		}
		return handledCount;
	}

	private createActionButton(
		container: HTMLElement,
		label: string,
		onClick: () => void | Promise<void>
	): HTMLButtonElement {
		const button = createChild(container, "button", { text: label });
		button.type = "button";
		button.classList.add("keepsidian-modal-action");
		button.addEventListener("click", () => {
			void onClick();
		});
		return button;
	}
}
