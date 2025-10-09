#!/usr/bin/env node
/* eslint-env node */

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import readline from "readline";

const run = (command, options = {}) => {
	return execSync(command, { stdio: "inherit", ...options });
};

const runCapture = (command) => execSync(command, { encoding: "utf8" });

const ENV_FILE_PATH = ".env.production";

const process = globalThis.process;
const console = globalThis.console;

const DRY_RUN_FLAGS = new Set(["--dry-run", "-n"]);
const isDryRun = process.argv.some((arg) => DRY_RUN_FLAGS.has(arg));

const ensureCleanGitState = () => {
	const status = runCapture("git status --porcelain").trim();
	if (status.length > 0) {
		const message =
			"Git working tree is not clean. Commit, stash, or discard changes before releasing.";
		if (isDryRun) {
			console.warn(`[dry-run] ${message}`);
			return;
		}
		console.error(message);
		process.exit(1);
	}
};

const promptReleaseType = async (currentVersion) => {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const choices = ["patch", "minor", "major"];

	console.log(`Current version: ${currentVersion}`);
	console.log("Select the type of release:");
	choices.forEach((choice, index) => {
		console.log(`  ${index + 1}) ${choice}`);
	});

	const answer = await new Promise((resolve) => {
		rl.question("Enter 1, 2, or 3 (or type the release type) > ", resolve);
	});

	rl.close();

	const normalized = answer.trim().toLowerCase();
	const index = Number.parseInt(normalized, 10);

	if (choices[index - 1]) {
		return choices[index - 1];
	}

	if (choices.includes(normalized)) {
		return normalized;
	}

	console.error("Invalid selection. Please rerun the command and choose patch, minor, or major.");
	process.exit(1);
};

const getNextVersion = (currentVersion, releaseType) => {
	const segments = currentVersion.split(".").map((value) => Number.parseInt(value, 10));
	if (segments.length !== 3 || segments.some(Number.isNaN)) {
		throw new Error(`Invalid semantic version: ${currentVersion}`);
	}

	const [major, minor, patch] = segments;

	switch (releaseType) {
		case "major":
			return `${major + 1}.0.0`;
		case "minor":
			return `${major}.${minor + 1}.0`;
		case "patch":
			return `${major}.${minor}.${patch + 1}`;
		default:
			throw new Error(`Unsupported release type: ${releaseType}`);
	}
};

const toVersionTag = (version) => `v${version.split(".").join("-")}`;

const getProductionUrlForVersion = (version) =>
	`https://${toVersionTag(version)}---keepsidianserver-i55qr5tvea-uc.a.run.app/`;

const updateEnvProduction = (version, { dryRun = false } = {}) => {
	const envContent = readFileSync(ENV_FILE_PATH, "utf8");
	const lineEnding = envContent.includes("\r\n") ? "\r\n" : "\n";
	const url = getProductionUrlForVersion(version);
	const targetLine = `KEEPSIDIAN_SERVER_URL=${url}`;

	if (dryRun) {
		const beforeDisplay =
			envContent.endsWith("\n") || envContent.endsWith("\r\n")
				? envContent
				: `${envContent}${lineEnding}`;
		console.log(`[dry-run] ${ENV_FILE_PATH} before update:\n---\n${beforeDisplay}---`);
	}

	const lines = envContent.split(/\r?\n/);
	const updatedLines = [];
	let activeLineHandled = false;
	let changed = false;

	for (const line of lines) {
		if (!line.trim().startsWith("#") && line.startsWith("KEEPSIDIAN_SERVER_URL=")) {
			if (!activeLineHandled) {
				activeLineHandled = true;
				if (line !== targetLine) {
					changed = true;
				}
				updatedLines.push(targetLine);
			} else {
				changed = true;
			}
			continue;
		}

		updatedLines.push(line);
	}

	if (!activeLineHandled) {
		if (updatedLines.length > 0 && updatedLines[updatedLines.length - 1] !== "") {
			updatedLines.push("");
		}
		updatedLines.push(targetLine);
		changed = true;
	}

	let updatedContent = updatedLines.join(lineEnding);
	if (!updatedContent.endsWith(lineEnding)) {
		updatedContent += lineEnding;
	}

	if (dryRun) {
		console.log(
			`[dry-run] ${ENV_FILE_PATH} after simulated update:\n---\n${updatedContent}---`
		);
	}

	if (!changed) {
		const message = `No update needed for ${ENV_FILE_PATH}; already set to ${url}`;
		if (dryRun) {
			console.log(`[dry-run] ${message}`);
		} else {
			console.log(message);
		}
		return { changed: false, url };
	}

	if (dryRun) {
		console.log(`[dry-run] Would update ${ENV_FILE_PATH} with ${targetLine}`);
		return { changed: true, url };
	}

	writeFileSync(ENV_FILE_PATH, updatedContent, "utf8");
	console.log(`Updated KEEPSIDIAN_SERVER_URL to ${url}`);
	return { changed: true, url };
};

const main = async () => {
	if (isDryRun) {
		console.log("Running release script in dry-run mode. No commands will be executed.");
	}

	ensureCleanGitState();

	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const currentVersion = pkg.version;

	const releaseType = await promptReleaseType(currentVersion);
	const nextVersion = getNextVersion(currentVersion, releaseType);

	console.log(`Preparing release for version ${nextVersion} (${releaseType}).`);
	const { changed: envChanged } = updateEnvProduction(nextVersion, { dryRun: isDryRun });

	if (isDryRun) {
		console.log("[dry-run] Would run: npm run build");
	} else {
		console.log("Running production build...");
		run("npm run build");
	}

	if (envChanged) {
		if (isDryRun) {
			console.log(
				`[dry-run] Skipping staging ${ENV_FILE_PATH} (file is ignored; no git changes made)`
			);
		} else {
			console.log(`Staging ${ENV_FILE_PATH}...`);
			run(`git add ${ENV_FILE_PATH}`);
		}
	} else if (!isDryRun) {
		console.log(`No changes detected in ${ENV_FILE_PATH}; skipping staging.`);
	}

	if (isDryRun) {
		console.log(
			`[dry-run] Would bump ${releaseType} version via npm version ${releaseType} --force`
		);
	} else {
		console.log(`Bumping ${releaseType} version...`);
		run(`npm version ${releaseType} --force`);
	}

	const updatedVersion = isDryRun
		? nextVersion
		: JSON.parse(readFileSync("package.json", "utf8")).version;
	console.log(`Version updated: ${currentVersion} → ${updatedVersion}`);

	if (isDryRun) {
		console.log("[dry-run] Would push commit and tags to remote (git push --follow-tags)");
	} else {
		console.log("Pushing commit and tags to remote...");
		run("git push --follow-tags");
	}

	console.log("Release process completed successfully.");
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
