jest.mock("obsidian");

import { Notice } from "obsidian";
import KeepSidianPlugin from "main";
import { pushGoogleKeepNotes } from "../push";
import { pushNotes as apiPushNotes } from "@integrations/server/keepApi";
import { createMockPlugin, type MockVaultAdapter } from "../../../test-utils/mocks/plugin";


jest.mock("@integrations/server/keepApi", () => ({
	pushNotes: jest.fn(),
}));

jest.mock("@app/logging", () => ({
	logSync: jest.fn().mockResolvedValue(undefined),
	flushLogSync: jest.fn().mockResolvedValue(undefined),
}));

describe("pushGoogleKeepNotes", () => {
	const email = "user@example.com";
	const token = "test-token";
	const saveLocation = "Keep";

	function createPlugin(overrides: Partial<MockVaultAdapter> = {}) {
		const list = jest.fn().mockResolvedValue({ files: [], folders: [] });
		const read = jest.fn();
		const write = jest.fn().mockResolvedValue(undefined);
		const readBinary = jest.fn();
		const writeBinary = jest.fn().mockResolvedValue(undefined);
		const stat = jest.fn();
		const exists = jest.fn().mockResolvedValue(true);

		const createFolder = jest.fn().mockResolvedValue(undefined);

		const base = createMockPlugin({
			settings: {
				email,
				token,
				saveLocation,
				frontmatterPascalCaseFixApplied: false,
			},
			app: {
				vault: {
					createFolder,
					adapter: {
						list,
						read,
						write,
						writeBinary,
						readBinary,
						stat,
						exists,
						...overrides,
					},
				},
			},
		});

		const plugin = base as unknown as KeepSidianPlugin;
		const adapter = plugin.app.vault.adapter as unknown as MockVaultAdapter;
		const createFolderMock =
			plugin.app.vault.createFolder as unknown as jest.Mock<Promise<void>, [string]>;
		createFolderMock.mockResolvedValue(undefined);

		return { plugin, adapter };
	}

	beforeEach(() => {
		jest.clearAllMocks();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("skips notes that are up to date", async () => {
		const { plugin, adapter } = createPlugin();
		adapter.list.mockResolvedValue({ files: ["Keep/note.md"], folders: [] });
		adapter.read.mockResolvedValue(
			`---\nKeepSidianLastSyncedDate: 2024-01-01T00:00:00.000Z\n---\ncontent`
		);
		adapter.stat.mockResolvedValue({ mtime: new Date("2024-01-01T00:00:00Z").getTime() });

		const result = await pushGoogleKeepNotes(plugin);

		expect(result).toBe(0);
		expect(apiPushNotes).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith("No Google Keep notes to push.");
	});

	it("pushes modified notes and updates frontmatter", async () => {
		jest.useFakeTimers().setSystemTime(new Date("2024-02-01T00:00:00Z"));
		const { plugin, adapter } = createPlugin();
		adapter.list.mockResolvedValue({ files: ["Keep/note.md"], folders: [] });
		adapter.read.mockResolvedValue(
			`---\nKeepSidianLastSyncedDate: 2024-01-01T00:00:00.000Z\n---\ncontent`
		);
		adapter.stat.mockResolvedValue({ mtime: new Date("2024-01-05T00:00:00Z").getTime() });
		(apiPushNotes as jest.Mock).mockResolvedValue({
			results: [{ path: "note.md", success: true }],
		});

		const pushed = await pushGoogleKeepNotes(plugin);

		expect(pushed).toBe(1);
		expect(apiPushNotes).toHaveBeenCalledWith(email, token, [
			expect.objectContaining({
				path: "note.md",
				content: expect.stringContaining("content"),
			}),
		]);
		expect(adapter.write).toHaveBeenCalledWith(
			"Keep/note.md",
			expect.stringContaining("KeepSidianLastSyncedDate: 2024-02-01T00:00:00.000Z")
		);
		expect(Notice).toHaveBeenCalledWith("Pushed Google Keep notes.");
	});

	it("skips notes when mtime diff is below a second", async () => {
		jest.useFakeTimers().setSystemTime(new Date("2024-01-01T00:00:00Z"));
		const { plugin, adapter } = createPlugin();
		adapter.list.mockResolvedValue({ files: ["Keep/note.md"], folders: [] });
		adapter.read.mockResolvedValue(
			`---\nKeepSidianLastSyncedDate: 2024-01-01T00:00:00.000Z\n---\ncontent`
		);
		adapter.stat.mockResolvedValue({
			mtime: new Date("2024-01-01T00:00:00.500Z").getTime(),
		});

		const result = await pushGoogleKeepNotes(plugin);

		expect(result).toBe(0);
		expect(apiPushNotes).not.toHaveBeenCalled();
		expect(Notice).toHaveBeenCalledWith("No Google Keep notes to push.");
	});

	it("includes updated attachments in the payload", async () => {
		jest.useFakeTimers().setSystemTime(new Date("2024-03-01T00:00:00Z"));
		const { plugin, adapter } = createPlugin();
		adapter.list.mockResolvedValue({ files: ["Keep/note.md"], folders: [] });
		adapter.read.mockImplementation(async (path: string) => {
			if (path.endsWith("note.md")) {
				return "---\nKeepSidianLastSyncedDate: 2024-01-01T00:00:00.000Z\n---\n![[media/photo.png]]";
			}
			return "";
		});
		adapter.stat.mockImplementation(async (path: string) => {
			if (path.endsWith("photo.png")) {
				return { mtime: new Date("2024-02-15T00:00:00Z").getTime() };
			}
			return { mtime: new Date("2024-02-20T00:00:00Z").getTime() };
		});
		const attachmentBytes = Uint8Array.from([1, 2, 3, 4]);
		adapter.readBinary.mockResolvedValue(attachmentBytes.buffer);
		(apiPushNotes as jest.Mock).mockResolvedValue({
			results: [{ path: "note.md", success: true }],
		});

		await pushGoogleKeepNotes(plugin);

		expect(apiPushNotes).toHaveBeenCalled();
		const payload = (apiPushNotes as jest.Mock).mock.calls[0][2];
		expect(payload[0].attachments).toEqual([
			expect.objectContaining({
				name: "photo.png",
				data: Buffer.from(attachmentBytes).toString("base64"),
			}),
		]);
	});

	it("surfaces errors from the push API", async () => {
		const { plugin, adapter } = createPlugin();
		adapter.list.mockResolvedValue({ files: ["Keep/note.md"], folders: [] });
		adapter.read.mockResolvedValue("---\n---\ncontent");
		adapter.stat.mockResolvedValue({ mtime: new Date("2024-01-05T00:00:00Z").getTime() });
		(apiPushNotes as jest.Mock).mockRejectedValue(new Error("network failure"));

		await expect(pushGoogleKeepNotes(plugin)).rejects.toThrow("network failure");
		expect(Notice).toHaveBeenCalledWith("Failed to push notes.");
	});
});
