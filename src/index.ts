// sculptr: a GameMaker game file and the resources mods declare in, a modded game file out.
//
// One backend per GameMaker family, each a GameMaker library linked directly: gm8-lib's gm8patch
// for a GameMaker 8 executable, gms-lib for a Studio data.win. No emulator is involved at any point.
// The backends are loaded on first use, by URL relative to this module, so the same built file runs
// in Node and in a browser worker. See LICENSING.md for what linking both means.
import type { Resource } from "./resources.js";
import { loadGm8 } from "./gm8.js";
import { loadGms } from "./gms.js";

export type { Resource };
export { parseGameCode, type GameCode } from "./game-code.js";

export type Format = "gm8" | "gms";

/** What one GameMaker library has to answer. */
export interface Backend {
  /** The game's code as `GameCode` JSON. */
  gameCode(bytes: Uint8Array): string;
  /** The game with `resources` installed. */
  patch(bytes: Uint8Array, resources: readonly Resource[]): Uint8Array;
}

/** Asked for a format no backend handles. */
export class UnsupportedFormat extends Error {
  override name = "UnsupportedFormat";
  constructor(readonly format: string) {
    super(`sculptr handles gm8 and gms games, not "${format}"`);
  }
}

/** A backend refused the game or the resources: a name clash, an insertion it cannot place. */
export class PatchFailed extends Error {
  override name = "PatchFailed";
}

/** A modder over the given backends. The exports below are this over the real ones. */
export function modder(loaders: Record<Format, () => Promise<Backend>>) {
  const loaded = new Map<Format, Promise<Backend>>();

  function backend(format: Format): Promise<Backend> {
    if (!Object.hasOwn(loaders, format)) return Promise.reject(new UnsupportedFormat(format));
    let promise = loaded.get(format);
    if (!promise) {
      promise = loaders[format]();
      loaded.set(format, promise);
      // A failed load must not answer every later call with the same rejection.
      promise.catch(() => loaded.delete(format));
    }
    return promise;
  }

  async function run<T>(format: Format, call: (backend: Backend) => T): Promise<T> {
    const loadedBackend = await backend(format);
    try {
      return call(loadedBackend);
    } catch (error) {
      // wasm-bindgen throws strings and .NET throws its own Error subclass; one name for both.
      throw new PatchFailed(error instanceof Error ? error.message : String(error), {
        cause: error,
      });
    }
  }

  return {
    /** Starts loading a backend ahead of the first call, so its boot overlaps the caller's work. */
    prepare: (format: Format): Promise<void> => backend(format).then(() => {}),
    gameCode: (format: Format, bytes: Uint8Array) => run(format, (b) => b.gameCode(bytes)),
    patch: (format: Format, bytes: Uint8Array, resources: readonly Resource[]) =>
      run(format, (b) => b.patch(bytes, resources)),
  };
}

export const { prepare, gameCode, patch } = modder({ gm8: loadGm8, gms: loadGms });
