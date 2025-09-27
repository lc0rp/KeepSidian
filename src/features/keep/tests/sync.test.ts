jest.mock("obsidian", () => ({
	requestUrl: jest.fn(),
	normalizePath: jest.fn(),
	Notice: jest.fn(),
}));
import { requestUrl, RequestUrlResponse, Notice } from "obsidian";
import * as obsidian from "obsidian";
import {
	importGoogleKeepNotes,
	importGoogleKeepNotesWithOptions,
	convertOptionsToFeatureFlags,
	processAndSaveNotes,
} from "../sync";
import { handleDuplicateNotes } from "../domain/compare";
import KeepSidianPlugin from "main";
import { NoteImportOptions } from "ui/modals/NoteImportOptionsModal";
import * as noteModule from "../domain/note";
import * as compareModule from "../domain/compare";
import * as syncModule from "../sync";
import * as loggingModule from "@app/logging";
import * as pathsModule from "@services/paths";
import * as attachmentsModule from "../../../features/keep/io/attachments";
import { parseResponse } from "../../../integrations/server/keepApi";

// Mock the external modules
jest.mock("../domain/compare");
jest.mock("main");

describe("Google Keep Import Functions", () => {
	let mockPlugin: jest.Mocked<KeepSidianPlugin>;
	let getVaultConfigMock: jest.Mock;
	let setVaultConfigMock: jest.Mock;

	beforeEach(() => {
		// Reset all mocks before each test
		jest.clearAllMocks();

		getVaultConfigMock = jest.fn().mockReturnValue(undefined);
		setVaultConfigMock = jest.fn();

		// Setup mock plugin
		mockPlugin = {
			settings: {
				email: "test@example.com",
				token: "test-token",
				saveLocation: "Test Folder",
				keepSidianLastSuccessfulSyncDate: null,
				frontmatterPascalCaseFixApplied: false,
			},
				app: {
					vault: {
						getConfig: getVaultConfigMock,
						setConfig: setVaultConfigMock,
						adapter: {
						exists: jest.fn().mockImplementation(() => Promise.resolve(false)),
						list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
						write: jest.fn(),
						writeBinary: jest.fn(),
						read: jest.fn(),
					},
					createFolder: jest.fn(),
				},
			},
			saveSettings: jest.fn().mockResolvedValue(undefined),
		} as unknown as jest.Mocked<KeepSidianPlugin>;

		// Mock requestUrl default success response
		(requestUrl as jest.Mock).mockResolvedValue({
			status: 200,
			headers: {},
			arrayBuffer: new ArrayBuffer(0),
			json: () => ({ notes: [] }),
			text: '{"notes": []}',
		} as RequestUrlResponse);
	});

	describe("importGoogleKeepNotes", () => {
		it("should successfully import notes", async () => {
			await expect(importGoogleKeepNotes(mockPlugin)).resolves.toBe(0);
			expect(requestUrl).toHaveBeenCalled();
			expect(Notice).toHaveBeenCalledWith("Imported Google Keep notes.");
		});

		it("should handle errors during import", async () => {
			(requestUrl as jest.Mock).mockRejectedValue(new Error("Network error"));
			await expect(importGoogleKeepNotes(mockPlugin)).rejects.toThrow("Network error");
			expect(Notice).toHaveBeenCalledWith("Failed to import notes.");
			expect(mockPlugin.settings.keepSidianLastSuccessfulSyncDate).toBeNull();
			expect(setVaultConfigMock).not.toHaveBeenCalled();
		});

		it("uses last successful sync date from settings to filter requests", async () => {
			mockPlugin.settings.keepSidianLastSuccessfulSyncDate = "2024-01-01T00:00:00.000Z";

			await importGoogleKeepNotes(mockPlugin);

			const [[requestParams]] = (requestUrl as jest.Mock).mock.calls;
			expect(requestParams.url).toContain("created_gt=2024-01-01T00%3A00%3A00.000Z");
			expect(requestParams.url).toContain("updated_gt=2024-01-01T00%3A00%3A00.000Z");
		});

		it("uses vault config when settings sync date is unavailable", async () => {
			mockPlugin.settings.keepSidianLastSuccessfulSyncDate = null;
			getVaultConfigMock.mockReturnValue(
				"2024-02-02T00:00:00.000Z"
			);

			await importGoogleKeepNotes(mockPlugin);

			const [[requestParams]] = (requestUrl as jest.Mock).mock.calls;
			expect(requestParams.url).toContain("created_gt=2024-02-02T00%3A00%3A00.000Z");
			expect(requestParams.url).toContain("updated_gt=2024-02-02T00%3A00%3A00.000Z");
		});

		it("persists the last successful sync date after import", async () => {
			jest.useFakeTimers().setSystemTime(new Date("2024-03-03T12:34:56.000Z"));

			try {
				await importGoogleKeepNotes(mockPlugin);

				const expected = "2024-03-03T12:34:56.000Z";
				expect(mockPlugin.settings.keepSidianLastSuccessfulSyncDate).toBe(expected);
				expect(setVaultConfigMock).toHaveBeenCalledWith(
					"KeepSidianLastSuccessfulSyncDate",
					expected
				);
			} finally {
				jest.useRealTimers();
			}
		});
	});

	describe("importGoogleKeepNotesWithOptions", () => {
		const mockOptions: NoteImportOptions = {
			includeNotesTerms: ["important"],
			excludeNotesTerms: ["draft"],
			updateTitle: true,
			suggestTags: true,
			maxTags: 3,
			limitToExistingTags: true,
			tagPrefix: "auto-",
		};

		it("should import notes with premium features", async () => {
			await importGoogleKeepNotesWithOptions(mockPlugin, mockOptions);
			expect(requestUrl).toHaveBeenCalledWith(
				expect.objectContaining({
					url: expect.stringContaining("/premium"),
					method: "POST",
				})
			);
		});

		it("should handle errors with premium features", async () => {
			(requestUrl as jest.Mock).mockRejectedValue(new Error("Premium feature error"));
			await expect(importGoogleKeepNotesWithOptions(mockPlugin, mockOptions)).rejects.toThrow(
				"Premium feature error"
			);
			expect(Notice).toHaveBeenCalledWith("Failed to import notes.");
		});
	});

	describe("convertOptionsToFeatureFlags", () => {
		it("should convert all options correctly", () => {
			const options: NoteImportOptions = {
				includeNotesTerms: ["term1", "term2"],
				excludeNotesTerms: ["exclude1"],
				updateTitle: true,
				suggestTags: true,
				maxTags: 10,
				limitToExistingTags: true,
				tagPrefix: "tag-",
			};
			const featureFlags = convertOptionsToFeatureFlags(options);
			expect(featureFlags).toEqual({
				filter_notes: { terms: ["term1", "term2"] },
				skip_notes: { terms: ["exclude1"] },
				suggest_title: {},
				suggest_tags: {
					max_tags: 10,
					restrict_tags: true,
					prefix: "tag-",
				},
			});
		});

		it("should handle empty options", () => {
			const options: NoteImportOptions = {};
			const flags = convertOptionsToFeatureFlags(options);
			expect(flags).toEqual({});
		});

		it("should handle partial options", () => {
			const options: NoteImportOptions = {
				updateTitle: true,
			};
			const featureFlags = convertOptionsToFeatureFlags(options);
			expect(featureFlags).toEqual({
				suggest_title: {},
			});
		});
	});

	describe("processAndSaveNotes", () => {
		const mockNotes = [
			{
				title: "Test Note",
				textContent: "Test content",
				labels: ["test"],
				color: "WHITE",
				isArchived: false,
				isPinned: false,
				isTrashed: false,
				lastModified: new Date().toISOString(),
			},
		];

		it("should create folders if they don't exist", async () => {
			await processAndSaveNotes(mockPlugin, mockNotes);

			expect(mockPlugin.app.vault.adapter.exists).toHaveBeenCalledWith("Test Folder");
			expect(mockPlugin.app.vault.adapter.exists).toHaveBeenCalledWith("Test Folder/media");
			// saveLocation and media folder; logging may also ensure parent exists
			const createFolderMock = mockPlugin.app.vault.createFolder as unknown as jest.Mock<
				Promise<void>,
				[string]
			>;
			expect(createFolderMock.mock.calls.length).toBeGreaterThanOrEqual(2);
		});

		it("should process each note", async () => {
			(handleDuplicateNotes as jest.Mock).mockResolvedValue("create");

			await processAndSaveNotes(mockPlugin, mockNotes);

			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalled();
		});
	});

	describe("processAndSaveNote", () => {
		const note: noteModule.PreNormalizedNote = {
			title: "Note 1",
			text: "Content 1",
			frontmatterDict: {},
		};
		const normalizedNote: noteModule.NormalizedNote = {
			title: "Note 1",
			text: "Content 1",
			frontmatterDict: {},
			created: null,
			updated: null,
			frontmatter: "",
			archived: false,
			trashed: false,
			labels: [],
			blobs: [],
			blob_urls: [],
			blob_names: [],
			media: [],
			header: "",
			textWithoutFrontmatter: "Content 1",
		};

		it("should skip notes without a title", async () => {
			const normalizedWithoutTitle: noteModule.NormalizedNote = {
				...normalizedNote,
				title: "",
				text: "",
			};
			jest.spyOn(noteModule, "normalizeNote").mockReturnValue(normalizedWithoutTitle);
			const logSpy = jest.spyOn(loggingModule, "logSync").mockResolvedValue(undefined);

			await syncModule.processAndSaveNote(mockPlugin, note, mockPlugin.settings.saveLocation);

			expect(compareModule.handleDuplicateNotes).not.toHaveBeenCalled();
			expect(mockPlugin.app.vault.adapter.write).not.toHaveBeenCalled();
			expect(logSpy).toHaveBeenCalledWith(mockPlugin, "Skipped note without a title");
			logSpy.mockRestore();
		});

		it("should process and save note without duplicates or attachments", async () => {
			jest.spyOn(noteModule, "normalizeNote").mockReturnValue(normalizedNote);
			jest.spyOn(compareModule, "handleDuplicateNotes").mockResolvedValue("create");
			jest.spyOn(mockPlugin.app.vault.adapter, "write").mockResolvedValue(undefined);
			jest.spyOn(Date.prototype, "toISOString").mockReturnValue("2023-01-01T00:00:00.000Z");
			jest.spyOn(obsidian, "normalizePath").mockReturnValue(
				`${mockPlugin.settings.saveLocation}/${note.title}.md`
			);
			const ensureParentSpy = jest
				.spyOn(pathsModule, "ensureParentFolderForFile")
				.mockResolvedValue(undefined);
			await syncModule.processAndSaveNote(mockPlugin, note, mockPlugin.settings.saveLocation);

			expect(noteModule.normalizeNote).toHaveBeenCalledWith(note);
			expect(compareModule.handleDuplicateNotes).toHaveBeenCalledWith(
				mockPlugin.settings.saveLocation,
				normalizedNote,
				mockPlugin.app
			);
			expect(mockPlugin.app.vault.adapter.read).not.toHaveBeenCalled();
			expect(ensureParentSpy).toHaveBeenCalledWith(
				mockPlugin.app,
				`${mockPlugin.settings.saveLocation}/${note.title}.md`
			);
			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalled();
			ensureParentSpy.mockRestore();
		});

		it("should skip note if duplicate action is skip", async () => {
			jest.spyOn(noteModule, "normalizeNote").mockReturnValue(normalizedNote);
			jest.spyOn(compareModule, "handleDuplicateNotes").mockResolvedValue("skip");

			await syncModule.processAndSaveNote(mockPlugin, note, mockPlugin.settings.saveLocation);

			const expectedNotePath = `${mockPlugin.settings.saveLocation}/${note.title}.md`;
			// No write to note file when skipped; logging may still write to log file
			expect(
				(mockPlugin.app.vault.adapter.write as jest.Mock).mock.calls.some(
					(c) => c[0] === expectedNotePath
				)
			).toBe(false);
		});

		it("should merge note file if duplicate action is merge and merge succeeds", async () => {
			const existingContent = `---\nExisting: true\n---\nLine 1`;
			const incomingNote: noteModule.PreNormalizedNote = {
				title: "Note 1",
				text: "Line 1\nLine 2",
				frontmatterDict: { Incoming: "true" },
			};
			const incomingNormalized: noteModule.NormalizedNote = {
				...normalizedNote,
				text: "Line 1\nLine 2",
				textWithoutFrontmatter: "Line 1\nLine 2",
				frontmatterDict: { Incoming: "true" },
			};

			(mockPlugin.app.vault.adapter.exists as jest.Mock).mockResolvedValueOnce(true);
			jest.spyOn(noteModule, "normalizeNote").mockReturnValue(incomingNormalized);
			jest.spyOn(compareModule, "handleDuplicateNotes").mockResolvedValue("merge");
			jest.spyOn(mockPlugin.app.vault.adapter, "read").mockResolvedValue(existingContent);
			jest.spyOn(Date.prototype, "toISOString").mockReturnValue("2023-01-01T00:00:00.000Z");
			jest.spyOn(obsidian, "normalizePath").mockReturnValue(
				`${mockPlugin.settings.saveLocation}/${incomingNote.title}.md`
			);

			await syncModule.processAndSaveNote(
				mockPlugin,
				incomingNote,
				mockPlugin.settings.saveLocation
			);

			const expectedFilePath = `${mockPlugin.settings.saveLocation}/${incomingNote.title}.md`;
			const expectedContent = `---\nExisting: true\nKeepSidianLastSyncedDate: 2023-01-01T00:00:00.000Z\n---\nLine 1\nLine 2`;
			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith(
				expectedFilePath,
				expectedContent
			);
		});

		it("should rename note file if merge has conflicts", async () => {
			const existingContent = `---\nExisting: true\n---\nLine 1\nLine A`;
			const incomingNote: noteModule.PreNormalizedNote = {
				title: "Note 1",
				text: "Line 1\nLine B",
				frontmatterDict: { Incoming: "true" },
			};
			const incomingNormalized: noteModule.NormalizedNote = {
				...normalizedNote,
				text: "Line 1\nLine B",
				frontmatterDict: { Incoming: "true" },
			};

			(mockPlugin.app.vault.adapter.exists as jest.Mock).mockResolvedValueOnce(true);
			jest.spyOn(noteModule, "normalizeNote").mockReturnValue(incomingNormalized);
			jest.spyOn(compareModule, "handleDuplicateNotes").mockResolvedValue("merge");
			jest.spyOn(mockPlugin.app.vault.adapter, "read").mockResolvedValue(existingContent);
			jest.spyOn(Date.prototype, "toISOString").mockReturnValue("2023-01-01T00:00:00.000Z");
			jest.spyOn(obsidian, "normalizePath").mockReturnValue(
				`${mockPlugin.settings.saveLocation}/${incomingNote.title}.md`
			);

			await syncModule.processAndSaveNote(
				mockPlugin,
				incomingNote,
				mockPlugin.settings.saveLocation
			);

			const expectedFilePath = `${mockPlugin.settings.saveLocation}/${incomingNote.title}-conflict-2023-01-01T00:00:00.000Z.md`;
			expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith(
				expectedFilePath,
				expect.any(String)
			);
		});

		it("should process attachments if present", async () => {
			const preNormalizedNote: noteModule.PreNormalizedNote = {
				title: "Note 1",
				text: "Content 1",
				frontmatterDict: {},
				blob_urls: ["http://example.com/blob1", "http://example.com/blob2"],
			};
			const normalizedNoteWithAttachments = {
				...normalizedNote,
				blob_urls: ["http://example.com/blob1", "http://example.com/blob2"],
			};

			jest.spyOn(noteModule, "normalizeNote").mockReturnValue(normalizedNoteWithAttachments);
			jest.spyOn(compareModule, "handleDuplicateNotes").mockResolvedValue("overwrite");
			const processAttachmentsSpy = jest
				.spyOn(attachmentsModule, "processAttachments")
				.mockResolvedValue({
					downloaded: 2,
					skippedIdentical: 0,
				});
			const logSpy = jest.spyOn(loggingModule, "logSync").mockResolvedValue(undefined);

			await syncModule.processAndSaveNote(
				mockPlugin,
				preNormalizedNote,
				mockPlugin.settings.saveLocation
			);

			expect(processAttachmentsSpy).toHaveBeenCalledWith(
				mockPlugin.app,
				preNormalizedNote.blob_urls,
				mockPlugin.settings.saveLocation,
				normalizedNoteWithAttachments.blob_names
			);
			expect(logSpy).toHaveBeenCalledWith(
				mockPlugin,
				expect.stringContaining("downloaded 2 attachments")
			);
			processAttachmentsSpy.mockRestore();
			logSpy.mockRestore();
		});

		it("should download attachments even when note is skipped", async () => {
			const preNormalizedNote: noteModule.PreNormalizedNote = {
				title: "Note 1",
				text: "Content 1",
				frontmatterDict: {},
				blob_urls: ["http://example.com/blob1"],
			};
			const normalizedNoteWithAttachments = {
				...normalizedNote,
				blob_urls: ["http://example.com/blob1"],
			};

			jest.spyOn(noteModule, "normalizeNote").mockReturnValue(normalizedNoteWithAttachments);
			jest.spyOn(compareModule, "handleDuplicateNotes").mockResolvedValue("skip");
			const processAttachmentsSpy = jest
				.spyOn(attachmentsModule, "processAttachments")
				.mockResolvedValue({
					downloaded: 0,
					skippedIdentical: 1,
				});
			const logSpy = jest.spyOn(loggingModule, "logSync").mockResolvedValue(undefined);

			await syncModule.processAndSaveNote(
				mockPlugin,
				preNormalizedNote,
				mockPlugin.settings.saveLocation
			);

			expect(processAttachmentsSpy).toHaveBeenCalledWith(
				mockPlugin.app,
				preNormalizedNote.blob_urls,
				mockPlugin.settings.saveLocation,
				normalizedNoteWithAttachments.blob_names
			);
			expect(logSpy).toHaveBeenCalledWith(
				mockPlugin,
				expect.stringContaining("identical (skipped)")
			);
			expect(logSpy).toHaveBeenCalledWith(
				mockPlugin,
				expect.stringContaining("attachments up to date")
			);
			processAttachmentsSpy.mockRestore();
			logSpy.mockRestore();
		});
	});

	describe("parseResponse", () => {
		it("should parse JSON response using json() method", async () => {
			const mockResponse: Partial<RequestUrlResponse> = {
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: () => ({ notes: ["note1", "note2"] }),
				text: "",
			};

			const result = parseResponse(mockResponse as RequestUrlResponse);
			expect(result).toEqual({ notes: ["note1", "note2"] });
		});

		it("should parse response with json function", () => {
			const response = {
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: () => ({ notes: [{ title: "Note 1" }] }),
				text: "",
			} satisfies Partial<RequestUrlResponse>;
			const result = parseResponse(response as RequestUrlResponse);
			expect(result).toEqual({ notes: [{ title: "Note 1" }] });
		});

		it("should parse response with text property", () => {
			const response = {
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: undefined,
				text: JSON.stringify({ notes: [{ title: "Note 1" }] }),
			} satisfies Partial<RequestUrlResponse>;
			const result = parseResponse(response as RequestUrlResponse);
			expect(result).toEqual({ notes: [{ title: "Note 1" }] });
		});

		it("should return response if json and text are not present", () => {
			const response = {
				status: 200,
				headers: {},
				arrayBuffer: new ArrayBuffer(0),
				json: { notes: [{ title: "Note 1" }] },
				text: "",
			} satisfies Partial<RequestUrlResponse>;
			const result = parseResponse(response as RequestUrlResponse);
			expect(result).toEqual(response.json);
		});
	});
});
