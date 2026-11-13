/**
 * One mod's panels: building them, keeping them live, and turning both into wire traffic.
 *
 * The mod describes its UI once, in terms of `Ref`s from `./reactive`. This module walks that
 * description into `UiNode`s, registers a binding for every ref it finds, and installs effects for
 * the two regions that can re-run (`dynamic` and `each`). After that the mod never renders again: a
 * write to a ref reaches the panel as one `bind` patch, and only a structural change produces
 * anything larger.
 *
 * The three-tier split is the whole design, and it is what the panel's cost is made of:
 *
 *   1. A value changed -- one `bind` patch, one node touched, no author code re-run.
 *   2. A collection changed -- `each` re-runs its item function for the keys that actually moved,
 *      and emits `insert`/`remove`.
 *   3. The shape changed -- `dynamic` re-runs its closure and replaces its subtree wholesale, since
 *      a conditional that flipped shares nothing with what it replaced.
 *
 * Nothing here knows what a panel looks like. It produces data; a host draws it.
 */

import type {
  ModUiState,
  UiBindingId,
  UiEvent,
  UiLiteral,
  UiNode,
  UiNodeId,
  UiPanel,
  UiPatch,
  UiSelectOption,
  UiTone,
  UiVariant,
  UiAlign,
  UiGap,
} from "../ui.js";
import type { ModSettings } from "../contract.js";
import { batch, computed, effect, isRef, ref, untracked, type Ref } from "./reactive.js";

/**
 * Anything a node prop will accept: a fixed value, a ref, or a function of other refs.
 *
 * The function form is sugar for `computed`, and worth having because the alternative -- declaring a
 * computed above the tree for every interpolated label -- puts a name on something whose only
 * purpose is to be read once, right there.
 */
export type Bindable<T> = T | Ref<T> | { readonly value: T } | (() => T);

/** What a mod's render function returns, at any depth. */
export type UiSpec = Spec | readonly Spec[];

/** The opaque description a builder call returns. Mods never construct these by hand. */
export type Spec = ElementSpec | DynamicSpec | EachSpec;

interface ElementSpec {
  readonly t: "element";
  readonly kind: UiNode["kind"];
  readonly props: Readonly<Record<string, unknown>>;
  readonly children: readonly Spec[];
}

interface DynamicSpec {
  readonly t: "dynamic";
  readonly fn: () => UiSpec;
}

interface EachSpec {
  readonly t: "each";
  readonly source: Bindable<readonly unknown[]>;
  readonly render: (item: never, index: number) => UiSpec;
  readonly key: (item: never, index: number) => string | number;
}

function flatten(spec: UiSpec): readonly Spec[] {
  return Array.isArray(spec) ? (spec as readonly Spec[]) : [spec as Spec];
}

// -- The builder handed to a mod -----------------------------------------------------------------

export interface UiSectionOptions {
  title?: Bindable<string>;
  collapsible?: boolean;
  grow?: boolean;
}
export interface UiRowOptions {
  align?: UiAlign;
  wrap?: boolean;
  grow?: boolean;
}
export interface UiColOptions {
  gap?: UiGap;
  grow?: boolean;
}
export interface UiScrollOptions {
  grow?: boolean;
  stickToBottom?: boolean;
  /** A fixed height in pixels, so the box is the same size empty as full. See `UiScrollNode`. */
  height?: number;
}
export interface UiTextOptions {
  tone?: UiTone;
  strong?: boolean;
}
export interface UiButtonOptions {
  label: Bindable<string>;
  onClick?: () => void;
  variant?: UiVariant;
  disabled?: Bindable<boolean>;
  grow?: boolean;
}
export interface UiToggleOptions {
  label: Bindable<string>;
  value: Bindable<boolean>;
  onChange?: (value: boolean) => void;
  disabled?: Bindable<boolean>;
}
export interface UiInputOptions {
  value: Bindable<string>;
  label?: Bindable<string>;
  placeholder?: Bindable<string>;
  multiline?: boolean;
  onChange?: (value: string) => void;
  /** Enter in a single-line field, or the button beside it calling the same function. */
  onSubmit?: () => void;
  disabled?: Bindable<boolean>;
  grow?: boolean;
}
export interface UiSelectOptions {
  value: Bindable<string>;
  options: Bindable<readonly UiSelectOption[]>;
  label?: Bindable<string>;
  onChange?: (value: string) => void;
  disabled?: Bindable<boolean>;
}
export interface UiKeybindOptions {
  /** A `KeyboardEvent.code`, two-way when it is a `Ref`. `""` is unbound. */
  value: Bindable<string>;
  label?: Bindable<string>;
  onChange?: (code: string) => void;
  disabled?: Bindable<boolean>;
}

