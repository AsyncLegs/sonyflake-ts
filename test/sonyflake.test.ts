import { describe, it, expect } from "vitest";
import { Sonyflake, decompose } from "../src/sonyflake.ts";

describe("Sonyflake", () => {
  it("generates monotonically increasing IDs", async () => {
    const sf = await Sonyflake.create({ machineID: 1 });
    const ids: bigint[] = [];
    for (let i = 0; i < 1000; i++) ids.push(await sf.nextID());
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBeGreaterThan(ids[i - 1]);
    }
  });

  it("produces unique IDs under burst", async () => {
    const sf = await Sonyflake.create({ machineID: 42 });
    const ids = new Set<bigint>();
    for (let i = 0; i < 5000; i++) ids.add(await sf.nextID());
    expect(ids.size).toBe(5000);
  });

  it("decompose round-trips machine id and components", async () => {
    const sf = await Sonyflake.create({ machineID: 0xabcd });
    const id = await sf.nextID();
    const parts = decompose(id);
    expect(parts.machineID).toBe(0xabcdn);
    expect(parts.msb).toBe(0n);
    expect(parts.sequence).toBeLessThanOrEqual(0xffn);
  });

  it("rejects future startTime", async () => {
    const future = new Date(Date.now() + 60_000);
    await expect(Sonyflake.create({ startTime: future, machineID: 1 })).rejects.toThrow();
  });

  it("rejects out-of-range machine id", async () => {
    await expect(Sonyflake.create({ machineID: 0x1_0000 })).rejects.toThrow();
    await expect(Sonyflake.create({ machineID: -1 })).rejects.toThrow();
  });

  it("encodes time relative to startTime", async () => {
    const start = new Date(Date.now() - 5_000);
    const sf = await Sonyflake.create({ startTime: start, machineID: 7 });
    const parts = decompose(await sf.nextID());
    // Roughly 500 units of 10ms == 5 seconds. Allow generous slack.
    expect(parts.time).toBeGreaterThanOrEqual(400n);
    expect(parts.time).toBeLessThan(2000n);
  });

  it("serializes concurrent nextID calls", async () => {
    const sf = await Sonyflake.create({ machineID: 9 });
    const ids = await Promise.all(Array.from({ length: 500 }, () => sf.nextID()));
    expect(new Set(ids).size).toBe(500);
  });
});
