import type KeepSidianPlugin from "main";
import { runOauthBrowserAutomation } from "../keepTokenBrowserAutomation";
import { runOauthBrowserAutomationDesktop } from "../keepTokenBrowserAutomationDesktop";

jest.mock("@integrations/google/keepTokenBrowserAutomationDesktop", () => ({
	runOauthBrowserAutomationDesktop: jest.fn(),
}));

describe("runOauthBrowserAutomation", () => {
	const runDesktopAutomationMock = runOauthBrowserAutomationDesktop as jest.MockedFunction<
		typeof runOauthBrowserAutomationDesktop
	>;

	beforeEach(() => {
		runDesktopAutomationMock.mockReset();
	});

	test("delegates to in-bundle desktop automation module", async () => {
		const plugin = {
			settings: {
				email: "test@example.com",
			},
		} as unknown as KeepSidianPlugin;
		const result = {
			oauth_token: "oauth_token_value",
			engine: "playwright",
		};
		runDesktopAutomationMock.mockResolvedValue(result);

		const response = await runOauthBrowserAutomation(plugin, "playwright", {
			debug: true,
			useSystemBrowser: true,
		});

		expect(runDesktopAutomationMock).toHaveBeenCalledWith(plugin, "playwright", {
			debug: true,
			useSystemBrowser: true,
		});
		expect(response).toEqual(result);
	});
});
