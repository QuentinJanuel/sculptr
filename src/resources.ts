/**
 * What a mod declares for the patcher to install, and the channel it talks to the running game over.
 *
 * Format-neutral on purpose: everything in this file has to mean the same thing for a GameMaker 8
 * executable and a GameMaker Studio data.win, so nothing here may name a GameMaker version, an
 * event number, or a transport. Lowering a `Resource` into one format is that format's library's job.
 */

import type { At } from "./game-code.js";

/**
 * The events a mod's object can carry code for.
 *
 * A deliberately small set: these six exist under both GameMaker 8 and GameMaker Studio with the
 * same meaning, which is the bar for anything in this file. Alarms, collisions and the input events
 * are all expressible from `step` and are left out until a mod actually needs them.
 *
 * Note there is no `drawGui`: GameMaker 8 has no such event. A mod that wants screen-space drawing
 * draws in `draw` at view-relative coordinates, which is correct under both engines.
 */
export type ObjectEventName = "create" | "destroy" | "beginStep" | "step" | "endStep" | "draw";

export interface ObjectResource {
  kind: "object";
  /**
   * The asset name. Also what the game's own GML would see, so it should be distinctive enough not
   * to collide with the game's assets -- prefixing with the mod's own short name is the convention.
   */
  name: string;
  /**
   * GML source per event. An event with no entry is simply not created.
   *
   * **This code shares the host game's namespace, and that is sharper than it looks.** A bare
   * instance variable is resolved against the game's own assets first, so `hud = "x"` fails to
   * compile outright in any game that happens to have a script or object called `hud` -- which a
   * fangame engine very plausibly does. Prefix instance variables the way I Wanna Play Online
   * prefixed its own (`__ONLINE_`); `modhud_text` rather than `hud`.
   *
   * Locals declared with `var` work on every backend, and are scoped -- but their names collide
   * with the game's assets exactly like instance variables do (`var result;` does not compile in a
   * game with a sprite called `result`), so prefix those too.
   */
  events: Partial<Record<ObjectEventName, string>>;
  /**
   * Lower draws later, i.e. on top. Defaults to a large negative number, because the overwhelmingly
   * common case for a mod object is an overlay that must not be painted over by the game.
   */
  depth?: number;
  /**
   * Whether the object survives a room change. Defaults to `true`: a mod object that vanished at
   * the first screen transition would be useless in a fangame, where that happens within seconds.
   */
  persistent?: boolean;
  /** Defaults to `true`. A `false` object still runs its step events but draws nothing. */
  visible?: boolean;
}

/**
 * A GML script installed into the game, callable by name from anywhere in it.
 *
 * What objects cannot do: share one piece of GML between several events, several objects, or
 * several of a mod's own resources, without emitting the same lines into each of them.
 *
 * **A script shadows a builtin of the same name, and that is how a mod breaks its host.** GameMaker
 * resolves a call against scripts before builtins, so a mod script called `sprite_add` silently
 * replaces the engine's for the whole game -- the game's own code included. The reverse bites too:
 * a name the game already uses is *replaced* on the GameMaker Studio side, where the importer finds
 * an existing entry by name and overwrites it. Both are refused at install rather than discovered
 * later, but the first defence is the name: prefix it with something only this mod would use.
 */
export interface ScriptResource {
  kind: "script";
  /** The asset name, which is also what the game's own GML would see. Prefix it. */
  name: string;
  /**
   * The script body. Arguments arrive as `argument0`, `argument1`, ... and `return` returns. `var`
   * locals work, under the same naming caveat as an object's events.
   */
  source: string;
}

/**
 * Replaces the body of one of the **game's own** scripts, keeping the original callable.
 *
 * The script keeps its name, so every place the game calls it -- and anything that stored its index
 * -- now runs `source`. The original body moves, untouched, to a new script called `original`,
 * which `source` calls whenever it wants the game's behaviour: first, last, twice, or not at all.
 *
 * Moved rather than recompiled on every engine. That matters most where the original is bytecode:
 * recompiling decompiled code is where a faithful game quietly stops being one.
 *
 * Several hooks on one script chain in load order: a later hook's `original` is the earlier hook's
 * body. Only the game's scripts can be hooked -- not builtins, and not a script a mod installed.
 */
export interface HookResource {
  kind: "hook";
  /** The game's script to take over. */
  script: string;
  /** Where its current body goes. A new name, prefixed like any other resource. */
  original: string;
  /** The new body. Calls `original(...)` to run what was there before. */
  source: string;
}

