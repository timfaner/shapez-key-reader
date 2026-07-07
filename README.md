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

## License

MIT
