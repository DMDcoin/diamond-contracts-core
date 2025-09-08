import { HDNodeWallet, Provider } from "ethers";
import { ethers } from "hardhat"
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

export const ZeroIpAddress = ethers.zeroPadBytes("0x00", 16);

export enum KeyGenMode {
    NotAPendingValidator,
    WritePart,
    WaitForOtherParts,
    WriteAck,
    WaitForOtherAcks,
    AllKeysDone
};

export class Validator {
    
    static async create() {
        const provider = ethers.provider;

        const stakingWallet = ethers.Wallet.createRandom(provider);
        const miningWallet = ethers.Wallet.createRandom(provider);
        
        const ipAddress = ethers.zeroPadValue("0xc0a80102", 16); // value for tests "192.168.1.2" 
        const port = '0xbd6';

        const initBalance = ethers.parseEther("1000000");

        await helpers.setBalance(stakingWallet.address, initBalance);
        await helpers.setBalance(miningWallet.address, initBalance);

        return new this(
            stakingWallet,
            miningWallet,
            ipAddress,
            port
        );
    }

    constructor(
        public staking: HDNodeWallet,
        public mining: HDNodeWallet,
        public ipAddress: string,
        public port: string,
    ) { }

    publicKey(): string {
        return "0x".concat(this.mining.signingKey.publicKey.slice(4));
    }

    miningAddress(): string {
        return this.mining.address;
    }

    stakingAddress(): string {
        return this.staking.address;
    }
}
