// The other end of a patched game's channel, in plain Node: a loopback server the game dials, whose
// messages reach the mods' handlers and whose mods' replies reach the game. The same job a desktop
// host does, minus everything that needs a window -- which is refused by name instead.
import { createServer, type Socket } from "node:net";
import { channelArgs, framingFor, HELLO } from "./channel.js";
import { parseGameCode } from "./game-code.js";
import { named } from "./install.js";
import { ModHost, type LoadableMod, type ModPlayer } from "./runtime/index.js";
import type { Format, modder } from "./index.js";

// What a host needs beside serve() to launch the game and load the mods it is given.
export { channelArgs, framingFor, GAME_ARG, HELLO, PORT_ARG } from "./channel.js";
export { asModActivate, type LoadableMod, type ModPlayer } from "./runtime/index.js";

/** What a game announces itself as. One server serves one game, so any fixed id would do. */
const GAME_ID = "sculptr";

/** A mod asked for something this host has no way to give it, such as a panel with no window. */
export class UnsupportedCapability extends Error {
  override name = "UnsupportedCapability";
  constructor(
    readonly modId: string,
    readonly capability: string,
  ) {
    super(`mod ${modId} needs ${capability}, which sculptr serve cannot provide`);
  }
}

export interface Served {
  port: number;
  /** What to launch the patched game with so it dials this server. */
  args: string[];
  close(): Promise<void>;
}

/**
 * Runs every mod's `activate()` against the game's code and listens on loopback for the patched
 * game. Given the same game, mods and player as `installMods`, so the JavaScript runs against what
 * that install baked in.
 *
 * Throws before listening when a mod fails to activate or asks for a capability it cannot have.
 */
export async function serve(
  backends: Pick<ReturnType<typeof modder>, "gameCode">,
  format: Format,
  bytes: Uint8Array,
  mods: readonly LoadableMod[],
  player?: ModPlayer,
): Promise<Served> {
  const game = parseGameCode(await backends.gameCode(format, bytes));
  const host = ModHost.load(mods.map(named).map(refusing), { engine: format }, game, player);

  const framing = framingFor(format);
  const inbox: string[] = [];
  const sockets = new Set<Socket>();
  // The game that said hello last. Mods outlive a dropped connection, as on the desktop: what they
  // send while no game is connected is dropped, and a game that dials again is the same game.
  let current: Socket | null = null;
  let attached = false;
  function attach(): void {
    attached = true;
    host.attach({
      send: (message) => {
        if (current && !current.destroyed) current.write(framing.encode(message));
      },
      drain: () => inbox.splice(0, inbox.length),
    });
  }

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    let announced = false;
    let pending: Uint8Array = new Uint8Array(0);
    socket.on("data", (chunk) => {
      let messages: string[];
      try {
        ({ messages, rest: pending } = framing.decode(Buffer.concat([pending, chunk])));
      } catch (error) {
        // Every later message would be read from a wrong offset; dropping it lets the game redial.
        console.error("[mods] dropping a connection whose framing was lost:", error);
        socket.destroy();
        return;
      }
      for (const text of messages) {
        if (!announced) {
          if (!text.startsWith(HELLO)) continue;
          if (text !== HELLO + GAME_ID) {
            console.error(`[mods] ignoring a game that announced ${JSON.stringify(text)}`);
            continue;
          }
          announced = true;
          current = socket;
          // Once: `start` means the game exists, and a redial is the same game coming back.
          if (!attached) attach();
          continue;
        }
        inbox.push(text);
      }
      if (announced) host.pump();
    });
    const drop = () => {
      sockets.delete(socket);
      if (current === socket) current = null;
    };
    socket.on("close", drop);
    // Without this a game killed mid-write takes the process down with an unhandled ECONNRESET.
    socket.on("error", drop);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // 127.0.0.1, not 0.0.0.0: nothing outside this machine has any business talking to a game.
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as { port: number };
  return {
    port,
    args: channelArgs(port, GAME_ID),
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

/** The mod, with what needs a window or the game's files refused by name. */
function refusing({ identity, activate }: LoadableMod): LoadableMod {
  return {
    identity,
    activate: (api) => {
      let refused: UnsupportedCapability | null = null;
      try {
        activate({
          ...api,
          ui: {
            ...api.ui,
            panel: () => {
              throw (refused = new UnsupportedCapability(identity.id, "a panel (ui.panel)"));
            },
          },
          files: {
            write: () =>
              Promise.reject(
                new UnsupportedCapability(identity.id, "the game's files (files.write)"),
              ),
          },
        });
      } catch (error) {
        throw refused ?? error;
      }
      // Also when the mod caught it: a mod without its panel is not the mod that was asked for.
      if (refused) throw refused;
    },
  };
}
