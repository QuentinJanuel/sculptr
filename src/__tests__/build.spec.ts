/**
 * What decides that a patched game is out of date.
 *
 * These are the properties a host relies on to rebuild by itself, so they are pinned here
 * rather than left to the one caller: the point of the abstraction is that its *policy* can be
 * swapped for versioning later without any caller changing, and these tests are what say the policy
 * is still the one everything downstream assumes.
 */
import { describe, expect, it } from "vitest";
import { objectResources, scriptResources, type Resource } from "../resources.js";
import {
  loaderRuntime,
  LOADER_ABI,
  modBuildKey,
  modBuildStamp,
  modChannel,
  type ModBuildInput,
} from "../contract.js";
import { toGm8Hooks, toGm8Objects, toGm8Scripts } from "../gm8-lowering.js";
import { toGmsHooks, toGmsObjects, toGmsScripts } from "../gms-lowering.js";

/** Not a real hash: these tests are about what goes in, not what comes out. */
const identity = (input: string): string => input;

function mod(id: string, version: string, events: Record<string, string> = {}): ModBuildInput {
  const resources = Object.keys(events).length
    ? [{ kind: "object" as const, name: `${id}_obj`, events }]
    : [];
  return { id, version, resources };
}

describe("modBuildStamp", () => {
  it("is null for a mod that bakes nothing into the game", () => {
    expect(modBuildStamp(mod("a.js-only", "1.0.0"))).toBeNull();
  });

  it("changes when a mod's GML changes", () => {
    const before = modBuildStamp(mod("a", "1.0.0", { create: "x = 1;" }));
    const after = modBuildStamp(mod("a", "1.0.0", { create: "x = 2;" }));
    expect(before).not.toEqual(after);
  });

  it("changes when only the version changes", () => {
    const before = modBuildStamp(mod("a", "1.0.0", { create: "x = 1;" }));
    const after = modBuildStamp(mod("a", "1.0.1", { create: "x = 1;" }));
    expect(before).not.toEqual(after);
  });

  it("tells apart two mods declaring identical resources", () => {
    const one = modBuildStamp({
      ...mod("a", "1.0.0", { create: "x = 1;" }),
      id: "a",
    });
    const two = modBuildStamp({
      ...mod("a", "1.0.0", { create: "x = 1;" }),
      id: "b",
    });
    expect(one).not.toEqual(two);
  });
});

describe("modBuildKey", () => {
  const hud = mod("hud", "1.0.0", { draw: "draw_text(8, 8, m);" });
  const dialog = mod("dialog", "2.1.0", { create: 'show_message("hi");' });
  const jsOnly = mod("twitch", "1.0.0");

  it("is null when nothing would be baked, so no tree is needed", () => {
    expect(modBuildKey([], identity)).toBeNull();
    expect(modBuildKey([jsOnly], identity)).toBeNull();
  });

  it("does not depend on the order mods were enabled in", () => {
    expect(modBuildKey([hud, dialog], identity)).toEqual(modBuildKey([dialog, hud], identity));
  });

  // The whole point of separating "what runs" from "what is baked": toggling a mod that ships only
  // JavaScript must never cost the player a rebuild.
  it("is unchanged by adding or removing a JavaScript-only mod", () => {
    expect(modBuildKey([hud, jsOnly], identity)).toEqual(modBuildKey([hud], identity));
  });

  it("changes when a mod is genuinely added", () => {
    expect(modBuildKey([hud], identity)).not.toEqual(modBuildKey([hud, dialog], identity));
  });

  it("changes when an enabled mod's GML is edited", () => {
    const edited = mod("hud", "1.0.0", { draw: "draw_text(8, 24, m);" });
    expect(modBuildKey([hud], identity)).not.toEqual(modBuildKey([edited], identity));
  });

  // What makes a tree patched by an older build rebuild itself: the launch arguments a patched game
  // reads are spelled out in each engine's patcher, so nothing else in this hash can notice that
  // they were renamed. A key that did not carry the revision would leave a game running with mods
  // that silently never receive anything.
  it("carries the loader ABI revision, so a renamed launch protocol invalidates old trees", () => {
    const key = modBuildKey([hud], identity);
    expect(key).toContain(String(LOADER_ABI));
    expect(key).not.toEqual(identity(JSON.stringify([LOADER_ABI + 1, ...parse(key!).slice(1)])));
  });
});

/** The identity hash means the key is its own input, so a test can read what went into it. */
function parse(key: string): unknown[] {
  return JSON.parse(key) as unknown[];
}

