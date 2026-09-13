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

/**
 * Hosts this client is permitted to follow a redirect to.
 *
 * Redirect targets are attacker-influenced: any upstream can answer with a 302 to an arbitrary host.
 * Validating only the protocol would let an untrusted host serve skill content under trusted-looking
 * provenance, and would forward request headers off-origin the moment an auth token is introduced.
 */
export const ALLOWED_REDIRECT_HOSTS = Object.freeze([
    "github.com",
    "api.github.com",
    "raw.githubusercontent.com",
    "codeload.github.com",
    "objects.githubusercontent.com",
    "awesome-copilot.github.com",
    "www.aihero.dev",
    "aihero.dev",
    "www.skills.sh",
    "skills.sh"
]);

export function isAllowedRedirectHost(hostname) {
    if (typeof hostname !== "string" || !hostname) return false;
    return ALLOWED_REDIRECT_HOSTS.includes(hostname.toLowerCase());
}

const SENSITIVE_HEADER_PATTERN = /^(?:authorization|cookie|proxy-authorization|x-[a-z-]*(?:token|key|auth)[a-z-]*)$/i;

export function stripSensitiveHeaders(headers) {
    if (!headers || typeof headers !== "object") return headers;
    const safe = {};
    for (const [name, value] of Object.entries(headers)) {
        if (SENSITIVE_HEADER_PATTERN.test(name)) continue;
        safe[name] = value;
    }
    return safe;
}

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
    const request = (target, redirects, headers) => new Promise((resolve, reject) => {
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
            headers,
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
                const allowedHosts = config.allowedRedirectHosts;
                const hostAllowed = Array.isArray(allowedHosts)
                    ? allowedHosts.map(host => String(host).toLowerCase()).includes(redirectUrl.hostname.toLowerCase())
                    : isAllowedRedirectHost(redirectUrl.hostname);
                if (!hostAllowed) {
                    settleReject(new Error(`HTTP redirect to disallowed host: ${redirectUrl.hostname}`));
                    return;
                }
                if (redirects >= config.maxRedirects) {
                    settleReject(new Error(`HTTP redirect limit exceeded (${config.maxRedirects})`));
                    return;
                }
                // Headers may carry credentials, so they are only replayed on a same-origin hop.
                const sameOrigin = redirectUrl.hostname.toLowerCase() === new URL(target).hostname.toLowerCase();
                settled = true;
                request(redirectUrl.toString(), redirects + 1, sameOrigin ? headers : stripSensitiveHeaders(headers)).then(resolve, reject);
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
    return request(url, 0, config.headers);
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
