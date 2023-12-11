import { ethers, upgrades } from "hardhat";
import { ConnectivityTrackerHbbft } from "../../../src/types/contracts/ConnectivityTrackerHbbft";


async function doUpgrade() {

    const [deployer] = await ethers.getSigners();
    //console.log("upgrading with account from: ", deployer.address);
    //let validatorSetHbbft = await ethers.getContractAt("ValidatorSetHbbft", "0x1000000000000000000000000000000000000001");

    // Deploy ValidatorSet contract
    //const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");

    const ConnectivityTrackerHbbftFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
    
    //upgrades.prepareUpgrade()

    let connectivityTrackerHbbft = await upgrades.deployProxy(
        ConnectivityTrackerHbbftFactory,
        [
            deployer.address, //address _contractOwner,
            //address _validatorSetContract,
            //address _stakingContract,
            //address _blockRewardContract,
            //uint256 _minReportAgeBlocks
        ],
        { initializer: 'initialize' }
    ) as ConnectivityTrackerHbbft;

    await connectivityTrackerHbbft.deployed();

    // deploy connectivity checker
    // deploy proxy for connectivity checker
    // initialize connectivity checker

    



    // upgrade contracts
    // ------------
    // - reward
    // - permission
    // - validator set
    // - staking




}

doUpgrade();