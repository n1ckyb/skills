import { readFile } from "node:fs/promises";
import path from "node:path";

const skillName = process.argv[2] || "skill-explorer";
const skillDir = path.resolve("skills", skillName);
const skillFile = path.join(skillDir, "SKILL.md");
const content = await readFile(skillFile, "utf8");
const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);

if (!frontmatter) {
    throw new Error(`${skillFile} must begin with YAML frontmatter`);
}

const fields = new Map();
for (const line of frontmatter[1].split(/\r?\n/)) {
    const match = line.match(/^([a-z][a-z-]*):\s*(.+)$/);
    if (match) fields.set(match[1], match[2].trim().replace(/^['"]|['"]$/g, ""));
}

if (fields.get("name") !== skillName) {
    throw new Error(`${skillFile} name must match directory '${skillName}'`);
}
if (!fields.get("description")) {
    throw new Error(`${skillFile} description must be non-empty`);
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName)) {
    throw new Error(`Skill directory '${skillName}' must be lowercase hyphenated`);
}

console.log(`Valid skill: ${skillName}`);
