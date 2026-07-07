#!/usr/bin/env node
// @ts-check

const fs = require("fs");
const path = require("path");

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const NOTES_PATH = path.join(WORKSPACE_ROOT, "notes", "level-notes.json");
const REPORTS_DIR = path.join(WORKSPACE_ROOT, "reports");

function usage() {
    console.log(`Shapez Save Assistant

Read-only helpers for copied/exported shapez.io save files.

Commands:
  inspect <savefile> [--json] [--out <summary.json>]
      Decode a save copy and print a progress summary.

  note add --level <n> --title <text> --text <text>
      Record a local level note under notes/level-notes.json.

  note list [--level <n>] [--json]
      Show local level notes.

  propose-delivery <savefile> --level <n>
      Print delivery/progress-like fields found in the decoded save.
      This command never writes a save file.

Safety:
  - The tool does not discover or touch the live game save directory.
  - The tool only reads the save path you pass explicitly.
  - Writes are limited to notes/ and reports/ inside this workspace.
`);
}

function fail(message) {
    console.error("Error: " + message);
    process.exit(1);
}

function parseArgs(argv) {
    const args = [];
    const flags = {};
    for (let i = 0; i < argv.length; ++i) {
        const value = argv[i];
        if (value.startsWith("--")) {
            const key = value.slice(2);
            const next = argv[i + 1];
            if (!next || next.startsWith("--")) {
                flags[key] = true;
            } else {
                flags[key] = next;
                i += 1;
            }
        } else {
            args.push(value);
        }
    }
    return { args, flags };
}

function ensureInsideWorkspace(filePath) {
    const resolved = path.resolve(filePath);
    const relative = path.relative(WORKSPACE_ROOT, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        fail("refusing to write outside workspace: " + resolved);
    }
    return resolved;
}

function readSave(filePath) {
    const resolved = path.resolve(filePath);
    const bytes = fs.readFileSync(resolved);
    const decoded = normalizeDecodedSaveText(decodeShapezSave(bytes));
    let data;
    let parseError = null;
    try {
        data = expandShapezCompactDump(JSON.parse(decoded));
    } catch (error) {
        data = null;
        parseError = error.message;
    }
    return { filePath: resolved, bytes, decoded, data, parseError };
}

function decodeShapezSave(bytes) {
    if (bytes.length === 0) {
        fail("save file is empty");
    }

    const version = bytes[0];
    const payload = bytes.slice(version === 0 || version === 1 ? 1 : 0).toString("utf8").trim();

    if (payload.startsWith("{")) {
        return payload;
    }

    const decoded = LZString.decompressFromEncodedURIComponent(payload) || LZString.decompressFromBase64(payload);
    if (!decoded) {
        fail("could not decode save payload as shapez/LZString base64");
    }
    return decoded;
}

function normalizeDecodedSaveText(decoded) {
    const trimmed = decoded.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        return trimmed;
    }

    const checksumHeader = /^crc32-+[0-9a-fA-F]+/.exec(trimmed);
    if (checksumHeader) {
        return trimmed.slice(checksumHeader[0].length);
    }

    return trimmed;
}

function inspectSave(filePath) {
    const save = readSave(filePath);
    const data = save.data;
    const topLevelKeys = data ? Object.keys(data).sort() : extractKeyTable(save.decoded);
    const progressFields = data ? findProgressFields(data) : findProgressTokens(save.decoded);
    const level = data
        ? getFirstNumber(data, [
            "currentLevel",
            "level",
            "story.currentLevel",
            "hubGoals.level",
            "dump.hubGoals.level",
            "gameMode.currentLevel",
        ])
        : inferLevelFromText(save.decoded);

    return {
        source: save.filePath,
        sourceBytes: save.bytes.length,
        decodedBytes: Buffer.byteLength(save.decoded, "utf8"),
        parseMode: data ? "json" : "shapez-compact-text",
        parseWarning: data ? null : "Decoded save is shapez compact dump text, not plain JSON. Reporting is key-table/token based.",
        parseError: save.parseError,
        topLevelKeys,
        likelyLevel: level,
        metadata: data ? pickPaths(data, [
            "version",
            "lastUpdate",
            "timePlayed",
            "seed",
            "name",
            "gameMode",
            "mods",
        ]) : pickTextMetadata(save.decoded, topLevelKeys),
        progressFields,
        noteStats: summarizeNotes(readNotesIfExists()),
    };
}

