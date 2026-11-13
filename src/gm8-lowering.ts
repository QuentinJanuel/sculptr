/**
 * Flattening mod resources into the JSON gm8patch takes, with the protocol's defaults applied once.
 * The counterpart to `./gms-lowering`, used by `./gm8`. GameMaker 8's event numbering is gm8-lib's.
 */
import { hookResources, insertResources, objectResources, scriptResources } from "./resources.js";
import type { ObjectEventName, Resource } from "./resources.js";

/**
 * One mod object, flattened the way gm8patch decodes it.
 *
 * Events keep the contract's names; gm8-lib maps them onto GameMaker 8's event lists.
 */
export interface Gm8ModObject {
  name: string;
  depth: number;
  persistent: boolean;
  visible: boolean;
  events: { event: ObjectEventName; source: string }[];
}

/**
 * Applies the protocol's defaults and flattens the events.
 *
 * Defaults live here rather than in Rust so that one place decides what an omitted field means, and
 * both engines inherit the same answer.
 */
export function toGm8Objects(resources: readonly Resource[]): Gm8ModObject[] {
  return objectResources(resources).map((resource) => ({
    name: resource.name,
    depth: resource.depth ?? -1000000,
    persistent: resource.persistent ?? true,
    visible: resource.visible ?? true,
    events: Object.entries(resource.events).flatMap(([event, source]) =>
      source ? [{ event: event as ObjectEventName, source }] : [],
    ),
  }));
}

/** One script, flattened the way this engine's installer takes it. */
export interface Gm8ModScript {
  name: string;
  source: string;
}

/**
 * The scripts in a resource list, which every installer puts in *before* the objects.
 *
 * Its own function rather than a field on the object lowering because the two are installed by
 * separate calls in every backend, and because the ordering between them is the whole reason this
 * distinction exists -- see `scriptResources`.
 */
export function toGm8Scripts(resources: readonly Resource[]): Gm8ModScript[] {
  return scriptResources(resources).map((resource) => ({
    name: resource.name,
    source: resource.source,
  }));
}

/** One hook, flattened the way this engine's installer takes it. See `HookResource`. */
export interface Gm8ModHook {
  script: string;
  original: string;
  source: string;
}

/**
 * The hooks in a resource list, in chain order.
 *
 * Installed after the mods' own scripts and before their objects: a hook's body may call a mod
 * script, and a mod object may call a hooked script.
 */
export function toGm8Hooks(resources: readonly Resource[]): Gm8ModHook[] {
  return hookResources(resources).map((resource) => ({
    script: resource.script,
    original: resource.original,
    source: resource.source,
  }));
}

/** One insertion, flattened the way this engine's installer takes it. See `InsertResource`. */
export interface Gm8ModInsert {
  at: string;
  place: "before" | "after" | "instead";
  call: string;
}

/**
 * The insertions in a resource list, in declaration order.
 *
 * Installed after the mods' own scripts (so the call resolves) and **before** the hooks: `at` points
 * into the game's original source, and a hook moves that source wholesale once it has been edited.
 */
export function toGm8Inserts(resources: readonly Resource[]): Gm8ModInsert[] {
  return insertResources(resources).map((resource) => ({
    at: resource.at,
    place: resource.place,
    call: resource.call,
  }));
}
