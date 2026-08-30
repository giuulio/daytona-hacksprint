import 'dotenv/config';

export const SNAPSHOT = 'inbox-codex-v2';
export const VAULT_LOCAL = new URL('../vault', import.meta.url).pathname;
export const VAULT_REMOTE = '/root/vault';
export const PORT = Number(process.env.PORT ?? 3737);
export const DAYTONA_API_KEY = process.env.DAYTONA_API_KEY!;
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

/**
 * Codex auth. Two supported modes:
 *  - API key  : OPENAI_API_KEY, passed as an env var at create() time.
 *  - ChatGPT  : ~/.codex/auth.json uploaded into the sandbox at runtime.
 * Never baked into the snapshot either way — a snapshot is a persistent image.
 */
export const CODEX_AUTH_PATH = process.env.CODEX_AUTH_PATH ?? `${process.env.HOME}/.codex/auth.json`;

/** INVARIANT 1: ideas/raw/ is the provenance record. Enforced in code, not prompt. */
export const PROTECTED_PATHS = [/^ideas\/raw\//];

export function assertNotProtected(relPath: string) {
  const p = relPath.replace(/^\.?\//, '');
  if (PROTECTED_PATHS.some((re) => re.test(p))) {
    throw new Error(`INVARIANT VIOLATION: refusing to write protected path ${p}`);
  }
}
