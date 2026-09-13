import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { fetchJson, fetchText, createRequestBudget } from "../extensions/skill-explorer/lib/http.mjs";

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
