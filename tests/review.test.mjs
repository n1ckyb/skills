import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewSkill } from "../extension/lib/review.mjs";
import { vetFilesMap } from "../extension/lib/vetting.mjs";
import { DEFAULT_CONFIG } from "../extension/lib/config.mjs";

test("reviewSkill generates structured review with sourceRevision, contentDigest, ratings, and verdict", () => {
    const filesMap = {
        "SKILL.md": "---\nname: my-skill\ndescription: A useful skill for coding\n---\n# My Skill\n\n## Usage\nRun the command.\n\n## Safety\nDo not share keys.\n"
    };

    const vetResult = vetFilesMap(filesMap, "owner/repo", DEFAULT_CONFIG);
    const source = {
        provenance: "canonical",
        vetScope: "github/awesome-copilot/skills/my-skill/",
        sourceRevision: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
        contentDigest: "sha256:1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"
    };

    const rev = reviewSkill(filesMap, vetResult, source);

    assert.equal(rev.title, "my-skill");
    assert.equal(rev.sourceRevision, source.sourceRevision);
    assert.equal(rev.contentDigest, source.contentDigest);
    assert.equal(rev.whatItDoes, "A useful skill for coding");
    assert.ok(rev.ratings.overall);
    assert.ok(rev.ratings.utility);
    assert.ok(rev.ratings.clarity);
    assert.ok(rev.ratings.safety);
    assert.ok(rev.ratings.provenance);
    assert.match(rev.ratings.methodology, /Overall = utility 30% \+ clarity 25% \+ safety 35% \+ provenance 10%/);
});
