import { cp, mkdir, mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join, delimiter } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = join(root, ".artifacts");
await mkdir(artifacts, { recursive: true });
const temporary = await mkdtemp(join(artifacts, "install-smoke-"));
const home = join(temporary, "home");
const marketplace = join(temporary, "marketplace");
const manifest = JSON.parse(await readFile(join(root, "dist", "copilot-session-dj", "plugin.json"), "utf8"));
const env = { ...process.env, COPILOT_HOME: join(home, ".copilot"),
    HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_DATA_HOME: join(home, ".local", "share") };
function resolveCli() {
    if (process.platform !== "win32") return { command: "copilot", prefix: [] };
    for (const folder of (process.env.PATH ?? "").split(delimiter)) {
        const executable = join(folder, "copilot.exe");
        if (existsSync(executable)) return { command: executable, prefix: [] };
        const loader = join(folder, "node_modules", "@github", "copilot", "npm-loader.js");
        if (existsSync(loader)) return { command: process.execPath, prefix: [loader] };
    }
    throw new Error("Copilot CLI not found on PATH.");
}
let cli;
function run(args) {
    const result = spawnSync(cli.command, [...cli.prefix, ...args], { env, encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
    if (result.error || result.status !== 0) throw new Error(`copilot ${args.join(" ")} failed:\n${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`);
    process.stdout.write(result.stdout);
}
async function inspectInstall(folder) {
    let entry = false;
    let registration = false;
    for (const item of await readdir(folder, { withFileTypes: true })) {
        const path = join(folder, item.name);
        if (item.isDirectory()) {
            const nested = await inspectInstall(path);
            entry ||= nested.entry;
            registration ||= nested.registration;
        }
        else if (item.name === "extension.mjs") {
            const code = await readFile(path, "utf8");
            entry ||= code.includes('id: "copilot-session-dj"');
        } else if (item.name.endsWith(".json")) {
            registration ||= (await readFile(path, "utf8")).includes("session-dj-smoke");
        }
    }
    return { entry, registration };
}
try {
    cli = resolveCli();
    await mkdir(home, { recursive: true });
    await mkdir(marketplace, { recursive: true });
    await cp(join(root, "dist", "copilot-session-dj"), join(marketplace, "plugin"), { recursive: true });
    await writeFile(join(marketplace, "marketplace.json"), JSON.stringify({
        name: "session-dj-smoke", owner: { name: "Local smoke test" },
        plugins: [{ name: manifest.name, source: "./plugin", version: manifest.version }],
    }, null, 2));
    run(["plugin", "marketplace", "add", marketplace]);
    run(["plugin", "install", "copilot-session-dj@session-dj-smoke"]);
    if (!(await inspectInstall(home)).registration) throw new Error("No marketplace registration was written to the isolated configuration.");
    if (!(await inspectInstall(join(marketplace, "plugin", "com.github.copilot", "extensions"))).entry) throw new Error("The locally installed plugin has no DJ extension.");
    process.stdout.write("Clean local-marketplace install verified. Normal user configuration was not used.\n");
} finally {
    await rm(temporary, { recursive: true, force: true });
}
