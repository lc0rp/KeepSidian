jest.mock('obsidian');
import { App } from 'obsidian';
import { SyncProgressModal } from '../SyncProgressModal';
import type { LastSyncSummary } from '../../../types/keepsidian-plugin-settings';

describe('SyncProgressModal', () => {
    let app: App;

    beforeEach(() => {
        app = new App();
    });

    test('updates progress, summary, and action states', () => {
        const callbacks = {
            onTwoWaySync: jest.fn(),
            onImportOnly: jest.fn(),
            onUploadOnly: jest.fn(),
            onOpenSyncLog: jest.fn(),
        };
        const modal = new SyncProgressModal(app, callbacks);
        modal.onOpen();

        modal.setProgress(5, 10);
        expect(modal['statusEl']?.textContent).toContain('Processed 5 of 10 notes');
        expect(((modal as any).buttons.twoWay as HTMLButtonElement).disabled).toBe(true);
        expect(((modal as any).buttons.openLog as HTMLButtonElement).disabled).toBe(false);

        modal.setComplete(true, 5);
        const summary: LastSyncSummary = {
            timestamp: Date.now(),
            processedNotes: 5,
            totalNotes: 10,
            success: true,
            mode: 'import',
        };
        modal.setIdleSummary(summary);
        expect(((modal as any).buttons.twoWay as HTMLButtonElement).disabled).toBe(false);
        expect(modal['statusEl']?.textContent).toContain('Synced 5/10 notes');
    });
});
