#!/usr/bin/env node
import fs from "fs";
import path from "path";

const root = process.cwd();
const docsRoot = path.join(root, "docs");

const expectedTop = [
	"00-foundation",
	"01-product",
	"02-research",
	"03-design",
	"04-architecture",
	"05-planning",
	"06-delivery",
	"07-quality",
	"08-operations",
	"09-user-docs",
	"99-archive",
];

const errors = [];

function exists(p) {
	try {
		fs.accessSync(p);
		return true;
	} catch {
		return false;
	}
}

if (!exists(docsRoot)) {
	console.error("docs/ directory missing.");
	process.exit(1);
}

for (const dir of expectedTop) {
	const full = path.join(docsRoot, dir);
	if (!exists(full)) {
		errors.push(`Missing top-level folder: docs/${dir}`);
		continue;
	}
	const index = path.join(full, "index.md");
	if (!exists(index)) {
		errors.push(`Missing index.md in docs/${dir}/`);
	}
}

const requiredHeadings = ["Purpose", "Subfolders", "Usage"];

function checkHeadings(file) {
	const txt = fs.readFileSync(file, "utf8");
	for (const heading of requiredHeadings) {
		const pattern = new RegExp(`^#+\\s*${heading}\\b`, "im");
		if (!pattern.test(txt)) {
			errors.push(`index missing heading "${heading}" → ${path.relative(root, file)}`);
		}
	}
}

for (const dir of expectedTop) {
	const index = path.join(docsRoot, dir, "index.md");
	if (exists(index)) {
		checkHeadings(index);
	}
}

try {
	const readme = fs.readFileSync(path.join(docsRoot, "README.md"), "utf8");
	const requiredSequence = expectedTop;
	let lastIndex = -1;
	for (const seg of requiredSequence) {
		const idx = readme.indexOf(seg);
		if (idx === -1) {
			errors.push(`docs/README.md missing reference to ${seg}`);
			break;
		}
		if (idx < lastIndex) {
			errors.push("docs/README.md lifecycle links are out of order.");
			break;
		}
		lastIndex = idx;
	}
} catch {
	errors.push("Cannot read docs/README.md");
}

const ignoreDirs = new Set([".git", "node_modules", "templates", "99-archive"]);

function scanWikilinks(dir) {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (ignoreDirs.has(entry.name)) continue;
			scanWikilinks(full);
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			const txt = fs.readFileSync(full, "utf8");
			if (txt.includes("[[")) errors.push(`Wikilink found in ${path.relative(root, full)}`);
		}
	}
}
scanWikilinks(docsRoot);

if (errors.length) {
	console.error("IA validation failed:\n" + errors.map((e) => `- ${e}`).join("\n"));
	process.exit(1);
}

console.log("IA validation passed.");
