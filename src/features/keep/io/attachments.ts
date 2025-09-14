import { MEDIA_FOLDER_NAME } from '../../keep/constants';
import { httpGetArrayBuffer } from '../../../services/http';

// Minimal app interface to reduce coupling in tests and code
interface AdapterLike {
  writeBinary: (path: string, data: ArrayBuffer) => Promise<void> | void;
}
interface VaultLike { adapter: AdapterLike }
interface AppLike { vault: VaultLike }

export async function processAttachments(app: any, blobUrls: string[], saveLocation: string) {
  for (const blob_url of blobUrls) {
    try {
      let url: URL;
      try {
        url = new URL(blob_url);
      } catch {
        console.error(`Invalid URL format: ${blob_url}`);
        continue;
      }

      const blobData = await httpGetArrayBuffer(blob_url);
      const blobFileName = url.pathname.split('/').pop();
      if (blobFileName) {
        const blobFilePath = `${saveLocation}/${MEDIA_FOLDER_NAME}/${blobFileName}`;
        await (app as any).vault.adapter.writeBinary(blobFilePath, blobData);
      }
    } catch (error) {
      console.error(error);
      throw new Error(`Failed to download blob from ${blob_url}.`);
    }
  }
}
