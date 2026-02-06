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

const isPathGitIgnored = (path) => {
	try {
		execSync(`git check-ignore -q -- ${path}`, { stdio: "ignore" });
		return true;
	} catch (error) {
		if (error && error.status === 1) {
			return false;
		}
		throw error;
	}
};

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

const promptAlphaBetaChoice = async (currentVersion) => {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const choices = ["alpha", "beta", "none"];

	console.log(`Current version: ${currentVersion}`);
	console.log("Is this an alpha or beta release?");
	choices.forEach((choice, index) => {
		console.log(`  ${index + 1}) ${choice}`);
	});

	const answer = await new Promise((resolve) => {
		rl.question("Enter 1, 2, or 3 (or type alpha/beta/none) > ", resolve);
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

	console.error("Invalid selection. Please rerun and choose alpha, beta, or none.");
	process.exit(1);
};

const parseVersion = (version) => {
	const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/);
	if (!match) {
		throw new Error(`Invalid semantic version: ${version}`);
	}

	const [, majorStr, minorStr, patchStr, channel, prereleaseNumberStr] = match;
	const major = Number.parseInt(majorStr, 10);
	const minor = Number.parseInt(minorStr, 10);
	const patch = Number.parseInt(patchStr, 10);

	return {
		major,
		minor,
		patch,
		baseVersion: `${major}.${minor}.${patch}`,
		prerelease: channel
			? { channel, number: Number.parseInt(prereleaseNumberStr, 10) }
			: null,
	};
};

const bumpBaseVersion = (parsedVersion, releaseType) => {
	switch (releaseType) {
		case "major":
			return `${parsedVersion.major + 1}.0.0`;
		case "minor":
			return `${parsedVersion.major}.${parsedVersion.minor + 1}.0`;
		case "patch":
			return `${parsedVersion.major}.${parsedVersion.minor}.${parsedVersion.patch + 1}`;
		default:
			throw new Error(`Unsupported release type: ${releaseType}`);
	}
};

const toVersionTag = (version) => `v${version.split(".").join("-")}`;

const getProductionUrlForVersion = (version) =>
	`https://${toVersionTag(version)}---keepsidianserver-i55qr5tvea-uc.a.run.app/`;

const BACKEND_CHECK_PATH = "/subscribe";
const BACKEND_CHECK_TIMEOUT_MS = 10_000;

const checkBackendUrl = async (version, { dryRun = false } = {}) => {
	const baseUrl = getProductionUrlForVersion(version).replace(/\/$/, "");
	const checkUrl = `${baseUrl}${BACKEND_CHECK_PATH}`;

	if (dryRun) {
		console.log(`[dry-run] Would verify backend URL is live: ${checkUrl}`);
		return;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), BACKEND_CHECK_TIMEOUT_MS);

	try {
		const response = await fetch(checkUrl, {
			method: "GET",
			redirect: "follow",
			signal: controller.signal,
		});

		if (!response.ok) {
			throw new Error(`Backend URL check failed: ${checkUrl} returned ${response.status}.`);
		}

		console.log(`Backend URL check passed: ${checkUrl} → ${response.status}`);
	} catch (error) {
		if (error?.name === "AbortError") {
			throw new Error(
				`Backend URL check timed out after ${BACKEND_CHECK_TIMEOUT_MS}ms: ${checkUrl}`
			);
		}
		throw new Error(`Backend URL check failed for ${checkUrl}: ${error}`);
	} finally {
		clearTimeout(timeoutId);
	}
};

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

const monitorReleaseRun = async (version, { dryRun = false } = {}) => {
	const workflowName = "Release Keepsidian plugin";
	const tag = version;

	if (dryRun) {
		console.log(
			`[dry-run] Would monitor GitHub Actions workflow "${workflowName}" for ${tag}`
		);
		return;
	}

	try {
		runCapture("gh --version");
	} catch {
		console.warn("GitHub CLI (gh) not available; skipping workflow monitoring.");
		return;
	}

	try {
		const payload = runCapture(
			`gh run list --workflow "${workflowName}" --branch ${tag} --limit 1 --json databaseId,status,conclusion`
		);
		const runs = JSON.parse(payload);
		const latest = runs[0];

		if (!latest) {
			console.warn(`No GitHub Actions run found for ${tag}.`);
			return;
		}

		if (latest.status === "completed") {
			const conclusion = latest.conclusion || "unknown";
			if (conclusion !== "success") {
				console.error(`Release workflow completed with conclusion: ${conclusion}`);
				process.exit(1);
			}
			console.log(`Release workflow completed: ${conclusion}.`);
			return;
		}

		console.log(`Monitoring GitHub Actions run ${latest.databaseId} for ${tag}...`);
		run(`gh run watch ${latest.databaseId} --exit-status`);
	} catch {
		console.warn("Unable to monitor GitHub Actions release run; check it manually.");
	}
};

