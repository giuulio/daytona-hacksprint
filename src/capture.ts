import type { Sandbox } from '@daytonaio/sdk';
import { VAULT_REMOTE, assertNotProtected } from './config.ts';
import { runCodex } from './daytona.ts';
import { metric } from './metrics.ts';

export type CaptureInput = { text: string; note?: string; sourceUrl?: string; sourceApp?: string };

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'capture';

/** Layer 1: land the raw capture in inbox/ with provenance frontmatter. */
export async function writeToInbox(sb: Sandbox, input: CaptureInput) {
  const title = input.text.trim().split('\n')[0].slice(0, 40);
  const name = `${new Date().toISOString().slice(0, 10)}-${slug(title).slice(0, 32)}.md`;
  const rel = `inbox/${name}`;
  assertNotProtected(rel); // INVARIANT 1

  const fm = [
    '---',
    `captured: ${new Date().toISOString()}`,
    `source-url: ${input.sourceUrl ?? ''}`,
    `source-app: ${input.sourceApp ?? 'unknown'}`,
    `note: ${JSON.stringify(input.note ?? '')}`,
    'status: unfiled',
    '---',
    '',
    input.text.trim(),
    '',
  ].join('\n');

  await sb.fs.uploadFile(Buffer.from(fm, 'utf8'), `${VAULT_REMOTE}/${rel}`);
  return rel;
}

/** Read the vault's own ruleset + shape so Codex files the way the vault expects. */
async function vaultContext(sb: Sandbox) {
  const r = await sb.process.executeCommand(
    `cd ${VAULT_REMOTE} && echo "===CLAUDE===" && cat CLAUDE.md && ` +
      `echo "===FILES===" && git ls-files '*.md' && ` +
      `echo "===TAGS===" && rg -N --no-filename '^tags:' . | sort -u | head -40 && ` +
      `echo "===TEMPLATE_IDEA===" && cat templates/idea.md && ` +
      `echo "===TEMPLATE_SOURCE===" && cat templates/source.md`,
    undefined,
    undefined,
    60,
  );
  return r.result ?? '';
}

const FILING_PROMPT = (ctx: string, rel: string) => `You are filing one captured item into a markdown knowledge vault. You are in the vault root.

${ctx}

===TASK===
The captured item is at: ${rel}

File it, obeying CLAUDE.md above. Decide ALL of:
1. Route: ideas/ vs sources/ vs topics/ vs projects/
2. Append to an existing note, or create a new one. SEARCH FIRST with 'rg "term" .'
   (always pass the "." — without a path rg reads stdin and silently finds nothing).
   Appending to an existing hub note is usually more correct than a new file.
3. Kebab-case filename.
4. Valid YAML frontmatter matching the templates. Reuse tags from ===TAGS=== above.
5. Links: derived-from: or source-note: pointing at real files that exist.
6. A prose summary IN THE USER'S OWN WORDS. Never paste large verbatim text.

HARD RULES:
- NEVER write to ideas/raw/. It is the provenance record. Read only.
- Delete ${rel} once filed — it has served its purpose.
- Output must be valid markdown openable in Obsidian.
- Do not ask questions. Decide and act.

When done, stage everything: git add -A`;

/** Layer 2: file the capture. No confirmation, no user choice. */
export async function fileCapture(sb: Sandbox, rel: string) {
  const ctx = await vaultContext(sb);
  const codex = await runCodex(sb, FILING_PROMPT(ctx, rel), VAULT_REMOTE, 300);

  // INVARIANT 1, enforced in code: undo any write into ideas/raw/ before committing.
  const guard = await sb.process.executeCommand(
    `cd ${VAULT_REMOTE} && git add -A && ` +
      `VIOL=$(git diff --cached --name-only -- 'ideas/raw/*') && ` +
      `if [ -n "$VIOL" ]; then echo "REVERTED:$VIOL"; git reset -q HEAD -- 'ideas/raw/*'; git checkout -- 'ideas/raw/*' 2>/dev/null; fi`,
    undefined,
    undefined,
    60,
  );
  const violated = (guard.result ?? '').includes('REVERTED:');
  if (violated) metric('invariant_raw_write_blocked', true);

  const commit = await sb.process.executeCommand(
    `cd ${VAULT_REMOTE} && git add -A && git commit -qm "file: ${rel}" 2>&1 | tail -3; ` +
      `git diff --stat HEAD~1 HEAD 2>/dev/null | tail -20`,
    undefined,
    undefined,
    60,
  );

  const changed = await sb.process.executeCommand(
    `cd ${VAULT_REMOTE} && git diff --name-only HEAD~1 HEAD 2>/dev/null`,
    undefined,
    undefined,
    30,
  );

  return {
    diffStat: (commit.result ?? '').trim(),
    changedFiles: (changed.result ?? '').trim().split('\n').filter(Boolean),
    codexOutput: codex.output.slice(-2000),
    invariantBlocked: violated,
  };
}
