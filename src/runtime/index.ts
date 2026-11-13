/**
 * The mod runtime: loads mod modules, hands each one the API object, collects what they declare,
 * and routes messages between them and whichever engine is running.
 *
 * Transport-agnostic by construction -- it never learns which of the four backends it is talking
 * to. An engine adapter builds a `ModTransport` and hands it over; everything above that line is
 * the same code for an emulator in the page and for a patched game across a socket.
 *
 * The lifecycle has two phases, and the split is forced by the engines rather than chosen:
 *
 *   1. **Collect.** `ModHost.load()` runs every mod's `activate()`, which declares resources. This
 *      has to finish before the engine is constructed, because resources are installed into the
 *      game's assets at load time.
 *   2. **Run.** `attach()` connects the transport once the engine exists, and `pump()` moves
 *      messages once per frame.
 *
 * A mod that sends before `attach()` is not an error; those messages are queued and delivered in
 * order once the channel exists. Otherwise every mod would need to know about a lifecycle it has no
 * reason to care about.
 */

import { noPlayer } from "../contract.js";
import { loaderRuntime, modChannel, modMailbox } from "../contract.js";
import type { ModUiPatch, ModUiState, UiEvent } from "../ui.js";
import type { ModPlayer } from "../contract.js";
import type {
  ModBuildInput,
  ModFiles,
  ModIdentity,
  ModSettings,
  ModSource,
  ModTarget,
} from "../contract.js";
import type { ModTransport, Resource } from "../resources.js";
import { atEntry, emptyGameCode, type GameCode } from "../game-code.js";
import { UiSession, type UiBuilder, type UiSpec, type UiStateOptions } from "./ui.js";
import { batch, computed, type ReadonlyRef, type Ref } from "./reactive.js";

export type {
  GameCode,
  ModFiles,
  ModIdentity,
  ModPlayer,
  ModSettings,
  ModSource,
  ModTarget,
  ModTransport,
  ModUiPatch,
  ModUiState,
  Resource,
  UiEvent,
};
export { noPlayer };

/**
 * A `ModFiles` for a host with no game to write to.
 *
 * `ModHost.load` is used for two different things: running a game's mods, and asking mods what they
 * declare so a native install can be patched. The second has no game and no filesystem, and will
 * never be asked -- a mod loads its pictures once the channel is live, which in that case never
 * happens. Rejecting says so plainly rather than leaving the field empty for every caller to
 * wonder about.
 */
export function noFiles(): ModFiles {
  return {
    write: () => Promise.reject(new Error("no game is running, so there is nowhere to put a file")),
  };
}
export type { Ref, ReadonlyRef } from "./reactive.js";
export type { Bindable, Spec as UiNodeSpec, UiBuilder, UiSpec, UiStateOptions } from "./ui.js";

/**
 * GML text a mod splices into its own events to reach its own JavaScript.
 *
 * Text rather than function names, because a mod cannot call anything the loader defines: under
 * API v1 it called the `mod_send` / `mod_receive` builtins directly, and those are shared -- one
 * queue, popped destructively -- so two mods that both listened stole each other's messages. The
 * loader now owns the only `host_receive()` call in the game (the contract's `loaderRuntime`) and
 * hands each mod the few lines that reach its own mailbox instead.
 *
 * Keeping it as text rather than as a script asset is what makes it free on every backend: nothing
 * new is installed, nothing new is named, and there is no chance of shadowing a script the host
 * game already has. Scripts are the obvious next step once several mods want to share more than
 * two statements; the shape of this interface does not change when they land.
 */
export interface ModGml {
  /**
   * A statement handing one message to this mod's JavaScript. `expression` is GML that evaluates
   * to the message -- a literal, a variable, a concatenation.
   */
  send(expression: string): string;
  /**
   * A statement popping this mod's next message into `variable`, or `""` when there is none.
   *
   * `variable` may be an instance variable or a `var` local.
   *
   * An empty message is indistinguishable from no message, which is why anything with a framing of
   * its own should keep its frame non-empty -- an event name in front of the payload is enough.
   */
  receive(variable: string): string;
}

