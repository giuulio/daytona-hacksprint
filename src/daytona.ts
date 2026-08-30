import { Daytona, type Sandbox } from '@daytonaio/sdk';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { CODEX_AUTH_PATH, DAYTONA_API_KEY, OPENAI_API_KEY, SNAPSHOT, VAULT_LOCAL, VAULT_REMOTE } from './config.ts';
import { metric } from './metrics.ts';

export const daytona = new Daytona({ apiKey: DAYTONA_API_KEY });

const CACHE = '.cache';
const VAULT_ID_FILE = `${CACHE}/vault-sandbox-id`;
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });

let sandboxCount = 0;
export const sandboxesCreated = () => sandboxCount;

/** Tar the local vault, stripping macOS xattrs which pollute GNU tar. */
export function tarVault(): Buffer {
  execSync(`COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/inbox-vault.tgz -C "${VAULT_LOCAL}" .`);
  return readFileSync('/tmp/inbox-vault.tgz');
}

/**
 * Give the sandbox's Codex CLI a credential. Uploaded at runtime, never in the
 * snapshot. ChatGPT-mode auth.json is a full-account credential including a
 * refresh token, so these sandboxes are short-lived and auto-delete.
 */
export async function installCodexAuth(sb: Sandbox) {
  if (!existsSync(CODEX_AUTH_PATH)) {
    metric('codex_auth', OPENAI_API_KEY ? 'apikey-only' : 'NONE');
    return;
  }
  await sb.process.executeCommand('mkdir -p /root/.codex', undefined, undefined, 30);
  await sb.fs.uploadFile(readFileSync(CODEX_AUTH_PATH), '/root/.codex/auth.json');
  await sb.fs.uploadFile(Buffer.from('preferred_auth_method = "chatgpt"\n', 'utf8'), '/root/.codex/config.toml');
  await sb.process.executeCommand('chmod 600 /root/.codex/auth.json', undefined, undefined, 30);
  metric('codex_auth', 'chatgpt');
}

async function bootstrapVault(sb: Sandbox) {
  await sb.fs.uploadFile(tarVault(), '/root/vault.tgz');
  await sb.process.executeCommand(
    // safe.directory: tar-extracted files don't match the container's git ownership check
    `git config --global --add safe.directory "*" && ` +
      `rm -rf ${VAULT_REMOTE} && mkdir -p ${VAULT_REMOTE} && ` +
      `tar xzf /root/vault.tgz -C ${VAULT_REMOTE} 2>/dev/null && ` +
      `cd ${VAULT_REMOTE} && (git rev-parse --git-dir >/dev/null 2>&1 || (git init -q && git add -A && git commit -qm "seed vault"))`,
    undefined,
    undefined,
    120,
  );
}

const API = process.env.DAYTONA_API_URL ?? 'https://app.daytona.io/api';
const AUTH = { Authorization: `Bearer ${DAYTONA_API_KEY}`, 'content-type': 'application/json' };

/**
 * Free the org memory quota before a fan-out.
 *
 * The account is capped at 10GiB total, and the SDK's list() has come back empty
 * while sandboxes were demonstrably alive and holding quota — so this uses the
 * REST API. Without it, a couple of restarts leave orphan vault sandboxes and
 * every prototype create fails with "Total memory limit exceeded".
 */
export async function reapStale(keepId?: string) {
  try {
    const res = await fetch(`${API}/sandbox`, { headers: AUTH });
    const body = await res.json();
    const items = Array.isArray(body) ? body : (body.items ?? body.data ?? []);
    const stale = items.filter(
      (s: any) => !['destroyed', 'deleted'].includes(s.state) && s.id !== keepId,
    );
    await Promise.all(
      stale.map((s: any) => fetch(`${API}/sandbox/${s.id}?force=true`, { method: 'DELETE', headers: AUTH }).catch(() => {})),
    );
    if (stale.length) metric('sandboxes_reaped', stale.length);
    return stale.length;
  } catch {
    return 0;
  }
}