const getRepoSlug = () => {
	try {
		const origin = runCapture("git config --get remote.origin.url").trim();
		if (!origin) {
			return null;
		}

		const sshMatch = origin.match(/:(.+?)(?:\.git)?$/);
		if (sshMatch && sshMatch[1]) {
			return sshMatch[1];
		}

		const httpsMatch = origin.match(/github\.com\/(.+?)(?:\.git)?$/);
		if (httpsMatch && httpsMatch[1]) {
			return httpsMatch[1];
		}
	} catch {
		// ignore
	}

	return null;
};

const publishDraftRelease = async (version, { dryRun = false } = {}) => {
	const repo = getRepoSlug() ?? "lc0rp/KeepSidian";

	if (dryRun) {
		console.log(`[dry-run] Would publish GitHub release for ${version}`);
		return;
	}

	try {
		runCapture("gh --version");
	} catch {
		console.warn("GitHub CLI (gh) not available; skipping release publish.");
		return;
	}

	try {
		const payload = runCapture(`gh api repos/${repo}/releases?per_page=100`);
		const releases = JSON.parse(payload);
		const matching = releases.filter((release) => release.tag_name === version);
		const published = matching.find((release) => release.draft === false);
		const draft = matching.find((release) => release.draft === true);

		if (published) {
			console.log(`Release ${version} already published.`);
			return;
		}

		if (!draft) {
			console.warn(`No draft release found for ${version}.`);
			return;
		}

		if (!draft.assets || draft.assets.length === 0) {
			console.error(`Draft release ${version} has no assets; not publishing.`);
			process.exit(1);
		}

		run(
			`gh api -X PATCH repos/${repo}/releases/${draft.id} -f draft=false -f prerelease=true -f name=${version}`
		);
		console.log(`Published release ${version}.`);
	} catch {
		console.warn("Unable to publish draft release; check it manually.");
	}
};

const determineNextVersion = async (currentVersion) => {
	const parsed = parseVersion(currentVersion);
	const alphaBetaChoice = await promptAlphaBetaChoice(currentVersion);

	if (alphaBetaChoice === "alpha" || alphaBetaChoice === "beta") {
		const sameChannel = parsed.prerelease && parsed.prerelease.channel === alphaBetaChoice;
		if (sameChannel) {
			const nextNumber = parsed.prerelease.number + 1;
			return {
				nextVersion: `${parsed.baseVersion}-${alphaBetaChoice}.${nextNumber}`,
				releaseTypeLabel: `${alphaBetaChoice} increment`,
				alphaBetaChoice,
			};
		}

		const baseReleaseType = await promptReleaseType(currentVersion);
		const baseVersion = bumpBaseVersion(parsed, baseReleaseType);
		return {
			nextVersion: `${baseVersion}-${alphaBetaChoice}.1`,
			releaseTypeLabel: `${baseReleaseType} ${alphaBetaChoice}`,
			alphaBetaChoice,
		};
	}

	if (parsed.prerelease) {
		return {
			nextVersion: parsed.baseVersion,
			releaseTypeLabel: "finalize prerelease",
			alphaBetaChoice,
		};
	}

	const baseReleaseType = await promptReleaseType(currentVersion);
	return {
		nextVersion: bumpBaseVersion(parsed, baseReleaseType),
		releaseTypeLabel: baseReleaseType,
		alphaBetaChoice,
	};
};

const main = async () => {
	if (isDryRun) {
		console.log("Running release script in dry-run mode. No commands will be executed.");
	}

	ensureCleanGitState();

	const pkg = JSON.parse(readFileSync("package.json", "utf8"));
	const currentVersion = pkg.version;

	const { nextVersion, releaseTypeLabel } = await determineNextVersion(currentVersion);

	console.log(`Preparing release for version ${nextVersion} (${releaseTypeLabel}).`);
	const { changed: envChanged } = updateEnvProduction(nextVersion, { dryRun: isDryRun });
	await checkBackendUrl(nextVersion, { dryRun: isDryRun });

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
			if (isPathGitIgnored(ENV_FILE_PATH)) {
				console.log(`${ENV_FILE_PATH} is gitignored; skipping staging.`);
			} else {
				console.log(`Staging ${ENV_FILE_PATH}...`);
				run(`git add ${ENV_FILE_PATH}`);
			}
		}
	} else if (!isDryRun) {
		console.log(`No changes detected in ${ENV_FILE_PATH}; skipping staging.`);
	}

	if (isDryRun) {
		console.log(
			`[dry-run] Would bump version via npm version ${nextVersion} --force --no-git-tag-version`
		);
		console.log(`[dry-run] Would tag release ${nextVersion}`);
	} else {
		console.log(`Bumping version to ${nextVersion}...`);
		run(`npm version ${nextVersion} --force --no-git-tag-version`);
		run(`git tag -a "${nextVersion}" -m "${nextVersion}"`);
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

	await monitorReleaseRun(updatedVersion, { dryRun: isDryRun });
	await publishDraftRelease(updatedVersion, { dryRun: isDryRun });

	console.log("Release process completed successfully.");
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
