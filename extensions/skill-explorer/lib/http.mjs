import https from "node:https";

/**
 * Skill Explorer HTTP Transport & Request Budget Management Module
 *
 * Responsibilities:
 * - Bounded, non-blocking HTTPS client with redirect limits, response size limits, and timeout controls.
 * - Enforcing global per-operation request budgets and overall operation execution deadlines.
 * - Collecting transport-level counters (httpRequests, gitCommands, childProcesses, filesystemOperations).
 * - Safe response stream destruction on size limit overflows or timeouts to prevent socket leaks.
 */

export const DEFAULT_HTTP_OPTIONS = Object.freeze({
    timeoutMs: 10_000,
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 3
});

export class RequestBudget {
    constructor({ maxRequests = 24, timeoutMs = 60_000 } = {}) {
        this.maxRequests = maxRequests;
        this.remaining = maxRequests;
        this.deadline = Date.now() + timeoutMs;
        this.attempted = 0;
        this.counters = { httpRequests: 0, gitCommands: 0, childProcesses: 0, filesystemOperations: 0 };
        this.startedAt = Date.now();
    }

    take(kind = "httpRequests") {
        if (this.remaining <= 0) throw new Error("Request budget exhausted");
        if (Date.now() >= this.deadline) throw new Error("Operation request budget exhausted");
        this.remaining--;
        this.attempted++;
        if (Object.prototype.hasOwnProperty.call(this.counters, kind)) this.counters[kind]++;
    }

    count(kind, amount = 1) {
        if (Object.prototype.hasOwnProperty.call(this.counters, kind)) this.counters[kind] += amount;
    }

    snapshot() {
        return {
            ...this.counters,
            requestsAttempted: this.attempted,
            requestsRemaining: this.remaining,
            elapsedMs: Math.max(0, Date.now() - this.startedAt)
        };
    }
}

export function createRequestBudget(options) {
    return new RequestBudget(options);
}

export function requestText(url, options = {}) {
    const config = { ...DEFAULT_HTTP_OPTIONS, ...options };
    const budget = config.budget;
    const request = (target, redirects) => new Promise((resolve, reject) => {
        try { budget?.take("httpRequests"); } catch (error) { reject(error); return; }

        let settled = false;
        let timer = null;
        let req = null;
        let res = null;

        const cleanup = () => {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
        };

        const settleReject = (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (res) res.destroy?.();
            if (req) req.destroy?.();
            reject(err);
        };

        const settleResolve = (val) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(val);
        };

        const controller = new AbortController();
        const remainingTime = Math.min(config.timeoutMs, Math.max(1, (budget?.deadline || Infinity) - Date.now()));
        timer = setTimeout(() => {
            controller.abort();
        }, remainingTime);

        req = https.get(target, {
            headers: config.headers,
            signal: controller.signal
        }, responseStream => {
            res = responseStream;
            if (settled) {
                res.destroy?.();
                return;
            }
            const location = res.headers.location;
            if (res.statusCode >= 300 && res.statusCode < 400 && location) {
                res.resume();
                cleanup();
                const redirectUrl = new URL(location, target);
                if (redirectUrl.protocol !== "https:") {
                    settleReject(new Error(`HTTP redirect must use HTTPS: ${redirectUrl.protocol}`));
                    return;
                }
                if (redirects >= config.maxRedirects) {
                    settleReject(new Error(`HTTP redirect limit exceeded (${config.maxRedirects})`));
                    return;
                }
                settled = true;
                request(redirectUrl.toString(), redirects + 1).then(resolve, reject);
                return;
            }
            let size = 0;
            const chunks = [];
            res.on("data", chunk => {
                if (settled) return;
                size += chunk.length;
                if (size > config.maxBytes) {
                    settleReject(new Error(`HTTP response exceeds maximum size (${config.maxBytes} bytes)`));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => {
                if (settled) return;
                const body = Buffer.concat(chunks).toString("utf8");
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const error = new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
                    error.statusCode = res.statusCode;
                    settleReject(error);
                } else {
                    settleResolve(body);
                }
            });
            res.on("error", error => {
                settleReject(error);
            });
        });

        req.on("error", error => {
            if (settled) return;
            const err = error.name === "AbortError" ? new Error(`HTTP request timed out after ${config.timeoutMs}ms`) : error;
            settleReject(err);
        });
    });
    return request(url, 0);
}

export function fetchJson(url, options = {}) {
    return requestText(url, {
        ...options,
        headers: { "User-Agent": "Copilot-Skill-Explorer", "Accept": "application/vnd.github.v3+json", ...options.headers }
    }).then(body => {
        try { return JSON.parse(body); }
        catch (error) { throw new Error(`Malformed JSON response: ${error.message}`); }
    });
}

export function fetchText(url, options = {}) {
    return requestText(url, {
        ...options,
        headers: { "User-Agent": "Copilot-Skill-Explorer", "Accept": "text/plain", ...options.headers }
    });
}
