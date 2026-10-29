/** Translate a read-only Studio conversation watch into Pocket's existing transcript contract. */
import { projectEntry, projectLive, projectStats } from "../src/server/projection.ts";

export function projectView(value, actor) {
    const authors = {};
    const people = new Map([
        [actor.id, { id: actor.id, name: actor.name, role: actor.owner ? "owner" : "guest" }],
    ]);
    const entries = value.entries.flatMap((entry) => {
        const role = entry.model?.[0]?.role;

        if (entry.data?.actor) {
            authors[entry.id] = entry.data.actor;
            people.set(entry.data.actor, {
                id: entry.data.actor,
                name: entry.data.name,
                role: "guest",
            });
        }

        const kind =
            role === "user"
                ? "pi.user"
                : role === "assistant"
                  ? "pi.assistant"
                  : role === "toolResult"
                    ? "pi.tool-result"
                    : entry.kind;
        const projected = projectEntry({ ...entry, kind }, true);

        return projected ? [projected] : [];
    });
    const docs = value.docs;

    return {
        entries,
        authors,
        users: [...people.values()],
        inbox: (docs["pi.inbox"]?.items || [])
            .filter((item) => item.mode !== "write")
            .map((item) => ({
                id: item.id,
                mode: item.mode,
                text:
                    typeof item.content === "string" ? item.content : JSON.stringify(item.content),
            })),
        conversation: { id: 1, title: "HumanSignal website", kind: "session" },
        agent: { ...docs["pi.agent"], cwd: "HumanSignal", available: true },
        live: projectLive(docs["pi.live"]),
        stats: projectStats(docs["pi.usage"], value.entries),
    };
}
