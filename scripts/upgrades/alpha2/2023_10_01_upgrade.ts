import { ethers, upgrades } from "hardhat";

export async function upgradeProxy(contractName: string, proxyAddress: string, timeoutSec: number) {
    const contractFactory = await ethers.getContractFactory(contractName);

    const contract = await upgrades.upgradeProxy(proxyAddress, contractFactory);

    await new Promise((r) => setTimeout(r, timeoutSec * 1000));

    const newImplementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

    console.log("Proxy upgraded: ", proxyAddress);
    console.log("New implementation address: ", newImplementationAddress);

    return contract;
}

async function deploy() {
    const [deployer] = await ethers.getSigners();

    console.log("Deploying from: ", deployer.address);

    await upgradeProxy("StakingHbbft", '0x1100000000000000000000000000000000000001', 15);

    console.log("Done.");
}

deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});