function expandShapezCompactDump(parsed) {
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.keys) || !("data" in parsed)) {
        return parsed;
    }

    const alphabet = makeCompactKeyAlphabet(parsed.keys.length);
    const keyByToken = new Map();
    for (let i = 0; i < parsed.keys.length; ++i) {
        keyByToken.set(alphabet[i], parsed.keys[i]);
    }

    return expandCompactNode(parsed.data, keyByToken, new WeakMap());
}

function makeCompactKeyAlphabet(length) {
    const alphabet = [];
    for (let code = 35; alphabet.length < length && code < 65536; ++code) {
        const char = String.fromCharCode(code);
        if (/[A-Za-z0-9"$\\]/.test(char)) {
            continue;
        }
        alphabet.push(char);
    }
    return alphabet;
}

function expandCompactNode(node, keyByToken, seen) {
    if (node === null || typeof node !== "object") {
        return node;
    }
    if (seen.has(node)) {
        return seen.get(node);
    }
    if (Array.isArray(node)) {
        const expandedArray = [];
        seen.set(node, expandedArray);
        for (const item of node) {
            expandedArray.push(expandCompactNode(item, keyByToken, seen));
        }
        return expandedArray;
    }

    const expanded = {};
    seen.set(node, expanded);
    for (const [rawKey, value] of Object.entries(node)) {
        const key = rawKey.length === 1 && keyByToken.has(rawKey) ? keyByToken.get(rawKey) : rawKey;
        expanded[key] = expandCompactNode(value, keyByToken, seen);
    }
    return expanded;
}

function extractKeyTable(decoded) {
    const marker = '"keys":[';
    const start = decoded.indexOf(marker);
    if (start < 0) {
        return [];
    }
    const arrayStart = start + '"keys":'.length;
    const end = decoded.indexOf("]", arrayStart);
    if (end < 0) {
        return [];
    }
    try {
        return JSON.parse(decoded.slice(arrayStart, end + 1));
    } catch (_error) {
        const dumpMarker = decoded.indexOf('],"dump"', arrayStart);
        const segmentEnd = dumpMarker > arrayStart ? dumpMarker : Math.min(decoded.length, arrayStart + 20000);
        const segment = decoded.slice(arrayStart, segmentEnd);
        const keys = [];
        const seen = new Set();
        const quotedString = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
        let match;
        while ((match = quotedString.exec(segment))) {
            const key = match[1];
            if (!seen.has(key)) {
                seen.add(key);
                keys.push(key);
            }
        }
        return keys;
    }
}

function pickTextMetadata(decoded, keys) {
    return {
        keyTableSize: keys.length,
        hasHubGoals: keys.includes("hubGoals") || decoded.includes("hubGoals"),
        hasLevelKey: keys.includes("level") || decoded.includes('"level"'),
        hasStoredShapes: keys.includes("storedShapes") || decoded.includes("storedShapes"),
        format: "shapez compact dump",
    };
}

function inferLevelFromText(decoded) {
    const levelNumber = /"level"\s*[:,]\s*(\d+)/.exec(decoded);
    if (levelNumber) {
        return Number(levelNumber[1]);
    }
    return null;
}

function pickPaths(root, candidates) {
    const result = {};
    for (const candidate of candidates) {
        const value = getPath(root, candidate);
        if (value !== undefined) {
            result[candidate] = shrinkValue(value);
        }
    }
    return result;
}

function getPath(root, dottedPath) {
    let node = root;
    for (const part of dottedPath.split(".")) {
        if (!node || typeof node !== "object" || !(part in node)) {
            return undefined;
        }
        node = node[part];
    }
    return node;
}

function getFirstNumber(root, candidates) {
    for (const candidate of candidates) {
        const value = getPath(root, candidate);
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    const matches = findFields(root, /(^|\.)(currentLevel|level)$/i, 12);
    for (const match of matches) {
        if (typeof match.value === "number" && Number.isFinite(match.value)) {
            return match.value;
        }
    }
    return null;
}

function findProgressFields(root) {
    const matches = findFields(root, /(level|tier|goal|hub|deliver|required|progress|upgrade|shape|amount|count)/i, 80);
    return matches.map(match => ({
        path: match.path,
        type: Array.isArray(match.value) ? "array" : typeof match.value,
        value: shrinkValue(match.value),
    }));
}

function findProgressTokens(decoded) {
    const keys = extractKeyTable(decoded);
    const progressKeys = keys.filter(key => /(level|tier|goal|hub|deliver|required|progress|upgrade|shape|amount|count|stored)/i.test(key));
    return progressKeys.slice(0, 80).map(key => ({
        path: "keyTable." + key,
        type: "compact-key",
        value: key,
    }));
}

function findFields(root, pattern, limit) {
    const matches = [];
    const seen = new Set();

    function visit(node, currentPath, depth) {
        if (matches.length >= limit || depth > 8 || node === null || typeof node !== "object") {
            return;
        }
        if (seen.has(node)) {
            return;
        }
        seen.add(node);

        if (Array.isArray(node)) {
            for (let i = 0; i < node.length && i < 80; ++i) {
                visit(node[i], currentPath + "[" + i + "]", depth + 1);
            }
            return;
        }

        const keys = Object.keys(node);
        for (const key of keys) {
            const nextPath = currentPath ? currentPath + "." + key : key;
            const value = node[key];
            if (pattern.test(nextPath)) {
                matches.push({ path: nextPath, value });
                if (matches.length >= limit) {
                    return;
                }
            }
            visit(value, nextPath, depth + 1);
        }
    }

    visit(root, "", 0);
    return matches;
}

function shrinkValue(value) {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return value;
    }
    if (Array.isArray(value)) {
        return {
            kind: "array",
            length: value.length,
            sample: value.slice(0, 3).map(shrinkValue),
        };
    }
    if (typeof value === "object") {
        const keys = Object.keys(value);
        const sample = {};
        for (const key of keys.slice(0, 12)) {
            sample[key] = shrinkValue(value[key]);
        }
        return {
            kind: "object",
            keys: keys.length,
            sample,
        };
    }
    return String(value);
}

function readNotesIfExists() {
    if (!fs.existsSync(NOTES_PATH)) {
        return { levels: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(NOTES_PATH, "utf8"));
    } catch (error) {
        fail("could not read notes file: " + error.message);
    }
}

function writeNotes(notes) {
    fs.mkdirSync(path.dirname(NOTES_PATH), { recursive: true });
    fs.writeFileSync(NOTES_PATH, JSON.stringify(notes, null, 2) + "\n");
}

function summarizeNotes(notes) {
    const levels = notes.levels || {};
    return {
        levelsWithNotes: Object.keys(levels).sort((a, b) => Number(a) - Number(b)),
        totalNotes: Object.values(levels).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0),
    };
}