describe("modChannel", () => {
  // The GML is written when a game is installed and the JavaScript is loaded when it launches, so
  // the two derive this separately and have to agree. Anything positional would not.
  it("depends on the mod's id and nothing else", () => {
    expect(modChannel("example.coord-hud")).toBe(modChannel("example.coord-hud"));
    expect(modChannel("example.coord-hud")).not.toBe(modChannel("example.random-dog"));
  });

  it("is short, because it rides on every message", () => {
    expect(modChannel("example.coord-hud")).toMatch(/^m[0-9a-f]{8}$/);
  });

  // A channel an engine can read as a number stops comparing equal to itself in at least one of
  // them -- see modChannel. About one id in a hundred hashed to one before the `m`; this walks
  // enough of them that a regression could not hide behind a lucky sample.
  it("never looks like a number, whatever the id hashes to", () => {
    for (let index = 0; index < 20000; index += 1) {
      const channel = modChannel(`example.mod-${index}`);
      expect(Number.isNaN(Number(channel))).toBe(true);
    }
  });
});

describe("loaderRuntime", () => {
  it("gives every mod a mailbox and a route to it", () => {
    const runtime = loaderRuntime(["a", "b"]);
    for (const id of ["a", "b"]) {
      expect(runtime.events.create).toContain(
        `global.__mod_box_${modChannel(id)} = ds_list_create()`,
      );
      expect(runtime.events.beginStep).toContain(`__mod_rt_ch == "${modChannel(id)}"`);
    }
  });

  // Begin Step runs across every instance before any Step event, so a mod sees this frame's mail
  // whatever order the player's list put it in. In Step that would be a race.
  it("drains in Begin Step, not Step", () => {
    const runtime = loaderRuntime(["a"]);
    expect(runtime.events.beginStep).toContain("host_receive()");
    expect(runtime.events.step).toBeUndefined();
  });

  it("survives a room change, or it would stop draining at the first screen", () => {
    expect(loaderRuntime(["a"]).persistent).toBe(true);
  });

  // Otherwise the fingerprint below moves on its own whenever a player reorders their mods.
  it("does not depend on the order it was given the mods", () => {
    expect(loaderRuntime(["a", "b"])).toEqual(loaderRuntime(["b", "a"]));
  });
});

describe("lowering a mixed resource list", () => {
  const resources: Resource[] = [
    { kind: "script", name: "helper", source: "return argument0;" },
    { kind: "object", name: "thing", events: { step: "x = helper(1);" } },
  ];

  // Each installer takes them as two lists, because it installs them in two calls -- scripts
  // first, or an object's call to one compiles as something else.
  it("hands each engine the scripts and the objects apart", () => {
    expect(toGm8Scripts(resources).map((s) => s.name)).toEqual(["helper"]);
    expect(toGm8Objects(resources).map((o) => o.name)).toEqual(["thing"]);
    expect(toGmsScripts(resources).map((s) => s.name)).toEqual(["helper"]);
    expect(toGmsObjects(resources).map((o) => o.name)).toEqual(["thing"]);
  });

  it("keeps a script's source verbatim -- it is not an event and has no lowering", () => {
    expect(toGm8Scripts(resources)[0]!.source).toBe("return argument0;");
  });

  it("narrows by kind without reordering", () => {
    expect(scriptResources(resources).length).toBe(1);
    expect(objectResources(resources).length).toBe(1);
  });

  // A mod that adds a script has changed what gets baked into the game.
  it("changes the build key", () => {
    const withScript = { id: "a", version: "1.0.0", resources };
    const withoutScript = { id: "a", version: "1.0.0", resources: resources.slice(1) };
    expect(modBuildKey([withScript], identity)).not.toBe(modBuildKey([withoutScript], identity));
  });
});

describe("hooks", () => {
  const resources: Resource[] = [
    { kind: "object", name: "o", events: { create: "x = 1;" } },
    { kind: "hook", script: "saveGame", original: "m_first", source: "return m_first();" },
    { kind: "script", name: "s", source: "return 1;" },
    { kind: "hook", script: "saveGame", original: "m_second", source: "return m_second();" },
  ];

  it("lowers the same way for both engines, in chain order, and never as an object or script", () => {
    const expected = [
      { script: "saveGame", original: "m_first", source: "return m_first();" },
      { script: "saveGame", original: "m_second", source: "return m_second();" },
    ];
    expect(toGm8Hooks(resources)).toEqual(expected);
    expect(toGmsHooks(resources)).toEqual(expected);
    expect(toGm8Objects(resources).map((o) => o.name)).toEqual(["o"]);
    expect(toGmsScripts(resources).map((s) => s.name)).toEqual(["s"]);
  });

  it("is part of what makes a patched game stale", () => {
    const before = modBuildStamp({ id: "m", version: "1", resources: resources.slice(0, 2) });
    const after = modBuildStamp({ id: "m", version: "1", resources });
    expect(before).not.toEqual(after);
  });
});
