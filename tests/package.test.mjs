import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

test("the reproducible plugin contains executable assets, notices and corresponding application source", async () => {
    const script = fileURLToPath(new URL("../scripts/package-plugin.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const base = new URL("../dist/copilot-session-dj/", import.meta.url);
    const manifest = JSON.parse(await readFile(new URL("plugin.json", base), "utf8"));
    assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
    assert.equal(manifest.name, "copilot-session-dj");
    assert.equal(manifest.license, "AGPL-3.0-or-later");
    assert.ok(manifest.keywords.includes("canvas"));
    assert.equal(manifest.extensions["com.github.copilot"].logo, "assets/preview.png");
    const png = await readFile(new URL("assets/preview.png", base));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const extension = new URL("com.github.copilot/extensions/copilot-session-dj/", base);
    for (const path of ["extension.mjs", "server.mjs", "ui/app.mjs", "ui/audio-engine.mjs",
        "assets/strudel.bundle.mjs", "LICENSE", "THIRD-PARTY-NOTICES"]) {
        assert.ok((await stat(new URL(path, extension))).size > 0, path);
    }
    const version = JSON.parse(await readFile(new URL("assets/strudel-version.json", extension), "utf8"));
    const bundle = await readFile(new URL("assets/strudel.bundle.mjs", extension));
    assert.equal(version.sha256, createHash("sha256").update(bundle).digest("hex"));
    assert.match(await readFile(new URL("SOURCE.txt", base), "utf8"), /f610965f4332837febe45743105da170e8b331ed/);
    const lock = JSON.parse(await readFile(new URL("source/package-lock.json", base), "utf8"));
    assert.equal(lock.packages["node_modules/@strudel/web"].version, "1.3.0");
    assert.equal(lock.packages["node_modules/@github/copilot-sdk"], undefined);
    const sums = await readFile(new URL("SHA256SUMS", base), "utf8");
    for (const line of sums.trim().split("\n")) {
        const [hash, path] = line.split("  ");
        assert.equal(createHash("sha256").update(await readFile(new URL(path, base))).digest("hex"), hash, path);
    }
});
