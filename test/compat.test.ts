import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Sonyflake, decompose } from "../src/sonyflake.ts";

const compatDir = resolve(dirname(fileURLToPath(import.meta.url)), "../compat");
const goAvailable = spawnSync("go", ["version"]).status === 0;

interface GoRow {
  id: bigint;
  msb: bigint;
  time: bigint;
  sequence: bigint;
  machineID: bigint;
}

const compatBin = resolve(compatDir, "sonyflake-compat");

function runGoHelper(args: string[]): GoRow[] {
  // Prefer a prebuilt binary (CI builds it once); fall back to `go run`.
  const useBin = existsSync(compatBin);
  const cmd = useBin ? compatBin : "go";
  const cmdArgs = useBin ? args : ["run", ".", ...args];
  const res = spawnSync(cmd, cmdArgs, {
    cwd: compatDir,
    encoding: "utf8",
    timeout: 60_000,
  });
  if (res.status !== 0) {
    throw new Error(
      `go helper failed (status=${res.status}): stderr=${res.stderr} stdout=${res.stdout}`,
    );
  }
  const lines = res.stdout.trim().split("\n");
  // Drop header.
  return lines.slice(1).map((line) => {
    const [id, msb, time, sequence, machineID] = line.split("\t");
    return {
      id: BigInt(id),
      msb: BigInt(msb),
      time: BigInt(time),
      sequence: BigInt(sequence),
      machineID: BigInt(machineID),
    };
  });
}

describe.skipIf(!goAvailable || !existsSync(compatDir))(
  "compat with sony/sonyflake (Go reference)",
  () => {
    const machineID = 4242;
    let goRows: GoRow[];
    let goRunStartMs: number;

    beforeAll(
      () => {
        goRunStartMs = Date.now();
        goRows = runGoHelper(["-machine", String(machineID), "-n", "32"]);
      },
      60_000,
    );

    it("our decompose() matches Go Decompose() bit-for-bit", () => {
      for (const row of goRows) {
        const ours = decompose(row.id);
        expect(ours.msb).toBe(row.msb);
        expect(ours.time).toBe(row.time);
        expect(ours.sequence).toBe(row.sequence);
        expect(ours.machineID).toBe(row.machineID);
      }
    });

    it("Go IDs reconstruct from (time, seq, machineID) using our shifts", () => {
      // Re-encode each Go ID using OUR shift constants and verify we get
      // back the original 63-bit ID. This proves the bit layout is identical.
      for (const row of goRows) {
        const reconstructed =
          (row.time << 24n) | (row.sequence << 16n) | row.machineID;
        expect(reconstructed).toBe(row.id);
        expect(row.msb).toBe(0n); // top bit always 0 in Sonyflake
      }
    });

    it("all Go machine IDs equal the configured machineID", () => {
      for (const row of goRows) {
        expect(row.machineID).toBe(BigInt(machineID));
      }
    });

    it("Go time field uses default 2014-09-01 UTC epoch in 10ms units", () => {
      // Sonyflake epoch is 2014-09-01 UTC; time unit is 10 ms.
      const epochMs = Date.UTC(2014, 8, 1);
      const expectedUnits = BigInt(Math.floor((goRunStartMs - epochMs) / 10));
      // Go ran shortly after we recorded goRunStartMs; allow a few seconds drift.
      const drift = goRows[0].time - expectedUnits;
      expect(drift > -200n && drift < 1000n).toBe(true);
    });

    it("our generator agrees with Go on machineID and time band", async () => {
      // Generate IDs from our impl with the same machineID and default epoch,
      // immediately after Go ran. Their `time` fields should be very close.
      const sf = await Sonyflake.create({ machineID });
      const ours: bigint[] = [];
      for (let i = 0; i < 16; i++) ours.push(await sf.nextID());

      const goTimeMin = goRows[0].time;
      const goTimeMax = goRows[goRows.length - 1].time;

      for (const id of ours) {
        const parts = decompose(id);
        expect(parts.machineID).toBe(BigInt(machineID));
        expect(parts.msb).toBe(0n);
        // Our IDs were generated AFTER Go's, so our time >= goTimeMin.
        expect(parts.time).toBeGreaterThanOrEqual(goTimeMin);
        // ...and within a generous wall-clock window (5 seconds == 500 units).
        expect(parts.time - goTimeMax).toBeLessThan(500n);
      }
    });

    it("Go sequence stays inside 8-bit window", () => {
      for (const row of goRows) {
        expect(row.sequence).toBeGreaterThanOrEqual(0n);
        expect(row.sequence).toBeLessThanOrEqual(0xffn);
      }
    });

    it("custom startTime is honoured the same way as Go", () => {
      // Use a known epoch and verify time field equals (now-start)/10ms within drift.
      const startMs = Date.UTC(2024, 0, 1);
      const before = Date.now();
      const rows = runGoHelper([
        "-machine",
        String(machineID),
        "-n",
        "4",
        "-start-ms",
        String(startMs),
      ]);
      const expected = BigInt(Math.floor((before - startMs) / 10));
      const drift = rows[0].time - expected;
      expect(drift > -200n && drift < 1000n).toBe(true);
      // And our decompose still matches.
      for (const row of rows) {
        const ours = decompose(row.id);
        expect(ours.time).toBe(row.time);
        expect(ours.machineID).toBe(row.machineID);
      }
    });
  },
);
