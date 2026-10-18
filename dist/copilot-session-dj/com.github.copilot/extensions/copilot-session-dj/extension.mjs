import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";
import { createSessionState } from "./session-state.mjs";
import { createHub, startCanvasServer } from "./server.mjs";

const state = createSessionState();
const servers = new Map();
const settingsSchema = {
    type: "object", additionalProperties: false,
    properties: {
        preset: { type: "string", enum: ["lofi", "synthwave", "chiptune"] },
        volume: { type: "number", minimum: 0, maximum: 1 },
        mischief: { type: "number", minimum: 0, maximum: 1 },
    },
};
let hub;
let markHubReady;
const hubReady = new Promise((resolve) => { markHubReady = resolve; });
function requireOpen(ctx) {
    if (!servers.has(ctx.instanceId)) throw new CanvasError("dj_not_open", "Open the DJ booth first.");
    return hub;
}
const session = await joinSession({
    canvases: [createCanvas({
        id: "copilot-session-dj",
        displayName: "Copilot Session DJ",
        description: "A playful, local Strudel soundtrack for this session and its subagents; audio starts only with a click.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        actions: [
            { name: "get_state", description: "Get privacy-preserving activity counts, observed event types and DJ settings.", handler: (ctx) => requireOpen(ctx).snapshot() },
            { name: "set_mix", description: "Set volume or mischief (0..1) and preset; never starts audio.", inputSchema: settingsSchema,
                handler: async (ctx) => requireOpen(ctx).configure(ctx.input) },
            { name: "select_preset", description: "Choose lofi, synthwave or chiptune without starting audio.",
                inputSchema: { ...settingsSchema, required: ["preset"], properties: { preset: settingsSchema.properties.preset } },
                handler: async (ctx) => requireOpen(ctx).configure(ctx.input) },
            { name: "stop", description: "Silence all DJ booths in this session.", inputSchema: { type: "object", properties: {}, additionalProperties: false },
                handler: (ctx) => requireOpen(ctx).stop() },
        ],
        open: async (ctx) => {
            await hubReady;
            if (!servers.has(ctx.instanceId)) servers.set(ctx.instanceId, startCanvasServer({ hub, onError: logError }));
            const pending = servers.get(ctx.instanceId);
            try {
                const entry = await pending;
                return { title: "Copilot Session DJ", url: entry.url, status: "Silent until you click Start" };
            } catch (error) {
                if (servers.get(ctx.instanceId) === pending) servers.delete(ctx.instanceId);
                throw error;
            }
        },
        onClose: async (ctx) => {
            const entry = servers.get(ctx.instanceId);
            servers.delete(ctx.instanceId);
            if (entry) await (await entry).close();
        },
    })],
});
function logError(message) { session.log(message, { level: "error" }); }
hub = await createHub({ state, workspacePath: session.workspacePath, onError: logError });
markHubReady();
const unsubscribe = session.on((event) => {
    if (state.ingest(event) && event.type === "session.shutdown") hub.stop();
});
const ticker = setInterval(() => hub.publish(), 500);
ticker.unref();
let closing = false;
async function cleanup() {
    if (closing) return;
    closing = true;
    clearInterval(ticker);
    unsubscribe();
    hub.stop();
    await Promise.all([...servers.values()].map(async (entry) => (await entry).close()));
    servers.clear();
}
process.once("SIGTERM", () => cleanup().catch((error) => logError(error.message)));
process.once("SIGINT", () => cleanup().catch((error) => logError(error.message)));
