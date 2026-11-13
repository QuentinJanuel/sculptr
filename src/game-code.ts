/**
 * The game's own code, as a mod sees it: which scripts and objects exist, and roughly what their
 * GML does.
 *
 * **For understanding, never for rebuilding.** This is a lossy summary a mod reads to find things
 * -- "which script writes the player's position to a file" -- and nothing here is meant to be
 * printed back into GML. A node keeps what that kind of question needs (assignments, calls,
 * references, control flow) and everything else collapses into `unknown`. When a mod needs to run
 * the game's code it calls it (see `HookResource`), it does not reconstruct it.
 *
 * **One format for every engine.** GameMaker 8 parses source; GameMaker Studio decompiles bytecode.
 * Each backend maps its own tree into this one, and whatever differs between the two dialects is
 * normalized on the way in, so no mod ever has to ask which engine produced a node:
 *
 * - GameMaker 8's `=` inside an expression is a comparison, and becomes `==`.
 * - `<>`, `and`, `or`, `xor`, `not` become `!=`, `&&`, `||`, `^^`, `!`.
 * - `argument0` and `argument[0]` are both `{ k: "arg", index: 0 }`.
 * - A name the game declared with `globalvar` reads as `global`.
 * - An identifier that names one of the game's assets is an `asset`, whatever the dialect's own
 *   rules for resolving it were.
 *
 * Bumped by any change a mod could observe, so a backend's cache written for an older format is
 * never handed to a newer loader.
 *
 * **v2 added `at`.** Statements carry a token naming where they are, so a mod can ask for its own
 * GML to run at one of them (`InsertResource`). Nothing else changed, but a format 1 cache has no
 * tokens at all, and a mod reading one would see every statement as un-addressable rather than as
 * stale -- which is why this is a bump and not a tolerated absence.
 *
 * **v3 added `events` and `sounds`.** An object's code is no longer only the six events a mod can
 * install: every event an object declares is listed, addressably, because the code that matters is
 * not always in one of the six -- the key that retries an I Wanna game is a Key Press event, and on
 * GameMaker 8 that is where a game stops its music. `sounds` says which sound assets occupy the
 * single slot GameMaker 8 plays music through, which is the difference between a jingle and a sound
 * effect and cannot be told from the code alone. Same reasoning as v2 for the bump: a format 2
 * cache has no events and no sounds, and a mod reading one would conclude the game has none.
 *
 * **v4 added `rooms`.** The code a room runs when it loads -- the room's own creation code and the
 * creation code of each instance placed in it -- is listed, addressably. Not an afterthought of
 * `events`: in GameMaker 8 this is where a game decides what music a room plays, and placing a
 * controller object with a line of creation code is how these games have always configured a room,
 * so a whole class of behaviour lives here and nowhere else. Same reasoning as v2 and v3 for the
 * bump.
 */
export const GAME_CODE_FORMAT = 4;

/** Everything about the game a mod can read. Only what mods need so far. */
export interface GameCode {
  format: typeof GAME_CODE_FORMAT;
  scripts: GameScript[];
  objects: GameObject[];
  /**
   * Every event every object declares, flat, as addressable code.
   *
   * The six in `GameObject.events` appear here too, under their engine name rather than the
   * protocol's. Two views of the same code rather than two halves of it: a mod looking for the
   * player's Create reaches for `objects`, and one looking for wherever this game does something
   * walks `scripts` and then this -- and neither has to remember that the other exists.
   *
   * Empty on a backend that cannot address an event's statements, which is not the same as a game
   * whose objects have no events; a mod that finds nothing here should say so rather than conclude
   * the game does nothing.
   */
  events: CodeEntry[];
  /**
   * The game's sound assets.
   *
   * Only what a mod cannot work out from the code: `exclusive` (see `GameSound`). The list is in
   * asset order, and a slot a game left empty is skipped rather than listed as a nameless sound.
   */
  sounds: GameSound[];
  /**
   * Every piece of code a room runs when it loads, flat, as addressable code.
   *
   * A room's own creation code, and the creation code of each instance placed in it. Only the ones
   * that have any: a room full of plain scenery contributes nothing here.
   *
   * **This is not code a mod could have found anywhere else.** It is not in a script and not in an
   * object's events -- an instance's creation code belongs to that one placement of that object,
   * and two instances of the same object in two rooms run different code. It is also the only code
   * in a GameMaker 8 game that runs *per room*, which is why a room's music is armed here.
   *
   * Empty on a backend that cannot address it, the same caveat as `events`.
   */
  rooms: RoomCode[];
}

