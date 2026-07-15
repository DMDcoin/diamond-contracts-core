import assert from "node:assert/strict";

import { encodeFunctionData, type Abi, type Account, type Address, type Hex } from "viem";
import type { NetworkConnection } from "hardhat/types/network";

import type { TxPermissionHbbft } from "./types.js";

export interface PermittedContract {
    address: Address;
    abi: Abi;
}

export class Permission<T extends PermittedContract> {
    public constructor(
        public connection: NetworkConnection,
        public permissionContract: TxPermissionHbbft,
        public contract: T,
        public logOutput = false,
    ) { }

    public async callFunction(functionName: string, from: Account, params: unknown[]): Promise<Hex> {
        const asEncoded = encodeFunctionData({
            abi: this.contract.abi,
            functionName,
            args: params,
        });

        if (this.logOutput) {
            console.log("calling: ", functionName);
            console.log("from: ", from.address);
            console.log("params: ", params);
            console.log("encodedCall: ", asEncoded);
        }

        const [typesMask, cache] = await this.permissionContract.read.allowedTxTypes([
            from.address,
            this.contract.address,
            0n, // value
            0n, // gas price
            asEncoded,
        ]);

        // don't ask to cache this result.
        assert.equal(cache, false);

        /// 0x01 - basic transaction (e.g. ether transferring to user wallet);
        /// 0x02 - contract call;
        /// 0x04 - contract creation;
        /// 0x08 - private transaction.

        assert.equal(typesMask, 2, "Transaction should be allowed according to TxPermission Contract.");

        // we know now, that this call is allowed.
        // so we can execute it.
        const [wallet] = await this.connection.viem.getWalletClients();

        return wallet.sendTransaction({
            account: from,
            to: this.contract.address,
            data: asEncoded,
        });
    }
}
