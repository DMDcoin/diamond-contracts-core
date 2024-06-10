import { ethers } from "hardhat";

// second step of contract upgade:
// setStakingTransitionTimeframeLength to 300 seconds.

async function upgrade() {

    const [deployer] = await ethers.getSigners();
    console.log("upgrading with account from: ", deployer.address);
    let validatorSetHbbft = await ethers.getContractAt("ValidatorSetHbbft", "0x1000000000000000000000000000000000000001");

    let seconds = 60 * 60 * 24 * 30;
    let txResult = await validatorSetHbbft.setValidatorInactivityThreshold(seconds);
    console.log("Done.", txResult);
}


upgrade().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
