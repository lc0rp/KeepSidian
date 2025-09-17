import { KEEPSIDIAN_SERVER_URL } from "../../../config";
import { httpGetArrayBuffer } from "../../../services/http";
import { buildMediaPath } from "../../../services/paths";

// Minimal app interface to reduce coupling in tests and code
interface AdapterLike {
	writeBinary: (path: string, data: ArrayBuffer) => Promise<void> | void;
	exists?: (path: string) => Promise<boolean> | boolean;
	readBinary?: (path: string) => Promise<ArrayBuffer> | ArrayBuffer;
}
interface VaultLike {
	adapter: AdapterLike;
}
interface AppLike {
	vault: VaultLike;
}

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

function resolveBlobUrl(blobUrl: string): URL | null {
	try {
		return new URL(blobUrl);
	} catch {
		if (!blobUrl || !blobUrl.trim()) {
			return null;
		}
		if (!blobUrl.trim().startsWith("/")) {
			return null;
		}
		try {
			const base = `${KEEPSIDIAN_SERVER_URL.replace(/\/$/, "")}/`;
			return new URL(blobUrl, base);
		} catch {
			return null;
		}
	}
}

function sanitizeFileName(fileName: string): string {
	return fileName.replace(/[\\/]/g, "_");
}

function deriveFileName(
	url: URL,
	index: number,
	blobNames?: string[]
): string | null {
	const nameFromBlobNames = blobNames?.[index]?.trim();
	if (nameFromBlobNames) {
		return sanitizeFileName(nameFromBlobNames);
	}
	const segments = url.pathname.split("/").filter(Boolean);
	const lastSegment = segments[segments.length - 1];
	if (!lastSegment) {
		return null;
	}
	try {
		return sanitizeFileName(decodeURIComponent(lastSegment));
	} catch {
		return sanitizeFileName(lastSegment);
	}
}

export async function processAttachments(
	app: AppLike,
	blobUrls: string[],
	saveLocation: string,
	blobNames?: string[]
): Promise<ProcessAttachmentsResult> {
	const result: ProcessAttachmentsResult = {
		downloaded: 0,
		skippedIdentical: 0,
	};

	if (!blobUrls || blobUrls.length === 0) {
		return result;
	}

	const adapter = app?.vault?.adapter;
	for (const [index, blob_url] of blobUrls.entries()) {
		try {
			const resolvedUrl = resolveBlobUrl(blob_url);
			if (!resolvedUrl) {
				console.error(`Invalid URL format: ${blob_url}`);
				continue;
			}

			if (!adapter) {
				continue;
			}

			const fileName = deriveFileName(resolvedUrl, index, blobNames);
			if (!fileName) {
				console.error(
					`Could not determine filename for attachment at ${resolvedUrl.href}`
				);
				continue;
			}

			const blobData = await httpGetArrayBuffer(resolvedUrl.href);
			const blobFilePath = buildMediaPath(saveLocation, fileName);

			let shouldWrite = true;
			if (typeof adapter.exists === "function") {
				try {
					const alreadyExists = await adapter.exists(blobFilePath);
					if (
						alreadyExists &&
						typeof adapter.readBinary === "function"
					) {
						const existingData = await adapter.readBinary(
							blobFilePath
						);
						if (
							existingData &&
							arrayBuffersAreEqual(existingData, blobData)
						) {
							shouldWrite = false;
							result.skippedIdentical += 1;
						}
					}
				} catch (existsError) {
					console.error(existsError);
					throw new Error(
						`Failed to download blob from ${blob_url}.`
					);
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
