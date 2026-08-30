import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Test whether Codex CLI's ChatGPT-subscription auth survives being moved into a
// headless Daytona sandbox. Uploads ~/.codex/auth.json, runs a trivial codex exec.
// The credential is never logged and the sandbox is deleted at the end.

const AUTH = join(homedir(), '.codex', 'auth.json');
if (!existsSync(AUTH)) {
  console.log('no ~/.codex/auth.json — run `codex login` first');
  process.exit(1);
}

const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const sb = await d.create({ snapshot: 'inbox-codex-v1', autoStopInterval: 10, autoDeleteInterval: 20 }, { timeout: 120 });
console.log(`sandbox ${sb.id}`);

try {
  await sb.process.executeCommand('mkdir -p /root/.codex /root/work', undefined, undefined, 30);
  await sb.fs.uploadFile(readFileSync(AUTH), '/root/.codex/auth.json');
  await sb.process.executeCommand('chmod 600 /root/.codex/auth.json', undefined, undefined, 30);

  // Minimal config: force ChatGPT auth, avoid inheriting local plugins/models.
  await sb.fs.uploadFile(
    Buffer.from('preferred_auth_method = "chatgpt"\n', 'utf8'),
    '/root/.codex/config.toml',
  );

  let r = await sb.process.executeCommand(
    'ls -la /root/.codex/ && echo "--- auth_mode:" && python3 -c "import json;print(json.load(open(\'/root/.codex/auth.json\'))[\'auth_mode\'])"',
    undefined, undefined, 30,
  );
  console.log(r.result?.trim());

  console.log('\n=== codex exec (ChatGPT auth, no OPENAI_API_KEY set) ===');
  const t0 = Date.now();
  r = await sb.process.executeCommand(
    'cd /root/work && unset OPENAI_API_KEY && ' +
      'codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check ' +
      '"Write a file called hello.txt containing exactly the word WORKING. Then stop." 2>&1 | tail -30',
    undefined, undefined, 180,
  );
  console.log(r.result?.trim().slice(0, 2500));
  console.log(`\nelapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const check = await sb.process.executeCommand('cat /root/work/hello.txt 2>/dev/null || echo "NO FILE"', undefined, undefined, 30);
  const out = (check.result ?? '').trim();
  console.log('\n=== RESULT ===');
  console.log(out.includes('WORKING') ? '✅ ChatGPT auth WORKS headless in the sandbox' : `❌ did not produce the file — got: ${out}`);
} finally {
  await sb.delete().catch(() => {});
  console.log('sandbox deleted');
}
