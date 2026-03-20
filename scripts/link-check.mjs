#!/usr/bin/env node
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const root = process.cwd();
const fix = process.argv.includes("--fix");
const localIgnoreFile = path.join(root, ".linkcheckignore");
const ignoredDirs = new Set([
	"node_modules",
	".git",
	".next",
	"coverage",
	"dist",
	"build",
	"out",
	"templates",
	"99-archive",
]);

const toPosix = (p) => p.split(path.sep).join("/");

function resolveGitRoot(startDir) {
	try {
		return execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd: startDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch {
		return null;
	}
}

function escapeRegex(text) {
	return text.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegexSource(pattern) {
	let source = "";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (char === "*") {
			if (pattern[index + 1] === "*") {
				source += ".*";
				index += 1;
			} else {
				source += "[^/]*";
			}
			continue;
		}
		if (char === "?") {
			source += "[^/]";
			continue;
		}
		source += escapeRegex(char);
	}
	return source;
}

function compileLocalIgnorePatterns(filePath) {
	if (!fs.existsSync(filePath)) {
		return [];
	}

	return fs
		.readFileSync(filePath, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"))
		.map((rawPattern) => {
			let pattern = rawPattern;
			let negated = false;
			if (pattern.startsWith("!")) {
				negated = true;
				pattern = pattern.slice(1);
			}

			let anchoredToRoot = false;
			if (pattern.startsWith("/")) {
				anchoredToRoot = true;
				pattern = pattern.slice(1);
			}

			let directoryOnly = false;
			if (pattern.endsWith("/")) {
				directoryOnly = true;
				pattern = pattern.slice(0, -1);
			}

			const hasSlash = pattern.includes("/");
			return {
				raw: rawPattern,
				negated,
				directoryOnly,
				anchoredToRoot,
				hasSlash,
				regex: new RegExp(`^${globToRegexSource(pattern)}$`),
			};
		});
}

const gitRoot = resolveGitRoot(root);
const localIgnorePatterns = compileLocalIgnorePatterns(localIgnoreFile);

function isIgnoredByLocalConfig(fullPath, isDirectory) {
	if (localIgnorePatterns.length === 0) {
		return false;
	}

	const relativePath = toPosix(path.relative(root, fullPath));
	if (!relativePath || relativePath.startsWith("..")) {
		return false;
	}

	const pathForMatch = isDirectory ? `${relativePath}/` : relativePath;
	const pathWithoutSlash = pathForMatch.endsWith("/") ? pathForMatch.slice(0, -1) : pathForMatch;
	const segments = pathWithoutSlash.split("/").filter(Boolean);

	let ignored = false;
	for (const pattern of localIgnorePatterns) {
		if (pattern.directoryOnly && !isDirectory) {
			continue;
		}

		let matched = false;
		if (!pattern.hasSlash && !pattern.anchoredToRoot) {
			matched = segments.some((segment) => pattern.regex.test(segment));
		} else {
			matched = pattern.regex.test(pathWithoutSlash);
		}

		if (matched) {
			ignored = !pattern.negated;
		}
	}

	return ignored;
}

function isIgnoredByGit(fullPath, isDirectory) {
	if (!gitRoot) {
		return false;
	}

	const relativePath = toPosix(path.relative(gitRoot, fullPath));
	if (!relativePath || relativePath.startsWith("..")) {
		return false;
	}

	const candidate = isDirectory ? `${relativePath}/` : relativePath;
	try {
		execFileSync("git", ["check-ignore", "--quiet", "--no-index", candidate], {
			cwd: gitRoot,
			stdio: "ignore",
		});
		return true;
	} catch {
		return false;
	}
}

function walk(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		if (ignoredDirs.has(entry.name)) continue;
		if (entry.isDirectory() && entry.name.startsWith(".") && entry.name !== ".github") continue;
		const full = path.join(dir, entry.name);
		if (isIgnoredByLocalConfig(full, entry.isDirectory())) continue;
		if (isIgnoredByGit(full, entry.isDirectory())) continue;
		if (entry.isDirectory()) files.push(...walk(full));
		else if (entry.isFile()) files.push(full);
	}
	return files;
}

function resolveTarget(rawTarget, fileDir) {
	const target = rawTarget.trim();
	const hasExt = path.extname(target) !== "";
	const candidates = [];
	if (hasExt) {
		candidates.push(path.resolve(fileDir, target));
	} else {
		candidates.push(path.resolve(fileDir, `${target}.md`));
		candidates.push(path.resolve(fileDir, target, "index.md"));
		candidates.push(path.resolve(root, `${target}.md`));
		candidates.push(path.resolve(root, target, "index.md"));
	}
	const existing = candidates.filter((c) => fs.existsSync(c));
	if (existing.length === 1) return { status: "ok", path: existing[0] };
	if (existing.length === 0) return { status: "missing", target, candidates };
	return { status: "ambiguous", target, candidates: existing };
}

function convertWikilinks(content, filePath) {
	const fileDir = path.dirname(filePath);
	const pattern = /\[\[([^\]|\n\r]+)(?:\|([^\]\n\r]+))?\]\]/g;
	let mutated = content;
	const conversions = [];
	const unresolved = [];

	mutated = mutated.replace(pattern, (match, target, alias) => {
		const resolved = resolveTarget(target, fileDir);
		if (resolved.status === "ok") {
			const rel = path.relative(fileDir, resolved.path) || ".";
			const href = rel.startsWith(".") ? rel : `./${rel}`;
			conversions.push({ file: filePath, target, to: toPosix(href) });
			return `[${alias || target}](${toPosix(href)})`;
		}
		unresolved.push({
			file: filePath,
			target,
			reason: resolved.status,
			candidates: resolved.candidates || [],
		});
		return match;
	});

	return { content: mutated, conversions, unresolved };
}

