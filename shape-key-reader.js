// @ts-nocheck
const METADATA = {
    website: "https://viewer.shapez.io/",
    author: "timfaner",
    name: "Shape Key Reader",
    version: "1.0.1",
    id: "shape-key-reader",
    description: "Click a running belt to read the shape item's short key without consuming it.",
    minimumGameVersion: ">=1.5.0",
};

function makeDiv(parent, id = null, classes = [], innerText = "") {
    const div = document.createElement("div");
    if (id) {
        div.id = id;
    }
    for (let i = 0; i < classes.length; ++i) {
        div.classList.add(classes[i]);
    }
    if (innerText) {
        div.innerText = innerText;
    }
    parent.appendChild(div);
    return div;
}

function removeAllChildren(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(
            () => true,
            () => copyTextToClipboardFallback(text)
        );
    }

    return Promise.resolve(copyTextToClipboardFallback(text));
}

function copyTextToClipboardFallback(text) {
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "readonly");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    const didCopy = document.execCommand("copy");
    document.body.removeChild(input);
    return didCopy;
}

function stopHudEvent(event) {
    event.preventDefault();
    event.stopPropagation();
}

function stopHudPropagation(event) {
    event.stopPropagation();
}

function isTextInputTarget(target) {
    if (!target) {
        return false;
    }
    const tagName = target.tagName && target.tagName.toLowerCase();
    if (tagName === "textarea") {
        return true;
    }
    if (tagName === "input") {
        const type = (target.getAttribute("type") || "text").toLowerCase();
        return !["button", "checkbox", "radio", "range", "submit"].includes(type);
    }
    return Boolean(target.isContentEditable);
}

function isMovementKeyEvent(event) {
    return ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(
        event.code
    );
}

class HUDShapeKeyReader extends shapez.BaseHUDPart {
    createElements(parent) {
        this.toast = makeDiv(parent, "ingame_HUD_ShapeKeyReaderToast", ["shapeKeyReaderToast"]);
        this.toastHeader = makeDiv(this.toast, null, ["shapeKeyReaderToastHeader"]);
        this.toastTitle = makeDiv(this.toastHeader, null, ["shapeKeyReaderToastTitle"], "Shape Key Reader");
        this.toastBody = makeDiv(this.toast, null, ["shapeKeyReaderToastBody"]);
        this.toastPreview = makeDiv(this.toastBody, null, ["shapeKeyReaderToastPreview"]);
        this.toastInfo = makeDiv(this.toastBody, null, ["shapeKeyReaderToastInfo"]);
        this.toastMessage = makeDiv(this.toastInfo, null, ["shapeKeyReaderToastMessage"]);
        this.toastKey = document.createElement("input");
        this.toastKey.classList.add("shapeKeyReaderToastKey");
        this.toastKey.readOnly = true;
        this.toastInfo.appendChild(this.toastKey);

        this.toastActions = makeDiv(this.toastInfo, null, ["shapeKeyReaderToastActions"]);
        this.copyButton = document.createElement("button");
        this.copyButton.classList.add("styledButton");
        this.copyButton.innerText = "Copy key";
        this.toastActions.appendChild(this.copyButton);
    }

    initialize() {
        this.currentShapeKey = "";
        this.currentItem = null;
        this.currentTile = null;
        this.toastTimeout = null;
        this.inputKeyHandler = this.handleTextInputKeyEvent.bind(this);
        this.inputFocusHandler = this.releaseMovementKeys.bind(this);

        this.root.camera.downPreHandler.addToTop(this.downPreHandler, this);
        document.addEventListener("keydown", this.inputKeyHandler, true);
        document.addEventListener("keyup", this.inputKeyHandler, true);
        document.addEventListener("focusout", this.inputFocusHandler, true);

        this.copyButton.addEventListener("click", event => {
            stopHudEvent(event);
            this.copyKey();
        });
        this.copyButton.addEventListener("pointerdown", stopHudPropagation);
        this.copyButton.addEventListener("mousedown", stopHudPropagation);
        this.toast.addEventListener("click", stopHudEvent);

        this.renderEmpty();
        this.hideToast();
    }

    cleanup() {
        if (this.root && this.root.camera) {
            this.root.camera.downPreHandler.remove(this.downPreHandler);
        }
        document.removeEventListener("keydown", this.inputKeyHandler, true);
        document.removeEventListener("keyup", this.inputKeyHandler, true);
        document.removeEventListener("focusout", this.inputFocusHandler, true);
        this.clearToastTimeout();
        super.cleanup();
    }

