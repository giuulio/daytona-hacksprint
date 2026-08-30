import 'dotenv/config';
import { Daytona, Image } from '@daytonaio/sdk';

const NAME = 'inbox-codex-v2';
const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });

// NOTE: no secrets baked in. A snapshot is a persistent image; keys are passed
// at create() time only. See BRIEF §8.
const image = Image.base('node:22-bookworm-slim')
  .runCommands(
    'apt-get update && apt-get install -y --no-install-recommends git ripgrep python3 ca-certificates curl && rm -rf /var/lib/apt/lists/*',
    'npm i -g @openai/codex@latest',
    'git config --global user.email "agent@inbox.local"',
    'git config --global user.name "inbox agent"',
    'git config --global init.defaultBranch main',
    'mkdir -p /root/vault',
    // prove the toolchain exists at build time, so a broken snapshot fails loudly here
    'git --version && rg --version | head -1 && python3 --version && codex --version',
  )
  .workdir('/root');

const t0 = Date.now();
console.log(`[${new Date().toISOString()}] building snapshot ${NAME} ...`);
try {
  await d.snapshot.create(
    { name: NAME, image, resources: { cpu: 2, memory: 2, disk: 5 } },
    { onLogs: (c) => process.stdout.write(c) },
  );
  console.log(`\nSNAPSHOT OK ${NAME} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.log(`\nSNAPSHOT FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s:`, e?.message || String(e));
  process.exit(1);
}
