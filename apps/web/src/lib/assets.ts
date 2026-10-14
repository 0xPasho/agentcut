/**
 * The files in public/ that change with a deploy (styles.css, login.js) are linked with a
 * hash of their contents in the URL, so Cloudflare and browsers fetch the new ones the
 * moment a deploy lands instead of serving the old ones for hours. scripts/build-server.mjs
 * sets the hash; where nothing sets it (`pnpm dev`, the tests) it is "dev".
 */
declare const __ASSET_VERSION__: string | undefined;

export const ASSET_VERSION = typeof __ASSET_VERSION__ === "string" ? __ASSET_VERSION__ : "dev";

export const asset = (path: string) => `${path}?v=${ASSET_VERSION}`;
