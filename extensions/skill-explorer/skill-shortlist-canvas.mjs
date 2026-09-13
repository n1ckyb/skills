import { createServer } from "node:http";
import { createCanvas, CanvasError } from "@github/copilot-sdk/extension";

const servers = new Map();

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
}

function safeUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.href : "";
    } catch {
        return "";
    }
}

function validateCandidates(input) {
    if (!input || !Array.isArray(input.candidates) || input.candidates.length === 0 || input.candidates.length > 50) {
        throw new CanvasError("invalid_shortlist", "Provide between 1 and 50 shortlisted skills.");
    }
    return input.candidates.map(candidate => {
        if (!candidate || typeof candidate.name !== "string" || typeof candidate.source !== "string") {
            throw new CanvasError("invalid_shortlist", "Each shortlisted skill requires a name and source.");
        }
        return {
            name: candidate.name.slice(0, 120),
            source: candidate.source.slice(0, 500),
            description: String(candidate.description || "").slice(0, 500),
            url: safeUrl(String(candidate.url || "").slice(0, 1000))
        };
    });
}

function renderHtml(candidates) {
    const cards = candidates.map((candidate, index) => `
        <article>
          <h2>${escapeHtml(candidate.name)}</h2>
          <p>${escapeHtml(candidate.description || "No description provided.")}</p>
          <p class="source">${escapeHtml(candidate.source)}</p>
          ${candidate.url ? `<a href="${escapeHtml(candidate.url)}" target="_blank" rel="noreferrer">View source</a>` : ""}
          <div class="actions">
            <button data-action="details" data-index="${index}">Request details</button>
            <button data-action="vet" data-index="${index}">Request vetting</button>
            <button data-action="install" data-index="${index}">Request install</button>
          </div>
        </article>`).join("");

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>Skill Explorer shortlist</title>
<style>
body { margin: 0; padding: 16px; background: var(--background-color-default, #fff); color: var(--text-color-default, #1f2328); font-family: var(--font-sans, system-ui); }
h1 { margin-top: 0; } article { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 8px; margin: 12px 0; padding: 12px; }
h2 { font-size: 16px; margin: 0 0 8px; } p { margin: 8px 0; } .source { color: var(--text-color-muted, #57606a); font-family: var(--font-mono, monospace); font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; } button { border: 1px solid var(--border-color-default, #d0d7de); border-radius: 6px; background: var(--button-default-bgColor-rest, #f6f8fa); color: inherit; cursor: pointer; padding: 6px 10px; }
#status { color: var(--text-color-muted, #57606a); min-height: 20px; }</style></head>
<body><h1>Skill shortlist</h1><p>All candidates are unvetted. Installation requires a completed vetting review and explicit confirmation.</p>${cards}<p id="status"></p>
<script>
document.querySelectorAll("button").forEach(button => button.addEventListener("click", async () => {
  const status = document.getElementById("status"); status.textContent = "Sending request...";
  try {
    const response = await fetch("/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: button.dataset.action, index: Number(button.dataset.index) }) });
    if (!response.ok) throw new Error(await response.text());
    status.textContent = "Request sent to the agent.";
  } catch (error) { status.textContent = "Request failed: " + error.message; }
}));</script></body></html>`;
}

async function readJson(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
        if (Buffer.concat(chunks).length > 4096) throw new Error("Request is too large.");
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function createSkillShortlistCanvas(session) {
    return createCanvas({
        id: "skill-shortlist",
        displayName: "Skill shortlist",
        description: "Interactive shortlist with source, vetting, and installation-request controls.",
        inputSchema: {
            type: "object",
            properties: {
                candidates: { type: "array", minItems: 1, maxItems: 50 }
            },
            required: ["candidates"]
        },
        actions: ["details", "vet", "install"].map(action => ({
            name: `request_${action}`,
            description: `Request ${action === "vet" ? "security vetting" : action} for a shortlisted skill.`,
            inputSchema: {
                type: "object",
                properties: { candidate: { type: "object" } },
                required: ["candidate"]
            },
            handler: async ctx => requestAction(session, action, ctx.input.candidate)
        })),
        open: async ctx => {
            const candidates = validateCandidates(ctx.input);
            let entry = servers.get(ctx.instanceId);
            if (!entry) {
                entry = await startServer(session, candidates);
                servers.set(ctx.instanceId, entry);
            }
            return { title: "Skill shortlist", url: entry.url };
        },
        onClose: async ctx => {
            const entry = servers.get(ctx.instanceId);
            if (entry) {
                servers.delete(ctx.instanceId);
                await new Promise(resolve => entry.server.close(resolve));
            }
        }
    });
}

async function requestAction(session, action, candidate) {
    const safeCandidate = validateCandidates({ candidates: [candidate] })[0];
    const prompt = action === "details"
        ? `Provide source details for shortlisted skill '${safeCandidate.name}' from '${safeCandidate.source}'. Do not install it.`
        : action === "vet"
            ? `Security-vet shortlisted skill '${safeCandidate.name}' from '${safeCandidate.source}' using skill_explorer_vet. Report its exact revision, digest, risk score, findings, and verdict. Do not install it.`
            : `The user requested installation of shortlisted skill '${safeCandidate.name}' from '${safeCandidate.source}'. First run skill_explorer_vet, show the exact revision, digest, risk result, and scope, then request explicit confirmation before calling skill_explorer_install.`;
    await session.send({ prompt });
    return { candidate: safeCandidate.name, action, status: "request_sent" };
}

async function startServer(session, candidates) {
    const server = createServer(async (req, res) => {
        if (req.method === "GET" && req.url === "/") {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(renderHtml(candidates));
            return;
        }
        if (req.method === "POST" && req.url === "/action") {
            try {
                const body = await readJson(req);
                if (!["details", "vet", "install"].includes(body.action) || !Number.isInteger(body.index) || !candidates[body.index]) {
                    throw new Error("Invalid shortlist action.");
                }
                await requestAction(session, body.action, candidates[body.index]);
                res.writeHead(204).end();
            } catch (error) {
                res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end(error.message);
            }
            return;
        }
        res.writeHead(404).end();
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    return { server, url: `http://127.0.0.1:${port}/` };
}
