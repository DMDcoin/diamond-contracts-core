import { ethers, upgrades } from "hardhat";

// second step of contract upgade:
// setStakingTransitionTimeframeLength to 300 seconds. 

async function upgrade() {

    const [deployer] = await ethers.getSigners();
    console.log("upgrading with account from: ", deployer.address);
    let stakingContract = await ethers.getContractAt("StakingHbbft", "0x1100000000000000000000000000000000000001");
    let txResult = await stakingContract.setStakingTransitionTimeframeLength(180);
    console.log("Done.", txResult);
}


upgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});