import { ethers, network, upgrades } from "hardhat";

// import { expectEvent } from '@openzeppelin/test-helpers';

import {
    BlockRewardHbbftCoinsMock,
    AdminUpgradeabilityProxy,
    RandomHbbftMock,
    ValidatorSetHbbftMock,
    StakingHbbftCoinsMock,
    KeyGenHistory,
    IStakingHbbft
} from "../src/types";

import fp from 'lodash/fp';
import { BigNumber, BigNumberish, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { PromiseOrValue } from "../src/types/common";


require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bn')(BigNumber))
    .should();


// delegatecall are a problem for truffle debugger
// therefore it makes sense to use a proxy for automated testing to have the proxy testet.
// and to not use it if specific transactions needs to get debugged,
// like truffle `debug 0xabc`.
const useUpgradeProxy = !(process.env.CONTRACTS_NO_UPGRADE_PROXY == 'true');
console.log('useUpgradeProxy:', useUpgradeProxy);

//smart contracts
let blockRewardHbbft: BlockRewardHbbftCoinsMock;
let adminUpgradeabilityProxy: AdminUpgradeabilityProxy;
let randomHbbft: RandomHbbftMock;
let validatorSetHbbft: ValidatorSetHbbftMock;
let stakingHbbft: StakingHbbftCoinsMock;
let keyGenHistory: KeyGenHistory;

//addresses
let owner: SignerWithAddress;
let candidateMiningAddress: SignerWithAddress;
let candidateStakingAddress: SignerWithAddress;
let accounts: SignerWithAddress[];

//consts
const ERROR_MSG = 'VM Exception while processing transaction: revert';

describe('StakingHbbft', () => {
    let initialValidators: string[];
    let initialStakingAddresses: string[];
    let initialValidatorsPubKeys: string[];
    let initialValidatorsPubKeysSplit: string[];
    let initialValidatorsIpAddresses: string[];

    const minStake = BigNumber.from(ethers.utils.parseEther('1'));
    const maxStake = BigNumber.from(ethers.utils.parseEther('100000'));
    // one epoch in 1 day.
    const stakingFixedEpochDuration = BigNumber.from(86400);

    // the transition time window is 1 hour.
    const stakingTransitionTimeframeLength = BigNumber.from(3600);

    const stakingWithdrawDisallowPeriod = BigNumber.from(1);

    // the reward for the first epoch.
    const epochReward = BigNumber.from(ethers.utils.parseEther('1'));

    // the amount the deltaPot gets filled up.
    // this is 60-times more, since the deltaPot get's
    // drained each step by 60 by default.
    const deltaPotFillupValue = epochReward.mul(BigNumber.from('60'));

    beforeEach(async () => {
        [owner, ...accounts] = await ethers.getSigners();
        const accountAddresses = accounts.map(item => item.address);
        initialValidators = accountAddresses.slice(1, 3 + 1); // accounts[1...3]
        initialStakingAddresses = accountAddresses.slice(4, 6 + 1); // accounts[4...6]
        initialStakingAddresses.length.should.be.equal(3);
        initialStakingAddresses[0].should.not.be.equal('0x0000000000000000000000000000000000000000');
        initialStakingAddresses[1].should.not.be.equal('0x0000000000000000000000000000000000000000');
        initialStakingAddresses[2].should.not.be.equal('0x0000000000000000000000000000000000000000');



        const AdminUpgradeabilityProxyFactory = await ethers.getContractFactory("AdminUpgradeabilityProxy")

        // Deploy ValidatorSet contract
        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        validatorSetHbbft = await ValidatorSetFactory.deploy() as ValidatorSetHbbftMock;
        if (useUpgradeProxy) {
            adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(validatorSetHbbft.address, owner.address, []);
            validatorSetHbbft = await ethers.getContractAt("ValidatorSetHbbftMock", adminUpgradeabilityProxy.address);
        }

        // Deploy BlockRewardHbbft contract
        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftCoinsMock");
        blockRewardHbbft = await BlockRewardHbbftFactory.deploy() as BlockRewardHbbftCoinsMock;
        if (useUpgradeProxy) {
            adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(blockRewardHbbft.address, owner.address, []);
            blockRewardHbbft = await ethers.getContractAt("BlockRewardHbbftCoinsMock", adminUpgradeabilityProxy.address);
        }

        // Deploy BlockRewardHbbft contract
        const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbftMock");
        randomHbbft = await RandomHbbftFactory.deploy() as RandomHbbftMock;
        if (useUpgradeProxy) {
            adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(randomHbbft.address, owner.address, []);
            randomHbbft = await ethers.getContractAt("RandomHbbftMock", adminUpgradeabilityProxy.address);
        }
        // Deploy BlockRewardHbbft contract
        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftCoinsMock");
        stakingHbbft = await StakingHbbftFactory.deploy() as StakingHbbftCoinsMock;
        if (useUpgradeProxy) {
            adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(stakingHbbft.address, owner.address, []);
            stakingHbbft = await ethers.getContractAt("StakingHbbftCoinsMock", adminUpgradeabilityProxy.address);
        }

        //without that, the Time is 0,
        //meaning a lot of checks that expect time to have some value deliver incorrect results.
        await increaseTime(1);

        const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
        keyGenHistory = await KeyGenFactory.deploy() as KeyGenHistory;
        if (useUpgradeProxy) {
            adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(keyGenHistory.address, owner.address, []);
            keyGenHistory = await ethers.getContractAt("KeyGenHistory", adminUpgradeabilityProxy.address);
        }

        await keyGenHistory.initialize(validatorSetHbbft.address, initialValidators, [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 181, 129, 31, 84, 186, 242, 5, 151, 59, 35, 196, 140, 106, 29, 40, 112, 142, 156, 132, 158, 47, 223, 253, 185, 227, 249, 190, 96, 5, 99, 239, 213, 127, 29, 136, 115, 71, 164, 202, 44, 6, 171, 131, 251, 147, 159, 54, 49, 1, 0, 0, 0, 0, 0, 0, 0, 153, 0, 0, 0, 0, 0, 0, 0, 4, 177, 133, 61, 18, 58, 222, 74, 65, 5, 126, 253, 181, 113, 165, 43, 141, 56, 226, 132, 208, 218, 197, 119, 179, 128, 30, 162, 251, 23, 33, 73, 38, 120, 246, 223, 233, 11, 104, 60, 154, 241, 182, 147, 219, 81, 45, 134, 239, 69, 169, 198, 188, 152, 95, 254, 170, 108, 60, 166, 107, 254, 204, 195, 170, 234, 154, 134, 26, 91, 9, 139, 174, 178, 248, 60, 65, 196, 218, 46, 163, 218, 72, 1, 98, 12, 109, 186, 152, 148, 159, 121, 254, 34, 112, 51, 70, 121, 51, 167, 35, 240, 5, 134, 197, 125, 252, 3, 213, 84, 70, 176, 160, 36, 73, 140, 104, 92, 117, 184, 80, 26, 240, 106, 230, 241, 26, 79, 46, 241, 195, 20, 106, 12, 186, 49, 254, 168, 233, 25, 179, 96, 62, 104, 118, 153, 95, 53, 127, 160, 237, 246, 41], [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 181, 129, 31, 84, 186, 242, 5, 151, 59, 35, 196, 140, 106, 29, 40, 112, 142, 156, 132, 158, 47, 223, 253, 185, 227, 249, 190, 96, 5, 99, 239, 213, 127, 29, 136, 115, 71, 164, 202, 44, 6, 171, 131, 251, 147, 159, 54, 49, 1, 0, 0, 0, 0, 0, 0, 0, 153, 0, 0, 0, 0, 0, 0, 0, 4, 177, 133, 61, 18, 58, 222, 74, 65, 5, 126, 253, 181, 113, 165, 43, 141, 56, 226, 132, 208, 218, 197, 119, 179, 128, 30, 162, 251, 23, 33, 73, 38, 120, 246, 223, 233, 11, 104, 60, 154, 241, 182, 147, 219, 81, 45, 134, 239, 69, 169, 198, 188, 152, 95, 254, 170, 108, 60, 166, 107, 254, 204, 195, 170, 234, 154, 134, 26, 91, 9, 139, 174, 178, 248, 60, 65, 196, 218, 46, 163, 218, 72, 1, 98, 12, 109, 186, 152, 148, 159, 121, 254, 34, 112, 51, 70, 121, 51, 167, 35, 240, 5, 134, 197, 125, 252, 3, 213, 84, 70, 176, 160, 36, 73, 140, 104, 92, 117, 184, 80, 26, 240, 106, 230, 241, 26, 79, 46, 241, 195, 20, 106, 12, 186, 49, 254, 168, 233, 25, 179, 96, 62, 104, 118, 153, 95, 53, 127, 160, 237, 246, 41], [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 181, 129, 31, 84, 186, 242, 5, 151, 59, 35, 196, 140, 106, 29, 40, 112, 142, 156, 132, 158, 47, 223, 253, 185, 227, 249, 190, 96, 5, 99, 239, 213, 127, 29, 136, 115, 71, 164, 202, 44, 6, 171, 131, 251, 147, 159, 54, 49, 1, 0, 0, 0, 0, 0, 0, 0, 153, 0, 0, 0, 0, 0, 0, 0, 4, 177, 133, 61, 18, 58, 222, 74, 65, 5, 126, 253, 181, 113, 165, 43, 141, 56, 226, 132, 208, 218, 197, 119, 179, 128, 30, 162, 251, 23, 33, 73, 38, 120, 246, 223, 233, 11, 104, 60, 154, 241, 182, 147, 219, 81, 45, 134, 239, 69, 169, 198, 188, 152, 95, 254, 170, 108, 60, 166, 107, 254, 204, 195, 170, 234, 154, 134, 26, 91, 9, 139, 174, 178, 248, 60, 65, 196, 218, 46, 163, 218, 72, 1, 98, 12, 109, 186, 152, 148, 159, 121, 254, 34, 112, 51, 70, 121, 51, 167, 35, 240, 5, 134, 197, 125, 252, 3, 213, 84, 70, 176, 160, 36, 73, 140, 104, 92, 117, 184, 80, 26, 240, 106, 230, 241, 26, 79, 46, 241, 195, 20, 106, 12, 186, 49, 254, 168, 233, 25, 179, 96, 62, 104, 118, 153, 95, 53, 127, 160, 237, 246, 41]],
            [[[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 4, 239, 1, 112, 13, 13, 251, 103, 186, 212, 78, 44, 47, 250, 221, 84, 118, 88, 7, 64, 206, 186, 11, 2, 8, 204, 140, 106, 179, 52, 251, 237, 19, 53, 74, 187, 217, 134, 94, 66, 68, 89, 42, 85, 207, 155, 220, 101, 223, 51, 199, 37, 38, 203, 132, 13, 77, 78, 114, 53, 219, 114, 93, 21, 25, 164, 12, 43, 252, 160, 16, 23, 111, 79, 230, 121, 95, 223, 174, 211, 172, 231, 0, 52, 25, 49, 152, 79, 128, 39, 117, 216, 85, 201, 237, 242, 151, 219, 149, 214, 77, 233, 145, 47, 10, 184, 175, 162, 174, 237, 177, 131, 45, 126, 231, 32, 147, 227, 170, 125, 133, 36, 123, 164, 232, 129, 135, 196, 136, 186, 45, 73, 226, 179, 169, 147, 42, 41, 140, 202, 191, 12, 73, 146, 2]], [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 4, 239, 1, 112, 13, 13, 251, 103, 186, 212, 78, 44, 47, 250, 221, 84, 118, 88, 7, 64, 206, 186, 11, 2, 8, 204, 140, 106, 179, 52, 251, 237, 19, 53, 74, 187, 217, 134, 94, 66, 68, 89, 42, 85, 207, 155, 220, 101, 223, 51, 199, 37, 38, 203, 132, 13, 77, 78, 114, 53, 219, 114, 93, 21, 25, 164, 12, 43, 252, 160, 16, 23, 111, 79, 230, 121, 95, 223, 174, 211, 172, 231, 0, 52, 25, 49, 152, 79, 128, 39, 117, 216, 85, 201, 237, 242, 151, 219, 149, 214, 77, 233, 145, 47, 10, 184, 175, 162, 174, 237, 177, 131, 45, 126, 231, 32, 147, 227, 170, 125, 133, 36, 123, 164, 232, 129, 135, 196, 136, 186, 45, 73, 226, 179, 169, 147, 42, 41, 140, 202, 191, 12, 73, 146, 2]], [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 4, 239, 1, 112, 13, 13, 251, 103, 186, 212, 78, 44, 47, 250, 221, 84, 118, 88, 7, 64, 206, 186, 11, 2, 8, 204, 140, 106, 179, 52, 251, 237, 19, 53, 74, 187, 217, 134, 94, 66, 68, 89, 42, 85, 207, 155, 220, 101, 223, 51, 199, 37, 38, 203, 132, 13, 77, 78, 114, 53, 219, 114, 93, 21, 25, 164, 12, 43, 252, 160, 16, 23, 111, 79, 230, 121, 95, 223, 174, 211, 172, 231, 0, 52, 25, 49, 152, 79, 128, 39, 117, 216, 85, 201, 237, 242, 151, 219, 149, 214, 77, 233, 145, 47, 10, 184, 175, 162, 174, 237, 177, 131, 45, 126, 231, 32, 147, 227, 170, 125, 133, 36, 123, 164, 232, 129, 135, 196, 136, 186, 45, 73, 226, 179, 169, 147, 42, 41, 140, 202, 191, 12, 73, 146, 2]]]
        );

        // Initialize ValidatorSet
        await validatorSetHbbft.initialize(
            blockRewardHbbft.address, // _blockRewardContract
            randomHbbft.address, // _randomContract
            stakingHbbft.address, // _stakingContract
            keyGenHistory.address, //_keyGenHistoryContract
            initialValidators, // _initialMiningAddresses
            initialStakingAddresses, // _initialStakingAddresses
        );

        // The following private keys belong to the accounts 1-3, fixed by using the "--mnemonic" option when starting ganache.
        // const initialValidatorsPrivKeys = ["0x272b8400a202c08e23641b53368d603e5fec5c13ea2f438bce291f7be63a02a7", "0xa8ea110ffc8fe68a069c8a460ad6b9698b09e21ad5503285f633b3ad79076cf7", "0x5da461ff1378256f69cb9a9d0a8b370c97c460acbe88f5d897cb17209f891ffc"];
        // Public keys corresponding to the three private keys above.
        initialValidatorsPubKeys = ['0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
            '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
            '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56'];
        initialValidatorsPubKeysSplit = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            (initialValidatorsPubKeys);
        // The IP addresses are irrelevant for these unit test, just initialize them to 0.
        initialValidatorsIpAddresses = ['0x00000000000000000000000000000000', '0x00000000000000000000000000000000', '0x00000000000000000000000000000000'];


        //await blockRewardHbbft.addToDeltaPot({value: deltaPotFillupValue});

    });

    describe('addPool()', async () => {
        let candidateMiningAddress: SignerWithAddress;
        let candidateStakingAddress: SignerWithAddress;

        beforeEach(async () => {
            candidateMiningAddress = accounts[7];
            candidateStakingAddress = accounts[8];

            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };
            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );
        });
        it('should set the corresponding public keys', async () => {
            for (let i = 0; i < initialStakingAddresses.length; i++) {
                (await stakingHbbft.getPoolPublicKey(initialStakingAddresses[i])).should.be.deep.equal(initialValidatorsPubKeys[i]);
            }
        });
        it('should set the corresponding IP addresses', async () => {
            for (let i = 0; i < initialStakingAddresses.length; i++) {
                let ip_result = (await stakingHbbft.getPoolInternetAddress(initialStakingAddresses[i]));
                ip_result[0].should.be.deep.equal(initialValidatorsIpAddresses[i]);
            }
        });
        it('should create a new pool', async () => {
            false.should.be.equal(await stakingHbbft.isPoolActive(candidateStakingAddress.address));
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake });
            const poolIsActiveNow = await stakingHbbft.isPoolActive(candidateStakingAddress.address);
            true.should.be.equal(poolIsActiveNow);
        });
        it('should fail if created with overstaked pool', async () => {
            false.should.be.equal(await stakingHbbft.isPoolActive(candidateStakingAddress.address));
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: maxStake.add(minStake) }).should.be.rejectedWith('stake limit has been exceeded');
        });
        it('should fail if mining address is 0', async () => {
            await stakingHbbft.connect(candidateStakingAddress).addPool('0x0000000000000000000000000000000000000000', '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Mining address can't be 0");
        });
        it('should fail if mining address is equal to staking', async () => {
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateStakingAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Mining address cannot be the same as the staking one");
        });
        it('should fail if the pool with the same mining/staking address is already existing', async () => {
            const candidateMiningAddress2 = accounts[9];
            const candidateStakingAddress2 = accounts[10];

            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake });

            await stakingHbbft.connect(candidateStakingAddress2).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Mining address already used as a mining one");
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress2.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Staking address already used as a staking one");

            await stakingHbbft.connect(candidateMiningAddress2).addPool(candidateStakingAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Mining address already used as a staking one");
            await stakingHbbft.connect(candidateMiningAddress).addPool(candidateStakingAddress2.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Staking address already used as a mining one");

            await stakingHbbft.connect(candidateMiningAddress2).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Mining address already used as a mining one");
            await stakingHbbft.connect(candidateMiningAddress).addPool(candidateMiningAddress2.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Staking address already used as a mining one");

            await stakingHbbft.connect(candidateStakingAddress2).addPool(candidateStakingAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Mining address already used as a staking one");
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateStakingAddress2.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("Staking address already used as a staking one");

            await stakingHbbft.connect(candidateStakingAddress2).addPool(candidateMiningAddress2.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake });
        });
        it('should fail if gasPrice is 0', async () => {
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { gasPrice: 0, value: minStake }).should.be.rejectedWith("GasPrice is 0");
        });
        it('should fail if staking amount is 0', async () => {
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: BigNumber.from(0) }).should.be.rejectedWith("Stake: stakingAmount is 0");
        });
        // it('should fail if stacking time is inside disallowed range', async () => {
        //   await stakingHbbft.addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        //   '0x00000000000000000000000000000000', {connect(candidateStakingAddress).value: minStake}).should.be.rejectedWith("Stake: disallowed period");
        //   await increaseTime(2);
        //   await stakingHbbft.addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
        //   '0x00000000000000000000000000000000', {connect(candidateStakingAddress).value: minStake});
        // });
        it('should fail if staking amount is less than CANDIDATE_MIN_STAKE', async () => {
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake.div(BigNumber.from(2)) }).should.be.rejectedWith("Stake: candidateStake less than candidateMinStake");
        });
        it('stake amount should be increased', async () => {
            const amount = minStake.mul(BigNumber.from(2));
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: amount });
            amount.should.be.equal(await stakingHbbft.stakeAmount(candidateStakingAddress.address, candidateStakingAddress.address));
            amount.should.be.equal(await stakingHbbft.stakeAmountByCurrentEpoch(candidateStakingAddress.address, candidateStakingAddress.address));
            amount.should.be.equal(await stakingHbbft.stakeAmountTotal(candidateStakingAddress.address));
        });
        it('should be able to add more than one pool', async () => {
            const candidate1MiningAddress = candidateMiningAddress;
            const candidate1StakingAddress = candidateStakingAddress;
            const candidate2MiningAddress = accounts[9];
            const candidate2StakingAddress = accounts[10];
            const amount1 = minStake.mul(BigNumber.from(2));
            const amount2 = minStake.mul(BigNumber.from(3));

            // Add two new pools
            (await stakingHbbft.isPoolActive(candidate1StakingAddress.address)).should.be.equal(false);
            (await stakingHbbft.isPoolActive(candidate2StakingAddress.address)).should.be.equal(false);
            await stakingHbbft.connect(candidate1StakingAddress).addPool(candidate1MiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: amount1 });
            await stakingHbbft.connect(candidate2StakingAddress).addPool(candidate2MiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: amount2 });
            (await stakingHbbft.isPoolActive(candidate1StakingAddress.address)).should.be.equal(true);
            (await stakingHbbft.isPoolActive(candidate2StakingAddress.address)).should.be.equal(true);

            // Check indexes (0...2 are busy by initial validators)
            BigNumber.from(3).should.be.equal(await stakingHbbft.poolIndex(candidate1StakingAddress.address));
            BigNumber.from(4).should.be.equal(await stakingHbbft.poolIndex(candidate2StakingAddress.address));

            // Check indexes in the `poolsToBeElected` list
            BigNumber.from(0).should.be.equal(await stakingHbbft.poolToBeElectedIndex(candidate1StakingAddress.address));
            BigNumber.from(1).should.be.equal(await stakingHbbft.poolToBeElectedIndex(candidate2StakingAddress.address));

            // Check pools' existence
            const validators = await validatorSetHbbft.getValidators();

            (await stakingHbbft.getPools()).should.be.deep.equal([
                await validatorSetHbbft.stakingByMiningAddress(validators[0]),
                await validatorSetHbbft.stakingByMiningAddress(validators[1]),
                await validatorSetHbbft.stakingByMiningAddress(validators[2]),
                candidate1StakingAddress.address,
                candidate2StakingAddress.address
            ]);
        });
        it('shouldn\'t allow adding more than MAX_CANDIDATES pools', async () => {
            for (let p = initialValidators.length; p < 100; p++) {
                // Generate new candidate staking address
                let candidateStakingAddress = '0x';
                for (let i = 0; i < 20; i++) {
                    let randomByte = random(0, 255).toString(16);
                    if (randomByte.length % 2) {
                        randomByte = '0' + randomByte;
                    }
                    candidateStakingAddress += randomByte;
                }

                // Add a new pool
                await stakingHbbft.addPoolActiveMock(candidateStakingAddress);
                BigNumber.from(p).should.be.equal(await stakingHbbft.poolIndex(candidateStakingAddress));
            }

            // Try to add a new pool outside of max limit, max limit is 100 in mock contract.
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake }).should.be.rejectedWith("MAX_CANDIDATES pools exceeded");
            false.should.be.equal(await stakingHbbft.isPoolActive(candidateStakingAddress.address));
        });
        it('should remove added pool from the list of inactive pools', async () => {
            await stakingHbbft.addPoolInactiveMock(candidateStakingAddress.address);
            (await stakingHbbft.getPoolsInactive()).should.be.deep.equal([candidateStakingAddress.address]);
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake });
            true.should.be.equal(await stakingHbbft.isPoolActive(candidateStakingAddress.address));
            (await stakingHbbft.getPoolsInactive()).length.should.be.equal(0);
        });
    });

    describe('contract balance', async () => {

        beforeEach(async () => {
            candidateMiningAddress = accounts[7];
            candidateStakingAddress = accounts[8];

            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );
        });

        it('cannot be increased by sending native coins', async () => {
            await owner.sendTransaction({ to: stakingHbbft.address, value: 1 }).should.be.rejectedWith("Not payable");
            await owner.sendTransaction({ to: accounts[1].address, value: 1 });
            (await ethers.provider.getBalance(stakingHbbft.address)).should.be.equal('0');
        });

        it('can be increased by sending coins to payable functions', async () => {
            (await ethers.provider.getBalance(stakingHbbft.address)).should.be.equal('0');
            await stakingHbbft.connect(candidateStakingAddress).addPool(candidateMiningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: minStake });
            (BigNumber.from(await ethers.provider.getBalance(stakingHbbft.address))).should.be.equal(minStake);
            await stakingHbbft.connect(candidateStakingAddress).stake(candidateStakingAddress.address, { value: minStake });
            (BigNumber.from(await ethers.provider.getBalance(stakingHbbft.address))).should.be.equal(minStake.mul(BigNumber.from(2)));
        });

    });

    describe('claimReward()', async () => {

        let delegator: SignerWithAddress;
        let delegatorMinStake: BigNumber;

        beforeEach(async () => {

            //console.log('calling before each claimReward()');

            // Initialize BlockRewardHbbft
            await blockRewardHbbft.initialize(
                validatorSetHbbft.address
            );

            // Initialize StakingHbbft
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );

            // Staking epoch #0 starts on block #1
            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(0));
            //(await stakingHbbft.stakingEpochStartBlock()).should.be.equal(BigNumber.from(1));
            //(await validatorSetHbbft.getCurrentBlockNumber()).should.be.equal(BigNumber.from(1));
            //(await stakingHbbft.getCurrentBlockNumber()).should.be.equal(BigNumber.from(1));


            // Validators place stakes during the epoch #0
            const candidateMinStake = await stakingHbbft.candidateMinStake();
            for (let i = 0; i < initialStakingAddresses.length; i++) {
                // Validator places stake on themselves
                await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[i])).stake(initialStakingAddresses[i], { value: candidateMinStake });
            }

            // The delegator places stake on the first validator
            delegator = accounts[10];
            delegatorMinStake = await stakingHbbft.delegatorMinStake();
            await stakingHbbft.connect(delegator).stake(initialStakingAddresses[0], { value: delegatorMinStake });

            // Epoch's fixed duration ends
            //const stakingFixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock();
            //

            await timeTravelToTransition();

            // the pending validator set should be updated
            (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(3);

            // Staking epoch #0 finishes
            //const stakingEpochEndBlock = stakingFixedEpochEndBlock.add(keyGenerationDuration);

            await timeTravelToEndEpoch();
            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(1));
        });

        async function _claimRewardStakeIncreasing(epochsPoolRewarded: number[], epochsStakeIncreased: number[]) {
            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];
            const epochPoolReward = BigNumber.from(ethers.utils.parseEther('1'));
            const maxStakingEpoch = Math.max(Math.max.apply(null, epochsPoolRewarded), Math.max.apply(null, epochsStakeIncreased));

            (await ethers.provider.getBalance(blockRewardHbbft.address)).should.be.equal('0');

            // Emulate rewards for the pool
            for (let i = 0; i < epochsPoolRewarded.length; i++) {
                const stakingEpoch = epochsPoolRewarded[i];
                await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            }

            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(epochPoolReward.mul(BigNumber.from(epochsPoolRewarded.length)));

            let prevStakingEpoch = 0;
            const validatorStakeAmount = await stakingHbbft.stakeAmount(stakingAddress, stakingAddress);
            let stakeAmount = await stakingHbbft.stakeAmount(stakingAddress, delegator.address);
            let stakeAmountOnEpoch = [BigNumber.from(0)];

            let s = 0;
            for (let epoch = 1; epoch <= maxStakingEpoch; epoch++) {
                const stakingEpoch = epochsStakeIncreased[s];

                if (stakingEpoch == epoch) {
                    const startBlock = BigNumber.from(120954 * stakingEpoch + 1);
                    await stakingHbbft.setStakingEpoch(stakingEpoch);
                    await stakingHbbft.setValidatorSetAddress(owner.address);
                    //await stakingHbbft.setStakingEpochStartBlock(startBlock);
                    await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);


                    // Emulate delegator's stake increasing
                    await stakingHbbft.connect(delegator).stake(stakingAddress, { value: delegatorMinStake });

                    for (let e = prevStakingEpoch + 1; e <= stakingEpoch; e++) {
                        stakeAmountOnEpoch[e] = stakeAmount;
                    }
                    stakeAmount = await stakingHbbft.stakeAmount(stakingAddress, delegator.address);
                    prevStakingEpoch = stakingEpoch;
                    s++;
                }

                // Emulate snapshotting for the pool
                await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, epoch + 1, miningAddress);
            }

            const lastEpochRewarded = epochsPoolRewarded[epochsPoolRewarded.length - 1];
            await stakingHbbft.setStakingEpoch(lastEpochRewarded + 1);

            if (prevStakingEpoch < lastEpochRewarded) {
                for (let e = prevStakingEpoch + 1; e <= lastEpochRewarded; e++) {
                    stakeAmountOnEpoch[e] = stakeAmount;
                }
            }

            let delegatorRewardExpected = BigNumber.from(0);
            let validatorRewardExpected = BigNumber.from(0);
            for (let i = 0; i < epochsPoolRewarded.length; i++) {
                const stakingEpoch = epochsPoolRewarded[i];
                await blockRewardHbbft.setValidatorMinRewardPercent(stakingEpoch, 30);
                const delegatorShare = await blockRewardHbbft.delegatorShare(
                    stakingEpoch,
                    stakeAmountOnEpoch[stakingEpoch],
                    validatorStakeAmount,
                    validatorStakeAmount.add(stakeAmountOnEpoch[stakingEpoch]),
                    epochPoolReward
                );
                const validatorShare = await blockRewardHbbft.validatorShare(
                    stakingEpoch,
                    validatorStakeAmount,
                    validatorStakeAmount.add(stakeAmountOnEpoch[stakingEpoch]),
                    epochPoolReward
                );
                delegatorRewardExpected = delegatorRewardExpected.add(delegatorShare);
                validatorRewardExpected = validatorRewardExpected.add(validatorShare);
            }

            return {
                delegatorMinStake,
                miningAddress,
                stakingAddress,
                epochPoolReward,
                maxStakingEpoch,
                delegatorRewardExpected,
                validatorRewardExpected
            };
        }

        async function _delegatorNeverStakedBefore() {


            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];

            const epochPoolReward = BigNumber.from(ethers.utils.parseEther('1'));
            const deltaPotFillupValue = epochPoolReward.mul(BigNumber.from('60'));
            //blockRewardHbbft.add
            await blockRewardHbbft.addToDeltaPot({ value: deltaPotFillupValue });


            // the beforeeach  alsready runs 1 epoch, so we expect to be in epoch 1 here.
            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(1));

            //await timeTravelToEndEpoch();
            //(await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(2));

            // the pending validator set should be empy
            (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(0);

            // Staking epoch #1: Start
            (await validatorSetHbbft.getValidators()).should.be.deep.equal(initialValidators);
            (await stakingHbbft.areStakeAndWithdrawAllowed()).should.be.equal(true);
            await stakingHbbft.connect(delegator).orderWithdraw(stakingAddress, delegatorMinStake);


            (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(0);

            // Staking epoch #1: start of Transition Phase!
            await timeTravelToTransition();

            // the pending validator set should be updated
            (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(3);

            //!!! here it failes for some reason
            //Staking epoch #1: Epoch end block
            await timeTravelToEndEpoch();

            // we restock this one epoch reward that got payed out.
            // todo: think about: Maybe this restocking should happen in the timeTravelToEndEpoch function to have
            // constant epoch payouts.
            await blockRewardHbbft.addToDeltaPot({ value: epochPoolReward });

            // now epoch #2 has started.
            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(2));

            // the pending validator set should be empty
            (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(0);

            // epoch #2: the delegator withdraws their stake
            await stakingHbbft.connect(delegator).claimOrderedWithdraw(stakingAddress);

            (await stakingHbbft.stakeAmount(stakingAddress, delegator.address)).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.orderedWithdrawAmount(stakingAddress, delegator.address)).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.stakeFirstEpoch(stakingAddress, delegator.address)).should.be.equal(BigNumber.from(1));
            (await stakingHbbft.stakeLastEpoch(stakingAddress, delegator.address)).should.be.equal(BigNumber.from(2));

            await stakingHbbft.setStakeFirstEpoch(stakingAddress, delegator.address, BigNumber.from(0));
            await stakingHbbft.setStakeLastEpoch(stakingAddress, delegator.address, BigNumber.from(0));
            await stakingHbbft.clearDelegatorStakeSnapshot(stakingAddress, delegator.address, BigNumber.from(1));
            await stakingHbbft.clearDelegatorStakeSnapshot(stakingAddress, delegator.address, BigNumber.from(2));

            // Staking epoch #2: end of fixed duration
            await timeTravelToTransition();

            // Staking epoch #2: Epoch end block
            await timeTravelToEndEpoch();

            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(3));
            //(await stakingHbbft.stakingEpochStartBlock()).should.be.equal(stakingEpochEndBlock.add(BigNumber.from(1)));
            return { miningAddress, stakingAddress, epochPoolReward };
        }

        async function testClaimRewardRandom(epochsPoolRewarded: number[], epochsStakeIncreased: number[]) {
            const {
                delegatorMinStake,
                miningAddress,
                stakingAddress,
                epochPoolReward,
                maxStakingEpoch,
                delegatorRewardExpected,
                validatorRewardExpected
            } = await _claimRewardStakeIncreasing(
                epochsPoolRewarded,
                epochsStakeIncreased
            );

            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            let weiSpent = BigNumber.from(0);
            let epochsPoolRewardedRandom = epochsPoolRewarded;
            shuffle(epochsPoolRewardedRandom);
            for (let i = 0; i < epochsPoolRewardedRandom.length; i++) {
                const stakingEpoch = epochsPoolRewardedRandom[i];
                let result = await stakingHbbft.connect(delegator).claimReward([stakingEpoch], stakingAddress);
                let receipt = await ethers.provider.getTransactionReceipt(result.hash);
                weiSpent = weiSpent.add((BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice)));
                // Call once again to ensure the reward cannot be withdrawn twice
                result = await stakingHbbft.connect(delegator).claimReward([stakingEpoch], stakingAddress);
                receipt = await ethers.provider.getTransactionReceipt(result.hash);
                weiSpent = weiSpent.add((BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice)));
            }
            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

            const validatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(stakingAddress));
            weiSpent = BigNumber.from(0);
            shuffle(epochsPoolRewardedRandom);
            for (let i = 0; i < epochsPoolRewardedRandom.length; i++) {
                const stakingEpoch = epochsPoolRewardedRandom[i];
                const result = await stakingHbbft.connect(await ethers.getSigner(stakingAddress)).claimReward([stakingEpoch], stakingAddress);
                let receipt = await ethers.provider.getTransactionReceipt(result.hash);
                weiSpent = weiSpent.add((BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice)));
            }
            const validatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(stakingAddress));
            validatorCoinsBalanceAfter.should.be.equal(validatorCoinsBalanceBefore.add(validatorRewardExpected).sub(weiSpent));

            const blockRewardBalanceExpected = epochPoolReward.mul(BigNumber.from(epochsPoolRewarded.length)).sub(delegatorRewardExpected).sub(validatorRewardExpected);
            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(blockRewardBalanceExpected);
        }

        async function testClaimRewardAfterStakeIncreasing(epochsPoolRewarded: number[], epochsStakeIncreased: number[]) {
            const {
                delegatorMinStake,
                miningAddress,
                stakingAddress,
                epochPoolReward,
                maxStakingEpoch,
                delegatorRewardExpected,
                validatorRewardExpected
            } = await _claimRewardStakeIncreasing(
                epochsPoolRewarded,
                epochsStakeIncreased
            );

            let rewardAmountsCalculated = await stakingHbbft.getRewardAmount([], stakingAddress, delegator.address);
            rewardAmountsCalculated.should.be.equal(delegatorRewardExpected);

            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            const result = await stakingHbbft.connect(delegator).claimReward([], stakingAddress);
            const receipt = await result.wait();
            const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));
            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));

            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

            rewardAmountsCalculated = await stakingHbbft.getRewardAmount([], stakingAddress, stakingAddress);
            rewardAmountsCalculated.should.be.equal(validatorRewardExpected);

            await stakingHbbft.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);

            const blockRewardBalanceExpected = epochPoolReward.mul(BigNumber.from(epochsPoolRewarded.length)).sub(delegatorRewardExpected).sub(validatorRewardExpected);

            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(blockRewardBalanceExpected);
        }

        async function testClaimRewardAfterStakeMovements(epochsPoolRewarded: number[], epochsStakeMovement: number[]) {
            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];
            const epochPoolReward = BigNumber.from(ethers.utils.parseEther('1'));


            const deltaPotFillupValue = epochPoolReward.mul(BigNumber.from('60'));
            //blockRewardHbbft.add
            await blockRewardHbbft.addToDeltaPot({ value: deltaPotFillupValue });

            const currentblockRewardHbbftBalance = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
            currentblockRewardHbbftBalance.should.be.equal(deltaPotFillupValue);

            for (let i = 0; i < epochsPoolRewarded.length; i++) {
                const stakingEpoch = epochsPoolRewarded[i];

                // Emulate snapshotting for the pool
                await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress);

                // Emulate rewards for the pool
                await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            }

            // initial validator got reward for epochsPoolRewarded
            (await blockRewardHbbft.epochsPoolGotRewardFor(miningAddress)).length.should.be.equal(epochsPoolRewarded.length);

            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(deltaPotFillupValue.add(epochPoolReward.mul(BigNumber.from(epochsPoolRewarded.length))));

            for (let i = 0; i < epochsStakeMovement.length; i++) {
                const stakingEpoch = epochsStakeMovement[i];

                // Emulate delegator's stake movement
                const startBlock = BigNumber.from(120954 * stakingEpoch + 1);
                await stakingHbbft.setStakingEpoch(stakingEpoch);
                await stakingHbbft.setValidatorSetAddress(owner.address);
                //await stakingHbbft.setStakingEpochStartBlock(startBlock);
                await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
                await stakingHbbft.connect(delegator).orderWithdraw(stakingAddress, delegatorMinStake);
                await stakingHbbft.connect(delegator).orderWithdraw(stakingAddress, BigNumber.from(0).sub(delegatorMinStake));
            }

            const stakeFirstEpoch = await stakingHbbft.stakeFirstEpoch(stakingAddress, delegator.address);
            await stakingHbbft.setStakeFirstEpoch(stakingAddress, delegator.address, 0);
            await stakingHbbft.connect(delegator).claimReward([], stakingAddress).should.be.rejectedWith("Claim: first epoch can't be 0");
            await stakingHbbft.setStakeFirstEpoch(stakingAddress, delegator.address, stakeFirstEpoch);

            if (epochsPoolRewarded.length > 0) {
                if (epochsPoolRewarded.length > 1) {
                    const reversedEpochsPoolRewarded = [...epochsPoolRewarded].reverse();
                    const currentEpoch = (await stakingHbbft.stakingEpoch()).toNumber();
                    if (reversedEpochsPoolRewarded[0] < currentEpoch) {
                        await stakingHbbft.connect(delegator).claimReward(reversedEpochsPoolRewarded, stakingAddress).should.be.rejectedWith("Claim: need strictly increasing order");
                    } else {
                        await stakingHbbft.connect(delegator).claimReward([], stakingAddress).should.be.rejectedWith("Claim: only before current epoch");
                    }
                }

                await stakingHbbft.setStakingEpoch(epochsPoolRewarded[epochsPoolRewarded.length - 1]);
                await stakingHbbft.connect(delegator).claimReward([], stakingAddress).should.be.rejectedWith("Claim: only before current epoch");
                await stakingHbbft.setStakingEpoch(epochsPoolRewarded[epochsPoolRewarded.length - 1] + 1);

                if (epochsPoolRewarded.length == 1) {
                    const validatorStakeAmount = await blockRewardHbbft.snapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress);
                    await blockRewardHbbft.setSnapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress, 0);
                    const result = await stakingHbbft.connect(delegator).claimReward([], stakingAddress);
                    const receipt = await result.wait();
                    receipt.events?.length.should.be.equal(1);
                    receipt.events?.[0].args?.nativeCoinsAmount.should.be.equal(BigNumber.from(0));
                    await blockRewardHbbft.setSnapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress, validatorStakeAmount);
                    await stakingHbbft.clearRewardWasTaken(stakingAddress, delegator.address, epochsPoolRewarded[0]);
                }
            }
            //staked half the amount, hence .div(2)
            const delegatorRewardExpected = epochPoolReward.mul(BigNumber.from(epochsPoolRewarded.length)).div(BigNumber.from(2));

            const rewardAmountsCalculated = await stakingHbbft.getRewardAmount([], stakingAddress, delegator.address);
            rewardAmountsCalculated.should.be.equal(delegatorRewardExpected);

            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            let weiSpent = BigNumber.from(0);
            for (let i = 0; i < 3; i++) {
                // We call `claimReward` several times, but it withdraws the reward only once
                const result = await stakingHbbft.connect(delegator).claimReward([], stakingAddress);
                const receipt = await result.wait();
                weiSpent = weiSpent.add((BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice)));
            }
            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));

            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

            for (let i = 0; i < 3; i++) {
                // We call `claimReward` several times, but it withdraws the reward only once
                const result = await stakingHbbft.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);
                const receipt = await result.wait();
                if (i == 0) {
                    receipt.events?.length.should.be.equal(epochsPoolRewarded.length);
                } else {
                    receipt.events?.length.should.be.equal(0);
                }
            }
            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(deltaPotFillupValue);
        }

        it('reward tries to be withdrawn before first stake', async () => {
            const {
                miningAddress,
                stakingAddress,
            } = await _delegatorNeverStakedBefore();

            //const deltaPotFillupValue = BigNumber.from(web3.eth.toWei(60));
            //await blockRewardHbbft.addToDeltaPot({value: deltaPotFillupValue});

            // a fake epoch reward.
            const epochPoolReward = '1000';

            // Emulate snapshotting and rewards for the pool on the epoch #9
            let stakingEpoch = 9;
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress);
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, miningAddress)).should.be.equal(epochPoolReward);
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            // Emulate the delegator's first stake on epoch #10
            stakingEpoch = 10;

            await stakingHbbft.setStakingEpoch(stakingEpoch);
            await stakingHbbft.setValidatorSetAddress(owner.address);
            //await stakingHbbft.setStakingEpochStartBlock(startBlock);
            await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);

            await stakingHbbft.connect(delegator).stake(stakingAddress, { value: delegatorMinStake });
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, miningAddress)).should.be.equal(epochPoolReward);
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            // // Emulate rewards for the pool on epoch #11
            stakingEpoch = 11;
            await stakingHbbft.setStakingEpoch(stakingEpoch);
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, miningAddress)).should.be.equal(epochPoolReward);
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            await stakingHbbft.setStakingEpoch(12);

            const rewardAmountsCalculated = await stakingHbbft.getRewardAmount([9, 10], stakingAddress, delegator.address);
            rewardAmountsCalculated.should.be.equal(BigNumber.from(0));

            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            let result = await stakingHbbft.connect(delegator).claimReward([9, 10], stakingAddress);
            let receipt = await result.wait();
            const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));
            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));

            receipt.events?.length.should.be.equal(0);
            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.sub(weiSpent));

            const unclaimedEpochs = await blockRewardHbbft.epochsPoolGotRewardFor(miningAddress);


            result = await stakingHbbft.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);
            receipt = await result.wait();
            //console.log('rewards for ', stakingAddress);
            //console.log(result);
            receipt.events?.length.should.be.equal(5);
            receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(1));
            receipt.events?.[1].args?.stakingEpoch.should.be.equal(BigNumber.from(2));
            receipt.events?.[2].args?.stakingEpoch.should.be.equal(BigNumber.from(9));
            receipt.events?.[3].args?.stakingEpoch.should.be.equal(BigNumber.from(10));
            receipt.events?.[4].args?.stakingEpoch.should.be.equal(BigNumber.from(11));

            result = await stakingHbbft.connect(delegator).claimReward([], stakingAddress);
            receipt = await result.wait();
            receipt.events?.length.should.be.equal(1);
            receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(11));

            (await stakingHbbft.stakeFirstEpoch(stakingAddress, delegator.address)).should.be.equal(BigNumber.from(11));
            (await stakingHbbft.stakeLastEpoch(stakingAddress, delegator.address)).should.be.equal(BigNumber.from(0));
        });

        //return;

        it('delegator stakes and withdraws at the same epoch', async () => {
            const {
                miningAddress,
                stakingAddress
            } = await _delegatorNeverStakedBefore();

            const epochPoolReward = '1000';

            // Emulate snapshotting and rewards for the pool on the epoch #9
            let stakingEpoch = 9;
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress);
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, miningAddress)).should.be.equal(epochPoolReward);
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            // Emulate the delegator's first stake and withdrawal on epoch #10
            stakingEpoch = 10;
            const startBlock = BigNumber.from(120954 * stakingEpoch + 1);
            await stakingHbbft.setStakingEpoch(stakingEpoch);
            await stakingHbbft.setValidatorSetAddress(owner.address);
            //await stakingHbbft.setStakingEpochStartBlock(startBlock);
            await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);

            await stakingHbbft.connect(delegator).stake(stakingAddress, { value: delegatorMinStake });
            await stakingHbbft.connect(delegator).withdraw(stakingAddress, delegatorMinStake);
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            // Emulate rewards for the pool on epoch #11
            stakingEpoch = 11;
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            await stakingHbbft.setStakingEpoch(12);

            const rewardAmountsCalculated = await stakingHbbft.getRewardAmount([], stakingAddress, delegator.address);
            rewardAmountsCalculated.should.be.equal(BigNumber.from(0));


            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            let result = await stakingHbbft.connect(delegator).claimReward([], stakingAddress);
            let receipt = await result.wait();
            const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));
            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));

            receipt.events?.length.should.be.equal(0);
            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.sub(weiSpent));

            result = await stakingHbbft.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);
            receipt = await result.wait();
            receipt.events?.length.should.be.equal(5);
            receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(1));
            receipt.events?.[1].args?.stakingEpoch.should.be.equal(BigNumber.from(2));
            receipt.events?.[2].args?.stakingEpoch.should.be.equal(BigNumber.from(9));
            receipt.events?.[3].args?.stakingEpoch.should.be.equal(BigNumber.from(10));
            receipt.events?.[4].args?.stakingEpoch.should.be.equal(BigNumber.from(11));

            (await stakingHbbft.stakeFirstEpoch(stakingAddress, delegator.address)).should.be.equal(BigNumber.from(11));
            (await stakingHbbft.stakeLastEpoch(stakingAddress, delegator.address)).should.be.equal(BigNumber.from(11));
        });

        it('non-rewarded epochs are passed', async () => {
            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];
            const epochPoolReward = BigNumber.from(ethers.utils.parseEther('1'));

            const epochsPoolRewarded = [10, 20, 30, 40, 50];
            for (let i = 0; i < epochsPoolRewarded.length; i++) {
                const stakingEpoch = epochsPoolRewarded[i];

                // Emulate snapshotting for the pool
                await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress);

                // Emulate rewards for the pool
                await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            }
            // initial validator got reward for epochs: [10, 20, 30, 40, 50]
            (await blockRewardHbbft.epochsPoolGotRewardFor(miningAddress)).length.should.be.equal(5);

            await stakingHbbft.setStakingEpoch(51);

            const epochsToWithdrawFrom = [15, 25, 35, 45];
            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            const result = await stakingHbbft.connect(delegator).claimReward(epochsToWithdrawFrom, stakingAddress);
            const receipt = await result.wait();
            const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));
            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));

            receipt.events?.length.should.be.equal(epochsToWithdrawFrom.length);
            for (let i = 0; i < epochsToWithdrawFrom.length; i++) {
                receipt.events?.[i].args?.stakingEpoch.should.be.equal(BigNumber.from(epochsToWithdrawFrom[i]));
                receipt.events?.[i].args?.nativeCoinsAmount.should.be.equal(BigNumber.from(0));
            }

            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.sub(weiSpent));
        });

        it('stake movements 1', async () => {
            await testClaimRewardAfterStakeMovements(
                [5, 15, 25, 35],
                [10, 20, 30]
            );
        });
        it('stake movements 2', async () => {
            await testClaimRewardAfterStakeMovements(
                [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                [1, 2, 3, 4, 5, 6, 7, 8, 9]
            );
        });
        it('stake movements 3', async () => {
            await testClaimRewardAfterStakeMovements(
                [1, 3, 6, 10],
                [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
            );
        });
        it('stake movements 4', async () => {
            await testClaimRewardAfterStakeMovements(
                [],
                [1, 2, 3]
            );
        });
        it('stake movements 5', async () => {
            await testClaimRewardAfterStakeMovements(
                [2],
                [1, 2, 3]
            );
        });

        it('stake increasing 1', async () => {
            await testClaimRewardAfterStakeIncreasing(
                [5, 15, 25, 35],
                [4, 14, 24, 34]
            );
        });
        it('stake increasing 2', async () => {
            await testClaimRewardAfterStakeIncreasing(
                [5, 15, 25, 35],
                [10, 20, 30]
            );
        });
        it('stake increasing 3', async () => {
            await testClaimRewardAfterStakeIncreasing(
                [1, 2, 3, 4, 5, 6],
                [1, 2, 3, 4, 5]
            );
        });
        it('stake increasing 4', async () => {
            await testClaimRewardAfterStakeIncreasing(
                [1, 3, 6, 10],
                [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
            );
        });
        it('stake increasing 5', async () => {
            await testClaimRewardAfterStakeIncreasing(
                [5, 15, 25],
                [5, 15, 25]
            );
        });
        it('stake increasing', async () => {
            await testClaimRewardAfterStakeIncreasing(
                [5, 7, 9],
                [6, 8, 10]
            );
        });


        it('random withdrawal 1', async () => {
            await testClaimRewardRandom(
                [5, 15, 25, 35],
                [4, 14, 24, 34]
            );
        });
        it('random withdrawal 2', async () => {
            await testClaimRewardRandom(
                [5, 15, 25, 35],
                [10, 20, 30]
            );
        });
        it('random withdrawal 3', async () => {
            await testClaimRewardRandom(
                [1, 2, 3, 4, 5, 6],
                [1, 2, 3, 4, 5]
            );
        });
        it('random withdrawal 4', async () => {
            await testClaimRewardRandom(
                [1, 3, 6, 10],
                [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
            );
        });
        it('random withdrawal 5', async () => {
            await testClaimRewardRandom(
                [5, 15, 25],
                [5, 15, 25]
            );
        });
        it('random withdrawal 6', async () => {
            await testClaimRewardRandom(
                [5, 7, 9],
                [6, 8, 10]
            );
        });

        it('reward got from the first epoch', async () => {
            await testClaimRewardAfterStakeMovements([1], []);
        });

        it('stake is withdrawn forever 1', async () => {
            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];
            const epochPoolReward = BigNumber.from(ethers.utils.parseEther('1'));

            (await ethers.provider.getBalance(blockRewardHbbft.address)).should.be.equal('0');

            let stakingEpoch;

            // Emulate snapshotting and rewards for the pool
            stakingEpoch = 9;
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress);
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(epochPoolReward);
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            // Emulate delegator's stake withdrawal
            stakingEpoch = 10;
            //const stakingEpochStartBlock = BigNumber.from(120954 * stakingEpoch + 1);
            await stakingHbbft.setStakingEpoch(stakingEpoch);
            await stakingHbbft.setValidatorSetAddress(owner.address);
            //await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock);
            await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);

            await stakingHbbft.connect(delegator).orderWithdraw(stakingAddress, delegatorMinStake);
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(epochPoolReward.mul(BigNumber.from(2)));
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            // Emulate rewards for the pool
            stakingEpoch = 11;
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(epochPoolReward.mul(BigNumber.from(3)));
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            await stakingHbbft.setStakingEpoch(12);

            const delegatorRewardExpected = epochPoolReward.mul(BigNumber.from(2)).div(BigNumber.from(2));

            const rewardAmountsCalculated = await stakingHbbft.getRewardAmount([], stakingAddress, delegator.address);
            rewardAmountsCalculated.should.be.equal(delegatorRewardExpected);

            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            let result = await stakingHbbft.connect(delegator).claimReward([], stakingAddress);
            let receipt = await result.wait();
            const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));
            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));

            receipt.events?.length.should.be.equal(2);
            receipt.events?.[0].event?.should.be.equal("ClaimedReward");
            receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(9));
            receipt.events?.[0].args?.nativeCoinsAmount.should.be.equal(epochPoolReward.div(BigNumber.from(2)));
            receipt.events?.[1].event?.should.be.equal("ClaimedReward");
            receipt.events?.[1].args?.stakingEpoch.should.be.equal(BigNumber.from(10));
            receipt.events?.[1].args?.nativeCoinsAmount.should.be.equal(epochPoolReward.div(BigNumber.from(2)));

            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.add(delegatorRewardExpected).sub(weiSpent));

            result = await stakingHbbft.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);
            receipt = await result.wait();
            receipt.events?.length.should.be.equal(3);
            receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(9));
            receipt.events?.[1].args?.stakingEpoch.should.be.equal(BigNumber.from(10));
            receipt.events?.[2].args?.stakingEpoch.should.be.equal(BigNumber.from(11));
            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(BigNumber.from(0));
        });

        it('stake is withdrawn forever 2', async () => {
            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];
            const epochPoolReward = BigNumber.from(ethers.utils.parseEther('1'));

            (await ethers.provider.getBalance(blockRewardHbbft.address)).should.be.equal('0');

            let stakingEpoch;

            // Emulate snapshotting and rewards for the pool
            stakingEpoch = 9;
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, miningAddress);
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(epochPoolReward);
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            // Emulate delegator's stake withdrawal
            stakingEpoch = 10;
            //const stakingEpochStartBlock = BigNumber.from(120954 * stakingEpoch + 1);
            await stakingHbbft.setStakingEpoch(stakingEpoch);
            await stakingHbbft.setValidatorSetAddress(owner.address);
            //await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock);
            await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);

            await stakingHbbft.connect(delegator).orderWithdraw(stakingAddress, delegatorMinStake);
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(epochPoolReward.mul(BigNumber.from(2)));
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            // Emulate rewards for the pool
            stakingEpoch = 11;
            await blockRewardHbbft.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            (BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address))).should.be.equal(epochPoolReward.mul(BigNumber.from(3)));
            await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch + 1, miningAddress);

            await stakingHbbft.setStakingEpoch(12);

            const rewardAmountsCalculated = await stakingHbbft.getRewardAmount([11], stakingAddress, delegator.address);
            rewardAmountsCalculated.should.be.equal(BigNumber.from(0));

            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            const result = await stakingHbbft.connect(delegator).claimReward([11], stakingAddress);
            const receipt = await result.wait();
            const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));
            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));

            receipt.events?.length.should.be.equal(0);
            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.sub(weiSpent));
        });

        it('gas consumption for one staking epoch is OK', async () => {

            const stakingEpoch = 2600;

            await blockRewardHbbft.addToDeltaPot({ value: deltaPotFillupValue });

            for (let i = 0; i < initialValidators.length; i++) {
                await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, stakingEpoch, initialValidators[i]);
            }

            await stakingHbbft.setStakingEpoch(stakingEpoch - 1);

            await stakingHbbft.setValidatorSetAddress(owner.address);
            //await stakingHbbft.setStakingEpochStartBlock(epochStartBlock);
            await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
            // new validatorSet at the end of fixed epoch duration

            await timeTravelToTransition();
            await timeTravelToEndEpoch();

            (await validatorSetHbbft.getValidators()).should.be.deep.equal(initialValidators);
            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(stakingEpoch));


            let blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

            for (let i = 0; i < initialValidators.length; i++) {
                (await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, initialValidators[i])).should.be.equal(BigNumber.from(0));
            }

            await timeTravelToTransition();
            await timeTravelToEndEpoch();

            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(stakingEpoch + 1));
            //epochStartBlock = await stakingHbbft.stakingEpochStartBlock();
            //epochStartBlock.should.be.equal(BigNumber.from(120954 * (stakingEpoch + 1) + 2 + 2 + 1)); // +2 for kegen duration

            let distributedCoinsAmount = BigNumber.from(0);
            for (let i = 0; i < initialValidators.length; i++) {
                const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, initialValidators[i]);
                epochPoolNativeReward.should.be.above(BigNumber.from(0));
                distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
            }

            // const blockRewardHbbft.maintenanceFundAddress();
            // console.log('DAO Coin amount');
            // distributedCoinsAmount

            let blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
            blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));

            // The delegator claims their rewards
            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));

            blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

            const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount([stakingEpoch], initialStakingAddresses[0], delegator.address));

            const result = await stakingHbbft.connect(delegator).claimReward([stakingEpoch], initialStakingAddresses[0]);

            let receipt = await result.wait();

            receipt.events?.[0].event?.should.be.equal("ClaimedReward");
            receipt.events?.[0].args?.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
            receipt.events?.[0].args?.staker.should.be.equal(delegator.address);
            receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(stakingEpoch));

            const claimedCoinsAmount = receipt.events?.[0].args?.nativeCoinsAmount;
            expectedClaimRewardAmounts.should.be.equal(claimedCoinsAmount);

            const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));

            if (!!process.env.SOLIDITY_COVERAGE !== true) {
                // receipt.gasUsed.should.be.below(1700000);
                receipt.gasUsed.should.be.below(3020000); // for Istanbul
            }

            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
            blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));
        });

        it('gas consumption for 20 staking epochs is OK', async () => {

            const maxStakingEpoch = 20;
            maxStakingEpoch.should.be.above(2);

            await blockRewardHbbft.addToDeltaPot({ value: deltaPotFillupValue });

            // Loop of staking epochs
            for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
                // Finalize change i.e. finalize pending validators, increase epoch and set stakingEpochStartBlock
                if (stakingEpoch == 1) {
                    await stakingHbbft.setStakingEpoch(1);

                    await stakingHbbft.setValidatorSetAddress(owner.address);
                    //await stakingHbbft.setStakingEpochStartBlock(startBlock);
                    await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
                }

                (await validatorSetHbbft.getValidators()).should.be.deep.equal(initialValidators);
                (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(stakingEpoch));

                // await timeTravelToTransition();
                // await timeTravelToEndEpoch();

                const blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
                for (let i = 0; i < initialValidators.length; i++) {
                    (await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, initialValidators[i])).should.be.equal(BigNumber.from(0));
                }

                await timeTravelToTransition();
                await timeTravelToEndEpoch();

                let distributedCoinsAmount = BigNumber.from(0);
                for (let i = 0; i < initialValidators.length; i++) {
                    const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, initialValidators[i]);
                    epochPoolNativeReward.should.be.above(BigNumber.from(0));
                    distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
                }
                const blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
                blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));
            }

            // The delegator claims their rewards
            let initialGasConsumption = BigNumber.from(0);
            let startGasConsumption = BigNumber.from(0);
            let endGasConsumption = BigNumber.from(0);
            let blockRewardCoinsBalanceTotalBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

            let coinsDelegatorGotForAllEpochs = BigNumber.from(0);
            for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
                const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));

                const blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

                const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount([stakingEpoch], initialStakingAddresses[0], delegator.address));

                let result = await stakingHbbft.connect(delegator).claimReward([stakingEpoch], initialStakingAddresses[0]);
                let receipt = await result.wait();
                receipt.events?.[0].event?.should.be.equal("ClaimedReward");
                receipt.events?.[0].args?.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
                receipt.events?.[0].args?.staker.should.be.equal(delegator.address);
                receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(stakingEpoch));

                const claimedCoinsAmount = receipt.events?.[0].args?.nativeCoinsAmount;

                expectedClaimRewardAmounts.should.be.equal(claimedCoinsAmount);

                receipt = await result.wait();
                const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));

                if (stakingEpoch == 1) {
                    initialGasConsumption = BigNumber.from(receipt.gasUsed);
                } else if (stakingEpoch == 2) {
                    startGasConsumption = BigNumber.from(receipt.gasUsed);
                } else if (stakingEpoch == maxStakingEpoch) {
                    endGasConsumption = BigNumber.from(receipt.gasUsed);
                }

                const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));
                const blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
                delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
                blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));

                coinsDelegatorGotForAllEpochs = coinsDelegatorGotForAllEpochs.add(claimedCoinsAmount);

                // console.log(`stakingEpoch = ${stakingEpoch}, gasUsed = ${receipt.gasUsed}, cumulativeGasUsed = ${receipt.cumulativeGasUsed}`);
            }

            if (!!process.env.SOLIDITY_COVERAGE !== true) {
                const perEpochGasConsumption = endGasConsumption.sub(startGasConsumption).div(BigNumber.from(maxStakingEpoch - 2));
                // perEpochGasConsumption.should.be.equal(BigNumber.from(509));
                perEpochGasConsumption.should.be.equal(BigNumber.from(1109)); // for Istanbul

                // Check gas consumption for the case when the delegator didn't touch their
                // stake for 50 years (2600 staking epochs)
                const maxGasConsumption = initialGasConsumption.sub(perEpochGasConsumption).add(perEpochGasConsumption.mul(BigNumber.from(2600)));
                // maxGasConsumption.should.be.below(BigNumber.from(1700000));
                maxGasConsumption.should.be.below(BigNumber.from(3020000)); // for Istanbul
            }

            let blockRewardCoinsBalanceTotalAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

            blockRewardCoinsBalanceTotalAfter.should.be.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs));

            // The validators claim their rewards
            let coinsValidatorsGotForAllEpochs = BigNumber.from(0);
            for (let v = 0; v < initialStakingAddresses.length; v++) {
                for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
                    const validator = initialStakingAddresses[v];
                    const validatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(validator));
                    const blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

                    const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount([stakingEpoch], validator, validator));

                    let result = await stakingHbbft.connect(await ethers.getSigner(validator)).claimReward([stakingEpoch], validator);
                    let receipt = await result.wait()
                    receipt.events?.[0].event?.should.be.equal("ClaimedReward");
                    receipt.events?.[0].args?.fromPoolStakingAddress.should.be.equal(validator);
                    receipt.events?.[0].args?.staker.should.be.equal(validator);
                    receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(stakingEpoch));

                    const claimedCoinsAmount = receipt.events?.[0].args?.nativeCoinsAmount;

                    expectedClaimRewardAmounts.should.be.equal(claimedCoinsAmount);

                    receipt = await result.wait();
                    const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));

                    const validatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(validator));
                    const blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

                    validatorCoinsBalanceAfter.should.be.equal(validatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
                    blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));

                    coinsValidatorsGotForAllEpochs = coinsValidatorsGotForAllEpochs.add(claimedCoinsAmount);
                }
            }

            blockRewardCoinsBalanceTotalAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
            blockRewardCoinsBalanceTotalAfter.should.be.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs).sub(coinsValidatorsGotForAllEpochs));
            blockRewardCoinsBalanceTotalAfter.should.be.gte(BigNumber.from(0));
        });

        it('gas consumption for 52 staking epochs is OK 1', async () => {
            const maxStakingEpoch = 52;

            await blockRewardHbbft.addToDeltaPot({ value: deltaPotFillupValue });

            // Loop of staking epochs
            for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
                if (stakingEpoch == 1) {
                    await stakingHbbft.setStakingEpoch(1);
                    //const startBlock = BigNumber.from(120954 + 2 + 1);

                    await stakingHbbft.setValidatorSetAddress(owner.address);
                    //await stakingHbbft.setStakingEpochStartBlock(startBlock);
                    await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
                }

                (await validatorSetHbbft.getValidators()).should.be.deep.equal(initialValidators);
                (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(stakingEpoch));

                await callReward(false);

                const blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
                for (let i = 0; i < initialValidators.length; i++) {
                    (await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, initialValidators[i])).should.be.equal(BigNumber.from(0));
                }

                await timeTravelToTransition();
                await timeTravelToEndEpoch();

                let distributedCoinsAmount = BigNumber.from(0);
                for (let i = 0; i < initialValidators.length; i++) {
                    const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, initialValidators[i]);
                    epochPoolNativeReward.should.be.above(BigNumber.from(0));
                    distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
                }
                const blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
                blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));
            }

            // The delegator claims their rewards
            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            const blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
            const blockRewardCoinsBalanceTotalBefore = blockRewardCoinsBalanceBefore;

            const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount([], initialStakingAddresses[0], delegator.address));

            const result = await stakingHbbft.connect(delegator).claimReward([], initialStakingAddresses[0]);
            let receipt = await result.wait();

            let coinsDelegatorGotForAllEpochs = BigNumber.from(0);
            for (let i = 0; i < maxStakingEpoch; i++) {
                receipt.events?.[i].event?.should.be.equal("ClaimedReward");
                receipt.events?.[i].args?.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
                receipt.events?.[i].args?.staker.should.be.equal(delegator.address);
                receipt.events?.[i].args?.stakingEpoch.should.be.equal(BigNumber.from(i + 1));
                coinsDelegatorGotForAllEpochs = coinsDelegatorGotForAllEpochs.add(receipt.events?.[i].args?.nativeCoinsAmount);
            }

            expectedClaimRewardAmounts.should.be.equal(coinsDelegatorGotForAllEpochs);

            const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));

            // console.log(`gasUsed = ${receipt.gasUsed}, cumulativeGasUsed = ${receipt.cumulativeGasUsed}`);

            if (!!process.env.SOLIDITY_COVERAGE !== true) {
                // receipt.gasUsed.should.be.below(1710000);
                receipt.gasUsed.should.be.below(2100000); // for Istanbul
            }

            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            const blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

            coinsDelegatorGotForAllEpochs.should.be.gte(BigNumber.from(0));
            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.add(coinsDelegatorGotForAllEpochs).sub(weiSpent));
            blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.sub(coinsDelegatorGotForAllEpochs));

            // The validators claim their rewards
            let coinsValidatorsGotForAllEpochs = BigNumber.from(0);
            for (let v = 0; v < initialStakingAddresses.length; v++) {
                const validator = initialStakingAddresses[v];
                const validatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(validator));
                const blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
                const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount([], validator, validator));
                const result = await stakingHbbft.connect(await ethers.getSigner(validator)).claimReward([], validator);
                const receipt = await result.wait();

                let claimedCoinsAmount = BigNumber.from(0);
                for (let i = 0; i < maxStakingEpoch; i++) {
                    receipt.events?.[i].event?.should.be.equal("ClaimedReward");
                    receipt.events?.[i].args?.fromPoolStakingAddress.should.be.equal(validator);
                    receipt.events?.[i].args?.staker.should.be.equal(validator);
                    receipt.events?.[i].args?.stakingEpoch.should.be.equal(BigNumber.from(i + 1));
                    claimedCoinsAmount = claimedCoinsAmount.add(receipt.events?.[i].args?.nativeCoinsAmount);
                }

                expectedClaimRewardAmounts.should.be.equal(claimedCoinsAmount);

                const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));

                const validatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(validator));
                const blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

                claimedCoinsAmount.should.be.gte(BigNumber.from(0));
                validatorCoinsBalanceAfter.should.be.equal(validatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
                blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));
                coinsValidatorsGotForAllEpochs = coinsValidatorsGotForAllEpochs.add(claimedCoinsAmount);
            }

            const blockRewardCoinsBalanceTotalAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
            blockRewardCoinsBalanceTotalAfter.should.be.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs).sub(coinsValidatorsGotForAllEpochs));
            blockRewardCoinsBalanceTotalAfter.should.be.gte(BigNumber.from(0));
        });

        it('gas consumption for 52 staking epochs (including gaps ~ 10 years) is OK', async () => {
            const maxStakingEpochs = 52;
            const gapSize = 10;

            await blockRewardHbbft.addToDeltaPot({ value: deltaPotFillupValue });

            // Loop of staking epochs
            for (let s = 0; s < maxStakingEpochs; s++) {
                if (s == 0) {
                    await stakingHbbft.setStakingEpoch(1);
                    await stakingHbbft.setValidatorSetAddress(owner.address);
                    await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
                }

                const stakingEpoch = (await stakingHbbft.stakingEpoch()).toNumber();

                (await validatorSetHbbft.getValidators()).should.be.deep.equal(initialValidators);
                (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(stakingEpoch));

                const blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
                for (let i = 0; i < initialValidators.length; i++) {
                    (await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, initialValidators[i])).should.be.equal(BigNumber.from(0));
                }

                await timeTravelToTransition();
                await timeTravelToEndEpoch();

                let distributedCoinsAmount = BigNumber.from(0);
                for (let i = 0; i < initialValidators.length; i++) {
                    const epochPoolNativeReward = await blockRewardHbbft.epochPoolNativeReward(stakingEpoch, initialValidators[i]);
                    epochPoolNativeReward.should.be.above(BigNumber.from(0));
                    distributedCoinsAmount = distributedCoinsAmount.add(epochPoolNativeReward);
                }
                const blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
                blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.add(distributedCoinsAmount));

                const nextStakingEpoch = stakingEpoch + gapSize; // jump through a few epochs
                await stakingHbbft.setStakingEpoch(nextStakingEpoch);
                await stakingHbbft.setValidatorSetAddress(owner.address);
                //await stakingHbbft.setStakingEpochStartBlock((120954 + 2) * nextStakingEpoch + 1);
                await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
                for (let i = 0; i < initialValidators.length; i++) {
                    await blockRewardHbbft.snapshotPoolStakeAmounts(stakingHbbft.address, nextStakingEpoch, initialValidators[i]);
                }
            }

            const epochsPoolGotRewardFor = await blockRewardHbbft.epochsPoolGotRewardFor(initialValidators[0]);

            // The delegator claims their rewards
            const delegatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            const blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
            const blockRewardCoinsBalanceTotalBefore = blockRewardCoinsBalanceBefore;

            const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount([], initialStakingAddresses[0], delegator.address));

            const result = await stakingHbbft.connect(delegator).claimReward([], initialStakingAddresses[0]);
            const receipt = await result.wait();

            let coinsDelegatorGotForAllEpochs = BigNumber.from(0);
            for (let i = 0; i < maxStakingEpochs; i++) {
                receipt.events?.[i].event?.should.be.equal("ClaimedReward");
                receipt.events?.[i].args?.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[0]);
                receipt.events?.[i].args?.staker.should.be.equal(delegator.address);
                receipt.events?.[i].args?.stakingEpoch.should.be.equal(epochsPoolGotRewardFor[i]);
                coinsDelegatorGotForAllEpochs = coinsDelegatorGotForAllEpochs.add(receipt.events?.[i].args?.nativeCoinsAmount);
            }

            expectedClaimRewardAmounts.should.be.equal(coinsDelegatorGotForAllEpochs);

            const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));

            // console.log(`gasUsed = ${receipt.gasUsed}, cumulativeGasUsed = ${receipt.cumulativeGasUsed}`);

            if (!!process.env.SOLIDITY_COVERAGE !== true) {
                // receipt.gasUsed.should.be.below(2000000);
                receipt.gasUsed.should.be.below(2610000); // for Istanbul
            }

            const delegatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(delegator.address));
            const blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

            coinsDelegatorGotForAllEpochs.should.be.gte(BigNumber.from(0));
            delegatorCoinsBalanceAfter.should.be.equal(delegatorCoinsBalanceBefore.add(coinsDelegatorGotForAllEpochs).sub(weiSpent));
            blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.sub(coinsDelegatorGotForAllEpochs));

            // The validators claim their rewards
            let coinsValidatorsGotForAllEpochs = BigNumber.from(0);
            for (let v = 0; v < initialStakingAddresses.length; v++) {
                const validator = initialStakingAddresses[v];
                const validatorCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(validator));
                const blockRewardCoinsBalanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
                const expectedClaimRewardAmounts = (await stakingHbbft.getRewardAmount([], validator, validator));
                const result = await stakingHbbft.connect(await ethers.getSigner(validator)).claimReward([], validator);
                const receipt = await result.wait();

                let claimedCoinsAmount = BigNumber.from(0);
                for (let i = 0; i < maxStakingEpochs; i++) {
                    receipt.events?.[i].event?.should.be.equal("ClaimedReward");
                    receipt.events?.[i].args?.fromPoolStakingAddress.should.be.equal(validator);
                    receipt.events?.[i].args?.staker.should.be.equal(validator);
                    receipt.events?.[i].args?.stakingEpoch.should.be.equal(epochsPoolGotRewardFor[i]);
                    claimedCoinsAmount = claimedCoinsAmount.add(receipt.events?.[i].args?.nativeCoinsAmount);
                }

                expectedClaimRewardAmounts.should.be.equal(claimedCoinsAmount);

                const weiSpent = (BigNumber.from(receipt.gasUsed)).mul(BigNumber.from(result.gasPrice));

                const validatorCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(validator));
                const blockRewardCoinsBalanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));

                claimedCoinsAmount.should.be.gte(BigNumber.from(0));
                validatorCoinsBalanceAfter.should.be.equal(validatorCoinsBalanceBefore.add(claimedCoinsAmount).sub(weiSpent));
                blockRewardCoinsBalanceAfter.should.be.equal(blockRewardCoinsBalanceBefore.sub(claimedCoinsAmount));
                coinsValidatorsGotForAllEpochs = coinsValidatorsGotForAllEpochs.add(claimedCoinsAmount);
            }

            const blockRewardCoinsBalanceTotalAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
            blockRewardCoinsBalanceTotalAfter.should.be.equal(blockRewardCoinsBalanceTotalBefore.sub(coinsDelegatorGotForAllEpochs).sub(coinsValidatorsGotForAllEpochs));
            blockRewardCoinsBalanceTotalAfter.should.be.gte(BigNumber.from(0));
        });
    });

    // return;

    describe('incrementStakingEpoch()', async () => {
        // set ValidatorSet = accounts[7]
        const validatorSetContract = accounts[7];
        beforeEach(async () => {
            // set ValidatorSetContract in stakingContract
            await stakingHbbft.setValidatorSetAddress(validatorSetContract.address);
        });
        it('should increment if called by the ValidatorSet', async () => {
            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(validatorSetContract).incrementStakingEpoch();
            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(1));
        });
        it('can only be called by ValidatorSet contract', async () => {
            await stakingHbbft.connect(accounts[8]).incrementStakingEpoch().should.be.rejectedWith("Only ValidatorSet");
        });
    });

    describe('initialize()', async () => {

        it('should initialize successfully', async () => {
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );
            stakingFixedEpochDuration.should.be.equal(
                await stakingHbbft.stakingFixedEpochDuration()
            );
            stakingWithdrawDisallowPeriod.should.be.equal(
                await stakingHbbft.stakingWithdrawDisallowPeriod()
            );
            // BigNumber.from(0).should.be.equal(
            //   await stakingHbbft.stakingEpochStartBlock()
            // );
            validatorSetHbbft.address.should.be.equal(
                await stakingHbbft.validatorSetContract()
            );
            for (let i = 0; i < initialStakingAddresses.length; i++) {
                BigNumber.from(i).should.be.equal(
                    await stakingHbbft.poolIndex(initialStakingAddresses[i])
                );
                true.should.be.equal(
                    await stakingHbbft.isPoolActive(initialStakingAddresses[i])
                );
                BigNumber.from(i).should.be.equal(
                    await stakingHbbft.poolToBeRemovedIndex(initialStakingAddresses[i])
                );
            }
            (await stakingHbbft.getPools()).should.be.deep.equal(initialStakingAddresses);
            BigNumber.from(ethers.utils.parseEther('1')).should.be.equal(
                await stakingHbbft.delegatorMinStake()
            );
            BigNumber.from(ethers.utils.parseEther('1')).should.be.equal(
                await stakingHbbft.candidateMinStake()
            );
        });
        it('should fail if ValidatorSet contract address is zero', async () => {
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: '0x0000000000000000000000000000000000000000',
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("ValidatorSet can't be 0");
        });
        it('should fail if delegatorMinStake is zero', async () => {
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: 0,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("DelegatorMinStake is 0");
        });
        it('should fail if candidateMinStake is zero', async () => {
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: 0,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("CandidateMinStake is 0");
        });
        it('should fail if already initialized', async () => {
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("Already initialized");
        });
        it('should fail if stakingEpochDuration is 0', async () => {
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: 0,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("FixedEpochDuration is 0");
        });
        it('should fail if stakingstakingEpochStartBlockWithdrawDisallowPeriod is 0', async () => {
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: 0
            };
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("WithdrawDisallowPeriod is 0");
        });
        it('should fail if stakingWithdrawDisallowPeriod >= stakingEpochDuration', async () => {
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: 120954
            };
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("FixedEpochDuration must be longer than withdrawDisallowPeriod");
        });
        it('should fail if some staking address is 0', async () => {
            initialStakingAddresses[0] = '0x0000000000000000000000000000000000000000';
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("InitialStakingAddresses can't be 0");
        });

        it('should fail if timewindow is 0', async () => {

            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: 0,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("The transition timeframe must be longer than 0");
        });

        it('should fail if transition timewindow is smaller than the staking time window', async () => {

            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingFixedEpochDuration,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.rejectedWith("The transition timeframe must be shorter then the epoch duration");

        });

    });

    describe('moveStake()', async () => {
        let delegatorAddress: SignerWithAddress;
        const stakeAmount = minStake.mul(BigNumber.from(2));

        beforeEach(async () => {
            delegatorAddress = accounts[7];

            // Initialize StakingHbbft
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );

            // Place stakes
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).stake(initialStakingAddresses[0], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[0], { value: stakeAmount });
        });

        it('should move entire stake', async () => {
            // we can move the stake, since the staking address is not part of the active validator set,
            // since we never did never a time travel.
            // If we do, the stakingAddresses are blocked to withdraw without an orderwithdraw.
            (await stakingHbbft.stakeAmount(initialStakingAddresses[0], delegatorAddress.address)).should.be.equal(stakeAmount);
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(delegatorAddress).moveStake(initialStakingAddresses[0], initialStakingAddresses[1], stakeAmount);
            (await stakingHbbft.stakeAmount(initialStakingAddresses[0], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(stakeAmount);
        });
        it('should move part of the stake', async () => {
            (await stakingHbbft.stakeAmount(initialStakingAddresses[0], delegatorAddress.address)).should.be.equal(stakeAmount);
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(delegatorAddress).moveStake(initialStakingAddresses[0], initialStakingAddresses[1], minStake);
            (await stakingHbbft.stakeAmount(initialStakingAddresses[0], delegatorAddress.address)).should.be.equal(minStake);
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(minStake);
        });
        it('should move part of the stake', async () => {
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: stakeAmount });

            const sourcePool = initialStakingAddresses[0];
            const targetPool = initialStakingAddresses[1];

            (await stakingHbbft.stakeAmount(sourcePool, delegatorAddress.address)).should.be.equal(stakeAmount);
            (await stakingHbbft.stakeAmount(targetPool, delegatorAddress.address)).should.be.equal(stakeAmount);

            const moveAmount = minStake.div(BigNumber.from(2));
            moveAmount.should.be.below(await stakingHbbft.delegatorMinStake());

            await stakingHbbft.connect(delegatorAddress).moveStake(sourcePool, targetPool, moveAmount);
            (await stakingHbbft.stakeAmount(sourcePool, delegatorAddress.address)).should.be.equal(stakeAmount.sub(moveAmount));
            (await stakingHbbft.stakeAmount(targetPool, delegatorAddress.address)).should.be.equal(stakeAmount.add(moveAmount));
        });
        it('should fail for zero gas price', async () => {
            await stakingHbbft.connect(delegatorAddress).moveStake(initialStakingAddresses[0], initialStakingAddresses[1], stakeAmount, { gasPrice: 0 }).should.be.rejectedWith("GasPrice is 0");
        });
        it('should fail if the source and destination addresses are the same', async () => {
            await stakingHbbft.connect(delegatorAddress).moveStake(initialStakingAddresses[0], initialStakingAddresses[0], stakeAmount).should.be.rejectedWith("MoveStake: src and dst pool is the same");
        });
        it('should fail if the staker tries to move more than they have', async () => {
            await stakingHbbft.connect(delegatorAddress).moveStake(initialStakingAddresses[0], initialStakingAddresses[1], stakeAmount.mul(BigNumber.from(2))).should.be.rejectedWith("Withdraw: maxWithdrawAllowed exceeded");
        });
        it('should fail if the staker tries to overstake by moving stake.', async () => {
            // stake source pool and target pool to the max.
            // then move 1 from source to target - that should be the drop on the hot stone.
            const sourcePool = initialStakingAddresses[0];
            const targetPool = initialStakingAddresses[1];
            let currentSourceStake = BigNumber.from(await stakingHbbft.stakeAmountTotal(sourcePool));
            const totalStakeableSource = maxStake.sub(currentSourceStake);
            await stakingHbbft.connect(delegatorAddress).stake(sourcePool, { value: totalStakeableSource });
            let currentTargetStake = BigNumber.from(await stakingHbbft.stakeAmountTotal(targetPool));
            const totalStakeableTarget = maxStake.sub(currentTargetStake);
            await stakingHbbft.connect(delegatorAddress).stake(targetPool, { value: totalStakeableTarget });
            // source is at max stake now, now tip it over.
            await stakingHbbft.connect(delegatorAddress).moveStake(sourcePool, targetPool, BigNumber.from(1)).should.be.rejectedWith("stake limit has been exceeded");
        });
    });

    describe('stake()', async () => {
        let delegatorAddress: SignerWithAddress;
        let candidateMinStake: BigNumber;
        let delegatorMinStake: BigNumber;

        beforeEach(async () => {
            delegatorAddress = accounts[7];

            // Deploy StakingHbbft contract
            const AdminUpgradeabilityProxyFactory = await ethers.getContractFactory("AdminUpgradeabilityProxy")
            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftCoinsMock");
            stakingHbbft = await StakingHbbftFactory.deploy() as StakingHbbftCoinsMock;
            if (useUpgradeProxy) {
                adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(stakingHbbft.address, owner.address, []);
                stakingHbbft = await ethers.getContractAt("StakingHbbftCoinsMock", adminUpgradeabilityProxy.address);
            }
            await validatorSetHbbft.setStakingContract(stakingHbbft.address);

            // Initialize StakingHbbft
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );

            candidateMinStake = await stakingHbbft.candidateMinStake();
            delegatorMinStake = await stakingHbbft.delegatorMinStake();

        });
        it('should be zero initially', async () => {
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
        });
        it('should place a stake', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.equal(candidateMinStake);
            const result = await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            let receipt = await result.wait()
            receipt.events?.[0].event?.should.be.equal("PlacedStake");
            receipt.events?.[0].args?.toPoolStakingAddress.should.be.equal(initialStakingAddresses[1]);
            receipt.events?.[0].args?.staker.should.be.equal(delegatorAddress.address);
            receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(0));
            receipt.events?.[0].args?.amount.should.be.equal(delegatorMinStake);
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(delegatorMinStake);
            (await stakingHbbft.stakeAmountTotal(initialStakingAddresses[1])).should.be.equal(candidateMinStake.add(delegatorMinStake));
        });
        it('should fail for zero gas price', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake, gasPrice: 0 }).should.be.rejectedWith("GasPrice is 0");
        });
        it('should fail for a non-existing pool', async () => {
            await stakingHbbft.connect(delegatorAddress).stake(accounts[10].address, { value: delegatorMinStake }).should.be.rejectedWith("Pool does not exist. miningAddress for that staking address is 0");
            await stakingHbbft.connect(delegatorAddress).stake('0x0000000000000000000000000000000000000000', { value: delegatorMinStake }).should.be.rejectedWith("Pool does not exist. miningAddress for that staking address is 0");
        });
        it('should fail for a zero amount', async () => {
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: 0 }).should.be.rejectedWith("Stake: stakingAmount is 0");
        });
        it('should fail for a banned validator', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            await validatorSetHbbft.setSystemAddress(owner.address);
            await validatorSetHbbft.connect(owner).removeMaliciousValidators([initialValidators[1]]);
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake }).should.be.rejectedWith("Stake: Mining address is banned");
        });
        // it('should only success in the allowed staking window', async () => {
        //   //await stakingHbbft.setCurrentBlockNumber(117000);
        //   await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: candidateMinStake}).should.be.rejectedWith("Stake: disallowed period");
        // });
        it('should fail if a candidate stakes less than CANDIDATE_MIN_STAKE', async () => {
            const halfOfCandidateMinStake = candidateMinStake.div(BigNumber.from(2));
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: halfOfCandidateMinStake }).should.be.rejectedWith("Stake: candidateStake less than candidateMinStake");
        });
        it('should fail if a delegator stakes less than DELEGATOR_MIN_STAKE', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            const halfOfDelegatorMinStake = delegatorMinStake.div(BigNumber.from(2));
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: halfOfDelegatorMinStake }).should.be.rejectedWith("Stake: delegatorStake is less than delegatorMinStake");
        });
        it('should fail if a delegator stakes more than maxStake', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: maxStake.add(BigNumber.from(1)) }).should.be.rejectedWith("stake limit has been exceeded");
        });
        it('should fail if a delegator stakes into an empty pool', async () => {
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake }).should.be.rejectedWith("Stake: can't delegate in empty pool");
        });
        it('should increase a stake amount', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(delegatorMinStake);
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(delegatorMinStake.mul(BigNumber.from(2)));
        });
        it('should increase the stakeAmountByCurrentEpoch', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(delegatorMinStake);
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(delegatorMinStake.mul(BigNumber.from(2)));
        });
        it('should increase a total stake amount', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            (await stakingHbbft.stakeAmountTotal(initialStakingAddresses[1])).should.be.equal(candidateMinStake);
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            (await stakingHbbft.stakeAmountTotal(initialStakingAddresses[1])).should.be.equal(candidateMinStake.add(delegatorMinStake));
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            (await stakingHbbft.stakeAmountTotal(initialStakingAddresses[1])).should.be.equal(candidateMinStake.add(delegatorMinStake.mul(BigNumber.from(2))));
        });
        it('should add a delegator to the pool', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            (await stakingHbbft.poolDelegators(initialStakingAddresses[1])).length.should.be.equal(0);
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            (await stakingHbbft.poolDelegators(initialStakingAddresses[1])).should.be.deep.equal([delegatorAddress.address]);
        });
        it('should update pool\'s likelihood', async () => {
            let likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            likelihoodInfo.likelihoods.length.should.be.equal(0);
            likelihoodInfo.sum.should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            likelihoodInfo.likelihoods[0].should.be.equal(candidateMinStake);
            likelihoodInfo.sum.should.be.equal(candidateMinStake);
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            likelihoodInfo.likelihoods[0].should.be.equal(candidateMinStake.add(delegatorMinStake));
            likelihoodInfo.sum.should.be.equal(candidateMinStake.add(delegatorMinStake));
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: delegatorMinStake });
            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            likelihoodInfo.likelihoods[0].should.be.equal(candidateMinStake.add(delegatorMinStake.mul(BigNumber.from(2))));
            likelihoodInfo.sum.should.be.equal(candidateMinStake.add(delegatorMinStake.mul(BigNumber.from(2))));
        });
        it('should decrease the balance of the staker and increase the balance of the Staking contract', async () => {
            (await ethers.provider.getBalance(stakingHbbft.address)).should.be.equal('0');
            const initialBalance = BigNumber.from(await ethers.provider.getBalance(initialStakingAddresses[1]));
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: candidateMinStake });
            (BigNumber.from(await ethers.provider.getBalance(initialStakingAddresses[1]))).should.be.below(initialBalance.sub(candidateMinStake));
            (BigNumber.from(await ethers.provider.getBalance(stakingHbbft.address))).should.be.equal(candidateMinStake);
        });
    });

    describe('removePool()', async () => {
        beforeEach(async () => {
            // Initialize StakingHbbft
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );
        });

        it('should remove a pool', async () => {
            (await stakingHbbft.getPools()).should.be.deep.equal(initialStakingAddresses);
            await stakingHbbft.setValidatorSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[0]);
            (await stakingHbbft.getPools()).should.be.deep.equal([
                initialStakingAddresses[2],
                initialStakingAddresses[1]
            ]);
            (await stakingHbbft.getPoolsInactive()).length.should.be.equal(0);
        });
        it('can only be called by the ValidatorSetHbbft contract', async () => {
            await stakingHbbft.setValidatorSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[8]).removePool(initialStakingAddresses[0]).should.be.rejectedWith("Only ValidatorSet");
        });
        it('shouldn\'t fail when removing a nonexistent pool', async () => {
            (await stakingHbbft.getPools()).should.be.deep.equal(initialStakingAddresses);
            await stakingHbbft.setValidatorSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).removePool(accounts[10].address);
            (await stakingHbbft.getPools()).should.be.deep.equal(initialStakingAddresses);
        });
        it('should reset pool index', async () => {
            (await stakingHbbft.poolIndex(initialStakingAddresses[1])).should.be.equal(BigNumber.from(1));
            await stakingHbbft.setValidatorSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[1]);
            (await stakingHbbft.poolIndex(initialStakingAddresses[1])).should.be.equal(BigNumber.from(0));
        });
        it('should add/remove a pool to/from the utility lists', async () => {

            const stakeAmount = minStake.mul(BigNumber.from(2));

            // The first validator places stake for themselves
            (await stakingHbbft.getPoolsToBeElected()).length.should.be.deep.equal(0);
            (await stakingHbbft.getPoolsToBeRemoved()).should.be.deep.equal(initialStakingAddresses);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).stake(initialStakingAddresses[0], { value: minStake });
            (await stakingHbbft.stakeAmountTotal(initialStakingAddresses[0])).should.be.equal(minStake);
            (await stakingHbbft.getPoolsToBeElected()).should.be.deep.equal([initialStakingAddresses[0]]);
            (await stakingHbbft.getPoolsToBeRemoved()).should.be.deep.equal([
                initialStakingAddresses[2],
                initialStakingAddresses[1]
            ]);

            // Remove the pool
            await stakingHbbft.setValidatorSetAddress(accounts[7].address);
            (await stakingHbbft.poolInactiveIndex(initialStakingAddresses[0])).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[0]);
            (await stakingHbbft.getPoolsInactive()).should.be.deep.equal([initialStakingAddresses[0]]);
            (await stakingHbbft.poolInactiveIndex(initialStakingAddresses[0])).should.be.equal(BigNumber.from(0));

            await stakingHbbft.setStakeAmountTotal(initialStakingAddresses[0], 0);
            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[0]);
            (await stakingHbbft.getPoolsInactive()).length.should.be.equal(0);
            (await stakingHbbft.getPoolsToBeElected()).length.should.be.deep.equal(0);

            (await stakingHbbft.poolToBeRemovedIndex(initialStakingAddresses[1])).should.be.equal(BigNumber.from(1));
            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[1]);
            (await stakingHbbft.getPoolsToBeRemoved()).should.be.deep.equal([initialStakingAddresses[2]]);
            (await stakingHbbft.poolToBeRemovedIndex(initialStakingAddresses[1])).should.be.equal(BigNumber.from(0));
        });
    });

    describe('removeMyPool()', async () => {
        beforeEach(async () => {
            // Initialize StakingHbbft
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );
        });

        it('should fail for zero gas price', async () => {
            await stakingHbbft.setValidatorSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).removeMyPool({ gasPrice: 0 }).should.be.rejectedWith("GasPrice is 0");
        });
        it('should fail if Staking contract is not initialized', async () => {
            await stakingHbbft.setValidatorSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorSetAddress('0x0000000000000000000000000000000000000000');
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).removeMyPool({}).should.be.rejectedWith("Contract not initialized");
            await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).removeMyPool({});
        });
        it('should fail for initial validator during the initial staking epoch', async () => {
            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(0));
            (await validatorSetHbbft.isValidator(initialValidators[0])).should.be.equal(true);
            (await validatorSetHbbft.miningByStakingAddress(initialStakingAddresses[0])).should.be.equal(initialValidators[0]);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).removeMyPool({}).should.be.rejectedWith("Can't remove pool during 1st staking epoch");
            await stakingHbbft.setValidatorSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).removeMyPool({}).should.be.fulfilled
        });
    });

    describe('withdraw()', async () => {
        let delegatorAddress: SignerWithAddress;
        let candidateMinStake: BigNumber;
        let delegatorMinStake: BigNumber;

        const stakeAmount = minStake.mul(BigNumber.from(2));

        beforeEach(async () => {
            delegatorAddress = accounts[7];

            // Initialize StakingHbbft
            let structure: IStakingHbbft.InitializerStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Initialize StakingHbbft
            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            );

            candidateMinStake = await stakingHbbft.candidateMinStake();
            delegatorMinStake = await stakingHbbft.delegatorMinStake();
        });

        it('should withdraw a stake', async () => {
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.equal(stakeAmount);
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], initialStakingAddresses[1])).should.be.equal(stakeAmount);

            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: stakeAmount });
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(stakeAmount);
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(stakeAmount);
            (await stakingHbbft.stakeAmountTotal(initialStakingAddresses[1])).should.be.equal(stakeAmount.mul(BigNumber.from(2)));

            const result = await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], stakeAmount);
            let receipt = await result.wait();
            receipt.events?.[0].event?.should.be.equal("WithdrewStake");
            receipt.events?.[0].args?.fromPoolStakingAddress.should.be.equal(initialStakingAddresses[1]);
            receipt.events?.[0].args?.staker.should.be.equal(delegatorAddress.address);
            receipt.events?.[0].args?.stakingEpoch.should.be.equal(BigNumber.from(0));
            receipt.events?.[0].args?.amount.should.be.equal(stakeAmount);
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.stakeAmountTotal(initialStakingAddresses[1])).should.be.equal(stakeAmount);
        });
        it('should fail for zero gas price', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount, { gasPrice: 0 }).should.be.rejectedWith("GasPrice is 0");
        });
        it('should fail if not initialized', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.setValidatorSetAddress('0x0000000000000000000000000000000000000000');
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount).should.be.rejectedWith(ERROR_MSG);
            await stakingHbbft.setValidatorSetAddress(validatorSetHbbft.address);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount);
        });
        it('should fail for a zero pool address', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw('0x0000000000000000000000000000000000000000', stakeAmount).should.be.rejectedWith(ERROR_MSG);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount);
        });
        it('should fail for a zero amount', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], BigNumber.from(0)).should.be.rejectedWith(ERROR_MSG);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount);
        });
        it('shouldn\'t allow withdrawing from a banned pool', async () => {

            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: stakeAmount });
            await validatorSetHbbft.setBannedUntil(initialValidators[1], '0xffffffffffffffff');
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount).should.be.rejectedWith(ERROR_MSG);
            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], stakeAmount).should.be.rejectedWith(ERROR_MSG);
            await validatorSetHbbft.setBannedUntil(initialValidators[1], 0);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount);
            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], stakeAmount);
        });
        // it('shouldn\'t allow withdrawing during the stakingWithdrawDisallowPeriod', async () => {
        //   await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount});
        //   //await stakingHbbft.setCurrentBlockNumber(117000);
        //   //await validatorSetHbbft.setCurrentBlockNumber(117000);
        //   await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).should.be.rejectedWith(ERROR_MSG);
        //   //await stakingHbbft.setCurrentBlockNumber(116000);
        //   //await validatorSetHbbft.setCurrentBlockNumber(116000);
        //   await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]});
        // });
        it('should fail if non-zero residue is less than CANDIDATE_MIN_STAKE', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount.sub(candidateMinStake).add(BigNumber.from(1))).should.be.rejectedWith(ERROR_MSG);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount.sub(candidateMinStake));
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], candidateMinStake);
        });
        it('should fail if non-zero residue is less than DELEGATOR_MIN_STAKE', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], stakeAmount.sub(delegatorMinStake).add(BigNumber.from(1))).should.be.rejectedWith(ERROR_MSG);
            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], stakeAmount.sub(delegatorMinStake));
            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], delegatorMinStake);
        });
        it('should fail if withdraw more than staked', async () => {
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount.add(BigNumber.from(1))).should.be.rejectedWith(ERROR_MSG);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount);
        });
        it('should fail if withdraw already ordered amount', async () => {

            await validatorSetHbbft.setSystemAddress(owner.address);

            // Place a stake during the initial staking epoch
            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).stake(initialStakingAddresses[0], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[2])).stake(initialStakingAddresses[2], { value: stakeAmount });
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: stakeAmount });

            // Finalize a new validator set and change staking epoch
            await blockRewardHbbft.initialize(validatorSetHbbft.address);
            await validatorSetHbbft.setStakingContract(stakingHbbft.address);
            // Set BlockRewardContract
            await validatorSetHbbft.setBlockRewardContract(accounts[7].address);
            await validatorSetHbbft.connect(accounts[7]).newValidatorSet();
            await validatorSetHbbft.setBlockRewardContract(blockRewardHbbft.address);
            // (increases staking epoch)
            await timeTravelToTransition();
            await timeTravelToEndEpoch();

            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(1));
            // Order withdrawal
            const orderedAmount = stakeAmount.div(BigNumber.from(4));
            await stakingHbbft.connect(delegatorAddress).orderWithdraw(initialStakingAddresses[1], orderedAmount);
            // The second validator removes their pool
            (await validatorSetHbbft.isValidator(initialValidators[1])).should.be.equal(true);
            (await stakingHbbft.getPoolsInactive()).length.should.be.equal(0);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).removeMyPool();
            (await stakingHbbft.getPoolsInactive()).should.be.deep.equal([initialStakingAddresses[1]]);

            // Finalize a new validator set, change staking epoch and enqueue pending validators
            await validatorSetHbbft.setBlockRewardContract(accounts[7].address);
            await validatorSetHbbft.connect(accounts[7]).newValidatorSet();
            await validatorSetHbbft.setBlockRewardContract(blockRewardHbbft.address);

            await timeTravelToTransition();
            await timeTravelToEndEpoch();

            (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(2));
            (await validatorSetHbbft.isValidator(initialValidators[1])).should.be.equal(false);

            // Check withdrawal for a delegator
            const restOfAmount = stakeAmount.mul(BigNumber.from(3)).div(BigNumber.from(4));
            (await stakingHbbft.poolDelegators(initialStakingAddresses[1])).should.be.deep.equal([delegatorAddress.address]);
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(restOfAmount);
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], stakeAmount).should.be.rejectedWith(ERROR_MSG);
            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], restOfAmount.add(BigNumber.from(1))).should.be.rejectedWith(ERROR_MSG);
            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], restOfAmount);
            (await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(BigNumber.from(0));
            (await stakingHbbft.orderedWithdrawAmount(initialStakingAddresses[1], delegatorAddress.address)).should.be.equal(orderedAmount);
            (await stakingHbbft.poolDelegators(initialStakingAddresses[1])).length.should.be.equal(0);
            (await stakingHbbft.poolDelegatorsInactive(initialStakingAddresses[1])).should.be.deep.equal([delegatorAddress.address]);
        });
        it('should decrease likelihood', async () => {
            let likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            likelihoodInfo.sum.should.be.equal(BigNumber.from(0));

            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });

            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            likelihoodInfo.likelihoods[0].should.be.equal(stakeAmount);
            likelihoodInfo.sum.should.be.equal(stakeAmount);

            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount.div(BigNumber.from(2)));

            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            likelihoodInfo.likelihoods[0].should.be.equal(stakeAmount.div(BigNumber.from(2)));
            likelihoodInfo.sum.should.be.equal(stakeAmount.div(BigNumber.from(2)));
        });
        // TODO: add unit tests for native coin withdrawal
    });

    // TODO: ...add other tests...

    async function callReward(isEpochEndBlock: boolean) {
        const validators = await validatorSetHbbft.getValidators();
        await blockRewardHbbft.setSystemAddress(owner.address);

        const { events } = await (await blockRewardHbbft.connect(owner).reward(isEpochEndBlock)).wait();
        if (events!.length > 0) {
            // Emulate minting native coins
            events?.[0].event?.should.be.equal("CoinsRewarded");
            const totalReward = events?.[0].args?.rewards;
            await blockRewardHbbft.connect(owner).sendCoins({ value: totalReward });
        }

        await blockRewardHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE');
    }

    async function increaseTime(time: number) {

        const currentTimestamp = await validatorSetHbbft.getCurrentTimestamp();
        const futureTimestamp = currentTimestamp.add(BigNumber.from(time));
        await validatorSetHbbft.setCurrentTimestamp(futureTimestamp);
        const currentTimestampAfter = await validatorSetHbbft.getCurrentTimestamp();
        futureTimestamp.should.be.equal(currentTimestampAfter);
    }

    //time travels forward to the beginning of the next transition,
    //and simulate a block mining (calling reward())
    async function timeTravelToTransition() {


        let startTimeOfNextPhaseTransition = await stakingHbbft.startTimeOfNextPhaseTransition();

        await validatorSetHbbft.setCurrentTimestamp(startTimeOfNextPhaseTransition);
        const currentTS = await validatorSetHbbft.getCurrentTimestamp();
        currentTS.should.be.equal(startTimeOfNextPhaseTransition);
        await callReward(false);
    }

    async function timeTravelToEndEpoch() {

        const tsBeforeTimeTravel = await validatorSetHbbft.getCurrentTimestamp();
        // console.log('tsBefore:', tsBeforeTimeTravel.toString());
        const endTimeOfCurrentEpoch = await stakingHbbft.stakingFixedEpochEndTime();
        // console.log('endTimeOfCurrentEpoch:', endTimeOfCurrentEpoch.toString());

        if (endTimeOfCurrentEpoch.lt(tsBeforeTimeTravel)) {
            console.error('Trying to timetravel back in time !!');
        }
        await validatorSetHbbft.setCurrentTimestamp(endTimeOfCurrentEpoch);
        await callReward(true);
    }

});

function random(low: number, high: number) {
    return Math.floor(Math.random() * (high - low) + low);
}

function shuffle(a: number[]) {
    var j, x, i;
    for (i = a.length - 1; i > 0; i--) {
        j = Math.floor(Math.random() * (i + 1));
        x = a[i];
        a[i] = a[j];
        a[j] = x;
    }
    return a;
}

