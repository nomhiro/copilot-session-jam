import { cp, mkdir, readFile, writeFile, readdir, stat, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const metadata = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const source = join(root, ".github", "extensions", "copilot-session-dj");
const destination = join(root, "dist", "copilot-session-dj");
const extension = join(destination, "com.github.copilot", "extensions", "copilot-session-dj");
const preview = join(source, "assets", "preview.png");
await stat(join(source, "assets", "strudel.bundle.mjs"));
await stat(preview);
await rm(destination, { recursive: true, force: true });
await mkdir(extension, { recursive: true });
await cp(source, extension, { recursive: true });
await mkdir(join(destination, "assets"), { recursive: true });
await cp(preview, join(destination, "assets", "preview.png"));
await cp(join(root, "LICENSE"), join(destination, "LICENSE"));
await cp(join(root, "README.md"), join(destination, "README.md"));
await cp(join(source, "THIRD-PARTY-NOTICES"), join(destination, "THIRD-PARTY-NOTICES"));
const manifest = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "copilot-session-dj", version: metadata.version,
    description: "A local, playful Strudel soundtrack for Copilot sessions and subagents. Silent until you click.",
    author: { name: "nomhiro", url: "https://github.com/nomhiro" },
    repository: "https://github.com/nomhiro/copilot-session-jam",
    homepage: "https://github.com/nomhiro/copilot-session-jam",
    license: "AGPL-3.0-or-later",
    keywords: ["canvas", "strudel", "music", "session", "subagents", "local-audio"],
    extensions: { "com.github.copilot": { logo: "assets/preview.png" } },
};
await writeFile(join(destination, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
const corresponding = join(destination, "source");
await mkdir(corresponding, { recursive: true });
for (const path of ["package.json", "package-lock.json", "scripts", "tests", "README.md", "LICENSE"]) {
    await cp(join(root, path), join(corresponding, path), { recursive: true });
}
await cp(source, join(corresponding, ".github", "extensions", "copilot-session-dj"), { recursive: true });
await writeFile(join(destination, "SOURCE.txt"), [
    "The source/ directory contains this application, its tests, pinned dependencies and build scripts.",
    "From source/: npm ci --ignore-scripts && npm run build && npm test",
    "The Strudel browser bundle is an unmodified npm distribution.",
    "Its preferred source, build configuration and lockfile are available at the immutable upstream commit:",
    "https://codeberg.org/uzu/strudel/src/commit/f610965f4332837febe45743105da170e8b331ed",
    "https://codeberg.org/uzu/strudel/archive/f610965f4332837febe45743105da170e8b331ed.tar.gz",
    "See THIRD-PARTY-NOTICES for per-dependency source locations and licenses.",
    "A publisher must keep equivalent access to all corresponding source available with each release.",
    "Do not submit an unbuilt checkout to a marketplace: the plugin requires the generated local bundle.",
    "",
].join("\n"));
const hashes = [];
async function walk(folder) {
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.name !== "SHA256SUMS") hashes.push(`${createHash("sha256").update(await readFile(path)).digest("hex")}  ${relative(destination, path).replaceAll("\\", "/")}`);
    }
}
await walk(destination);
await writeFile(join(destination, "SHA256SUMS"), `${hashes.join("\n")}\n`);
process.stdout.write(`Prepared ${destination} (${hashes.length} files). Not published or submitted.\n`);
