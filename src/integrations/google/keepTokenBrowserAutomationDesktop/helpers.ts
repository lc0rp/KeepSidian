import type { CookieSnapshot } from "./types";

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const extractOauthToken = (cookies: CookieSnapshot[]) => {
	const oauthCookie = cookies.find((cookie) => cookie.name === "oauth_token");
	return oauthCookie?.value;
};

export const resolveChannels = () => {
	if (process.platform === "win32") {
		return ["msedge", "chrome"];
	}
	if (process.platform === "darwin") {
		return ["chrome", "msedge"];
	}
	return ["chrome", "chromium"];
};
