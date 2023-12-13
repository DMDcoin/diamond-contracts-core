import { ethers, upgrades } from "hardhat";
import { getImplementationAddress } from '@openzeppelin/upgrades-core';
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

export async function upgradeProxy(caller: SignerWithAddress, contractName: string, proxyAddress: string, timeoutSec: number) {
    const contractFactory = await ethers.getContractFactory(contractName, caller);

    const contract = await upgrades.upgradeProxy(proxyAddress, contractFactory);

    await new Promise((r) => setTimeout(r, timeoutSec * 1000));

    const newImplementationAddress = await getImplementationAddress(ethers.provider, proxyAddress);

    console.log("Proxy upgraded: ", proxyAddress);
    console.log("New implementation address: ", newImplementationAddress);

    return contract;
}