/** One piece of the game's code, named so a mod can say which one it means. */
export interface CodeEntry {
  /**
   * How this piece of code is named, which is also the half of an `At` token the loader validates
   * and an error quotes.
   *
   * For an object event it is `<object>.<event>` in the engine's own vocabulary --
   * `world.KeyPress_82`, `player.Collision_17`, `boss.Alarm_0`, `world.Step_0`. Engine-specific on
   * purpose: a name the engine itself uses is one a developer can find again, and a mod that cares
   * which event it is was already written for one engine's event model.
   *
   * For a room (`RoomCode`) it is `<room>.room` for the room's own creation code and
   * `<room>.instance_<id>` for an instance's, where the id is the one the room editor gave that
   * placement. Neither can be mistaken for an event: no engine has an event list called `room` or
   * `instance`.
   */
  name: string;
  body: Block;
}

/** One of the game's sound assets. */
export interface GameSound {
  name: string;
  /**
   * Whether playing this sound stops whatever else was playing.
   *
   * GameMaker 8 plays its "multimedia" sounds -- which in practice is every mp3, and so almost
   * every piece of music a GameMaker 8 game has -- through one slot that holds exactly one sound:
   * starting a second one ends the first. That is why those games cannot have a game-over jingle
   * play over their music, and why a mod that wants the music to survive a death has to keep the
   * jingle from starting rather than merely keep the music from being stopped.
   *
   * Always false on GameMaker Studio, which mixes as many sounds as a game asks for.
   */
  exclusive: boolean;
}

/**
 * One piece of code a room runs when it loads.
 *
 * The room and the object are given rather than left to be read out of `name`: a mod that wants
 * "the music this room arms" should not have to parse a name back apart, and a name is the
 * engine's vocabulary while these two are the game's.
 */
export interface RoomCode extends CodeEntry {
  /** The room whose load runs this. */
  room: string;
  /**
   * The object of the instance this is the creation code of, or `null` for the room's own creation
   * code. `null` too when the instance's object is not one the summary can name.
   */
  object: string | null;
}

export interface GameScript {
  name: string;
  body: Block;
}

/**
 * One of the game's objects.
 *
 * Only the events the loader itself can install (`ObjectEventName`) are listed, which covers what a
 * mod has needed so far -- a player object's Create, mostly. An event built from drag-and-drop
 * actions rather than code appears as `call`s to each action's function where it has one, and as
 * `unknown` where it does not.
 */
export interface GameObject {
  name: string;
  /** Only the events the object declares itself. One it inherits from a parent is not repeated.
   *  The same code is in `GameCode.events` under the engine's own name for the event. */
  events: Partial<Record<GameEventName, Block>>;
}

/** The same six events a mod object can carry, so the two vocabularies never drift apart. */
export type GameEventName = "create" | "destroy" | "beginStep" | "step" | "endStep" | "draw";

export type Block = Stmt[];

/**
 * Where one statement is, as an opaque token: enough for a backend to run a mod's GML just before
 * or just after it, and meaningless to everyone else.
 *
 * **A value, never an identity.** A mod points at a statement by handing its token back
 * (`InsertResource.at`), and the host compares strings. So a mod may `filter`, spread,
 * `structuredClone` or JSON round-trip anything out of `GameCode` and its tokens keep working --
 * which matters, because reading the game's code is exactly the kind of task that ends in a pile of
 * derived arrays.
 *
 * **On statements only, never on expressions.** Expressions are compared structurally by real mod
 * code -- a mod that finds a game's save routine keys a storage channel on `JSON.stringify(expr)`,
 * which is how it decides a save and a load touch the same file -- and a per-node token would make
 * two identical expressions compare unequal and quietly break that. Nothing needs to address
 * anything smaller than a statement: the unit a mod can insert around is a statement.
 *
 * **Shaped `<entry>#<payload>`, and only the first half means anything here.** The entry names the
 * piece of code -- a script's name, or an object event's `CodeEntry.name` -- which is what the host
 * validates and what an error message quotes. The payload is whatever the backend that produced it needs to find
 * the place again -- byte offsets into the source on GameMaker 8, instruction addresses on
 * GameMaker Studio -- and is read by that same backend and nobody else. The format version above is
 * what guards its shape, so it may change freely.
 *
 * **Good only for the game it came from, and only for this launch.** A token is derived from the
 * game's bytes; `GameCode` is already rebuilt and cached per game content hash and format version,
 * so a token cannot outlive what it points at. A mod must never persist one -- there is nothing to
 * gain, since mods are re-run and `GameCode` re-read on every launch.
 */
export type At = string & { readonly __at: unique symbol };

/** The code entry half of a token: what the host validates and what an error quotes. */
export function atEntry(at: At): string {
  const hash = at.indexOf("#");
  return hash < 0 ? at : at.slice(0, hash);
}

/**
 * A statement.
 *
 * `at` is present when the backend could locate this statement well enough to insert around it, and
 * absent otherwise -- the parts of a `for` header, a compiler temporary the GameMaker Studio
 * decompiler invented, or anything inside a body the mapper could not place. A mod that points at
 * one without a token is refused when it declares the insertion, by name, rather than silently
 * skipped.
 */
