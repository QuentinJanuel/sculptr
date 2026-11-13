/**
 * A mod's own panel: what it looks like on the wire.
 *
 * Mods need settings and status -- a "share saves" toggle, a channel name -- and a host that
 * answered each by growing a field or a checkbox of its own would not scale past the mods it was
 * written alongside, and could not work at all for a community mod. So a mod brings its own UI, and
 * a host renders it without knowing what it is for.
 *
 * **Everything here is structured-clonable, and that is the constraint that shaped it.** A mod's
 * JavaScript never runs in the document its panel is drawn in: while a game is emulated the mod is
 * in the player iframe and the panel is in the play page; on a native install the mod is in a
 * hidden renderer and the panel is in another window entirely -- a different process,
 * where the only thing that crosses is a clone. So a panel is data, not DOM and not a callback tree:
 * the mod describes it, the host renders it with its own components, and the two exchange patches and
 * events by value.
 *
 * That is also why there is no styling here. A node says what it *is* (`section`, `toggle`,
 * `danger`), never how it looks -- no colours, no sizes, no CSS. The host owns the appearance, which
 * is what lets one panel render into a 22rem sidebar, a phone-width sheet and a desktop side window
 * without its author having considered any of them, and what lets the host be restyled later without
 * every published mod going stale.
 */

/** Identifies one node within a mod's UI. Assigned by the mod side; unique per mod, not per panel. */
export type UiNodeId = number;

/**
 * Identifies one reactive value.
 *
 * The indirection is what makes a live panel cheap across a process boundary: a node referring to a
 * binding is sent once, and a change afterwards is `{ t: "bind", id, value }` -- a few dozen bytes --
 * rather than a re-description of the tree. The host keeps a binding table and resolves node props
 * through it, so one patch updates every node that reads the value, however many there are.
 */
export type UiBindingId = number;

/** Everything a binding is allowed to hold. Deliberately JSON-ish: it crosses a clone boundary. */
export type UiLiteral = string | number | boolean | null | readonly UiSelectOption[];

/** A node prop: either a fixed value, or a reference into the binding table. */
export type UiBound<T> = T | { readonly $bind: UiBindingId };

/** Reads a possibly-bound prop against a binding table. The one place either side resolves one. */
export function uiResolve<T>(
  value: UiBound<T> | undefined,
  bindings: Readonly<Record<UiBindingId, UiLiteral>>,
  fallback: T,
): T {
  if (value === undefined) return fallback;
  if (typeof value === "object" && value !== null && "$bind" in value) {
    const bound = bindings[(value as { $bind: UiBindingId }).$bind];
    return bound === undefined ? fallback : (bound as T);
  }
  return value as T;
}

/**
 * How much a piece of text is trying to say. Named by meaning rather than by colour, so the host
 * picks what "danger" looks like -- and picks differently in its dark play-page theatre than it
 * would on a light page.
 */
export type UiTone = "normal" | "muted" | "ok" | "warning" | "danger";

/** A button's weight. Same reasoning as `UiTone`: an enumeration, never a colour. */
export type UiVariant = "normal" | "primary" | "danger" | "ghost";

export type UiGap = "none" | "small" | "normal" | "large";
export type UiAlign = "start" | "center" | "end" | "between";

interface UiNodeBase {
  readonly id: UiNodeId;
  /**
   * Set only on the direct children of an `each` fragment, where it is the author's own key.
   *
   * It exists so appending one chat line is one `insert` patch rather than a re-description of the
   * list, and so the handlers already bound to the lines above it keep pointing at the same nodes.
   */
  readonly key?: string;
}

/**
 * A wrapper that renders nothing of its own -- only its children, in place.
 *
 * Every re-runnable region is one of these: `dynamic` and `each` both produce a fragment, and every
 * structural patch addresses one. A node with no appearance is what lets the mod side re-run part of
 * a tree without the host growing a stray box around it.
 */
export interface UiFragmentNode extends UiNodeBase {
  readonly kind: "fragment";
  readonly children: readonly UiNode[];
}

/** The primary grouping: a titled card. Vertical inside, so most panels never name a direction. */
export interface UiSectionNode extends UiNodeBase {
  readonly kind: "section";
  readonly title?: UiBound<string>;
  /** Lets the player fold it away. The fold state is the host's, not the mod's -- a mod has no
   *  business knowing, and would only be able to disagree with what is on screen. */
  readonly collapsible?: boolean;
  readonly grow?: boolean;
  readonly children: readonly UiNode[];
}

