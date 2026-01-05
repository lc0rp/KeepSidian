jest.mock("obsidian");
import { App } from "obsidian";
import { SyncProgressModal } from "../SyncProgressModal";
import type { LastSyncSummary } from "../../../types/keepsidian-plugin-settings";

type InternalModalState = {
	buttons: {
		twoWay: HTMLButtonElement | null;
		importOnly: HTMLButtonElement | null;
		uploadOnly: HTMLButtonElement | null;
		openLog: HTMLButtonElement | null;
	};
	gateMessageEl: HTMLDivElement | null;
};

describe("SyncProgressModal", () => {
	let app: App;
	let gateState: { allowed: boolean; reasons: string[] };
	let modalOptions: ReturnType<typeof createOptions>;

	function createOptions() {
		const onTwoWaySync = jest.fn().mockResolvedValue(undefined);
		const onImportOnly = jest.fn().mockResolvedValue(undefined);
		const onUploadOnly = jest.fn().mockResolvedValue(undefined);
		const onOpenSyncLog = jest.fn().mockResolvedValue(undefined);
		const requireTwoWayGate = jest
			.fn()
			.mockImplementation(async () => gateState);
		const showTwoWayGateNotice = jest.fn();
		const openTwoWaySettings = jest.fn();
		return {
			onTwoWaySync,
			onImportOnly,
			onUploadOnly,
			onOpenSyncLog,
			onClose: jest.fn(),
			getTwoWayGate: () => gateState,
			requireTwoWayGate,
			showTwoWayGateNotice,
			openTwoWaySettings,
		};
	}

	beforeEach(() => {
		app = new App();
		gateState = { allowed: false, reasons: ["Confirm backups"] };
		modalOptions = createOptions();
	});

	test("disables uploads and surfaces gate guidance when safeguards missing", () => {
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		const internal = modal as unknown as InternalModalState;

		expect(internal.buttons.twoWay?.disabled).toBe(true);
		expect(internal.buttons.uploadOnly?.disabled).toBe(true);
		expect(internal.buttons.importOnly?.disabled).toBe(false);
		expect(internal.buttons.twoWay?.title).toBe("Confirm backups");
		expect(internal.buttons.uploadOnly?.title).toBe("Confirm backups");
		expect(internal.gateMessageEl).not.toBeNull();
		expect(internal.gateMessageEl?.hidden).toBe(false);
		expect(internal.gateMessageEl?.textContent).toContain("Confirm backups");

		const settingsButton = internal.gateMessageEl?.querySelector("button");
		expect(settingsButton).not.toBeNull();
		settingsButton?.dispatchEvent(new Event("click"));
		expect(modalOptions.openTwoWaySettings).toHaveBeenCalled();
	});

	test("enables uploads and invokes callbacks once safeguards pass", async () => {
		gateState = { allowed: true, reasons: [] };
		modalOptions = createOptions();
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		const internal = modal as unknown as InternalModalState;

		expect(internal.gateMessageEl?.hidden).toBe(true);
		expect(internal.buttons.twoWay?.disabled).toBe(false);
		expect(internal.buttons.uploadOnly?.disabled).toBe(false);

		internal.buttons.twoWay?.click();
		await (modalOptions.requireTwoWayGate).mock.results[0].value;
		internal.buttons.uploadOnly?.click();
		await (modalOptions.requireTwoWayGate).mock.results[1].value;

		expect(modalOptions.requireTwoWayGate).toHaveBeenCalledTimes(2);
		expect(modalOptions.showTwoWayGateNotice).not.toHaveBeenCalled();
		expect(modalOptions.onTwoWaySync).toHaveBeenCalled();
		expect(modalOptions.onUploadOnly).toHaveBeenCalled();

		modal.setProgress(5, 10);
		expect(modal["statusEl"]?.textContent).toContain("Processed 5 of 10 notes");

		modal.setComplete(true, 5);
		const summary: LastSyncSummary = {
			timestamp: Date.now(),
			processedNotes: 5,
			totalNotes: 10,
			success: true,
			mode: "import",
		};
		modal.setIdleSummary(summary);
		expect(modal["statusEl"]?.textContent).toContain("Synced 5/10 notes");
	});

	test("shows sync-in-progress messaging when uploads are paused for active sync", () => {
		gateState = { allowed: true, reasons: [] };
		modalOptions = createOptions();
		const modal = new SyncProgressModal(app, modalOptions);
		modal.onOpen();
		modal.setProgress(3, 10);
		const internal = modal as unknown as InternalModalState;

		expect(internal.buttons.twoWay?.disabled).toBe(true);
		expect(internal.buttons.uploadOnly?.disabled).toBe(true);
		expect(internal.buttons.twoWay?.getAttribute("aria-disabled")).toBe("true");
		expect(internal.buttons.uploadOnly?.getAttribute("aria-disabled")).toBe("true");
		expect(internal.buttons.twoWay?.title).toBe(
			"Sync in progress—please wait before starting another sync."
		);
		expect(internal.buttons.uploadOnly?.title).toBe(
			"Sync in progress—please wait before starting another sync."
		);

		modal.setComplete(true, 10);
		expect(internal.buttons.twoWay?.disabled).toBe(false);
		expect(internal.buttons.uploadOnly?.disabled).toBe(false);
		expect(internal.buttons.twoWay?.hasAttribute("title")).toBe(false);
		expect(internal.buttons.uploadOnly?.hasAttribute("title")).toBe(false);
	});
});
