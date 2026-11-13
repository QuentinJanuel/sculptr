/**
 * The mod contract: who a mod is, what it is installed into, the player's controls, the files and
 * settings a host keeps for it, and what a patched game and the JS mod host agree on -- the loader's
 * runtime object, each mod's mailbox, and when a patched game is out of date.
 *
 * What a mod installs and what it reads of the game are in `./resources` and `./game-code`; how a
 * patched game reaches its host is in `./channel`.
 *
 * Engine-neutral on purpose. Everything here has to mean the same thing to both GameMaker families
 * and to every host, so nothing in this file may name a GameMaker version, an event number, or a
 * transport.
 */

import type { ObjectResource, Resource } from "./resources.js";

/**
 * Who a mod is: the identity a host installs it under.
 *
 * **Supplied by the installer, never declared by the mod.** The same argument this file already
 * makes for `ModTarget` -- only the side doing the installing knows what a mod is being installed
 * *into* -- applies just as well to what it is installed *as*. A published mod's identity is its
 * npm coordinates, which the registry already guarantees to be unique and to change on every
 * publish; an unpublished one gets an identity from whatever the host loaded it from. Neither is a
 * fact the mod's own bundle is in a position to state, and a mod that stated it anyway could only
 * ever disagree with the registry that published it.
 *
 * This also means a mod no longer declares a contract version. There is exactly one version of this
 * contract, and a bundle that predates a future break is distinguishable without a marker: absence
 * is the marker, so a host that ever has to tell two contracts apart can require a positive one
 * from the newer and read its absence as everything published before it.
 *
 * (For the record, since the note it replaces is gone: the last break moved the channel. A mod's
 * GML used to call the `mod_receive()` builtin itself, which pops one shared queue -- so two mods
 * that both listened stole each other's messages. The loader now installs one object that drains
 * the builtins and sorts each message into the mailbox of the mod it is addressed to, see
 * `loaderRuntime`, and a mod reaches its own mailbox through the GML `ModApi.gml` hands it.)
 */
export interface ModIdentity {
  /**
   * Globally unique, and the key other mods depend on. For a published mod this is its npm package
   * name; for one loaded straight from a URL, something derived from that URL.
   *
   * It is hashed into the mod's wire channel (`modChannel`) and, by the mod library, into the names
   * its resources install under -- so two mods sharing one are not a cosmetic clash.
   */
  id: string;
  /** npm's version for a published mod. Only ever compared, never parsed: see `modBuildStamp`. */
  version: string;
}

/**
 * Where one mod's bundle lives, and who it is.
 *
 * The pair travels together everywhere a mod is named before it is run -- a player's stored ticks,
 * a native install's record of its last launch, `importMods` -- because the URL is the only half a
 * bundle can answer for itself, and losing the other half is not something that fails loudly: the
 * GML baked into a patched game addresses a channel derived from the id, so a mod loaded under the
 * wrong one simply never hears from the game.
 */
export interface ModSource extends ModIdentity {
  url: string;
}

/**
 * Which engine a mod is being installed into.
 *
 * Mods declare GML, and GML is not one language: GameMaker 8 and GameMaker Studio disagree about
 * enough of it that a mod which writes for one can be invalid in the other. A mod therefore has to
 * be told what it is targeting, and told it *before* it declares anything -- which is exactly when
 * `activate()` runs.
 *
 * Two values rather than a finer version, because these two are the split that is both meaningful
 * and always answerable. Telling GameMaker Studio 1.4 from GameMaker Studio 2 also matters for
 * dialect (`layer_*` is 2-only; 1.4 cannot call `variable_global_exists`), but it is read from the
 * bytecode version inside `data.win`, which a self-contained export does not surrender without
 * being unpacked first. Widening this later is additive: a mod that switches on `"gms"` keeps
 * compiling when a `"gms2"` is added beside it only if it is written as a switch with a default,
 * which is why mods should treat an unrecognised engine as "do nothing" rather than as GameMaker 8.
 */
export type ModEngine = "gm8" | "gms";

/** What a mod is being installed into. */
export interface ModTarget {
  engine: ModEngine;
}

// -- The player's controls -----------------------------------------------------------------------

