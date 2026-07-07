#!/usr/bin/env node
// Read-only helper for local shapez.io save files.

const crypto = require("crypto");
const fs = require("fs");

const COMPRESSION_PREFIX = String.fromCodePoint(1);
const LZ_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$";
const COMPRESS_OBJECT_ALPHABET =
    "!#%&'()*+,-./:;<=>?@[]^_`{|}~" +
    "\xa5\xa6\xa7\xa8\xa9\xaa\xab\xac\xad\xae\xaf\xb0\xb1\xb2\xb3\xb4\xb5\xb6\xb7\xb8\xb9\xba\xbb\xbc\xbd\xbe\xbf" +
    "\xc0\xc1\xc2\xc3\xc4\xc5\xc6\xc7\xc8\xc9\xca\xcb\xcc\xcd\xce\xcf\xd0\xd1\xd2\xd3\xd4\xd5\xd6\xd7\xd8\xd9\xda\xdb\xdc\xdd\xde\xdf" +
    "\xe0\xe1\xe2\xe3\xe4\xe5\xe6\xe7\xe8\xe9\xea\xeb\xec\xed\xee\xef\xf0\xf1\xf2\xf3\xf4\xf5\xf6\xf7\xf8\xf9\xfa\xfb\xfc\xfd\xfe\xff" +
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SHAPEZ_FILE_SALT = "Ec'])@^+*9zMevK3uMV4432x9%iK'=";
const CRC_PREFIX = "crc32".padEnd(32, "-");

function makeCrcTable() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; ++i) {
        let c = i;
        for (let k = 0; k < 8; ++k) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[i] = c >>> 0;
    }
    return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(text) {
    const bytes = Buffer.from(text);
    let crc = -1;
    for (const byte of bytes) {
        crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
    return (-1 ^ crc) >>> 0;
}

function computeCrc(text) {
    return CRC_PREFIX + crc32(text).toString(16).padStart(8, "0");
}

function getBaseValue(alphabet, char) {
    const value = alphabet.indexOf(char);
    if (value < 0) {
        throw new Error(`Bad LZ character: ${JSON.stringify(char)}`);
    }
    return value;
}

function decompressX64(input) {
    if (input == null) {
        return "";
    }
    if (input === "") {
        return null;
    }
    input = input.replace(/ /g, "+");
    return decompressLz(input.length, 32, index => getBaseValue(LZ_ALPHABET, input.charAt(index)));
}

function decompressLz(length, resetValue, getNextValue) {
    const dictionary = [];
    let next;
    let enlargeIn = 4;
    let dictSize = 4;
    let numBits = 3;
    let entry = "";
    const result = [];
    let bits;
    let resb;
    let maxpower;
    let power;
    let c;
    const data = { val: getNextValue(0), position: resetValue, index: 1 };

    for (let i = 0; i < 3; i++) {
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

    switch ((next = bits)) {
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
            c = String.fromCharCode(bits);
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
            c = String.fromCharCode(bits);
            break;
        case 2:
            return "";
        default:
            throw new Error(`Unexpected initial LZ code: ${next}`);
    }
    dictionary[3] = c;
    let w = c;
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

        switch ((c = bits)) {
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
                dictionary[dictSize++] = String.fromCharCode(bits);
                c = dictSize - 1;
                enlargeIn--;
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
                dictionary[dictSize++] = String.fromCharCode(bits);
                c = dictSize - 1;
                enlargeIn--;
                break;
            case 2:
                return result.join("");
        }

        if (enlargeIn === 0) {
            enlargeIn = Math.pow(2, numBits);
            numBits++;
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
        enlargeIn--;
        w = entry;

        if (enlargeIn === 0) {
            enlargeIn = Math.pow(2, numBits);
            numBits++;
        }
    }
}

function decompressInt(value) {
    let result = 0;
    value = String(value);
    for (let i = value.length - 1; i >= 0; --i) {
        result = result * COMPRESS_OBJECT_ALPHABET.length + COMPRESS_OBJECT_ALPHABET.indexOf(value.charAt(i));
    }
    return result - 1;
}

function decompressObject(value) {
    if (!value || !value.keys || !value.values || !value.data) {
        return value;
    }
    const keys = value.keys;
    const values = value.values;
    function visit(node) {
        if (Array.isArray(node)) {
            return node.map(visit);
        }
        if (node && typeof node === "object") {
            const out = {};
            for (const key of Object.keys(node)) {
                out[keys[decompressInt(key)]] = visit(node[key]);
            }
            return out;
        }
        return typeof node === "string" ? values[decompressInt(node)] : node;
    }
    return visit(value.data);
}

function readSave(savePath, { verify = true } = {}) {
    const raw = fs.readFileSync(savePath, "utf8");
    if (!raw.startsWith(COMPRESSION_PREFIX)) {
        throw new Error("Save is missing the shapez compression prefix");
    }
    const decompressed = decompressX64(raw.slice(COMPRESSION_PREFIX.length));
    if (!decompressed || decompressed.length < 40) {
        throw new Error("Save decompression failed or payload is too short");
    }
    const checksum = decompressed.slice(0, 40);
    const json = decompressed.slice(40);
    if (verify) {
        const actual = checksum.startsWith(CRC_PREFIX)
            ? computeCrc(json + SHAPEZ_FILE_SALT)
            : crypto.createHash("sha1").update(json + SHAPEZ_FILE_SALT).digest("hex");
        if (actual !== checksum) {
            throw new Error(`Checksum mismatch: ${actual} vs ${checksum}`);
        }
    }
    return decompressObject(JSON.parse(json));
}

function summarize(save) {
    const data = save.currentData || save.dump || save;
    const hub = data.hubGoals || {};
    const map = data.map || {};
    const entities = Array.isArray(data.entities) ? data.entities : [];
    const entityCounts = {};
    for (const entity of entities) {
        const code = entity?.components?.StaticMapEntity?.code || entity?.components?.StaticMapEntity?.buildingCode || "unknown";
        entityCounts[code] = (entityCounts[code] || 0) + 1;
    }
    return {
        version: save.version,
        name: save.name,
        lastUpdate: save.lastUpdate,
        hubLevel: hub.level,
        currentGoal: hub.currentGoal,
        storedShapes: hub.storedShapes,
        upgradeLevels: hub.upgradeLevels,
        mapSeed: map.seed,
        entityCount: entities.length,
        entityCounts,
    };
}

function main() {
    const [command, savePath, arg] = process.argv.slice(2);
    if (!command || !savePath) {
        console.error("Usage: node shapez-save-tool.js <summary|dump-path|dump> <save.bin> [json.path]");
        process.exit(2);
    }
    const save = readSave(savePath);
    if (command === "summary") {
        console.log(JSON.stringify(summarize(save), null, 2));
        return;
    }
    if (command === "dump") {
        console.log(JSON.stringify(save, null, 2));
        return;
    }
    if (command === "dump-path") {
        let value = save;
        for (const part of (arg || "").split(".").filter(Boolean)) {
            value = value?.[part];
        }
        console.log(JSON.stringify(value, null, 2));
        return;
    }
    console.error(`Unknown command: ${command}`);
    process.exit(2);
}

main();
