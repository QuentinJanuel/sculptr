// The GameMaker Studio backend: gms-lib's AOT .NET runtime, copied by scripts/build.ts into ./gms
// beside this module's bundle. The runtime hosts under Node as well as in a browser worker --
// `_framework/dotnet.js` branches on `process.versions.node` -- and holds no per-game state between
// calls, so one instance serves every game for the life of the process.
import type { Resource } from "./resources.js";
import { toGmsHooks, toGmsInserts, toGmsObjects, toGmsScripts } from "./gms-lowering.js";
import type { Backend } from "./index.js";

/** The subset of gms-lib's `WasmEntry` exports this uses. */
export interface GmsEntry {
  ClearMods(): void;
  AddModScript(name: string, source: string): void;
  AddModInsert(at: string, place: string, call: string): void;
  AddModHook(script: string, original: string, source: string): void;
  AddModObject(name: string, depth: number, persistent: boolean, visible: boolean): void;
  AddModObjectEvent(eventName: string, source: string): void;
  PatchDataWin(bytes: Uint8Array): Uint8Array;
  GameCodeFromDataWin(bytes: Uint8Array): string;
}

export function gmsBackend(entry: GmsEntry): Backend {
  return {
    gameCode: (bytes) => entry.GameCodeFromDataWin(bytes),
    patch: (bytes, resources: readonly Resource[]) => {
      entry.ClearMods();
      // Scripts, insertions, hooks, then objects: the order gms-lib's ModInstaller installs them
      // in. A hook may call a mod's script and an object may call either; insertions go before
      // hooks because their addresses name the game's original code entry, which a hook moves.
      for (const script of toGmsScripts(resources)) entry.AddModScript(script.name, script.source);
      for (const insert of toGmsInserts(resources))
        entry.AddModInsert(insert.at, insert.place, insert.call);
      for (const hook of toGmsHooks(resources))
        entry.AddModHook(hook.script, hook.original, hook.source);
      for (const object of toGmsObjects(resources)) {
        entry.AddModObject(object.name, object.depth, object.persistent, object.visible);
        for (const event of object.events) entry.AddModObjectEvent(event.event, event.source);
      }
      return entry.PatchDataWin(bytes);
    },
  };
}

export async function loadGms(): Promise<Backend> {
  const { dotnet } = (await import(
    /* @vite-ignore */ new URL("./gms/_framework/dotnet.js", import.meta.url).href
  )) as {
    dotnet: {
      create(): Promise<{
        getConfig(): { mainAssemblyName: string };
        getAssemblyExports(name: string): Promise<{ GmsLib: { WasmEntry: GmsEntry } }>;
      }>;
    };
  };
  const runtime = await dotnet.create();
  const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
  return gmsBackend(exports.GmsLib.WasmEntry);
}
