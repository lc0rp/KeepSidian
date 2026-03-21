import * as path from "path";

const systemPathPrefix = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
process.env.PATH = `${systemPathPrefix}:${process.env.PATH ?? ""}`;

const liveVault =
	process.env.KEEPSIDIAN_E2E_VAULT ??
	path.resolve(process.env.HOME ?? "", "Documents/Obsidian-Test-Vault");
const artifactRoot =
	process.env.KEEPSIDIAN_E2E_OUTPUT_DIR ?? path.resolve("output/live-e2e/latest");

export const config: WebdriverIO.Config = {
	runner: "local",
	framework: "mocha",
	specs: ["./test/specs/**/*.live.e2e.ts"],
	maxInstances: 1,
	capabilities: [
		{
			browserName: "obsidian",
			browserVersion: "latest",
			"wdio:obsidianOptions": {
				installerVersion: "latest",
				plugins: ["."],
				vault: liveVault,
			},
		},
	],
	services: ["obsidian"],
	reporters: ["obsidian"],
	cacheDir: path.resolve(".obsidian-cache"),
	outputDir: path.join(artifactRoot, "wdio"),
	mochaOpts: {
		ui: "bdd",
		timeout: 120000,
	},
	logLevel: "warn",
};