/** The API object a mod receives. This is the entire surface a mod is written against. */
export interface ModApi {
  /** Who this mod was installed as, so shared helper code can identify its caller. Handed down
   *  rather than declared -- see `ModIdentity` in the protocol. */
  readonly identity: ModIdentity;
  /** What this mod is being installed into. Read it before declaring GML: the two engines do not
   *  accept the same language. */
  readonly target: ModTarget;
  /**
   * The game's own scripts and objects, summarized for reading. See `GameCode` in the protocol:
   * a mod uses this to find something in the game, and a `hook` resource to act on it.
   *
   * Empty when the backend could not read the game's code, which a mod should treat the way it
   * treats a game it does not recognise.
   */
  readonly game: GameCode;
  /**
   * Who is playing, and which character they chose. See `ModPlayer` in the protocol.
   *
   * A function, not a field, because it can change while the game runs -- the player picking a
   * different character is the obvious case. Read it again rather than keeping the result.
   *
   * **During `activate()` it is pinned**, and that is load-bearing rather than incidental. On a
   * native install `activate()` runs twice, seconds apart: once in the renderer to decide what GML
   * is baked into the game's files, and once in the main process to run the JavaScript behind it.
   * A mod that let a live value decide what it declares could declare two different things and
   * leave the game asking for something nobody is listening for. `ModHost.load` takes the value the
   * launch pinned; `setPlayer` is what moves it afterwards, and is never called before the channel
   * opens.
   *
   * Never null -- nobody signed in answers `noPlayer()`. The only question a mod asks is whether
   * `account` (or `skin`) is null. `language` is always there, signed in or not.
   */
  getPlayer(): ModPlayer;
  resource: {
    /** Declare a resource to install into the game. Only valid during `activate()`. */
    create(resource: Resource): void;
  };
  /** GML for reaching this mod's own JavaScript from inside the game. */
  readonly gml: ModGml;
  /** Send one message to this mod's GML. Addressed: no other mod sees it. */
  send(message: string): void;
  /** Subscribe to messages from this mod's GML. Addressed: no other mod's traffic arrives here. */
  on(event: "message", handler: (message: string) => void): void;
  /**
   * Called once the channel is live, meaning the game exists and can answer.
   *
   * **A mod activates before there is a game.** Resources have to be declared before the engine is
   * built, so `activate()` runs first and anything sent then is queued until the channel opens --
   * which is fine for sending, and not fine for waiting. A mod that expects an answer within some
   * time of asking has to start that clock from here, or it is timing the engine's startup: a
   * GameMaker Studio game in the emulator boots a .NET runtime and extracts its assets first,
   * which is far longer than any sane timeout for a reply.
   *
   * Registering after the channel is already open calls the handler straight away, so a late
   * subscriber cannot wait forever for something that has already happened.
   */
  on(event: "start", handler: () => void): void;
  /**
   * Called when `getPlayer()` would answer differently -- somebody signed in or out, picked a
   * different character, or changed the language the host is in.
   *
   * Never during `activate()`, which is what keeps the pinning in `getPlayer` true. A mod that
   * declared resources from the player must not change what it declared; what it can change is what
   * it *does* with them, which for a skin is loading a different picture into a sprite it already
   * owns, and for a language is drawing other words into a panel it already declared.
   */
  on(event: "player", handler: (player: ModPlayer) => void): void;
  /** Hands a file to the game. See `ModFiles` in the protocol. */
  readonly files: ModFiles;
  /**
   * This mod's own panel, and the reactive values behind it.
   *
   * What it exists for: a mod that needs a setting would otherwise need its *host* to know about
   * it. A mod brings its own instead, and the host renders it without knowing what it means. See
   * `./ui` for the model and `../ui` for what actually crosses.
   */
  readonly ui: ModUiApi;
}

