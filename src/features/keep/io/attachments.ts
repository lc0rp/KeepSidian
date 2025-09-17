import { MEDIA_FOLDER_NAME } from '../../keep/constants';
import { httpGetArrayBuffer } from '../../../services/http';

// Minimal app interface to reduce coupling in tests and code
interface AdapterLike {
  writeBinary: (path: string, data: ArrayBuffer) => Promise<void> | void;
  exists?: (path: string) => Promise<boolean> | boolean;
  readBinary?: (path: string) => Promise<ArrayBuffer> | ArrayBuffer;
}
interface VaultLike { adapter: AdapterLike }
interface AppLike { vault: VaultLike }

export interface ProcessAttachmentsResult {
  downloaded: number;
  skippedIdentical: number;
}

function arrayBuffersAreEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }
  const viewA = new Uint8Array(a);
  const viewB = new Uint8Array(b);
  for (let i = 0; i < viewA.length; i += 1) {
    if (viewA[i] !== viewB[i]) {
      return false;
    }
  }
  return true;
}

export async function processAttachments(
  app: AppLike,
  blobUrls: string[],
  saveLocation: string
): Promise<ProcessAttachmentsResult> {
  const result: ProcessAttachmentsResult = {
    downloaded: 0,
    skippedIdentical: 0,
  };

  if (!blobUrls || blobUrls.length === 0) {
    return result;
  }

  const adapter = app?.vault?.adapter;
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
      if (!blobFileName || !adapter) {
        continue;
      }

      const blobFilePath = `${saveLocation}/${MEDIA_FOLDER_NAME}/${blobFileName}`;

      let shouldWrite = true;
      if (typeof adapter.exists === 'function') {
        try {
          const alreadyExists = await adapter.exists(blobFilePath);
          if (alreadyExists && typeof adapter.readBinary === 'function') {
            const existingData = await adapter.readBinary(blobFilePath);
            if (existingData && arrayBuffersAreEqual(existingData, blobData)) {
              shouldWrite = false;
              result.skippedIdentical += 1;
            }
          }
        } catch (existsError) {
          console.error(existsError);
          throw new Error(`Failed to download blob from ${blob_url}.`);
        }
      }

      if (shouldWrite) {
        await adapter.writeBinary(blobFilePath, blobData);
        result.downloaded += 1;
      }
    } catch (error) {
      console.error(error);
      throw new Error(`Failed to download blob from ${blob_url}.`);
    }
  }

  return result;
}
