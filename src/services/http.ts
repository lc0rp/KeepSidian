import { requestUrl } from "obsidian";
import { NetworkError, ParseError } from "@services/errors";

export interface HttpOptions {
	headers?: Record<string, string>;
}

export interface HttpRequestOptions extends HttpOptions {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	body?: unknown;
}

// Defensive JSON parsing for Obsidian's requestUrl response shape variations
async function parseJsonDefensively<T>(response: any): Promise<T> {
	try {
		const maybeJson = (response as any).json;
		if (typeof maybeJson === "function") {
			return await maybeJson.call(response);
		}
		if (maybeJson !== undefined) {
			return maybeJson as T;
		}
		const text = (response as any).text ?? "";
		return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
	} catch (e) {
		throw new ParseError("Failed to parse JSON response", e);
	}
}

export async function httpRequest<T = unknown>(
	url: string,
	options: HttpRequestOptions = {}
): Promise<T> {
	const { method = "GET", headers = {}, body } = options;
	const reqInit: any = {
		url,
		method,
		headers,
	};

	if (body !== undefined) {
		reqInit.body = typeof body === "string" ? body : JSON.stringify(body);
		reqInit.headers = {
			"Content-Type": "application/json",
			...headers,
		};
	}

	const response = await requestUrl(reqInit);
	const status: number = (response as any).status ?? 0;
	if (status < 200 || status >= 300) {
		// Try to extract error message from body, but don't fail parsing again here
		let errMsg = `Server returned status ${status}`;
		try {
			const errJson = await parseJsonDefensively<any>(response);
			if (errJson && (errJson.error || errJson.message)) {
				errMsg = errJson.error || errJson.message;
			}
		} catch {
			/* empty */
		}
		throw new NetworkError(errMsg, status);
	}

	return await parseJsonDefensively<T>(response);
}

export async function httpGetJson<T = unknown>(
	url: string,
	headers?: Record<string, string>
): Promise<T> {
	return httpRequest<T>(url, { method: "GET", headers });
}

export async function httpPostJson<TRes = unknown, TReq = unknown>(
	url: string,
	body: TReq,
	headers?: Record<string, string>
): Promise<TRes> {
	return httpRequest<TRes>(url, { method: "POST", headers, body });
}

// Returns the raw response without status checking. Useful for endpoints that
// intentionally use 3xx or non-JSON payloads that the caller will handle.
export async function httpGetRaw(
	url: string,
	headers?: Record<string, string>
): Promise<any> {
	return requestUrl({ url, method: "GET", headers });
}

// Fetch a binary payload as an ArrayBuffer with status checking.
export async function httpGetArrayBuffer(
	url: string,
	headers?: Record<string, string>
): Promise<ArrayBuffer> {
	const response = await requestUrl({ url, method: "GET", headers });
	const statusRaw = (response as any).status;
	if (typeof statusRaw === "number") {
		const status = statusRaw as number;
		if (status < 200 || status >= 300) {
			let errMsg = `Server returned status ${status}`;
			try {
				const text = (response as any).text ?? "";
				if (text) {
					const errJson = JSON.parse(text);
					if (errJson && (errJson.error || errJson.message)) {
						errMsg = errJson.error || errJson.message;
					}
				}
			} catch {
				/* empty */
			}
			throw new NetworkError(errMsg, status);
		}
	}
	const maybe = (response as any).arrayBuffer;
	if (typeof maybe === "function") {
		return await maybe.call(response);
	}
	if (maybe !== undefined) {
		return maybe as ArrayBuffer;
	}
	throw new Error("No binary content in response");
}
