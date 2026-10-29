/** Read-only browser verification against the already running loopback prototype. No model calls or project writes. */
import assert from "node:assert/strict";
import { chromium } from "../../durable-workflows/hosted/sandbox/node_modules/playwright/index.mjs";

const base = `http://127.0.0.1:${process.env.STUDIO_MVP_PORT || 8790}`;
const browser = await chromium.launch({ headless: true });
const errors = [];

try {
    for (const identity of ["todd", "michael"]) {
        const context = await browser.newContext({
            baseURL: base,
            viewport: { width: 1600, height: 1050 },
        });
        const page = await context.newPage();

        page.on("pageerror", (error) => errors.push(error.message));
        page.on("response", (response) => {
            if (response.status() >= 400) {
                errors.push(`${response.status()} ${response.url()}`);
            }
        });
        await page.goto("/");
        await page
            .getByRole("button", {
                name: identity === "todd" ? "Todd · owner" : "Michael · teammate",
            })
            .click();
        await page.waitForFunction(
            () => document.querySelector(".studio-status")?.textContent === "Connected",
        );
        const box = page.locator(".studio-conversation textarea");

        await box.fill("/model");
        assert.equal(
            await page.getByRole("button", { name: "Attach files", exact: true }).count(),
            0,
        );
        assert.equal(await page.getByRole("radiogroup", { name: "Send as" }).count(), 0);
        await box.fill("");
        await page.getByRole("button", { name: "Review output", exact: true }).click();
        const review = page.frameLocator('iframe[title="HumanSignal review and approvals"]');

        await review.getByRole("tab", { name: "Feedback", exact: true }).waitFor();
        assert.equal(
            await review.getByRole("tab", { name: "Chat", exact: true }).isVisible(),
            false,
        );
        assert.equal(
            await review.getByRole("tab", { name: "Heidi", exact: true }).isVisible(),
            false,
        );
        await page.setViewportSize({ width: 390, height: 844 });
        await page
            .locator(".studio-mobile-tabs")
            .getByRole("button", { name: "Conversation", exact: true })
            .click();
        assert.equal(await box.isVisible(), true);
        assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
        );
        await page
            .locator(".studio-mobile-tabs")
            .getByRole("button", { name: "Review & edits", exact: true })
            .click();
        assert.equal(
            await page.locator('iframe[title="HumanSignal review and approvals"]').isVisible(),
            true,
        );
        await context.close();
    }

    assert.deepEqual(errors, []);
    console.log(
        "Both development identities: real Pocket composer/transcript, review editor, unsupported-control restrictions, and 390px panel navigation pass with no browser errors.",
    );
} finally {
    await browser.close();
}