export interface UiRowNode extends UiNodeBase {
  readonly kind: "row";
  readonly align?: UiAlign;
  /** Defaults to true: the panel is narrow and its width is not something a mod can know. */
  readonly wrap?: boolean;
  readonly grow?: boolean;
  readonly children: readonly UiNode[];
}

export interface UiColNode extends UiNodeBase {
  readonly kind: "col";
  readonly gap?: UiGap;
  readonly grow?: boolean;
  readonly children: readonly UiNode[];
}

export interface UiGridNode extends UiNodeBase {
  readonly kind: "grid";
  /** A maximum, not a promise: the host drops to fewer when there is no room for this many. */
  readonly columns: number;
  readonly grow?: boolean;
  readonly children: readonly UiNode[];
}

/** The one container that absorbs leftover height and scrolls. What a chat log is made of. */
export interface UiScrollNode extends UiNodeBase {
  readonly kind: "scroll";
  readonly grow?: boolean;
  /** Keep the bottom in view as children arrive, unless the player has scrolled up to read. */
  readonly stickToBottom?: boolean;
  /**
   * A fixed height in pixels, rather than however tall its contents happen to be.
   *
   * For a box whose whole job is to hold a growing list -- a chat log, a run of events -- where the
   * panel jumping about as lines arrive is worse than the space an empty box costs. The box keeps
   * this height whether it holds nothing or a hundred lines.
   */
  readonly height?: number;
  readonly children: readonly UiNode[];
}

export interface UiTextNode extends UiNodeBase {
  readonly kind: "text";
  readonly text: UiBound<string>;
  readonly tone?: UiTone;
  readonly strong?: boolean;
}

export interface UiBadgeNode extends UiNodeBase {
  readonly kind: "badge";
  readonly label: UiBound<string>;
  readonly tone?: UiTone;
}

export interface UiSeparatorNode extends UiNodeBase {
  readonly kind: "separator";
}

export interface UiSpacerNode extends UiNodeBase {
  readonly kind: "spacer";
}

export interface UiProgressNode extends UiNodeBase {
  readonly kind: "progress";
  /** 0..1, clamped by the host. */
  readonly value: UiBound<number>;
  readonly label?: UiBound<string>;
}

export interface UiButtonNode extends UiNodeBase {
  readonly kind: "button";
  readonly label: UiBound<string>;
  readonly variant?: UiVariant;
  readonly disabled?: UiBound<boolean>;
  readonly grow?: boolean;
}

export interface UiToggleNode extends UiNodeBase {
  readonly kind: "toggle";
  readonly label: UiBound<string>;
  readonly value: UiBound<boolean>;
  /**
   * The binding the host writes when the player changes this, when there is one.
   *
   * Separate from `value` because the two are not the same question: `value` may be bound to
   * something derived, which the host must render and must not write to. A control with no `writes`
   * still reports the interaction, so the mod can decide for itself.
   */
  readonly writes?: UiBindingId;
  readonly disabled?: UiBound<boolean>;
}

export interface UiInputNode extends UiNodeBase {
  readonly kind: "input";
  readonly label?: UiBound<string>;
  readonly value: UiBound<string>;
  readonly writes?: UiBindingId;
  /** Bound like every other label, so a mod whose words depend on the player's language can move it
   *  without redescribing the field. */
  readonly placeholder?: UiBound<string>;
  readonly multiline?: boolean;
  readonly disabled?: UiBound<boolean>;
  readonly grow?: boolean;
}

export interface UiSelectOption {
  readonly value: string;
  readonly label: string;
}

export interface UiSelectNode extends UiNodeBase {
  readonly kind: "select";
  readonly label?: UiBound<string>;
  readonly value: UiBound<string>;
  readonly writes?: UiBindingId;
  readonly options: UiBound<readonly UiSelectOption[]>;
  readonly disabled?: UiBound<boolean>;
}

/**
 * A key the player can rebind.
 *
 * **The only control whose value a mod cannot bake in.** A mod's GML is written when the game is
 * patched or loaded, so `keyboard_check_pressed(ord("H"))` fixes that key forever; anything
 * rebindable has to read a variable the mod sets at run time instead. The panel is what moves it,
 * and this node is how the player says so.
 *
 * The value is a `KeyboardEvent.code` -- the *physical* key, so a binding made on AZERTY stays
 * under the same finger rather than following the letter printed on it. `""` means unbound.
 * Naming it for a person is the host's job; translating it into the number GameMaker wants is the
 * mod's, since only the mod knows it is talking to GML.
 */
