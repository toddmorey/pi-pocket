# Hosted connection — 2026-10-30

Open https://durable-studio-mvp.toddmorey.workers.dev/pocket/ using the existing Cloudflare Access sign-in. This UI reads the existing hosted HumanSignal project and its R2-backed releases. The original editor remains at the origin's `/` route. The local demo and its four versions were not migrated or uploaded.

`build-hosted.mjs` packages this fork's native UI modules and fonts under `/pocket/` and bundles its read-only projection for the existing Studio Worker. The backend branch is `feat/pocket-hosted` in the sibling durable-workflows repository. Its implementation and evidence are in `../durable-workflows/docs/hosted-pocket.md`.

The hosted UI uses verified member/owner identity, a bounded authenticated conversation stream, narrow project commands and the existing review/approval API. It does not expose development personas or Pocket's host shell and settings. Only Studio's existing project tools execute. Canonical guidance writes are rejected by shared source-tool policy.

The deployment preserved the live project/sandbox Durable Object namespaces, R2 bucket, membership/model/Access variables and secret bindings. No project data, seeds or secrets were uploaded or rewritten; container rollout was skipped. Worker version: `4f2814ab-f176-425c-b3ea-a0af02598a56`.

Verified: 21 core/hosted tests, 33 legacy server tests, 86 bridge/editor tests, Worker type/bundle checks, real local workerd/DO/R2 HTTP and browser checks, 15 live unauthenticated Access redirects, and unchanged live storage/config bindings. The fork's two original Studio tests pass; Pocket's upstream suite still has its previously reproduced npm staging fixture failure (897/898 pass).

The local Cloudflare browser check used signed test JWTs and deterministic build output, not a production identity or model request. The owner was asked to confirm the real Access-authenticated hosted experience. That acceptance is not yet recorded; no production project edits were made as part of connecting the UI.
