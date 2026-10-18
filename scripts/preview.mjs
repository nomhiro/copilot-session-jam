import { createSessionState } from "../.github/extensions/copilot-session-dj/session-state.mjs";
import { createHub, startCanvasServer } from "../.github/extensions/copilot-session-dj/server.mjs";

const hub = await createHub({ state: createSessionState(), onError: (message) => process.stderr.write(`${message}\n`) });
const server = await startCanvasServer({ hub, onError: (message) => process.stderr.write(`${message}\n`) });
const timer = setInterval(() => hub.publish(), 500);
process.stdout.write(`DJ preview (no live session, preferences not saved): ${server.url}\n`);
async function close() { clearInterval(timer); await server.close(); }
process.once("SIGINT", close);
process.once("SIGTERM", close);
