import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, HDNodeWallet } from "ethers";

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
    private publicKeyWallet: HDNodeWallet;
    public ipAddress: string;
    public port: string;

    constructor(
        public staking: HardhatEthersSigner,
        public mining: HardhatEthersSigner,
    ) {
        this.publicKeyWallet = ethers.Wallet.createRandom();
        this.ipAddress = ZeroIpAddress;
        this.port = '0xbd6';
    }

    publicKey(): string {
        return this.publicKeyWallet.signingKey.publicKey;
    }

    miningAddress(): string {
        return this.mining.address;
    }

    stakingAddress(): string {
        return this.staking.address;
    }
}
