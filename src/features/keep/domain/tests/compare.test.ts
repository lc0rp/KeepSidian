import {
	normalizeDate,
	handleDuplicateNotes,
	checkForDuplicateData,
} from "../compare";
import { NormalizedNote } from "../note";
import type { App } from "obsidian";
import {
	createMockPlugin,
	type MockVaultAdapter,
} from "../../../../test-utils/mocks/plugin";

describe("normalizeDate", () => {
	it("should return null for undefined input", () => {
		expect(normalizeDate(undefined)).toBeNull();
	});

	it("should return a valid Date object for a valid date string", () => {
		const result = normalizeDate("2023-05-25T10:00:00Z");
		expect(result).toBeInstanceOf(Date);
		expect(result?.toISOString()).toBe("2023-05-25T10:00:00.000Z");
	});

	it("should return null for an invalid date string", () => {
		expect(normalizeDate("invalid-date")).toBeNull();
	});
});

describe("handleDuplicateNotes", () => {
	let mockApp: App;
	let adapter: MockVaultAdapter;

	beforeEach(() => {
		const plugin = createMockPlugin();
		adapter = plugin.app.vault.adapter;
		mockApp = plugin.app as unknown as App;
	});

	it('should return "create" when file does not exist', async () => {
		adapter.exists.mockResolvedValue(false);

		const note: NormalizedNote = {
			title: "Sample",
			text: "Sample",
			created: null,
			updated: null,
			frontmatter: "",
			frontmatterDict: {},
			archived: false,
			trashed: false,
			labels: [],
			blobs: [],
			blob_urls: [],
			blob_names: [],
			media: [],
			header: "",
			textWithoutFrontmatter: "",
		};

		const result = await handleDuplicateNotes(
			"/save/location",
			note,
			mockApp
		);
		expect(result).toBe("create");
	});

	it("should call checkForDuplicateData when file exists", async () => {
		adapter.exists.mockResolvedValue(true);
		adapter.read.mockResolvedValue(
			"---\nCreated: 2023-05-25\n---\nExisting content"
		);
		adapter.stat.mockResolvedValue({
			ctime: Date.now(),
			mtime: Date.now(),
		});

		const incomingNote: NormalizedNote = {
			title: "Test Note",
			text: "Content",
			created: new Date("2023-05-25"),
			updated: new Date("2023-05-26"),
			frontmatter: "",
			frontmatterDict: {},
			archived: false,
			trashed: false,
			labels: [],
			blobs: [],
			blob_urls: [],
			blob_names: [],
			media: [],
			header: "",
			textWithoutFrontmatter: "New content",
		};

		const result = await handleDuplicateNotes(
			"/save/location",
			incomingNote,
			mockApp
		);
		expect(["skip", "merge", "overwrite"]).toContain(result);
	});
});

describe("checkForDuplicateData", () => {
	it('should return "skip" when contents are the same', () => {
		const incomingFile = {
			textWithoutFrontmatter: "Same content",
			createdDate: new Date("2023-05-25"),
			updatedDate: new Date("2023-05-26"),
		};
		const existingFile = {
			textWithoutFrontmatter: "Same content",
			createdDate: new Date("2023-05-24"),
			updatedDate: new Date("2023-05-25"),
			fsCreatedDate: new Date("2023-05-24"),
			fsUpdatedDate: new Date("2023-05-25"),
			lastSyncedDate: new Date("2023-05-25"),
		};

		expect(checkForDuplicateData(incomingFile, existingFile)).toBe("skip");
	});

	it('should return "merge" when both files have been modified since last sync', () => {
		const incomingFile = {
			textWithoutFrontmatter: "New content",
			createdDate: new Date("2023-05-25"),
			updatedDate: new Date("2023-05-27"),
		};
		const existingFile = {
			textWithoutFrontmatter: "Modified existing content",
			createdDate: new Date("2023-05-24"),
			updatedDate: new Date("2023-05-26"),
			fsCreatedDate: new Date("2023-05-24"),
			fsUpdatedDate: new Date("2023-05-26"),
			lastSyncedDate: new Date("2023-05-25"),
		};

		expect(checkForDuplicateData(incomingFile, existingFile)).toBe("merge");
	});

	it('should return "overwrite" when only incoming file has been modified since last sync', () => {
		const incomingFile = {
			textWithoutFrontmatter: "New content",
			createdDate: new Date("2023-05-25"),
			updatedDate: new Date("2023-05-27"),
		};
		const existingFile = {
			textWithoutFrontmatter: "Existing content",
			createdDate: new Date("2023-05-24"),
			updatedDate: new Date("2023-05-25"),
			fsCreatedDate: new Date("2023-05-24"),
			fsUpdatedDate: new Date("2023-05-25"),
			lastSyncedDate: new Date("2023-05-26"),
		};

		expect(checkForDuplicateData(incomingFile, existingFile)).toBe(
			"overwrite"
		);
	});
});
