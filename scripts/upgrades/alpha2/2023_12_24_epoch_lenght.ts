//https://github.com/DMDcoin/diamond-contracts-core/issues/198

import { ethers } from "hardhat";
import { InitialContractsConfiguration } from "../../../tasks/types";
import { upgradeProxy } from "../upgrades";

async function doUpgrade() {

    const [deployer] = await ethers.getSigners();
    const contracts = InitialContractsConfiguration.fromFile("initial-contracts.json");
    console.log("executing from account: ", deployer.address);

    let stakingAddress = contracts.getAddress("StakingHbbft");
    console.log("staking update:", stakingAddress);

    if (stakingAddress) {
        let result = await upgradeProxy(deployer, "StakingHbbft", stakingAddress, 10);
        console.log("staking update result:", result.address);

        let stakingContract = await ethers.getContractAt("StakingHbbft", stakingAddress);

        let epochCallResult = await stakingContract.setStakingFixedEpochDuration(12 * 60 * 60);
        console.log("staking update result:", epochCallResult.hash);

        let transitionTimeTx = await stakingContract.setStakingTransitionTimeframeLength(600);
        console.log("transitionTimeTx", transitionTimeTx.hash);
    }
}

doUpgrade();
