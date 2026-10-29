/** HumanSignal pilot: upstream Pocket transcript, composer and appearance over the Studio runtime. */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Transcript } from "./transcript.js";
import { Composer } from "./composer.js";
import { store, dismiss, actions } from "./store.js";
import { html, Icon } from "./ui.js";
import { startTheme, setPrefs, prefs, chooseTheme } from "./theme.js";

const actorResponse = await fetch("/api/session");

if (!actorResponse.ok) {
    location.replace("/dev-login");

    throw new Error("Sign in to open the studio.");
}

const { actor } = await actorResponse.json();

store.set({
    conversationId: 1,
    me: { id: actor.id, name: actor.name, role: actor.owner ? "owner" : "guest" },
    server: { studio: true, collab: 2, extensions: [], themeDefault: null },
    sessions: [{ id: 1, title: "HumanSignal website", cwd: "HumanSignal", kind: "session" }],
    sessionsLoaded: true,
    connection: "connecting",
});
// Keep the logical request ID across an ambiguous network failure and browser reload.
const pendingKey = "studio.request." + actor.id;

actions.submit = async (text) => {
    let pending;

    try {
        pending = JSON.parse(localStorage.getItem(pendingKey));
    } catch {}

    if (!pending || pending.text !== text) {
        pending = { text, id: crypto.randomUUID() };
    }

    localStorage.setItem(pendingKey, JSON.stringify(pending));
    const response = await fetch("/api/c/1/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mode: "followUp", requestId: pending.id }),
    });
    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || "Unable to submit the request.");
    }

    localStorage.removeItem(pendingKey);

    return result;
};

startTheme();
let stream;

function connect() {
    stream = new EventSource("/api/studio/events");

    stream.onmessage = (event) => {
        const next = JSON.parse(event.data);

        store.set({
            users: next.users,
            connection: "connected",
            view: {
                ...store.state.view,
                ...next,
                entries: new Map(next.entries.map((e) => [e.id, e])),
                order: next.entries.map((e) => e.id),
            },
        });
    };

    stream.onerror = () => store.set({ connection: "reconnecting" });
}

connect();
addEventListener("pagehide", () => stream.close());
addEventListener("pageshow", (event) => {
    if (event.persisted) {
        connect();
    }
});

function Studio() {
    const [, redraw] = useState(0);
    const [panel, setPanel] = useState("conversation");
    const [reviewOpened, setReviewOpened] = useState(false);
    const [appearance, setAppearance] = useState(false);

    useEffect(() => store.subscribe(() => redraw((n) => n + 1)), []);
    const { view, connection, notices } = store.state;

    const openReview = () => {
        setReviewOpened(true);
        setPanel("review");
    };

    return html`<div class="studio-shell" data-panel=${panel}>
        <aside class="studio-nav window" aria-label="Project navigation">
            <a class="studio-brand" href="/">π <span>Pocket Studio</span></a>
            <span class="studio-label">PROJECT</span>
            <button class="studio-project" onClick=${() => setPanel("conversation")}>
                <${Icon} name="folder" size=${18} /> HumanSignal website
            </button>
            <p class="muted small">Shared project · isolated prototype</p>
            <button class="button" onClick=${openReview}>Review & element edits</button>
            <div class="grow"></div>
            <button class="button" onClick=${() => setAppearance(!appearance)}>Appearance</button>
            <span class="small">${actor.name} · ${actor.owner ? "owner" : "member"}</span>
            <a class="muted small" href="/dev-login">Change development identity</a>
        </aside>
        <section class="studio-conversation pane window" aria-label="Conversation with Heidi">
            <header class="studio-topbar">
                <div><strong>HumanSignal</strong><span class="muted small"> with Heidi</span></div>
                <span class="grow"></span>
                <span class="studio-status" role="status">${connection !== "connected" ? "Reconnecting…" : view.live.busy ? "Heidi is working" : "Connected"}</span>
                <button class="button" onClick=${openReview}>Review output</button>
            </header>
            ${
                appearance &&
                html`<div class="studio-appearance">
                <button class="button" onClick=${() => chooseTheme("tokyo-night")}>Dark</button>
                <button class="button" onClick=${() => chooseTheme("catppuccin-latte")}>Light</button>
                <label>Text size <input type="range" min="12" max="22" step="1" value=${prefs().text} onInput=${(e) => setPrefs({ text: Number(e.currentTarget.value) })} /></label>
            </div>`
            }
            ${notices.map(
                (
                    n,
                ) => html`<div class="studio-notice" role=${n.level === "error" ? "alert" : "status"}>
                ${n.message}<button class="link" onClick=${() => dismiss(n.id)}>Dismiss</button>
            </div>`,
            )}
            ${view.conversation ? html`<${Transcript} /><${Composer} restricted=${true} />` : html`<p class="muted">Opening the durable conversation…</p>`}
            <div class="studio-contract muted small">Requests queue in order. Review and approval happen on saved versions.</div>
        </section>
        <section class="studio-review window" aria-label="Project review" hidden=${!reviewOpened}>
            <header class="studio-topbar"><strong>Saved output & feedback</strong><span class="grow"></span>
                <button class="button" onClick=${() => setPanel("conversation")}>Conversation</button>
                <a class="link" href="/studio-review#/projects/humansignal" target="_blank" rel="noopener">Open separately</a>
            </header>
            ${reviewOpened && html`<iframe title="HumanSignal review and approvals" src="/studio-review#/projects/humansignal"></iframe>`}
        </section>
        <nav class="studio-mobile-tabs" aria-label="Workspace panels">
            <button aria-pressed=${panel === "conversation"} onClick=${() => setPanel("conversation")}>Conversation</button>
            <button aria-pressed=${panel === "review"} onClick=${openReview}>Review & edits</button>
        </nav>
    </div>`;
}

render(html`<${Studio} />`, document.getElementById("app"));
