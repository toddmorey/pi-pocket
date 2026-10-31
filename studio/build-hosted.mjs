/** Package the real Pocket modules for Studio's existing Worker, without publishing source or project data. */
import { readFile, writeFile, mkdir, readdir, copyFile, rm } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "../../durable-workflows/node_modules/esbuild/lib/main.js";

const root = resolve(import.meta.dirname, "..");
const workflows = resolve(root, "../durable-workflows");
const vendors = {
    "preact.mjs": "preact/dist/preact.mjs",
    "preact-hooks.mjs": "preact/hooks/dist/hooks.mjs",
    "htm.mjs": "htm/dist/htm.module.js",
    "marked.mjs": "marked/lib/marked.esm.js",
    "purify.mjs": "dompurify/dist/purify.es.mjs",
};
const assetTypes = new Set([
    ".js",
    ".css",
    ".svg",
    ".woff2",
    ".png",
    ".jpg",
    ".webp",
    ".json",
    ".webmanifest",
    ".txt",
]);
const prefixFonts = (text) =>
    text.replaceAll('"/fonts/', '"/pocket/fonts/').replaceAll("'/fonts/", "'/pocket/fonts/");

export async function buildHosted({
    editorDir = join(workflows, "editor/dist/projects"),
    generatedDir = join(workflows, "hosted/.generated"),
} = {}) {
    const output = join(editorDir, "pocket");
    const reviewSource = await readFile(join(editorDir, "index.html"), "utf8");

    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await mkdir(generatedDir, { recursive: true });

    async function copyWeb(directory, relative = "") {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
            const next = join(relative, entry.name);

            if (entry.isDirectory()) {
                await mkdir(join(output, next), { recursive: true });
                await copyWeb(join(directory, entry.name), next);
            } else if (
                entry.isFile() &&
                assetTypes.has(extname(entry.name)) &&
                entry.name !== "sw.js"
            ) {
                if ([".js", ".css"].includes(extname(entry.name))) {
                    await writeFile(
                        join(output, next),
                        prefixFonts(await readFile(join(directory, entry.name), "utf8")),
                    );
                } else {
                    await copyFile(join(directory, entry.name), join(output, next));
                }
            }
        }
    }

    await copyWeb(join(root, "web"));
    await copyFile(join(root, "LICENSE"), join(output, "LICENSE.txt"));
    const manifest = JSON.parse(await readFile(join(output, "manifest.webmanifest"), "utf8"));

    await writeFile(
        join(output, "manifest.webmanifest"),
        JSON.stringify({ ...manifest, id: "/pocket/", start_url: "/pocket/", scope: "/pocket/" }),
    );
    await mkdir(join(output, "vendor"), { recursive: true });

    for (const [name, source] of Object.entries(vendors)) {
        await copyFile(join(root, "node_modules", source), join(output, "vendor", name));
    }

    let html = prefixFonts(await readFile(join(root, "web/index.html"), "utf8"));

    html = html
        .replace("<title>Pi Pocket</title>", "<title>HumanSignal · Pocket Studio</title>")
        .replace('src="/app.js"', 'src="/pocket/studio.js"')
        .replaceAll('"/vendor/', '"/pocket/vendor/')
        .replaceAll('"/style.css"', '"/pocket/style.css"')
        .replaceAll('href="/manifest.webmanifest"', 'href="/pocket/manifest.webmanifest"')
        .replaceAll('href="/icon.svg"', 'href="/pocket/icon.svg"')
        .replaceAll('href="/apple-touch-icon.png"', 'href="/pocket/apple-touch-icon.png"')
        .replace("</head>", '<link rel="stylesheet" href="/pocket/studio.css"></head>');
    await writeFile(join(output, "index.html"), html);
    const review = reviewSource
        .replace("</head>", '<link rel="stylesheet" href="/pocket/studio-review.css"></head>')
        .replace("</body>", '<script src="/pocket/studio-review.js"></script></body>');

    await writeFile(join(output, "review.html"), review);
    const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
        (match) =>
            "'sha256-" +
            createHash("sha256").update(match[1].replace(/\r\n?/g, "\n")).digest("base64") +
            "'",
    );

    await writeFile(join(generatedDir, "pocket-csp.json"), JSON.stringify(hashes));
    await build({
        entryPoints: [join(root, "studio/projection.mjs")],
        outfile: join(generatedDir, "pocket-projection.mjs"),
        bundle: true,
        platform: "browser",
        format: "esm",
        target: "es2023",
        legalComments: "inline",
    });
    await writeFile(
        join(generatedDir, "pocket-projection.d.mts"),
        "export declare function projectView(value: unknown, actor: {id: string; name: string; owner: boolean}): Record<string, unknown>;\n",
    );
    console.log(
        "Packaged Pocket frontend and read-only projection for the existing Studio Worker.",
    );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
    await buildHosted();
}