    handleTextInputKeyEvent(event) {
        if (isTextInputTarget(event.target) && isMovementKeyEvent(event)) {
            event.stopPropagation();
        }
    }

    releaseMovementKeys() {
        const keys = [
            ["KeyW", "w"],
            ["KeyA", "a"],
            ["KeyS", "s"],
            ["KeyD", "d"],
            ["ArrowUp", "ArrowUp"],
            ["ArrowLeft", "ArrowLeft"],
            ["ArrowDown", "ArrowDown"],
            ["ArrowRight", "ArrowRight"],
        ];
        for (let i = 0; i < keys.length; ++i) {
            const [code, key] = keys[i];
            const event = new KeyboardEvent("keyup", {
                key,
                code,
                bubbles: true,
                cancelable: true,
            });
            document.dispatchEvent(event);
            window.dispatchEvent(event);
        }
    }

    downPreHandler(pos, button) {
        try {
            return this.handleDownPreHandler(pos, button);
        } catch (error) {
            console.error("Shape Key Reader failed to read belt item", error);
            this.showToast({
                title: "Reader error",
                message: "Could not read this belt item",
                key: "",
                item: null,
                isError: true,
            });
            return shapez.STOP_PROPAGATION;
        }
    }

    handleDownPreHandler(pos, button) {
        if (button !== shapez.enumMouseButton.left || this.root.currentLayer !== "regular") {
            return;
        }

        const tile = this.root.camera.screenToWorld(pos).toTileSpace();
        const entity = this.root.map.getLayerContentXY(tile.x, tile.y, "regular");
        if (!entity || !entity.components.Belt) {
            return;
        }

        const clickedWorld = this.root.camera.screenToWorld(pos);
        const result = this.findNearestShapeItemOnBeltPath(entity, clickedWorld);
        if (!result) {
            this.showToast({
                title: "No shape found",
                message: "Click a belt line that is currently carrying a shape",
                key: "",
                item: null,
                isError: true,
            });
            return shapez.STOP_PROPAGATION;
        }

        this.renderItem(result.item, result.tile);
        return shapez.STOP_PROPAGATION;
    }

    findNearestShapeItemOnBeltPath(beltEntity, clickedWorld) {
        const beltComp = beltEntity.components.Belt;
        const path = beltComp && beltComp.assignedPath;
        if (!path || !path.items || path.items.length === 0) {
            return null;
        }

        let progress = path.spacingToFirstItem;
        let best = null;

        for (let i = 0; i < path.items.length; ++i) {
            const pair = path.items[i];
            const item = pair[1];
            const worldPos = path.computePositionFromProgress(progress).toWorldSpaceCenterOfTile();
            if (
                item &&
                item.getItemType &&
                item.getItemType() === "shape" &&
                item.getAsCopyableKey
            ) {
                const dx = worldPos.x - clickedWorld.x;
                const dy = worldPos.y - clickedWorld.y;
                const distanceSquared = dx * dx + dy * dy;
                if (!best || distanceSquared < best.distanceSquared) {
                    best = {
                        item,
                        tile: worldPos.toTileSpace(),
                        distanceSquared,
                    };
                }
            }

            progress += pair[0];
        }

        return best;
    }

    renderEmpty() {
        this.currentShapeKey = "";
        this.currentItem = null;
        this.currentTile = null;
        this.copyButton.disabled = true;
    }

    renderItem(item, tile) {
        this.currentItem = item;
        this.currentTile = tile;
        this.currentShapeKey = item.getAsCopyableKey();
        this.copyButton.disabled = false;

        this.showToast({
            title: "Shape read",
            message: "Read from belt at " + tile.x + ", " + tile.y,
            key: this.currentShapeKey,
            item,
            isError: false,
        });
    }

    copyKey() {
        if (!this.currentShapeKey) {
            return;
        }
        const key = this.currentShapeKey;
        const item = this.currentItem;
        copyTextToClipboard(key).then(didCopy => {
            if (didCopy) {
                this.showToast({
                    title: "Copied",
                    message: "Shape key copied",
                    key,
                    item,
                    isError: false,
                });
            } else {
                this.showToast({
                    title: "Copy failed",
                    message: "Select the key field and copy manually",
                    key,
                    item,
                    isError: true,
                });
            }
        });
    }

