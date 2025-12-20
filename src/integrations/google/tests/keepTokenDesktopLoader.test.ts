import path from "path";
import type KeepSidianPlugin from "main";
import { loadKeepTokenDesktop } from "../keepTokenDesktopLoader";

describe("loadKeepTokenDesktop", () => {
	const originalRequire = (globalThis as unknown as { require?: unknown }).require;

	afterEach(() => {
		if (originalRequire) {
			(globalThis as unknown as { require?: unknown }).require = originalRequire;
		} else {
			delete (globalThis as unknown as { require?: unknown }).require;
		}
	});

	test("resolves module from manifest directory when provided", async () => {
		const pluginDir = path.join("/vault", "obsidian-config", "plugins", "KeepSidian");
		const expectedBase = path.join(pluginDir, "keepTokenDesktop");
		const module = { initRetrieveToken: jest.fn() };
		const requireMock = jest.fn((moduleId: string) => {
			if (moduleId === "path") {
				return path;
			}
			if (moduleId === expectedBase || moduleId === `${expectedBase}.js`) {
				return module;
			}
			throw new Error(`Cannot find module ${moduleId}`);
		});
		(globalThis as unknown as { require?: unknown }).require = requireMock;

		const plugin = {
			manifest: {
				id: "keepsidian",
				dir: pluginDir,
			},
		} as unknown as KeepSidianPlugin;

		const loaded = await loadKeepTokenDesktop(plugin);

		expect(loaded).toBe(module);
		expect(requireMock).toHaveBeenCalledWith(expectedBase);
	});

	test("falls back to relative module when no plugin context is provided", async () => {
		const module = { initRetrieveToken: jest.fn() };
		const requireMock = jest.fn((moduleId: string) => {
			if (moduleId === "path") {
				return path;
			}
			if (moduleId === "./keepTokenDesktop") {
				return module;
			}
			throw new Error(`Cannot find module ${moduleId}`);
		});
		(globalThis as unknown as { require?: unknown }).require = requireMock;

		const loaded = await loadKeepTokenDesktop();

		expect(loaded).toBe(module);
		expect(requireMock).toHaveBeenCalledWith("./keepTokenDesktop");
	});

	test("resolves relative manifest dir using adapter.getFullPath", async () => {
		const manifestDir = "config/plugins/KeepSidian";
		const resolvedDir = path.join("/vault", manifestDir);
		const expectedBase = path.join(resolvedDir, "keepTokenDesktop");
		const module = { initRetrieveToken: jest.fn() };
		const requireMock = jest.fn((moduleId: string) => {
			if (moduleId === "path") {
				return path;
			}
			if (moduleId === expectedBase || moduleId === `${expectedBase}.js`) {
				return module;
			}
			throw new Error(`Cannot find module ${moduleId}`);
		});
		(globalThis as unknown as { require?: unknown }).require = requireMock;

		const plugin = {
			manifest: {
				id: "keepsidian",
				dir: manifestDir,
			},
			app: {
				vault: {
					adapter: {
						getFullPath: jest.fn((value: string) => path.join("/vault", value)),
					},
				},
			},
		} as unknown as KeepSidianPlugin;

		const loaded = await loadKeepTokenDesktop(plugin);

		expect(loaded).toBe(module);
		const adapter = (plugin.app?.vault?.adapter as unknown as { getFullPath: jest.Mock });
		expect(adapter.getFullPath).toHaveBeenCalledWith(manifestDir);
		expect(requireMock).toHaveBeenCalledWith(expectedBase);
	});
});
