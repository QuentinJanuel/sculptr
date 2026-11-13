/**
 * Flattening mod resources into the calls gms-lib's patcher takes, with the protocol's defaults
 * applied once, for `./gms`. GameMaker Studio's event naming is gms-lib's; see `./gm8-lowering` for
 * the GameMaker 8 counterpart.
 */

import { hookResources, insertResources, objectResources, scriptResources } from "./resources.js";
import type { ObjectEventName, Resource } from "./resources.js";

/**
 * One object, flattened into what gms-lib's staging calls take.
 *
 * Events keep the contract's names; gms-lib maps them onto GameMaker Studio's code entry names.
 */
export interface GmsModObject {
  name: string;
  depth: number;
  persistent: boolean;
  visible: boolean;
  events: { event: ObjectEventName; source: string }[];
}

/**
 * Defaults are applied here, once, because they are the *protocol's* defaults rather than either
 * engine's -- a resource that omits `depth` must mean the same thing to both backends.
 */
export function toGmsObjects(resources: readonly Resource[]): GmsModObject[] {
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
export interface GmsModScript {
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
export function toGmsScripts(resources: readonly Resource[]): GmsModScript[] {
  return scriptResources(resources).map((resource) => ({
    name: resource.name,
    source: resource.source,
  }));
}

/** One hook, flattened the way this engine's installer takes it. See `HookResource`. */
export interface GmsModHook {
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
export function toGmsHooks(resources: readonly Resource[]): GmsModHook[] {
  return hookResources(resources).map((resource) => ({
    script: resource.script,
    original: resource.original,
    source: resource.source,
  }));
}

/** One insertion, flattened the way this engine's installer takes it. See `InsertResource`. */
export interface GmsModInsert {
  at: string;
  /** `"instead"` reaches here too; this engine's installer refuses it. */
  place: "before" | "after" | "instead";
  call: string;
}

/**
 * The insertions in a resource list, in declaration order.
 *
 * Installed after the mods' own scripts (so the call resolves) and **before** the hooks: `at` names
 * addresses in the game's original code entry, and a hook moves that whole entry aside.
 */
export function toGmsInserts(resources: readonly Resource[]): GmsModInsert[] {
  return insertResources(resources).map((resource) => ({
    at: resource.at,
    place: resource.place,
    call: resource.call,
  }));
}
