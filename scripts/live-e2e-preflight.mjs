#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";

const serverUrl = (
	process.env.KEEPSIDIAN_TEST_SERVER_URL ??
	process.env.KEEPSIDIAN_SERVER_URL ??
	"http://127.0.0.1:8080"
).replace(/\/+$/, "");
const outputDir =
	process.env.KEEPSIDIAN_E2E_OUTPUT_DIR ??
	path.resolve("output/live-e2e", new Date().toISOString().replace(/[:.]/g, "-"));
const email = process.env.KEEPSIDIAN_TEST_EMAIL?.trim() ?? "";
const token = process.env.KEEPSIDIAN_TEST_TOKEN?.trim() ?? "";
const vaultPath = process.env.KEEPSIDIAN_E2E_VAULT?.trim() ?? "";
const subscriptionMode = process.env.KEEPSIDIAN_LIVE_SUBSCRIPTION_MODE?.trim() ?? "";

await fs.mkdir(outputDir, { recursive: true });

const preflight = {
	startedAt: new Date().toISOString(),
	serverUrl,
	outputDir,
	vaultPath,
	subscriptionMode,
	probes: [],
};

function normalizeText(value) {
	return typeof value === "string" ? value : "";
}

function stripFrontmatterAndUrls(value) {
	const text = normalizeText(value);
	const withoutFrontmatter = text.replace(/^---[\s\S]*?---\s*/m, " ");
	return withoutFrontmatter.replace(/https?:\/\/\S+/g, " ");
}

function tokenizeNote(note) {
	const raw = `${normalizeText(note.title)} ${stripFrontmatterAndUrls(note.text)} ${stripFrontmatterAndUrls(note.body)}`.toLowerCase();
	return Array.from(
		new Set(
			raw
				.replace(/[^a-z0-9\s]/g, " ")
				.split(/\s+/)
				.map((token) => token.trim())
				.filter(
					(token) =>
						token.length >= 3 &&
						/[a-z]/.test(token) &&
						!/^\d+$/.test(token) &&
						!/^\d+[a-z0-9]*$/.test(token)
				)
		)
	);
}

function buildIncludeExcludeCandidate(notes) {
	const tokensByIndex = notes.map((note) => tokenizeNote(note));
	const tokenCounts = new Map();
	for (const tokens of tokensByIndex) {
		for (const token of tokens) {
			tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
		}
	}

	for (let includeIndex = 0; includeIndex < notes.length; includeIndex += 1) {
		const includeTokens = tokensByIndex[includeIndex] ?? [];
		const includeTerm = includeTokens.find((token) => tokenCounts.get(token) === 1);
		if (!includeTerm) {
			continue;
		}
		for (let excludeIndex = 0; excludeIndex < notes.length; excludeIndex += 1) {
			if (excludeIndex === includeIndex) {
				continue;
			}
			const excludeTokens = tokensByIndex[excludeIndex] ?? [];
			const excludeTerm = excludeTokens.find((token) => tokenCounts.get(token) === 1);
			if (!excludeTerm || excludeTerm === includeTerm) {
				continue;
			}

			return {
				includeTerm,
				includeTitle: normalizeText(notes[includeIndex].title) || `Sample note ${includeIndex + 1}`,
				excludeTerm,
				excludeTitle: normalizeText(notes[excludeIndex].title) || `Sample note ${excludeIndex + 1}`,
			};
		}
	}

	return null;
}

async function verifyIncludeExcludeCandidate(serverUrl, authHeaders, candidate) {
	if (!candidate) {
		return null;
	}

	try {
		const response = await fetch(`${serverUrl}/keep/sync/premium/v2?limit=50`, {
			method: "POST",
			headers: authHeaders,
			body: JSON.stringify({
				feature_flags: {
					filter_notes: { terms: [candidate.includeTerm] },
					skip_notes: { terms: [candidate.excludeTerm] },
				},
			}),
		});
		const json = await response.json();
		if (!response.ok || !Array.isArray(json?.notes)) {
			return null;
		}

		const titles = json.notes.map((note) => normalizeText(note?.title).toLowerCase());
		const includesWanted = titles.includes(candidate.includeTitle.toLowerCase());
		const excludesWanted = !titles.includes(candidate.excludeTitle.toLowerCase());
		if (!includesWanted || !excludesWanted) {
			return null;
		}

		return {
			...candidate,
			resultCount: json.notes.length,
		};
	} catch {
		return null;
	}
}

