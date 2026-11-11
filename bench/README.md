# Benchmarks

The `*.bench.ts` files here are performance benches, run by the `benchy` CLI.

`benchy --against main` asks whether your working tree is faster than `main` at the commit your branch left it, with a verdict per bench. It runs each bench's first variant; `benchy <file> --against main --variant <name>` picks another. Add `--quick` while iterating. `benchy list` shows every bench and its variants without running anything, and `benchy --help` lists the rest.

A claim about phones gets measured on one: run `benchy serve --tls`, ask the user to scan the QR code it prints with the phone, then measure with `--target worker:<id> --hub <url>` (`benchy devices` lists the ids). The `benchy` skill's Phones section has the details.

The `benchy` skill covers writing a bench and reading a verdict.

`benchy.d.ts` holds the tool's API types, and `npm run test:types` checks this folder against them. After updating benchy, run `benchy init` again to refresh them.
