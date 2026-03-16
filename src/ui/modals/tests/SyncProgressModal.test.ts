jest.mock("obsidian");
import { App } from "obsidian";
import { SyncProgressModal } from "../SyncProgressModal";
import type { LastSyncSummary, SyncMode } from "../../../types/keepsidian-plugin-settings";

describe("SyncProgressModal", () => {
	let app: App;
	let gateState: { allowed: boolean; reasons: string[] };
	let currentMode: SyncMode | null;
	let currentPhaseLabel: string | null;
	let modalOptions: ReturnType<typeof createOptions>;

	function createOptions() {
		const onRunSync = jest.fn().mockResolvedValue(undefined);
		const onOpenSyncLog = jest.fn().mockResolvedValue(undefined);
		const requireTwoWayGate = jest.fn().mockImplementation(async () => gateState);
		const showTwoWayGateNotice = jest.fn();
		const openTwoWaySettings = jest.fn();
		const isSupporterActive = jest.fn().mockResolvedValue(true);
		const renderImportOptions = jest.fn(async (containerEl: HTMLElement, isActive: boolean) => {
			containerEl.createEl("div", {
				text: `Premium options active: ${String(isActive)}`,
			});
		});
		return {
			onRunSync,
			onOpenSyncLog,
			onClose: jest.fn(),
			getTwoWayGate: () => gateState,
			requireTwoWayGate,
			showTwoWayGateNotice,
			openTwoWaySettings,
			getCurrentMode: () => currentMode,
			getCurrentPhaseLabel: () => currentPhaseLabel,
			isSupporterActive,
			renderImportOptions,
		};
	}

	function getButton(modal: SyncProgressModal, label: string): HTMLButtonElement {
		const button = Array.from(modal.contentEl.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === label
		);
		expect(button).toBeTruthy();
		return button as HTMLButtonElement;
	}

	beforeEach(() => {
		app = new App();
		gateState = { allowed: false, reasons: ["Confirm backups"] };
		currentMode = null;
		currentPhaseLabel = null;
		modalOptions = createOptions();
	});

	test("starts in summary mode and sync now runs the default download flow", async () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();

		expect(modal.contentEl.textContent).toContain("Sync center");
		expect(modal.contentEl.textContent).toContain("No sync has been run yet.");
		expect(
			Array.from(modal.contentEl.querySelectorAll("button"))
				.slice(0, 3)
				.map((button) => button.textContent?.trim())
		).toEqual(["Sync now", "Open sync log", "Advanced"]);

		getButton(modal, "Sync now").click();
		await Promise.resolve();

		expect(modalOptions.onRunSync).toHaveBeenCalledWith("import");
	});

	test("advanced mode renders supporter import options for download-capable modes only", async () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();

		expect(getButton(modal, "Advanced").getAttribute("aria-expanded")).toBe("false");
		expect(getButton(modal, "Advanced").classList.contains("is-expanded")).toBe(false);

		getButton(modal, "Advanced").click();
		await Promise.resolve();
		await Promise.resolve();

		expect(getButton(modal, "Advanced").getAttribute("aria-expanded")).toBe("true");
		expect(getButton(modal, "Advanced").classList.contains("is-expanded")).toBe(true);
		expect(modal.contentEl.textContent).toContain("Mode");
		expect(modalOptions.isSupporterActive).toHaveBeenCalled();
		expect(modalOptions.renderImportOptions).toHaveBeenCalled();
		expect(
			Array.from(modal.contentEl.querySelectorAll('[role="radio"]')).map((button) => ({
				text: button.textContent?.trim(),
				checked: button.getAttribute("aria-checked"),
			}))
		).toEqual([
			{ text: "Download only", checked: "true" },
			{ text: "Upload only", checked: "false" },
			{ text: "Two-way sync", checked: "false" },
		]);
		expect(modal.contentEl.textContent).toContain("Download options");
		expect(modal.contentEl.textContent).toContain("Thanks for supporting KeepSidian! Customize your download below.");
		expect(modal.contentEl.textContent).toContain("Premium options active: true");

		getButton(modal, "Upload only").click();
		await Promise.resolve();

		expect(
			Array.from(modal.contentEl.querySelectorAll('[role="radio"]')).map((button) => ({
				text: button.textContent?.trim(),
				checked: button.getAttribute("aria-checked"),
			}))
		).toEqual([
			{ text: "Download only", checked: "false" },
			{ text: "Upload only", checked: "true" },
			{ text: "Two-way sync", checked: "false" },
		]);
		expect(modal.contentEl.textContent).not.toContain("Premium options active: true");

		getButton(modal, "Advanced").click();
		await Promise.resolve();

		expect(getButton(modal, "Advanced").getAttribute("aria-expanded")).toBe("false");
		expect(getButton(modal, "Advanced").classList.contains("is-expanded")).toBe(false);
	});

	test("advanced two-way mode surfaces gate guidance and deep-links to settings", async () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();

		getButton(modal, "Advanced").click();
		await Promise.resolve();
		getButton(modal, "Two-way sync").click();
		await Promise.resolve();

		expect(modal.contentEl.textContent).toContain("Confirm backups");

		getButton(modal, "Open beta settings").click();
		expect(modalOptions.openTwoWaySettings).toHaveBeenCalled();

		getButton(modal, "Sync now").click();
		await Promise.resolve();

		expect(modalOptions.requireTwoWayGate).toHaveBeenCalledTimes(1);
		expect(modalOptions.showTwoWayGateNotice).toHaveBeenCalledWith(gateState);
		expect(modalOptions.onRunSync).not.toHaveBeenCalled();
	});

	test("running and completed states show sync phase, progress, and sync again affordance", () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();

		currentMode = "two-way";
		currentPhaseLabel = "Download step";
		modal.setProgress(3, 10);
		expect(modal.contentEl.textContent).toContain("Download step");
		expect(modal.contentEl.textContent).toContain("Processed 3 of 10 notes");
		expect(getButton(modal, "Sync now").disabled).toBe(true);

		currentPhaseLabel = "Upload step";
		modal.setProgress(1, 4);
		expect(modal.contentEl.textContent).toContain("Upload step");
		expect(modal.contentEl.textContent).toContain("Processed 1 of 4 notes");

		const summary: LastSyncSummary = {
			timestamp: Date.now(),
			processedNotes: 4,
			totalNotes: 4,
			success: true,
			mode: "two-way",
		};
		modal.setComplete(true, 4);
		modal.setIdleSummary(summary);

		expect(modal.contentEl.textContent).toContain("Last two-way sync completed");
		expect(modal.contentEl.textContent).toContain("Synced 4/4 notes");
		expect(getButton(modal, "Sync again")).toBeTruthy();
	});
});
