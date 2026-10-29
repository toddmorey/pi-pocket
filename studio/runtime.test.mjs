import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openAgent, load } from "./runtime.mjs";
import { projectView } from "./projection.mjs";
import {
    ProjectService,
    base64,
    encoder,
    projectById,
} from "../../durable-workflows/packages/studio-core/src/index.ts";
import { projectApi } from "../../durable-workflows/packages/studio-core/src/api.ts";
import { LocalObjects, LocalValues } from "../../durable-workflows/tools/mvp-local-providers.ts";
import { createMeter } from "../../durable-workflows/packages/studio-core/src/meter.ts";
const { createModels } = await load("@earendil-works/pi-ai/models");
const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await load(
    "@earendil-works/pi-ai/providers/faux",
);

test("Pocket projection follows real Studio tasks, rejects shared-guidance edits, deduplicates requests and reopens committed history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pocket-studio-"));
    const values = new LocalValues(join(directory, "state.sqlite"));
    const state = values.scope("humansignal:");
    const service = new ProjectService(
        projectById("humansignal"),
        { get: () => state.get("project"), put: (value) => state.put("project", value) },
        new LocalObjects(join(directory, "objects")),
        {
            environment: "test",
            build: async () => [{ path: "index.html", bytes: encoder.encode("<h1>Reviewed</h1>") }],
        },
    );

    await service.initialize([
        { path: "src/pages/index.astro", data: base64(encoder.encode("<h1>Original</h1>")) },
        { path: ".design-system/tokens.css", data: base64(encoder.encode(":root{}")) },
    ]);
    const faux = fauxProvider({ tokensPerSecond: 1000 });
    const models = createModels();

    models.setProvider(faux.provider);
    faux.setResponses([
        fauxAssistantMessage(
            [
                fauxToolCall("write_file", {
                    path: ".design-system/tokens.css",
                    content: "corrupted",
                }),
            ],
            { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
            [
                fauxToolCall("edit_file", {
                    path: "src/pages/index.astro",
                    oldText: "Original",
                    newText: "Reviewed",
                }),
            ],
            { stopReason: "toolUse" },
        ),
        fauxAssistantMessage([fauxToolCall("build_release", {})], { stopReason: "toolUse" }),
        fauxAssistantMessage("The candidate is ready for human review."),
    ]);
    const options = { models, provider: faux.provider.id, model: faux.getModel().id };
    let agent = await openAgent(service, join(directory, "agent"), createMeter(state), options);

    try {
        const frames = [];
        const stop = await agent.observe((value) =>
            frames.push(projectView(value, { id: "michael", name: "Michael", owner: false })),
        );
        const actor = { id: "michael", name: "Michael", owner: false };

        await agent.submit("Update the headline", "test-request", actor);
        await agent.idle();
        await stop();
        const messages = await agent.messages();

        assert.equal(
            new TextDecoder().decode(await service.read(".design-system/tokens.css")),
            ":root{}",
        );
        assert.match(
            new TextDecoder().decode(await service.read("src/pages/index.astro")),
            /Reviewed/,
        );
        assert.equal((await service.snapshot()).releases.length, 1);
        assert.equal((await service.snapshot()).approvals.length, 0);
        assert.ok(
            frames.some((f) => f.live.busy),
            "live run was observed",
        );
        assert.ok(
            frames.some((f) => f.live.generation),
            "live generation was observed",
        );
        assert.ok(
            frames.some((f) => f.entries.some((e) => e.kind === "toolResult" && e.isError)),
            "guidance denial reaches real Pocket projection",
        );
        assert.ok(
            frames.some((f) => Object.values(f.authors).includes("michael")),
            "author identity is preserved",
        );
        await agent.submit("Update the headline", "test-request", actor);
        await agent.idle();
        assert.equal(
            (await agent.messages()).length,
            messages.length,
            "same durable request cannot run twice",
        );
        const release = (await service.snapshot()).releases[0];
        const request = (operation) =>
            new Request("http://studio/api/projects/humansignal/" + operation, {
                method: "POST",
                body: JSON.stringify({ releaseId: release.id }),
            });
        const denied = await projectApi(
            request("restore"),
            service,
            agent,
            actor,
            async () => ({}),
            true,
            "http://preview",
        );

        assert.equal(denied.status, 403);
        const approved = await projectApi(
            request("approve"),
            service,
            agent,
            actor,
            async () => ({}),
            true,
            "http://preview",
        );

        assert.equal(approved.status, 200);
        assert.equal((await service.snapshot()).approvals[0].actor, "michael");
        await agent.close();
        agent = await openAgent(service, join(directory, "agent"), createMeter(state), options);
        assert.equal((await agent.messages()).length, messages.length, "reopen retains transcript");
        assert.equal((await service.snapshot()).approvals[0].releaseId, release.id);
    } finally {
        await agent.close();
        values.close();
        await rm(directory, { recursive: true, force: true });
    }
});
