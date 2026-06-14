# Docs-Only Mode: Custom Directory & No Source Code

Design for extending lat.md to support a docs-only use case — markdown knowledge bases without co-located source code, with a configurable directory name.

## Problem

lat.md currently assumes:
1. The knowledge base lives in a directory named `lat.md/`
2. It sits inside a project with source code
3. Features like `checkCodeRefs`, `tryResolveSourceRef`, and `scanCodeRefs` always apply

Users want to use lat purely as a docs/wiki tool — no source code, custom directory name (e.g. `docs/`, `wiki/`, `knowledge/`).

## Key Coupling Points

| Location | Coupling |
|----------|----------|
| `src/lattice.ts:44` `findLatticeDir()` | Hardcoded `lat.md` directory name |
| `src/cli/context.ts:37` | `projectRoot = dirname(latDir)` — assumes parent is a code project |
| `src/cli/check.ts:90` `tryResolveSourceRef()` | Resolves `[[src/foo.ts#bar]]` wiki links to source symbols |
| `src/cli/check.ts:186` `checkCodeRefs()` | Scans source files for `@lat:` comments |
| `src/cli/check.ts` `checkAll()` | Runs both md and code-ref checks unconditionally |
| `src/code-refs.ts` `scanCodeRefs()` | ripgrep scan of project for `@lat:` patterns |
| `src/source-parser.ts` | Tree-sitter symbol extraction (heavy dependency) |

## Approach: CLI flags, `projectRoot === latDir`

Add `--docs-only` flag and `--dir <path>` option. In docs-only mode, `--dir` sets both `latDir` and `projectRoot` to the same directory. No config file.

```bash
lat check --docs-only --dir ./my-wiki
lat search "query" --docs-only --dir ./docs
```

```typescript
export type CmdContext = {
  latDir: string;
  projectRoot: string;  // same as latDir in docs-only mode
  styler: Styler;
  mode: 'cli' | 'mcp';
  docsOnly: boolean;
};
```

### Analysis: Does `projectRoot === latDir` work?

**Section IDs — works, with a prefix difference.**
`parseSections()` and `extractRefs()` compute section IDs via `relative(projectRoot, filePath)`. Currently with `projectRoot = /proj` and `latDir = /proj/lat.md`, a file `/proj/lat.md/arch.md` gets id prefix `lat.md/arch`. When `projectRoot === latDir`, the same file gets id prefix `arch` (no `lat.md/` prefix). This is fine — it's actually cleaner for a standalone docs use case. Section references like `[[arch#Heading]]` work as before. The `lat.md/` prefix in IDs was always an artifact of being a subdirectory.

**`loadAllSections()` — needs a small change.**
At `lattice.ts:180`: `const projectRoot = dirname(latticeDir)`. This hardcodes the parent-dir assumption. Needs to accept `projectRoot` as a parameter (or derive it from context) instead of always using `dirname()`.

**`checkMd()` / `checkCodeRefs()` / `checkSections()` — same issue.**
These all derive `projectRoot = dirname(latticeDir)` locally (e.g. `check.ts:141`, `check.ts:187`, `check.ts:400`). Each needs to receive `projectRoot` from context instead.

**`scanCodeRefs()` — would scan the markdown dir itself.**
When `projectRoot === latDir`, ripgrep would scan the knowledge base dir for `@lat:` comments. It already excludes `*.md` files, so it wouldn't find anything — but it would still run uselessly. In docs-only mode this should be skipped entirely.

**`tryResolveSourceRef()` — harmless but wasteful.**
Would try to resolve `[[src/foo.ts#bar]]`-style links against the markdown directory. Would just fail with "file not found". Should be skipped in docs-only mode for cleaner error messages (broken section link, not broken source link).

**`checkIndex()` — works as-is.**
Only operates on the lattice directory contents. Uses `basename(latticeDir)` for display, unaffected by projectRoot.

**Search/indexing — works as-is.**
`search/index.ts:36` does `dirname(latDir)` but only to compute `sectionContent()` paths. When `projectRoot === latDir`, file paths are just relative to the same dir — still correct.

**`format.ts:21` — works.**
Uses `join(ctx.projectRoot, section.filePath)` to build absolute paths. Since `filePath` would be relative to `latDir` (which equals `projectRoot`), the join resolves correctly.

### Summary of issues

| Issue | Severity | Fix |
|-------|----------|-----|
| `loadAllSections()` hardcodes `dirname(latticeDir)` as projectRoot | **Must fix** | Accept projectRoot param or use context |
| `checkMd/checkCodeRefs/checkSections` hardcode `dirname(latticeDir)` | **Must fix** | Pass projectRoot from context |
| `search/index.ts` hardcodes `dirname(latDir)` | **Must fix** | Pass projectRoot from context |
| `scanCodeRefs` runs needlessly | Minor | Skip when `docsOnly` |
| `tryResolveSourceRef` gives confusing errors | Minor | Skip when `docsOnly` |
| Section ID prefix changes from `lat.md/foo` to `foo` | **Non-issue** | Cleaner for standalone use |
| `checkIndex` uses `basename(latticeDir)` | **Non-issue** | Works regardless |

### Required changes

**Core pattern:** Stop deriving `projectRoot = dirname(latticeDir)` inside functions. Instead, thread `projectRoot` through from `CmdContext`.

| Module | Change |
|--------|--------|
| `CmdContext` | Add `docsOnly: boolean` |
| `resolveContext()` | When `--docs-only`: set `projectRoot = latDir`. When `--dir` without `--docs-only`: use `--dir` as start for `findLatticeDir()` |
| `findLatticeDir()` | When `--docs-only --dir X`: skip walk-up search, use X directly |
| `loadAllSections()` | Accept `projectRoot` param instead of computing `dirname()` |
| `checkMd()` | Accept `projectRoot` from caller; skip `tryResolveSourceRef` when `docsOnly` |
| `checkCodeRefs()` | Skip entirely when `docsOnly` |
| `checkSections()` | Accept `projectRoot` from caller |
| `checkAll()` | Conditionally run code-ref checks |
| `search/index.ts` | Accept `projectRoot` from caller |

The refactor to thread `projectRoot` from context is the main structural change. It's also a good cleanup for the normal mode — the `dirname()` derivation is duplicated in ~5 places today.

Source-parser, code-refs, and tree-sitter are already partially lazy-loaded via dynamic `import()`. In docs-only mode they're never imported, so users don't pay the startup cost.
