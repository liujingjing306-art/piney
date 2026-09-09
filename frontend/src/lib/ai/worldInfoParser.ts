export type ParsedWorldInfoEntry = {
    comment: string;
    content: string;
    keys: string[];
};

const ARRAY_WRAPPER_KEYS = [
    "entries",
    "worldInfo",
    "world_info",
    "worldbook",
    "world_book",
    "items",
    "data",
    "result",
    "results",
];

function replaceControlCharactersInsideStrings(value: string): string {
    let result = "";
    let inString = false;
    let escaped = false;

    for (const character of value) {
        if (!inString) {
            if (character === '"') inString = true;
            result += character;
            continue;
        }

        if (escaped) {
            escaped = false;
            result += character;
            continue;
        }

        if (character === "\\") {
            escaped = true;
            result += character;
        } else if (character === '"') {
            inString = false;
            result += character;
        } else if (character === "\n") {
            result += "\\n";
        } else if (character === "\r") {
            result += "\\r";
        } else if (character === "\t") {
            result += "\\t";
        } else {
            result += character;
        }
    }

    return result;
}

function removeTrailingCommas(value: string): string {
    let result = "";
    let inString = false;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (inString) {
            result += character;
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
            result += character;
            continue;
        }

        if (character === ",") {
            let nextIndex = index + 1;
            while (nextIndex < value.length && /\s/.test(value[nextIndex])) nextIndex += 1;
            if (value[nextIndex] === "}" || value[nextIndex] === "]") continue;
        }

        result += character;
    }

    return result;
}

function parseJsonCandidate(candidate: string): unknown {
    const normalized = candidate.replace(/^\uFEFF/, "").trim();
    const quoteNormalized = normalized.replace(/[“”]/g, '"');

    const attempts = [
        normalized,
        replaceControlCharactersInsideStrings(normalized),
        removeTrailingCommas(normalized),
        removeTrailingCommas(replaceControlCharactersInsideStrings(normalized)),
        quoteNormalized,
        removeTrailingCommas(replaceControlCharactersInsideStrings(quoteNormalized)),
    ];

    for (const attempt of attempts) {
        try {
            return JSON.parse(attempt);
        } catch {
            // Try the next conservative repair.
        }
    }

    return undefined;
}

function extractBalancedFragments(value: string): string[] {
    const fragments: string[] = [];
    const stack: string[] = [];
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
            continue;
        }

        if (character === "[" || character === "{") {
            if (stack.length === 0) start = index;
            stack.push(character);
            continue;
        }

        if (character !== "]" && character !== "}") continue;
        const expected = character === "]" ? "[" : "{";
        if (stack.at(-1) !== expected) {
            stack.length = 0;
            start = -1;
            continue;
        }

        stack.pop();
        if (stack.length === 0 && start >= 0) {
            fragments.push(value.slice(start, index + 1));
            start = -1;
        }
    }

    return fragments;
}

function extractCompleteObjects(value: string): string[] {
    const objects: string[] = [];
    let start = -1;
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === "{") {
            if (depth === 0) start = index;
            depth += 1;
        } else if (character === "}" && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                objects.push(value.slice(start, index + 1));
                start = -1;
            }
        }
    }

    return objects;
}

function asEntryArray(value: unknown): unknown[] | undefined {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return undefined;

    const object = value as Record<string, unknown>;
    for (const key of ARRAY_WRAPPER_KEYS) {
        const nested = asEntryArray(object[key]);
        if (nested) return nested;
    }

    if ("comment" in object || "content" in object || "keys" in object) return [object];

    const values = Object.values(object);
    if (values.length > 0 && values.every((item) => item && typeof item === "object")) {
        const entryValues = values.filter((item) => {
            const candidate = item as Record<string, unknown>;
            return "comment" in candidate || "content" in candidate || "keys" in candidate;
        });
        if (entryValues.length > 0) return entryValues;
    }

    return undefined;
}

function stringValue(value: unknown): string {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value)) {
        return value.map((item) => stringValue(item)).filter(Boolean).join("\n\n");
    }
    return "";
}

function normalizeEntries(value: unknown, maxCount: number): ParsedWorldInfoEntry[] {
    const entries = asEntryArray(value);
    if (!entries) return [];

    return entries
        .map((item): ParsedWorldInfoEntry | null => {
            if (!item || typeof item !== "object") return null;
            const entry = item as Record<string, unknown>;
            const rawKeys = entry.keys ?? entry.keywords ?? entry.key ?? entry.triggers ?? entry.trigger_keys ?? [];
            const keys = (Array.isArray(rawKeys) ? rawKeys : String(rawKeys || "").split(/[,，、\n]/))
                .map((key) => String(key).trim())
                .filter(Boolean);

            const comment = stringValue(entry.comment ?? entry.name ?? entry.title ?? entry.entry_name);
            const content = stringValue(entry.content ?? entry.description ?? entry.text ?? entry.value ?? entry.lore);
            if (!comment && !content) return null;
            return { comment, content, keys };
        })
        .filter((entry): entry is ParsedWorldInfoEntry => Boolean(entry))
        .slice(0, maxCount);
}

export function parseGeneratedWorldInfo(content: string, maxCount: number): ParsedWorldInfoEntry[] {
    const cleaned = content
        .replace(/<(think|thinking|cot)>[\s\S]*?<\/\1>/gi, "")
        .replace(/<\/?(?:think|thinking|cot)>/gi, "")
        .trim();
    const candidates = [cleaned];
    const fencedPattern = /```(?:json|javascript|js)?\s*([\s\S]*?)```/gi;
    for (const match of cleaned.matchAll(fencedPattern)) candidates.push(match[1]);
    candidates.push(...extractBalancedFragments(cleaned));

    let best: ParsedWorldInfoEntry[] = [];
    let bestScore = -1;
    for (const candidate of [...new Set(candidates)]) {
        const parsed = parseJsonCandidate(candidate);
        if (parsed === undefined) continue;
        const entries = normalizeEntries(parsed, maxCount);
        if (entries.length === 0) continue;

        const score = (entries.length === maxCount ? 100_000 : 0)
            + entries.length * 10_000
            + entries.reduce((total, entry) => total + entry.content.length, 0);
        if (score > bestScore) {
            best = entries;
            bestScore = score;
        }
    }

    if (best.length > 0) return best;

    // A provider may stop at its token limit after completing one or more objects.
    // Salvage those complete entries rather than throwing away the whole paid response.
    const recovered = extractCompleteObjects(cleaned)
        .map((candidate) => parseJsonCandidate(candidate))
        .filter((candidate) => candidate !== undefined)
        .flatMap((candidate) => normalizeEntries(candidate, maxCount));
    return recovered.slice(0, maxCount);
}