function addNote(flags) {
    const level = Number(flags.level);
    if (!Number.isInteger(level) || level < 1) {
        fail("note add requires --level <positive integer>");
    }
    const title = String(flags.title || "").trim();
    const text = String(flags.text || "").trim();
    if (!title || !text) {
        fail("note add requires --title and --text");
    }

    const notes = readNotesIfExists();
    notes.levels = notes.levels || {};
    notes.levels[String(level)] = notes.levels[String(level)] || [];
    notes.levels[String(level)].push({
        title,
        text,
        createdAt: new Date().toISOString(),
    });
    writeNotes(notes);
    console.log("Added note for level " + level + " in " + NOTES_PATH);
}

function listNotes(flags) {
    const notes = readNotesIfExists();
    const levels = notes.levels || {};
    const requestedLevel = flags.level ? String(Number(flags.level)) : null;
    const output = requestedLevel ? { levels: { [requestedLevel]: levels[requestedLevel] || [] } } : notes;
    if (flags.json) {
        console.log(JSON.stringify(output, null, 2));
        return;
    }
    for (const level of Object.keys(output.levels || {}).sort((a, b) => Number(a) - Number(b))) {
        console.log("Level " + level);
        for (const note of output.levels[level]) {
            console.log("- " + note.title + " (" + note.createdAt + ")");
            console.log("  " + note.text);
        }
    }
}

