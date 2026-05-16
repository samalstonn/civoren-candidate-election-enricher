# Documentation Guide

All project docs live in `docs/`. This file defines what belongs there, how to organize it, and when to write or update docs.

## When to Write a Doc

Write a new doc when:
- A pattern, system, or workflow requires understanding multiple files to use correctly (e.g., adding a new adapter)
- A non-obvious decision was made that future contributors will need context on
- A recurring process (migration workflow, deployment steps) would otherwise require re-deriving from scratch

Do not write docs for things that are self-evident from reading the code, or that belong in CLAUDE.md as standing instructions.

## Folder Structure

```
docs/
├── documentation-guide.md        # This file
├── adding-a-new-enrichment-entity.md
└── [topic].md                    # Flat by default; use subfolders only if there are 5+ related files
```

Keep the structure flat unless a clear grouping emerges with enough files to justify a subfolder. If you add a subfolder, add a brief note here explaining the grouping.

## File Naming

- Lowercase, hyphen-separated: `my-topic.md`
- Name describes the task or concept, not the date or author: `migration-workflow.md` not `2026-05-notes.md`

## What to Include

Each doc should have:
- A one-line summary at the top of what it covers
- Only information that can't be derived by reading the code
- Concrete examples where the pattern is non-obvious

Keep docs short. A doc that requires scrolling to find the relevant section isn't serving its purpose.

## Keeping Docs Current

Update any affected doc as part of the same task that changes the code — not as a follow-up. If a doc no longer reflects reality, either fix it or delete it; stale docs are worse than no docs.

When in doubt about whether something warrants a doc, ask: would a future contributor have to re-read multiple files and make non-obvious connections to understand this? If yes, write the doc.
