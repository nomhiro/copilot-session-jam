import { cp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = new URL("../node_modules/@strudel/web/dist/", import.meta.url);
const target = new URL("../.github/extensions/copilot-session-dj/assets/", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("../node_modules/@strudel/web/package.json", import.meta.url), "utf8"));
if (metadata.version !== "1.3.0") throw new Error("Expected the audited @strudel/web 1.3.0 bundle. Run npm ci.");
await mkdir(target, { recursive: true });
await cp(new URL("index.mjs", source), new URL("strudel.bundle.mjs", target));
await cp(new URL("assets/", source), new URL("assets/", target), { recursive: true });
await writeFile(new URL("strudel-version.json", target), `${JSON.stringify({ name: metadata.name, version: metadata.version, license: metadata.license }, null, 2)}\n`);
await cp(new URL("../LICENSE", import.meta.url), new URL("../LICENSE", target));
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
const notices = [
    "Copilot Session DJ - third-party notices",
    "Strudel and its contributors retain their copyrights. The browser bundle is copied without modification.",
    "Strudel 1.3.0 source commit: f610965f4332837febe45743105da170e8b331ed",
    "Preferred source, build scripts and upstream lockfile:",
    "https://codeberg.org/uzu/strudel/src/commit/f610965f4332837febe45743105da170e8b331ed",
    "Source archive: https://codeberg.org/uzu/strudel/archive/f610965f4332837febe45743105da170e8b331ed.tar.gz",
    "Please respect the upstream request not to fork the entire Strudel project back to GitHub.",
    "This app uses the npm distribution, not a fork of Strudel.",
    "No sample packs, recordings or soundfonts are included.",
    "",
];
for (const [path, pkg] of Object.entries(lock.packages)) {
    if (!path.startsWith("node_modules/")) continue;
    const folder = new URL(`../${path}/`, import.meta.url);
    const json = JSON.parse(await readFile(new URL("package.json", folder), "utf8"));
    notices.push(`=== ${json.name}@${pkg.version} | ${pkg.license ?? json.license ?? "See package license"} ===`);
    notices.push(`Package source: ${pkg.resolved}`);
    const files = (await readdir(folder)).filter((name) => /^(licen[cs]e|copying|notice)([.-]|$)/i.test(name));
    for (const name of files) {
        notices.push(`--- ${name} ---`);
        notices.push(await readFile(new URL(name, folder), "utf8"));
    }
    notices.push("");
}
await writeFile(new URL("../THIRD-PARTY-NOTICES", target), `${notices.join("\n")}\n`);
const bundle = await readFile(new URL("strudel.bundle.mjs", target));
await writeFile(new URL("strudel-version.json", target), `${JSON.stringify({
    name: metadata.name, version: metadata.version, license: metadata.license,
    sha256: createHash("sha256").update(bundle).digest("hex"),
    sourceCommit: "f610965f4332837febe45743105da170e8b331ed",
}, null, 2)}\n`);
process.stdout.write(`Built local Strudel ${metadata.version} assets in ${root}\n`);
