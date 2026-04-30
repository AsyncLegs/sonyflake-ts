import { networkInterfaces } from "node:os";

const BIT_LEN_TIME = 39n;
const BIT_LEN_SEQUENCE = 8n;
const BIT_LEN_MACHINE_ID = 63n - BIT_LEN_TIME - BIT_LEN_SEQUENCE; // 16

const MASK_SEQUENCE = (1n << BIT_LEN_SEQUENCE) - 1n; // 0xFF
const MASK_MACHINE_ID = (1n << BIT_LEN_MACHINE_ID) - 1n; // 0xFFFF
const MAX_TIME = (1n << BIT_LEN_TIME) - 1n;

const SHIFT_TIME = BIT_LEN_SEQUENCE + BIT_LEN_MACHINE_ID; // 24
const SHIFT_SEQUENCE = BIT_LEN_MACHINE_ID; // 16

// Sonyflake time unit is 10 ms.
const SONYFLAKE_TIME_UNIT_MS = 10n;

// Default epoch: 2014-09-01 00:00:00 UTC (matches sony/sonyflake).
const DEFAULT_START_TIME_MS = Date.UTC(2014, 8, 1);

export interface SonyflakeOptions {
  /** Epoch as a Date or ms-since-unix-epoch. Defaults to 2014-09-01 UTC. */
  startTime?: Date | number;
  /** 16-bit machine ID. If omitted, derived from the lower 16 bits of a private IPv4 address. */
  machineID?: number | (() => number | Promise<number>);
  /** Optional uniqueness check, called with the resolved machine ID. */
  checkMachineID?: (id: number) => boolean | Promise<boolean>;
}

export interface DecomposedID {
  id: bigint;
  msb: bigint;
  time: bigint;
  sequence: bigint;
  machineID: bigint;
}

export class SonyflakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SonyflakeError";
  }
}

/**
 * Sonyflake — 63-bit distributed unique ID generator.
 *
 * Layout (MSB → LSB):
 *   1 bit  unused (always 0, keeps IDs positive in signed int64)
 *   39 bit time in 10 ms units since the configured epoch
 *   8  bit sequence number
 *   16 bit machine ID
 */
export class Sonyflake {
  private readonly startTimeUnits: bigint;
  private readonly machineID: bigint;
  private elapsedTime = 0n;
  private sequence: bigint;
  private mutex: Promise<void> = Promise.resolve();

  private constructor(startTimeUnits: bigint, machineID: bigint) {
    this.startTimeUnits = startTimeUnits;
    this.machineID = machineID;
    // Match sony/sonyflake: sequence starts at max so the first call rolls to 0.
    this.sequence = MASK_SEQUENCE;
  }

  static async create(options: SonyflakeOptions = {}): Promise<Sonyflake> {
    const startMs =
      options.startTime instanceof Date
        ? options.startTime.getTime()
        : options.startTime ?? DEFAULT_START_TIME_MS;

    if (startMs > Date.now()) {
      throw new SonyflakeError("startTime is in the future");
    }
    const startUnits = msToUnits(BigInt(startMs));

    let machineID: number;
    if (options.machineID === undefined) {
      machineID = lowerPrivateIPv4_16();
    } else if (typeof options.machineID === "function") {
      machineID = await options.machineID();
    } else {
      machineID = options.machineID;
    }

    if (!Number.isInteger(machineID) || machineID < 0 || machineID > 0xffff) {
      throw new SonyflakeError(`invalid machine id: ${machineID}`);
    }

    if (options.checkMachineID) {
      const ok = await options.checkMachineID(machineID);
      if (!ok) throw new SonyflakeError(`machine id ${machineID} failed uniqueness check`);
    }

    return new Sonyflake(startUnits, BigInt(machineID));
  }

  /** Generate the next ID. Serialized internally; safe to call concurrently. */
  nextID(): Promise<bigint> {
    const next = this.mutex.then(() => this.generate());
    // Keep the chain alive but don't propagate failures into later callers.
    this.mutex = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async generate(): Promise<bigint> {
    const current = currentElapsed(this.startTimeUnits);

    if (this.elapsedTime < current) {
      this.elapsedTime = current;
      this.sequence = 0n;
    } else {
      this.sequence = (this.sequence + 1n) & MASK_SEQUENCE;
      if (this.sequence === 0n) {
        this.elapsedTime += 1n;
        const overslept = this.elapsedTime - current;
        await sleepUnits(overslept);
      }
    }

    if (this.elapsedTime > MAX_TIME) {
      throw new SonyflakeError("time overflow: 39-bit time space exhausted");
    }

    return (
      (this.elapsedTime << SHIFT_TIME) |
      (this.sequence << SHIFT_SEQUENCE) |
      this.machineID
    );
  }
}

export function decompose(id: bigint): DecomposedID {
  return {
    id,
    msb: id >> 63n,
    time: id >> SHIFT_TIME,
    sequence: (id >> SHIFT_SEQUENCE) & MASK_SEQUENCE,
    machineID: id & MASK_MACHINE_ID,
  };
}

function msToUnits(ms: bigint): bigint {
  return ms / SONYFLAKE_TIME_UNIT_MS;
}

function currentElapsed(startUnits: bigint): bigint {
  return msToUnits(BigInt(Date.now())) - startUnits;
}

function sleepUnits(units: bigint): Promise<void> {
  if (units <= 0n) return Promise.resolve();
  const ms = Number(units * SONYFLAKE_TIME_UNIT_MS);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lowerPrivateIPv4_16(): number {
  const ip = findPrivateIPv4();
  if (!ip) {
    throw new SonyflakeError(
      "no private IPv4 address found; supply machineID explicitly",
    );
  }
  const parts = ip.split(".").map(Number);
  return ((parts[2] & 0xff) << 8) | (parts[3] & 0xff);
}

function findPrivateIPv4(): string | undefined {
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (isPrivateIPv4(info.address)) return info.address;
    }
  }
  return undefined;
}

function isPrivateIPv4(addr: string): boolean {
  const [a, b] = addr.split(".").map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}
