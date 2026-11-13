# Licensing

sculptr's own source code is licensed MIT; see [LICENSE](LICENSE).

**The package you install is not all MIT.** It carries the two GameMaker format libraries the
patcher is built on, each as its own directory of files:

- `dist/gm8/`: gm8patch, built from [gm8-lib](https://github.com/QuentinJanuel/gm8-lib),
  GPL-2.0-only
- `dist/gms/`: the runtime built from [gms-lib](https://github.com/QuentinJanuel/gms-lib),
  GPL-3.0-only

Each directory holds that library's own `LICENSE` and `NOTICE`. Third-party components are listed
in [NOTICE](NOTICE).

## Which entry points load what

The mod contract imports no backend and loads neither directory:
`@sculptr/sculptr/contract`, `/resources`, `/game-code`, `/channel`, `/ui`, `/runtime` and
`/panel` are sculptr's own code only, MIT. `@sculptr/sculptr/serve` loads neither itself either: it
uses the backends its caller passes in.

The patcher, `@sculptr/sculptr` (`patch`, `gameCode`) and the `sculptr` CLI, loads `dist/gm8/` to
handle a GameMaker 8 game and `dist/gms/` to handle a GameMaker Studio game, each on first use.
A program that does that is a combined work with that library. GPL-2.0-only and GPL-3.0 are
mutually incompatible, so a single process that loads both is a combined work under two licences
that cannot both be satisfied.

This is deliberate. One patcher that handles every GameMaker family is worth more than two that
each handle one, and the incompatibility is accepted as a known, documented risk rather than
something to be discovered later.

## What follows from that

- Treat a distributed sculptr build as copyleft, and redistribute it with source.
- Do not _link_ the patcher into a program whose own licence cannot accept that. Run it as a
  separate process instead (the `sculptr` CLI is one).
- sculptr's own files remain MIT and can be reused on their own terms, which is why `LICENSE` is
  MIT rather than a copyleft licence.
