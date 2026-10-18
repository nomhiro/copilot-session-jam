const LIMIT = 2048;
const ACCENT_MS = 4500;
const STALE_MS = 15 * 60 * 1000;
const TRACKED = new Set([
    "assistant.turn_start", "assistant.turn_end", "assistant.idle", "assistant.message_delta",
    "tool.execution_start", "tool.execution_complete", "subagent.started", "subagent.completed",
    "subagent.failed", "permission.requested", "permission.completed", "user_input.requested",
    "user_input.completed", "elicitation.requested", "elicitation.completed", "session.idle",
    "session.error", "session.task_complete", "session.compaction_start", "session.compaction_complete",
    "session.shutdown",
]);

function remember(map, key, value) {
    if (!key) return;
    map.set(key, value);
    if (map.size > LIMIT) map.delete(map.keys().next().value);
}

export function normalizeEvent(event) {
    if (!event || !TRACKED.has(event.type)) return null;
    const data = event.data ?? {};
    const agent = typeof event.agentId === "string" ? event.agentId : null;
    const type = event.type;
    const key = type.startsWith("subagent.")
        ? data.toolCallId
        : type.startsWith("tool.") ? data.toolCallId
            : type.startsWith("permission.") || type.startsWith("user_input.") || type.startsWith("elicitation.")
                ? data.requestId : data.turnId;
    return {
        type, id: typeof event.id === "string" ? event.id : null,
        key: typeof key === "string" ? key : null, agent,
        success: data.success === true ? true : data.success === false ? false : null,
    };
}

export function createSessionState({ now = Date.now } = {}) {
    const seen = new Map();
    const tools = new Map();
    const agents = new Map();
    const turns = new Map();
    const requests = new Map();
    const ended = new Map();
    const observed = new Set();
    let known = false;
    let revision = 0;
    let errorUntil = 0;
    let completeUntil = 0;
    let compacting = false;
    let stopped = false;
    let overflow = false;
    let lastReason = "observation-started";
    let pulses = [];
    const history = [];

    function addReason(reason) {
        if (reason === lastReason) return;
        lastReason = reason;
        history.unshift({ reason, at: now() });
        history.splice(12);
    }
    function pair(map, key, start) {
        if (!key) return;
        const tombstone = `${map === tools ? "tool" : map === agents ? "agent" : map === turns ? "turn" : "request"}:${key}`;
        if (start) {
            if (map.size >= LIMIT && !map.has(key)) overflow = true;
            if ((key === "main" || !ended.has(tombstone)) && map.size < LIMIT) map.set(key, now());
        } else {
            map.delete(key);
            remember(ended, tombstone, true);
        }
    }
    return {
        ingest(raw) {
            const event = normalizeEvent(raw);
            if (!event || (event.id && seen.has(event.id))) return false;
            remember(seen, event.id, true);
            observed.add(event.type);
            const { type, key, agent } = event;
            if (type === "tool.execution_start" || type === "assistant.message_delta") {
                pulses.push(now());
                pulses = pulses.slice(-120);
            }
            if (type === "tool.execution_start") pair(tools, key, true);
            if (type === "tool.execution_complete") pair(tools, key, false);
            if (type === "subagent.started") pair(agents, key, true);
            if (type === "subagent.completed" || type === "subagent.failed") pair(agents, key, false);
            if (!agent && type === "assistant.turn_start") {
                known = true;
                stopped = false;
                pair(turns, key ?? "main", true);
            }
            if (!agent && type === "assistant.turn_end") pair(turns, key ?? "main", false);
            if (!agent && type === "assistant.idle") turns.clear();
            if (key && type.endsWith(".requested")) pair(requests, `${type.split(".")[0]}:${key}`, true);
            if (type.endsWith(".completed") && ["permission", "user_input", "elicitation"].includes(type.split(".")[0])) {
                if (key) pair(requests, `${type.split(".")[0]}:${key}`, false);
            }
            if (type === "session.idle") {
                known = true;
                turns.clear();
            }
            if (type === "session.compaction_start") compacting = true;
            if (type === "session.compaction_complete") compacting = false;
            if (type === "session.error" || type === "subagent.failed" ||
                (type === "tool.execution_complete" && event.success === false)) {
                errorUntil = now() + ACCENT_MS;
            }
            if (type === "session.task_complete" && !agent && event.success === true) {
                completeUntil = now() + ACCENT_MS;
            }
            if (type === "session.shutdown") {
                stopped = true;
                turns.clear();
                tools.clear();
                agents.clear();
                requests.clear();
                compacting = false;
            }
            if (type !== "assistant.message_delta") addReason(type);
            revision++;
            return true;
        },
        snapshot() {
            const time = now();
            pulses = pulses.filter((t) => time - t < 8000);
            const stale = [tools, agents, requests, turns].some((map) => [...map.values()].some((t) => time - t > STALE_MS));
            return {
                revision, known, stopped, uncertain: !known || stale || overflow,
                mainActive: turns.size > 0, tools: tools.size, agents: agents.size,
                waiting: requests.size, compacting,
                error: time < errorUntil, completed: time < completeUntil,
                pulse: Math.min(1, pulses.length / 24),
                reason: lastReason, history: history.map((item) => ({ ...item })),
                observed: [...observed],
            };
        },
    };
}
