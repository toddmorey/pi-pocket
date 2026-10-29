/** Studio's existing Pi 1.3 runtime, with a read-only live watch for Pocket. No PocketApp or host coding tools. */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { studioTools } from "../../durable-workflows/packages/studio-core/src/tools.ts";
import {
    sharedModels,
    generateBackground,
} from "../../durable-workflows/packages/studio-core/src/inference.ts";

export const load = async (name) => {
    const parts = name.split("/");
    const packageName = parts.splice(0, name.startsWith("@") ? 2 : 1).join("/");
    const directory = resolve(
        import.meta.dirname,
        "../../durable-workflows/node_modules",
        packageName,
    );
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const key = parts.length ? "./" + parts.join("/") : ".";
    let entry = manifest.exports[key];

    if (!entry) {
        const pattern = Object.keys(manifest.exports).find(
            (candidate) => candidate.endsWith("*") && key.startsWith(candidate.slice(0, -1)),
        );

        if (!pattern) {
            throw new Error("Unsupported Studio package export: " + name);
        }

        const matched = manifest.exports[pattern];

        entry = {
            import: (typeof matched === "string" ? matched : matched.import).replace(
                "*",
                key.slice(pattern.length - 1),
            ),
        };
    }

    return import(
        pathToFileURL(join(directory, typeof entry === "string" ? entry : entry.import)).href
    );
};

const { Harness, createRegistry, GenerationTask, hook } = await load("@earendil-works/pi-durable");
const { openNodeSqliteStorage } = await load("@earendil-works/pi-durable/storage/sqlite/node");
const { BACKGROUND_CONTEXT: context } = await load("@earendil-works/chord/context");

export async function openAgent(service, directory, meter, options = {}) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const key = process.env.OPENROUTER_HUMANSIGNAL_KEY || process.env.OPENROUTER_API_KEY || "";
    const registry = createRegistry();
    // Canonical guidance is readable, but cannot be rewritten by project requests.
    const scopedService = new Proxy(service, {
        get(target, name) {
            if (name === "write") {
                return async (path, ...args) => {
                    if (
                        path.startsWith(".design-system/") ||
                        ["AGENTS.md", "PROJECT-GUIDANCE.md"].includes(path)
                    ) {
                        throw new Error(
                            "Shared guidance is read-only. Propose a design-system change for the owner instead.",
                        );
                    }

                    return target.write(path, ...args);
                };
            }

            const value = Reflect.get(target, name);

            return typeof value === "function" ? value.bind(target) : value;
        },
    });

    registry.install(
        studioTools(scopedService, (prompt, path, signal) =>
            generateBackground(
                scopedService,
                key,
                process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-3.1-flash-image",
                meter,
                prompt,
                path,
                signal,
            ),
        ),
    );
    registry.install({
        name: "inference-allowance",
        hooks: [
            hook(GenerationTask, {
                beforeRequest: async () => {
                    await meter.reserve("model");

                    return undefined;
                },
                afterResponse: async (message) => {
                    await meter.record({
                        kind: "model",
                        model: message.model,
                        usage: message.usage,
                    });
                },
            }),
        ],
    });
    const storage = await openNodeSqliteStorage(join(directory, "pi.sqlite"));
    const harness = await Harness.open(
        storage,
        {
            models: options.models || sharedModels(key),
            registry,
            settings: {
                toolExecution: "sequential",
                retry: { enabled: false, maxRetries: 0, baseDelayMs: 1000 },
            },
        },
        context,
    );
    const root = await harness.root(context);

    await root.configure(
        {
            model: {
                provider: options.provider || "openrouter",
                modelId:
                    options.model || process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.6",
            },
        },
        context,
    );
    harness.resume();

    return {
        submit: async (text, operationId, actor) => {
            const result = await root.submit(
                {
                    type: "input",
                    content: text,
                    requestId: operationId,
                    whenBusy: "followUp",
                    entry: { kind: "studio.message", data: { actor: actor.id, name: actor.name } },
                },
                context,
            );

            return { operationId, submissionId: result.id };
        },
        messages: async () => (await root.context(context)).entries,
        pending: async () =>
            (await harness.inspect(context)).submissions.map((s) => ({
                id: s.id,
                operationId: s.requestId,
                status: s.status === "queued" ? "queued" : "running",
            })),
        status: async (operationId) => {
            const s = await storage.submissionByRequest(root.id, operationId, context);

            return { status: s?.status || "unknown", reason: s?.reason };
        },
        abort: async () => {
            await root.abort(context);

            return { stopped: true };
        },
        observe: async (listener) => {
            const watch = await root.watch(context);

            listener(watch.value);
            watch.start(async (value) => {
                listener(value);
            });

            return () => watch.stop();
        },
        idle: () => root.waitForIdle(context),
        close: () => harness.close(context),
    };
}
