/** Serve upstream Pocket modules and the existing built Studio review surface without bundling either together. */
import { readFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join, sep, extname } from "node:path";
const web = resolve(import.meta.dirname, "../web");
const root = resolve(import.meta.dirname, "..");
const types = {
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".png": "image/png",
    ".webmanifest": "application/manifest+json",
};
const vendors = {
    "preact.mjs": "preact/dist/preact.mjs",
    "preact-hooks.mjs": "preact/hooks/dist/hooks.mjs",
    "htm.mjs": "htm/dist/htm.module.js",
    "marked.mjs": "marked/lib/marked.esm.js",
    "purify.mjs": "dompurify/dist/purify.es.mjs",
};

function htmlPolicy(req, res, html) {
    const hashes = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
        (match) =>
            "'sha256-" +
            createHash("sha256").update(match[1].replace(/\r\n?/g, "\n")).digest("base64") +
            "'",
    );
    const preview = "http://127.0.0.1:" + (Number(new URL("http://" + req.headers.host).port) + 1);

    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' " +
            hashes.join(" ") +
            "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: " +
            preview +
            "; connect-src 'self'; frame-src 'self' " +
            preview +
            "; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    );
    res.setHeader("Referrer-Policy", "no-referrer");
}

export async function servePocket(req, res, url, actor, editorAssets) {
    let base = web,
        path = url.pathname.slice(1);

    if (url.pathname === "/studio-review") {
        let html = await readFile(join(editorAssets, "index.html"), "utf8");

        html = html.replace("</head>", '<link rel="stylesheet" href="/studio-review.css"></head>');
        html = html.replace("</body>", '<script src="/studio-review.js"></script></body>');
        htmlPolicy(req, res, html);
        res.setHeader("Content-Type", types[".html"]);
        res.end(html);

        return true;
    }

    if (url.pathname === "/studio-config.js") {
        res.setHeader("Content-Type", types[".js"]);
        res.end('window.__STUDIO_CONFIG__ = {surface:"projects"};');

        return true;
    }

    if (url.pathname === "/") {
        let html = await readFile(join(web, "index.html"), "utf8");

        html = html
            .replace("<title>Pi Pocket</title>", "<title>HumanSignal · Pocket Studio</title>")
            .replace('src="/app.js"', 'src="/studio.js"')
            .replace("</head>", '<link rel="stylesheet" href="/studio.css"></head>');
        htmlPolicy(req, res, html);
        res.setHeader("Content-Type", types[".html"]);
        res.end(html);

        return true;
    }

    if (url.pathname.startsWith("/assets/")) {
        return false;
    }

    if (url.pathname.startsWith("/vendor/")) {
        const vendor = vendors[url.pathname.slice(8)];

        if (!vendor) {
            return false;
        }

        base = join(root, "node_modules");
        path = vendor;
    }

    try {
        const file = await realpath(resolve(base, decodeURIComponent(path)));

        if (!file.startsWith(base + sep) || !types[extname(file)]) {
            return false;
        }

        res.setHeader("Content-Type", types[extname(file)]);
        res.end(await readFile(file));

        return true;
    } catch (error) {
        if (["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) {
            return false;
        }

        throw error;
    }
}