function proposeDelivery(filePath, flags) {
    const level = Number(flags.level);
    if (!Number.isInteger(level) || level < 1) {
        fail("propose-delivery requires --level <positive integer>");
    }
    const save = readSave(filePath);
    const fields = save.data
        ? findDeliveryCandidates(save.data)
        : findProgressTokens(save.decoded);
    console.log(JSON.stringify({
        source: save.filePath,
        targetLevel: level,
        mode: "proposal-only",
        warning: save.data
            ? "No save file was written. Review these paths manually before changing any copied save."
            : "No save file was written. This save uses shapez compact dump text, so candidates are key-table tokens, not writable JSON paths.",
        candidates: fields.map(field => ({
            path: field.path,
            type: Array.isArray(field.value) ? "array" : typeof field.value,
            value: shrinkValue(field.value),
        })),
    }, null, 2));
}

function findDeliveryCandidates(data) {
    const candidates = [];
    for (const pathName of ["dump.hubGoals", "dump.hubGoals.level", "dump.hubGoals.storedShapes", "dump.hubGoals.beltPaths"]) {
        const value = getPath(data, pathName);
        if (value !== undefined) {
            candidates.push({ path: pathName, value });
        }
    }

    const storedShapes = getPath(data, "dump.hubGoals.storedShapes");
    if (storedShapes && typeof storedShapes === "object" && !Array.isArray(storedShapes)) {
        for (const [shapeKey, amount] of Object.entries(storedShapes).slice(0, 40)) {
            candidates.push({ path: "dump.hubGoals.storedShapes." + shapeKey, value: amount });
        }
    }

    return candidates;
}

function writeReport(outPath, summary) {
    const resolved = ensureInsideWorkspace(outPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(summary, null, 2) + "\n");
    console.error("Wrote summary: " + resolved);
}

function main() {
    const { args, flags } = parseArgs(process.argv.slice(2));
    const command = args[0];

    if (!command || command === "help" || flags.help) {
        usage();
        return;
    }

    if (command === "inspect") {
        const savefile = args[1];
        if (!savefile) {
            fail("inspect requires <savefile>");
        }
        const summary = inspectSave(savefile);
        if (flags.out) {
            writeReport(String(flags.out), summary);
        }
        if (flags.json || flags.out) {
            console.log(JSON.stringify(summary, null, 2));
        } else {
            console.log("Source: " + summary.source);
            console.log("Source bytes: " + summary.sourceBytes);
            console.log("Decoded bytes: " + summary.decodedBytes);
            console.log("Likely level: " + (summary.likelyLevel === null ? "unknown" : summary.likelyLevel));
            console.log("Top-level keys: " + summary.topLevelKeys.join(", "));
            console.log("Progress-like fields: " + summary.progressFields.length);
            for (const field of summary.progressFields.slice(0, 20)) {
                console.log("- " + field.path + " [" + field.type + "]");
            }
            console.log("Notes: " + summary.noteStats.totalNotes + " note(s)");
        }
        return;
    }

    if (command === "note") {
        const subcommand = args[1];
        if (subcommand === "add") {
            addNote(flags);
            return;
        }
        if (subcommand === "list") {
            listNotes(flags);
            return;
        }
        fail("unknown note command");
    }

    if (command === "propose-delivery") {
        const savefile = args[1];
        if (!savefile) {
            fail("propose-delivery requires <savefile>");
        }
        proposeDelivery(savefile, flags);
        return;
    }

    fail("unknown command: " + command);
}

