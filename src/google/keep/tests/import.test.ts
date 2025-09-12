jest.mock('obsidian', () => ({
    requestUrl: jest.fn(),
    normalizePath: jest.fn(),
    Notice: jest.fn(),
}));
import { requestUrl, RequestUrlResponse, Notice } from 'obsidian';
import * as obsidian from 'obsidian';
import {
    importGoogleKeepNotes,
    importGoogleKeepNotesWithOptions,
    convertOptionsToFeatureFlags,
    processAndSaveNotes,
    parseResponse,
} from '../import';
import { handleDuplicateNotes } from '../compare';
import KeepSidianPlugin from 'main';
import { NoteImportOptions } from 'components/NoteImportOptionsModal';
import * as noteModule from '../note';
import * as compareModule from '../compare';
import * as importModule from '../import';
import * as attachmentsModule from '../attachments';

// Mock the external modules
jest.mock('../compare');
jest.mock('main');

describe('Google Keep Import Functions', () => {
    let mockPlugin: jest.Mocked<KeepSidianPlugin>;
    
    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
        
        // Setup mock plugin
        mockPlugin = {
            settings: {
                email: 'test@example.com',
                token: 'test-token',
                saveLocation: 'Test Folder'
            },
            app: {
                vault: {
                    adapter: {
                        exists: jest.fn().mockImplementation(() => Promise.resolve(false)),
                        write: jest.fn(),
                        writeBinary: jest.fn(),
                        read: jest.fn()
                    },
                    createFolder: jest.fn()
                }
            }
        } as unknown as jest.Mocked<KeepSidianPlugin>;
        
        // Mock requestUrl default success response
        (requestUrl as jest.Mock).mockResolvedValue({
            status: 200,
            headers: {},
            arrayBuffer: new ArrayBuffer(0),
            json: () => ({ notes: [] }),
            text: '{"notes": []}'
        } as RequestUrlResponse);
    });

    describe('importGoogleKeepNotes', () => {
        it('should successfully import notes', async () => {
            await expect(importGoogleKeepNotes(mockPlugin)).resolves.toBe(0);
            expect(requestUrl).toHaveBeenCalled();
            expect(Notice).toHaveBeenCalledWith('Imported Google Keep notes.');
        });

        it('should handle errors during import', async () => {
            (requestUrl as jest.Mock).mockRejectedValue(new Error('Network error'));
            await expect(importGoogleKeepNotes(mockPlugin)).rejects.toThrow('Network error');
            expect(Notice).toHaveBeenCalledWith('Failed to import notes.');
        });
    });

    describe('importGoogleKeepNotesWithOptions', () => {
        const mockOptions: NoteImportOptions = {
            includeNotesTerms: ['important'],
            excludeNotesTerms: ['draft'],
            updateTitle: true,
            suggestTags: true,
            maxTags: 3,
            limitToExistingTags: true,
            tagPrefix: 'auto-'
        };

        it('should import notes with premium features', async () => {
            await importGoogleKeepNotesWithOptions(mockPlugin, mockOptions);
            expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
                url: expect.stringContaining('/premium'),
                method: 'POST'
            }));
        });

        it('should handle errors with premium features', async () => {
            (requestUrl as jest.Mock).mockRejectedValue(new Error('Premium feature error'));
            await expect(importGoogleKeepNotesWithOptions(mockPlugin, mockOptions)).rejects.toThrow('Premium feature error');
            expect(Notice).toHaveBeenCalledWith('Failed to import notes.');
        });
    });

    describe('convertOptionsToFeatureFlags', () => {
        it('should convert all options correctly', () => {
            const options: NoteImportOptions = {
                includeNotesTerms: ['term1', 'term2'],
                excludeNotesTerms: ['exclude1'],
                updateTitle: true,
                suggestTags: true,
                maxTags: 10,
                limitToExistingTags: true,
                tagPrefix: 'tag-',
            };
            const featureFlags = convertOptionsToFeatureFlags(options);
            expect(featureFlags).toEqual({
                filter_notes: { terms: ['term1', 'term2'] },
                skip_notes: { terms: ['exclude1'] },
                suggest_title: {},
                suggest_tags: {
                    max_tags: 10,
                    restrict_tags: true,
                    prefix: 'tag-',
                },
            });
        });

        it('should handle empty options', () => {
            const options: NoteImportOptions = {};
            const flags = convertOptionsToFeatureFlags(options);
            expect(flags).toEqual({});
        });

        it('should handle partial options', () => {
            const options: NoteImportOptions = {
                updateTitle: true,
            };
            const featureFlags = convertOptionsToFeatureFlags(options);
            expect(featureFlags).toEqual({
                suggest_title: {},
            });
        });
    });

    describe('processAndSaveNotes', () => {
        const mockNotes = [{
            title: 'Test Note',
            textContent: 'Test content',
            labels: ['test'],
            color: 'WHITE',
            isArchived: false,
            isPinned: false,
            isTrashed: false,
            lastModified: new Date().toISOString()
        }];

        it('should create folders if they don\'t exist', async () => {
            await processAndSaveNotes(mockPlugin, mockNotes);
            
            expect(mockPlugin.app.vault.adapter.exists).toHaveBeenCalledWith('Test Folder');
            expect(mockPlugin.app.vault.adapter.exists).toHaveBeenCalledWith('Test Folder/media');
            expect(mockPlugin.app.vault.createFolder).toHaveBeenCalledTimes(2);
        });

        it('should process each note', async () => {
            (handleDuplicateNotes as jest.Mock).mockResolvedValue('create');
            
            await processAndSaveNotes(mockPlugin, mockNotes);
            
            expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalled();
        });
    });

    describe('processAndSaveNote', () => {
        const note: noteModule.PreNormalizedNote = { title: 'Note 1', body: 'Content 1', frontmatterDict: {} };
        const normalizedNote: noteModule.NormalizedNote = {
            title: 'Note 1', body: 'Content 1', frontmatterDict: {},
            text: '',
            created: null,
            updated: null,
            frontmatter: '',
            archived: false,
            trashed: false,
            labels: [],
            blobs: [],
            blob_urls: [],
            blob_names: [],
            media: [],
            header: ''
        };

        it('should process and save note without duplicates or attachments', async () => {
            
            jest.spyOn(noteModule, 'normalizeNote').mockReturnValue(normalizedNote);
            jest.spyOn(compareModule, 'handleDuplicateNotes').mockResolvedValue('overwrite');
            jest.spyOn(mockPlugin.app.vault.adapter, 'write').mockResolvedValue(undefined);
            jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2023-01-01T00:00:00.000Z');
            jest.spyOn(obsidian, 'normalizePath').mockReturnValue(`${mockPlugin.settings.saveLocation}/${note.title}.md`);
            await importModule.processAndSaveNote(mockPlugin, note, mockPlugin.settings.saveLocation);
            
            const expectedFilePath = `${mockPlugin.settings.saveLocation}/${note.title}.md`;
            expect(noteModule.normalizeNote).toHaveBeenCalledWith(note);
            expect(compareModule.handleDuplicateNotes).toHaveBeenCalledWith(expectedFilePath, normalizedNote, mockPlugin.app);
            expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalled();
        });

        it('should skip note if duplicate action is skip', async () => {
            jest.spyOn(noteModule, 'normalizeNote').mockReturnValue(normalizedNote);
            jest.spyOn(compareModule, 'handleDuplicateNotes').mockResolvedValue('skip');

            await importModule.processAndSaveNote(mockPlugin, note, mockPlugin.settings.saveLocation);

            expect(mockPlugin.app.vault.adapter.write).not.toHaveBeenCalled();
        });

        it('should merge note file if duplicate action is rename and merge succeeds', async () => {
            const existingContent = `---\nExisting: true\n---\nLine 1`;
            const incomingNote: noteModule.PreNormalizedNote = { title: 'Note 1', body: 'Line 1\nLine 2', frontmatterDict: { Incoming: 'true' } };
            const incomingNormalized: noteModule.NormalizedNote = {
                ...normalizedNote,
                body: 'Line 1\nLine 2',
                frontmatterDict: { Incoming: 'true' }
            };

            jest.spyOn(noteModule, 'normalizeNote').mockReturnValue(incomingNormalized);
            jest.spyOn(compareModule, 'handleDuplicateNotes').mockResolvedValue('rename');
            jest.spyOn(mockPlugin.app.vault.adapter, 'read').mockResolvedValue(existingContent);
            jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2023-01-01T00:00:00.000Z');
            jest.spyOn(obsidian, 'normalizePath').mockReturnValue(`${mockPlugin.settings.saveLocation}/${incomingNote.title}.md`);

            await importModule.processAndSaveNote(mockPlugin, incomingNote, mockPlugin.settings.saveLocation);

            const expectedFilePath = `${mockPlugin.settings.saveLocation}/${incomingNote.title}.md`;
            const expectedContent = `---\nExisting: true\nKeepSidianLastSyncedDate: 2023-01-01T00:00:00.000Z\n---\nLine 1\nLine 2`;
            expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith(expectedFilePath, expectedContent);
        });

        it('should rename note file if merge has conflicts', async () => {
            const existingContent = `---\nExisting: true\n---\nLine 1\nLine A`;
            const incomingNote: noteModule.PreNormalizedNote = { title: 'Note 1', body: 'Line 1\nLine B', frontmatterDict: { Incoming: 'true' } };
            const incomingNormalized: noteModule.NormalizedNote = {
                ...normalizedNote,
                body: 'Line 1\nLine B',
                frontmatterDict: { Incoming: 'true' }
            };

            jest.spyOn(noteModule, 'normalizeNote').mockReturnValue(incomingNormalized);
            jest.spyOn(compareModule, 'handleDuplicateNotes').mockResolvedValue('rename');
            jest.spyOn(mockPlugin.app.vault.adapter, 'read').mockResolvedValue(existingContent);
            jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2023-01-01T00:00:00.000Z');
            jest.spyOn(obsidian, 'normalizePath').mockReturnValue(`${mockPlugin.settings.saveLocation}/${incomingNote.title}.md`);

            await importModule.processAndSaveNote(mockPlugin, incomingNote, mockPlugin.settings.saveLocation);

            const expectedFilePath = `${mockPlugin.settings.saveLocation}/${incomingNote.title}-conflict-2023-01-01T00:00:00.000Z.md`;
            expect(mockPlugin.app.vault.adapter.write).toHaveBeenCalledWith(expectedFilePath, expect.any(String));
        });

        it('should process attachments if present', async () => {
            const preNormalizedNote: noteModule.PreNormalizedNote = {
                title: 'Note 1',
                body: 'Content 1',
                frontmatterDict: {},
                blob_urls: ['http://example.com/blob1', 'http://example.com/blob2']
            };
            const normalizedNoteWithAttachments = {
                ...normalizedNote,
                blob_urls: ['http://example.com/blob1', 'http://example.com/blob2']
            };
            
            jest.spyOn(noteModule, 'normalizeNote').mockReturnValue(normalizedNoteWithAttachments);
            jest.spyOn(compareModule, 'handleDuplicateNotes').mockResolvedValue('overwrite');
            const processAttachmentsSpy = jest.spyOn(attachmentsModule, 'processAttachments').mockResolvedValue(undefined);

            await importModule.processAndSaveNote(mockPlugin, preNormalizedNote, mockPlugin.settings.saveLocation);

            expect(processAttachmentsSpy).toHaveBeenCalledWith(mockPlugin, preNormalizedNote.blob_urls, mockPlugin.settings.saveLocation);
        });
    });

    describe('parseResponse', () => {
        it('should parse JSON response using json() method', async () => {
            const mockResponse: Partial<RequestUrlResponse> = {
                status: 200,
                headers: {},
                arrayBuffer: new ArrayBuffer(0),
                json: () => ({ notes: ['note1', 'note2'] }),
                text: ''
            };
            
            const result = parseResponse(mockResponse as RequestUrlResponse);
            expect(result).toEqual({ notes: ['note1', 'note2'] });
        });

        it('should parse response with json function', () => {
            const response = {
                json: () => ({ notes: [{ title: 'Note 1' }] }),
            } as any;
            const result = parseResponse(response);
            expect(result).toEqual({ notes: [{ title: 'Note 1' }] });
        });

        it('should parse response with text property', () => {
            const response = {
                text: JSON.stringify({ notes: [{ title: 'Note 1' }] }),
            } as any;
            const result = parseResponse(response);
            expect(result).toEqual({ notes: [{ title: 'Note 1' }] });
        });

        it('should return response if json and text are not present', () => {
            const response = { notes: [{ title: 'Note 1' }] } as any;
            const result = parseResponse(response);
            expect(result).toEqual(response);
        });
    });
});
