---
sidebar_position: 4
title: Events
---

# Events

A mod's GML and its JS talk to each other with events. Each event has a name and an optional payload.

```ts
// Create a GM object
mod.resource.object.create({
  name: "main",
  events: {
    // Send messages to JS from anywhere in GML
    step: ({ send }) => `
      if (keyboard_check_pressed(ord("H"))) {
        ${send("ping", "room_get_name(room)")}
      }
    `,
  },
  // Listen to JS events in GM
  receive: {
    pong: ({ payload }) => `
      show_message("Pong received in room " + ${payload});
    `,
  },
});

// Listen to GM events in JS
mod.on("ping", (room) => {
  console.log(`Ping received from room ${room}`);
  // Send events to GM
  mod.send("pong", room);
});
```

Pressing `H` sends `"ping"` from GML to JS, with the current room name as the payload. JS logs it and sends `"pong"` back, which the object's `receive.pong` reacts to.

## Names

An event name is letters, digits, `-` and `_`, starting with a letter; anything else throws. `-` is
read as `_`, so `got-coin` and `got_coin` are the same event.

Each mod's events are its own, so two mods can both use `ping` without hearing each other.

## GML to JavaScript

`send(event, expression)` is a GML statement, handed to every piece of GML the mod writes (object
events, `receive`, scripts, hooks and insertions). `expression` is GML that evaluates to a string:
wrap a number in `string()`. Leave it out to send an empty payload.

`mod.on(event, handler)` calls `handler(payload)` for each one that arrives. An event can have
several handlers, and they all run. A handler may be `async`; one that throws or rejects is logged
with the mod's id and the event's name, and the others still run. An event nobody listens for is
dropped.

## JavaScript to GML

`mod.send(event, payload)` sends `payload`, a string (`""` when left out). Sent before the game is
connected, it waits and is delivered once the game is.

The GML side is an object's `receive`: one function per event, returning the GML to run for each
message. Its context is the object's, plus `payload`, the name of the variable holding the
message's string.

- The GML runs in the object's Step event, before the object's own `step`, once per message and
  in the order they arrived. Messages wait until an instance of that object runs its Step.
- Only one object of a mod can receive a given event: two would take turns losing messages, so
  declaring a second one throws.
- A mod that receives any event, or declares a [sprite](./resources/sprites.md), gets one more
  object of its own, invisible and persistent, which sorts the mod's incoming messages by event in
  Begin Step.

Underneath, an event is one message on the mod's [channel](./advanced/game/channel.md).