    showToast({ title, message, key, item, isError }) {
        this.clearToastTimeout();

        this.toastTitle.innerText = title;
        this.toastMessage.innerText = message;
        this.toastKey.value = key || "";
        this.copyButton.disabled = !key;
        this.toast.classList.toggle("noKey", !key);
        this.toast.classList.toggle("error", isError);

        removeAllChildren(this.toastPreview);
        if (item && item.definition) {
            this.toastPreview.appendChild(item.definition.generateAsCanvas(192));
        }

        this.toast.classList.add("visible");
        this.toastTimeout = setTimeout(() => this.hideToast(), 4000);
    }

    hideToast() {
        this.clearToastTimeout();
        this.toast.classList.remove("visible");
    }

    clearToastTimeout() {
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
    }

    clear() {
        this.renderEmpty();
    }
}

class Mod extends shapez.Mod {
    init() {
        this.modInterface.registerCss(`
#ingame_HUD_ShapeKeyReaderToast {
    position: absolute;
    left: 50%;
    top: $scaled(18px);
    width: min($scaled(320px), calc(100vw - $scaled(32px)));
    padding: $scaled(10px);
    box-sizing: border-box;
    border-radius: $scaled(4px);
    background: rgba(28, 48, 42, 0.95);
    color: #ffffff;
    z-index: 1000;
    pointer-events: none;
    box-shadow: 0 $scaled(4px) $scaled(14px) rgba(0, 0, 0, 0.24);
    opacity: 0;
    transform: translate(-50%, $scaled(-8px));
    transition: opacity 0.16s ease-out, transform 0.16s ease-out;
}

#ingame_HUD_ShapeKeyReaderToast.visible {
    opacity: 1;
    pointer-events: all;
    transform: translate(-50%, 0);
}

#ingame_HUD_ShapeKeyReaderToast.error {
    background: rgba(70, 36, 42, 0.95);
}

#ingame_HUD_ShapeKeyReaderToast .shapeKeyReaderToastHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: $scaled(8px);
}

#ingame_HUD_ShapeKeyReaderToast .shapeKeyReaderToastTitle {
    font-size: $scaled(13px);
    line-height: 1.2;
    font-weight: bold;
}

#ingame_HUD_ShapeKeyReaderToast .shapeKeyReaderToastBody {
    display: grid;
    grid-template-columns: $scaled(58px) minmax(0, 1fr);
    gap: $scaled(10px);
    align-items: center;
    margin-top: $scaled(8px);
}

#ingame_HUD_ShapeKeyReaderToast .shapeKeyReaderToastPreview {
    display: flex;
    align-items: center;
    justify-content: center;
    width: $scaled(58px);
    height: $scaled(58px);
    border-radius: $scaled(4px);
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
}

#ingame_HUD_ShapeKeyReaderToast .shapeKeyReaderToastPreview canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    width: auto;
    height: auto;
    object-fit: contain;
}

#ingame_HUD_ShapeKeyReaderToast .shapeKeyReaderToastMessage {
    min-height: $scaled(16px);
    font-size: $scaled(10px);
    line-height: 1.35;
    color: rgba(255, 255, 255, 0.8);
}

#ingame_HUD_ShapeKeyReaderToast .shapeKeyReaderToastKey {
    width: 100%;
    margin-top: $scaled(6px);
    box-sizing: border-box;
    border: 0;
    border-radius: $scaled(3px);
    padding: $scaled(7px) $scaled(8px);
    font: inherit;
    font-size: $scaled(11px);
    color: #10131a;
    background: #ffffff;
}

#ingame_HUD_ShapeKeyReaderToast .shapeKeyReaderToastActions {
    margin-top: $scaled(7px);
}

#ingame_HUD_ShapeKeyReaderToast .shapeKeyReaderToastActions button {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
}

#ingame_HUD_ShapeKeyReaderToast.noKey .shapeKeyReaderToastPreview,
#ingame_HUD_ShapeKeyReaderToast.noKey .shapeKeyReaderToastKey,
#ingame_HUD_ShapeKeyReaderToast.noKey .shapeKeyReaderToastActions {
    display: none;
}

#ingame_HUD_ShapeKeyReaderToast.noKey .shapeKeyReaderToastBody {
    display: block;
}
        `);

        this.modInterface.registerHudElement("shapeKeyReader", HUDShapeKeyReader);
    }
}
