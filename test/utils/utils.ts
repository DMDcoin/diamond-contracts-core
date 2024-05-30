export function random(low: number, high: number): bigint {
    return BigInt(Math.floor((Math.random() * (high - low) + low)));
}

export const range = (start: number, end: number) => Array.from({ length: (end - start) }, (v, k) => k + start);
