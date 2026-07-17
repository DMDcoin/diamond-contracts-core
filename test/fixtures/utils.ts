import assert from "node:assert/strict";

export function random(low: number, high: number): bigint {
    return BigInt(Math.floor(Math.random() * (high - low) + low));
}

export const range = (start: number, end: number) => Array.from({ length: end - start }, (v, k) => k + start);

export function splitPublicKeys(publicKeys: string[]): string[] {
    return publicKeys.flatMap((x: string) => [x.substring(0, 66), "0x" + x.substring(66, 130)]);
}

export function assertCloseTo(actual: bigint, expected: bigint, tolerance: bigint): void {
    assert.ok(
        actual >= expected - tolerance && actual <= expected + tolerance,
        `expected ${actual} to be within ${tolerance} of ${expected}`,
    );
}
