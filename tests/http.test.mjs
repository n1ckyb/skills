import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { fetchJson, fetchText, createRequestBudget, isAllowedRedirectHost } from "../extensions/skill-explorer/lib/http.mjs";

function response(statusCode, body, headers = {}) {
    const res = new EventEmitter();
    res.statusCode = statusCode;
    res.headers = headers;
    queueMicrotask(() => {
        if (body !== undefined) {
            res.emit("data", Buffer.from(body));
            res.emit("end");
        }
    });
    res.resume = () => {};
    return res;
}

test("fetchJson reports malformed responses consistently", async () => {
    const original = https.get;
    https.get = (url, options, callback) => {
        const req = new EventEmitter();
        queueMicrotask(() => callback(response(200, "{not-json")));
        return req;
    };
    try { await assert.rejects(fetchJson("https://example.test"), /Malformed JSON response/); }
    finally { https.get = original; }
});

test("fetchText preserves 403 and 429 status errors", async () => {
    const original = https.get;
    let status = 403;
    https.get = (url, options, callback) => {
        const req = new EventEmitter();
        queueMicrotask(() => callback(response(status, "denied")));
        return req;
    };
    try {
        await assert.rejects(fetchText("https://example.test"), error => error.statusCode === 403);
        status = 429;
        await assert.rejects(fetchText("https://example.test"), error => error.statusCode === 429);
    } finally { https.get = original; }
});

test("request helper enforces timeout and request budgets", async () => {
    const original = https.get;
    https.get = (url, options, callback) => {
        const req = new EventEmitter();
        options.signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            req.emit("error", error);
        });
        return req;
    };
    try {
        await assert.rejects(fetchText("https://example.test", { timeoutMs: 5 }), /timed out/);
        const budget = createRequestBudget({ maxRequests: 1, timeoutMs: 1000 });
        await assert.rejects(fetchText("https://example.test", { budget, timeoutMs: 5 }), /timed out/);
        await assert.rejects(fetchText("https://example.test", { budget }), /budget exhausted/);
    } finally { https.get = original; }
});

test("request helper rejects oversized responses", async () => {
    const original = https.get;
    https.get = (url, options, callback) => {
        const req = new EventEmitter();
        queueMicrotask(() => callback(response(200, "0123456789")));
        req.destroy = () => {};
        return req;
    };
    try { await assert.rejects(fetchText("https://example.test", { maxBytes: 4 }), /exceeds maximum size/); }
    finally { https.get = original; }
});

test("request helper rejects insecure redirects", async () => {
    const original = https.get;
    https.get = (url, options, callback) => {
        const req = new EventEmitter();
        queueMicrotask(() => callback(response(302, "", { location: "http://example.test/insecure" })));
        return req;
    };
    try {
        await assert.rejects(fetchText("https://example.test", { maxRedirects: 1 }), /redirect must use HTTPS/i);
    } finally { https.get = original; }
});
test("request helper is idempotent and destroys response stream on size overflow", async () => {
    const original = https.get;
    let destroyed = false;
    https.get = (url, options, callback) => {
        const req = new EventEmitter();
        req.destroy = () => {};
        const res = new EventEmitter();
        res.statusCode = 200;
        res.headers = {};
        res.destroy = () => { destroyed = true; };
        res.resume = () => {};
        queueMicrotask(() => {
            callback(res);
            res.emit("data", Buffer.from("01234"));
            res.emit("data", Buffer.from("56789"));
            res.emit("data", Buffer.from("late"));
            res.emit("end");
            res.emit("error", new Error("late error"));
            req.emit("error", new Error("late req error"));
        });
        return req;
    };
    try {
        await assert.rejects(fetchText("https://example.test", { maxBytes: 4 }), /exceeds maximum size/);
        assert.equal(destroyed, true);
    } finally { https.get = original; }
});

test("request helper rejects redirects to hosts outside the allowlist", async () => {
    const original = https.get;
    https.get = (url, options, callback) => {
        const req = new EventEmitter();
        queueMicrotask(() => callback(response(302, "", { location: "https://evil.example/payload" })));
        return req;
    };
    try {
        await assert.rejects(
            fetchText("https://raw.githubusercontent.com/o/r/main/SKILL.md", { maxRedirects: 3 }),
            /redirect to disallowed host: evil\.example/i
        );
    } finally { https.get = original; }
});

test("request helper drops credential headers on a cross-origin redirect", async () => {
    const original = https.get;
    const seen = [];
    https.get = (url, options, callback) => {
        const req = new EventEmitter();
        seen.push({ url: String(url), headers: options.headers });
        queueMicrotask(() => {
            if (seen.length === 1) callback(response(302, "", { location: "https://raw.githubusercontent.com/o/r/main/SKILL.md" }));
            else callback(response(200, "ok"));
        });
        return req;
    };
    try {
        const body = await fetchText("https://api.github.com/repos/o/r", {
            headers: { Authorization: "Bearer secret-token", Cookie: "session=1", "X-Api-Key": "k", "User-Agent": "ua" }
        });
        assert.equal(body, "ok");
        assert.equal(seen.length, 2);
        assert.equal(seen[0].headers.Authorization, "Bearer secret-token");
        assert.equal(seen[1].headers.Authorization, undefined, "Authorization must not cross origins");
        assert.equal(seen[1].headers.Cookie, undefined);
        assert.equal(seen[1].headers["X-Api-Key"], undefined);
        assert.equal(seen[1].headers["User-Agent"], "ua", "non-sensitive headers are preserved");
    } finally { https.get = original; }
});

test("request helper preserves headers on a same-origin redirect", async () => {
    const original = https.get;
    const seen = [];
    https.get = (url, options, callback) => {
        const req = new EventEmitter();
        seen.push(options.headers);
        queueMicrotask(() => {
            if (seen.length === 1) callback(response(302, "", { location: "https://api.github.com/repos/o/r/contents" }));
            else callback(response(200, "ok"));
        });
        return req;
    };
    try {
        await fetchText("https://api.github.com/repos/o/r", { headers: { Authorization: "Bearer t", "User-Agent": "ua" } });
        assert.equal(seen[1].Authorization, "Bearer t");
    } finally { https.get = original; }
});

test("isAllowedRedirectHost accepts known skill hosts and rejects everything else", () => {
    for (const host of ["raw.githubusercontent.com", "api.github.com", "GitHub.com", "www.skills.sh"]) {
        assert.equal(isAllowedRedirectHost(host), true, `expected ${host} allowed`);
    }
    for (const host of ["evil.example", "githubusercontent.com.evil.test", "", null, "api.github.com.evil.io"]) {
        assert.equal(isAllowedRedirectHost(host), false, `expected ${String(host)} rejected`);
    }
});
