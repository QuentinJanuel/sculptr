// A plain DOM renderer for mods' panels, written against the declaration in ./ui and nothing else.
// Unstyled on purpose: it makes a panel usable without any particular host, and is the proof that a
// panel is a declaration rather than a description of somebody's components.
import {
  uiResolve,
  type ModUiPatch,
  type ModUiState,
  type UiBindingId,
  type UiEvent,
  type UiLiteral,
  type UiNode,
  type UiSelectOption,
} from "./ui.js";

/** What the renderer needs from the side running the mods. A `ModHost` from `@sculptr/sculptr/runtime` is one. */
export interface PanelHost {
  readonly ui: readonly ModUiState[];
  onUiPatch(handler: (patch: ModUiPatch) => void): void;
  dispatchUi(modId: string, event: UiEvent): void;
}

/**
 * Draws every mod's panels into `container` and keeps them live: patches from the mods update the
 * DOM, and what the player does goes back to the mod that drew it.
 */
export function renderPanels(container: HTMLElement, host: PanelHost): void {
  const doc = container.ownerDocument;
  const mods = new Map<string, Mod>();
  for (const state of host.ui) {
    const mod = new Mod(doc, state, (event) => host.dispatchUi(state.modId, event));
    mods.set(state.modId, mod);
    container.append(mod.root);
  }
  host.onUiPatch((patch) => mods.get(patch.modId)?.apply(patch));
}

class Mod {
  readonly root: HTMLElement;
  readonly #doc: Document;
  readonly #bindings: Record<UiBindingId, UiLiteral>;
  readonly #dispatch: (event: UiEvent) => void;
  /** Each element that reads a binding, and how to bring it up to date. Weak, so a node that left
   *  the tree takes its updater with it; elements are found again through `data-binds`. */
  readonly #updaters = new WeakMap<Element, () => void>();

