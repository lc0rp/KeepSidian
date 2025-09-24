jest.mock("obsidian");

import { Notice } from "obsidian";
import KeepSidianPlugin from "main";
import { pushGoogleKeepNotes } from "../push";
import { pushNotes as apiPushNotes } from "@integrations/server/keepApi";

jest.mock("@integrations/server/keepApi", () => ({
        pushNotes: jest.fn(),
}));

jest.mock("@app/logging", () => ({
        logSync: jest.fn().mockResolvedValue(undefined),
}));

describe("pushGoogleKeepNotes", () => {
        const email = "user@example.com";
        const token = "test-token";
        const saveLocation = "Keep";

        function createPlugin(overrides: Partial<KeepSidianPlugin["app"]["vault"]["adapter"]> = {}) {
                const adapter = {
                        list: jest.fn().mockResolvedValue({ files: [], folders: [] }),
                        read: jest.fn(),
                        write: jest.fn().mockResolvedValue(undefined),
                        readBinary: jest.fn(),
                        stat: jest.fn(),
                        exists: jest.fn().mockResolvedValue(true),
                        ...overrides,
                } as any;

                const plugin = {
                        settings: { email, token, saveLocation },
                        app: {
                                vault: {
                                        adapter,
                                        createFolder: jest.fn().mockResolvedValue(undefined),
                                },
                        },
                } as unknown as KeepSidianPlugin;

                return { plugin, adapter };
        }

        beforeEach(() => {
                jest.clearAllMocks();
        });

        afterEach(() => {
                jest.useRealTimers();
        });

        it("skips notes that are up to date", async () => {
                const { plugin, adapter } = createPlugin();
                adapter.list.mockResolvedValue({ files: ["Keep/note.md"], folders: [] });
                adapter.read.mockResolvedValue(
                        `---\nKeepSidianLastSyncedDate: 2024-01-01T00:00:00.000Z\n---\ncontent`
                );
                adapter.stat.mockResolvedValue({ mtime: new Date("2024-01-01T00:00:00Z").getTime() });

                const result = await pushGoogleKeepNotes(plugin);

                expect(result).toBe(0);
                expect(apiPushNotes).not.toHaveBeenCalled();
                expect(Notice).toHaveBeenCalledWith("No Google Keep notes to push.");
        });

        it("pushes modified notes and updates frontmatter", async () => {
                jest.useFakeTimers().setSystemTime(new Date("2024-02-01T00:00:00Z"));
                const { plugin, adapter } = createPlugin();
                adapter.list.mockResolvedValue({ files: ["Keep/note.md"], folders: [] });
                adapter.read.mockResolvedValue(
                        `---\nKeepSidianLastSyncedDate: 2024-01-01T00:00:00.000Z\n---\ncontent`
                );
                adapter.stat.mockResolvedValue({ mtime: new Date("2024-01-05T00:00:00Z").getTime() });
                (apiPushNotes as jest.Mock).mockResolvedValue({ results: [{ path: "note.md", success: true }] });

                const pushed = await pushGoogleKeepNotes(plugin);

                expect(pushed).toBe(1);
                expect(apiPushNotes).toHaveBeenCalledWith(email, token, [
                        expect.objectContaining({
                                path: "note.md",
                                content: expect.stringContaining("content"),
                        }),
                ]);
                expect(adapter.write).toHaveBeenCalledWith(
                        "Keep/note.md",
                        expect.stringContaining("KeepSidianLastSyncedDate: 2024-02-01T00:00:00.000Z")
                );
                expect(Notice).toHaveBeenCalledWith("Pushed Google Keep notes.");
        });

        it("includes updated attachments in the payload", async () => {
                jest.useFakeTimers().setSystemTime(new Date("2024-03-01T00:00:00Z"));
                const { plugin, adapter } = createPlugin();
                adapter.list.mockResolvedValue({ files: ["Keep/note.md"], folders: [] });
                adapter.read.mockImplementation(async (path: string) => {
                        if (path.endsWith("note.md")) {
                                return "---\nKeepSidianLastSyncedDate: 2024-01-01T00:00:00.000Z\n---\n![[media/photo.png]]";
                        }
                        return "";
                });
                adapter.stat.mockImplementation(async (path: string) => {
                        if (path.endsWith("photo.png")) {
                                return { mtime: new Date("2024-02-15T00:00:00Z").getTime() };
                        }
                        return { mtime: new Date("2024-02-20T00:00:00Z").getTime() };
                });
                const attachmentBytes = Uint8Array.from([1, 2, 3, 4]);
                adapter.readBinary.mockResolvedValue(attachmentBytes.buffer);
                (apiPushNotes as jest.Mock).mockResolvedValue({ results: [{ path: "note.md", success: true }] });

                await pushGoogleKeepNotes(plugin);

                expect(apiPushNotes).toHaveBeenCalled();
                const payload = (apiPushNotes as jest.Mock).mock.calls[0][2];
                expect(payload[0].attachments).toEqual([
                        expect.objectContaining({
                                name: "photo.png",
                                data: Buffer.from(attachmentBytes).toString("base64"),
                        }),
                ]);
        });

        it("surfaces errors from the push API", async () => {
                const { plugin, adapter } = createPlugin();
                adapter.list.mockResolvedValue({ files: ["Keep/note.md"], folders: [] });
                adapter.read.mockResolvedValue("---\n---\ncontent");
                adapter.stat.mockResolvedValue({ mtime: new Date("2024-01-05T00:00:00Z").getTime() });
                (apiPushNotes as jest.Mock).mockRejectedValue(new Error("network failure"));

                await expect(pushGoogleKeepNotes(plugin)).rejects.toThrow("network failure");
                expect(Notice).toHaveBeenCalledWith("Failed to push notes.");
        });
});
