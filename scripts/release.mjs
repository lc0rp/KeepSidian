#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync } from "fs";
import readline from "readline";

const run = (command, options = {}) => {
	return execSync(command, { stdio: "inherit", ...options });
};

const runCapture = (command) => execSync(command, { encoding: "utf8" });

const ensureCleanGitState = () => {
	const status = runCapture("git status --porcelain").trim();
	if (status.length > 0) {
		console.error(
			"Git working tree is not clean. Commit, stash, or discard changes before releasing."
		);
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

	console.error(
		"Invalid selection. Please rerun the command and choose patch, minor, or major."
	);
	process.exit(1);
};

const main = async () => {
	ensureCleanGitState();

	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const currentVersion = pkg.version;

	console.log("Running production build...");
	run("npm run build");

	const releaseType = await promptReleaseType(currentVersion);
	console.log(`Bumping ${releaseType} version...`);
	run(`npm version ${releaseType} --force`);

	const updatedPackage = JSON.parse(readFileSync("package.json", "utf8"));
	console.log(`Version updated: ${currentVersion} → ${updatedPackage.version}`);

	console.log("Pushing commit and tags to remote...");
	run("git push --follow-tags");

	console.log("Release process completed successfully.");
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
