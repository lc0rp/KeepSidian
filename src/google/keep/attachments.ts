// attachments.ts
import KeepSidianPlugin from 'main';
import { requestUrl } from 'obsidian';

export async function processAttachments(plugin: KeepSidianPlugin, blobUrls: string[], saveLocation: string) {
    for (const blob_url of blobUrls) {
        try {
            // Validate URL format
            let url;
            try {
                url = new URL(blob_url);
            } catch {
                console.error(`Invalid URL format: ${blob_url}`);
                continue;
            }

            const blobResponse = await requestUrl({
                url: blob_url,
                method: 'GET',
            });
            const blobData = await blobResponse.arrayBuffer;
            const blobFileName = url.pathname.split('/').pop();
            if (blobFileName) {
                const blobFilePath = `${saveLocation}/media/${blobFileName}`;
                await plugin.app.vault.adapter.writeBinary(blobFilePath, blobData);
            }
        } catch (error) {
            console.error(error);
            throw new Error(`Failed to download blob from ${blob_url}.`);
        }
    }
}