export interface UiEachOptions<T> {
  /**
   * Stable identity for one item.
   *
   * Required rather than defaulted to the index, because the index is wrong in exactly the case this
   * exists for: prepend one chat line and every index shifts, so an index-keyed list re-describes
   * itself entirely and rebinds every handler under it.
   */
  key: (item: T, index: number) => string | number;
}

/** Every node a mod can build. Handed to the panel's render function and to every re-runnable
 *  region inside it, so the same calls are available at any depth. */
export interface UiBuilder {
  section(options: UiSectionOptions, children: UiSpec): Spec;
  row(children: UiSpec, options?: UiRowOptions): Spec;
  col(children: UiSpec, options?: UiColOptions): Spec;
  grid(children: UiSpec, options: { columns: number; grow?: boolean }): Spec;
  scroll(children: UiSpec, options?: UiScrollOptions): Spec;
  text(text: Bindable<string>, options?: UiTextOptions): Spec;
  badge(label: Bindable<string>, options?: { tone?: UiTone }): Spec;
  separator(): Spec;
  spacer(): Spec;
  progress(value: Bindable<number>, options?: { label?: Bindable<string> }): Spec;
  button(options: UiButtonOptions): Spec;
  toggle(options: UiToggleOptions): Spec;
  input(options: UiInputOptions): Spec;
  select(options: UiSelectOptions): Spec;
  /**
   * A key the player can rebind.
   *
   * The one control whose value a mod cannot bake into its GML: the game's code is written before
   * the player has said anything, so anything rebindable has to read a variable the mod sets at run
   * time. See `UiKeybindNode` in the protocol.
   */
  keybind(options: UiKeybindOptions): Spec;
  /** A region that re-runs when anything it reads changes. For conditionals and anything whose
   *  *shape* depends on state. Keep it synchronous -- see the note in `./reactive`. */
  dynamic(fn: () => UiSpec): Spec;
  /** A keyed list. The item function runs per item, untracked, so one item's ref moving does not
   *  re-run the list. */
  each<T>(
    source: Bindable<readonly T[]>,
    render: (item: T, index: number) => UiSpec,
    options: UiEachOptions<T>,
  ): Spec;
}

const element = (
  kind: UiNode["kind"],
  props: Record<string, unknown>,
  children: UiSpec = [],
): Spec => ({ t: "element", kind, props, children: flatten(children) });

export const builder: UiBuilder = {
  section: (options, children) => element("section", { ...options }, children),
  row: (children, options) => element("row", { wrap: true, ...options }, children),
  col: (children, options) => element("col", { ...options }, children),
  grid: (children, options) => element("grid", { ...options }, children),
  scroll: (children, options) => element("scroll", { ...options }, children),
  text: (text, options) => element("text", { text, ...options }),
  badge: (label, options) => element("badge", { label, ...options }),
  separator: () => element("separator", {}),
  spacer: () => element("spacer", {}),
  progress: (value, options) => element("progress", { value, ...options }),
  button: (options) => element("button", { ...options }),
  toggle: (options) => element("toggle", { ...options }),
  input: (options) => element("input", { ...options }),
  select: (options) => element("select", { ...options }),
  keybind: (options) => element("keybind", { ...options }),
  dynamic: (fn) => ({ t: "dynamic", fn }),
  each: (source, render, options) => ({
    t: "each",
    source: source as Bindable<readonly unknown[]>,
    render: render as (item: never, index: number) => UiSpec,
    key: options.key as (item: never, index: number) => string | number,
  }),
};

