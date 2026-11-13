import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { framingFor } from "../channel.js";
import { modChannel, type ModEngine } from "../contract.js";
import { emptyGameCode } from "../game-code.js";
import { asModActivate, type LoadableMod } from "../runtime/index.js";
import { serve, UnsupportedCapability, type Served } from "../serve.js";

const backends = { gameCode: async () => JSON.stringify(emptyGameCode()) };
const running: Served[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()));
});

async function start(engine: ModEngine, mods: LoadableMod[]): Promise<Served> {
  const served = await serve(backends, engine, new Uint8Array(), mods);
  running.push(served);
  return served;
}

/** A game's end of the channel, speaking the bytes the patched game does. */
async function dial(served: Served, engine: ModEngine, hello = true) {
  const framing = framingFor(engine);
  const socket = connect(served.port, "127.0.0.1");
  await new Promise((resolve) => socket.once("connect", resolve));
  const received: string[] = [];
  const waiting: ((message: string) => void)[] = [];
  let pending: Uint8Array = new Uint8Array(0);
  socket.on("data", (chunk) => {
    const decoded = framing.decode(Buffer.concat([pending, chunk]));
    pending = decoded.rest;
    for (const m of decoded.messages) (waiting.shift() ?? ((x) => received.push(x)))(m);
  });
  const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
  const client = {
    send: (message: string) => socket.write(framing.encode(message)),
    raw: (bytes: Uint8Array) => socket.write(bytes),
    next: () =>
      new Promise<string>((resolve) =>
        received.length ? resolve(received.shift()!) : waiting.push(resolve),
      ),
    close: () => (socket.end(), closed),
    closed,
  };
  // The port and game id the game reads off its launch arguments.
  if (hello) client.send(`hello:${served.args[1]!.split("=")[1]}`);
  return client;
}

/** Answers `echo <message>`, and counts its activations and starts. */
function echo(id: string, log = { activated: 0, started: 0, heard: [] as string[] }) {
  const mod: LoadableMod = {
    identity: { id, version: "1.0.0" },
    activate: (api) => {
      log.activated += 1;
      api.on("start", () => (log.started += 1));
      api.on("message", (message) => {
        log.heard.push(message);
        api.send(`echo ${message}`);
      });
    },
  };
  return { mod, log };
}

const to = (id: string, message: string) => `${modChannel(id)} ${message}`;

describe("serve", () => {
  it("prints the launch arguments the patched game reads", async () => {
    const served = await start("gm8", [echo("a").mod]);
    expect(served.args).toEqual([`--emu-mod-port=${served.port}`, "--emu-mod-game=sculptr"]);
  });

  for (const engine of ["gm8", "gms"] as const) {
    it(`activates, then routes a ${engine} game's messages to the mod and its replies back`, async () => {
      const { mod, log } = echo("a");
      const served = await start(engine, [mod]);
      expect(log).toMatchObject({ activated: 1, started: 0 });
      const game = await dial(served, engine);
      game.send(to("a", "hi there"));
      expect(await game.next()).toBe(to("a", "echo hi there"));
      expect(log).toEqual({ activated: 1, started: 1, heard: ["hi there"] });
    });
  }

  it("routes two mods independently", async () => {
    const a = echo("a");
    const b = echo("b");
    const game = await dial(await start("gms", [a.mod, b.mod]), "gms");
    game.send(to("b", "one"));
    game.send(to("a", "two"));
    expect([await game.next(), await game.next()]).toEqual([
      to("b", "echo one"),
      to("a", "echo two"),
    ]);
    expect([a.log.heard, b.log.heard]).toEqual([["two"], ["one"]]);
  });

  it("keeps the mods across a reconnect, as a long-lived host does", async () => {
    const { mod, log } = echo("a");
    const served = await start("gm8", [mod]);
    const first = await dial(served, "gm8");
    first.send(to("a", "1"));
    await first.next();
    await first.close();
    const second = await dial(served, "gm8");
    second.send(to("a", "2"));
    expect(await second.next()).toBe(to("a", "echo 2"));
    expect(log).toEqual({ activated: 1, started: 1, heard: ["1", "2"] });
  });

  it("ignores a game until it says hello with the id it was launched with", async () => {
    const { mod, log } = echo("a");
    const served = await start("gms", [mod]);
    const game = await dial(served, "gms", false);
    game.send(to("a", "early"));
    game.send("hello:someone-else");
    game.send(to("a", "stranger"));
    game.send(`hello:sculptr`);
    game.send(to("a", "late"));
    expect(await game.next()).toBe(to("a", "echo late"));
    expect(log.heard).toEqual(["late"]);
  });

  it("drops a connection whose framing is lost, and keeps serving", async () => {
    const { mod, log } = echo("a");
    const served = await start("gm8", [mod]);
    const broken = await dial(served, "gm8");
    // A four-byte uintv claiming a length far past the cap.
    broken.raw(new Uint8Array([0x00, 0x00, 0x00, 0xff]));
    await broken.closed;
    const game = await dial(served, "gm8");
    game.send(to("a", "still here"));
    expect(await game.next()).toBe(to("a", "echo still here"));
    expect(log.heard).toEqual(["still here"]);
  });

  it("needs nothing from a mod that only declares resources", async () => {
    const quiet: LoadableMod = {
      identity: { id: "q", version: "1" },
      activate: (api) => api.resource.create({ kind: "object", name: "q_o", events: {} }),
    };
    const { mod } = echo("a");
    const game = await dial(await start("gm8", [quiet, mod]), "gm8");
    game.send(to("q", "nobody listens"));
    game.send(to("a", "x"));
    expect(await game.next()).toBe(to("a", "echo x"));
  });

  it("refuses a panel by name, naming the mod, even when the mod catches it", async () => {
    const panel = (swallow: boolean): LoadableMod => ({
      identity: { id: "with-panel", version: "1" },
      activate: (api) => {
        try {
          api.ui.panel({ title: "t" }, (ui) => ui.text("x"));
        } catch (error) {
          if (!swallow) throw error;
        }
      },
    });
    for (const swallow of [false, true]) {
      const refused = start("gm8", [echo("a").mod, panel(swallow)]);
      await expect(refused).rejects.toBeInstanceOf(UnsupportedCapability);
      await expect(refused).rejects.toThrow(
        "mod with-panel needs a panel (ui.panel), which sculptr serve cannot provide",
      );
    }
  });

  it("refuses the game's files by name", async () => {
    let written: Promise<string> | undefined;
    await start("gms", [
      {
        identity: { id: "f", version: "1" },
        activate: (api) => void (written = api.files.write("a.png", new Uint8Array(), "")),
      },
    ]);
    await expect(written).rejects.toThrow(
      "mod f needs the game's files (files.write), which sculptr serve cannot provide",
    );
  });

  it("runs the published controls mod: it answers the game's ready with a key map", async () => {
    const url = "https://cdn.jsdelivr.net/npm/@sculptr/controls@1.1.0/dist/index.js";
    const source = await (await fetch(url)).text();
    const module: unknown = await import(`data:text/javascript,${encodeURIComponent(source)}`);
    const controls = {
      identity: { id: "controls", version: "1.1.0" },
      activate: asModActivate(module, url),
    };
    const game = await dial(await start("gm8", [controls]), "gm8");
    // What the mod's own GML sends from its object's Create event.
    game.send(to("controls", "ready "));
    expect(await game.next()).toMatch(new RegExp(`^${modChannel("controls")} map \\d+(,\\d+)*$`));
  });
});
