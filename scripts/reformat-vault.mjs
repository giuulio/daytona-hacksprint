import 'dotenv/config';
import { Daytona } from '@daytonaio/sdk';
import { readFileSync } from 'node:fs';

const d = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
const sb = await d.get(readFileSync('.cache/vault-sandbox-id', 'utf8').trim());

const PROMPT = `You are normalising the structure of every note in sources/ in this markdown vault.

Read CLAUDE.md first — the "Note structure" section is the target shape.

For EACH file in sources/:

1. Keep the YAML frontmatter exactly as it is.
2. "## Summary" — keep or write flowing prose in the user's voice. This is where
   synthesis lives. Merge any stray prose from elsewhere in the note into it.
3. "## Notes" — the bullet list.
4. "## Links" — the [[wiki-links]], preserved.

THE ONE ABSOLUTE RULE — READ IT TWICE:

A top-level "- > quote" bullet is a VERBATIM passage the user actually
highlighted. You must NEVER invent one. If a note has no such captured passage,
it does not get a quote bullet. Do not turn the note's own prose into a fake
quote. Do not attribute invented words to the author in the frontmatter. Fabricated
provenance is worse than an inconsistent note.

So, per note:

- If it ALREADY has "- > ..." bullets, leave those quotes byte-for-byte
  untouched, and make sure their children are correctly nested: the user's note
  as a plain indented bullet, your comment as an indented *italic* bullet.
- If it has NO quote bullets, convert its existing observation bullets into
  indented *italic* bullets under a single top-level bullet reading exactly:
      - *No captured highlight — this note predates highlight capture.*
  so the shape is consistent and the absence is honest and visible.

Do not touch ideas/, topics/, projects/ or templates/. Do not touch ideas/raw/
under any circumstances.

Work through every file in sources/. When done: git add -A`;

console.log('reformatting sources/ …');
const t0 = Date.now();
const b64 = Buffer.from(PROMPT, 'utf8').toString('base64');
const r = await sb.process.executeCommand(
  `cd /root/vault && unset OPENAI_API_KEY; echo ${b64} | base64 -d > /tmp/p.txt && ` +
  `codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check "$(cat /tmp/p.txt)" 2>&1 | tail -25`,
  undefined, undefined, 900,
);
console.log(r.result?.trim().slice(-1500));
console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)}s`);

const c = await sb.process.executeCommand(
  `cd /root/vault && git add -A && git commit -qm "normalise sources/ note structure" 2>&1 | tail -2; git diff --stat HEAD~1 HEAD | tail -3`,
  undefined, undefined, 90,
);
console.log(c.result?.trim());
