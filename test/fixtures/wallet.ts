import { Account } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export function createRandomWallet(): Account {
    return privateKeyToAccount(generatePrivateKey());
}