/**
 * One thing a player can do, named for what it means rather than for what it does in any one game.
 *
 * `confirm` and `cancel` rather than `jump` and `shoot`, deliberately. They are the same two keys in
 * a fangame -- Shift jumps, Z shoots -- but they are also the two keys a menu needs, and a host
 * may well make itself navigable with them. A name that only made sense while a game was
 * running would have to be renamed the day that happens.
 *
 * Small and closed. Everything in a fangame is these seven, and an action nobody can bind is worse
 * than no action: the panel would offer a row that changes nothing.
 */
export type ControlAction = "up" | "down" | "left" | "right" | "confirm" | "cancel" | "retry";

/** Every action, in the order a panel should show them. */
export const CONTROL_ACTIONS: readonly ControlAction[] = [
  "up",
  "down",
  "left",
  "right",
  "confirm",
  "cancel",
  "retry",
];

/**
 * The key each action is assumed to be **in the game**, as a `KeyboardEvent.code`.
 *
 * This is the half of the contract a mod cannot guess, which is why it is here rather than left to
 * each host: rebinding is a translation from the key the player presses to the key the game already
 * reads, and the two sides have to name the same destination or the mod maps onto nothing.
 *
 * The genre's convention, which a host's own on-screen pad should press too. A game that reads
 * something else is a game this cannot rebind.
 */
export const CANONICAL_CONTROL_KEYS: Readonly<Record<ControlAction, string>> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  confirm: "ShiftLeft",
  cancel: "KeyZ",
  retry: "KeyR",
};

/**
 * What the player bound each action to, as `KeyboardEvent.code`s -- the *physical* keys, so a
 * binding made on AZERTY stays under the same finger rather than following the letter printed on it.
 * The same convention `UiKeybindNode` uses, and for the same reason.
 *
 * **A list per action, from the first version.** One key is what the UI offers today, but a gamepad
 * is a second binding for an action the keyboard already has, and widening a `string` to a
 * `string[]` later would be a breaking change to every mod that read it. Empty means the player
 * unbound that action entirely, which is a choice and not a gap to fill with the default.
 *
 * Order is the player's. Nothing reads it today -- any bound key triggers the action -- but it is
 * what a "primary binding" badge would show, so it is preserved rather than sorted.
 */
export type ModControls = Readonly<Record<ControlAction, readonly string[]>>;

/**
 * Every action on the key the game already reads: the identity mapping.
 *
 * The default, and the thing to compare against to find out whether a player has rebound anything
 * at all -- `controlsAreDefault`. A player on these bindings needs no mod and no patched install,
 * which is what keeps this feature free for everyone who never opens it.
 */
export function defaultControls(): ModControls {
  const controls: Record<ControlAction, readonly string[]> = {} as Record<
    ControlAction,
    readonly string[]
  >;
  for (const action of CONTROL_ACTIONS) controls[action] = [CANONICAL_CONTROL_KEYS[action]];
  return controls;
}

/**
 * Whether these bindings are the ones the game reads anyway, so nothing has to be remapped.
 *
 * Order-sensitive on purpose: a player who deliberately put a second key first has changed
 * something, even if the set of keys is the same.
 */
/**
 * The side-specific modifier keys, and the side this app stores both of them as.
 *
 * GameMaker has one `vk_shift`, meaning *either* shift, and the same for control and alt -- so a
 * binding on the right shift and one on the left are the same binding as far as any game is
 * concerned. Keeping them apart would let two actions each claim "a shift" and then quietly behave
 * as one, and would show the player "Right Shift" on a key that is really both.
 */
const MODIFIER_SIDES: Readonly<Record<string, string>> = {
  ShiftRight: "ShiftLeft",
  ControlRight: "ControlLeft",
  AltRight: "AltLeft",
  MetaRight: "MetaLeft",
};

/**
 * The code a binding should be stored as: side-specific modifiers collapsed onto one side.
 *
 * Applied where a key is *captured*, so what is stored is already what the game will see. Doing it
 * at display time instead would leave two codes in the data that no engine can tell apart -- which
 * is how one action ends up stealing another's key without the panel showing it. The left variant
 * survives only because it is the one `CANONICAL_CONTROL_KEYS` already names.
 */
