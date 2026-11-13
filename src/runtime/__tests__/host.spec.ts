/**
 * The host's guarantees to a mod author.
 *
 * These are the rules a mod is written against, and every one of them is a thing that fails
 * silently if it regresses: a mod whose resources never reach the engine, a handler that fires on
 * the wrong events, two mods where one was meant to replace the other. Worth pinning even though
 * the host itself is small.
 */
import { modChannel } from "../../contract.js";
import {
  insertResources,
  objectResources,
  scriptResources,
  type InsertResource,
} from "../../resources.js";
import { emptyGameCode, type At, type GameCode } from "../../game-code.js";
import { describe, expect, it, vi } from "vitest";
import { asModActivate, ModHost, type LoadableMod, type ModApi } from "../index.js";

const target = { engine: "gms" } as const;

function mod(id: string, activate: (api: ModApi) => void, version = "1.0.0"): LoadableMod {
  return { identity: { id, version }, activate };
}

const object = (name: string) => ({
  kind: "object" as const,
  name,
  events: { create: "x = 1;" },
});

const script = (name: string) => ({
  kind: "script" as const,
  name,
  source: "return argument0;",
});

/** One message as it crosses the wire: addressed to a mod, and never to nobody. */
const to = (id: string, body: string) => `${modChannel(id)} ${body}`;

describe("ModHost.load", () => {
  it("collects what mods declare, in declaration order", () => {
    const host = ModHost.load(
      [
        mod("a", (api) => api.resource.create(object("a_obj"))),
        mod("b", (api) => api.resource.create(object("b_obj"))),
      ],
      target,
    );
    expect(objectResources(host.resources).map((r) => r.name)).toEqual(["a_obj", "b_obj"]);
  });

  it("keeps each mod's resources attributed to it, for the build key", () => {
    const host = ModHost.load(
      [mod("a", (api) => api.resource.create(object("a_obj"))), mod("js-only", () => {})],
      target,
    );
    expect(host.builds.map((b) => [b.id, b.resources.length])).toEqual([
      ["a", 1],
      ["js-only", 0],
    ]);
  });

  it("hands every mod the target, so it can choose its GML", () => {
    const seen: string[] = [];
    ModHost.load([mod("a", (api) => seen.push(api.target.engine))], {
      engine: "gm8",
    });
    expect(seen).toEqual(["gm8"]);
  });

  it("refuses the same mod twice", () => {
    expect(() => ModHost.load([mod("a", () => {}), mod("a", () => {})], target)).toThrow(
      /loaded twice/,
    );
  });

  // On the GameMaker Studio side the importer replaces an existing entry of the same name, so the
  // second mod would overwrite the first's events -- or the host game's own, silently.
  it("refuses two mods that would install a resource under the same name", () => {
    expect(() =>
      ModHost.load(
        [
          mod("a", (api) => api.resource.create(object("shared"))),
          mod("b", (api) => api.resource.create(object("shared"))),
        ],
        target,
      ),
    ).toThrow(/already installed by another mod/);
  });

  // Objects and scripts share one asset namespace in GameMaker, so this is the same clash.
  it("refuses a script and an object that would share a name", () => {
    expect(() =>
      ModHost.load(
        [
          mod("a", (api) => api.resource.create(script("shared"))),
          mod("b", (api) => api.resource.create(object("shared"))),
        ],
        target,
      ),
    ).toThrow(/already installed by another mod/);
  });

  it("collects scripts alongside objects, attributed to the mod that declared them", () => {
    const host = ModHost.load(
      [
        mod("a", (api) => {
          api.resource.create(script("a_helper"));
          api.resource.create(object("a_obj"));
        }),
      ],
      target,
    );
    expect(scriptResources(host.installed).map((r) => r.name)).toEqual(["a_helper"]);
    expect(objectResources(host.installed).map((r) => r.name)).toEqual(["mod_runtime", "a_obj"]);
    expect(host.builds[0]!.resources.length).toBe(2);
  });

  it("refuses a resource declared after activate, which could never be installed", () => {
    let escaped: ModApi | null = null;
    ModHost.load([mod("a", (api) => void (escaped = api))], target);
    expect(() => escaped!.resource.create(object("late"))).toThrow(/only valid during activate/);
  });

  // The type on ModApi.on is no protection: mods are plain JavaScript. Registering an unknown
  // event as a message handler would fire it on every message instead of once.
  it("refuses an event it does not implement, rather than treating it as a message handler", () => {
    expect(() =>
      ModHost.load([mod("a", (api) => api.on("end" as "message", () => {}))], target),
    ).toThrow(/not an event this host has/);
  });
});

