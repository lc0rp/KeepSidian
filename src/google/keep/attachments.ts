// attachments.ts
import { requestUrl } from 'obsidian';
import { MEDIA_FOLDER_NAME } from '../../features/keep/constants';

interface VaultAdapterLike {
  writeBinary: (path: string, data: ArrayBuffer) => Promise<void> | void;
}

interface VaultLike {
  adapter: VaultAdapterLike;
}

interface AppLike {
  vault: VaultLike;
}

export async function processAttachments(app: AppLike, blobUrls: string[], saveLocation: string) {
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
                const blobFilePath = `${saveLocation}/${MEDIA_FOLDER_NAME}/${blobFileName}`;
                await app.vault.adapter.writeBinary(blobFilePath, blobData);
            }
        } catch (error) {
            console.error(error);
            throw new Error(`Failed to download blob from ${blob_url}.`);
        }
    }
}