/** See `ModApi.ui`. */
export interface ModUiApi {
  /**
   * A value the panel can show and the player can change.
   *
   * `persist` keeps it in this mod's own settings bag, which the host stores and never reads into.
   * That is the point: the database learning what "shareSaves" means is exactly the coupling this
   * replaces -- and it was one, a column on `account`, until migration 0028.
   */
  state<T>(initial: T, options?: UiStateOptions): Ref<T>;
  /** A value derived from other values. Rendered, never written to by the host. */
  computed<T>(fn: () => T): ReadonlyRef<T>;
  /** Declares a panel. Only during `activate()`, like every other thing a mod declares. */
  panel(options: { id?: string; title: string }, render: (ui: UiBuilder) => UiSpec): void;
}

/**
 * Where a mod's persisted settings come from and go.
 *
 * Handed down rather than discovered, for the same reason `ModPlayer` is: `localStorage` is the
 * renderer's, and on a native install a mod's JavaScript may be nowhere near one. The installer
 * resolves the bag -- from the account when there is one, from the browser when there is not -- and
 * passes it in already loaded, so `activate()` stays synchronous and a mod's first render already
 * shows what the player chose last time.
 */
export interface ModSettingsStore {
  /** Per mod id. A mod with no entry starts from whatever defaults it declared. */
  initial?: Readonly<Record<string, ModSettings>>;
  /** One mod's bag changed. Opaque: the store writes the bytes and never looks inside. */
  save?(modId: string, settings: ModSettings): void;
}

export interface ModHostOptions {
  settings?: ModSettingsStore;
  /**
   * How a mod hands a file straight to the game. Handed down rather than discovered, like
   * everything else here: only the side that built the game knows where its files live.
   */
  files: ModFiles;
}

/** Everything a mod bundle is: one function, which the host calls once with the API object. */
export type ModActivate = (api: ModApi) => void;

/** One mod ready to be loaded: the bundle's function, plus who the installer says it is. */
export interface LoadableMod {
  identity: ModIdentity;
  activate: ModActivate;
}

/**
 * Reads the activate function out of whatever a bundle exported, or says what is missing.
 *
 * Two accepted shapes, because a mod library's `createMod(...)` returns a value rather than
 * defining an export: `export default createMod(...)` lands a `{ activate }` object here, while a
 * mod written without a library default-exports the function itself. What a bundle no longer
 * carries either way is a manifest -- identity is handed down at load, so there is nothing left for
 * a bundle to state about itself and no second place for it to disagree with.
 *
 * Shared rather than duplicated because every host loads bundles: a browser evaluates a blob URL
 * (`importMods` below), and a desktop host's main process imports a file off disk.
 */
export function asModActivate(exported: unknown, source: string): ModActivate {
  const module = (exported ?? {}) as { default?: unknown };
  if (typeof module.default === "function") return module.default as ModActivate;
  const definition = module.default as { activate?: unknown } | undefined;
  if (definition && typeof definition === "object" && typeof definition.activate === "function") {
    return definition.activate as ModActivate;
  }
  throw new Error(
    `mod at ${source}: must default-export an activate function, or \`{ activate }\` ` +
      `(which is what a mod library's createMod() returns)`,
  );
}

interface LoadedMod {
  /** Subscribers to `on("player")`, fired by `setPlayer`. */
  players: ((player: ModPlayer) => void)[];
  identity: ModIdentity;
  /** Called once, when the transport is attached. See `ModApi.on("start")`. */
  starters: (() => void)[];
  /** This mod's wire prefix, from the contract's `modChannel`. Every message it sends or receives
   *  carries it, and the loader's runtime object sorts the game's traffic by it. */
  channel: string;
  handlers: ((message: string) => void)[];
  /** This mod's own resources, kept apart from the merged list so each mod can be fingerprinted
   *  separately -- see `builds` and the contract's `modBuildStamp`. */
  resources: Resource[];
  /** This mod's panels and the reactive values behind them. Always present -- a mod that declares
   *  no panel simply has an empty one, which costs nothing and saves every caller a null check. */
  ui: UiSession;
}

