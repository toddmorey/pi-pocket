import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the isolated HTTP adapter authenticates both origins and rejects platform, shell, other-project and forged-actor operations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pocket-http-"));
    const port = 19000 + Math.floor(Math.random() * 10000) * 2;
    const base = "http://127.0.0.1:" + port;
    const child = spawn(
        resolve("../durable-workflows/node_modules/.bin/tsx"),
        ["studio/server.mjs"],
        {
            env: { ...process.env, STUDIO_MVP_PORT: String(port), STUDIO_MVP_DATA_DIR: directory },
            stdio: ["ignore", "pipe", "pipe"],
        },
    );

    try {
        await new Promise((ready, reject) => {
            const timer = setTimeout(() => reject(new Error("Prototype did not start.")), 15000);

            child.stdout.on("data", (chunk) => {
                if (String(chunk).includes("Pocket Studio prototype:")) {
                    clearTimeout(timer);
                    ready();
                }
            });
            child.once("exit", (code) => {
                clearTimeout(timer);
                reject(new Error("Server exited: " + code));
            });
        });
        const member = { Cookie: "pocket_studio_dev=michael" };
        const post = (path, body = {}, headers = {}) =>
            fetch(base + path, {
                method: "POST",
                headers: {
                    ...member,
                    Origin: base,
                    "Content-Type": "application/json",
                    ...headers,
                },
                body: JSON.stringify(body),
            });

        assert.equal((await fetch(base + "/api/session")).status, 401);
        assert.equal(
            (await fetch("http://127.0.0.1:" + (port + 1) + "/_studio/bridge.js")).status,
            401,
        );
        const session = await (
            await fetch(base + "/api/session", {
                headers: {
                    ...member,
                    "X-Studio-Actor": JSON.stringify({ id: "todd", owner: true }),
                },
            })
        ).json();

        assert.equal(session.actor.id, "michael");
        assert.equal(session.actor.owner, false);

        for (const path of [
            "/api/c/1/shell",
            "/api/c/1/instructions",
            "/api/settings",
            "/api/extensions",
        ]) {
            assert.equal((await post(path, { command: "id" })).status, 403, path);
        }

        assert.equal(
            (await post("/api/c/1/submit", { text: "test", requestId: "test", mode: "steer" }))
                .status,
            400,
        );
        assert.equal(
            (
                await post("/api/projects/linkedin-ad/messages", {
                    text: "test",
                    operationId: "test",
                })
            ).status,
            404,
        );
        assert.equal(
            (
                await post("/api/projects/humansignal/restore", {
                    releaseId: "missing",
                    actor: { id: "todd", owner: true },
                })
            ).status,
            403,
        );
        assert.equal(
            (
                await post(
                    "/api/projects/humansignal/approve",
                    { releaseId: "missing" },
                    { Origin: "http://untrusted.example" },
                )
            ).status,
            403,
        );
        const projects = await (await fetch(base + "/api/projects", { headers: member })).json();

        assert.deepEqual(
            projects.projects.map((p) => p.id),
            ["humansignal"],
        );
        assert.equal((await fetch(base + "/", { headers: member })).status, 200);
        assert.equal((await fetch(base + "/studio-review", { headers: member })).status, 200);
    } finally {
        const exited = once(child, "exit");

        child.kill("SIGTERM");
        await exited;
        await rm(directory, { recursive: true, force: true });
    }
});
