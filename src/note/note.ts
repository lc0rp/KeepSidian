interface NormalizedNote {
    title: string;
    text: string;
    body: string;
    created: Date | null;
    updated: Date | null;
    frontmatter: string;
    frontmatterDict: { [key: string]: string };
    archived: boolean;
    trashed: boolean;
    labels: string[];
    blobs: string[];
    blob_names: string[];
    media: string[];
    header: string;
}

function normalizeDate(dateString?: string): Date | null {
    if (!dateString) {
        return null;
    }
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? null : date;
}

function normalizeNote(note: any): NormalizedNote {
    const normalizedNote: NormalizedNote = {
        title: note.title?.trim(),
        text: note.text?.trim(),
        created: normalizeDate(note.created),
        updated: normalizeDate(note.updated),
        archived: note.archived,
        trashed: note.trashed,
        labels: note.labels,
        blobs: note.blobs,
        blob_names: note.blob_names,
        media: note.media,
        header: note.header,
        body: '',
        frontmatter: '',
        frontmatterDict: {},
    }

    const [frontmatter, body, frontmatterDict] = extractFrontmatter(note.text);
    normalizedNote.frontmatter = frontmatter;
    normalizedNote.body = body;
    normalizedNote.frontmatterDict = frontmatterDict;

    return normalizedNote;
}

function extractFrontmatter(text: string): [string, string, { [key: string]: string }] {
    // Frontmatter is between --- and --- at the start of the text if it exists
    let body = text
    let frontmatter = '';
    let frontmatterDict = {};
    const splitText = text?.split('---');
    if (splitText && splitText.length > 2) {
        frontmatter = splitText[1].trim();
        body = splitText[2].trim();
    }

    // Split frontmatter into key value pairs
    const frontmatter_parts = frontmatter?.split('\n');
    if (frontmatter) {
        frontmatterDict = frontmatter_parts.reduce((acc: { [key: string]: string }, item: string) => {
            const [key, value] = item.split(': ');
            if (key && value) {
                // Convert key to PascalCase
                const pascalKey = key.replace(/(^|-)([a-z])/g, (match, p1, p2) => p2.toUpperCase());
                acc[pascalKey] = value.trim();
            }
            return acc;
        }, {});
    }

    return [frontmatter, body, frontmatterDict];
}


export { extractFrontmatter, normalizeNote, normalizeDate };
export type { NormalizedNote };