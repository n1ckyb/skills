import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFileBounds, calculateContentDigest } from "../extension/lib/vetting.mjs";

test("calculateContentDigest is deterministic and depends on sorted file paths", () => {
    const map1 = {
        "SKILL.md": "name: test\n",
        "lib/util.js": "console.log(1);"
    };

    const map2 = {
        "lib/util.js": "console.log(1);",
        "SKILL.md": "name: test\n"
    };

    const digest1 = calculateContentDigest(map1);
    const digest2 = calculateContentDigest(map2);

    assert.equal(digest1, digest2);
    assert.match(digest1, /^sha256:[a-f0-9]{64}$/);
});

test("calculateContentDigest produces different digest for altered content", () => {
    const map1 = { "SKILL.md": "name: test\n" };
    const map2 = { "SKILL.md": "name: test-altered\n" };

    assert.notEqual(calculateContentDigest(map1), calculateContentDigest(map2));
});

test("validateFileBounds rejects > 200 files", () => {
    const hugeMap = {};
    for (let i = 0; i < 201; i++) {
        hugeMap[`file${i}.txt`] = "ok";
    }
    assert.throws(() => validateFileBounds(hugeMap), /File count limit exceeded/i);
});

test("validateFileBounds rejects file > 1 MiB", () => {
    const bigBuf = Buffer.alloc(1024 * 1024 + 1, "a");
    assert.throws(() => validateFileBounds({ "big.txt": bigBuf }), /File size limit exceeded/i);
});

test("validateFileBounds rejects total content > 5 MiB", () => {
    const buf = Buffer.alloc(900 * 1024, "a");
    const map = {
        "f1.txt": buf,
        "f2.txt": buf,
        "f3.txt": buf,
        "f4.txt": buf,
        "f5.txt": buf,
        "f6.txt": buf
    };
    assert.throws(() => validateFileBounds(map), /Total content size limit exceeded/i);
});

test("validateFileBounds rejects binary files containing null bytes", () => {
    const binBuf = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x00, 0x6f]);
    assert.throws(() => validateFileBounds({ "bin.dat": binBuf }), /Binary or unreadable file rejected/i);
});

test("validateFileBounds rejects unsafe path traversal", () => {
    assert.throws(() => validateFileBounds({ "../trap.js": "bad" }), /Unsafe file path rejected/i);
});