export function controlKeyForBinding(code: string): string {
  return MODIFIER_SIDES[code] ?? code;
}

// -- Controller bindings -------------------------------------------------------------------------

/**
 * A controller input, as a binding code.
 *
 * `PadButton0`, `PadAxis1Plus`, `PadAxis1Minus` -- the Gamepad API's **standard mapping** indices,
 * so one binding means the same physical button on every machine and in every runtime, without a
 * translation table per engine.
 *
 * Deliberately shaped to fit `CONTROL_KEY_RE` as it already stands: a controller binding lives in
 * the same list as a key, is stored the same way, and needs no second field anywhere. It also means
 * every existing reader does the right thing with one by accident -- `gameMakerKey` answers `0` for
 * a code it does not recognise, and the mod's remap already skips `0`, so a pad binding is ignored
 * by the keyboard remap rather than corrupting it.
 *
 * **No device index.** A binding is "the A button", not "the A button on the pad in port 2": a
 * player with one controller should not have to rebind when they unplug and replug it.
 */
const PAD_CODE_RE = /^Pad(?:Button\d{1,2}|Axis\d{1,2}(?:Plus|Minus))$/;

/** Whether this binding is a controller input rather than a key. */
export function isPadBinding(code: string): boolean {
  return PAD_CODE_RE.test(code);
}

/** The binding code for one standard-mapping button. */
export function padButtonCode(index: number): string {
  return `PadButton${index}`;
}

/** The binding code for one half of a standard-mapping axis. */
export function padAxisCode(index: number, direction: "Plus" | "Minus"): string {
  return `PadAxis${index}${direction}`;
}

/**
 * The most keys one action may be bound to.
 *
 * A limit rather than a design: two is the real case (a key and, later, a gamepad button), and the
 * rest of the room is for a player who wants both shifts. What it is really for is bounding what the
 * database stores, since this arrives from a client.
 */
export const MAX_CONTROL_BINDINGS = 4;

/**
 * A `KeyboardEvent.code` this app is willing to store.
 *
 * Shape only, never membership: `code` is whatever the browser calls the key, the list grows with
 * the web platform, and a key this build has never heard of should still be bindable by the player
 * whose keyboard has it -- a host can always show an unknown code raw. This bounds
 * the length and the alphabet, which is all that is needed to keep one safe to store and to put in a
 * message to a mod.
 */
const CONTROL_KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/;

/**
 * Reads stored controls, or `null` when this is not a set of controls at all.
 *
 * Shared by the side that stores them and the side that reads them back, deliberately: a writer and
 * a reader with their own idea of the format agree with each other right up to the day they do not,
 * and the failure -- a player's keys silently reverting -- is invisible from either side alone.
 *
 * Lenient in one specific direction. An action that is simply **missing** is filled in from the
 * default, so a blob written before an action existed still reads, and adding one is not a migration.
 * An action that is present and **empty** is kept empty, because that is a player deliberately
 * unbinding it. Anything else -- a key that is not a plausible `code`, more bindings than
 * `MAX_CONTROL_BINDINGS`, a duplicate, a value that is not a list -- makes the whole thing `null`
 * rather than being quietly repaired: a half-understood set of controls is worse than the defaults,
 * because the player cannot see which half was dropped.
 */
export function parseControls(value: unknown): ModControls | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const source = value as Record<string, unknown>;
  // Nothing outside the action list. A stray key is a different format, or a client that has
  // something to say this one has no slot for -- either way, not controls this build understands.
  for (const key of Object.keys(source)) {
    if (!(CONTROL_ACTIONS as readonly string[]).includes(key)) return null;
  }

  const controls: Record<ControlAction, readonly string[]> = {} as Record<
    ControlAction,
    readonly string[]
  >;
  for (const action of CONTROL_ACTIONS) {
    const bound = source[action];
    if (bound === undefined) {
      controls[action] = [CANONICAL_CONTROL_KEYS[action]];
      continue;
    }
    if (!Array.isArray(bound) || bound.length > MAX_CONTROL_BINDINGS) return null;
    if (bound.some((code) => typeof code !== "string" || !CONTROL_KEY_RE.test(code))) return null;
    if (new Set(bound as string[]).size !== bound.length) return null;
    controls[action] = [...(bound as string[])];
  }
  return controls;
}

