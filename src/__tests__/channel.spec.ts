/**
 * The two wire formats the mod channel speaks.
 *
 * The `uintv` vectors below are not hand-derived: they were produced by running the encoder from I
 * Wanna Play Online's server (`insertUIntV`) -- the implementation that has been on the other end of
 * this DLL's wire in production -- so they check our codec against the real thing rather than
 * against a second reading of the same documentation.
 */
import { describe, expect, it } from "vitest";

declare const TextEncoder: new () => { encode(text: string): Uint8Array };
declare const TextDecoder: new () => { decode(bytes: Uint8Array): string };

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (text: string) =>
  new Uint8Array((text.match(/../gu) ?? []).map((b) => parseInt(b, 16)));
const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (out.set(p, at), at + p.length), 0);
  return out;
};
import {
  decodeUintv,
  encodeUintv,
  framingFor,
  gm8Framing,
  nulFraming,
  uintvFraming,
} from "../channel.js";

/** value -> hex, straight out of the reference encoder. Covers every width and both sides of each
 *  boundary, which is where a prefix code goes wrong. */
const VECTORS: [number, string][] = [
  [0, "01"],
  [1, "03"],
  [5, "0b"],
  [127, "ff"],
  [128, "0200"],
  [129, "0600"],
  [1000, "a20d"],
  [16511, "feff"],
  [16512, "040000"],
  [16513, "0c0000"],
  [100000, "04310a"],
  [2113663, "fcffff"],
  [2113664, "00000000"],
  [2113665, "08000000"],
  [5000000, "00566001"],
];

describe("uintv", () => {
  it.each(VECTORS)("encodes %i the way the reference does", (value, want) => {
    expect(hex(encodeUintv(value))).toBe(want);
  });

  it.each(VECTORS)("decodes %i back", (value, hex) => {
    const buffer = fromHex(hex);
    expect(decodeUintv(buffer, 0)).toEqual({ value, width: buffer.length });
  });

  it("reports not-yet when the header is only partly here", () => {
    expect(decodeUintv(fromHex("04"), 0)).toBeNull();
    expect(decodeUintv(new Uint8Array(0), 0)).toBeNull();
  });

  it("refuses a value it cannot represent", () => {
    expect(() => encodeUintv(-1)).toThrow();
    expect(() => encodeUintv(1.5)).toThrow();
  });
});

describe.each([
  ["NUL", nulFraming],
  ["uintv", uintvFraming],
  ["gm8", gm8Framing],
])("%s framing", (_name, framing) => {
  it("round-trips a message", () => {
    const { messages, rest } = framing.decode(framing.encode("hello:abc"));
    expect(messages).toEqual(["hello:abc"]);
    expect(rest.length).toBe(0);
  });

  it("reads two messages that arrived as one packet", () => {
    const packet = cat([framing.encode("one"), framing.encode("two")]);
    expect(framing.decode(packet).messages).toEqual(["one", "two"]);
  });

  // The failure this designs out: treating a partial arrival as a whole message.
  it("keeps a partial message back until the rest arrives", () => {
    const whole = framing.encode("a longer message");
    const first = framing.decode(whole.subarray(0, 4));
    expect(first.messages).toEqual([]);
    const second = framing.decode(cat([first.rest, whole.subarray(4)]));
    expect(second.messages).toEqual(["a longer message"]);
  });

  it("carries non-ASCII intact", () => {
    expect(framing.decode(framing.encode("café ☕")).messages).toEqual(["café ☕"]);
  });

  it("handles an empty message", () => {
    expect(framing.decode(framing.encode("")).messages).toEqual([""]);
  });
});

describe("uintv framing specifically", () => {
  // Where the two formats genuinely differ: a NUL byte is data here, not a terminator, so a
  // length-prefixed message survives content that would end a NUL-framed one.
  it("carries a message containing a NUL byte", () => {
    expect(uintvFraming.decode(uintvFraming.encode("a\0b")).messages).toEqual(["a\0b"]);
  });

  it("gives up rather than growing forever when the stream desynchronises", () => {
    // A four-byte header claiming megabytes, which is what a lost byte looks like.
    expect(() => uintvFraming.decode(fromHex("00566001"))).toThrow(/framing lost/);
  });
});

describe("nul framing specifically", () => {
  // The NUL reader waits on a terminator rather than a length, so a stream that never sends one
  // buffers silently. Any local process can connect to the loopback port and do exactly that, and
  // `channel.ts` only drops a socket when the codec throws.
  it("gives up rather than growing forever when no terminator ever arrives", () => {
    expect(() => nulFraming.decode(new Uint8Array((1 << 20) + 1).fill(0x61))).toThrow(
      /framing lost/,
    );
  });

  it("keeps buffering a partial message that is still a plausible size", () => {
    const { messages, rest } = nulFraming.decode(new TextEncoder().encode("half a message"));
    expect(messages).toEqual([]);
    expect(new TextDecoder().decode(rest)).toBe("half a message");
  });
});

describe("gm8 framing", () => {
  // The DLL's own string functions put the terminator there and expect it back; getting this wrong
  // hands every mod a string with a stray NUL on the end, or makes the game read past its buffer.
  it("terminates what it sends, because buffer_read_string needs it", () => {
    const framed = gm8Framing.encode("hi");
    expect(framed.subarray(-1)[0]).toBe(0);
    expect(uintvFraming.decode(framed).messages).toEqual(["hi\0"]);
  });

  it("strips the terminator the game sends, so mods never see it", () => {
    expect(gm8Framing.decode(uintvFraming.encode("pos 1 2\0")).messages).toEqual(["pos 1 2"]);
  });

  it("leaves an unterminated message alone rather than eating a real character", () => {
    expect(gm8Framing.decode(uintvFraming.encode("abc")).messages).toEqual(["abc"]);
  });
});

describe("framingFor", () => {
  it("gives GameMaker 8 the DLL's format and GameMaker Studio ours", () => {
    expect(framingFor("gm8")).toBe(gm8Framing);
    expect(framingFor("gms")).toBe(nulFraming);
  });
});
