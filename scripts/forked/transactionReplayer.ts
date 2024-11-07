import { ethers } from 'hardhat';
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import * as Ethers from "ethers";


/// Transaction Replayer is able to replay pending transactions from one RPC on the configured network.
/// This might be a hardhat forked network, and synergises well with it to replay transactions that could not get included
/// in the original network, because it did lead to a problem in the block finalization.
/// Here is an example how to spin up a forked Network, used in testing of the alpha4 network.
/// Spin up a Node:
/// `hh node --fork http://62.171.133.46:54100 --fork-block-number 450019`
/// Add a new external network in the hardhat config.
/// ```        forked: {
///    url: "http://127.0.0.1:8545",
///    timeout: 1_000_000
///    },
/// ```
/// Then you can use the TransactionReplayer to replay the transactions from the original RPC.
/// ```typescript
/// import { TransactionReplayer } from "./forked/transactionReplayer";
/// let replayer = new TransactionReplayer("http://62.171.133.46:54100");
/// await replayer.replayAllPendingTransactions();
export class TransactionReplayer {
    public constructor(public originalRPC: string) {

    }

    public async replayAllPendingTransactions() {


        let txs = await this.getPendingTransactions();

        for (let x of txs) {

            // send the raw transaction to the new RPC.


            console.log("--- original hash:", x.hash);
            const tx = {
                from: x.from,
                to: x.to,
                data: x.input,
                value: x.value,
                gasLimit: "0x4c4b40",
                gasPrice: "1000000000",
            };

            await helpers.impersonateAccount(x.from);
            let signer = await ethers.provider.getSigner(x.from);

            try {
                const respone = await signer.sendTransaction(tx);
                console.log("OK: ", respone.hash);
            } catch (e) {
                console.log("Error: ", tx);
            }

        }
    }

    public async getPendingTransactions() {
        // retrieve the pending transactions from original RPC.
        // returns an array of  pending transactions fetched from the RPC.

        // initialize a new Ethers instance for the original RPC.
        const origProvider = new Ethers.JsonRpcProvider(this.originalRPC);

        // get the pending transactions.
        const pendingTransactions = await origProvider.send("parity_pendingTransactions", []);

        return pendingTransactions;
    }

    public async printBlockNumber() {
        const origProvider = new Ethers.JsonRpcProvider(this.originalRPC);
        console.log("Block number: ", await origProvider.getBlockNumber());
    }
}