export function controlsAreDefault(controls: ModControls): boolean {
  return CONTROL_ACTIONS.every((action) => {
    const bound = controls[action];
    return bound.length === 1 && bound[0] === CANONICAL_CONTROL_KEYS[action];
  });
}

/**
 * Who is playing.
 *
 * Handed down for the same reason `ModTarget` is: only the side doing the installing knows, and on
 * a native install the two sides that activate a mod -- the one that bakes its GML and the one that
 * runs its JavaScript -- have to be told the same thing or they disagree about what the mod
 * declared. A mod that read this for itself could only be right in one of them.
 *
 * **Deliberately small.** Third-party JavaScript reads this. An id and a display name are enough to
 * say "you"; nothing should be added without an answer to "what would a hostile mod do with it".
 * The language passes that test the easy way: it is written across the screen the mod is drawing
 * next to, and so do the controls: they are the keys the player is visibly pressing.
 *
 * **A host may add fields of its own**, and the modder passes them through untouched: whatever a
 * host knows about the player that is its own concept -- a character, a lobby -- travels on the
 * same object, for the mods written for that host to read. Nothing here names or interprets them.
 */
export interface ModPlayer {
  /** null when nobody is signed in. */
  readonly account: { readonly id: string; readonly name: string } | null;
  /**
   * The language the host is in, as a locale code (`"en"`, `"pt-BR"`, ...).
   *
   * A host's own set of codes, not one this contract lists: a mod should resolve a code it does not
   * recognise to its own default rather than refusing to draw, because a host can ship a language
   * before a mod's translations catch up.
   *
   * Carried with the player rather than with the target because it moves the way the player does and
   * not the way the target does: it is pinned for `activate()`, and the player changing it while a
   * game runs arrives through the same `on("player")` as signing in or picking a
   * character. What a mod *declared* from it therefore cannot change -- only what it draws into it.
   *
   * Never null. Nobody signed in still reads a language, since the host is in one either way.
   */
  readonly language: string;
  /**
   * The keys this player bound to each action, for a mod that wants to rebind the game to them or
   * merely to name them. See `ModControls`.
   *
   * Travels with the player for the same reason the language does: it is the host's own setting, kept
   * where only the host can read it, and a mod running in a host's main process has nothing to read
   * it from. Pinned for `activate()` and updated through `on("player")`, so what a mod
   * *declared* from it cannot change -- only what it does with it at run time, which for rebinding
   * is the whole job anyway.
   *
   * Never null: a signed-out player has controls too, since the host has to decide what the keys do
   * either way. `defaultControls()` when nobody has changed anything.
   *
   * **Read-only, and this is not the mechanism.** The host decides the bindings; a mod applying them
   * to a game is one mod's job, and a mod that invented its own would be fighting wherever the
   * player set them. Worth knowing even for a
   * mod that does not rebind: the remap is global engine state, so a mod with a keybind of its own
   * is read through the same map as the game.
   */
  readonly controls: ModControls;
}

/**
 * Nobody signed in.
 *
 * The default everywhere a player is optional, so a mod is never handed `undefined` and never has
 * to ask whether the host was new enough to tell it. "Signed out" and "this host does not know" are
 * the same thing to a mod, and both mean leave the game alone.
 *
 * The language is still worth passing: a signed-out player reads the host in whatever language they
 * picked, so a caller that knows it says so, and only a caller that genuinely has no idea falls back
 * to English.
 */
export function noPlayer(language = "en"): ModPlayer {
  return { account: null, language, controls: defaultControls() };
}

/**
 * Handing a file to the game.
 *
 * Every host owns the filesystem the game reads, which is what makes this the only way in rather
 * than one of two: in a browser the engine reads a virtual filesystem the host keeps in JavaScript,
 * and a native install is a real game reading real files the host can write. A picture is therefore written, not transmitted -- the alternative, chopping
 * it into base64 chunks the game decodes a byte at a time in GML, moved about a kilobyte per frame
 * and took six seconds for a 263 KB sprite.
 */
