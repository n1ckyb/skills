import { access, readFile } from "node:fs/promises";
import path from "node:path";

const pluginName = process.argv[2] || "skill-explorer";
const pluginDir = path.resolve("plugins", pluginName);
const manifestPath = path.join(pluginDir, "plugin.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (manifest.name !== pluginName) {
    throw new Error(`${manifestPath} name must match directory '${pluginName}'`);
}
if (!manifest.description || !manifest.version || !manifest.author?.name || !manifest.license) {
    throw new Error(`${manifestPath} must include description, version, author.name, and license`);
}
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error(`${manifestPath} version must use semantic versioning`);
}

const copilot = manifest.extensions?.["com.github.copilot"];
if (copilot?.logo !== "assets/preview.png") {
    throw new Error(`${manifestPath} must set com.github.copilot.logo to assets/preview.png`);
}

const awesome = manifest.extensions?.["com.github.awesome-copilot"];
if (!awesome?.skills?.length || !awesome?.extensions?.length) {
    throw new Error(`${manifestPath} must reference skills and extensions`);
}

for (const reference of [...awesome.skills, ...awesome.extensions]) {
    const sourcePath = path.resolve(reference.replace(/^\.\//, ""));
    await access(sourcePath);
}
await access(path.join(pluginDir, copilot.logo));

console.log(`Valid plugin: ${pluginName}`);
