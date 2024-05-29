import { ethers } from "hardhat";
import { upgradeProxy } from "../upgrades";

async function deploy() {
    const [deployer] = await ethers.getSigners();

    console.log("Deploying from: ", deployer.address);

    await upgradeProxy(deployer, "ValidatorSetHbbft", '0x1000000000000000000000000000000000000001', 15);

    console.log("Done.");
}

deploy().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
