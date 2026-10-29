/** Embed the existing review app without introducing a second conversation surface. */
if (window.parent !== window) {
    document.documentElement.dataset.pocketReview = "true";

    const chooseFeedback = () => {
        const tab = document.getElementById("tab-feedback");

        if (!tab) {
            return;
        }

        tab.click();
        observer.disconnect();
    };

    const observer = new MutationObserver(chooseFeedback);

    observer.observe(document.getElementById("root"), { childList: true, subtree: true });
    chooseFeedback();
    document.addEventListener(
        "keydown",
        (event) => {
            if (
                !event.target.closest('[role="tablist"]') ||
                !["ArrowLeft", "ArrowRight"].includes(event.key)
            ) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();
            const next = document.getElementById(
                event.target.id === "tab-feedback" ? "tab-versions" : "tab-feedback",
            );

            next?.click();
            next?.focus();
        },
        true,
    );
}