export type Stmt =
  | AssignStmt
  | { k: "call"; at?: At; call: CallExpr }
  | { k: "if"; at?: At; cond: Expr; then: Block; else: Block }
  | { k: "with"; at?: At; target: Expr; body: Block }
  /** `while`, `do`/`until`, `for` and `repeat`. What runs inside is kept; how often is not. */
  | { k: "loop"; at?: At; body: Block }
  | { k: "switch"; at?: At; value: Expr; bodies: Block[] }
  /** `exit` (value null), or `return` and what it returns. Never has an `at` for `"after"`. */
  | { k: "exit"; at?: At; value: Expr | null }
  /** A statement this summary does not model -- `break`, `continue`, a `case` label. It can still
   *  carry a token: a mod may want to run something around a line it cannot otherwise describe. */
  | { k: "unknown"; at?: At };

export interface AssignStmt {
  k: "assign";
  at?: At;
  target: Expr;
  /** The compound forms that are not listed (`&=`, `|=`, `^=`) are `other`. */
  op: "=" | "+=" | "-=" | "*=" | "/=" | "other";
  value: Expr;
}

/** Every statement in a block, in source order, descending into branches, bodies and cases.
 *
 *  Here rather than in each mod because every mod that looks for a pattern in the game's code writes
 *  this same recursion, and one that forgets a `switch` body finds nothing there and says nothing. */
export function* walk(block: Block): Generator<Stmt> {
  for (const stmt of block) {
    yield stmt;
    switch (stmt.k) {
      case "if":
        yield* walk(stmt.then);
        yield* walk(stmt.else);
        break;
      case "with":
      case "loop":
        yield* walk(stmt.body);
        break;
      case "switch":
        for (const body of stmt.bodies) yield* walk(body);
        break;
      default:
        break;
    }
  }
}

export type Expr =
  | { k: "number"; value: number }
  | { k: "string"; value: string }
  /** A built-in constant such as `c_red`, `vk_left` or `true`. Never replaced by its value. */
  | { k: "constant"; name: string }
  | { k: "asset"; kind: AssetKind; name: string }
  | VarExpr
  /** `of.name`: `player.x`, `(428).x`, `obj.x`, `global.grav` is a `var` instead. */
  | { k: "field"; of: Expr; name: string }
  | { k: "index"; of: Expr; at: Expr[] }
  /** `argumentN` or `argument[N]`. `index` is null when N is not a plain number. */
  | { k: "arg"; index: number | null }
  | CallExpr
  | { k: "op"; op: Operator; args: Expr[] }
  | { k: "unknown" };

export type AssetKind = "object" | "script" | "sprite" | "room" | "sound" | "other";

export interface VarExpr {
  k: "var";
  /**
   * - `local`: declared with `var` in this piece of code.
   * - `global`: `global.name`, or a name declared with `globalvar`.
   * - `builtin`: one the engine itself defines, instance or global (`x`, `vspeed`, `room`).
   * - `self`: anything else, i.e. an instance variable of whoever runs the code.
   */
  scope: "local" | "self" | "global" | "builtin";
  name: string;
}

export interface CallExpr {
  k: "call";
  /** `script` when the name is one of the game's scripts, `builtin` otherwise. */
  kind: "script" | "builtin";
  name: string;
  args: Expr[];
}

export type Operator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "div"
  | "mod"
  | "&"
  | "|"
  | "^"
  | "<<"
  | ">>"
  | "~"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||"
  | "^^"
  | "!";

/** The code of a game nobody could read: no scripts, no objects. Also what a test starts from. */
export function emptyGameCode(): GameCode {
  return { format: GAME_CODE_FORMAT, scripts: [], objects: [], events: [], sounds: [], rooms: [] };
}

/**
 * Checks the envelope of what a backend handed back, so a stale cache or a mismatched engine build
 * fails with a sentence rather than as a mod reading `undefined` deep inside its own logic.
 *
 * Only the envelope: walking every node would cost as much as producing them, and the backends are
 * tested against the same fixtures for the rest.
 */
export function parseGameCode(json: string): GameCode {
  const parsed = JSON.parse(json) as Partial<GameCode> | null;
  if (!parsed || typeof parsed !== "object") throw new Error("game code: not an object");
  if (parsed.format !== GAME_CODE_FORMAT) {
    throw new Error(
      `game code: format ${String(parsed.format)}, this loader reads format ${GAME_CODE_FORMAT}`,
    );
  }
  if (!Array.isArray(parsed.scripts) || !Array.isArray(parsed.objects)) {
    throw new Error("game code: scripts and objects must be lists");
  }
  if (!Array.isArray(parsed.events) || !Array.isArray(parsed.sounds)) {
    throw new Error("game code: events and sounds must be lists");
  }
  if (!Array.isArray(parsed.rooms)) throw new Error("game code: rooms must be a list");
  return parsed as GameCode;
}