describe("the game's code", () => {
  const game: GameCode = {
    ...emptyGameCode(),
    scripts: [{ name: "saveGame", body: [{ k: "exit", value: null }] }],
  };
  const hook = (script: string, original: string) => ({
    kind: "hook" as const,
    script,
    original,
    source: `return ${original}();`,
  });

  it("is handed to every mod during activate", () => {
    let seen: GameCode | null = null;
    ModHost.load([mod("a", (api) => (seen = api.game))], target, game);
    expect(seen).toBe(game);
  });

  it("is empty when the backend could not read it", () => {
    let seen: GameCode | null = null;
    ModHost.load([mod("a", (api) => (seen = api.game))], target);
    expect(seen).toEqual(emptyGameCode());
  });

  it("accepts a hook on one of the game's scripts", () => {
    const host = ModHost.load(
      [mod("a", (api) => api.resource.create(hook("saveGame", "a_saveGame")))],
      target,
      game,
    );
    expect(host.resources).toEqual([hook("saveGame", "a_saveGame")]);
  });

  it("refuses a hook on a script the game does not have", () => {
    expect(() =>
      ModHost.load([mod("a", (api) => api.resource.create(hook("nope", "a_nope")))], target, game),
    ).toThrow(/not one of this game's scripts/);
  });

  it("refuses a hook whose original would take a name the game uses", () => {
    expect(() =>
      ModHost.load(
        [mod("a", (api) => api.resource.create(hook("saveGame", "saveGame")))],
        target,
        game,
      ),
    ).toThrow(/already has a script called/);
  });

  it("chains two mods' hooks on one script, and refuses two that keep the same original", () => {
    const chained = ModHost.load(
      [
        mod("a", (api) => api.resource.create(hook("saveGame", "a_saveGame"))),
        mod("b", (api) => api.resource.create(hook("saveGame", "b_saveGame"))),
      ],
      target,
      game,
    );
    expect(chained.resources).toHaveLength(2);
    expect(() =>
      ModHost.load(
        [
          mod("a", (api) => api.resource.create(hook("saveGame", "same"))),
          mod("b", (api) => api.resource.create(hook("saveGame", "same"))),
        ],
        target,
        game,
      ),
    ).toThrow(/already installed by another mod/);
  });

  it("refuses a mod script named after one of the game's", () => {
    expect(() =>
      ModHost.load([mod("a", (api) => api.resource.create(script("saveGame")))], target, game),
    ).toThrow(/Use a hook/);
  });
});

describe("insertions", () => {
  // GameMaker 8, because that is the only engine that installs these so far.
  const target = { engine: "gm8" } as const;
  // One statement with a token, one without: the pair every refusal below is written against.
  const at = "saveGame#7,21" as At;
  const game: GameCode = {
    ...emptyGameCode(),
    scripts: [
      {
        name: "saveGame",
        body: [
          {
            k: "assign",
            at,
            target: { k: "var", scope: "global", name: "x" },
            op: "=",
            value: { k: "number", value: 1 },
          },
          { k: "exit", value: null },
        ],
      },
    ],
  };
  const insert = (over: Partial<InsertResource> = {}): InsertResource => ({
    kind: "insert",
    at,
    place: "after",
    call: "a_onSave",
    ...over,
  });
  /** A mod declaring the script its insertion calls, which is the shape that should work. */
  const inserting = (over: Partial<InsertResource> = {}) =>
    mod("a", (api) => {
      api.resource.create(insert(over));
      api.resource.create(script("a_onSave"));
    });

  it("accepts one pointing at a statement of the game's own code", () => {
    const host = ModHost.load([inserting()], target, game);
    expect(insertResources(host.resources)).toEqual([insert()]);
  });

  // The script may be declared either side of the insertion: making order matter would be a rule
  // nobody could guess from the error.
  it("does not care whether the script it calls was declared first", () => {
    const host = ModHost.load(
      [
        mod("a", (api) => {
          api.resource.create(script("a_onSave"));
          api.resource.create(insert());
        }),
      ],
      target,
      game,
    );
    expect(insertResources(host.resources)).toHaveLength(1);
  });

  it("refuses a statement the backend could not locate", () => {
    expect(() =>
      ModHost.load([inserting({ at: undefined as unknown as At })], target, game),
    ).toThrow(/no insertion point/);
  });

  it("refuses a place that is none of the three", () => {
    expect(() =>
      ModHost.load(
        [inserting({ place: "beside" as unknown as InsertResource["place"] })],
        target,
        game,
      ),
    ).toThrow(/"before", "after" or "instead"/);
  });

  // Running something instead of a statement is how a mod takes something out of a game, and the
  // host is not the layer that knows whether a backend can: it checks the place is one of the
  // three and leaves the rest to the engine, which is holding the code.
  it("accepts running something instead of a statement", () => {
    const host = ModHost.load(
      [
        mod("a", (api) => {
          api.resource.create(script("a_onSave"));
          api.resource.create({ ...insert(), place: "instead" });
        }),
      ],
      target,
      game,
    );
    expect(insertResources(host.resources)[0]?.place).toBe("instead");
  });

  it("refuses a statement from a piece of code this game does not have", () => {
    expect(() => ModHost.load([inserting({ at: "elsewhere#s,1,2" as At })], target, game)).toThrow(
      /not one of this game's scripts, object events or room code/,
    );
  });

  // An object event is a code entry like a script is, and the one an I Wanna game stops its music
  // in is a Key Press -- so a token naming one is accepted on the same footing.
  it("accepts a statement from one of the game's object events", () => {
    const withEvents: GameCode = {
      ...game,
      events: [{ name: "world.KeyPress_82", body: [{ k: "exit", value: null }] }],
    };
    const host = ModHost.load(
      [
        mod("a", (api) => {
          api.resource.create(script("a_onSave"));
          api.resource.create({ ...insert(), at: "world.KeyPress_82#e,0,9,82,0,0,7" as At });
        }),
      ],
      target,
      withEvents,
    );
    expect(insertResources(host.resources)).toHaveLength(1);
  });

  // The creation code of one instance placed in one room, which on GameMaker 8 is where a room's
  // music is armed -- a third kind of code entry, accepted on the same footing as the other two.
  it("accepts a statement from a room's own code", () => {
    const withRooms: GameCode = {
      ...game,
      rooms: [
        {
          name: "ringo.instance_141058",
          body: [{ k: "exit", value: null }],
          room: "ringo",
          object: "playMusic",
        },
      ],
    };
    const host = ModHost.load(
      [
        mod("a", (api) => {
          api.resource.create(script("a_onSave"));
          api.resource.create({ ...insert(), at: "ringo.instance_141058#i,37,1,0,22" as At });
        }),
      ],
      target,
      withRooms,
    );
    expect(insertResources(host.resources)).toHaveLength(1);
  });

  it("refuses calling a script the mod never declared", () => {
    expect(() =>
      ModHost.load([mod("a", (api) => api.resource.create(insert()))], target, game),
    ).toThrow(/never declared as a script/);
  });

  // Another mod's script would make this mod's install depend on what the player ticked.
  it("refuses calling another mod's script", () => {
    expect(() =>
      ModHost.load(
        [
          mod("b", (api) => api.resource.create(script("a_onSave"))),
          mod("a", (api) => api.resource.create(insert())),
        ],
        target,
        game,
      ),
    ).toThrow(/never declared as a script/);
  });

  // Insertions install no name of their own, so two of them are not a collision -- and several at
  // one place is the documented way to have two things happen there.
  // Both engines install these now -- GameMaker 8 by splicing source, GameMaker Studio by
  // detouring one instruction -- so neither is refused for being itself.
  it("accepts one on either engine", () => {
    for (const engine of ["gm8", "gms"] as const) {
      expect(insertResources(ModHost.load([inserting()], { engine }, game).resources)).toHaveLength(
        1,
      );
    }
  });

  it("allows two mods to insert at the same statement", () => {
    const host = ModHost.load(
      [
        inserting(),
        mod("b", (api) => {
          api.resource.create({ kind: "insert", at, place: "before", call: "b_onSave" });
          api.resource.create(script("b_onSave"));
        }),
      ],
      target,
      game,
    );
    expect(insertResources(host.resources).map((r) => r.call)).toEqual(["a_onSave", "b_onSave"]);
  });
});

describe("what gets installed", () => {
  // The runtime owns every mailbox a mod object reads, and instances are created in this order.
  it("puts the loader's runtime object ahead of the mods' own", () => {
    const host = ModHost.load([mod("a", (api) => api.resource.create(object("a_obj")))], target);
    expect(objectResources(host.installed).map((r) => r.name)).toEqual(["mod_runtime", "a_obj"]);
  });

  // A JavaScript-only mod baking GML would make every patched tree stale for no reason.
  it("installs nothing at all when no mod declared a resource", () => {
    const host = ModHost.load([mod("js-only", () => {})], target);
    expect(host.installed).toEqual([]);
  });

  it("routes each loaded mod's channel, and only those", () => {
    const host = ModHost.load(
      [
        mod("a", (api) => api.resource.create(object("a_obj"))),
        mod("b", (api) => api.resource.create(object("b_obj"))),
      ],
      target,
    );
    const runtime = objectResources(host.installed)[0]!;
    expect(runtime.events.beginStep).toContain(modChannel("a"));
    expect(runtime.events.beginStep).toContain(modChannel("b"));
    expect(runtime.events.beginStep).not.toContain(modChannel("c"));
  });

  it("declares a mailbox for every channel it routes", () => {
    const host = ModHost.load([mod("a", (api) => api.resource.create(object("a_obj")))], target);
    expect(objectResources(host.installed)[0]!.events.create).toContain(
      `global.__mod_box_${modChannel("a")}`,
    );
  });
});

describe("the GML a mod is given", () => {
  it("addresses what the mod sends, without the mod writing the address", () => {
    let gml = "";
    ModHost.load([mod("a", (api) => void (gml = api.gml.send(`"hello"`)))], target);
    expect(gml).toBe(`host_send("${modChannel("a")} " + ("hello"));`);
  });

  it("reads this mod's own mailbox and no other", () => {
    let gml = "";
    ModHost.load([mod("a", (api) => void (gml = api.gml.receive("obj_m")))], target);
    expect(gml).toContain(`global.__mod_box_${modChannel("a")}`);
    expect(gml).not.toContain(modChannel("b"));
  });
});

describe("the start event", () => {
  // A mod activates before there is a game, so anything it times from activate() is timing the
  // engine's startup -- which for a GameMaker Studio game in the emulator is a .NET boot and an
  // asset extraction, far longer than any sane wait for a reply.
  it("does not fire while there is no game", () => {
    const started = vi.fn();
    ModHost.load([mod("a", (api) => api.on("start", started))], target);
    expect(started).not.toHaveBeenCalled();
  });

  it("fires when the channel is attached", () => {
    const started = vi.fn();
    const host = ModHost.load([mod("a", (api) => api.on("start", started))], target);
    host.attach({ send: () => {}, drain: () => [] });
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("fires for every mod that asked", () => {
    const a = vi.fn();
    const b = vi.fn();
    const host = ModHost.load(
      [mod("a", (api) => api.on("start", a)), mod("b", (api) => api.on("start", b))],
      target,
    );
    host.attach({ send: () => {}, drain: () => [] });
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
  });

  // What mods sent during activate was queued first, so it reaches the game first.
  it("fires after the queued messages have gone", () => {
    const order: string[] = [];
    const host = ModHost.load(
      [
        mod("a", (api) => {
          api.send("early");
          api.on("start", () => order.push("start"));
        }),
      ],
      target,
    );
    host.attach({ send: (m) => order.push(`sent ${m}`), drain: () => [] });
    expect(order).toEqual([`sent ${to("a", "early")}`, "start"]);
  });

  // The desktop runtime builds its host when a running game first speaks, so the channel can
  // already be open by the time a mod asks. Never firing would hang whatever waited on it.
  it("fires immediately for a mod that asks after the channel is open", () => {
    let late: ModApi | null = null;
    const host = ModHost.load([mod("a", (api) => void (late = api))], target);
    host.attach({ send: () => {}, drain: () => [] });
    const started = vi.fn();
    late!.on("start", started);
    expect(started).toHaveBeenCalledTimes(1);
  });

  it("survives a mod whose start handler throws", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn();
    const host = ModHost.load(
      [
        mod("bad", (api) =>
          api.on("start", () => {
            throw new Error("nope");
          }),
        ),
        mod("good", (api) => api.on("start", after)),
      ],
      target,
    );
    expect(() => host.attach({ send: () => {}, drain: () => [] })).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("messages", () => {
  // The whole point of v2: under v1 both handlers saw both messages, and two mods that listened
  // stole each other's mail.
  it("delivers a message only to the mod it is addressed to", () => {
    const a = vi.fn();
    const b = vi.fn();
    const host = ModHost.load(
      [mod("a", (api) => api.on("message", a)), mod("b", (api) => api.on("message", b))],
      target,
    );
    host.attach({ send: () => {}, drain: () => [to("a", "one"), to("b", "two")] });
    host.pump();
    expect(a.mock.calls.flat()).toEqual(["one"]);
    expect(b.mock.calls.flat()).toEqual(["two"]);
  });

  it("hands the handler the message without its address", () => {
    const seen: string[] = [];
    const host = ModHost.load(
      [mod("a", (api) => api.on("message", (m) => void seen.push(m)))],
      target,
    );
    host.attach({ send: () => {}, drain: () => [to("a", "pos 1 2")] });
    host.pump();
    expect(seen).toEqual(["pos 1 2"]);
  });

  // An empty payload is a real payload; only an empty *message* is nothing.
  it("delivers an empty payload rather than swallowing it", () => {
    const seen: string[] = [];
    const host = ModHost.load(
      [mod("a", (api) => api.on("message", (m) => void seen.push(m)))],
      target,
    );
    host.attach({ send: () => {}, drain: () => [to("a", "")] });
    host.pump();
    expect(seen).toEqual([""]);
  });

  it("addresses what a mod sends", () => {
    const sent: string[] = [];
    const host = ModHost.load(
      [mod("a", (api) => api.on("message", () => api.send("out")))],
      target,
    );
    host.attach({ send: (m) => sent.push(m), drain: () => [to("a", "in")] });
    host.pump();
    expect(sent).toEqual([to("a", "out")]);
  });

  // A v1 mod calling host_send directly. Guessing a recipient would hand one mod's traffic to
  // another, so it is dropped -- and said out loud, because it is otherwise invisible.
  it("drops an unaddressed message and says so", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = vi.fn();
    const host = ModHost.load([mod("a", (api) => api.on("message", handler))], target);
    host.attach({ send: () => {}, drain: () => ["pos 1 2"] });
    host.pump();
    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("addressed to nobody"));
    warn.mockRestore();
  });

  it("does nothing before a transport is attached", () => {
    const handler = vi.fn();
    const host = ModHost.load([mod("a", (api) => api.on("message", handler))], target);
    expect(() => host.pump()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  // A mod may send during activate(), before anything is connected. Dropping those would make the
  // first thing a mod says the one thing that never arrives.
  it("flushes what mods sent during activate once the transport arrives", () => {
    const sent: string[] = [];
    const host = ModHost.load([mod("a", (api) => api.send("early"))], target);
    host.attach({ send: (m) => sent.push(m), drain: () => [] });
    expect(sent).toEqual([to("a", "early")]);
  });
});

describe("asModActivate", () => {
  it("takes a default-exported activate function", () => {
    const activate = () => {};
    expect(asModActivate({ default: activate }, "a.js")).toBe(activate);
  });

  // What a mod written with a helper library exports: `export default createMod(...)`, which is a
  // value the library returns rather than a function the author declared.
  it("takes a default-exported { activate }", () => {
    const activate = () => {};
    expect(asModActivate({ default: { activate } }, "a.js")).toBe(activate);
  });

  it("says what is missing rather than failing later", () => {
    expect(() => asModActivate({}, "a.js")).toThrow(/must default-export/);
    expect(() => asModActivate({ default: { id: "a" } }, "a.js")).toThrow(/must default-export/);
  });
});
