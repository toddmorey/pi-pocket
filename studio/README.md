# Pocket Studio: one-project integration prototype

This fork tests actual reuse of Pi Pocket's UI with the HumanSignal Durable Studio backend. The upstream Pocket application is still available through its normal launcher. `npm run studio` starts a separate application and never opens `~/.pi-pocket` or the existing Studio database.

## Run

Keep the `pi-pocket-studio` and `durable-workflows` checkouts beside each other. Studio needs its existing dependencies, built project editor/bridge, prepared HumanSignal seed, Bubblewrap, and Playwright toolchain. See `../durable-workflows/docs/hosted-mvp.md` for these prerequisites.

```sh
npm ci
npm run studio
```

Open http://127.0.0.1:8790 and select Todd or Michael. These are **development identities on loopback**, not verified company logins. Use separate browser profiles for two users. Do not expose these listeners through a tunnel or deploy this development server.

The preview origin is http://127.0.0.1:8791. `STUDIO_MVP_PORT` chooses the application port; preview uses the next port. State defaults to `.data/studio/local/`, overridable with `STUDIO_MVP_DATA_DIR`. Only the `humansignal` project is enabled.

The runtime reads the existing sibling Studio `.env` server-side for shared OpenRouter funding. No key is copied to source, browser responses, project source or the build sandbox. Without configured funding, requests are refused. Builds use Studio's existing network-isolated runner and pinned toolchain.

If started by the setup agent, the process is a transient user service:

```sh
systemctl --user stop pi-pocket-studio
systemctl --user restart pi-pocket-studio
```

After reboot, use `npm run studio`. The transient service is not enabled at boot.

## Try the workflow

1. Open HumanSignal and ask Heidi for a small source change using the Pocket composer.
2. Watch the original Pocket transcript render live generation, tool activity and the response.
3. Choose **Review output**. The existing Studio editor opens beside the conversation on wide screens; phones switch between panels.
4. Build the initial saved version if none exists. Review its unmodified saved website or review image.
5. Choose **Edit elements**, annotate a real element, save the proposal, and apply the captured batch.
6. Watch Heidi work in the Pocket conversation. Review the resulting saved version, resolve the captured request, then approve that exact version.
7. Reopen as the other development identity to see the same committed conversation, versions and proposals. Approval records identify the approving member.

Approval is version acceptance, not authorization to an external publisher. There are no publication credentials or publication endpoints in this prototype.

## What is reused

- Unbundled upstream `web/transcript.js`, including activity groups, tool details, Markdown and scrolling.
- Upstream `web/composer.js`, including drafts, sent history, long pastes, resizing and send/stop behavior. A default-off `restricted` prop removes unsupported coding-agent controls.
- Upstream Preact/HTM, CSS, icons and appearance implementation. The project shell is new; it does not claim to reuse Pocket's whole navigation component.
- Upstream `src/server/projection.ts` to translate Pi entries, live state and usage for those components. A small adapter normalizes Studio's attributed user entry kind.
- Existing Studio `ProjectService`, `projectApi`, project tools, inference metering, immutable object storage and isolated build runner.
- Existing built React project editor and annotation bridge, embedded without a source rewrite. The embedded surface starts on Feedback and hides duplicate conversation tabs; opening it separately retains the original editor.

The Studio runtime remains Pi 1.3.0. Pocket remains Pi 1.4.0. The runtimes never share storage or mutable runtime objects. The bridge passes plain projected JSON into Pocket's store. The projection module runs on the host; no Pi runtime is shipped to the browser.

## Integration boundary

`web/studio.js` is a separate browser entrypoint. It initializes Pocket's store and subscribes to authenticated `/api/studio/events` SSE, replacing neither the upstream `app.js` nor its API client. A narrow `/api/c/1/submit` and `/abort` adapter supports the existing composer. Other Pocket mutations, including shell, settings and instructions, are rejected server-side.

`studio/server.mjs` is an adaptation of the sibling `tools/mvp-local.ts`, with one-project routing, isolated storage and Pocket file serving. `runtime.mjs` adapts its local agent host to expose a read-only conversation watch. `projection.mjs` supplies the exact subset needed by the reused components. `static.mjs` serves both frontend surfaces.

A disconnected stream stops only observation. Pi owns execution and committed state. Reconnect opens a fresh snapshot. Text submission IDs survive an ambiguous network failure in browser storage; Studio namespaces them by authenticated development actor. Unsaved composer drafts retain Pocket's browser behavior; cross-device preference sync is not added.

## Permission boundary

- The project runtime has focused source/build tools, not Pocket's host CodingTools, shell, settings, extension loader or updater.
- Project agent writes to canonical `.design-system/`, `AGENTS.md` and `PROJECT-GUIDANCE.md` are refused. Publication and platform mutation APIs are absent.
- The source of the running platform is not part of the project's source object store.
- Studio checks approval attribution and owner-only restore through its existing API. Hiding a button is not the authorization mechanism.
- This verifies application capability separation, not production identity or a security audit. Local persona cookies are deliberately user-selectable.

## Verification and limits

```sh
npm run test:studio
npm run studio:smoke # against a running prototype; no inference or project writes
npm run check
npm run lint
npm test
```

The dedicated integration test uses real Pi SQLite, tasks, streaming watches, Studio tools, storage and approvals with a scripted model and deterministic build output. It checks guidance-write denial, project edits, Pocket projection, attribution, request deduplication, owner-only restore and reopening the same state. It is not evidence of real inference or Cloudflare execution.

The local live walkthrough and its results are recorded in `VALIDATION.md`.

This is not yet a Cloudflare frontend deployment or backend transport adapter. Access identity integration, presence/side chat, complete queue controls, a shared library, design-system proposal management and external publication remain subsequent slices. The original server is not a compatibility layer for all Pocket endpoints. Embedded React assets still have their existing build step.

The prototype tests the expensive assumptions without migrating any existing projects or data. Upstream changes are currently localized to optional composer restrictions and Studio-specific transcript interaction handling. A long-lived fork still needs upstream merge maintenance and coordinated Pi/Agents version upgrades.