// -- The live session ----------------------------------------------------------------------------

/** Props that carry a callback rather than a value, stripped before a node goes on the wire. */
const HANDLER_PROPS = new Set(["onClick", "onChange", "onSubmit"]);
/** Props whose ref the host is allowed to write back into. */
const WRITABLE_PROP: Partial<Record<UiNode["kind"], string>> = {
  toggle: "value",
  input: "value",
  select: "value",
  keybind: "value",
};

interface Handlers {
  click?: () => void;
  change?: (value: UiLiteral) => void;
  submit?: () => void;
}

/** Effects, nodes and bindings owned by one re-runnable region, torn down when it re-runs. */
interface Scope {
  disposers: (() => void)[];
  nodes: UiNodeId[];
  /** Every binding this scope referred to, once per reference. Refcounted rather than owned -- see
   *  `#bind`. */
  bindings: UiBindingId[];
}

export interface UiSessionOptions {
  modId: string;
  /** Persisted settings as the host handed them down, already resolved. Never fetched from here:
   *  see `ModSettingsStore` in the index for why that is the installer's job. */
  settings: ModSettings;
  /** Called when a persisted ref changes. Debouncing and storage are the host's business. */
  onSettings: (settings: ModSettings) => void;
  /** Called with each batch of patches, once per microtask. */
  onPatch: (patches: readonly UiPatch[]) => void;
  /** Where a mod's own mistakes are reported. */
  onError: (error: unknown, what: string) => void;
}

export interface UiStateOptions {
  /** Persist under this key in the mod's own settings bag. Read back before the first render. */
  persist?: string;
}

export class UiSession {
  readonly #options: UiSessionOptions;
  readonly #panels: UiPanel[] = [];
  /** One binding per ref, for the mod's lifetime. Shared between every node that reads it, so one
   *  write is one patch however many places show the value. Never torn down: a ref the mod still
   *  holds can come back into the tree at any time, and re-registering it would renumber it. */
  readonly #bindings = new Map<object, UiBindingId>();
  readonly #bindingValues = new Map<UiBindingId, UiLiteral>();
  /** What keeps a binding alive: how many places in the tree still refer to it, and how to stop
   *  watching when none do. */
  readonly #bindingRefs = new Map<UiBindingId, { key: object; stop: () => void; count: number }>();
  readonly #writers = new Map<UiBindingId, (value: UiLiteral) => void>();
  readonly #handlers = new Map<UiNodeId, Handlers>();
  readonly #persisted = new Map<string, Ref<unknown>>();
  #nextNode = 1;
  #nextBinding = 1;
  #pending: UiPatch[] = [];
  #flushQueued = false;
  /** Set while a structural region rebuilds, so bindings it introduces ride along with its patch
   *  instead of arriving after the nodes that refer to them. */
  #collecting: Record<UiBindingId, UiLiteral> | null = null;
  #declaring = true;

  constructor(options: UiSessionOptions) {
    this.#options = options;
  }

