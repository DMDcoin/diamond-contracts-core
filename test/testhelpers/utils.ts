import * as _ from "lodash";
import fp from "lodash/fp";

import { ethers } from "hardhat"
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

export function random(low: number, high: number): bigint {
    return BigInt(Math.floor((Math.random() * (high - low) + low)));
}

export const range = (start: number, end: number) => Array.from({ length: (end - start) }, (v, k) => k + start);

export function splitPublicKeys(publicKeys: string[]): string[] {
    return fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])(publicKeys)
}

export async function impersonateAcc(accAddress: string) {
    await helpers.impersonateAccount(accAddress);
    await helpers.setBalance(accAddress, ethers.parseEther("100"));

    return await ethers.getSigner(accAddress);
}