const LZString = (() => {
    const f = String.fromCharCode;
    const keyStrBase64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
    const keyStrUriSafe = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
    const baseReverseDic = {};

    function getBaseValue(alphabet, character) {
        if (!baseReverseDic[alphabet]) {
            baseReverseDic[alphabet] = {};
            for (let i = 0; i < alphabet.length; i++) {
                baseReverseDic[alphabet][alphabet.charAt(i)] = i;
            }
        }
        return baseReverseDic[alphabet][character];
    }

    function decompressFromBase64(input) {
        if (input == null) {
            return "";
        }
        if (input === "") {
            return null;
        }
        return _decompress(input.length, 32, index => getBaseValue(keyStrBase64, input.charAt(index)));
    }

    function decompressFromEncodedURIComponent(input) {
        if (input == null) {
            return "";
        }
        if (input === "") {
            return null;
        }
        return _decompress(input.length, 32, index => getBaseValue(keyStrUriSafe, input.charAt(index)));
    }

    function _decompress(length, resetValue, getNextValue) {
        const dictionary = [];
        let next;
        let enlargeIn = 4;
        let dictSize = 4;
        let numBits = 3;
        let entry = "";
        const result = [];
        let i;
        let w;
        let bits;
        let resb;
        let maxpower;
        let power;
        let c;
        const data = { val: getNextValue(0), position: resetValue, index: 1 };

        for (i = 0; i < 3; i += 1) {
            dictionary[i] = i;
        }

        bits = 0;
        maxpower = Math.pow(2, 2);
        power = 1;
        while (power !== maxpower) {
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0) {
                data.position = resetValue;
                data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
        }

        next = bits;
        switch (next) {
            case 0:
                bits = 0;
                maxpower = Math.pow(2, 8);
                power = 1;
                while (power !== maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position === 0) {
                        data.position = resetValue;
                        data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }
                c = f(bits);
                break;
            case 1:
                bits = 0;
                maxpower = Math.pow(2, 16);
                power = 1;
                while (power !== maxpower) {
                    resb = data.val & data.position;
                    data.position >>= 1;
                    if (data.position === 0) {
                        data.position = resetValue;
                        data.val = getNextValue(data.index++);
                    }
                    bits |= (resb > 0 ? 1 : 0) * power;
                    power <<= 1;
                }
                c = f(bits);
                break;
            case 2:
                return "";
        }

        dictionary[3] = c;
        w = c;
        result.push(c);

        while (true) {
            if (data.index > length) {
                return "";
            }

            bits = 0;
            maxpower = Math.pow(2, numBits);
            power = 1;
            while (power !== maxpower) {
                resb = data.val & data.position;
                data.position >>= 1;
                if (data.position === 0) {
                    data.position = resetValue;
                    data.val = getNextValue(data.index++);
                }
                bits |= (resb > 0 ? 1 : 0) * power;
                power <<= 1;
            }

            c = bits;
            switch (c) {
                case 0:
                    bits = 0;
                    maxpower = Math.pow(2, 8);
                    power = 1;
                    while (power !== maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position === 0) {
                            data.position = resetValue;
                            data.val = getNextValue(data.index++);
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                    }
                    dictionary[dictSize++] = f(bits);
                    c = dictSize - 1;
                    enlargeIn -= 1;
                    break;
                case 1:
                    bits = 0;
                    maxpower = Math.pow(2, 16);
                    power = 1;
                    while (power !== maxpower) {
                        resb = data.val & data.position;
                        data.position >>= 1;
                        if (data.position === 0) {
                            data.position = resetValue;
                            data.val = getNextValue(data.index++);
                        }
                        bits |= (resb > 0 ? 1 : 0) * power;
                        power <<= 1;
                    }
                    dictionary[dictSize++] = f(bits);
                    c = dictSize - 1;
                    enlargeIn -= 1;
                    break;
                case 2:
                    return result.join("");
            }

            if (enlargeIn === 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits += 1;
            }

            if (dictionary[c]) {
                entry = dictionary[c];
            } else if (c === dictSize) {
                entry = w + w.charAt(0);
            } else {
                return null;
            }

            result.push(entry);
            dictionary[dictSize++] = w + entry.charAt(0);
            enlargeIn -= 1;
            w = entry;

            if (enlargeIn === 0) {
                enlargeIn = Math.pow(2, numBits);
                numBits += 1;
            }
        }
    }

    return { decompressFromBase64, decompressFromEncodedURIComponent };
})();

main();