function checkLinks(content, filePath) {
	const fileDir = path.dirname(filePath);
	const dead = [];
	const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
	let match;
	while ((match = linkPattern.exec(content)) !== null) {
		const raw = match[1].trim();
		if (!raw || raw.startsWith("#")) continue;
		if (/^(?:https?:|mailto:|tel:|data:)/i.test(raw)) continue;
		const withoutFragment = raw.split("#")[0];
		const candidate = path.resolve(fileDir, withoutFragment);
		const rootRelative = path.resolve(root, withoutFragment.replace(/^\//, ""));
		const alts = [candidate, rootRelative];
		if (!candidate.endsWith(".md")) {
			alts.push(`${candidate}.md`);
			alts.push(path.join(candidate, "index.md"));
			alts.push(`${rootRelative}.md`);
			alts.push(path.join(rootRelative, "index.md"));
		}
		const exists = alts.some((p) => fs.existsSync(p));
		if (!exists) {
			dead.push({ file: filePath, link: raw });
		}
	}
	return dead;
}

const mdFiles = walk(root).filter((f) => f.endsWith(".md"));
const needsConversion = [];
const unresolvedLinks = [];
const deadLinks = [];

for (const file of mdFiles) {
	const original = fs.readFileSync(file, "utf8");
	const { content, conversions, unresolved } = convertWikilinks(original, file);
	if (conversions.length) needsConversion.push(...conversions);
	if (unresolved.length) unresolvedLinks.push(...unresolved);

	const afterConversion = fix ? content : original;
	if (fix && content !== original) {
		fs.writeFileSync(file, content, "utf8");
	}

	deadLinks.push(...checkLinks(afterConversion, file));
}

const errors = [];
if (!fix && needsConversion.length) {
	errors.push(
		`Found ${needsConversion.length} wikilinks that need conversion (run npm run lint:links:fix).`
	);
}
if (unresolvedLinks.length) {
	const lines = unresolvedLinks
		.slice(0, 10)
		.map((u) => `- ${u.file}: [[${u.target}]] (${u.reason})`);
	errors.push(
		`Unresolved/ambiguous wikilinks:\n${lines.join("\n")}${
			unresolvedLinks.length > 10 ? "\n…" : ""
		}`
	);
}
if (deadLinks.length) {
	const lines = deadLinks.slice(0, 10).map((d) => `- ${d.file}: ${d.link}`);
	errors.push(
		`Dead links:\n${lines.join("\n")}${deadLinks.length > 10 ? "\n…" : ""}`
	);
}

if (errors.length) {
	console.error(errors.join("\n\n"));
	process.exit(1);
}

if (fix && needsConversion.length) {
	console.log(`Converted ${needsConversion.length} wikilinks to markdown links.`);
}
console.log("Link check passed.");