/**
 * The one name a resource adds to the game: an object's or script's own, a hook's `original`.
 *
 * An insertion adds none -- it only calls a script declared separately -- so it is the one resource
 * that cannot collide with anything, and `null` keeps it out of the duplicate check rather than
 * having every insertion collide with every other under the name `undefined`.
 */
function installedName(resource: Resource): string | null {
  if (resource.kind === "insert") return null;
  return resource.kind === "hook" ? resource.original : resource.name;
}

export class ModHost {
  readonly #mods: LoadedMod[] = [];
  readonly #resources: Resource[] = [];
  readonly #pending: string[] = [];
  /** Patches produced before anyone subscribed. A mod can move its own UI from `activate()` -- the
   *  online mod's "connecting..." turning into "connected" is exactly that -- and the host subscribes
   *  once the engine exists, which is later. Dropping these would leave the first render stale. */
  readonly #pendingUi: ModUiPatch[] = [];
  #uiHandler: ((patch: ModUiPatch) => void) | null = null;
  #transport: ModTransport | null = null;
  /** What `getPlayer()` answers. The launch's pinned value until `setPlayer` moves it. */
  #player: ModPlayer = noPlayer();

  private constructor() {}

  /**
   * Runs each mod's `activate()` and returns a host holding everything they declared.
   *
   * `target` is passed in rather than discovered, because the only side that knows what a mod is
   * being installed into is the one doing the installing -- an engine adapter knows which engine it
   * is, and for a native install the main process is the only side that has looked at the files.
   * Each mod's `identity` arrives the same way and for the same reason: what a mod is installed
   * *as* is no more its own bundle's business than what it is installed *into*. See `ModIdentity`.
   *
   * Throws if any mod fails to activate. That is deliberate at this stage: a mod that cannot even
   * be set up is a broken install, and failing the load says so plainly rather than starting a game
   * that silently lacks half of what the player enabled.
   */
  static load(
    mods: LoadableMod[],
    target: ModTarget,
    game: GameCode = emptyGameCode(),
    player: ModPlayer = noPlayer(),
    options: ModHostOptions = { files: noFiles() },
  ): ModHost {
    const host = new ModHost();
    host.#player = player;
    const gameScripts = new Set(game.scripts.map((script) => script.name));
    // What an insertion's token may name: a script, one of the game's object events, or one of the
    // pieces of code a room runs when it loads. All three are code entries, and the backend that
    // produced a token is the one that resolves it; this only refuses a token that names nothing in
    // *this* game, which is what catches a mod pointing at a statement it kept from another game or
    // made up.
    const gameEntries = new Set([
      ...gameScripts,
      ...game.events.map((entry) => entry.name),
      ...game.rooms.map((entry) => entry.name),
    ]);
    for (const { identity, activate } of mods) {
      if (host.#mods.some((m) => m.identity.id === identity.id)) {
        throw new Error(`mod ${identity.id}: loaded twice`);
      }

      const channel = modChannel(identity.id);
      // Eight hex characters of a hash, so a collision is possible rather than impossible. Two mods
      // sharing a channel would read each other's mail with no sign that anything was wrong, and
      // the only cure is for one of them to change its id -- which is a sentence worth printing
      // once in a blue moon rather than a bug worth chasing for an evening.
      const clash = host.#mods.find((m) => m.channel === channel);
      if (clash) {
        throw new Error(
          `mod ${identity.id}: its channel collides with ${clash.identity.id}'s. ` +
            `One of the two has to change its id.`,
        );
      }

      const ui = new UiSession({
        modId: identity.id,
        settings: { ...options.settings?.initial?.[identity.id] },
        onSettings: (settings) => options.settings?.save?.(identity.id, settings),
        onPatch: (patches) => host.#emitUi({ modId: identity.id, patches }),
        onError: (error, what) => console.error(`[mods] ${identity.id}: ${what} threw:`, error),
      });
      const mod: LoadedMod = {
        identity,
        channel,
        handlers: [],
        starters: [],
        players: [],
        resources: [],
        ui,
      };
      // Reads `host.#player`, so a mod that calls this after the channel opens sees whatever the
      // host last set rather than what it was loaded with.
      const getPlayer = (): ModPlayer => host.#player;
      const mailbox = modMailbox(identity.id);
      let activating = true;
      activate({
        identity,
        target,
        game,
        getPlayer,
        // Namespaced per mod, so two mods asking for "sheet.png" do not land on one file.
        files: { write: (name, bytes, at) => options.files.write(`${channel}_${name}`, bytes, at) },
        resource: {
          create: (resource) => {
            // Resources reach the engine before it is built, so one declared later could never be
            // installed. Saying so is far kinder than the silence that would otherwise follow.
            if (!activating) {
              throw new Error(
                `mod ${identity.id}: resource.create() is only valid during activate()`,
              );
            }
            // Two resources with the same name is not a near miss. On the GameMaker Studio side
            // the importer's `QueueReplace` finds an existing entry by name and *replaces* it, so
            // the second mod silently overwrites the first's events -- and a name the host game
            // already uses overwrites the game's own code. On GameMaker 8 the compiler registers
            // asset names with `or_insert`, so the duplicate simply becomes unreachable by name.
            // Neither says anything at run time, which is why it is said here.
            const name = installedName(resource);
            const taken =
              name !== null && host.#resources.find((existing) => installedName(existing) === name);
            if (taken) {
              throw new Error(
                `mod ${identity.id}: a resource called ${JSON.stringify(name)} is already ` +
                  `installed by another mod. Prefix it with something only this mod would use.`,
              );
            }
            if (resource.kind === "hook") {
              // Refused here rather than at install, where it would surface as a build error on one
              // backend and a silently unhooked game on another. Only the game's own scripts: a mod
              // that wants to change another mod's script should ask that mod for a way to.
              if (!gameScripts.has(resource.script)) {
                throw new Error(
                  `mod ${identity.id}: cannot hook ${JSON.stringify(resource.script)}, ` +
                    `which is not one of this game's scripts`,
                );
              }
              if (gameScripts.has(resource.original)) {
                throw new Error(
                  `mod ${identity.id}: a hook cannot keep the original under ` +
                    `${JSON.stringify(resource.original)}, the game already has a script called that`,
                );
              }
            } else if (resource.kind === "insert") {
              // Only what a token can answer. Whether the *statement* allows this --
              // "after" an `exit` has nothing following it -- is checked by the mod library, which
              // is holding the statement itself; and whether the address is what it claims is
              // checked by the backend, which is holding the code. Three layers, each refusing what
              // it can see.
              if (typeof resource.at !== "string" || resource.at === "") {
                throw new Error(
                  `mod ${identity.id}: this statement has no insertion point. Its \`at\` is ` +
                    `${JSON.stringify(resource.at)}, which the backend gives to a statement it ` +
                    `could not locate -- a \`for\` header's parts, or a compiler temporary.`,
                );
              }
              if (
                resource.place !== "before" &&
                resource.place !== "after" &&
                resource.place !== "instead"
              ) {
                throw new Error(
                  `mod ${identity.id}: an insertion's place is "before", "after" or "instead", ` +
                    `not ${JSON.stringify(resource.place)}`,
                );
              }
              const entry = atEntry(resource.at);
              if (!gameEntries.has(entry)) {
                throw new Error(
                  `mod ${identity.id}: cannot insert into ${JSON.stringify(entry)}, which is not ` +
                    `one of this game's scripts, object events or room code. The statement came from ` +
                    `somewhere else, or from a different game's code.`,
                );
              }
            } else if (resource.kind === "script" && gameScripts.has(resource.name)) {
              // The backends refuse this too, but only once the engine is being built. Saying it
              // during activate names the mod, and a caller previewing resources sees it as well.
              throw new Error(
                `mod ${identity.id}: this game already has a script called ` +
                  `${JSON.stringify(resource.name)}, and a mod may not replace one. Use a hook.`,
              );
            }
            host.#resources.push(resource);
            mod.resources.push(resource);
          },
        },
        gml: {
          // The channel prefix is added here rather than by the mod, so a mod cannot address
          // anyone else's mailbox even by accident: there is no way to write the prefix itself.
          send: (expression) => `host_send("${channel} " + (${expression}));`,
          receive: (variable) => `${variable} = "";
        if (ds_list_size(${mailbox}) > 0) {
          ${variable} = ds_list_find_value(${mailbox}, 0);
          ds_list_delete(${mailbox}, 0);
        }`,
        },
        send: (message) => host.#send(channel, message),
        ui: {
          state: (initial, stateOptions) => ui.state(initial, stateOptions),
          computed,
          panel: (panelOptions, render) => ui.panel(panelOptions, render),
        },
        on: (event, handler) => {
          if (event === "start") {
            // Already open: call it now rather than never. Only reachable for a mod loaded into a
            // host that is already running, which the desktop runtime does.
            if (host.#transport) (handler as () => void)();
            else mod.starters.push(handler as () => void);
            return;
          }
          if (event === "player") {
            // Not called on subscribe, unlike "start": the mod was handed this player at activate
            // and has already done whatever it does with it.
            mod.players.push(handler as (player: ModPlayer) => void);
            return;
          }
          // Checked rather than ignored. Mods are plain JavaScript, so the type on `ModApi.on` is
          // no protection at all, and the events this loader was planned with but has not built --
          // load, end -- are exactly the names a mod author would reach for. Silently registering
          // those as message handlers would have them fire on every message instead of once, which
          // reads as a mod that works and is subtly wrong.
          if (event !== "message") {
            throw new Error(
              `mod ${identity.id}: on(${JSON.stringify(event)}) is not an event this host has. ` +
                `The only ones are "message", "start" and "player".`,
            );
          }
          mod.handlers.push(handler as (message: string) => void);
        },
      });
      activating = false;
      ui.sealed();
      // After activate, not during: a mod is free to declare its insertions before the scripts they
      // call, and making declaration order load-bearing would be a rule nobody could guess from the
      // error. Its own scripts only -- calling another mod's would make one mod's install depend on
      // whether the player happened to tick another.
      const declared = new Set(mod.resources.filter((r) => r.kind === "script").map((r) => r.name));
      for (const resource of mod.resources) {
        if (resource.kind !== "insert") continue;
        if (!declared.has(resource.call)) {
          throw new Error(
            `mod ${identity.id}: its insertion into ${JSON.stringify(atEntry(resource.at))} calls ` +
              `${JSON.stringify(resource.call)}, which this mod never declared as a script. ` +
              `It has: ${[...declared].join(", ") || "none"}`,
          );
        }
      }
      host.#mods.push(mod);
    }
    return host;
  }

  /** Everything the loaded mods declared, in declaration order. What an author asked for, which
   *  is what the mod preview shows them -- see `installed` for what actually goes into a game. */
  get resources(): readonly Resource[] {
    return this.#resources;
  }

  /**
   * What is actually installed into the game: the loader's own runtime object, then the mods'.
   *
   * The runtime leads because instances are created in this order and it owns the mailboxes every
   * mod object reads -- its Create has to have run before any of theirs. It is omitted entirely
   * when no mod declared a resource, so a JavaScript-only mod still bakes nothing into a patched
   * game and cannot make one stale.
   */
  get installed(): readonly Resource[] {
    if (this.#resources.length === 0) return this.#resources;
    return [
      loaderRuntime(this.#mods.filter((m) => m.resources.length > 0).map((m) => m.identity.id)),
      ...this.#resources,
    ];
  }

  get identities(): readonly ModIdentity[] {
    return this.#mods.map((m) => m.identity);
  }

  /**
   * Every loaded mod's panels, as they stand right now.
   *
   * Only the mods that declared one: a panel-less mod contributing an empty entry would have the host
   * drawing a heading with nothing under it, which reads as a broken mod rather than a quiet one.
   */
  get ui(): readonly ModUiState[] {
    return this.#mods.filter((m) => m.ui.hasPanels).map((m) => m.ui.snapshot);
  }

  /**
   * Subscribes to UI changes. One subscriber -- the host -- since a patch is a statement about a tree
   * only one renderer holds.
   *
   * Anything buffered before now is delivered immediately, in order, so a subscriber that arrives
   * after the mods have already moved still ends up showing what `ui` would have told it.
   */
  onUiPatch(handler: (patch: ModUiPatch) => void): void {
    this.#uiHandler = handler;
    const buffered = this.#pendingUi.splice(0, this.#pendingUi.length);
    for (const patch of buffered) handler(patch);
  }

  /**
   * Applies something the player did in a mod's panel.
   *
   * Addressed by mod id: a panel event reaches the mod that drew it and nobody else, the same rule
   * the message channel follows.
   */
  dispatchUi(modId: string, event: UiEvent): void {
    const mod = this.#mods.find((m) => m.identity.id === modId);
    if (!mod) {
      console.warn(`[mods] a panel event arrived for ${modId}, which is not loaded`);
      return;
    }
    mod.ui.dispatch(event);
  }

  #emitUi(patch: ModUiPatch): void {
    if (this.#uiHandler) this.#uiHandler(patch);
    else this.#pendingUi.push(patch);
  }

  /**
   * Each loaded mod reduced to what a patched game depends on, for deciding whether a build on disk
   * is still current. Kept per mod rather than merged, because staleness is a per-mod question:
   * see `modBuildStamp` in the protocol for why that matters and what it becomes later.
   */
  get builds(): readonly ModBuildInput[] {
    return this.#mods.map((m) => ({ ...m.identity, resources: m.resources }));
  }

  /**
   * Connects the live channel, flushes anything mods sent during `activate()`, and tells every mod
   * the game is there.
   *
   * The flush goes first, so a mod that sent during activate and one that waited for `start` reach
   * the game in the order they spoke. A mod that throws from its handler is reported and skipped:
   * this is the moment the game becomes playable, and one broken mod must not take that with it.
   */
  /**
   * The player changed while the game is running.
   *
   * Only ever called after `load`, so `activate()` always saw the pinned value -- see `getPlayer`
   * for why that matters. A mod finds out by reading `getPlayer()` again; there is no event yet
   * because nothing here can tell which mods care.
   */
  setPlayer(player: ModPlayer): void {
    this.#player = player;
    for (const mod of this.#mods) {
      for (const handler of mod.players) {
        try {
          handler(player);
        } catch (error) {
          // One mod mishandling this must not stop the others hearing it, and must not take down a
          // game that is running perfectly well otherwise.
          console.error(`[mods] ${mod.identity.id}: its player handler threw:`, error);
        }
      }
    }
  }

  attach(transport: ModTransport): void {
    this.#transport = transport;
    for (const message of this.#pending) transport.send(message);
    this.#pending.length = 0;
    for (const mod of this.#mods) {
      for (const start of mod.starters) {
        try {
          start();
        } catch (error) {
          console.error(`[mods] ${mod.identity.id}: its start handler threw:`, error);
        }
      }
    }
  }

  /**
   * Moves one frame's worth of messages from the game to the mods. Call once per frame, from the
   * engine adapter's step wrapper.
   *
   * Every message goes to every mod. There is no addressing yet, which is fine while a session runs
   * a handful of mods that each recognise their own traffic -- and is the kind of thing the protocol
   * can add without any engine ever changing.
   */
  pump(): void {
    if (!this.#transport) return;
    for (const message of this.#transport.drain()) {
      const at = message.indexOf(" ");
      const channel = at > 0 ? message.slice(0, at) : "";
      const mod = this.#mods.find((m) => m.channel === channel);
      if (!mod) {
        // Unaddressed, so there is no honest recipient. In practice it is GML calling `host_send`
        // directly, which is how a mod was written under API v1 -- and since the loader's runtime
        // object drops those on the game's side too, this line is the only account of where a
        // mod's messages went.
        console.warn(
          `[mods] dropped a message addressed to nobody: ${JSON.stringify(message.slice(0, 80))}. ` +
            `GML must send through the statements in \`api.gml\`, not \`host_send\` directly.`,
        );
        continue;
      }
      const body = message.slice(at + 1);
      for (const handler of mod.handlers) {
        try {
          // Batched, so a handler that writes five refs its panel reads produces one round of
          // patches rather than five. See `batch` in ./reactive.
          batch(() => handler(body));
        } catch (error) {
          // Guarded for the same reason `attach` guards its start handlers, and more urgently: the
          // transport is already drained, so letting this escape would lose every message still in
          // the batch as well. The engine adapters call `pump` straight from their step wrapper, so
          // it would also take the running game down with it.
          console.error(`[mods] ${mod.identity.id}: its message handler threw:`, error);
        }
      }
    }
  }

  #send(channel: string, message: string): void {
    const addressed = `${channel} ${message}`;
    if (this.#transport) this.#transport.send(addressed);
    else this.#pending.push(addressed);
  }
}

/**
 * Imports mod modules by URL.
 *
 * Separate from `ModHost.load` so the host itself stays synchronous and testable without a module
 * loader, and so a desktop host can supply its modules from disk instead.
 *
 * The source is **fetched and imported from a blob URL** rather than `import(url)` directly,
 * because that is what the real thing has to do: a mod is a bundle fetched at runtime, not a module
 * the host was built against, and a bundler would otherwise try to resolve it.
 *
 * The one thing it costs: a mod is a single file. Relative imports inside it resolve against the
 * blob URL, which has no meaningful base. Multi-file mods will need their bundle flattened, which
 * is what publishing one should do anyway.
 *
 * Each source carries its identity alongside its URL, and they come back paired, so a caller hands
 * `ModHost.load` a list it never has to keep in step with a second one. The two were parallel
 * arrays until identity moved out of the bundle, and "these line up as long as both preserve order"
 * is exactly the invariant that is true until someone filters one of them.
 */
export async function importMods(sources: readonly ModSource[]): Promise<LoadableMod[]> {
  return Promise.all(
    sources.map(async ({ url, ...identity }) => {
      // `no-cache` revalidates rather than bypassing the cache: a 304 still costs nothing, but an
      // edited mod at the same URL is never served stale. Without it, iterating on a mod during
      // development silently keeps running the previous copy -- which reads as the change having
      // had no effect, and is a genuinely nasty hour to lose.
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`mod at ${url}: fetch failed (${response.status})`);
      return evaluateMod({ ...identity, url, source: await response.text() });
    }),
  );
}

/** A mod whose bundle the caller already has, rather than a URL to go and get it from. */
export interface ModText extends ModIdentity {
  /** Only for error messages and `asModActivate` -- nothing is fetched from it. */
  url: string;
  source: string;
}

/**
 * The same evaluation as `importMods`, for a caller holding the bundle already.
 *
 * That is a desktop host: an installed game's mods are cached on disk so it plays offline, and its
 * main process is the side with the disk. It reads them and hands the text over, rather than a
 * renderer fetching a URL that may not be reachable -- which is the whole point of the cache.
 */
export async function importModSources(sources: readonly ModText[]): Promise<LoadableMod[]> {
  return Promise.all(sources.map(evaluateMod));
}

async function evaluateMod({ url, source, ...identity }: ModText): Promise<LoadableMod> {
  const blobUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return { identity, activate: asModActivate(await import(/* @vite-ignore */ blobUrl), url) };
  } finally {
    // The module stays live once evaluated; the URL only has to survive that.
    URL.revokeObjectURL(blobUrl);
  }
}
