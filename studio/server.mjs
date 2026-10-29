import { openAgent as localAgent } from "./runtime.mjs";
import { projectView } from "./projection.mjs";
import { servePocket } from "./static.mjs";
import { reviewHtml } from "../../durable-workflows/packages/studio-core/src/review.ts";
import { createServer } from "node:http";
import { createServer as createLock } from "node:net";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { loadEnvFile } from "node:process";
import {
    ProjectService,
    contentType,
    exclusive,
    hash,
    encoder,
    projectById,
    projects,
} from "../../durable-workflows/packages/studio-core/src/index.ts";
import { projectApi } from "../../durable-workflows/packages/studio-core/src/api.ts";
import { createMeter } from "../../durable-workflows/packages/studio-core/src/meter.ts";
import {
    localExecution,
    LocalObjects,
    LocalValues,
} from "../../durable-workflows/tools/mvp-local-providers.ts";

try {
    loadEnvFile(resolve(import.meta.dirname, "../../durable-workflows/.env"));
} catch (error) {
    if (error.code !== "ENOENT") {
        throw error;
    }
}

const root = resolve(import.meta.dirname, "../../durable-workflows");
const editorAssets = join(root, "editor/dist/projects");

// Fail early if the shared editor has not been built.
await readFile(join(editorAssets, "index.html"));
const directory = resolve(
    process.env.STUDIO_MVP_DATA_DIR ?? resolve(import.meta.dirname, "../.data/studio/local"),
);
const port = Number(process.env.STUDIO_MVP_PORT ?? 8790),
    previewPort = port + 1;
const origin = `http://127.0.0.1:${port}`,
    previewOrigin = `http://127.0.0.1:${previewPort}`;

await mkdir(directory, { recursive: true, mode: 0o700 });
const lock = createLock((socket) => socket.destroy());

await new Promise((resolveLock, reject) => {
    lock.once("error", reject);
    void hash(encoder.encode(directory)).then((key) =>
        lock.listen({ path: "\0studio-mvp-" + key }, resolveLock),
    );
});
lock.unref();
const values = new LocalValues(join(directory, "studio.sqlite")),
    objects = new LocalObjects(join(directory, "objects"));
const execution = await localExecution(join(directory, "build"));
const users = {
    todd: { id: "todd", name: "Todd (development)", owner: true },
    michael: { id: "michael", name: "Michael (development)", owner: false },
};
const runtimes = new Map();

async function openProject(id) {
    if (id !== "humansignal") {
        throw new Error("Only HumanSignal is enabled in this prototype.");
    }

    const project = projectById(id),
        store = values.scope(`${id}:`),
        commands = exclusive();
    const service = new ProjectService(
        project,
        { get: () => store.get("project"), put: (state) => store.put("project", state) },
        objects,
        execution,
    );

    if (!(await store.get("project"))) {
        await service.initialize(
            JSON.parse(await readFile(join(root, ".data/mvp/seeds", `${id}.json`), "utf8")),
        );
    }

    const meter = createMeter(store),
        agent = await localAgent(service, join(directory, id), meter);

    return { service, meter, agent, commands };
}

function runtime(id) {
    if (!runtimes.has(id)) {
        runtimes.set(
            id,
            openProject(id).catch((error) => {
                runtimes.delete(id);

                throw error;
            }),
        );
    }

    return runtimes.get(id);
}

