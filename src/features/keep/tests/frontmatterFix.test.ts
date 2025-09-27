import KeepSidianPlugin from "main";
import { ensurePascalCaseFrontmatter } from "../migrations/fixFrontmatterCasing";

describe("ensurePascalCaseFrontmatter", () => {
	function createPlugin(content: string) {
		const adapter = {
			list: jest.fn().mockResolvedValue({ files: ["Keep/note.md"], folders: [] }),
			read: jest.fn().mockResolvedValue(content),
			write: jest.fn().mockResolvedValue(undefined),
		};

		const plugin = {
			app: {
				vault: {
					adapter,
				},
			},
			settings: {
				email: "user@example.com",
				token: "token",
				saveLocation: "Keep",
				frontmatterPascalCaseFixApplied: false,
			},
			saveSettings: jest.fn().mockResolvedValue(undefined),
		} as unknown as KeepSidianPlugin;

		return { plugin, adapter };
	}

	it("updates hyphenated frontmatter keys", async () => {
		const original = [
			"---",
			"google-keep-created-date: 2024-01-01T00:00:00Z",
			"google-keep-updated-date: 2024-01-02T00:00:00Z",
			"google-keep-url: https://keep.google.com",
			"Title: Example",
			"---",
			"Body",
		].join("\n");

		const { plugin, adapter } = createPlugin(original);

		await ensurePascalCaseFrontmatter(plugin);

		expect(adapter.write).toHaveBeenCalledWith(
			"Keep/note.md",
			expect.stringContaining("GoogleKeepCreatedDate: 2024-01-01T00:00:00Z")
		);
		expect(adapter.write).toHaveBeenCalledWith(
			"Keep/note.md",
			expect.stringContaining("GoogleKeepUpdatedDate: 2024-01-02T00:00:00Z")
		);
		expect(adapter.write).toHaveBeenCalledWith(
			"Keep/note.md",
			expect.stringContaining("GoogleKeepUrl: https://keep.google.com")
		);
		expect(plugin.settings.frontmatterPascalCaseFixApplied).toBe(true);
		expect(plugin.saveSettings).toHaveBeenCalled();
	});

	it("does nothing when already applied", async () => {
		const { plugin, adapter } = createPlugin("---\n---\nBody");
		plugin.settings.frontmatterPascalCaseFixApplied = true;

		await ensurePascalCaseFrontmatter(plugin);

		expect(adapter.list).not.toHaveBeenCalled();
		expect(adapter.write).not.toHaveBeenCalled();
	});

	it("marks completion when no files need updates", async () => {
		const { plugin, adapter } = createPlugin("---\nTitle: Example\n---\nBody");

		await ensurePascalCaseFrontmatter(plugin);

		expect(adapter.write).not.toHaveBeenCalled();
		expect(plugin.settings.frontmatterPascalCaseFixApplied).toBe(true);
		expect(plugin.saveSettings).toHaveBeenCalled();
	});

	it("retries on read failure", async () => {
		const { plugin, adapter } = createPlugin("---\n---\nBody");
		adapter.read.mockRejectedValue(new Error("boom"));

		await ensurePascalCaseFrontmatter(plugin);

		expect(plugin.settings.frontmatterPascalCaseFixApplied).toBe(false);
		expect(plugin.saveSettings).not.toHaveBeenCalled();
	});
});
