import hre from "hardhat";

import { parseEther, pad, type Account, type Address, type Hex } from "viem";

import { createRandomWallet } from "./wallet.js";

const { networkHelpers: helpers } = await hre.network.getOrCreate();

export const ZeroIpAddress = pad("0x00", { size: 16 });

export class Validator {
    static async create() {
        const stakingWallet = createRandomWallet();
        const miningWallet = createRandomWallet();

        const ipAddress = pad("0xc0a80102", { size: 16 }); // value for tests "192.168.1.2"
        const port = "0xbd6";

        const initBalance = parseEther("10000000");

        await helpers.setBalance(stakingWallet.address, initBalance);
        await helpers.setBalance(miningWallet.address, initBalance);

        return new this(stakingWallet, miningWallet, ipAddress, port);
    }

    constructor(
        public staking: Account,
        public mining: Account,
        public ipAddress: Hex,
        public port: string,
    ) { }

    publicKey(): Hex {
        return `0x${this.mining.publicKey!.slice(4)}`
    }

    miningAddress(): Address {
        return this.mining.address;
    }

    stakingAddress(): Address {
        return this.staking.address;
    }
}