  constructor(doc: Document, state: ModUiState, dispatch: (event: UiEvent) => void) {
    this.#doc = doc;
    // shortcut: bindings of removed nodes are never dropped (the wire has no message for it); fine
    // until a panel churns through many thousands of rows.
    this.#bindings = { ...state.bindings };
    this.#dispatch = dispatch;
    this.root = doc.createElement("div");
    for (const panel of state.panels) {
      const el = doc.createElement("section");
      const heading = doc.createElement("h2");
      // The mod's name always beside the panel's own title, so a panel cannot pass for the host.
      heading.textContent = `${panel.title} (${state.modId})`;
      el.append(heading, ...panel.root.map((node) => this.#node(node)));
      this.root.append(el);
    }
  }

  apply({ patches }: ModUiPatch): void {
    for (const patch of patches) {
      if (patch.t === "bind") {
        this.#bindings[patch.id] = patch.value;
        this.#refresh(patch.id);
        continue;
      }
      if (patch.t !== "remove") Object.assign(this.#bindings, patch.bindings);
      const fragment = this.root.querySelector(`[data-node="${patch.node}"]`);
      if (!fragment) continue;
      // Follow new lines only when already at the bottom, so a player scrolled up to read stays put.
      const scroll = fragment.closest<HTMLElement>("[data-stick]");
      const follow = scroll && scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1;
      if (patch.t === "replace") {
        fragment.replaceChildren(...patch.children.map((node) => this.#node(node)));
      } else if (patch.t === "insert") {
        const before = fragment.children[patch.at] ?? null;
        for (const node of patch.children) fragment.insertBefore(this.#node(node), before);
      } else {
        for (const child of [...fragment.children].slice(patch.at, patch.at + patch.count)) {
          child.remove();
        }
      }
      if (follow) scroll.scrollTop = scroll.scrollHeight;
    }
  }

  #refresh(binding: UiBindingId): void {
    for (const el of this.root.querySelectorAll(`[data-binds~="${binding}"]`)) {
      this.#updaters.get(el)?.();
    }
  }

  #read<T>(value: unknown, fallback: T): T {
    return uiResolve(value as T | undefined, this.#bindings, fallback);
  }

  /** Runs `update` now and again whenever a binding among `node`'s props moves. */
  #live(el: HTMLElement, node: UiNode, update: () => void): void {
    const ids = Object.values(node)
      .filter((v): v is { $bind: number } => typeof v === "object" && v !== null && "$bind" in v)
      .map((v) => v.$bind);
    if (ids.length > 0) {
      el.dataset.binds = ids.join(" ");
      this.#updaters.set(el, update);
    }
    update();
  }

  /** Writes a two-way control's binding here first, so every other node showing it follows at once,
   *  then tells the mod. */
  #set(binding: UiBindingId | undefined, value: UiLiteral): void {
    if (binding === undefined) return;
    this.#bindings[binding] = value;
    this.#refresh(binding);
    this.#dispatch({ t: "set", binding, value });
  }

  #el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    ...children: Node[]
  ): HTMLElementTagNameMap[K] {
    const el = this.#doc.createElement(tag);
    el.append(...children);
    return el;
  }

  #labelled(node: UiNode & { label?: unknown }, control: HTMLElement): HTMLElement {
    const text = this.#doc.createElement("span");
    const label = this.#el("label", text, control);
    label.style.display = "block";
    this.#live(text, node, () => (text.textContent = `${this.#read(node.label, "")} `));
    return label;
  }

  #node(node: UiNode): HTMLElement {
    const children = () => ("children" in node ? node.children.map((c) => this.#node(c)) : []);
    switch (node.kind) {
      case "fragment": {
        const el = this.#el("div", ...children());
        el.style.display = "contents";
        el.dataset.node = String(node.id);
        return el;
      }
      case "section": {
        const title = this.#doc.createElement(node.collapsible ? "summary" : "h3");
        this.#live(title, node, () => (title.textContent = this.#read(node.title, "")));
        if (!node.collapsible) return this.#el("section", title, ...children());
        const el = this.#el("details", title, ...children());
        el.open = true;
        return el;
      }
      case "row":
      case "col":
      case "grid": {
        const el = this.#el("div", ...children());
        el.style.display = node.kind === "grid" ? "grid" : "flex";
        el.style.gap = "0.5em";
        if (node.kind === "row") {
          el.style.flexWrap = node.wrap === false ? "nowrap" : "wrap";
          el.style.alignItems = "center";
        }
        if (node.kind === "col") el.style.flexDirection = "column";
        if (node.kind === "grid") el.style.gridTemplateColumns = `repeat(${node.columns}, 1fr)`;
        return el;
      }
      case "scroll": {
        const el = this.#el("div", ...children());
        el.style.overflow = "auto";
        if (node.height !== undefined) el.style.height = `${node.height}px`;
        if (node.stickToBottom) el.dataset.stick = "";
        return el;
      }
      case "text": {
        const el = this.#doc.createElement(node.strong ? "strong" : "span");
        el.style.display = "block";
        if (node.tone) el.dataset.tone = node.tone;
        this.#live(el, node, () => (el.textContent = this.#read(node.text, "")));
        return el;
      }
      case "badge": {
        const el = this.#doc.createElement("span");
        if (node.tone) el.dataset.tone = node.tone;
        this.#live(el, node, () => (el.textContent = `[${this.#read(node.label, "")}]`));
        return el;
      }
      case "separator":
        return this.#doc.createElement("hr");
      case "spacer": {
        const el = this.#doc.createElement("div");
        el.style.flex = "1";
        return el;
      }
      case "progress": {
        const bar = this.#doc.createElement("progress");
        this.#live(bar, node, () => {
          bar.value = Math.min(1, Math.max(0, this.#read(node.value, 0)));
        });
        return this.#labelled(node, bar);
      }
      case "button": {
        const el = this.#doc.createElement("button");
        el.type = "button";
        if (node.variant) el.dataset.variant = node.variant;
        el.addEventListener("click", () => this.#dispatch({ t: "click", node: node.id }));
        this.#live(el, node, () => {
          el.textContent = this.#read(node.label, "");
          el.disabled = this.#read(node.disabled, false);
        });
        return el;
      }
      case "toggle": {
        const box = this.#doc.createElement("input");
        box.type = "checkbox";
        box.addEventListener("change", () => {
          this.#set(node.writes, box.checked);
          // A value the mod did not make writable stays what the mod says it is.
          box.checked = this.#read(node.value, false);
        });
        this.#live(box, node, () => {
          box.checked = this.#read(node.value, false);
          box.disabled = this.#read(node.disabled, false);
        });
        return this.#labelled(node, box);
      }
      case "input": {
        const field = this.#doc.createElement(node.multiline ? "textarea" : "input");
        field.addEventListener("input", () => this.#set(node.writes, field.value));
        field.addEventListener("keydown", (event) => {
          if ((event as KeyboardEvent).key === "Enter" && !node.multiline) {
            this.#dispatch({ t: "submit", node: node.id });
          }
        });
        this.#live(field, node, () => {
          const value = this.#read(node.value, "");
          // Rewriting a field while it is being typed in would move the caret.
          if (field.value !== value) field.value = value;
          field.placeholder = this.#read(node.placeholder, "");
          field.disabled = this.#read(node.disabled, false);
        });
        return this.#labelled(node, field);
      }
      case "select": {
        const select = this.#doc.createElement("select");
        select.addEventListener("change", () => this.#set(node.writes, select.value));
        this.#live(select, node, () => {
          const options = this.#read<readonly UiSelectOption[]>(node.options, []);
          select.replaceChildren(
            ...options.map((option) => {
              const el = this.#el("option", this.#doc.createTextNode(option.label));
              el.value = option.value;
              return el;
            }),
          );
          select.value = this.#read(node.value, "");
          select.disabled = this.#read(node.disabled, false);
        });
        return this.#labelled(node, select);
      }
      case "keybind": {
        // Click, then press the key to bind; the next keydown's physical code is the new value.
        const el = this.#doc.createElement("button");
        el.type = "button";
        el.addEventListener("click", () => (el.textContent = "Press a key"));
        el.addEventListener("keydown", (event) => {
          if (el.textContent !== "Press a key") return;
          event.preventDefault();
          this.#set(node.writes, event.code);
          update();
        });
        const update = () => {
          el.textContent = this.#read(node.value, "") || "Unbound";
          el.disabled = this.#read(node.disabled, false);
        };
        this.#live(el, node, update);
        return this.#labelled(node, el);
      }
      default: {
        // A kind newer than this renderer: shown, not thrown, so the rest of the panel still works.
        const el = this.#doc.createElement("div");
        el.dataset.unknown = String((node as { kind: unknown }).kind);
        el.textContent = `[unsupported panel node: ${el.dataset.unknown}]`;
        return el;
      }
    }
  }
}