  /** A reactive value. `persist` makes it survive the session, in the mod's own settings bag. */
  state<T>(initial: T, options: UiStateOptions = {}): Ref<T> {
    const stored =
      options.persist !== undefined && Object.hasOwn(this.#options.settings, options.persist)
        ? (this.#options.settings[options.persist] as T)
        : initial;
    const value = ref(stored);
    if (options.persist !== undefined) {
      const key = options.persist;
      if (this.#persisted.has(key)) {
        throw new Error(`two of this mod's values both persist under ${JSON.stringify(key)}`);
      }
      this.#persisted.set(key, value as Ref<unknown>);
      // Skips its own first run: reading the value back and immediately writing it again would mark
      // every mod's settings dirty at load, for no change.
      let first = true;
      effect(() => {
        const next = value.value;
        if (first) {
          first = false;
          return;
        }
        this.#options.settings[key] = next;
        this.#options.onSettings({ ...this.#options.settings });
      });
    }
    return value;
  }

  /** Declares a panel. Only during `activate()`, like every other thing a mod declares. */
  panel(options: { id?: string; title: string }, render: (ui: UiBuilder) => UiSpec): void {
    if (!this.#declaring) {
      throw new Error("panels can only be declared during activate()");
    }
    const id = options.id ?? `panel-${this.#panels.length + 1}`;
    if (this.#panels.some((panel) => panel.id === id)) {
      throw new Error(`this mod already has a panel called ${JSON.stringify(id)}`);
    }
    // Built once, here. What keeps it live afterwards is the effects this installs, not another call
    // to `render` -- which is why a mod never has to know when its panel is on screen.
    const scope: Scope = { disposers: [], nodes: [], bindings: [] };
    const root = flatten(render(builder)).map((spec) => this.#materialize(spec, scope));
    this.#panels.push({ id, title: options.title, root });
  }

  /** Closes declaration. Called by the host once `activate()` returns. */
  sealed(): void {
    this.#declaring = false;
  }

  /** Everything this mod's UI is right now, for a host that has just connected. */
  get snapshot(): ModUiState {
    return {
      modId: this.#options.modId,
      panels: this.#panels,
      bindings: Object.fromEntries(this.#bindingValues),
    };
  }

  get hasPanels(): boolean {
    return this.#panels.length > 0;
  }

  /**
   * Applies something the player did.
   *
   * Batched, so a control that writes a ref *and* runs a handler that writes three more produces one
   * round of patches rather than four.
   */
  dispatch(event: UiEvent): void {
    batch(() => {
      try {
        if (event.t === "set") {
          const write = this.#writers.get(event.binding);
          if (write) write(event.value);
          const handlers = this.#changeHandlerFor(event.binding);
          if (handlers) handlers(event.value);
          return;
        }
        const handlers = this.#handlers.get(event.node);
        if (!handlers) return;
        if (event.t === "click") handlers.click?.();
        else handlers.submit?.();
      } catch (error) {
        // A mod throwing from a button must not take down the panel, let alone the page the game is
        // running in. Reported and dropped, like every other mod callback this host makes.
        this.#options.onError(error, `handling a ${event.t}`);
      }
    });
  }

  /** Change handlers live per node, but a `set` arrives addressed to a binding -- the one the
   *  control writes. Resolved here rather than stored twice. */
  readonly #changeByBinding = new Map<UiBindingId, (value: UiLiteral) => void>();
  #changeHandlerFor(binding: UiBindingId): ((value: UiLiteral) => void) | undefined {
    return this.#changeByBinding.get(binding);
  }

  // -- Building ----------------------------------------------------------------------------------

  #materialize(spec: Spec, scope: Scope): UiNode {
    if (spec.t === "dynamic") return this.#materializeDynamic(spec, scope);
    if (spec.t === "each") return this.#materializeEach(spec, scope);

    const id = this.#nextNode++;
    scope.nodes.push(id);
    const node: Record<string, unknown> = { id, kind: spec.kind };
    const handlers: Handlers = {};

    for (const [name, value] of Object.entries(spec.props)) {
      if (value === undefined) continue;
      if (HANDLER_PROPS.has(name)) {
        if (typeof value !== "function") continue;
        if (name === "onClick") handlers.click = value as () => void;
        else if (name === "onSubmit") handlers.submit = value as () => void;
        else handlers.change = value as (value: UiLiteral) => void;
        continue;
      }
      node[name] = this.#bind(value, scope);
    }

    // The control's own value is what the host writes back to, and only when it is a ref it can
    // actually write -- a value derived with `computed` renders and stays read-only.
    const writable = WRITABLE_PROP[spec.kind];
    if (writable !== undefined) {
      const source = spec.props[writable];
      const binding = this.#writableBinding(source);
      if (binding !== null) {
        node.writes = binding;
        if (handlers.change) this.#changeByBinding.set(binding, handlers.change);
      }
    }

    if (Object.keys(handlers).length > 0) this.#handlers.set(id, handlers);
    if (CONTAINERS.has(spec.kind)) {
      node.children = spec.children.map((child) => this.#materialize(child, scope));
    }
    return node as unknown as UiNode;
  }

  #materializeDynamic(spec: DynamicSpec, parent: Scope): UiNode {
    const id = this.#nextNode++;
    parent.nodes.push(id);
    const node = { id, kind: "fragment", children: [] as UiNode[] } as {
      id: UiNodeId;
      kind: "fragment";
      children: UiNode[];
    };
    let inner: Scope = { disposers: [], nodes: [], bindings: [] };
    let first = true;

    const stop = effect(() => {
      // Tracked: this is what decides when the region re-runs. Everything downstream of it is not --
      // see the untracked call below.
      let specs: readonly Spec[];
      try {
        specs = flatten(spec.fn());
      } catch (error) {
        this.#options.onError(error, "rendering a dynamic region");
        specs = [];
      }
      untracked(() => {
        if (!first) this.#disposeScope(inner);
        inner = { disposers: [], nodes: [], bindings: [] };
        const collected = first ? null : this.#beginCollecting();
        node.children = specs.map((child) => this.#materialize(child, inner));
        if (!first) {
          this.#endCollecting();
          this.#queue({
            t: "replace",
            node: id,
            children: node.children,
            ...(collected && Object.keys(collected).length > 0 ? { bindings: collected } : {}),
          });
        }
      });
      first = false;
    });
    parent.disposers.push(() => {
      stop();
      this.#disposeScope(inner);
    });
    return node;
  }

  #materializeEach(spec: EachSpec, parent: Scope): UiNode {
    const id = this.#nextNode++;
    parent.nodes.push(id);
    const node = { id, kind: "fragment", children: [] as UiNode[] } as {
      id: UiNodeId;
      kind: "fragment";
      children: UiNode[];
    };
    /** One entry per key, so a re-run reuses the nodes -- and the handlers bound to them -- for every
     *  item that is still there. */
    let entries: { key: string; node: UiNode; scope: Scope }[] = [];
    let first = true;
    const read = toGetter(spec.source);

    const stop = effect(() => {
      let items: readonly unknown[];
      try {
        items = read() ?? [];
      } catch (error) {
        this.#options.onError(error, "reading an each() source");
        items = [];
      }
      untracked(() => {
        const previous = new Map(entries.map((entry) => [entry.key, entry]));
        const next: typeof entries = [];
        const collected = first ? null : this.#beginCollecting();
        const seen = new Set<string>();

        items.forEach((item, index) => {
          const key = String(spec.key(item as never, index));
          if (seen.has(key)) {
            // Two items under one key would make every later diff wrong -- the second would reuse
            // the first's nodes and then fight it. Said once, and the duplicate is rendered fresh.
            this.#options.onError(
              new Error(`each() produced the key ${JSON.stringify(key)} twice`),
              "keying a list",
            );
          }
          seen.add(key);
          const existing = previous.get(key);
          if (existing) {
            next.push(existing);
            // Taken out so a duplicate key cannot claim the same nodes twice, and so whatever is
            // left at the end is exactly what dropped out of the list.
            previous.delete(key);
            return;
          }
          const scope: Scope = { disposers: [], nodes: [], bindings: [] };
          const rendered = flatten(spec.render(item as never, index));
          // One node per item, so the diff has something to address. A render returning several gets
          // them wrapped in a fragment of their own.
          const built =
            rendered.length === 1
              ? this.#materialize(rendered[0]!, scope)
              : this.#wrap(rendered, scope);
          next.push({ key, node: { ...built, key } as UiNode, scope });
        });

        // Whatever is left in `previous` is gone from the list.
        for (const dropped of previous.values()) this.#disposeScope(dropped.scope);

        if (first) {
          node.children = next.map((entry) => entry.node);
          entries = next;
          first = false;
          return;
        }
        const patches = diffKeyed(id, entries, next);
        this.#endCollecting();
        node.children = next.map((entry) => entry.node);
        entries = next;
        for (const [index, patch] of patches.entries()) {
          // The bindings ride on the first patch that carries nodes; by the second they are already
          // in the host's table.
          this.#queue(
            index === 0 && patch.t === "insert" && collected && Object.keys(collected).length > 0
              ? { ...patch, bindings: collected }
              : patch,
          );
        }
        if (collected && !patches.some((patch) => patch.t === "insert")) {
          for (const [binding, value] of Object.entries(collected)) {
            this.#queue({ t: "bind", id: Number(binding), value });
          }
        }
      });
    });
    parent.disposers.push(() => {
      stop();
      for (const entry of entries) this.#disposeScope(entry.scope);
    });
    return node;
  }

  #wrap(specs: readonly Spec[], scope: Scope): UiNode {
    const id = this.#nextNode++;
    scope.nodes.push(id);
    return {
      id,
      kind: "fragment",
      children: specs.map((child) => this.#materialize(child, scope)),
    };
  }

  #disposeScope(scope: Scope): void {
    for (const dispose of scope.disposers) dispose();
    scope.disposers.length = 0;
    for (const id of scope.nodes) this.#handlers.delete(id);
    scope.nodes.length = 0;
    for (const id of scope.bindings) {
      const entry = this.#bindingRefs.get(id);
      if (!entry) continue;
      entry.count -= 1;
      if (entry.count > 0) continue;
      // Nothing in the tree reads it any more. Stopping the effect is what keeps a long chat from
      // accruing one watcher per row ever rendered -- a row's interpolated label is a fresh function
      // every time, so it is a fresh binding every time too.
      entry.stop();
      this.#bindingRefs.delete(id);
      this.#bindings.delete(entry.key);
      this.#bindingValues.delete(id);
      this.#writers.delete(id);
    }
    scope.bindings.length = 0;
  }

  // -- Bindings ----------------------------------------------------------------------------------

  /**
   * Turns one prop into something that can cross: a literal as itself, anything live as a binding.
   *
   * A ref gets the same binding every time it appears, so a value shown in three places is one entry
   * in the table and one patch when it moves.
   */
  #bind(value: unknown, scope: Scope): unknown {
    const source = toLive(value);
    if (!source) return value;
    const existing = this.#bindings.get(source.key);
    if (existing !== undefined) {
      // Shared rather than duplicated: one value shown in three places is one binding and one patch.
      // Counted per reference so the last of the three leaving is what ends it, not the first.
      this.#bindingRefs.get(existing)!.count += 1;
      scope.bindings.push(existing);
      return { $bind: existing };
    }

    const id = this.#nextBinding++;
    this.#bindings.set(source.key, id);
    let first = true;
    const stop = effect(() => {
      let next: UiLiteral;
      try {
        next = source.read() as UiLiteral;
      } catch (error) {
        this.#options.onError(error, "reading a bound value");
        next = null;
      }
      this.#bindingValues.set(id, next);
      if (first) {
        first = false;
        if (this.#collecting) this.#collecting[id] = next;
        return;
      }
      this.#queue({ t: "bind", id, value: next });
    });
    this.#bindingRefs.set(id, { key: source.key, stop, count: 1 });
    scope.bindings.push(id);
    return { $bind: id };
  }

  /** The binding the host may write back into, or null when this control's value is not writable. */
  #writableBinding(value: unknown): UiBindingId | null {
    if (!isRef(value)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, "value");
    if (!descriptor?.set) return null;
    const id = this.#bindings.get(value as object);
    if (id === undefined) return null;
    if (!this.#writers.has(id)) {
      this.#writers.set(id, (next) => {
        (value as Ref<unknown>).value = next;
      });
    }
    return id;
  }

  #beginCollecting(): Record<UiBindingId, UiLiteral> {
    this.#collecting = {};
    return this.#collecting;
  }

  #endCollecting(): void {
    this.#collecting = null;
  }

  // -- Flushing ----------------------------------------------------------------------------------

  #queue(patch: UiPatch): void {
    this.#pending.push(patch);
    if (this.#flushQueued) return;
    this.#flushQueued = true;
    // A microtask, so everything one message handler or one click produced leaves together. The
    // reactive flush is itself a microtask queued before this one, so by the time this runs the
    // effects it triggered have already added their patches.
    queueMicrotask(() => {
      this.#flushQueued = false;
      if (this.#pending.length === 0) return;
      const batchToSend = this.#pending;
      this.#pending = [];
      try {
        this.#options.onPatch(batchToSend);
      } catch (error) {
        this.#options.onError(error, "delivering UI patches");
      }
    });
  }
}

