import { requestUrl } from 'obsidian';
import { processAttachments } from '../attachments';
import KeepSidianPlugin from 'main';

// Mock the plugin
const mockPlugin = {
    app: {
        vault: {
            adapter: {
                writeBinary: jest.fn()
            }
        }
    }
} as unknown as KeepSidianPlugin;

// Mock requestUrl
jest.mock('obsidian', () => ({
    requestUrl: jest.fn()
}));

describe('processAttachments', () => {
    beforeEach(() => {
        // Clear all mocks before each test
        jest.clearAllMocks();
        // Add spy on console.error
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    it('should successfully process single attachment', async () => {
        // Mock successful blob response
        const mockArrayBuffer = new ArrayBuffer(8);
        (requestUrl as jest.Mock).mockResolvedValueOnce({
            arrayBuffer: mockArrayBuffer
        });

        const blobUrls = ['https://example.com/image1.jpg'];
        const saveLocation = '/test/location';

        await processAttachments(mockPlugin, blobUrls, saveLocation);

        // Verify requestUrl was called correctly
        expect(requestUrl).toHaveBeenCalledWith({
            url: 'https://example.com/image1.jpg',
            method: 'GET'
        });

        // Verify writeBinary was called correctly
        expect(mockPlugin.app.vault.adapter.writeBinary)
            .toHaveBeenCalledWith(
                '/test/location/media/image1.jpg',
                mockArrayBuffer
            );
    });

    it('should successfully process multiple attachments', async () => {
        // Mock successful blob responses
        const mockArrayBuffer1 = new ArrayBuffer(8);
        const mockArrayBuffer2 = new ArrayBuffer(8);
        
        (requestUrl as jest.Mock)
            .mockResolvedValueOnce({ arrayBuffer: mockArrayBuffer1 })
            .mockResolvedValueOnce({ arrayBuffer: mockArrayBuffer2 });

        const blobUrls = [
            'https://example.com/image1.jpg',
            'https://example.com/image2.png'
        ];
        const saveLocation = '/test/location';

        await processAttachments(mockPlugin, blobUrls, saveLocation);

        // Verify requestUrl was called correctly for both files
        expect(requestUrl).toHaveBeenCalledTimes(2);
        expect(requestUrl).toHaveBeenNthCalledWith(1, {
            url: 'https://example.com/image1.jpg',
            method: 'GET'
        });
        expect(requestUrl).toHaveBeenNthCalledWith(2, {
            url: 'https://example.com/image2.png',
            method: 'GET'
        });

        // Verify writeBinary was called correctly for both files
        expect(mockPlugin.app.vault.adapter.writeBinary)
            .toHaveBeenCalledTimes(2);
        expect(mockPlugin.app.vault.adapter.writeBinary)
            .toHaveBeenNthCalledWith(
                1,
                '/test/location/media/image1.jpg',
                mockArrayBuffer1
            );
        expect(mockPlugin.app.vault.adapter.writeBinary)
            .toHaveBeenNthCalledWith(
                2,
                '/test/location/media/image2.png',
                mockArrayBuffer2
            );
    });

    it('should handle empty blob URLs array', async () => {
        await processAttachments(mockPlugin, [], '/test/location');

        // Verify no calls were made
        expect(requestUrl).not.toHaveBeenCalled();
        expect(mockPlugin.app.vault.adapter.writeBinary).not.toHaveBeenCalled();
    });

    it('should handle network request failure', async () => {
        // Mock failed request
        (requestUrl as jest.Mock).mockRejectedValueOnce(
            new Error('Network error')
        );

        const blobUrls = ['https://example.com/image1.jpg'];
        const saveLocation = '/test/location';

        await expect(processAttachments(mockPlugin, blobUrls, saveLocation))
            .rejects
            .toThrow('Failed to download blob from https://example.com/image1.jpg.');

        // Verify requestUrl was called but writeBinary wasn't
        expect(requestUrl).toHaveBeenCalledTimes(1);
        expect(mockPlugin.app.vault.adapter.writeBinary).not.toHaveBeenCalled();
    });

    it('should handle file write failure', async () => {
        // Mock successful request but failed write
        const mockArrayBuffer = new ArrayBuffer(8);
        (requestUrl as jest.Mock).mockResolvedValueOnce({
            arrayBuffer: mockArrayBuffer
        });
        jest.spyOn(mockPlugin.app.vault.adapter, 'writeBinary').mockRejectedValueOnce(
            new Error('Write error')
        );

        const blobUrls = ['https://example.com/image1.jpg'];
        const saveLocation = '/test/location';

        await expect(processAttachments(mockPlugin, blobUrls, saveLocation))
            .rejects
            .toThrow('Failed to download blob from https://example.com/image1.jpg.');

        // Verify both functions were called
        expect(requestUrl).toHaveBeenCalledTimes(1);
        expect(mockPlugin.app.vault.adapter.writeBinary).toHaveBeenCalledTimes(1);
    });

    it('should handle invalid blob URLs', async () => {
        const blobUrls = ['invalid-url-no-filename'];
        const saveLocation = '/test/location';

        await processAttachments(mockPlugin, blobUrls, saveLocation);

        // Verify requestUrl was never called since URL validation fails first
        expect(requestUrl).not.toHaveBeenCalled();
        expect(mockPlugin.app.vault.adapter.writeBinary).not.toHaveBeenCalled();
        
        // Verify that console.error was called with the invalid URL message
        expect(console.error).toHaveBeenCalledWith('Invalid URL format: invalid-url-no-filename');
    });
});
