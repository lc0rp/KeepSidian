// Factory for a minimal KeepSidianPlugin-like stub

export interface MockVaultAdapter {
	exists: jest.Mock<Promise<boolean>, [string]>;
	read: jest.Mock<Promise<string>, [string]>;
	write: jest.Mock<Promise<void>, [string, string]>;
	writeBinary: jest.Mock<Promise<void>, [string, ArrayBuffer]>;
	stat: jest.Mock<Promise<any>, [string]>;
}

export interface MockApp {
	vault: {
		adapter: MockVaultAdapter;
	};
}

export interface MockPluginSettings {
	email: string;
	token: string;
	saveLocation: string;
	[key: string]: any;
}

export interface MockPlugin {
	app: MockApp;
	settings: MockPluginSettings;
}

export function createMockPlugin(overrides?: Partial<MockPlugin>): MockPlugin {
	const adapter: MockVaultAdapter = {
		exists: jest.fn(async (_path: string) => false),
		read: jest.fn(async (_path: string) => ""),
		write: jest.fn(async (_path: string, _data: string) => undefined),
		writeBinary: jest.fn(
			async (_path: string, _data: ArrayBuffer) => undefined
		),
		stat: jest.fn(async (_path: string) => ({
			ctime: Date.now(),
			mtime: Date.now(),
		})),
	};

	const plugin: MockPlugin = {
		app: {
			vault: { adapter },
		},
		settings: {
			email: "user@example.com",
			token: "test-token",
			saveLocation: "Keep",
		},
	};

	return {
		...plugin,
		...(overrides || {}),
		app: {
			...plugin.app,
			...(overrides?.app || {}),
			vault: {
				...plugin.app.vault,
				...(overrides?.app as any)?.vault,
				adapter: {
					...adapter,
					...((overrides?.app as any)?.vault?.adapter || {}),
				},
			},
		},
		settings: {
			...plugin.settings,
			...(overrides?.settings || {}),
		},
	};
}