async function handle(req, res, previewOnly) {
    try {
        const url = new URL(req.url ?? "/", previewOnly ? previewOrigin : origin);

        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");

        if (req.headers.host !== new URL(previewOnly ? previewOrigin : origin).host) {
            res.writeHead(403).end("Unknown host");

            return;
        }

        if (req.method === "POST" && req.headers.origin !== origin) {
            res.writeHead(403).end("Origin is not allowed");

            return;
        }

        if (!previewOnly && url.pathname === "/dev-login" && req.method === "GET") {
            const editorHtml = await readFile(join(editorAssets, "index.html"), "utf8");
            const editorStyles =
                editorHtml.match(/<link[^>]+rel="stylesheet"[^>]*>/g)?.join("") ?? "";

            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.end(
                "<!doctype html><html><head><title>Development sign-in</title>" +
                    editorStyles +
                    '</head><body><main class="studio-login"><h1>Development sign-in</h1><p>Local test identities only. Hosted sign-in uses Cloudflare Access.</p><form method="post" action="/dev-login/todd"><button>Todd · owner</button></form><br><form method="post" action="/dev-login/michael"><button>Michael · teammate</button></form></main></body></html>',
            );

            return;
        }

        if (!previewOnly && url.pathname.startsWith("/dev-login/") && req.method === "POST") {
            const id = url.pathname.split("/").at(-1);

            if (!users[id]) {
                res.writeHead(400).end();

                return;
            }

            res.setHeader(
                "Set-Cookie",
                `pocket_studio_dev=${id}; HttpOnly; SameSite=Strict; Path=/`,
            );
            res.writeHead(303, { Location: "/" }).end();

            return;
        }

        const userId = req.headers.cookie?.match(/(?:^|;\s*)pocket_studio_dev=([a-z]+)/)?.[1];
        const actor = users[userId ?? ""];

        if (!actor && !/^\/assets\/[a-zA-Z0-9_.-]+\.css$/.test(url.pathname)) {
            if (!previewOnly && url.pathname === "/") {
                res.writeHead(303, { Location: "/dev-login" }).end();
            } else {
                res.writeHead(401, { "Content-Type": "application/json" }).end(
                    JSON.stringify({ error: "Development sign-in required." }),
                );
            }

            return;
        }

        const preview = url.pathname.match(/^\/preview\/([a-z0-9-]+)\/([a-f0-9]{64})\/(.*)$/);

        if (previewOnly) {
            if (url.pathname === "/_studio/bridge.js" && req.method === "GET") {
                res.setHeader("Content-Type", "text/javascript; charset=utf-8");
                res.end(await readFile(join(root, "packages/bridge/dist/standalone.js")));

                return;
            }

            if (!preview || req.method !== "GET") {
                res.writeHead(404).end();

                return;
            }

            const { service } = await runtime(preview[1]);
            let path = decodeURIComponent(preview[3]) || "index.html";

            if (path.endsWith("/")) {
                path += "index.html";
            }

            let artifact = await service.artifact(preview[2], path);

            if (!artifact && !path.includes(".")) {
                artifact = await service.artifact(preview[2], path + "/index.html");
            }

            if (!artifact) {
                res.writeHead(404).end();

                return;
            }

            res.setHeader(
                "Content-Security-Policy",
                `default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-ancestors ${origin}; sandbox allow-scripts allow-same-origin`,
            );
            res.setHeader("Content-Type", artifact.contentType);
            res.end(
                artifact.contentType.startsWith("text/html") &&
                    url.searchParams.get("studioReview") === "1"
                    ? reviewHtml(new TextDecoder().decode(artifact.bytes), origin, {
                          projectId: preview[1],
                          releaseId: preview[2],
                          pagePath: path,
                      })
                    : artifact.bytes,
            );

            return;
        }

        if (preview) {
            res.writeHead(403).end("Use the separate preview origin.");

            return;
        }

        const json = (data) => {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(data));
        };

        if (req.method === "GET" && url.pathname === "/api/session") {
            json({ actor, environment: "local" });

            return;
        }

        if (req.method === "GET" && url.pathname === "/api/projects") {
            json({ projects: projects.filter((project) => project.id === "humansignal") });

            return;
        }

        if (!previewOnly && url.pathname === "/api/studio/events" && req.method === "GET") {
            const { agent } = await runtime("humansignal");

            res.writeHead(200, {
                "Content-Type": "text/event-stream",
                Connection: "keep-alive",
                "X-Accel-Buffering": "no",
            });
            const push = (value) =>
                res.write("data: " + JSON.stringify(projectView(value, actor)) + "\n\n");
            const dispose = await agent.observe(push);
            const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);

            res.on("close", () => {
                clearInterval(heartbeat);
                void dispose();
            });

            if (res.destroyed) {
                clearInterval(heartbeat);
                await dispose();
            }

            return;
        }

        if (!previewOnly && url.pathname.startsWith("/api/c/1/")) {
            const operation = url.pathname.slice("/api/c/1/".length);
            const { agent, service } = await runtime("humansignal");
            const image = operation.match(/^image\/(\d+)\/(\d+)$/);

            if (req.method === "GET" && image) {
                const entry = (await agent.messages()).find((e) => String(e.id) === image[1]);
                const images = (entry?.model || []).flatMap((m) =>
                    Array.isArray(m.content) ? m.content.filter((p) => p.type === "image") : [],
                );
                const part = images[Number(image[2])];

                if (!part || !["image/png", "image/jpeg", "image/webp"].includes(part.mimeType)) {
                    res.writeHead(404).end();

                    return;
                }

                res.setHeader("Content-Type", part.mimeType);
                res.end(Buffer.from(part.data, "base64"));

                return;
            }

            if (req.method === "GET" && operation === "files") {
                json({
                    files: (await service.snapshot()).source.files.map((f) => ({ path: f.path })),
                });

                return;
            }

            if (req.method === "POST" && operation === "typing") {
                json({ ok: true });

                return;
            }

            if (req.method === "POST" && operation === "abort") {
                json(await agent.abort());

                return;
            }

            if (req.method === "POST" && operation === "submit") {
                const chunks = [];
                let size = 0;

                for await (const chunk of req) {
                    size += chunk.length;

                    if (size > 20000) {
                        res.writeHead(413).end();

                        return;
                    }

                    chunks.push(chunk);
                }

                const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));

                if (
                    body.attachments?.length ||
                    body.inlineFiles ||
                    !["followUp", undefined].includes(body.mode)
                ) {
                    res.writeHead(400).end(
                        JSON.stringify({ error: "Only queued text requests are supported." }),
                    );

                    return;
                }

                const request = new Request(origin + "/api/projects/humansignal/messages", {
                    method: "POST",
                    body: JSON.stringify({ text: body.text, operationId: body.requestId }),
                });
                const response = await projectApi(
                    request,
                    service,
                    agent,
                    actor,
                    () => ({}),
                    !!(process.env.OPENROUTER_HUMANSIGNAL_KEY || process.env.OPENROUTER_API_KEY),
                    previewOrigin,
                );

                res.writeHead(response.status, Object.fromEntries(response.headers));
                res.end(Buffer.from(await response.arrayBuffer()));

                return;
            }

            res.writeHead(403).end(
                JSON.stringify({
                    error: "This capability is not enabled in the studio prototype.",
                }),
            );

            return;
        }

        if (!previewOnly && url.pathname === "/api/theme") {
            json({ theme: null });

            return;
        }

        const match = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)(?:\/.*)?$/);

        if (match) {
            if (match[1] !== "humansignal") {
                res.writeHead(404).end(JSON.stringify({ error: "Project is not enabled." }));

                return;
            }

            const { service, agent, meter, commands } = await runtime(match[1]);
            const chunks = [];
            let size = 0;

            for await (const chunk of req) {
                size += chunk.length;

                if (size > 256000) {
                    throw new Error("Request too large.");
                }

                chunks.push(chunk);
            }

            const request = new Request(url, {
                method: req.method,
                headers: { "Content-Type": "application/json" },
                ...(req.method !== "GET" ? { body: Buffer.concat(chunks).toString("utf8") } : {}),
            });
            const configured = !!(
                process.env.OPENROUTER_API_KEY ||
                process.env[
                    match[1] === "humansignal"
                        ? "OPENROUTER_HUMANSIGNAL_KEY"
                        : "OPENROUTER_LINKEDIN_AD_KEY"
                ]
            );
            const invoke = () =>
                projectApi(
                    request,
                    service,
                    agent,
                    actor,
                    () => meter.snapshot(),
                    configured,
                    previewOrigin,
                );
            const response = req.method === "POST" ? await commands(invoke) : await invoke();

            res.writeHead(response.status, Object.fromEntries(response.headers));
            res.end(Buffer.from(await response.arrayBuffer()));

            return;
        }

        if (url.pathname.startsWith("/api/")) {
            res.writeHead(403).end(
                JSON.stringify({
                    error: "This capability is not enabled in the studio prototype.",
                }),
            );

            return;
        }

        if (req.method !== "GET") {
            res.writeHead(404).end();

            return;
        }

        if (await servePocket(req, res, url, actor, editorAssets)) {
            return;
        }

        if (url.pathname === "/studio-config.js") {
            res.setHeader("Content-Type", "text/javascript; charset=utf-8");
            res.end('window.__STUDIO_CONFIG__ = {surface:"projects"};');

            return;
        }

        const path =
            url.pathname === "/"
                ? "index.html"
                : /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname)
                  ? url.pathname.slice(1)
                  : undefined;

        if (!path) {
            res.writeHead(404).end();

            return;
        }

        res.setHeader("Content-Type", contentType(path));
        res.setHeader(
            "Content-Security-Policy",
            `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: ${previewOrigin}; connect-src 'self'; frame-src ${previewOrigin}; frame-ancestors 'none'`,
        );

        try {
            res.end(await readFile(join(editorAssets, path)));
        } catch (error) {
            if (error.code !== "ENOENT") {
                throw error;
            }

            res.writeHead(404).end();
        }
    } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" }).end(
            JSON.stringify({ error: error instanceof Error ? error.message : "Request failed." }),
        );
    }
}

const server = createServer((req, res) => {
    void handle(req, res, false);
});
const preview = createServer((req, res) => {
    void handle(req, res, true);
});

await Promise.all([
    new Promise((resolveListen) => server.listen(port, "127.0.0.1", resolveListen)),
    new Promise((resolveListen) => preview.listen(previewPort, "127.0.0.1", resolveListen)),
]);
console.log(
    `Pocket Studio prototype: ${origin}\nStatic artifact preview: ${previewOrigin}\nLocal test identities only. Existing pilot is unchanged.`,
);
let closing = false;

async function close() {
    if (closing) {
        return;
    }

    closing = true;
    server.close();
    server.closeAllConnections();
    preview.close();
    preview.closeAllConnections();

    for (const p of runtimes.values()) {
        await (await p).agent.close();
    }

    values.close();
    lock.close();
}

process.on("SIGTERM", () => {
    void close();
});
process.on("SIGINT", () => {
    void close();
});
