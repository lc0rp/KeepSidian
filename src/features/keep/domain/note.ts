interface NormalizedNote {
	title: string;
	text: string;
	created: Date | null;
	updated: Date | null;
	frontmatter: string;
	frontmatterDict: { [key: string]: string };
	archived: boolean;
	trashed: boolean;
	labels: string[];
	blobs: string[];
	blob_urls: string[];
	blob_names: string[];
	media: string[];
	header: string;
	textWithoutFrontmatter: string;
}

interface PreNormalizedNote {
	title: string;
	text?: string;
	created?: string;
	updated?: string;
	frontmatter?: string;
	frontmatterDict?: { [key: string]: string };
	archived?: boolean;
	trashed?: boolean;
	labels?: string[];
	blobs?: string[];
	blob_urls?: string[];
	blob_names?: string[];
	media?: string[];
	header?: string;
}

function normalizeDate(dateString?: string | null): Date | null {
	if (!dateString) {
		return null;
	}
	const date = new Date(dateString);
	return isNaN(date.getTime()) ? null : date;
}

function normalizeNote(note: PreNormalizedNote): NormalizedNote {
	const normalizedNote: NormalizedNote = {
		title: note.title?.trim() || "",
		text: note.text?.trim() || "",
		created: normalizeDate(note.created) || null,
		updated: normalizeDate(note.updated) || null,
		archived: note.archived || false,
		trashed: note.trashed || false,
		labels: Array.isArray(note.labels) ? note.labels : [],
		blobs: Array.isArray(note.blobs) ? note.blobs : [],
		blob_urls: Array.isArray(note.blob_urls) ? note.blob_urls : [],
		blob_names: Array.isArray(note.blob_names) ? note.blob_names : [],
		media: Array.isArray(note.media) ? note.media : [],
		header: note.header || "",
		frontmatter: "",
		frontmatterDict: {},
		textWithoutFrontmatter: note.text || "",
	};

	const [frontmatter, textWithoutFrontmatter, frontmatterDict] =
		extractFrontmatter(normalizedNote.text);
	normalizedNote.frontmatter = frontmatter;
	normalizedNote.textWithoutFrontmatter = textWithoutFrontmatter;
	normalizedNote.frontmatterDict = frontmatterDict;

	return normalizedNote;
}

function extractFrontmatter(
	text: string
): [string, string, { [key: string]: string }] {
	// Frontmatter is between --- and --- at the start of the text if it exists
	let frontmatter = "";
	let frontmatterDict = {};
	let textWithoutFrontmatter = text;
	const splitText = text?.split("---");
	if (splitText && splitText.length > 2) {
		frontmatter = splitText[1].trim();
		textWithoutFrontmatter = splitText[2].trim();
	}

	// Split frontmatter into key value pairs
	const frontmatter_parts = frontmatter?.split("\n");
	if (frontmatter) {
		frontmatterDict = frontmatter_parts.reduce(
			(acc: { [key: string]: string }, item: string) => {
				const [key, value] = item.split(": ");
				if (key && value) {
					// Convert key to PascalCase
					const pascalKey = key.replace(
						/(^|-)([a-z])/g,
						(match, p1, p2) => p2.toUpperCase()
					);
					acc[pascalKey] = value.trim();
				}
				return acc;
			},
			{}
		);
	}

	return [frontmatter, textWithoutFrontmatter, frontmatterDict];
}

export { extractFrontmatter, normalizeNote, normalizeDate };
export type { NormalizedNote, PreNormalizedNote };
