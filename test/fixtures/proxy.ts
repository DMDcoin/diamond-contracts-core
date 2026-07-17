import { encodeFunctionData, type Address, type Hex } from "viem";
import type { NetworkConnection } from "hardhat/types/network";

type ViemHelpers = NetworkConnection["viem"];

export interface DeployProxiedOptions {
    initArgs?: readonly unknown[];
    initializer?: string | null;
    implementationArgs?: readonly unknown[];
    adminOwner?: Address;
}

export async function deployProxy<Name extends string>(
    viem: ViemHelpers,
    contractName: Name,
    options: DeployProxiedOptions = {},
) {
    const [defaultWallet] = await viem.getWalletClients();

    const adminOwner = options.adminOwner ?? defaultWallet.account.address;

    const implementation = await viem.deployContract(contractName, (options.implementationArgs ?? []) as never);

    const initData: Hex =
        options.initializer === null
            ? "0x"
            : encodeFunctionData({
                  abi: implementation.abi,
                  functionName: options.initializer ?? "initialize",
                  args: options.initArgs ?? [],
              });

    const proxy = await viem.deployContract("TransparentUpgradeableProxy", [
        implementation.address,
        adminOwner,
        initData,
    ]);

    const contract = await viem.getContractAt(contractName, proxy.address);

    return contract;
}
