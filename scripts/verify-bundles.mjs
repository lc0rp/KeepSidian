#!/usr/bin/env node
/* eslint-env node */

import { readFileSync, existsSync } from "fs";

const REQUIRED_FILES = ["main.js", "keepTokenDesktop.js", "keepTokenDesktopWebViewer.js"];

const fail = (message) => {
	console.error(message);
	process.exitCode = 1;
};

const readText = (path) => {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		fail(`Failed to read ${path}: ${error instanceof Error ? error.message : String(error)}`);
		return "";
	}
};

const requireElectronPattern = /require\(\s*["']electron["']\s*\)/g;

for (const file of REQUIRED_FILES) {
	if (!existsSync(file)) {
		fail(`Missing build artifact: ${file} (run \`npm run build\`)`);
	}
}

if (process.exitCode) {
	process.exit(process.exitCode);
}

const mainJs = readText("main.js");
if (requireElectronPattern.test(mainJs)) {
	fail(
		'`main.js` contains `require("electron")`. This defeats the mobile-safe bundle split; move Electron-only code into keepTokenDesktop.'
	);
}

// Sanity: the desktop bundles should exist. They *may* reference electron; that's expected.
// We don't assert its contents beyond existence to avoid coupling to esbuild output.
readText("keepTokenDesktop.js");
readText("keepTokenDesktopWebViewer.js");

if (!process.exitCode) {
	console.log(
		"Bundle verification passed: main.js has no require('electron'), keepTokenDesktop.js and keepTokenDesktopWebViewer.js present."
	);
}
