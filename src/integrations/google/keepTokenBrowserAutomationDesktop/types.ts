export type AutomationEngine = "puppeteer" | "playwright";

export interface AutomationResult {
	oauth_token: string;
	engine?: string;
	url?: string;
	timestamp?: string;
}

export interface AutomationOptions {
	useSystemBrowser?: boolean;
	debug?: boolean;
	timeoutMinutes?: number;
}

export type LogLevel = "info" | "warn" | "error" | "debug";

export type AutomationLogEvent = (
	level: LogLevel,
	message: string,
	metadata?: Record<string, unknown>
) => void;

export type AutomationPage = {
	evaluate: <T, Arg = void>(pageFunction: (arg: Arg) => T, arg?: Arg) => Promise<T>;
	$eval: <T, Arg = void>(
		selector: string,
		pageFunction: (el: Element, arg: Arg) => T,
		arg?: Arg
	) => Promise<T>;
	on: (event: string, listener: (...args: unknown[]) => void) => void;
	url: () => string;
	goto: (url: string, options?: { waitUntil?: "domcontentloaded" | "load" }) => Promise<unknown>;
	isClosed?: () => boolean;
	bringToFront?: () => Promise<void>;
};

export type CookieSnapshot = {
	name: string;
	value: string;
	domain?: string;
	path?: string;
};

export type ScreenState = {
	url: string;
	title: string;
	isChallengeUrl: boolean;
	hasEmailInput: boolean;
	hasPasswordInput: boolean;
	hasAccountChooser: boolean;
	hasSmsInput: boolean;
	hasTotpInput: boolean;
	hasSecurityKey: boolean;
	hasPrompt: boolean;
	hasBackupCode: boolean;
	hasTryAnotherWay: boolean;
	hasConsent: boolean;
	hasCaptcha: boolean;
	blocked: boolean;
	challengeOptions: string[];
};

export type OverlayPayload = {
	key: string;
	title: string;
	message: string;
	steps: string[];
	status: string;
};
