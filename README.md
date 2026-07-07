# Shapez Key Reader

A small single-file mod for [shapez.io](https://shapez.io/) that reads the short key of shape items from a running belt without consuming or interrupting the belt.

## Features

- Click a belt carrying a shape to read the nearest shape item on that belt path.
- Shows the shape preview and short key in a compact top HUD.
- Provides a manual **Copy key** button.
- The HUD automatically closes after 4 seconds.
- Does not consume, reroute, or block items.
- Adds a keyboard guard for text inputs so typing labels does not get stuck as map movement.

## Installation

Download `shape-key-reader.js` and place it in your shapez.io mods directory.

On macOS Steam installs, the mods directory is usually:

```text
~/Library/Preferences/shapez.io/mods/
```

After copying the file, restart shapez.io and enable the mod if needed.

## Usage

1. Open a save with the mod loaded.
2. Stay on the regular layer.
3. Left-click a belt line that is currently carrying a shape item.
4. The top HUD shows the shape preview and short key.
5. Click **Copy key** to copy the key to the system clipboard.

## Notes

- This mod only reads shape items.
- It intentionally does not create a building and does not alter factory throughput.
- The mod version is kept at `1.0.1` to avoid triggering shapez.io save warnings for existing test saves.

## Offline save assistant

This repository also contains a non-invasive local CLI:

```bash
node tools/shapez-save-assistant.js inspect verify-backup/savegame-cfcb7cc273e9cf467c9d415372f040d00b17c447.bin
node tools/shapez-save-assistant.js note add --level 12 --title "Main idea" --text "Describe the factory approach here."
node tools/shapez-save-assistant.js note list
node tools/shapez-save-assistant.js propose-delivery verify-backup/savegame-cfcb7cc273e9cf467c9d415372f040d00b17c447.bin --level 12
```

The CLI only reads paths you pass explicitly. It does not discover or touch the live shapez.io save directory, and its writes are limited to this repository's `notes/` and `reports/` directories. See `docs/SAFE_TOOLING_PLAN.md`.

## License

MIT
