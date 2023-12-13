import { ethers, upgrades } from "hardhat";
import { ConnectivityTrackerHbbft } from "../../../src/types/contracts/ConnectivityTrackerHbbft";
import { InitialContractsConfiguration } from "../../../tasks/types";
import { upgradeProxy } from "../upgrades";


async function doUpgrade() {
    const [deployer] = await ethers.getSigners();
    const minReportAgeBlocks = 10;
    const timeoutSec = 10;

    const contracts = InitialContractsConfiguration.fromFile("initial-contracts.json");

    console.log("executing from account: ", deployer.address);

    for (const conractName of ["ValidatorSetHbbft", "BlockRewardHbbft", "TxPermissionHbbft"]) {
        console.log("upgrading contract ", conractName);
        await upgradeProxy(deployer, conractName, contracts.getAddress(conractName)!, timeoutSec);
    }

    console.log("deploying ConnectivityTracker contract")
    const ConnectivityTrackerHbbftFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
    const connectivityTrackerHbbft = await upgrades.deployProxy(
        ConnectivityTrackerHbbftFactory,
        [
            deployer.address,                           // address _contractOwner,
            contracts.getAddress("ValidatorSetHbbft")!, // address _validatorSetContract,
            contracts.getAddress("StakingHbbft")!,      // address _stakingContract,
            contracts.getAddress("BlockRewardHbbft")!,  // address _blockRewardContract,
            minReportAgeBlocks,                         // uint256 _minReportAgeBlocks
        ],
        { initializer: 'initialize' }
    ) as ConnectivityTrackerHbbft;

    await connectivityTrackerHbbft.deployed();

    for (const contractName of ["BlockRewardHbbft", "TxPermissionHbbft"]) {
        console.log("Set ConnectivityTracker address in ", contractName);

        const factory = await ethers.getContractFactory(contractName);
        const _contract = factory.attach(contracts.getAddress(contractName)!);

        await _contract.connect(deployer).setConnectivityTracker(connectivityTrackerHbbft.address);
    }
}

doUpgrade();