export interface ModFiles {
  /**
   * Writes bytes where this mod's game can read them, and answers with the path to open.
   *
   * `name` identifies the file within this mod -- letters, digits, `.`, `-` and `_`. The host
   * decides where it actually lives; two mods asking for the same name get two different files.
   *
   * `at` is the directory the game reported: the string it puts in front of a filename. A host
   * whose filesystem *is* the game's own composes the path from it, so both sides mean the same
   * file without anyone guessing how that engine resolves a relative name. A host writing a real
   * file somewhere of its own choosing ignores it.
   *
   * The returned path is meaningful **to the game**, not to the host: a virtual path in the
   * browser, a Windows path on a native install. Hand it to GML as-is.
   */
  write(name: string, bytes: Uint8Array, at: string): Promise<string>;
}

// -- Addressing: which mod a message belongs to --------------------------------------------------

/**
 * The wire prefix identifying one mod, derived from its id.
 *
 * Derived rather than assigned, and that is the whole point: the GML baked into a natively
 * installed game is written at *install* time, while the JavaScript that talks to it is loaded at
 * *launch* time, and the two have to agree without consulting each other. Anything positional -- an
 * index into the enabled list -- would shift the moment a player ticked a JavaScript-only mod on,
 * pairing one mod's GML with another mod's messages. A function of the id alone cannot.
 *
 * FNV-1a, and eight hex characters of it, because this prefix rides on *every* message: the native
 * GameMaker Studio transport moves one message per packet, so a longer prefix comes straight out of
 * what a mod can fit in a chunk (see `random-dog`'s `CHUNK`). Collisions are checked at load rather
 * than assumed away -- see `ModHost.load`.
 *
 * **The leading `m` is load-bearing, however decorative it looks.** Without it roughly one id in a
 * hundred hashes to something a GML engine can read as a *number* -- `9e424042` is eight hex
 * characters and also scientific notation -- and the runtime object below compares channels with
 * `==`. An engine that parses both sides of such a comparison gets infinity from an exponent that
 * large, and infinity compared against itself by subtraction is NaN, so the channel silently stops
 * matching itself and every message to that mod is dropped with nothing reported anywhere. OpenGM
 * did exactly this (fixed in its `VMExecutor` CMP), and a channel that cannot be read as a number
 * is what stops the question arising again in the three other backends, none of which we control
 * the comparison semantics of.
 */
