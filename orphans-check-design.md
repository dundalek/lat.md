# Design: `--orphans` option for `lat check`

## Problem

Currently `lat check` validates that wiki links point to valid targets, but does not verify that every markdown file is *reachable* from a root/index file. A file can exist in `lat.md/` without being linked from anywhere — making it invisible in the knowledge graph. This undermines the Maps of Content (MOC) approach where all content should be discoverable by traversing links from a root entry point.

## Current State

- **Root file**: Each `lat.md/` directory already has an index file (e.g. `lat.md/lat.md`) that lists direct children via `[[wiki links]]`. The `check index` subcommand validates these listings exist.
- **Wiki link extraction**: `extractRefs()` in `src/lattice.ts` already parses all `[[target]]` links from every markdown file, returning `Ref[]` with target, source file, and line number.
- **File listing**: `listLatticeFiles()` returns all `.md` files in `lat.md/`.
- **Ref resolution**: `resolveRef()` + `buildFileIndex()` resolve short/full ref targets to canonical section IDs.

The `check index` subcommand already ensures index files list their *immediate* directory children, but it does **not** verify transitive reachability. A file could be listed in an index but never linked from any other file — or a deeply nested file could be linked only from a sibling that itself is orphaned.

## Design Options

### Option A: Graph reachability from root (recommended)

Build a file-level directed graph from wiki links, then BFS/DFS from the root index file. Any `.md` file not visited is orphaned.

**Algorithm:**
1. Identify the root file: `lat.md/<dirname>.md` (e.g. `lat.md/lat.md`)
2. For each `.md` file, extract all wiki links via `extractRefs()`
3. Resolve each link target to a file path (strip section fragments, resolve short names via `buildFileIndex`)
4. Build adjacency: `Map<string, Set<string>>` — file → set of files it links to
5. BFS/DFS from root, collecting all reachable files
6. Subtract reachable set from full file set → orphans

**Pros:** True reachability check. Catches files that are listed in indexes but not transitively connected. Simple to reason about.

**Cons:** Wiki links target *sections*, not files — needs a mapping step from section IDs to file paths. Some links point to source code files (not markdown) — these should be excluded from the graph.

### Option B: Simply check that every file is linked from *any* other file

For each file, verify at least one other `.md` file contains a wiki link pointing into it. No graph traversal needed.

**Pros:** Simpler implementation. Catches the most common case (totally unlinked files).

**Cons:** Doesn't catch *clusters* of orphaned files that link to each other but aren't reachable from root. Weaker guarantee.

### Option C: Check only index file coverage (extend existing `check index`)

Rely on the existing index validation to ensure every file appears in its parent directory's index, and every directory index is itself listed in its parent's index — forming a chain back to root.

**Pros:** Already partially implemented. No graph construction needed.

**Cons:** Only verifies the index-file chain, not general wiki link connectivity. A file could appear in an index listing but have zero incoming links from actual content sections.

**Recommendation:** Option A provides the strongest guarantee and aligns with the MOC philosophy. The implementation cost is modest since all building blocks exist.

## Implementation Plan

### 1. New check function: `checkOrphans()` in `src/cli/check.ts`

**Signature:** `async function checkOrphans(latticeDir: string): Promise<CheckError[]>`

**Steps:**
1. Call `listLatticeFiles(latticeDir)` to get all `.md` files
2. Determine root file: `join(latticeDir, basename(latticeDir) + '.md')` — following the same convention as `checkIndex()`
3. For each file, call `extractRefs(file, content, projectRoot)` to get outgoing wiki links
4. For each ref, resolve to a file path:
   - Use `resolveRef(target, sectionIds, fileIndex)` to get canonical section ID
   - Extract file portion from the section ID (everything before first `#`)
   - Map back to an actual `.md` file path
   - Skip source code refs (`isSourcePath()` returns true)
5. Build adjacency map: `Map<string, Set<string>>` keyed by relative file path (without `.md` extension, matching section ID file prefixes)
6. BFS from root file, collecting visited set
7. Any file not in visited set → emit a `CheckError` with a message like: `file "path/to/file.md" is not reachable from root — no chain of wiki links connects it to the index`

### 2. New CLI subcommand: `check orphans`

In `src/cli/index.ts`, register a new subcommand under `check`:

```
check
  .command('orphans')
  .description('Verify all lat.md files are reachable from root index')
```

Import and call `checkOrphansCommand(ctx)` from `check.ts`.

### 3. Wire into `checkAllCommand()`

Add `checkOrphans()` to the set of checks run by `lat check` (no subcommand). Include its errors in the aggregate total.

### 4. CLI documentation update

Update `lat.md/cli.md` — add `### orphans` section under `## check` describing the new subcommand.

### 5. Tests

Add test cases in `tests/cases/`:
- A fixture with an orphaned file (file exists but no wiki link points to it) → expect error
- A fixture where all files are reachable → expect no errors
- A fixture with a cluster of mutually-linked files that are disconnected from root → expect errors for the cluster

### 6. `lat.md/` documentation

Update `lat.md/cli.md` check section and add test specs if using `require-code-mention`.

## Edge Cases

- **Root file itself**: Never reported as orphaned (it's the start node)
- **Subdirectory index files**: Reachable if their parent index or any other reachable file links to them
- **Aliased wiki links**: `[[target|alias]]` — the target is what matters, alias is display only (already handled by `extractRefs`)
- **Source code links**: `[[src/foo.ts#bar]]` — excluded from the reachability graph (not markdown files)
- **Self-links**: A file linking to its own sections doesn't make it reachable from root
- **Cache directory**: `lat.md/.cache/` is already excluded by `walkEntries`

## Affected Files

- `src/cli/check.ts` — new `checkOrphans()` function and `checkOrphansCommand()`, update `checkAllCommand()`
- `src/cli/index.ts` — register `check orphans` subcommand
- `lat.md/cli.md` — document new subcommand
- `tests/cases/` — new fixture directories
- `tests/cases.test.ts` — new test cases
