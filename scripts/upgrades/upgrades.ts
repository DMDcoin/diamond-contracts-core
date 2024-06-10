import { ethers, upgrades } from "hardhat";
import { getImplementationAddress } from '@openzeppelin/upgrades-core';
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export async function upgradeProxy(caller: HardhatEthersSigner, contractName: string, proxyAddress: string, timeoutSec: number) {
    const contractFactory = await ethers.getContractFactory(contractName, caller);

    const contract = await upgrades.upgradeProxy(
        proxyAddress,
        contractFactory,
        {
            timeout: timeoutSec * 1000
        }
    );

    const newImplementationAddress = await getImplementationAddress(ethers.provider, proxyAddress);

    console.log("Proxy upgraded: ", proxyAddress);
    console.log("New implementation address: ", newImplementationAddress);

    return contract;
}