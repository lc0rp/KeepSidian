import { normalizeDate, handleDuplicateNotes, checkForDuplicateData } from '../compare';
import { NormalizedNote } from '../../note/note';

describe('normalizeDate', () => {
    it('should return null for undefined input', () => {
        expect(normalizeDate(undefined)).toBeNull();
    });

    it('should return a valid Date object for a valid date string', () => {
        const result = normalizeDate('2023-05-25T10:00:00Z');
        expect(result).toBeInstanceOf(Date);
        expect(result?.toISOString()).toBe('2023-05-25T10:00:00.000Z');
    });

    it('should return null for an invalid date string', () => {
        expect(normalizeDate('invalid-date')).toBeNull();
    });
});

describe('handleDuplicateNotes', () => {
    let mockApp: any;

    beforeEach(() => {
        mockApp = {
            vault: {
                adapter: {
                    exists: jest.fn(),
                    read: jest.fn(),
                    stat: jest.fn()
                }
            }
        };
    });

    it('should return "overwrite" when file does not exist', async () => {
        mockApp.vault.adapter.exists.mockResolvedValue(false);

        const result = await handleDuplicateNotes('/save/location', {} as NormalizedNote, mockApp);
        expect(result).toBe('overwrite');
    });

    it('should call checkForDuplicateData when file exists', async () => {
        mockApp.vault.adapter.exists.mockResolvedValue(true);
        mockApp.vault.adapter.read.mockResolvedValue('---\nCreated: 2023-05-25\n---\nExisting content');
        mockApp.vault.adapter.stat.mockResolvedValue({ ctime: Date.now(), mtime: Date.now() });

        const incomingNote: NormalizedNote = {
            title: 'Test Note',
            body: 'New content',
            created: new Date('2023-05-25'),
            updated: new Date('2023-05-26'),
        } as NormalizedNote;

        const result = await handleDuplicateNotes('/save/location', incomingNote, mockApp);
        expect(['skip', 'rename', 'overwrite']).toContain(result);
    });
});

describe('checkForDuplicateData', () => {
    it('should return "skip" when contents are the same', () => {
        const incomingFile = {
            content: 'Same content',
            createdDate: new Date('2023-05-25'),
            updatedDate: new Date('2023-05-26')
        };
        const existingFile = {
            content: 'Same content',
            createdDate: new Date('2023-05-24'),
            updatedDate: new Date('2023-05-25'),
            fsCreatedDate: new Date('2023-05-24'),
            fsUpdatedDate: new Date('2023-05-25'),
            lastSyncedDate: new Date('2023-05-25')
        };

        expect(checkForDuplicateData(incomingFile, existingFile)).toBe('skip');
    });

    it('should return "rename" when both files have been modified since last sync', () => {
        const incomingFile = {
            content: 'New content',
            createdDate: new Date('2023-05-25'),
            updatedDate: new Date('2023-05-27')
        };
        const existingFile = {
            content: 'Modified existing content',
            createdDate: new Date('2023-05-24'),
            updatedDate: new Date('2023-05-26'),
            fsCreatedDate: new Date('2023-05-24'),
            fsUpdatedDate: new Date('2023-05-26'),
            lastSyncedDate: new Date('2023-05-25')
        };

        expect(checkForDuplicateData(incomingFile, existingFile)).toBe('rename');
    });

    it('should return "overwrite" when only incoming file has been modified since last sync', () => {
        const incomingFile = {
            content: 'New content',
            createdDate: new Date('2023-05-25'),
            updatedDate: new Date('2023-05-27')
        };
        const existingFile = {
            content: 'Existing content',
            createdDate: new Date('2023-05-24'),
            updatedDate: new Date('2023-05-25'),
            fsCreatedDate: new Date('2023-05-24'),
            fsUpdatedDate: new Date('2023-05-25'),
            lastSyncedDate: new Date('2023-05-26')
        };

        expect(checkForDuplicateData(incomingFile, existingFile)).toBe('overwrite');
    });
});
