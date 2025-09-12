jest.mock('obsidian');
import { App } from 'obsidian';
import { SyncProgressModal } from '../SyncProgressModal';

describe('SyncProgressModal', () => {
    let app: App;

    beforeEach(() => {
        app = new App();
    });

    test('should update progress and completion', () => {
        const modal = new SyncProgressModal(app);
        modal.onOpen();
        modal.setProgress(5);
        expect(modal['statsEl'].textContent).toContain('5');
        modal.setComplete(true, 5);
        expect(modal['statsEl'].textContent).toContain('Synced 5 notes');
    });
});
