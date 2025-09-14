// Helpers to stub Obsidian's requestUrl in tests
import * as obsidian from "obsidian";

type Headers = Record<string, string>;

function baseResponse(status: number, headers: Headers = {}) {
  return {
    status,
    headers,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as any;
}

export function mockRequestUrlJsonOnce(json: unknown, status = 200, headers: Headers = {}) {
  return jest.spyOn(obsidian as any, "requestUrl").mockResolvedValueOnce({
    ...baseResponse(status, headers),
    json: async () => json,
    text: JSON.stringify(json),
  });
}

export function mockRequestUrlTextOnce(text: string, status = 200, headers: Headers = {}) {
  return jest.spyOn(obsidian as any, "requestUrl").mockResolvedValueOnce({
    ...baseResponse(status, headers),
    text,
  });
}

export function mockRequestUrlStatusOnce(status: number, body?: unknown, headers: Headers = {}) {
  const text = body ? JSON.stringify(body) : "";
  return jest.spyOn(obsidian as any, "requestUrl").mockResolvedValueOnce({
    ...baseResponse(status, headers),
    text,
  });
}

export function restoreRequestUrlMock() {
  jest.restoreAllMocks();
}

