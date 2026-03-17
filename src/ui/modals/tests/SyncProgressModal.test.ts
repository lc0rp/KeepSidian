jest.mock("obsidian");

import { App } from "obsidian";
import { SyncProgressModal } from "../SyncProgressModal";
import type { LastSyncSummary, SyncMode } from "../../../types";
import type { PreparedSyncPlan, RunPreparedSyncPlanResult } from "@app/main-sync-flows";
import { createPreparedSyncPlanFixture, createSyncPlanEntryFixture } from "../../../test-utils/fixtures/sync-plan";

describe("SyncProgressModal", () => {
	let app: App;
	let gateState: { allowed: boolean; reasons: string[] };
	let currentMode: SyncMode | null;
	let currentPhaseLabel: string | null;
	let modalOptions: ReturnType<typeof createOptions>;

	function createOptions() {
		const preparedPlan = createPreparedSyncPlanFixture("import", "import", [
			createSyncPlanEntryFixture("create", "Create", {
				id: "create-note",
				title: "Create note",
				path: "Keep/Create note.md",
			}),
			createSyncPlanEntryFixture("skipped-identical", "Skipped: identical", {
				id: "identical-note",
				title: "Identical note",
				path: "Keep/Identical note.md",
				selectable: false,
				selected: false,
			}),
		]);
		const buildSyncPlan = jest.fn().mockResolvedValue(preparedPlan);
		const runSyncPlan = jest.fn().mockResolvedValue({});
		const onOpenSyncLog = jest.fn().mockResolvedValue(undefined);
		const openTwoWaySettings = jest.fn();
		const isSupporterActive = jest.fn().mockResolvedValue(true);
		const renderImportOptions = jest.fn(async (containerEl: HTMLElement, isActive: boolean) => {
			containerEl.createEl("div", {
				text: `Premium options active: ${String(isActive)}`,
			});
		});

		return {
			buildSyncPlan,
			runSyncPlan,
			onOpenSyncLog,
			onClose: jest.fn(),
			getTwoWayGate: () => gateState,
			openTwoWaySettings,
			getCurrentMode: () => currentMode,
			getCurrentPhaseLabel: () => currentPhaseLabel,
			isSupporterActive,
			renderImportOptions,
			preparedPlan,
		};
	}

	function getButton(modal: SyncProgressModal, label: string): HTMLButtonElement {
		const button = Array.from(modal.contentEl.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === label
		);
		expect(button).toBeTruthy();
		return button as HTMLButtonElement;
	}

	function findButton(modal: SyncProgressModal, label: string): HTMLButtonElement | null {
		return (Array.from(modal.contentEl.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === label
		) ?? null) as HTMLButtonElement | null;
	}

	function getRowTitles(modal: SyncProgressModal): string[] {
		return Array.from(modal.contentEl.querySelectorAll(".keepsidian-sync-plan-row-title")).map(
			(element) => element.textContent?.trim() ?? ""
		);
	}

	async function flushUI() {
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
		await Promise.resolve();
	}

	function createDeferredResult() {
		let resolvePromise: (value: RunPreparedSyncPlanResult) => void = () => undefined;
		const promise = new Promise<RunPreparedSyncPlanResult>((resolve) => {
			resolvePromise = resolve;
		});
		return {
			promise,
			resolve: resolvePromise,
		};
	}

	beforeEach(() => {
		app = new App();
		gateState = { allowed: false, reasons: ["Confirm backups"] };
		currentMode = null;
		currentPhaseLabel = null;
		modalOptions = createOptions();
	});

	test("starts in compact setup mode with Start sync and a three-step header", async () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Sync center");
		expect(modal.contentEl.textContent).toContain("Choose sync options, then start sync.");
		expect(modal.contentEl.textContent).toContain("Start");
		expect(modal.contentEl.textContent).toContain("Review");
		expect(modal.contentEl.textContent).toContain("Done");
		expect(getButton(modal, "Start sync")).toBeTruthy();
		expect(getButton(modal, "Open sync log")).toBeTruthy();
		expect(getButton(modal, "Advanced")).toBeTruthy();
		expect(findButton(modal, "Run sync")).toBeNull();
	});

	test("Start sync opens review mode with Back, Refresh, and Run sync", async () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		getButton(modal, "Start sync").click();
		await flushUI();

		expect(modalOptions.buildSyncPlan).toHaveBeenCalledWith(
			"import",
			expect.objectContaining({
				setTotalNotes: expect.any(Function),
				reportPlanProgress: expect.any(Function),
			})
		);
		expect(modal.contentEl.textContent).toContain("Review download plan");
		expect(modal.contentEl.textContent).not.toContain("Download step");
		expect(getButton(modal, "Back")).toBeTruthy();
		expect(getButton(modal, "Refresh")).toBeTruthy();
		expect(getButton(modal, "Run sync")).toBeTruthy();
		expect(findButton(modal, "Advanced")).toBeNull();
		expect(findButton(modal, "Open sync log")).toBeNull();
	});

	test("shows 'Downloaded, please wait ...' once review fetch reaches the known total", async () => {
		let buildCallbacks:
			| {
					setTotalNotes?: (total: number) => void;
					reportPlanProgress?: (processed: number, total?: number) => void;
			  }
			| undefined;
		modalOptions.buildSyncPlan.mockImplementationOnce(async (_mode, callbacks) => {
			buildCallbacks = callbacks;
			return await new Promise<PreparedSyncPlan | null>(() => undefined);
		});

		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		getButton(modal, "Start sync").click();
		await flushUI();

		buildCallbacks?.setTotalNotes?.(3);
		buildCallbacks?.reportPlanProgress?.(3, 3);
		await flushUI();

		expect(getButton(modal, "Downloaded, please wait ...")).toBeTruthy();
	});

	test("advanced mode still renders supporter import options for download-capable modes only", async () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();

		expect(getButton(modal, "Advanced").getAttribute("aria-expanded")).toBe("false");

		getButton(modal, "Advanced").click();
		await flushUI();

		expect(getButton(modal, "Advanced").getAttribute("aria-expanded")).toBe("true");
		expect(modal.contentEl.textContent).toContain("Mode");
		expect(modalOptions.isSupporterActive).toHaveBeenCalled();
		expect(modal.contentEl.textContent).toContain("Download options");
		expect(modal.contentEl.textContent).toContain("Premium options active: true");

		getButton(modal, "Upload only").click();
		await flushUI();

		expect(modal.contentEl.textContent).not.toContain("Premium options active: true");
	});

	test("advanced two-way mode surfaces gate guidance and deep-links to settings", async () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();

		getButton(modal, "Advanced").click();
		await flushUI();
		getButton(modal, "Two-way sync").click();
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Confirm backups");

		getButton(modal, "Open beta settings").click();
		expect(modalOptions.openTwoWaySettings).toHaveBeenCalled();
	});

	test("shows a friendly sync-center alert when review generation cannot reach the server", async () => {
		modalOptions.buildSyncPlan.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED"));

		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		getButton(modal, "Start sync").click();
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Couldn’t prepare the sync review");
		expect(modal.contentEl.textContent).toContain(
			"The KeepSidian server could not be reached. Check your connection or make sure the sync server is running, then try again."
		);
		expect(modal.contentEl.textContent).toContain("Choose sync options, then start sync.");
	});

	test("shows a friendly sync-center alert when execution cannot reach the server", async () => {
		modalOptions.runSyncPlan.mockRejectedValueOnce(new Error("Failed to fetch"));

		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		getButton(modal, "Start sync").click();
		await flushUI();
		getButton(modal, "Run sync").click();
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Couldn’t finish the sync");
		expect(modal.contentEl.textContent).toContain(
			"The KeepSidian server could not be reached. Check your connection or make sure the sync server is running, then try again."
		);
		expect(modal.contentEl.textContent).toContain("Review download plan");
	});

	test("chips filter the review list by category", async () => {
		modalOptions.buildSyncPlan.mockResolvedValueOnce(
			createPreparedSyncPlanFixture("import", "import", [
				createSyncPlanEntryFixture("create", "Create", {
					id: "create-1",
					title: "Create row",
				}),
				createSyncPlanEntryFixture("merge", "Merge", {
					id: "merge-1",
					title: "Merge row",
				}),
			])
		);

		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		getButton(modal, "Start sync").click();
		await flushUI();

		expect(getRowTitles(modal)).toEqual(["Create row", "Merge row"]);

		getButton(modal, "Merge 1").click();
		await flushUI();

		expect(getRowTitles(modal)).toEqual(["Merge row"]);

		getButton(modal, "Notes 2").click();
		await flushUI();

		expect(getRowTitles(modal)).toEqual(["Create row", "Merge row"]);
	});

	test("supporters get select-all while non-supporters see locked controls", async () => {
		const supporterPlan = createPreparedSyncPlanFixture("import", "import", [
			createSyncPlanEntryFixture("create", "Create", {
				id: "create-1",
				title: "Create row",
			}),
			createSyncPlanEntryFixture("merge", "Merge", {
				id: "merge-1",
				title: "Merge row",
			}),
		]);
		modalOptions.buildSyncPlan.mockResolvedValueOnce(supporterPlan);

		const supporterModal = new SyncProgressModal(app, modalOptions);
		supporterModal.onOpen();
		getButton(supporterModal, "Start sync").click();
		await flushUI();
		expect(supporterModal.contentEl.textContent).toContain("Select all");

		const lockedPlan = createPreparedSyncPlanFixture("import", "import", [
			createSyncPlanEntryFixture("create", "Create", {
				id: "locked-1",
				title: "Locked row",
				selectionLocked: true,
				selectionLockedReason: "Available to project supporters",
			}),
		]);
		modalOptions.buildSyncPlan.mockResolvedValueOnce(lockedPlan);

		const nonSupporterModal = new SyncProgressModal(app, modalOptions);
		nonSupporterModal.onOpen();
		getButton(nonSupporterModal, "Start sync").click();
		await flushUI();

		expect(nonSupporterModal.contentEl.textContent).not.toContain("Select all");
		expect(nonSupporterModal.contentEl.textContent).toContain("Per-note selection is available to project supporters.");
		const checkbox = nonSupporterModal.contentEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(checkbox.disabled).toBe(true);
		expect(checkbox.title).toBe("Available to project supporters");
	});

	test("execution chips keep semantic categories and use X/Y counts", async () => {
		const plan = createPreparedSyncPlanFixture("import", "import", [
			createSyncPlanEntryFixture("create", "Create", {
				id: "create-1",
				title: "Create row",
			}),
			createSyncPlanEntryFixture("conflict-copy", "Conflict copy", {
				id: "conflict-1",
				title: "Conflict row",
			}),
			createSyncPlanEntryFixture("skipped-identical", "Skipped: identical", {
				id: "identical-1",
				title: "Identical row",
				selectable: false,
				selected: false,
			}),
			createSyncPlanEntryFixture("merge", "Merge", {
				id: "unchecked-1",
				title: "Unchecked row",
				selected: false,
			}),
		]);
		const deferred = createDeferredResult();
		modalOptions.buildSyncPlan.mockResolvedValueOnce(plan);
		modalOptions.runSyncPlan.mockImplementationOnce(async (_preparedPlan, callbacks) => {
			void callbacks?.onEntrySettled;
			return await deferred.promise;
		});

		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		getButton(modal, "Start sync").click();
		await flushUI();

		getButton(modal, "Run sync").click();
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Running download plan");
		expect(modal.contentEl.textContent).toContain("Created 0/1");
		expect(modal.contentEl.textContent).toContain("Conflict copy 1/1");
		expect(modal.contentEl.textContent).toContain("Already up to date 1/1");
		expect(modal.contentEl.textContent).toContain("Unchecked 1/1");

		const runCallback = modalOptions.runSyncPlan.mock.calls[0]?.[1];
		expect(runCallback).toEqual(
			expect.objectContaining({
				onEntrySettled: expect.any(Function),
			})
		);
		runCallback.onEntrySettled("create-1", true);
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Created 1/1");

		deferred.resolve({});
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Download complete");
		expect(modal.contentEl.textContent).toContain("Open sync log");
	});

	test("two-way review advances to upload review and refreshes the upload stage in place", async () => {
		const importPlan = createPreparedSyncPlanFixture("two-way", "import", [
			createSyncPlanEntryFixture("merge", "Merge", {
				id: "merge-1",
				mode: "two-way",
				stage: "import",
			}),
		]);
		const uploadPlan = createPreparedSyncPlanFixture("two-way", "upload", [
			createSyncPlanEntryFixture("upload", "Upload", {
				id: "upload-1",
				mode: "two-way",
				stage: "upload",
				path: "Keep/Upload.md",
			}),
		]);
		const refreshedUploadPlan = createPreparedSyncPlanFixture("push", "upload", [
			createSyncPlanEntryFixture("upload", "Upload", {
				id: "upload-2",
				mode: "push",
				stage: "upload",
				title: "Refreshed upload row",
				path: "Keep/Refreshed Upload.md",
			}),
		]);
		modalOptions.buildSyncPlan.mockResolvedValueOnce(importPlan).mockResolvedValueOnce(refreshedUploadPlan);
		modalOptions.runSyncPlan.mockResolvedValueOnce({ nextPlan: uploadPlan });

		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		modal.setSelectedMode("two-way");
		getButton(modal, "Start sync").click();
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Review download plan");

		getButton(modal, "Run sync").click();
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Review upload plan");
		expect(modal.contentEl.textContent).not.toContain("Upload step");

		getButton(modal, "Refresh").click();
		await flushUI();

		expect(modalOptions.buildSyncPlan).toHaveBeenLastCalledWith("push");
		expect(modal.contentEl.textContent).toContain("Refreshed upload row");
	});

	test("setup mode still shows live sync status for background sync monitoring", async () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();

		currentMode = "two-way";
		currentPhaseLabel = "Download step";
		(modal as unknown as { isSyncing: boolean }).isSyncing = true;
		modal.setProgress(3, 10);
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Sync center");
		expect(modal.contentEl.textContent).toContain("Download step: 3/10");

		(modal as unknown as { isSyncing: boolean }).isSyncing = false;
		const summary: LastSyncSummary = {
			timestamp: Date.now(),
			processedNotes: 4,
			totalNotes: 4,
			success: true,
			mode: "two-way",
		};
		modal.setComplete(true, 4);
		modal.setIdleSummary(summary);
		await flushUI();

		expect(modal.contentEl.textContent).toContain("Last two-way sync completed");
		expect(modal.contentEl.textContent).toContain("Synced 4/4 notes");
	});
});
