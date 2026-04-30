# sonyflake-ts

TypeScript port of [sony/sonyflake](https://github.com/sony/sonyflake) for Node.js (≥20) and Bun.

Sonyflake is a distributed unique ID generator inspired by Twitter's Snowflake, with a different bit layout optimised for longer lifetime and more machines:

```
+-+--------------------------------------+----------+----------------+
|0|       39 bits time (10 ms units)     | 8 bits   |  16 bits       |
| |                                      | sequence |  machine id    |
+-+--------------------------------------+----------+----------------+
```

* lifetime: ~174 years (vs. ~69 for Snowflake)
* machines: up to 2^16 = 65,536
* throughput: 256 IDs per machine per 10 ms (≈ 25,600 / sec)

IDs are 63 bits wide, so they always fit in a signed `int64` — and in JS they're returned as `bigint`.

## Why not FFI?

The whole algorithm is bit shifts on a 63-bit integer. `BigInt` does that natively without an FFI hop, a native build, or platform-specific binaries. A pure-TS port is faster end-to-end and works identically on Node and Bun.

## Usage

```ts
import { Sonyflake, decompose } from "sonyflake-ts";

const sf = await Sonyflake.create({
  // Optional. Defaults to 2014-09-01 UTC, like sony/sonyflake.
  startTime: new Date("2024-01-01T00:00:00Z"),
  // Optional. Defaults to lower 16 bits of a private IPv4 address.
  machineID: 0x1234,
});

const id = await sf.nextID();      // bigint
console.log(id.toString());        // decimal
console.log(id.toString(16));      // hex

const parts = decompose(id);
// { id, msb, time, sequence, machineID }
```

`machineID` may be a number, a sync function, or an async function (e.g. fetching from etcd / Redis). Pass `checkMachineID` to enforce uniqueness at startup.

## Testing

```sh
bun test
```

## License

MIT — same as the original.
