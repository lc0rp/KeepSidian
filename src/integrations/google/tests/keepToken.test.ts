import { exchangeOauthToken } from "../keepToken";
import { initRetrieveToken } from "../keepTokenDesktop";
import { WebviewTag } from "electron";
import type { ConsoleMessageEvent } from "electron";
import * as obsidian from "obsidian";
import KeepSidianPlugin from "main";
import { KeepSidianSettingsTab } from "ui/settings/KeepSidianSettingsTab";

// Mock obsidian
jest.mock("obsidian", () => ({
	...jest.requireActual("obsidian"),
	requestUrl: jest.fn(),
	Notice: jest.fn(),
	Platform: { isDesktopApp: true, isMobileApp: false },
}));

// Mock the main plugin
jest.mock("main");

describe("Token Management", () => {
	let plugin: jest.Mocked<KeepSidianPlugin>;
	let settingsTab: jest.Mocked<KeepSidianSettingsTab>;
	let retrieveTokenWebview: jest.Mocked<WebviewTag>;
	let eventHandlers: Record<string, Array<(event: unknown) => void>>;

	beforeEach(() => {
		jest.clearAllMocks();
		eventHandlers = {};

		(window as unknown as { require?: jest.Mock }).require = jest
			.fn()
			.mockReturnValue({
				session: {
					fromPartition: jest.fn().mockReturnValue({
						cookies: {
							get: jest.fn().mockResolvedValue([]),
						},
					}),
				},
			});

		plugin = {
			settings: {
				email: "test@example.com",
				token: "",
				keepSidianLastSuccessfulSyncDate: null,
			},
			saveSettings: jest.fn().mockResolvedValue(undefined),
		} as unknown as jest.Mocked<KeepSidianPlugin>;

		settingsTab = {
			display: jest.fn(),
			updateRetrieveTokenInstructions: jest.fn(),
			updateRetrieveTokenStatus: jest.fn(),
			updateRetrieveTokenAction: jest.fn(),
		} as unknown as jest.Mocked<KeepSidianSettingsTab>;

		retrieveTokenWebview = {
			loadURL: jest.fn().mockResolvedValue(undefined),
			show: jest.fn(),
			hide: jest.fn(),
			getURL: jest.fn(),
			executeJavaScript: jest.fn(),
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
			openDevTools: jest.fn(),
			closeDevTools: jest.fn(),
			isLoading: jest.fn().mockReturnValue(false),
			src: "",
		} as unknown as jest.Mocked<WebviewTag>;

		(retrieveTokenWebview.addEventListener as jest.Mock).mockImplementation(
			(event: string, handler: EventListener) => {
				if (typeof handler === "function") {
					(eventHandlers[event] ??= []).push(handler as (event: unknown) => void);
					if (event === "dom-ready") {
						handler(new Event("dom-ready"));
					}
				}
			}
		);

		(retrieveTokenWebview.removeEventListener as jest.Mock).mockImplementation(
			(event: string, handler: EventListener) => {
				const handlers = eventHandlers[event];
				if (!handlers) {
					return;
				}
				eventHandlers[event] = handlers.filter((stored) => stored !== handler);
			}
		);
	});

	describe("exchangeOauthToken", () => {
		beforeEach(() => {
			(obsidian.requestUrl as jest.Mock).mockReset();
		});

		it("should successfully exchange OAuth token", async () => {
			const mockKeepToken = "mock-keep-token";
			const mockOAuthToken = "mock-oauth-token";

			(obsidian.requestUrl as jest.Mock).mockResolvedValueOnce({
				status: 200,
				json: {
					keep_token: mockKeepToken,
				},
			});

			await exchangeOauthToken(settingsTab, plugin, mockOAuthToken);

			expect(plugin.settings.token).toBe(mockKeepToken);
			expect(plugin.saveSettings).toHaveBeenCalled();
			expect(settingsTab.display).toHaveBeenCalled();
		});

		it("should handle server errors", async () => {
			(obsidian.requestUrl as jest.Mock).mockResolvedValueOnce({
				status: 500,
				json: {},
			});

			await expect(
				exchangeOauthToken(settingsTab, plugin, "mock-oauth-token")
			).rejects.toThrow("Server returned status 500");

			expect(obsidian.Notice).toHaveBeenCalledWith(
				expect.stringContaining("Failed to exchange OAuth token")
			);
		});

		it("should handle invalid response format", async () => {
			(obsidian.requestUrl as jest.Mock).mockResolvedValueOnce({
				status: 200,
				json: {
					some_other_field: "value",
				},
			});

			await expect(
				exchangeOauthToken(settingsTab, plugin, "mock-oauth-token")
			).rejects.toThrow("Failed to parse server response: Error: Invalid response format");
		});
	});

	describe("initRetrieveToken", () => {
		it("should handle successful token retrieval", async () => {
			const mockOAuthToken = "mock-oauth-token";
			const onOauthToken = jest.fn().mockResolvedValue(undefined);

			// Mock getURL to return the desired URL every time it's called
			retrieveTokenWebview.getURL.mockReturnValue("accounts.google.com");

			// Mock executeJavaScript to resolve immediately
			retrieveTokenWebview.executeJavaScript.mockResolvedValue(undefined);

			// Mock setInterval to immediately invoke the callback
			const setIntervalSpy = jest.spyOn(global, "setInterval").mockImplementation(((
				callback: TimerHandler,
				_ms?: number,
				...args: unknown[]
			) => {
				if (typeof callback === "function") {
					callback(...(args as []));
				}
				return 1 as unknown as ReturnType<typeof setInterval>;
			}) as typeof setInterval);

			// Start the token retrieval process
			const initPromise = initRetrieveToken(
				settingsTab,
				plugin,
				retrieveTokenWebview,
				onOauthToken
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			const consoleHandlers = eventHandlers["console-message"] ?? [];
			for (const handler of consoleHandlers) {
				handler({
					message: `oauthToken: ${mockOAuthToken}`,
				} as ConsoleMessageEvent);
			}
			await initPromise;
			setIntervalSpy.mockRestore();

			// Assertions
			expect(settingsTab.updateRetrieveTokenInstructions).toHaveBeenCalledWith(
				1,
				"Log in with Google",
				expect.stringContaining("Sign in with the Google account you use for Keep."),
				[]
			);
			expect(settingsTab.updateRetrieveTokenStatus).toHaveBeenCalledWith(
				expect.stringContaining("Loading Google login page"),
				"info"
			);
			expect(onOauthToken).toHaveBeenCalledWith(mockOAuthToken);
			const loadedWithLoadUrl = retrieveTokenWebview.loadURL.mock.calls.length > 0;
			const loadedViaSrc =
				retrieveTokenWebview.loadURL.mock.calls.length === 0 &&
				(retrieveTokenWebview as unknown as { src?: string }).src ===
					"https://accounts.google.com/EmbeddedSetup";
			expect(loadedWithLoadUrl || loadedViaSrc).toBe(true);
			expect(retrieveTokenWebview.show).toHaveBeenCalled();
			expect(retrieveTokenWebview.executeJavaScript).toHaveBeenCalled();
			expect(retrieveTokenWebview.addEventListener).toHaveBeenCalledWith(
				"console-message",
				expect.any(Function)
			);
		});

		it("should reopen DevTools from step 3 action", async () => {
			const mockOAuthToken = "mock-oauth-token";
			const onOauthToken = jest.fn().mockResolvedValue(undefined);

			retrieveTokenWebview.getURL.mockReturnValue("accounts.google.com");
			retrieveTokenWebview.executeJavaScript.mockResolvedValue(undefined);

			const setIntervalSpy = jest.spyOn(global, "setInterval").mockImplementation(((
				callback: TimerHandler,
				_ms?: number,
				...args: unknown[]
			) => {
				if (typeof callback === "function") {
					callback(...(args as []));
				}
				return 1 as unknown as ReturnType<typeof setInterval>;
			}) as typeof setInterval);

			const initPromise = initRetrieveToken(
				settingsTab,
				plugin,
				retrieveTokenWebview,
				onOauthToken
			);
			await new Promise((resolve) => setTimeout(resolve, 0));

			const consoleHandlers = eventHandlers["console-message"] ?? [];
			for (const handler of consoleHandlers) {
				handler({
					message: "buttonClicked",
				} as ConsoleMessageEvent);
			}

			await new Promise((resolve) => setTimeout(resolve, 0));

			const actionCalls = (settingsTab.updateRetrieveTokenAction as jest.Mock).mock
				.calls;
			const action = actionCalls
				.map((call) => call[0] as { label?: string; onClick?: () => void } | null)
				.find((candidate) => candidate?.label === "(Re)Open DevTools");
			expect(action).toBeTruthy();
			action?.onClick?.();
			expect(retrieveTokenWebview.closeDevTools).toHaveBeenCalled();
			expect(retrieveTokenWebview.openDevTools).toHaveBeenCalled();

			for (const handler of consoleHandlers) {
				handler({
					message: `oauthToken: ${mockOAuthToken}`,
				} as ConsoleMessageEvent);
			}

			await initPromise;
			setIntervalSpy.mockRestore();
		});

		it("should handle errors during token retrieval", async () => {
			const error = new Error("Failed to retrieve token");
			(retrieveTokenWebview as unknown as { loadURL?: unknown }).loadURL = undefined;
			Object.defineProperty(
				retrieveTokenWebview,
				"src",
				{
					get: () => "",
					set: () => {
						throw error;
					},
					configurable: true,
				}
			);

			await expect(
				initRetrieveToken(settingsTab, plugin, retrieveTokenWebview)
			).rejects.toThrow("Failed to retrieve token");
		});
	});
});
