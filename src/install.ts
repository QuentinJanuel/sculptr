// Mods in, a modded game out: what `sculptr patch --mod` does once the bundles are loaded. The same
// steps a host takes before it starts a modded game -- read the game's code, run every activate()
// against it, patch in what they declared -- with no game started afterwards.
import { defaultControls, parseControls, type ModPlayer } from "./contract.js";
import { parseGameCode } from "./game-code.js";
import { ModHost, type LoadableMod } from "./runtime/index.js";
import type { Format, modder } from "./index.js";

/**
 * The game with these mods installed, or the game's own bytes when they declare nothing to bake.
 *
 * Throws before patching when a mod fails to activate, so a caller has nothing to write.
 */
export async function installMods(
  backends: Pick<ReturnType<typeof modder>, "gameCode" | "patch">,
  format: Format,
  bytes: Uint8Array,
  mods: readonly LoadableMod[],
  player?: ModPlayer,
): Promise<Uint8Array> {
  const game = parseGameCode(await backends.gameCode(format, bytes));
  const installed = ModHost.load(mods.map(named), { engine: format }, game, player).installed;
  return installed.length > 0 ? backends.patch(format, bytes, installed) : bytes;
}

/** A data.win is an IFF file; anything else is taken for a GameMaker 8 executable. */
export function formatOf(bytes: Uint8Array): Format {
  return new TextDecoder().decode(bytes.subarray(0, 4)) === "FORM" ? "gms" : "gm8";
}

/** A mod's own throw says nothing about which mod threw; this puts its id in front. */
export function named({ identity, activate }: LoadableMod): LoadableMod {
  return {
    identity,
    activate: (api) => {
      try {
        activate(api);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`mod ${identity.id} failed to activate: ${message}`, { cause: error });
      }
    },
  };
}

/**
 * A `ModPlayer` from JSON. A field left out reads as nobody signed in would (`noPlayer()`); any
 * field the contract does not name is the host's own and passes through untouched.
 */
export function parsePlayer(json: string): ModPlayer {
  const value = JSON.parse(json) as Record<string, unknown> | null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--player: not a JSON object");
  }
  const { account = null, language = "en" } = value as Partial<ModPlayer>;
  if (account !== null && (typeof account.id !== "string" || typeof account.name !== "string")) {
    throw new Error("--player: account is null or { id, name }, both strings");
  }
  if (typeof language !== "string") throw new Error("--player: language is a string");
  const controls = value.controls === undefined ? defaultControls() : parseControls(value.controls);
  if (!controls) throw new Error("--player: controls are not a valid set of bindings");
  return { ...value, account, language, controls };
}
