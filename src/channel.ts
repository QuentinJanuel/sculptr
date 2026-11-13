/**
 * The host's end of a patched game's channel: turning its TCP stream into messages, in the two
 * shapes the two GameMaker families speak, plus the handshake and launch arguments around it.
 *
 * Shared by every place a patched game runs -- a loopback server for a native install, and an
 * in-memory connection for an emulated one -- because the game is the same
 * file in both and speaks the same bytes.
 *
 * TCP is a stream: two sends arrive as one read whenever they are close enough together, and one
 * send can arrive in pieces. Every reader here therefore buffers until it has a whole message and
 * never assumes a packet is one.
 *
 * There are two shapes because the game side is not ours to choose. A GameMaker Studio game speaks
 * through its stock `network_*` functions and writes whatever bytes we tell it to, so we picked the
 * simplest framing that works -- a NUL terminator. A GameMaker 8 game reaches a socket only through
 * Http Dll 2.3, which frames messages itself and does it with a length prefix. Neither side can be
 * talked out of its format, so the host learns both.
 */
import type { ModEngine } from "./contract.js";

/** A message codec. `decode` returns what it could parse and whatever bytes are left over. */
export interface Framing {
  encode(message: string): Uint8Array;
  decode(pending: Uint8Array): { messages: string[]; rest: Uint8Array };
}

// In every realm this runs in (page, worker, Node), but not in this package's bare ES2022 lib.
declare const TextEncoder: new () => { encode(text: string): Uint8Array };
declare const TextDecoder: new () => { decode(bytes: Uint8Array): string };

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * A message longer than this is treated as a desynchronised stream rather than a real message.
 * Without it, a reader waits forever on bytes that will never come while the buffer grows without
 * bound -- from one bad length byte under `uintv`, or from a terminator that never arrives under
 * NUL framing. Both codecs throw past it, and the caller drops the connection when they do.
 */
const MAX_MESSAGE_BYTES = 1 << 20;

// -- NUL-terminated, for GameMaker Studio ---------------------------------------------------------

export const nulFraming: Framing = {
  encode(message) {
    return concat(utf8.encode(message), new Uint8Array([0]));
  },
  decode(pending) {
    const messages: string[] = [];
    let rest = pending;
    for (;;) {
      const end = rest.indexOf(0);
      if (end < 0) break;
      messages.push(fromUtf8.decode(rest.subarray(0, end)));
      rest = rest.subarray(end + 1);
    }
    // Capped for the same reason `uintv` is. Nothing here waits on a length, so an unterminated
    // stream buffers silently instead: any local process that connects to the port and never sends
    // a NUL would grow the main process until it died.
    if (rest.length > MAX_MESSAGE_BYTES) {
      throw new Error(`mod channel: framing lost -- ${rest.length} bytes with no terminator`);
    }
    return { messages, rest };
  },
};

// -- uintv length prefix, for GameMaker 8 via Http Dll 2.3 ---------------------------------------

/**
 * `uintv` is Http Dll 2.3's variable-length unsigned integer, and `socket_write_message` puts one
 * in front of every message. It is a little-endian prefix code: the low bits of the first byte say
 * how many bytes the whole thing occupies, the rest carry the value, and each width starts counting
 * from where the previous one stopped so no value has two encodings.
 *
 * | bytes | marker bits | range |
 * |---|---|---|
 * | 1 | `xxxxxxx1` | 0 .. 0x7F |
 * | 2 | `xxxxxx10` | 0x80 .. 0x407F |
 * | 3 | `xxxxx100` | 0x4080 .. 0x20407F |
 * | 4 | `xxxxx000` | 0x204080 .. |
 *
 * Documented at `docs/vendor/http-dll-2/buffers.txt`; the reference implementation on the other end
 * of the wire is `readUIntV` / `insertUIntV` in I Wanna Play Online's server.
 *
 * Arithmetic is deliberately `*` and `/` rather than `<<` and `>>`: JavaScript's bit operators
 * coerce to *signed* 32-bit, so a four-byte length would come back negative.
 */
const OFFSETS = [0x000000, 0x000080, 0x004080, 0x204080];
const USED_BITS = [1, 2, 3, 3];
const PREFIX_BITS = [1, 2, 4, 0];
const MAX_UINT32 = 0xffffffff;

