# Safe Local Shapez Assistant Plan

## Goal

Provide a local helper for shapez.io that can:

- Read an explicitly supplied save copy.
- Summarize current level/progress-like fields.
- Keep per-level build notes in this workspace.
- Identify delivery/progress fields for manual review when a copied save needs a legal progress repair.

## Safety boundaries

- Do not read or write the live shapez.io save directory automatically.
- Do not edit real save files.
- Do not skip levels, unlock arbitrary tech, or delete/replace factory entities.
- Do not modify existing facilities in the save.
- Write only to this repository's `notes/` and `reports/` directories.
- Treat `propose-delivery` output as a review aid only. It lists candidate JSON paths and does not patch anything.

## Workflow

1. Make a manual copy/export of the current save into this repository or another safe location.
2. Run `node tools/shapez-save-assistant.js inspect <copy>`.
3. Add notes with `node tools/shapez-save-assistant.js note add --level <n> --title "..." --text "..."`.
4. If progress repair is needed, run `node tools/shapez-save-assistant.js propose-delivery <copy> --level <n>` and inspect candidate fields.
5. Any actual save repair should happen only on a duplicate save after manual review, never on the live file.

## Current implementation

- `shape-key-reader.js` remains an in-game read-only helper for shape keys on belts.
- `tools/shapez-save-assistant.js` is an offline CLI for copied save files and local notes.
