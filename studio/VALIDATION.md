# HumanSignal prototype validation — 2026-10-29

## Outcome

The narrow integration works: the actual Pocket transcript and composer operate over Studio's Pi runtime, while the existing React review editor handles captured annotations and manifest-bound human approvals. No migration or changes to the original Pocket or Durable Studio checkout were needed.

The shell/navigation is new prototype code. Transcript rendering, activity groups, composer behavior, styles, icons and appearance are upstream Pocket code. This does not establish that the entire upstream application can be swapped to Studio's backend with a small adapter.

## Live local walkthrough

An isolated copy of the HumanSignal seed was built using the existing Bubblewrap/Astro/Playwright execution provider, producing the website and all review images. Shared OpenRouter inference used the existing configured model, with no image generation or external publication.

- Todd submitted a real request through Pocket's composer to change the Home hero headline. Heidi read current source, edited it, built a new immutable release and inspected the saved Home screenshot.
- Michael, in a separate browser context, opened the embedded existing editor, selected the real Home headline, entered a Content proposal and applied its captured batch.
- A final verification batch changed the headline to `Human expertise. Better AI.`. Todd's Pocket view observed live busy state, partial generation and tool activity while Michael's request ran.
- After the request finished and version 4 existed, Michael switched to clean saved output, resolved the captured batch against version 4 and approved that exact release. The stored resolution and approval both identify Michael; approval contains the release manifest hash. Prior versions were retained.
- The test uses explicit development identities, not real company authentication. Both clients share committed project state; this does not claim presence/side-chat parity.
- Reopening the browser restored the committed conversation. Restarting the prototype server preserved the four saved releases, review metadata and approvals; the subsequent browser smoke check connected successfully.
- The 390 × 844 viewport fit without horizontal overflow, retained the Pocket composer, and allowed switching to review without unmounting it.
- The final live two-browser run reported no JavaScript errors or failed HTTP resources. The browser smoke check also passed after restarting with the final server code and content security policy.

Reported model cost for the complete local exploration was approximately **$0.15**, with zero image-generation calls. Existing project content, hosted releases and approvals were untouched. The test project's state and screenshots are private, ignored files under `.data/studio/`.

## Repeatable checks

- `npm run check`: passed (TypeScript, extension types and reference validation).
- `npm run lint`: passed.
- `npm run test:studio`: 2 passed. Real Pi SQLite/tools/watch integration plus HTTP authentication/capability boundaries. Models/build output are scripted for deterministic integration testing.
- `npm run studio:smoke`: passed against the running prototype. Both development identities, real composer/transcript, review embedding, restricted controls and 390px panel navigation; no inference or project mutation.
- `npm test`: **897 passed, 1 failed, 0 skipped**, out of 898 upstream tests.

The remaining upstream test is `npm stage failures leave the live package and pending state unchanged` in `test/npm-update.test.ts`. It expects an installation failure from a deliberately failing fixture install script, but receives a successful staging result on this machine. The same targeted test fails in the untouched original `/home/toddm/Projects/pi-pocket` checkout. This is a reproduced baseline/environment issue, not a passing full suite; the prototype does not change the updater. This machine uses Node 26.12.1 and npm 12.2.1, whose installation-script policy is relevant to investigating the fixture.

## Not established by this prototype

- Cloudflare hosting of the adapted UI and its live transport.
- Verified Cloudflare Access/company identities, production membership or revocation.
- Full Pocket API compatibility, upstream navigation reuse, presence, human side chat, or advanced steering/queue controls.
- A cross-project asset catalog, design-system proposal workflow, or external publisher.
- A production security assessment or upgrade/migration strategy for Pi 1.3 versus 1.4.

The next decision is whether to extend this deliberately narrow integration toward Access + the existing hosted project adapter, rather than implementing a broad compatibility facade for Pocket's server.
