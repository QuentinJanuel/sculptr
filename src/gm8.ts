// The GameMaker 8 backend: gm8-lib's gm8patch, built by scripts/build.ts into ./gm8 beside this
// module's bundle with wasm-bindgen's `web` target, whose loader takes the wasm as bytes as readily
// as by URL -- so the only realm-specific line is how those bytes are read.
import type { Resource } from "./resources.js";
import { toGm8Hooks, toGm8Inserts, toGm8Objects, toGm8Scripts } from "./gm8-lowering.js";
import type { Backend } from "./index.js";

/** The subset of gm8patch's exports this uses. */
export interface Gm8Patch {
  game_code_gm8(exe: Uint8Array): string;
  patch_gm8_exe(
    exe: Uint8Array,
    scripts: string,
    inserts: string,
    hooks: string,
    objects: string,
  ): Uint8Array;
}

export function gm8Backend(gm8patch: Gm8Patch): Backend {
  return {
    gameCode: (bytes) => gm8patch.game_code_gm8(bytes),
    patch: (bytes, resources: readonly Resource[]) =>
      gm8patch.patch_gm8_exe(
        bytes,
        JSON.stringify(toGm8Scripts(resources)),
        JSON.stringify(toGm8Inserts(resources)),
        JSON.stringify(toGm8Hooks(resources)),
        JSON.stringify(toGm8Objects(resources)),
      ),
  };
}

export async function loadGm8(): Promise<Backend> {
  const module = (await import(
    /* @vite-ignore */ new URL("./gm8/gm8patch.js", import.meta.url).href
  )) as Gm8Patch & { default(options: { module_or_path: unknown }): Promise<unknown> };
  const wasm = new URL("./gm8/gm8patch_bg.wasm", import.meta.url);
  // Node's fetch refuses file: URLs, so a local copy is read off disk instead.
  const module_or_path =
    wasm.protocol === "file:" ? await (await import("node:fs/promises")).readFile(wasm) : wasm;
  await module.default({ module_or_path });
  return gm8Backend(module);
}