function buildCorpusSummary(notes) {
	if (!Array.isArray(notes) || notes.length === 0) {
		return {
			noteCount: 0,
			pinnedCount: 0,
			archivedCount: 0,
			colors: [],
			filterCandidates: {},
			sampleTitles: [],
		};
	}

	const colors = Array.from(
		new Set(
			notes
				.map((note) => normalizeText(note.color))
				.filter((color) => color && color !== "DEFAULT")
		)
	).sort();

	const pinnedCount = notes.filter((note) => note?.pinned === true).length;
	const archivedCount = notes.filter((note) => note?.archived === true).length;
	const includeExclude = buildIncludeExcludeCandidate(notes);
	const colorCandidateNote = colors.length
		? notes.find((note) => normalizeText(note.color) === colors[0])
		: undefined;
	const pinnedCandidateNote = notes.find((note) => note?.pinned === true);
	const archivedCandidateNote = notes.find((note) => note?.archived === true);
	const updatedValues = notes
		.map((note) => normalizeText(note.updated))
		.filter((value) => value)
		.sort();
	const createdValues = notes
		.map((note) => normalizeText(note.created))
		.filter((value) => value)
		.sort();

	return {
		noteCount: notes.length,
		pinnedCount,
		archivedCount,
		colors,
		oldestCreated: createdValues[0] ?? null,
		newestUpdated: updatedValues[updatedValues.length - 1] ?? null,
		filterCandidates: {
			includeExclude,
			color:
				colorCandidateNote && colors[0]
					? {
							color: colors[0],
							title: normalizeText(colorCandidateNote.title) || "Color-filter candidate",
					  }
					: null,
			pinned: pinnedCandidateNote
				? {
						title: normalizeText(pinnedCandidateNote.title) || "Pinned candidate",
				  }
				: null,
			archived: archivedCandidateNote
				? {
						title: normalizeText(archivedCandidateNote.title) || "Archived candidate",
				  }
				: null,
		},
		sampleTitles: notes
			.slice(0, 10)
			.map((note, index) => normalizeText(note.title) || `Sample note ${index + 1}`),
	};
}

async function pushProbe(name, url, init = {}) {
	const startedAt = new Date().toISOString();
	try {
		const response = await fetch(url, init);
		const text = await response.text();
		let json = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			json = null;
		}

		preflight.probes.push({
			name,
			url,
			startedAt,
			ok: response.ok,
			status: response.status,
			json,
			text: json ? undefined : text.slice(0, 2000),
		});
	} catch (error) {
		preflight.probes.push({
			name,
			url,
			startedAt,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

if (email && token) {
	const authHeaders = {
		"Content-Type": "application/json",
		"X-User-Email": email,
		Authorization: `Bearer ${token}`,
	};

	await pushProbe(`${"subscriber_info"}`, `${serverUrl}/subscriber/info`, {
		headers: authHeaders,
	});
	await pushProbe(`${"sync_v2_sample"}`, `${serverUrl}/keep/sync/v2?limit=50`, {
		headers: authHeaders,
	});
	await pushProbe(`${"premium_v2_sample"}`, `${serverUrl}/keep/sync/premium/v2?limit=50`, {
		method: "POST",
		headers: authHeaders,
		body: JSON.stringify({ feature_flags: {} }),
	});

	const premiumProbe = preflight.probes.find((probe) => probe.name === "premium_v2_sample");
	const premiumNotes = Array.isArray(premiumProbe?.json?.notes) ? premiumProbe.json.notes : [];
	const syncProbe = preflight.probes.find((probe) => probe.name === "sync_v2_sample");
	const syncNotes = Array.isArray(syncProbe?.json?.notes) ? syncProbe.json.notes : [];
	const corpusSummary = buildCorpusSummary(premiumNotes.length > 0 ? premiumNotes : syncNotes);
	const verifiedIncludeExclude = await verifyIncludeExcludeCandidate(
		serverUrl,
		authHeaders,
		corpusSummary.filterCandidates?.includeExclude ?? null
	);
	if (corpusSummary.filterCandidates) {
		corpusSummary.filterCandidates.includeExclude = verifiedIncludeExclude;
	}
	preflight.corpusSummary = corpusSummary;
} else {
	preflight.probes.push({
		name: "credentials",
		ok: false,
		skipped: true,
		reason:
			"Set KEEPSIDIAN_TEST_EMAIL and KEEPSIDIAN_TEST_TOKEN to enable direct server probes. The live UI lane can still use vault-stored settings.",
	});
}
if (!preflight.corpusSummary) {
	const syncProbe = preflight.probes.find((probe) => probe.name === "sync_v2_sample");
	const syncNotes = Array.isArray(syncProbe?.json?.notes) ? syncProbe.json.notes : [];
	preflight.corpusSummary = buildCorpusSummary(syncNotes);
}

preflight.finishedAt = new Date().toISOString();

await fs.writeFile(
	path.join(outputDir, "preflight.json"),
	JSON.stringify(preflight, null, 2),
	"utf8"
);

process.stdout.write(JSON.stringify(preflight, null, 2));
