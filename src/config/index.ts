// KEEPSIDIAN_SERVER_URL is injected via esbuild (see config/esbuild.config.mjs)
// Defaults to localhost when no env is provided and removes any trailing slash.
const rawServerUrl = process.env.KEEPSIDIAN_SERVER_URL ?? 'http://localhost:8080';

export const KEEPSIDIAN_SERVER_URL = rawServerUrl.replace(/\/$/, '');
