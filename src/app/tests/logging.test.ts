jest.mock("obsidian", () => ({
        Notice: jest.fn(),
}));

jest.mock("../../services/logger", () => ({
        appendLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../services/paths", () => ({
        ensureFile: jest.fn().mockResolvedValue(undefined),
        normalizePathSafe: jest.fn((value: string) => value),
}));

import { logSync, flushLogSync } from "../logging";
import { appendLog } from "../../services/logger";
import { ensureFile } from "../../services/paths";
import { createMockPlugin } from "../../test-utils/mocks/plugin";
import type KeepSidianPlugin from "../../app/main";

const appendLogMock = appendLog as jest.MockedFunction<typeof appendLog>;

describe("logSync", () => {
	const createPlugin = (): KeepSidianPlugin => {
		const plugin = createMockPlugin();
		const castPlugin = plugin as unknown as KeepSidianPlugin;
		(castPlugin as { lastSyncLogPath: string | null }).lastSyncLogPath = null;
		return castPlugin;
	};

        beforeEach(() => {
                jest.clearAllMocks();
                jest.useFakeTimers().setSystemTime(new Date("2024-04-01T12:34:00Z"));
        });

        afterEach(() => {
                jest.useRealTimers();
        });

        it("writes a formatted log line immediately when no batching is requested", async () => {
                const plugin = createPlugin();

                await logSync(plugin, "Sync started");

                expect(ensureFile).toHaveBeenCalledWith(plugin.app, "Keep/_KeepSidianLogs/2024-04-01.md");
                expect(appendLogMock).toHaveBeenCalledWith(
                        plugin.app,
                        "Keep/_KeepSidianLogs/2024-04-01.md",
                        "- 12:34 Sync started\n"
                );
        });

        it("caches batched log lines until the batch is full or flushed", async () => {
                const plugin = createPlugin();

                await logSync(plugin, "First", { batchKey: "test", batchSize: 2 });

                expect(appendLogMock).not.toHaveBeenCalled();

                await logSync(plugin, "Second", { batchKey: "test", batchSize: 2 });

                expect(appendLogMock).toHaveBeenCalledTimes(1);
                expect(appendLogMock).toHaveBeenLastCalledWith(
                        plugin.app,
                        "Keep/_KeepSidianLogs/2024-04-01.md",
                        "- 12:34 First\n- 12:34 Second\n"
                );

                appendLogMock.mockClear();

                await logSync(plugin, "Third", { batchKey: "test", batchSize: 3 });
                expect(appendLogMock).not.toHaveBeenCalled();

                await flushLogSync(plugin, { batchKey: "test" });

                expect(appendLogMock).toHaveBeenCalledWith(
                        plugin.app,
                        "Keep/_KeepSidianLogs/2024-04-01.md",
                        "- 12:34 Third\n"
                );
        });
});
