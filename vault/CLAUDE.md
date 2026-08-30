# Instructions for agents working in this vault

This is a personal knowledge vault of plain-Markdown notes. Read this file
completely before creating or editing anything.

## Hard rules

- **Never edit, move, or delete anything in `ideas/raw/`.** That folder is the
  unfiltered original capture and must stay byte-for-byte intact. It is the
  provenance record. Read it freely; never write to it.
- **Write cleaned-up versions to `ideas/processed/`**, linking back to the raw
  original via `source-note:` in frontmatter.
- **Markdown only.** Plain `.md` files, no databases, no proprietary formats.
- **Never paste large verbatim copies** of other people's articles, papers, or
  transcripts. Summarize in the user's own words. Short quotes are fine; full
  reproductions are not.
- **Filenames are kebab-case**, lowercase, no dates in the name.

## Filing logic — read before creating any note

Folders split by an *objective* property (who made it / what type), never by
the ambiguous "is this mine or theirs":

- The user wrote it from scratch (an idea, a plan) → `ideas/`
- Notes *on* something external (paper, repo, video, thread) → `sources/`
- An evergreen concept that outlives any single source → `topics/`
- Something actively being built → `projects/`

An idea *derived from* a source still goes in `ideas/` and **links** to the
source via `derived-from: [[source-note-name]]`. Overlap is expressed as a
link, never by duplicating a file.

## Prefer appending to creating

Before creating a new file, search the vault for an existing note on the same
subject. Hub notes exist specifically to be appended to — for example a new UI
resource link belongs as a bullet in `sources/ui-design-inspiration-resources.md`,
not in a new file. Creating a near-duplicate is the most common failure mode.
Use `git ls-files '*.md'` and `rg` before deciding.

**Always give `rg` an explicit path:** `rg 'pattern' .` — not `rg 'pattern'`.
With no path argument ripgrep reads stdin, which is empty here, and returns
nothing. A silent empty result looks identical to "no duplicates exist" and is
the fastest way to create one.

## Frontmatter

Every note opens with YAML frontmatter. See `templates/idea.md` and
`templates/source.md` for required keys. Always fill `created` with the real
date, use lowercase-hyphenated `tags`, and keep `status` accurate.

**Draw tags from vocabulary already present in the vault.** Run
`rg '^tags:' -N --no-filename` to see what exists before inventing a new tag.

## Links

Wiki-style `[[note-name]]` links, no `.md` extension. Link generously —
cross-domain links are the point of this vault.