export interface UiKeybindNode extends UiNodeBase {
  readonly kind: "keybind";
  readonly label?: UiBound<string>;
  /** A `KeyboardEvent.code`, or `""` when nothing is bound. */
  readonly value: UiBound<string>;
  readonly writes?: UiBindingId;
  readonly disabled?: UiBound<boolean>;
}

/**
 * Every node kind there is.
 *
 * Small on purpose, and there is no raw-HTML member. A mod that could ship markup and CSS would make
 * a host's design tokens a public API -- it could never be restyled again without
 * breaking published mods -- and it would not even buy the author the host's look, only the job of
 * reimplementing it. The escape hatch, when something genuinely needs one, is a node that carries
 * pixels (an `ImageBitmap` clones fine), not one that carries markup.
 */
export type UiNode =
  | UiFragmentNode
  | UiSectionNode
  | UiRowNode
  | UiColNode
  | UiGridNode
  | UiScrollNode
  | UiTextNode
  | UiBadgeNode
  | UiSeparatorNode
  | UiSpacerNode
  | UiProgressNode
  | UiButtonNode
  | UiToggleNode
  | UiInputNode
  | UiSelectNode
  | UiKeybindNode;

/** The children of any node that has them, or an empty list. Saves every walker a switch. */
export function uiChildren(node: UiNode): readonly UiNode[] {
  return "children" in node ? node.children : [];
}

/** Every node in a tree, parents before children. */
export function* walkUi(nodes: readonly UiNode[]): Generator<UiNode> {
  for (const node of nodes) {
    yield node;
    yield* walkUi(uiChildren(node));
  }
}

/**
 * One panel a mod contributes. A mod may declare several; the host stacks them under its name.
 *
 * `title` is the panel's own, and the host always renders the *mod's* name alongside it. That is a
 * small anti-impersonation measure rather than decoration: nothing a mod can put in a panel should
 * be able to pass as a prompt from the host itself.
 */
export interface UiPanel {
  readonly id: string;
  readonly title: string;
  readonly root: readonly UiNode[];
}

/** Everything one mod's UI is, at the moment it is handed over. */
export interface ModUiState {
  readonly modId: string;
  readonly panels: readonly UiPanel[];
  readonly bindings: Readonly<Record<UiBindingId, UiLiteral>>;
}

/**
 * One change to a mod's UI.
 *
 * `bind` is the overwhelmingly common one, and the only one a value change produces. The structural
 * three exist for the two re-runnable regions: `replace` is what a `dynamic` emits (its whole
 * subtree, since a conditional that flipped shares nothing with what it replaced), while `insert`
 * and `remove` are what an `each` emits, keyed, so a chat line appended to five hundred of them
 * costs one message.
 *
 * The two that carry nodes also carry `bindings`, because nodes arriving after the initial state can
 * refer to bindings the host has never seen a value for -- a chat line whose text is derived, say.
 * Sending them with the nodes rather than as separate `bind` patches is what keeps a newly inserted
 * row from rendering one frame of fallback before its values catch up.
 */
export type UiPatch =
  | { readonly t: "bind"; readonly id: UiBindingId; readonly value: UiLiteral }
  | {
      readonly t: "replace";
      readonly node: UiNodeId;
      readonly children: readonly UiNode[];
      /** Values for bindings these nodes introduce -- see the note below. */
      readonly bindings?: Readonly<Record<UiBindingId, UiLiteral>>;
    }
  | {
      readonly t: "insert";
      readonly node: UiNodeId;
      readonly at: number;
      readonly children: readonly UiNode[];
      readonly bindings?: Readonly<Record<UiBindingId, UiLiteral>>;
    }
  | { readonly t: "remove"; readonly node: UiNodeId; readonly at: number; readonly count: number };

/** A batch of patches for one mod. Batched because ten writes in one message handler are one frame's
 *  worth of change, and ten round trips would be a waste of a process boundary. */
export interface ModUiPatch {
  readonly modId: string;
  readonly patches: readonly UiPatch[];
}

/**
 * Something the player did, travelling the other way.
 *
 * `set` carries the binding rather than the node because that is what a two-way control writes, and
 * because the host applies it optimistically before sending -- the mod writing the same value back
 * then produces no patch at all, which is what keeps a text field from fighting the person typing
 * in it.
 */
export type UiEvent =
  | { readonly t: "click"; readonly node: UiNodeId }
  | { readonly t: "submit"; readonly node: UiNodeId }
  | { readonly t: "set"; readonly binding: UiBindingId; readonly value: UiLiteral };
