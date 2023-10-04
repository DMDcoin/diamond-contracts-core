import { ethers, upgrades } from "hardhat";


async function upgrade() {

    const [deployer] = await ethers.getSigners();

    console.log("upgrading with account from: ", deployer.address);

    let stakingContract = await ethers.getContractAt("StakingHbbft", "0x1100000000000000000000000000000000000001");

    let txResult = await stakingContract.setStakingTransitionTimeframeLength(300);

    console.log("Done.", txResult);
}


upgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});