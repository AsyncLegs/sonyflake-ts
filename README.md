# sonyflake-ts

[![npm version](https://img.shields.io/npm/v/sonyflake-ts.svg)](https://www.npmjs.com/package/sonyflake-ts)
[![npm downloads](https://img.shields.io/npm/dm/sonyflake-ts.svg)](https://www.npmjs.com/package/sonyflake-ts)
[![CI](https://github.com/AsyncLegs/sonyflake-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/AsyncLegs/sonyflake-ts/actions/workflows/ci.yml)
[![bundle size](https://img.shields.io/bundlephobia/minzip/sonyflake-ts.svg)](https://bundlephobia.com/package/sonyflake-ts)
[![license](https://img.shields.io/npm/l/sonyflake-ts.svg)](./LICENSE)

TypeScript port of [sony/sonyflake](https://github.com/sony/sonyflake) — a distributed unique ID generator inspired by Twitter's Snowflake, with a layout optimised for a longer lifetime and more machines.

- **Pure TypeScript.** No FFI, no native build, no platform-specific binaries — just `BigInt`.
- **Zero runtime dependencies.**
- **Works on Node.js (≥20) and Bun (≥1.0).** ESM-only.
- **Bit-for-bit compatible with the Go reference**, verified on every CI run by re-decomposing IDs produced by `sony/sonyflake` v1.2.0.

## Install

```sh
npm install sonyflake-ts
# or
bun add sonyflake-ts
# or
pnpm add sonyflake-ts
```

## Quick start

```ts
import { Sonyflake, decompose } from "sonyflake-ts";

// Default machine ID is the lower 16 bits of a private IPv4 address —
// fine for a laptop, you almost certainly want to set it explicitly in prod.
const sf = await Sonyflake.create({ machineID: 0x1234 });

const id = await sf.nextID(); // bigint, e.g. 617439447843082386n
console.log(id.toString());        // decimal — store as TEXT/BIGINT
console.log(id.toString(16));      // hex
```

## Bit layout

```
 63                                            24 23      16 15            0
+-+--------------------------------------------+---------+----------------+
|0|       39 bits time (10 ms units)           | 8 bits  |  16 bits       |
| |       since startTime epoch                | sequence|  machine id    |
+-+--------------------------------------------+---------+----------------+
```

| field      | bits | range                                                       |
| ---------- | ---: | ----------------------------------------------------------- |
| msb        |    1 | always 0 — keeps IDs positive in signed `int64`             |
| time       |   39 | 10 ms units since the configured epoch                      |
| sequence   |    8 | 0–255, resets every 10 ms tick                              |
| machine id |   16 | 0–65 535                                                    |

That gives:

- **lifetime** ≈ 174 years from the configured epoch (vs. ~69 for Snowflake)
- **machines** up to 2¹⁶ = 65 536
- **throughput** 256 IDs per machine per 10 ms (≈ 25 600 / s). When the per-tick budget is exhausted `nextID()` waits for the next tick.

IDs are 63 bits wide so they fit in a signed `int64` — and in JS they're returned as `bigint`. Don't cast to `Number`: above 2⁵³ you'll lose precision.

## API

### `Sonyflake.create(options?)` → `Promise<Sonyflake>`

```ts
interface SonyflakeOptions {
  /** Epoch as a Date or ms-since-unix-epoch. Defaults to 2014-09-01 UTC. */
  startTime?: Date | number;

  /** 16-bit machine ID. May be a number, sync fn, or async fn (etcd/Redis/...). */
  machineID?: number | (() => number | Promise<number>);

  /** Optional uniqueness check, called once with the resolved machine ID. */
  checkMachineID?: (id: number) => boolean | Promise<boolean>;
}
```

The async constructor lets you resolve `machineID` from a coordination service:

```ts
const sf = await Sonyflake.create({
  machineID: async () => {
    const id = await redis.incr("sonyflake:next-machine-id");
    return id & 0xffff;
  },
  checkMachineID: async (id) => (await redis.sismember("sonyflake:taken", id)) === 0,
});
```

Throws `SonyflakeError` if `startTime` is in the future or the machine ID is out of `[0, 0xFFFF]`.

### `sf.nextID()` → `Promise<bigint>`

Returns the next ID. Calls are internally serialized so concurrent invocations from the same process never produce duplicates.

### `decompose(id)` → `DecomposedID`

```ts
const parts = decompose(id);
// { id, msb, time, sequence, machineID }   // all bigints
```

### `SonyflakeError`

Thrown on invalid options or when the 39-bit time space is exhausted (after ~174 years).

## Storage tips

- **Postgres** — `BIGINT`. Pass as string: `JSON.stringify({ id: id.toString() })`.
- **MySQL** — `BIGINT UNSIGNED` works (we never set the top bit).
- **JSON** — `BigInt` is not JSON-serialisable. Convert with `id.toString()` before sending; on the wire treat it as a string. The receiver can use `BigInt(str)`.
- **Sorting** — IDs are roughly time-ordered, so a B-tree index on the ID column gives you cheap "recent first" pagination via `ORDER BY id DESC`.

## Compatibility with `sony/sonyflake`

The bit layout is identical, so an ID produced by this package is bit-equal to one produced by the Go library given the same `startTime`, `machineID`, and wall-clock instant. The CI suite enforces this: it shells out to a tiny Go program that uses `github.com/sony/sonyflake` to generate IDs, then re-decomposes them with this package's `decompose()` and asserts every field matches.

What's intentionally different:

- `Sonyflake.create()` is **async** so `machineID` / `checkMachineID` can be (the Go API is sync).
- `nextID()` returns a **Promise** to allow internal sleep when the per-tick sequence wraps. Concurrent callers are queued.
- IDs come back as `bigint` instead of `uint64`.

## Development

```sh
bun install
bun run build       # tsc -> dist/
bun x vitest run    # tests + Go-compat (skipped if `go` is missing)
```

CI runs the test suite under both **Bun** (latest) and **Node** (20 & 22) with a Go toolchain present so the `sony/sonyflake` cross-validation always executes.

## Credits

- [sony/sonyflake](https://github.com/sony/sonyflake) — the original Go implementation by Sony Group Corporation.
- The 10 ms time unit and bit layout are from that project; this package is a faithful port.

## License

MIT — same as the original.