/** Long-lived sandbox holding the vault. Reused across server restarts. */
export async function getVaultSandbox(): Promise<Sandbox> {
  if (existsSync(VAULT_ID_FILE)) {
    const id = readFileSync(VAULT_ID_FILE, 'utf8').trim();
    try {
      const sb = await daytona.get(id);
      if (sb.state !== 'started') await sb.start();
      await installCodexAuth(sb);   // token may have been refreshed locally since
      return sb;
    } catch {
      /* fall through and make a new one */
    }
  }
  const t0 = Date.now();
  const sb = await daytona.create(
    {
      snapshot: SNAPSHOT,
      envVars: { OPENAI_API_KEY }, // runtime only — never in the snapshot
      labels: { role: 'vault' },
      autoStopInterval: 60,
    },
    { timeout: 180 },
  );
  sandboxCount++;
  metric('vault_sandbox_create_ms', Date.now() - t0);
  await installCodexAuth(sb);
  await bootstrapVault(sb);
  writeFileSync(VAULT_ID_FILE, sb.id);
  return sb;
}

/** Ephemeral sandbox for one generated prototype. public:true makes the preview iframeable. */
export async function createPrototypeSandbox(label: string): Promise<Sandbox> {
  const t0 = Date.now();
  const sb = await daytona.create(
    {
      snapshot: SNAPSHOT,
      public: true, // without this the preview URL 401s
      envVars: { OPENAI_API_KEY },
      labels: { role: 'prototype', idea: label.slice(0, 60) },
      autoStopInterval: 20,
      autoDeleteInterval: 60,
    },
    { timeout: 180 },
  );
  sandboxCount++;
  metric('prototype_sandbox_create_ms', Date.now() - t0);
  await installCodexAuth(sb);
  return sb;
}

/**
 * Pull the vault back out of the sandbox onto disk, so the filed notes show up
 * in Obsidian and in the repo. Whole-tree tar rather than per-file so deletions
 * (the consumed inbox capture) replicate too.
 */
export async function syncVaultDown(sb: Sandbox) {
  const t0 = Date.now();
  await sb.process.executeCommand(
    `cd ${VAULT_REMOTE} && tar czf /tmp/out.tgz --exclude=.git .`,
    undefined,
    undefined,
    60,
  );
  const buf = await sb.fs.downloadFile('/tmp/out.tgz');
  writeFileSync('/tmp/inbox-vault-down.tgz', buf);
  // Replace tracked content but keep the local .git intact.
  execSync(
    `cd "${VAULT_LOCAL}" && find . -mindepth 1 -maxdepth 1 -not -name .git -exec rm -rf {} + && ` +
      `tar xzf /tmp/inbox-vault-down.tgz -C "${VAULT_LOCAL}"`,
  );
  metric('vault_sync_down_ms', Date.now() - t0);
}

/** Serve a directory and return an iframeable preview URL. */
export async function serve(sb: Sandbox, dir: string, port = 3000): Promise<string> {
  const session = 'web';
  await sb.process.createSession(session).catch(() => {});
  await sb.process.executeSessionCommand(session, {
    command: `cd ${dir} && python3 -m http.server ${port}`,
    runAsync: true, // executeCommand would block forever on a server
  });
  await new Promise((r) => setTimeout(r, 2000));
  const { url } = await sb.getPreviewLink(port);
  return url;
}

/**
 * Run Codex CLI inside the sandbox. Non-interactive, approvals bypassed because
 * the sandbox IS the isolation boundary — Codex's own sandbox nests badly here.
 */
export async function runCodex(sb: Sandbox, prompt: string, cwd: string, timeoutSec = 300) {
  const b64 = Buffer.from(prompt, 'utf8').toString('base64');
  const cmd =
    `cd ${cwd} && ${OPENAI_API_KEY ? '' : 'unset OPENAI_API_KEY; '}echo ${b64} | base64 -d > /tmp/prompt.txt && ` +
    `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check "$(cat /tmp/prompt.txt)" 2>&1 | tail -60`;
  const t0 = Date.now();
  const r = await sb.process.executeCommand(cmd, undefined, undefined, timeoutSec);
  metric('codex_exec_ms', Date.now() - t0);
  return { exitCode: r.exitCode, output: r.result ?? '' };
}