const CONTAINERS = new Set<UiNode["kind"]>(["fragment", "section", "row", "col", "grid", "scroll"]);

/** A prop that changes over time, reduced to one identity and one read. */
function toLive(value: unknown): { key: object; read: () => unknown } | null {
  if (isRef(value)) return { key: value as object, read: () => (value as Ref<unknown>).value };
  if (typeof value === "function") {
    // Wrapped in a computed so that two nodes reading the same function-shaped prop still share one
    // binding, and so the read is cached between them.
    const derived = computed(value as () => unknown);
    return { key: value as object, read: () => derived.value };
  }
  return null;
}

function toGetter<T>(source: Bindable<readonly T[]>): () => readonly T[] {
  if (isRef(source)) return () => (source as Ref<readonly T[]>).value;
  if (typeof source === "function") return source as () => readonly T[];
  return () => source as readonly T[];
}

/**
 * The smallest set of insert/remove patches taking one keyed list to another.
 *
 * Moves are expressed as a remove and an insert rather than as an op of their own. Reordering a
 * panel's list is rare -- appending to one is not -- and the op that would make it cheap is one more
 * thing for every renderer to implement correctly.
 */
export function diffKeyed(
  node: UiNodeId,
  before: readonly { key: string; node: UiNode }[],
  after: readonly { key: string; node: UiNode }[],
): UiPatch[] {
  const patches: UiPatch[] = [];
  const wanted = new Set(after.map((entry) => entry.key));
  const working = [...before];

  // Removals first, back to front, so each index is still valid when its patch is applied.
  for (let index = working.length - 1; index >= 0; index -= 1) {
    if (wanted.has(working[index]!.key)) continue;
    let count = 1;
    while (index - count >= 0 && !wanted.has(working[index - count]!.key)) count += 1;
    const at = index - count + 1;
    patches.push({ t: "remove", node, at, count });
    working.splice(at, count);
    index = at;
  }

  // Then insertions, front to back, coalescing runs of new neighbours into one patch.
  let cursor = 0;
  while (cursor < after.length) {
    const entry = after[cursor]!;
    if (working[cursor]?.key === entry.key) {
      cursor += 1;
      continue;
    }
    const existing = working.findIndex((one) => one.key === entry.key);
    if (existing >= 0) {
      // Out of order: take it out and let the insertion below put it back where it belongs.
      patches.push({ t: "remove", node, at: existing, count: 1 });
      working.splice(existing, 1);
      continue;
    }
    const run: { key: string; node: UiNode }[] = [];
    let scan = cursor;
    while (scan < after.length && !working.some((one) => one.key === after[scan]!.key)) {
      run.push(after[scan]!);
      scan += 1;
    }
    patches.push({
      t: "insert",
      node,
      at: cursor,
      children: run.map((one) => one.node),
    });
    working.splice(cursor, 0, ...run);
    cursor = scan;
  }
  return patches;
}