export function modChannel(modId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < modId.length; index += 1) {
    const unit = modId.charCodeAt(index);
    // Both bytes of the code unit, so two ids that differ only outside Latin-1 still differ here.
    hash = Math.imul(hash ^ (unit & 0xff), 0x01000193);
    hash = Math.imul(hash ^ (unit >>> 8), 0x01000193);
  }
  return `m${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** The GML global holding one mod's mailbox: a `ds_list` that the loader's runtime object fills. */
export function modMailbox(modId: string): string {
  return `global.__mod_box_${modChannel(modId)}`;
}

/**
 * The one object the loader installs into every modded game, ahead of the mods' own.
 *
 * It is the *only* thing in a modded game that calls `host_receive()`, and that is what makes the
 * channel safe to share: it drains the engine's queue whole and appends each message to the mailbox
 * of the mod it is addressed to. A mod reads its own mailbox and cannot reach anyone else's.
 *
 * **Begin Step, not Step, and that is load-bearing.** GameMaker runs the entire Begin Step phase
 * across every instance before any Step event, so this drains before every mod's Step no matter how
 * many mods are loaded or where in the room their instances sit. In Step it would be a race decided
 * by instance order, where a mod saw this frame's mail or next frame's depending on where the
 * player's mod list happened to put it.
 *
 * Returned as an ordinary `Resource` rather than installed by some mechanism of its own, because
 * every backend already knows how to install one of those -- so this reaches OpenGMK, OpenGM and
 * both `.exe` patchers without a line of Rust or C# changing.
 *
 * The channels are sorted here rather than taken as given, so the GML is a function of *which* mods
 * are loaded and not of the order the player ticked them. That is what lets `modBuildKey`
 * fingerprint it without the fingerprint moving on its own.
 */
/** The loader's own object. Named distinctly enough not to collide with a game's own asset. */
export const RUNTIME_OBJECT_NAME = "mod_runtime";

export function loaderRuntime(modIds: readonly string[]): ObjectResource {
  const channels = [...new Set(modIds.map(modChannel))].sort();

  // Instance variables, never `var`. These code entries are created by the importer on the
  // GameMaker Studio side, which registers no locals table for them, so a `var` the runner cannot
  // resolve fails at run time inside somebody else's game. The names are long enough that no game
  // has an asset called one of them -- a bare name that matched an asset would read as the asset.
  const create = channels
    .map((channel) => `global.__mod_box_${channel} = ds_list_create();`)
    .join("\n        ");

  // An if-chain over the channels that exist, rather than a ds_map keyed by channel: GameMaker 8
  // has neither `ds_exists` nor `is_undefined`, and its `ds_map_find_value` answers a missing key
  // with 0 -- which is also a perfectly good ds_list id, so a miss would append to whichever list
  // happened to be created first.
  const route = channels
    .map(
      (channel, index) =>
        `${index === 0 ? "if" : "else if"} (__mod_rt_ch == "${channel}") ` +
        `ds_list_add(global.__mod_box_${channel}, __mod_rt_body);`,
    )
    .join("\n            ");

  // A message with no channel prefix is dropped rather than delivered somewhere. It is GML calling
  // `host_send` directly, which is a v1 mod, and inventing a recipient for it would hand one mod's
  // traffic to another. The host says so on the JavaScript side, where there is a console to say it
  // in -- see `ModHost.pump`.
  const beginStep = `__mod_rt_m = host_receive();
        while (__mod_rt_m != "") {
          __mod_rt_at = string_pos(" ", __mod_rt_m);
          if (__mod_rt_at > 1) {
            __mod_rt_ch = string_copy(__mod_rt_m, 1, __mod_rt_at - 1);
            __mod_rt_body = string_delete(__mod_rt_m, 1, __mod_rt_at);
            ${route}
          }
          __mod_rt_m = host_receive();
        }`;

  return {
    kind: "object",
    name: RUNTIME_OBJECT_NAME,
    // Depth is irrelevant to something that draws nothing, but 0 says that more plainly than the
    // overlay default every mod object otherwise gets.
    depth: 0,
    persistent: true,
    visible: false,
    events: { create, beginStep },
  };
}

// -- Deciding when a patched game is out of date -------------------------------------------------

/**
 * One mod, reduced to what a patched build depends on.
 *
 * Not the mod bundle: a mod is JavaScript *and* resources, and only the resources are baked into a
 * game. Everything else about a mod can change without the patched copy on disk becoming wrong.
 */
export interface ModBuildInput extends ModIdentity {
  resources: readonly Resource[];
}

/**
 * What this mod contributes to a patched game, canonically serialized -- or null when it
 * contributes nothing at all.
 *
 * **This function is the seam.** Whether a game has to be re-patched is a question about mod
 * *identity*, and how identity is established changes as mods do. Today mods are local files that
 * an author edits in place, so the only honest answer is derived from their content. Once mods are
 * published artifacts fetched by id and version, an immutable `${id}@${version}` is both cheaper
 * and more truthful -- and swapping to it means editing this function and nothing else, because
 * everything downstream only ever compares two opaque strings.
 *
 * The null case is not an optimisation. A mod that ships no GML cannot make a patched tree stale,
 * so returning null is what lets such a mod be switched on and off without rebuilding anything --
 * and it stays correct under the versioned scheme, where a JavaScript-only mod still bakes nothing.
 */
export function modBuildStamp(mod: ModBuildInput): string | null {
  if (mod.resources.length === 0) return null;
  // The id is included so that two mods declaring identical resources are still distinguishable,
  // and the version so that an author who bumps it gets a rebuild even if the content is unchanged.
  return JSON.stringify([mod.id, mod.version, mod.resources]);
}

/**
 * A single value identifying everything the enabled mods would bake into a game, or null when they
 * would bake nothing.
 *
 * Sorted by mod id, so the order the player happened to tick boxes in never triggers a rebuild.
 * `hash` is injected rather than imported: this package is loaded in a browser, a worker and a
 * desktop host's main process, and only the caller knows what hashing is available there.
 */
/**
 * The revision of the launch protocol a patched game speaks.
 *
 * **Bumped whenever a patched tree already on a player's disk would stop understanding the host.**
 * What is baked into a game is GML, and that GML reads the launch arguments the host passes by
 * their exact spelling -- so renaming one makes every tree patched before the rename deaf, in the
 * quietest possible way: the game runs, the mods load, and nothing they send ever arrives. This
 * number is folded into the build key below, which turns that silence into an ordinary rebuild on
 * the next launch.
 *
 * 1: the original, application-named argument prefixes.
 * 2: the neutral `--emu-*` prefixes, so a patched game no longer carries an application's name in
 *    the protocol it speaks.
 * 3: the channel builtins are `host_send`/`host_receive` rather than `mod_send`/`mod_receive`,
 *    so an emulator relaying them carries no mod vocabulary. A game patched under 2 calls
 *    builtins that no longer exist.
 * 4: emulated games carry the channel too, as GML over a loopback socket, so an emulated
 *    game patched under 3 calls builtins its emulator no longer has. Native trees re-patch once
 *    as well, into the same bytes they already had.
 */
export const LOADER_ABI = 4;

export function modBuildKey(
  mods: readonly ModBuildInput[],
  hash: (input: string) => string,
): string | null {
  const baking = mods
    .map((mod) => ({ id: mod.id, stamp: modBuildStamp(mod) }))
    .filter((entry): entry is { id: string; stamp: string } => entry.stamp !== null)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (baking.length === 0) return null;
  // The loader's runtime object is baked in alongside them, so it belongs in the fingerprint: its
  // GML names every channel, and a loader update that changes how it routes has to re-patch trees
  // built by the old one. Omitting it is the failure where a game on disk keeps a stale runtime and
  // the mods that talk to it look like they stopped working.
  const runtime = loaderRuntime(baking.map((entry) => entry.id));
  // `LOADER_ABI` as well as the runtime object: the runtime's GML names every channel, but the
  // launch arguments that tell a game which port and which id it is are spelled out in each
  // engine's own patcher rather than here, so a change to those is invisible to this hash unless it
  // is stated. See `LOADER_ABI`.
  return hash(JSON.stringify([LOADER_ABI, runtime, baking.map((entry) => entry.stamp)]));
}

// -- What a host keeps for a mod ---------------------------------------------------------------

/**
 * A mod's persisted settings, as the host hands them over and takes them back.
 *
 * An opaque bag per mod: the host stores it and never looks inside. That is the whole point -- a
 * host's storage learning what one mod's "shareSaves" means is exactly the coupling this avoids --
 * and it is why this is `unknown` rather than a schema.
 */
export type ModSettings = Record<string, unknown>;

/**
 * The most one mod's settings may weigh, serialized.
 *
 * Generous for what this is for -- a few flags, a channel name, a keybind -- and small enough that a
 * mod cannot quietly turn the settings store into its own database, or make signing in slow by
 * dragging a megabyte down with it. A mod that needs more than this needs storage of its own, and
 * should say so rather than discovering the limit in production.
 *
 * Shared rather than restated on each side: a host's client refuses to send an oversized bag and
 * its server refuses to store one, and the two disagreeing about the number is how a setting silently stops
 * saving.
 */
export const MOD_SETTINGS_MAX_BYTES = 16 * 1024;

/**
 * How many bytes a bag weighs on the wire.
 *
 * Counted by hand rather than with `TextEncoder`, because this file is imported by a Worker, a
 * browser, a sandboxed preload and a desktop host's main process, and it may not assume any global
 * beyond the language itself -- the same rule the rest of this package follows.
 */
export function modSettingsBytes(settings: ModSettings): number {
  const json = JSON.stringify(settings);
  let bytes = 0;
  for (let at = 0; at < json.length; at += 1) {
    const code = json.charCodeAt(at);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      // A surrogate pair is one 4-byte character; skip its low half rather than counting it twice.
      bytes += 4;
      at += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** Whether a bag fits, measured the way the wire measures it. */
export function modSettingsFit(settings: ModSettings): boolean {
  return modSettingsBytes(settings) <= MOD_SETTINGS_MAX_BYTES;
}