export function encodeUintv(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`uintv: ${value} is not a non-negative integer`);
  }
  let width = 4;
  if (value < OFFSETS[1]!) width = 1;
  else if (value < OFFSETS[2]!) width = 2;
  else if (value < OFFSETS[3]!) width = 3;

  const encoded =
    (value - OFFSETS[width - 1]!) * 2 ** USED_BITS[width - 1]! + PREFIX_BITS[width - 1]!;
  if (encoded > MAX_UINT32) throw new Error(`uintv: ${value} is too large to encode`);

  const bytes = new Uint8Array(width);
  for (let i = 0, rest = encoded; i < width; i += 1, rest = Math.floor(rest / 256))
    bytes[i] = rest % 256;
  return bytes;
}

/** Reads a uintv at `at`, or null when `pending` does not yet hold all of it. */
export function decodeUintv(
  pending: Uint8Array,
  at: number,
): { value: number; width: number } | null {
  if (at >= pending.length) return null;
  const first = pending[at]!;
  let width = 4;
  if (first & 1) width = 1;
  else if (first & 2) width = 2;
  else if (first & 4) width = 3;
  if (at + width > pending.length) return null;

  let raw = 0;
  for (let i = width - 1; i >= 0; i -= 1) raw = raw * 256 + pending[at + i]!;
  return {
    value: Math.floor(raw / 2 ** USED_BITS[width - 1]!) + OFFSETS[width - 1]!,
    width,
  };
}

export const uintvFraming: Framing = {
  encode(message) {
    const body = utf8.encode(message);
    return concat(encodeUintv(body.length), body);
  },
  decode(pending) {
    const messages: string[] = [];
    let rest = pending;
    for (;;) {
      const header = decodeUintv(rest, 0);
      if (header === null) break;
      if (header.value > MAX_MESSAGE_BYTES) {
        throw new Error(`mod channel: framing lost -- claimed message length ${header.value}`);
      }
      const end = header.width + header.value;
      if (rest.length < end) break;
      messages.push(fromUtf8.decode(rest.subarray(header.width, end)));
      rest = rest.subarray(end);
    }
    return { messages, rest };
  },
};

/**
 * What GameMaker 8 actually speaks: a `uintv` frame whose payload is a NUL-terminated string.
 *
 * The terminator is not ours -- it is what the DLL's own string functions do. `buffer_write_string`
 * writes the text *and a NUL*, and `buffer_read_string` reads up to one, so a message sent without
 * a terminator would leave the game reading past the end of its buffer, and one received with the
 * terminator left on would hand every mod a string ending in a stray NUL.
 *
 * Layered over `uintvFraming` rather than folded into it so the length codec stays exactly the
 * thing the reference vectors test.
 */
export const gm8Framing: Framing = {
  encode(message) {
    return uintvFraming.encode(`${message}\0`);
  },
  decode(pending) {
    const { messages, rest } = uintvFraming.decode(pending);
    return { messages: messages.map((m) => (m.endsWith("\0") ? m.slice(0, -1) : m)), rest };
  },
};

/**
 * Which framing a game speaks, decided by its engine rather than sniffed from the stream.
 *
 * Sniffing is not an option even in principle: the first thing a game sends is already framed, so
 * there is nothing to read before knowing how to read it.
 */
export function framingFor(engine: ModEngine): Framing {
  return engine === "gm8" ? gm8Framing : nulFraming;
}

/** The first message a game sends: `hello:<game id>`, so one server can serve every install. */
export const HELLO = "hello:";

/**
 * The launch arguments the patched game's channel object reads, in the exact spelling of the GML
 * gm8-lib and gms-lib bake. Passed on the command line rather than in a file beside the game, which
 * the install baseline would then try to sync like a save.
 */
export const PORT_ARG = "--emu-mod-port=";
export const GAME_ARG = "--emu-mod-game=";

/** What to launch a patched game with so it dials `port` and announces itself as `gameId`. */
export function channelArgs(port: number, gameId: string): string[] {
  return [`${PORT_ARG}${port}`, `${GAME_ARG}${gameId}`];
}