/**
 * Runs one of this mod's scripts at one place **inside** the game's code, leaving the rest alone.
 *
 * The other half of `HookResource`. A hook replaces what a script *is*, and can do that because at
 * whole-script granularity the original is a script call, which composes into the mod's GML
 * anywhere. This addresses one statement instead, where the original is inline -- a moved
 * instruction on GameMaker Studio, spliced text on GameMaker 8 -- and can only sit on one side of
 * what the mod runs. Hence `place` rather than an `original` the body could call.
 *
 * Neither replaces the other. A hook cannot reach inside a body without reprinting it, and this
 * cannot see the script's arguments, its return value, or every path out of it. An object event has
 * no caller at all, so once events carry tokens this is the only way into one.
 *
 * **What runs is a script, not this mod's text.** `call` names a `ScriptResource` the mod also
 * declared, and both backends splice a call to it -- GameMaker 8 too, where pasting the body in
 * would have been easier. Pasting would give GameMaker 8 mods the host's `var` locals, its
 * arguments and an `exit` that returns from the host script, none of which the GameMaker Studio side
 * can offer; the same mod would then mean two things. So the body sees `self`, `other`, globals and
 * instance variables on both engines, and the host's locals on neither.
 *
 * Installed **before** hooks: `at` refers to the game's original body, and a hook then moves that
 * body aside with its insertions already in it, so an insertion still fires when the hook calls the
 * original. Several insertions at one place run in declaration order.
 */
export interface InsertResource {
  kind: "insert";
  /** The token from the statement in `GameCode` to insert around. */
  at: At;
  /** `"before"` the statement starts, or `"after"` it is finished -- once, on every way out of it.
   *  For a loop that is once when the loop ends; to run per iteration, point at the last statement
   *  of its body. `"after"` an `exit` is refused: nothing follows it.
   *
   *  `"instead"` replaces the statement: the call runs and the statement does not. For an `if`, a
   *  loop or a `with` that takes its whole body with it, which is the point -- it is how a mod
   *  deletes something a game does -- and also the trap, so a mod points at the smallest statement
   *  that says what it means to remove. Refused on GameMaker Studio, where a statement's bytecode
   *  has no end this format records and skipping it could only be guessed at. */
  place: "before" | "after" | "instead";
  /** The mod script to call there, declared separately as a `ScriptResource`. It takes no arguments
   *  and its return value is discarded. Several insertions may name the same one. */
  call: string;
}

/** Objects, scripts, hooks and insertions. Sprites and sounds join this union when `update` lands. */
export type Resource = ObjectResource | ScriptResource | HookResource | InsertResource;

/** Narrows a resource list to the hooks in it, keeping declaration order -- which is chain order. */
export function hookResources(resources: readonly Resource[]): HookResource[] {
  return resources.filter((resource): resource is HookResource => resource.kind === "hook");
}

/** Narrows a resource list to the objects in it, keeping declaration order. */
export function objectResources(resources: readonly Resource[]): ObjectResource[] {
  return resources.filter((resource): resource is ObjectResource => resource.kind === "object");
}

/**
 * Narrows a resource list to the insertions in it, keeping declaration order.
 *
 * Declaration order is the order they run in at a shared place, and it is also why every backend
 * installs these *before* the hooks: see `InsertResource`.
 */
export function insertResources(resources: readonly Resource[]): InsertResource[] {
  return resources.filter((resource): resource is InsertResource => resource.kind === "insert");
}

/**
 * Narrows a resource list to the scripts in it, keeping declaration order.
 *
 * Kept apart from the objects because every backend has to install these *first*: on the
 * GameMaker Studio side a call compiles to a script call only if the script asset already exists,
 * so an object imported before the script it calls compiles that call into something else.
 */
export function scriptResources(resources: readonly Resource[]): ScriptResource[] {
  return resources.filter((resource): resource is ScriptResource => resource.kind === "script");
}

/**
 * The runtime channel, from the host's side.
 *
 * Both directions are fire-and-forget and neither blocks. That is not a simplification for its own
 * sake: in the `.exe` backends the host is across a socket, and a channel that could block would
 * either stall the game on the host or stall the host on the game. Making the in-process backends
 * behave the same way is what keeps one mod running unchanged on all four.
 */
export interface ModTransport {
  /** Queue one message for the game to pick up from its GML `host_receive()`. */
  send(message: string): void;
  /** Take everything the game has sent via GML `host_send()` since the last call, oldest first. */
  drain(): string[];
}
