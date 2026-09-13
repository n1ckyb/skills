import https from "node:https";

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
    }

    take() {
        if (this.remaining <= 0) throw new Error("Request budget exhausted");
        if (Date.now() >= this.deadline) throw new Error("Operation request budget exhausted");
        this.remaining--;
        this.attempted++;
    }
}

export function createRequestBudget(options) {
    return new RequestBudget(options);
}

export function requestText(url, options = {}) {
    const config = { ...DEFAULT_HTTP_OPTIONS, ...options };
    const budget = config.budget;
    const request = (target, redirects) => new Promise((resolve, reject) => {
        try { budget?.take(); } catch (error) { reject(error); return; }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, Math.max(1, (budget?.deadline || Infinity) - Date.now())));
        const req = https.get(target, {
            headers: config.headers,
            signal: controller.signal
        }, res => {
            const location = res.headers.location;
            if (res.statusCode >= 300 && res.statusCode < 400 && location) {
                res.resume();
                clearTimeout(timer);
                const redirectUrl = new URL(location, target);
                if (redirectUrl.protocol !== "https:") {
                    reject(new Error(`HTTP redirect must use HTTPS: ${redirectUrl.protocol}`));
                    return;
                }
                if (redirects >= config.maxRedirects) {
                    reject(new Error(`HTTP redirect limit exceeded (${config.maxRedirects})`));
                    return;
                }
                request(redirectUrl.toString(), redirects + 1).then(resolve, reject);
                return;
            }
            let size = 0;
            const chunks = [];
            res.on("data", chunk => {
                size += chunk.length;
                if (size > config.maxBytes) {
                    req.destroy?.();
                    reject(new Error(`HTTP response exceeds maximum size (${config.maxBytes} bytes)`));
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => {
                clearTimeout(timer);
                const body = Buffer.concat(chunks).toString("utf8");
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const error = new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`);
                    error.statusCode = res.statusCode;
                    reject(error);
                } else resolve(body);
            });
            res.on("error", error => { clearTimeout(timer); reject(error); });
        });
        req.on("error", error => {
            clearTimeout(timer);
            reject(error.name === "AbortError" ? new Error(`HTTP request timed out after ${config.timeoutMs}ms`) : error);
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
