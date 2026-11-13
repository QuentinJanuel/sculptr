---
sidebar_position: 1
title: The channel
---

# The channel

A mod's GML and its JavaScript exchange strings. Both directions are fire-and-forget: nothing
blocks, and nothing waits for an answer.

```js
export default function activate(api) {
  api.resource.create({
    kind: "object",
    name: "ping_mod",
    events: {
      // GML to JS: `send` takes a GML expression that evaluates to the message.
      step: `if (keyboard_check_pressed(ord("H"))) {
        ${api.gml.send("room_get_name(room)")}
      }
      ${api.gml.receive("ping_mod_msg")}
      if (ping_mod_msg != "") show_message("pong from " + ping_mod_msg);`,
    },
  });

  // JS to GML: one string, into this mod's mailbox.
  api.on("message", (room) => api.send(room));
}
```

Pressing `H` sends the room's name to the JavaScript, which sends it back; the next Step reads it
from the mailbox.

- `api.gml.send(expression)` is a GML statement that sends the value of `expression`.
- `api.gml.receive(variable)` is a GML statement that pops this mod's next message into
  `variable`, or `""` when there is none. An empty message cannot be told from no message, so give
  each message a non-empty frame (an event name in front of the payload is enough).

Both are text to splice into your own events, not scripts: nothing new is installed for them.

## Addressing

Every message carries the mod's channel, derived from its id, and a mod cannot write it itself.
The loader's runtime object is the only code in a patched game that reads the engine's queue. It
runs in Begin Step, before any mod's Step, and sorts each message into the
[mailbox](../runtime/contract.md#mailboxes) of the mod it is addressed to. A message with no channel (GML
calling `host_send` directly) is dropped, and the JavaScript side logs that it was.

## The wire

A patched game dials the host over TCP on `127.0.0.1`, at the port given by its launch arguments:

```
--emu-mod-port=<port> --emu-mod-game=<game id>
```

Its first message is `hello:<game id>`. After that each message is `<channel> <body>`, framed by
engine:

- **GameMaker Studio** uses its stock `network_*` functions; each message is UTF-8 followed by a
  NUL byte.
- **GameMaker 8** reaches a socket through Http Dll 2.3; each message is a `uintv` length prefix,
  then the UTF-8 text and a NUL.

A message longer than 1 MiB is taken for a lost stream, and the connection is dropped.
`@sculptr/sculptr/channel` exports both framings and the launch arguments for any host that wants to
speak this.

## Under the SDK's events

An SDK [event](../../events.md) is one message: the event's name, a space, then the payload. The
SDK uses `api.send`, `api.gml.send`, `api.gml.receive` and `api.on("message")` to carry them; the
`mod` object does not expose them.
