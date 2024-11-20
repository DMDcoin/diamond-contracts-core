import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";
import * as _ from "lodash";

import {
    BlockRewardHbbftMock,
    RandomHbbft,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    KeyGenHistory,
} from "../src/types";

import { getNValidatorsPartNAcks } from "./testhelpers/data";
import { deployDao } from "./testhelpers/daoDeployment";

//consts
const SystemAccountAddress = '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE';
const ZeroPublicKey = ethers.zeroPadBytes("0x00", 64);
const ZeroIpAddress = ethers.zeroPadBytes("0x00", 16);

describe('StakingHbbft', () => {
    let owner: HardhatEthersSigner;
    let candidateMiningAddress: HardhatEthersSigner;
    let candidateStakingAddress: HardhatEthersSigner;
    let accounts: HardhatEthersSigner[];

    let initialValidators: string[];
    let initialStakingAddresses: string[];
    let initialValidatorsPubKeys: string[];
    let initialValidatorsPubKeysSplit: string[];
    let initialValidatorsIpAddresses: string[];

    const minStake = ethers.parseEther('10000');
    const minStakeDelegators = ethers.parseEther('100');
    const maxStake = ethers.parseEther('50000');

    // the reward for the first epoch.
    const epochReward = ethers.parseEther('1');

    // one epoch in 1 day.
    const stakingFixedEpochDuration = 86400n;

    // the transition time window is 1 hour.
    const stakingTransitionTimeframeLength = 3600n;
    const stakingWithdrawDisallowPeriod = 1n;

    const validatorInactivityThreshold = 365n * 86400n // 1 year

    async function impersonateAcc(accAddress: string) {
        await helpers.impersonateAccount(accAddress);

        await owner.sendTransaction({
            to: accAddress,
            value: ethers.parseEther('10'),
        });

        return await ethers.getSigner(accAddress);
    }

    async function deployContractsFixture() {
        const stubAddress = owner.address;

        await deployDao();

        const bonusScoreContractMockFactory = await ethers.getContractFactory("BonusScoreSystemMock");
        const bonusScoreContractMock = await bonusScoreContractMockFactory.deploy();
        await bonusScoreContractMock.waitForDeployment();

        const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbftMock");
        const connectivityTracker = await ConnectivityTrackerFactory.deploy();
        await connectivityTracker.waitForDeployment();

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: await bonusScoreContractMock.getAddress(),
            connectivityTrackerContract: await connectivityTracker.getAddress(),
            validatorInactivityThreshold: validatorInactivityThreshold,
        }

        // Deploy ValidatorSet contract
        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbft = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                validatorSetParams,
                initialValidators,            // _initialMiningAddresses
                initialStakingAddresses,      // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as ValidatorSetHbbftMock;

        await validatorSetHbbft.waitForDeployment();

        // Deploy BlockRewardHbbft contract
        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        const blockRewardHbbft = await upgrades.deployProxy(
            BlockRewardHbbftFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(),
                await connectivityTracker.getAddress(),
            ],
            { initializer: 'initialize' }
        ) as unknown as BlockRewardHbbftMock;

        await blockRewardHbbft.waitForDeployment();

        await validatorSetHbbft.setBlockRewardContract(await blockRewardHbbft.getAddress());

        const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
        const randomHbbft = await upgrades.deployProxy(
            RandomHbbftFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress()
            ],
            { initializer: 'initialize' }
        ) as unknown as RandomHbbft;

        await randomHbbft.waitForDeployment();

        //without that, the Time is 0,
        //meaning a lot of checks that expect time to have some value deliver incorrect results.
        // await increaseTime(1);

        const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

        const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
        const keyGenHistory = await upgrades.deployProxy(
            KeyGenFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(),
                initialValidators,
                parts,
                acks
            ],
            { initializer: 'initialize' }
        ) as unknown as KeyGenHistory;

        await keyGenHistory.waitForDeployment();

        let stakingParams = {
            _validatorSetContract: await validatorSetHbbft.getAddress(),
            _bonusScoreContract: await bonusScoreContractMock.getAddress(),
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: minStakeDelegators,
            _candidateMinStake: minStake,
            _maxStake: maxStake,
            _stakingFixedEpochDuration: stakingFixedEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
            _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
        };

        // The following private keys belong to the accounts 1-3, fixed by using the "--mnemonic" option when starting ganache.
        // const initialValidatorsPrivKeys = ["0x272b8400a202c08e23641b53368d603e5fec5c13ea2f438bce291f7be63a02a7", "0xa8ea110ffc8fe68a069c8a460ad6b9698b09e21ad5503285f633b3ad79076cf7", "0x5da461ff1378256f69cb9a9d0a8b370c97c460acbe88f5d897cb17209f891ffc"];
        // Public keys corresponding to the three private keys above.
        initialValidatorsPubKeys = [
            '0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
            '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
            '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56'
        ];

        initialValidatorsPubKeysSplit = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            (initialValidatorsPubKeys);

        // The IP addresses are irrelevant for these unit test, just initialize them to 0.
        initialValidatorsIpAddresses = Array(initialValidators.length).fill(ZeroIpAddress);

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingHbbft = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                stakingParams,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as StakingHbbftMock;

        await stakingHbbft.waitForDeployment();

        await validatorSetHbbft.setRandomContract(await randomHbbft.getAddress());
        await validatorSetHbbft.setStakingContract(await stakingHbbft.getAddress());
        await validatorSetHbbft.setKeyGenHistoryContract(await keyGenHistory.getAddress());

        const delegatorMinStake = await stakingHbbft.delegatorMinStake();
        const candidateMinStake = await stakingHbbft.candidateMinStake();

        return {
            validatorSetHbbft,
            stakingHbbft,
            blockRewardHbbft,
            randomHbbft,
            keyGenHistory,
            candidateMinStake,
            delegatorMinStake
        };
    }

    beforeEach(async () => {
        [owner, ...accounts] = await ethers.getSigners();

        const accountAddresses = accounts.map(item => item.address);

        initialValidators = accountAddresses.slice(1, 3 + 1); // accounts[1...3]
        initialStakingAddresses = accountAddresses.slice(4, 6 + 1); // accounts[4...6]

        expect(initialStakingAddresses).to.be.lengthOf(3);
        expect(initialStakingAddresses[0]).to.not.be.equal(ethers.ZeroAddress);
        expect(initialStakingAddresses[1]).to.not.be.equal(ethers.ZeroAddress);
        expect(initialStakingAddresses[2]).to.not.be.equal(ethers.ZeroAddress);
    });

    describe('addPool()', async () => {
        let candidateMiningAddress: HardhatEthersSigner;
        let candidateStakingAddress: HardhatEthersSigner;

        beforeEach(async () => {
            candidateMiningAddress = accounts[7];
            candidateStakingAddress = accounts[8];
        });

        it('should set the corresponding public keys', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            for (let i = 0; i < initialStakingAddresses.length; i++) {
                expect(await stakingHbbft.getPoolPublicKey(initialStakingAddresses[i]))
                    .to.be.equal(initialValidatorsPubKeys[i]);
            }
        });

        it('should set the corresponding IP addresses', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            for (let i = 0; i < initialStakingAddresses.length; i++) {
                let ip_result = (await stakingHbbft.getPoolInternetAddress(initialStakingAddresses[i]));
                expect(ip_result[0]).to.be.equal(initialValidatorsIpAddresses[i]);
            }
        });

        it('should create a new pool', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.false;

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.true;
        });

        it('should create pool and set node operator configuration', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.false;

            const nodeOperator = accounts[10];
            const nodeOperatorShare = 2000;

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                nodeOperator,
                nodeOperatorShare,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.emit(stakingHbbft, "SetNodeOperator")
                .withArgs(candidateStakingAddress.address, nodeOperator.address, nodeOperatorShare);

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.true;
            expect(await stakingHbbft.poolNodeOperator(candidateStakingAddress.address)).to.equal(nodeOperator.address);
            expect(await stakingHbbft.poolNodeOperatorShare(candidateStakingAddress.address)).to.equal(nodeOperatorShare);
        });

        it('should fail if created with overstaked pool', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.false;

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: maxStake + minStake }
            )).to.be.revertedWithCustomError(stakingHbbft, "PoolStakeLimitExceeded")
                .withArgs(candidateStakingAddress.address, candidateStakingAddress.address);
        });

        it('should fail if mining address is 0', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                ethers.ZeroAddress,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(stakingHbbft, "ZeroAddress");
        });

        it('should fail if mining address is equal to staking', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateStakingAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(validatorSetHbbft, "InvalidAddressPair");
        });

        it('should fail if the pool with the same mining/staking address is already existing', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const candidateMiningAddress2 = accounts[9];
            const candidateStakingAddress2 = accounts[10];

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            await expect(stakingHbbft.connect(candidateStakingAddress2).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(validatorSetHbbft, "MiningAddressAlreadyUsed");

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress2.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(validatorSetHbbft, "StakingAddressAlreadyUsed");

            await expect(stakingHbbft.connect(candidateMiningAddress2).addPool(
                candidateStakingAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(validatorSetHbbft, "MiningAddressAlreadyUsed");

            await expect(stakingHbbft.connect(candidateMiningAddress).addPool(
                candidateStakingAddress2.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(validatorSetHbbft, "StakingAddressAlreadyUsed");

            await expect(stakingHbbft.connect(candidateMiningAddress2).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(validatorSetHbbft, "MiningAddressAlreadyUsed");

            await expect(stakingHbbft.connect(candidateMiningAddress).addPool(
                candidateMiningAddress2.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(validatorSetHbbft, "StakingAddressAlreadyUsed");

            await expect(stakingHbbft.connect(candidateStakingAddress2).addPool(
                candidateStakingAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(validatorSetHbbft, "MiningAddressAlreadyUsed");

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateStakingAddress2.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(validatorSetHbbft, "StakingAddressAlreadyUsed");

            expect(await stakingHbbft.connect(candidateStakingAddress2).addPool(
                candidateMiningAddress2.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            ));
        });

        it('should fail if gasPrice is 0', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { gasPrice: 0, value: minStake }
            )).to.be.revertedWithCustomError(stakingHbbft, "ZeroGasPrice");
        });

        it('should fail if staking amount is 0', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: 0n }
            )).to.be.revertedWithCustomError(stakingHbbft, "InsufficientStakeAmount");
        });

        it.skip('should fail if stacking time is inside disallowed range', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake },
            )).to.be.revertedWith("Stake: disallowed period");

            await helpers.time.increase(2);

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake },
            );
        });

        it('should fail if staking amount is less than CANDIDATE_MIN_STAKE', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake / 2n }
            )).to.be.revertedWithCustomError(stakingHbbft, "InsufficientStakeAmount");
        });

        it('stake amount should be increased', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const amount = minStake * 2n;
            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: amount }
            );

            expect(await stakingHbbft.stakeAmount(candidateStakingAddress.address, candidateStakingAddress.address)).to.equal(amount);
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(candidateStakingAddress.address, candidateStakingAddress.address)).to.equal(amount);
            expect(await stakingHbbft.stakeAmountTotal(candidateStakingAddress.address)).to.equal(amount);
        });

        it('should be able to add more than one pool', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const candidate1MiningAddress = candidateMiningAddress;
            const candidate1StakingAddress = candidateStakingAddress;
            const candidate2MiningAddress = accounts[9];
            const candidate2StakingAddress = accounts[10];

            const amount1 = minStake * 2n;
            const amount2 = minStake * 3n;

            // Add two new pools
            expect(await stakingHbbft.isPoolActive(candidate1StakingAddress.address)).to.be.false;
            expect(await stakingHbbft.isPoolActive(candidate2StakingAddress.address)).to.be.false;

            await stakingHbbft.connect(candidate1StakingAddress).addPool(
                candidate1MiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: amount1 }
            );

            await stakingHbbft.connect(candidate2StakingAddress).addPool(
                candidate2MiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: amount2 }
            );

            expect(await stakingHbbft.isPoolActive(candidate1StakingAddress.address)).to.be.true;
            expect(await stakingHbbft.isPoolActive(candidate2StakingAddress.address)).to.be.true;

            // Check indexes in the `poolsToBeElected` list
            expect(await stakingHbbft.poolToBeElectedIndex(candidate1StakingAddress.address)).to.equal(0n);
            expect(await stakingHbbft.poolToBeElectedIndex(candidate2StakingAddress.address)).to.equal(1n);

            // Check pools' existence
            const validators = await validatorSetHbbft.getValidators();

            expect(await stakingHbbft.getPools()).to.be.deep.equal([
                await validatorSetHbbft.stakingByMiningAddress(validators[0]),
                await validatorSetHbbft.stakingByMiningAddress(validators[1]),
                await validatorSetHbbft.stakingByMiningAddress(validators[2]),
                candidate1StakingAddress.address,
                candidate2StakingAddress.address
            ]);
        });

        it("shouldn't allow adding more than MAX_CANDIDATES pools", async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const maxCandidates = await stakingHbbft.getMaxCandidates();

            for (let i = initialValidators.length; i < maxCandidates; ++i) {
                // Add a new pool
                await stakingHbbft.addPoolActiveMock(ethers.Wallet.createRandom().address);
            }

            // Try to add a new pool outside of max limit, max limit is 100 in mock contract.
            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWithCustomError(stakingHbbft, "MaxPoolsCountExceeded");

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.false;
        });

        it('should remove added pool from the list of inactive pools', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.addPoolInactiveMock(candidateStakingAddress.address);
            expect(await stakingHbbft.getPoolsInactive()).to.be.deep.equal([candidateStakingAddress.address]);

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.true;
            expect(await stakingHbbft.getPoolsInactive()).to.be.empty;
        });
    });

    describe('setNodeOperator', async () => {
        let candidateMiningAddress: HardhatEthersSigner;
        let candidateStakingAddress: HardhatEthersSigner;

        beforeEach(async () => {
            candidateMiningAddress = accounts[7];
            candidateStakingAddress = accounts[8];
        });

        it('should revert for non-existing pool', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = accounts[15];
            const operator = ethers.Wallet.createRandom().address;
            const share = 1000;

            await expect(stakingHbbft.connect(pool).setNodeOperator(operator, share))
                .to.be.revertedWithCustomError(stakingHbbft, "PoolNotExist")
                .withArgs(pool.address);
        });

        it('should not allow to change node operator twice within same epoch', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            const operator = ethers.Wallet.createRandom().address;
            const share = 1000;

            const stakingEpoch = await stakingHbbft.stakingEpoch();

            await expect(stakingHbbft.connect(candidateStakingAddress).setNodeOperator(operator, share))
                .to.be.revertedWithCustomError(stakingHbbft, "OnlyOncePerEpoch")
                .withArgs(stakingEpoch);
        });

        it('should not allow zero address and non-zero percent', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorMockSetAddress(await validatorSetHbbft.getAddress());

            const operator = ethers.ZeroAddress;
            const share = 1000;

            await expect(stakingHbbft.connect(candidateStakingAddress).setNodeOperator(operator, share))
                .to.be.revertedWithCustomError(stakingHbbft, "InvalidNodeOperatorConfiguration")
                .withArgs(operator, share);
        });

        it('should not exceed max share percent', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorMockSetAddress(await validatorSetHbbft.getAddress());

            const operator = ethers.Wallet.createRandom().address;
            const share = 2001;

            await expect(stakingHbbft.connect(candidateStakingAddress).setNodeOperator(operator, share))
                .to.be.revertedWithCustomError(stakingHbbft, "InvalidNodeOperatorShare")
                .withArgs(share);
        });

        it('should change pool node operator configuration', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorMockSetAddress(await validatorSetHbbft.getAddress());

            const operator = ethers.Wallet.createRandom().address;
            const share = 1950;

            await expect(stakingHbbft.connect(candidateStakingAddress).setNodeOperator(operator, share))
                .to.emit(stakingHbbft, "SetNodeOperator")
                .withArgs(candidateStakingAddress.address, operator, share);

            expect(await stakingHbbft.poolNodeOperator(candidateStakingAddress.address)).to.equal(operator);
            expect(await stakingHbbft.poolNodeOperatorShare(candidateStakingAddress.address)).to.equal(share);
        });
    });

    describe('contract balance', async () => {
        before(async () => {
            candidateMiningAddress = accounts[7];
            candidateStakingAddress = accounts[8];
        });

        it('cannot be increased by sending native coins', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(owner.sendTransaction({ to: await stakingHbbft.getAddress(), value: 1n }))
                .to.be.revertedWithCustomError(stakingHbbft, "NotPayable");

            await owner.sendTransaction({ to: accounts[1].address, value: 1n });
            expect(await ethers.provider.getBalance(await stakingHbbft.getAddress())).to.be.equal(0n);
        });

        it('can be increased by sending coins to payable functions', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await ethers.provider.getBalance(await stakingHbbft.getAddress())).to.be.equal(0n);
            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ethers.ZeroAddress,
                0n,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            expect(await ethers.provider.getBalance(await stakingHbbft.getAddress())).to.to.be.equal(minStake);

            await stakingHbbft.connect(candidateStakingAddress).stake(
                candidateStakingAddress.address,
                { value: minStake }
            );

            expect(await ethers.provider.getBalance(await stakingHbbft.getAddress())).to.be.equal(minStake * 2n);
        });
    });

    describe('incrementStakingEpoch()', async () => {
        let stakingContract: StakingHbbftMock;
        let validatorSetContract: HardhatEthersSigner;

        beforeEach(async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            stakingContract = stakingHbbft;
            validatorSetContract = accounts[7];

            await stakingHbbft.setValidatorMockSetAddress(await validatorSetContract.getAddress());
        });

        it('should increment if called by the ValidatorSet', async () => {
            expect(await stakingContract.stakingEpoch()).to.be.equal(0n);
            await stakingContract.connect(validatorSetContract).incrementStakingEpoch();

            expect(await stakingContract.stakingEpoch()).to.be.equal(1n);
        });

        it('can only be called by ValidatorSet contract', async () => {
            await expect(stakingContract.connect(accounts[8]).incrementStakingEpoch())
                .to.be.revertedWithCustomError(stakingContract, "Unauthorized");
        });
    });

    describe('initialize()', async () => {
        const validatorSetContract = ethers.Wallet.createRandom().address;
        const bonusScoreContract = ethers.Wallet.createRandom().address;

        beforeEach(async () => {
            // The following private keys belong to the accounts 1-3, fixed by using the "--mnemonic" option when starting ganache.
            // const initialValidatorsPrivKeys = ["0x272b8400a202c08e23641b53368d603e5fec5c13ea2f438bce291f7be63a02a7", "0xa8ea110ffc8fe68a069c8a460ad6b9698b09e21ad5503285f633b3ad79076cf7", "0x5da461ff1378256f69cb9a9d0a8b370c97c460acbe88f5d897cb17209f891ffc"];
            // Public keys corresponding to the three private keys above.
            initialValidatorsPubKeys = [
                '0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
                '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
                '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56'
            ];

            initialValidatorsPubKeysSplit = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
                (initialValidatorsPubKeys);

            // The IP addresses are irrelevant for these unit test, just initialize them to 0.
            initialValidatorsIpAddresses = [
                ZeroIpAddress,
                ZeroIpAddress,
                ZeroIpAddress
            ];
        });

        it('should initialize successfully', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStakeDelegators,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            const stakingHbbft = await upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            ) as unknown as StakingHbbftMock;

            await stakingHbbft.waitForDeployment();

            expect(await stakingHbbft.stakingFixedEpochDuration()).to.be.equal(stakingFixedEpochDuration);
            expect(await stakingHbbft.stakingWithdrawDisallowPeriod()).to.be.equal(stakingWithdrawDisallowPeriod);
            expect(await stakingHbbft.validatorSetContract()).to.be.equal(validatorSetContract)

            for (const stakingAddress of initialStakingAddresses) {
                expect(await stakingHbbft.isPoolActive(stakingAddress)).to.be.true;
                expect(await stakingHbbft.getPools()).to.include(stakingAddress);
                expect(await stakingHbbft.getPoolsToBeRemoved()).to.include(stakingAddress);
            }

            expect(await stakingHbbft.getPools()).to.be.deep.equal(initialStakingAddresses);
            expect(await stakingHbbft.delegatorMinStake()).to.be.equal(minStakeDelegators);
            expect(await stakingHbbft.candidateMinStake()).to.be.equal(minStake)
        });

        it('should fail if owner = address(0)', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    ethers.ZeroAddress,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "ZeroAddress");
        });

        it('should fail if ValidatorSet contract address is zero', async () => {
            let stakingParams = {
                _validatorSetContract: ethers.ZeroAddress,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "ZeroAddress");
        });

        it('should fail if delegatorMinStake is zero', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: 0,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "InvalidInitialStakeAmount")
                .withArgs(minStake, 0);
        });

        it('should fail if candidateMinStake is zero', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: 0,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "InvalidInitialStakeAmount")
                .withArgs(0, minStake);
        });

        it('should fail if already initialized', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            const stakingHbbft = await upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            );

            await stakingHbbft.waitForDeployment();

            await expect(stakingHbbft.initialize(
                owner.address,
                stakingParams,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            )).to.be.revertedWithCustomError(stakingHbbft, "InvalidInitialization");
        });

        it('should fail if stakingEpochDuration is 0', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: 0,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "InvalidFixedEpochDuration");
        });

        it('should fail if stakingWithdrawDisallowPeriod is 0', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: 0n
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "ZeroWidthrawDisallowPeriod");
        });

        it('should fail if stakingWithdrawDisallowPeriod >= stakingEpochDuration', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: 120954n
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "InvalidFixedEpochDuration");
        });

        it('should fail if some staking address is 0', async () => {
            initialStakingAddresses[0] = ethers.ZeroAddress;

            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "ZeroAddress");
        });

        it('should fail if timewindow is 0', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: 0,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "InvalidTransitionTimeFrame");
        });

        it('should fail if transition timewindow is smaller than the staking time window', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: minStake,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingFixedEpochDuration,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            await expect(upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(StakingHbbftFactory, "InvalidTransitionTimeFrame");
        });
    });

    describe('moveStake()', async () => {
        let delegator: HardhatEthersSigner;
        let stakingContract: StakingHbbftMock;
        const stakeAmount = minStake * 2n;

        beforeEach(async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            delegator = accounts[7];
            stakingContract = stakingHbbft;

            // Place stakes
            await stakingContract.connect(await ethers.getSigner(initialStakingAddresses[0])).stake(initialStakingAddresses[0], { value: stakeAmount });
            await stakingContract.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingContract.connect(delegator).stake(initialStakingAddresses[0], { value: stakeAmount });
        });

        it('should move entire stake', async () => {
            // we can move the stake, since the staking address is not part of the active validator set,
            // since we never did never a time travel.
            // If we do, the stakingAddresses are blocked to withdraw without an orderwithdraw.
            expect(await stakingContract.stakeAmount(initialStakingAddresses[0], delegator.address)).to.be.equal(stakeAmount);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[1], delegator.address)).to.be.equal(0n);

            await stakingContract.connect(delegator).moveStake(initialStakingAddresses[0], initialStakingAddresses[1], stakeAmount);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[0], delegator.address)).to.be.equal(0n);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[1], delegator.address)).to.be.equal(stakeAmount);
        });

        it('should move part of the stake', async () => {
            expect(await stakingContract.stakeAmount(initialStakingAddresses[0], delegator.address)).to.be.equal(stakeAmount);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[1], delegator.address)).to.be.equal(0n);

            await stakingContract.connect(delegator).moveStake(initialStakingAddresses[0], initialStakingAddresses[1], minStake);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[0], delegator.address)).to.be.equal(minStake);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[1], delegator.address)).to.be.equal(minStake);
        });

        it('should move part of the stake', async () => {
            await stakingContract.connect(delegator).stake(initialStakingAddresses[1], { value: stakeAmount });

            const sourcePool = initialStakingAddresses[0];
            const targetPool = initialStakingAddresses[1];

            expect(await stakingContract.stakeAmount(sourcePool, delegator.address)).to.be.equal(stakeAmount);
            expect(await stakingContract.stakeAmount(targetPool, delegator.address)).to.be.equal(stakeAmount);

            const moveAmount = minStakeDelegators / 2n;
            expect(moveAmount).to.be.below(await stakingContract.delegatorMinStake());

            await stakingContract.connect(delegator).moveStake(sourcePool, targetPool, moveAmount);
            expect(await stakingContract.stakeAmount(sourcePool, delegator.address)).to.be.equal(stakeAmount - moveAmount);
            expect(await stakingContract.stakeAmount(targetPool, delegator.address)).to.be.equal(stakeAmount + moveAmount);
        });

        it('should fail for zero gas price', async () => {
            await expect(stakingContract.connect(delegator).moveStake(
                initialStakingAddresses[0],
                initialStakingAddresses[1],
                stakeAmount,
                { gasPrice: 0 }
            )).to.be.revertedWithCustomError(stakingContract, "ZeroGasPrice");
        });

        it('should fail if the source and destination addresses are the same', async () => {
            await expect(stakingContract.connect(delegator).moveStake(
                initialStakingAddresses[0],
                initialStakingAddresses[0],
                stakeAmount
            )).to.be.revertedWithCustomError(stakingContract, "InvalidMoveStakePoolsAddress");
        });

        it('should fail if the staker tries to move more than they have', async () => {
            await expect(stakingContract.connect(delegator).moveStake(
                initialStakingAddresses[0],
                initialStakingAddresses[1],
                stakeAmount * 2n
            )).to.be.revertedWithCustomError(stakingContract, "MaxAllowedWithdrawExceeded");
        });

        it('should fail if the staker tries to overstake by moving stake.', async () => {
            // stake source pool and target pool to the max.
            // then move 1 from source to target - that should be the drop on the hot stone.
            const sourcePool = initialStakingAddresses[0];
            const targetPool = initialStakingAddresses[1];

            let currentSourceStake = await stakingContract.stakeAmountTotal(sourcePool);
            const totalStakeableSource = maxStake - currentSourceStake;
            await stakingContract.connect(delegator).stake(sourcePool, { value: totalStakeableSource });

            let currentTargetStake = await stakingContract.stakeAmountTotal(targetPool);
            const totalStakeableTarget = maxStake - currentTargetStake;
            await stakingContract.connect(delegator).stake(targetPool, { value: totalStakeableTarget });
            // source is at max stake now, now tip it over.
            await expect(stakingContract.connect(delegator).moveStake(
                sourcePool,
                targetPool,
                1n
            )).to.be.revertedWithCustomError(stakingContract, "PoolStakeLimitExceeded")
                .withArgs(targetPool, delegator.address);
        });
    });

    describe('stake()', async () => {
        let delegatorAddress: HardhatEthersSigner;

        beforeEach(async () => {
            delegatorAddress = accounts[7];
        });

        it('should be zero initially', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], initialStakingAddresses[1])).to.be.equal(0n);
            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);
        });

        it('should place a stake', async () => {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });

            expect(await stakingHbbft.stakeAmount(pool.address, pool.address)).to.be.equal(candidateMinStake);

            await expect(stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake }))
                .to.emit(stakingHbbft, "PlacedStake")
                .withArgs(
                    pool.address,
                    delegatorAddress.address,
                    0n,
                    delegatorMinStake
                );

            expect(await stakingHbbft.stakeAmount(pool.address, delegatorAddress.address)).to.be.equal(delegatorMinStake);
            expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.equal(candidateMinStake + delegatorMinStake);
        });

        it('should fail for zero gas price', async () => {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await expect(stakingHbbft.connect(pool).stake(
                pool.address,
                { value: candidateMinStake, gasPrice: 0 }
            )).to.be.revertedWithCustomError(stakingHbbft, "ZeroGasPrice");
        });

        it('should fail for a zero staking pool address', async () => {
            const { stakingHbbft, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(delegatorAddress).stake(ethers.ZeroAddress, { value: delegatorMinStake }))
                .to.be.revertedWithCustomError(stakingHbbft, "ZeroAddress");
        });

        it('should fail for a non-existing pool', async () => {
            const { stakingHbbft, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = accounts[10].address;

            await expect(stakingHbbft.connect(delegatorAddress).stake(pool, { value: delegatorMinStake }))
                .to.be.revertedWithCustomError(stakingHbbft, "PoolNotExist")
                .withArgs(pool);
        });

        it('should fail for a zero amount', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialStakingAddresses[1];

            await expect(stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: 0 }))
                .to.be.revertedWithCustomError(stakingHbbft, "InsufficientStakeAmount")
                .withArgs(pool, delegatorAddress.address);
        });

        it.skip('should only success in the allowed staking window', async () => {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await expect(stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake }))
                .to.be.revertedWith("Stake: disallowed period");
        });

        it('should fail if a candidate stakes less than CANDIDATE_MIN_STAKE', async () => {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            const halfOfCandidateMinStake = candidateMinStake / 2n;
            await expect(stakingHbbft.connect(pool).stake(
                pool.address,
                { value: halfOfCandidateMinStake }
            )).to.be.revertedWithCustomError(stakingHbbft, "InsufficientStakeAmount")
                .withArgs(pool.address, pool.address);
        });

        it('should fail if a delegator stakes less than DELEGATOR_MIN_STAKE', async () => {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            const halfOfDelegatorMinStake = delegatorMinStake / 2n;

            await expect(stakingHbbft.connect(delegatorAddress).stake(
                pool.address,
                { value: halfOfDelegatorMinStake }
            )).to.be.revertedWithCustomError(stakingHbbft, "InsufficientStakeAmount")
                .withArgs(pool.address, delegatorAddress.address);
        });

        it('should fail if a delegator stakes more than maxStake', async () => {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            await expect(stakingHbbft.connect(delegatorAddress).stake(
                pool.address,
                { value: maxStake + 1n }
            )).to.be.revertedWithCustomError(stakingHbbft, "PoolStakeLimitExceeded")
                .withArgs(pool.address, delegatorAddress.address);
        });

        it('should fail if a delegator stakes into an empty pool', async () => {
            const { stakingHbbft, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            expect(await stakingHbbft.stakeAmount(pool.address, pool.address)).to.be.equal(0n);
            await expect(stakingHbbft.connect(delegatorAddress).stake(
                pool.address,
                { value: delegatorMinStake }
            )).to.be.revertedWithCustomError(stakingHbbft, "PoolEmpty")
                .withArgs(pool.address);
        });

        it('should increase a stake amount', async () => {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            expect(await stakingHbbft.stakeAmount(pool.address, delegatorAddress.address)).to.be.equal(0n);

            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });
            expect(await stakingHbbft.stakeAmount(pool.address, delegatorAddress.address)).to.be.equal(delegatorMinStake);

            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });
            expect(await stakingHbbft.stakeAmount(pool.address, delegatorAddress.address)).to.be.equal(delegatorMinStake * 2n);
        });

        it('should increase the stakeAmountByCurrentEpoch', async () => {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(pool.address, delegatorAddress.address)).to.be.equal(0n);

            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(pool.address, delegatorAddress.address)).to.be.equal(delegatorMinStake);

            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(pool.address, delegatorAddress.address)).to.be.equal(delegatorMinStake * 2n);
        });

        it('should increase a total stake amount', async () => {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.equal(candidateMinStake);

            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });
            expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.equal(candidateMinStake + delegatorMinStake);

            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });
            expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.equal(candidateMinStake + delegatorMinStake * 2n);
        });

        it('should add a delegator to the pool', async () => {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            expect(await stakingHbbft.poolDelegators(pool.address)).to.be.empty;

            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });
            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });

            expect(await stakingHbbft.poolDelegators(pool.address)).to.be.deep.equal([delegatorAddress.address]);
        });

        it("should update pool's likelihood", async () => {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            let likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            expect(likelihoodInfo.likelihoods).to.be.empty;
            expect(likelihoodInfo.sum).to.be.equal(0n);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            expect(likelihoodInfo.likelihoods[0]).to.be.equal(candidateMinStake);
            expect(likelihoodInfo.sum).to.be.equal(candidateMinStake);

            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });
            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            expect(likelihoodInfo.likelihoods[0]).to.be.equal(candidateMinStake + delegatorMinStake);
            expect(likelihoodInfo.sum).to.be.equal(candidateMinStake + delegatorMinStake);

            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: delegatorMinStake });
            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            expect(likelihoodInfo.likelihoods[0]).to.be.equal(candidateMinStake + delegatorMinStake * 2n);
            expect(likelihoodInfo.sum).to.be.equal(candidateMinStake + delegatorMinStake * 2n);
        });

        it('should decrease the balance of the staker and increase the balance of the Staking contract', async () => {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            expect(await ethers.provider.getBalance(await stakingHbbft.getAddress())).to.be.equal(0n);

            const initialBalance = await ethers.provider.getBalance(pool.address);
            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });

            expect(await ethers.provider.getBalance(pool.address)).to.be.below(initialBalance - candidateMinStake);
            expect(await ethers.provider.getBalance(await stakingHbbft.getAddress())).to.be.equal(candidateMinStake);
        });

        it('should not create stake snapshot on epoch 0', async () => {
            const {
                stakingHbbft,
                validatorSetHbbft,
                candidateMinStake,
                delegatorMinStake,
            } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);
            const mining = initialValidators[1];
            const delegator = accounts[11];

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            expect(await stakingHbbft.stakeAmount(pool.address, pool.address)).to.be.equal(candidateMinStake);

            let stakingEpoch = await stakingHbbft.stakingEpoch();
            expect(stakingEpoch).to.equal(0n);

            await stakingHbbft.connect(delegator).stake(pool.address, { value: delegatorMinStake });
            expect(await stakingHbbft.stakeAmount(pool.address, delegator.address)).to.be.equal(delegatorMinStake);
            expect(await stakingHbbft.getDelegatorStakeSnapshot(pool.address, delegator.address, stakingEpoch))
                .to.be.equal(0n);
            expect(await stakingHbbft.getStakeSnapshotLastEpoch(pool.address, delegator.address))
                .to.be.equal(0n);

            expect(await validatorSetHbbft.isValidatorOrPending(mining)).to.be.true;

            await stakingHbbft.connect(delegator).stake(pool.address, { value: delegatorMinStake * 2n });
            expect(await stakingHbbft.stakeAmount(pool.address, delegator.address)).to.be.equal(delegatorMinStake * 3n);
            expect(await stakingHbbft.getDelegatorStakeSnapshot(pool.address, delegator.address, stakingEpoch))
                .to.be.equal(0n);
            expect(await stakingHbbft.getStakeSnapshotLastEpoch(pool.address, delegator.address))
                .to.be.equal(0n);
        });

        it('should create stake snapshot if staking on an active validator', async () => {
            const {
                stakingHbbft,
                validatorSetHbbft,
                blockRewardHbbft,
                candidateMinStake,
                delegatorMinStake,
            } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);
            const mining = initialValidators[1];
            const delegator = accounts[11];

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            expect(await stakingHbbft.stakeAmount(pool.address, pool.address)).to.be.equal(candidateMinStake);

            let stakingEpoch = await stakingHbbft.stakingEpoch();
            await stakingHbbft.connect(delegator).stake(pool.address, { value: delegatorMinStake });
            expect(await stakingHbbft.stakeAmount(pool.address, delegator.address)).to.be.equal(delegatorMinStake);
            expect(await stakingHbbft.getDelegatorStakeSnapshot(pool.address, delegator.address, stakingEpoch))
                .to.be.equal(0n);
            expect(await stakingHbbft.getStakeSnapshotLastEpoch(pool.address, delegator.address))
                .to.be.equal(0n);

            await callReward(blockRewardHbbft, true);

            expect(await validatorSetHbbft.isValidatorOrPending(mining)).to.be.true;
            expect(await stakingHbbft.stakingEpoch()).to.be.gt(0n);

            stakingEpoch = await stakingHbbft.stakingEpoch();
            await stakingHbbft.connect(delegator).stake(pool.address, { value: delegatorMinStake * 2n });
            expect(await stakingHbbft.stakeAmount(pool.address, delegator.address)).to.be.equal(delegatorMinStake * 3n);
            expect(await stakingHbbft.getDelegatorStakeSnapshot(pool.address, delegator.address, stakingEpoch))
                .to.be.equal(delegatorMinStake);
            expect(await stakingHbbft.getStakeSnapshotLastEpoch(pool.address, delegator.address))
                .to.be.equal(stakingEpoch);
        });
    });

    describe('removePool()', async () => {
        it('should remove a pool', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await stakingHbbft.getPools()).to.be.deep.equal(initialStakingAddresses);

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[0]);

            expect(await stakingHbbft.getPools()).to.be.deep.equal([
                initialStakingAddresses[2],
                initialStakingAddresses[1]
            ]);

            expect(await stakingHbbft.getPoolsInactive()).to.be.empty;
        });

        it('can only be called by the ValidatorSetHbbft contract', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await expect(stakingHbbft.connect(accounts[8]).removePool(initialStakingAddresses[0]))
                .to.be.revertedWithCustomError(stakingHbbft, "Unauthorized");
        });

        it("shouldn't fail when removing a nonexistent pool", async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await stakingHbbft.getPools()).to.be.deep.equal(initialStakingAddresses);

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).removePool(accounts[10].address);

            expect(await stakingHbbft.getPools()).to.be.deep.equal(initialStakingAddresses);
        });

        it('should add/remove a pool to/from the utility lists', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            // The first validator places stake for themselves
            expect(await stakingHbbft.getPoolsToBeElected()).to.be.lengthOf(0);
            expect(await stakingHbbft.getPoolsToBeRemoved()).to.be.deep.equal(initialStakingAddresses);

            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).stake(
                initialStakingAddresses[0],
                { value: minStake }
            );

            expect(await stakingHbbft.stakeAmountTotal(initialStakingAddresses[0])).to.be.equal(minStake);
            expect(await stakingHbbft.getPoolsToBeElected()).to.be.deep.equal([initialStakingAddresses[0]]);
            expect(await stakingHbbft.getPoolsToBeRemoved()).to.be.deep.equal([
                initialStakingAddresses[2],
                initialStakingAddresses[1]
            ]);

            // Remove the pool
            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[0]);
            expect(await stakingHbbft.getPoolsInactive()).to.be.deep.equal([initialStakingAddresses[0]]);

            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[0]);
            expect(await stakingHbbft.getPoolsInactive()).to.be.deep.equal([initialStakingAddresses[0]]);

            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[1]);
            expect(await stakingHbbft.getPoolsToBeRemoved()).to.be.deep.equal([initialStakingAddresses[2]]);
        });
    });

    describe('removePools()', async () => {
        it('should restrict calling removePools to validator set contract', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await expect(stakingHbbft.connect(caller).removePools())
                .to.be.revertedWithCustomError(stakingHbbft, "Unauthorized");
        });
    });

    describe('removeMyPool()', async () => {
        it('should fail for zero gas price', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorMockSetAddress(await validatorSetHbbft.getAddress());
            await expect(stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).removeMyPool({ gasPrice: 0n }))
                .to.be.revertedWithCustomError(stakingHbbft, "ZeroGasPrice");
        });

        it('should fail for initial validator during the initial staking epoch', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialStakingAddresses[0];

            expect(await stakingHbbft.stakingEpoch()).to.be.equal(0n);
            expect(await validatorSetHbbft.isValidator(initialValidators[0])).to.be.true;
            expect(await validatorSetHbbft.miningByStakingAddress(pool)).to.be.equal(initialValidators[0]);

            await expect(stakingHbbft.connect(await ethers.getSigner(pool)).removeMyPool())
                .to.be.revertedWithCustomError(stakingHbbft, "PoolCannotBeRemoved")
                .withArgs(pool);

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorMockSetAddress(await validatorSetHbbft.getAddress());

            await expect(stakingHbbft.connect(await ethers.getSigner(pool)).removeMyPool()).to.be.fulfilled
        });
    });

    describe('withdraw()', async () => {
        const stakeAmount = minStake * 2n;
        let delegatorAddress: HardhatEthersSigner;

        beforeEach(async () => {
            delegatorAddress = accounts[7];
        });

        it('should withdraw a stake', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], initialStakingAddresses[1])).to.be.equal(0n);
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], initialStakingAddresses[1])).to.be.equal(0n);
            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);

            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], initialStakingAddresses[1])).to.be.equal(stakeAmount);
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], initialStakingAddresses[1])).to.be.equal(stakeAmount);

            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: stakeAmount });
            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(stakeAmount);
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(stakeAmount);
            expect(await stakingHbbft.stakeAmountTotal(initialStakingAddresses[1])).to.be.equal(stakeAmount * 2n);

            await expect(stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], stakeAmount))
                .to.emit(stakingHbbft, "WithdrewStake")
                .withArgs(
                    initialStakingAddresses[1],
                    delegatorAddress.address,
                    0n,
                    stakeAmount
                );

            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);
            expect(await stakingHbbft.stakeAmountTotal(initialStakingAddresses[1])).to.be.equal(stakeAmount);
        });

        it('should fail for zero gas price', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const staker = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(staker).stake(staker.address, { value: stakeAmount });
            await expect(stakingHbbft.connect(staker).withdraw(
                staker.address,
                stakeAmount,
                { gasPrice: 0 }
            )).to.be.revertedWithCustomError(stakingHbbft, "ZeroGasPrice");
        });

        it('should fail for a zero pool address', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const staker = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(staker).stake(staker.address, { value: stakeAmount });
            await expect(stakingHbbft.connect(staker).withdraw(ethers.ZeroAddress, stakeAmount))
                .to.be.revertedWithCustomError(stakingHbbft, "ZeroAddress");

            await stakingHbbft.connect(staker).withdraw(staker.address, stakeAmount);
        });

        it('should fail for a zero amount', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const staker = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(staker).stake(staker.address, { value: stakeAmount });
            await expect(stakingHbbft.connect(staker).withdraw(staker.address, 0n))
                .to.be.revertedWithCustomError(stakingHbbft, "ZeroWidthrawAmount");

            await stakingHbbft.connect(staker).withdraw(staker.address, stakeAmount);
        });

        it.skip("shouldn't allow withdrawing during the stakingWithdrawDisallowPeriod", async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.stake(initialStakingAddresses[1], { from: initialStakingAddresses[1], value: stakeAmount });

            //await stakingHbbft.setCurrentBlockNumber(117000);
            //await validatorSetHbbft.setCurrentBlockNumber(117000);
            await expect(stakingHbbft.withdraw(
                initialStakingAddresses[1],
                stakeAmount,
                { from: initialStakingAddresses[1] }
            )).to.be.revertedWith("Stake: disallowed period");

            //await stakingHbbft.setCurrentBlockNumber(116000);
            //await validatorSetHbbft.setCurrentBlockNumber(116000);

            await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, { from: initialStakingAddresses[1] });
        });

        it('should fail if non-zero residue is less than CANDIDATE_MIN_STAKE', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const candidateMinStake = await stakingHbbft.candidateMinStake();
            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: stakeAmount });

            const withdrawAmount = stakeAmount - candidateMinStake + 1n;
            await expect(stakingHbbft.connect(pool).withdraw(pool.address, withdrawAmount))
                .to.be.revertedWithCustomError(stakingHbbft, "InvalidWithdrawAmount")
                .withArgs(pool.address, pool.address, withdrawAmount);

            await stakingHbbft.connect(pool).withdraw(pool.address, stakeAmount - candidateMinStake);
            await stakingHbbft.connect(pool).withdraw(pool.address, candidateMinStake);
        });

        it('should fail if non-zero residue is less than DELEGATOR_MIN_STAKE', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const delegatorMinStake = await stakingHbbft.delegatorMinStake();
            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: stakeAmount });
            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: stakeAmount });

            const withdrawAmount = stakeAmount - delegatorMinStake + 1n;
            await expect(stakingHbbft.connect(delegatorAddress).withdraw(pool.address, withdrawAmount))
                .to.be.revertedWithCustomError(stakingHbbft, "InvalidWithdrawAmount")
                .withArgs(pool.address, delegatorAddress.address, withdrawAmount);

            await stakingHbbft.connect(delegatorAddress).withdraw(pool.address, stakeAmount - delegatorMinStake);
            await stakingHbbft.connect(delegatorAddress).withdraw(pool.address, delegatorMinStake);
        });

        it('should fail if withdraw more than staked', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: stakeAmount });

            const maxAllowed = await stakingHbbft.maxWithdrawAllowed(pool.address, pool.address);
            const withdrawAmount = stakeAmount + 1n;

            await expect(stakingHbbft.connect(pool).withdraw(pool.address, withdrawAmount))
                .to.be.revertedWithCustomError(stakingHbbft, "MaxAllowedWithdrawExceeded")
                .withArgs(maxAllowed, withdrawAmount);

            await stakingHbbft.connect(pool).withdraw(pool.address, stakeAmount);
        });

        it('should revert orderWithdraw with gasPrice = 0', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.orderWithdraw(
                initialStakingAddresses[1],
                ethers.parseEther('1'),
                { gasPrice: 0n },
            )).to.be.revertedWithCustomError(stakingHbbft, "ZeroGasPrice");
        });

        it('should revert orderWithdraw with pool = address(0)', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.orderWithdraw(
                ethers.ZeroAddress,
                ethers.parseEther('1'),
            )).to.be.revertedWithCustomError(stakingHbbft, "ZeroAddress");
        });

        it('should revert orderWithdraw with amount = 0', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.orderWithdraw(
                initialStakingAddresses[1],
                0n,
            )).to.be.revertedWithCustomError(stakingHbbft, "ZeroWidthrawAmount");
        });

        it('should fail if withdraw already ordered amount', async () => {
            const { stakingHbbft, validatorSetHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContractsFixture);

            const systemSigner = await impersonateAcc(SystemAccountAddress);

            // Place a stake during the initial staking epoch
            expect(await stakingHbbft.stakingEpoch()).to.be.equal(0n);
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).stake(initialStakingAddresses[0], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[2])).stake(initialStakingAddresses[2], { value: stakeAmount });
            await stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: stakeAmount });

            // Finalize a new validator set and change staking epoch
            await validatorSetHbbft.setStakingContract(await stakingHbbft.getAddress());

            // Set BlockRewardContract
            await validatorSetHbbft.setBlockRewardContract(accounts[7].address);
            await validatorSetHbbft.connect(accounts[7]).newValidatorSet();
            await validatorSetHbbft.setBlockRewardContract(await blockRewardHbbft.getAddress());
            // (increases staking epoch)
            await timeTravelToTransition(blockRewardHbbft, stakingHbbft);
            await timeTravelToEndEpoch(blockRewardHbbft, stakingHbbft);

            expect(await stakingHbbft.stakingEpoch()).to.be.equal(1n);
            // Order withdrawal
            const orderedAmount = stakeAmount / 4n;
            await stakingHbbft.connect(delegatorAddress).orderWithdraw(initialStakingAddresses[1], orderedAmount);

            // The second validator removes their pool
            expect(await validatorSetHbbft.isValidator(initialValidators[1])).to.be.true;
            expect(await stakingHbbft.getPoolsInactive()).to.be.empty;

            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).removeMyPool();
            expect(await stakingHbbft.getPoolsInactive()).to.be.deep.equal([initialStakingAddresses[1]]);

            // Finalize a new validator set, change staking epoch and enqueue pending validators
            await validatorSetHbbft.setBlockRewardContract(accounts[7].address);
            await validatorSetHbbft.connect(accounts[7]).newValidatorSet();
            await validatorSetHbbft.setBlockRewardContract(await blockRewardHbbft.getAddress());

            await timeTravelToTransition(blockRewardHbbft, stakingHbbft);
            await timeTravelToEndEpoch(blockRewardHbbft, stakingHbbft);

            expect(await stakingHbbft.stakingEpoch()).to.be.equal(2n);
            expect(await validatorSetHbbft.isValidator(initialValidators[1])).to.be.false;

            // Check withdrawal for a delegator
            const restOfAmount = stakeAmount * 3n / 4n;

            expect(await stakingHbbft.poolDelegators(initialStakingAddresses[1])).to.be.deep.equal([delegatorAddress.address]);
            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(restOfAmount);
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);

            const pool = initialStakingAddresses[1];
            const maxAllowed = await stakingHbbft.maxWithdrawAllowed(pool, delegatorAddress.address);

            await expect(stakingHbbft.connect(delegatorAddress).withdraw(pool, stakeAmount))
                .to.be.revertedWithCustomError(stakingHbbft, "MaxAllowedWithdrawExceeded")
                .withArgs(maxAllowed, stakeAmount);

            await expect(stakingHbbft.connect(delegatorAddress).withdraw(pool, restOfAmount + 1n))
                .to.be.revertedWithCustomError(stakingHbbft, "MaxAllowedWithdrawExceeded")
                .withArgs(maxAllowed, restOfAmount + 1n);

            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], restOfAmount);
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);
            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);
            expect(await stakingHbbft.orderedWithdrawAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(orderedAmount);
            expect(await stakingHbbft.poolDelegators(initialStakingAddresses[1])).to.be.empty;
            expect(await stakingHbbft.poolDelegatorsInactive(initialStakingAddresses[1])).to.be.deep.equal([delegatorAddress.address]);

            await helpers.stopImpersonatingAccount(systemSigner.address);
        });

        it('should decrease likelihood', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            let likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            expect(likelihoodInfo.sum).to.be.equal(0n);

            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });

            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            expect(likelihoodInfo.likelihoods[0]).to.be.equal(stakeAmount);
            expect(likelihoodInfo.sum).to.be.equal(stakeAmount);

            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[1])).withdraw(initialStakingAddresses[1], stakeAmount / 2n);

            likelihoodInfo = await stakingHbbft.getPoolsLikelihood();
            expect(likelihoodInfo.likelihoods[0]).to.be.equal(stakeAmount / 2n);
            expect(likelihoodInfo.sum).to.be.equal(stakeAmount / 2n);
        });
    });

    describe('recoverAbandonedStakes()', async () => {
        let stakingPool: HardhatEthersSigner;
        let stakers: HardhatEthersSigner[];

        beforeEach(async () => {
            stakingPool = await ethers.getSigner(initialStakingAddresses[0]);

            stakers = accounts.slice(7, 15);
        });

        async function stake(
            stakingContract: StakingHbbftMock,
            poolAddress: string,
            amount: bigint,
            stakers: HardhatEthersSigner[]
        ) {
            for (let staker of stakers) {
                expect(await stakingContract.connect(staker).stake(poolAddress, { value: amount }));
            }
        }

        async function setValidatorInactive(
            stakingContract: StakingHbbftMock,
            validatorSetContract: ValidatorSetHbbftMock,
            poolAddress: string
        ) {
            const validator = await validatorSetContract.miningByStakingAddress(poolAddress);

            expect(await validatorSetContract.setValidatorAvailableSince(validator, 0));
            expect(await stakingContract.addPoolInactiveMock(poolAddress));

            const poolsInactive = await stakingContract.getPoolsInactive();

            expect(poolsInactive).to.include(poolAddress);
        }

        it("should revert with invalid gas price", async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.recoverAbandonedStakes({ gasPrice: 0n }))
                .to.be.revertedWithCustomError(stakingHbbft, "ZeroGasPrice");
        });

        it("should revert if there is no inactive pools", async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.recoverAbandonedStakes())
                .to.be.revertedWithCustomError(stakingHbbft, "NoStakesToRecover");
        });

        it("should revert if validator inactive, but not abandonded", async () => {
            const {
                stakingHbbft,
                validatorSetHbbft,
                candidateMinStake,
                delegatorMinStake
            } = await helpers.loadFixture(deployContractsFixture);

            const expectedTotalStakes = candidateMinStake + delegatorMinStake * BigInt(stakers.length);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool])
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers);

            expect(await stakingHbbft.stakeAmountTotal(stakingPool.address)).to.be.equal(expectedTotalStakes);

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);
            expect(await validatorSetHbbft.isValidatorAbandoned(stakingPool.address)).to.be.false;

            await expect(stakingHbbft.recoverAbandonedStakes())
                .to.be.revertedWithCustomError(stakingHbbft, "NoStakesToRecover");
        });

        it("should recover abandoned stakes", async () => {
            const {
                stakingHbbft,
                validatorSetHbbft,
                blockRewardHbbft,
                candidateMinStake,
                delegatorMinStake
            } = await helpers.loadFixture(deployContractsFixture);

            await blockRewardHbbft.setGovernanceAddress(owner.address);

            const governanceAddress = await blockRewardHbbft.governancePotAddress();
            const reinsertAddress = await blockRewardHbbft.getAddress();

            expect(governanceAddress).to.equal(owner.address);

            const expectedTotalStakes = candidateMinStake + delegatorMinStake * BigInt(stakers.length);
            const caller = accounts[5];

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool])
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers);
            expect(await stakingHbbft.stakeAmountTotal(stakingPool.address)).to.be.equal(expectedTotalStakes);

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);
            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            expect(await validatorSetHbbft.isValidatorAbandoned(stakingPool.address)).to.be.true;

            const expectedGovernanceShare = expectedTotalStakes / 2n;
            const expectedReinsertShare = expectedTotalStakes - expectedGovernanceShare;

            const tx = stakingHbbft.connect(caller).recoverAbandonedStakes();

            await expect(tx)
                .to.emit(stakingHbbft, "GatherAbandonedStakes")
                .withArgs(caller.address, stakingPool.address, expectedTotalStakes)
                .and
                .to.emit(stakingHbbft, "RecoverAbandonedStakes")
                .withArgs(caller.address, expectedReinsertShare, expectedGovernanceShare)

            await expect(tx).to.changeEtherBalances(
                [await stakingHbbft.getAddress(), reinsertAddress, governanceAddress],
                [-expectedTotalStakes, expectedReinsertShare, expectedGovernanceShare]
            );

            expect(await stakingHbbft.stakeAmountTotal(stakingPool.address)).to.be.equal(0);
        });

        it("should recover abandoned stakes, mark pool as abandoned and remove from inactive pools", async () => {
            const {
                stakingHbbft,
                validatorSetHbbft,
                candidateMinStake,
                delegatorMinStake
            } = await helpers.loadFixture(deployContractsFixture);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool])
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers);

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            expect(await validatorSetHbbft.isValidatorAbandoned(stakingPool.address)).to.be.true;

            await expect(stakingHbbft.recoverAbandonedStakes())
                .to.emit(stakingHbbft, "RecoverAbandonedStakes");

            expect(await stakingHbbft.getPoolsInactive()).to.not.include(stakingPool.address);
            expect(await stakingHbbft.abandonedAndRemoved(stakingPool.address)).to.be.true;
        });

        it("should return maxWithdrawAllowed = 0 if pool was abandoned and removed", async () => {
            const {
                stakingHbbft,
                validatorSetHbbft,
                candidateMinStake,
                delegatorMinStake
            } = await helpers.loadFixture(deployContractsFixture);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool])
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers);

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            expect(await validatorSetHbbft.isValidatorAbandoned(stakingPool.address)).to.be.true;

            await expect(stakingHbbft.recoverAbandonedStakes())
                .to.emit(stakingHbbft, "RecoverAbandonedStakes");

            expect(await stakingHbbft.abandonedAndRemoved(stakingPool.address)).to.be.true;

            for (let staker of stakers) {
                expect(await stakingHbbft.maxWithdrawAllowed(stakingPool.address, staker.address)).to.equal(0);
            }
        });

        it("should disallow staking to abandoned pool", async () => {
            const {
                stakingHbbft,
                validatorSetHbbft,
                candidateMinStake,
                delegatorMinStake
            } = await helpers.loadFixture(deployContractsFixture);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool])
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers);

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            expect(await validatorSetHbbft.isValidatorAbandoned(stakingPool.address)).to.be.true;

            await expect(stakingHbbft.recoverAbandonedStakes())
                .to.emit(stakingHbbft, "RecoverAbandonedStakes");

            expect(await stakingHbbft.abandonedAndRemoved(stakingPool.address)).to.be.true;

            await expect(
                stakingHbbft.connect(stakers[0]).stake(stakingPool.address, { value: delegatorMinStake })
            ).to.be.revertedWithCustomError(stakingHbbft, "PoolAbandoned")
                .withArgs(stakingPool.address);
        });

        it("should not allow stake withdrawal if pool was abandoned", async () => {
            const {
                stakingHbbft,
                validatorSetHbbft,
                candidateMinStake,
                delegatorMinStake
            } = await helpers.loadFixture(deployContractsFixture);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool])
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers);

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            expect(await validatorSetHbbft.isValidatorAbandoned(stakingPool.address)).to.be.true;

            await expect(stakingHbbft.recoverAbandonedStakes())
                .to.emit(stakingHbbft, "RecoverAbandonedStakes");

            expect(await stakingHbbft.abandonedAndRemoved(stakingPool.address)).to.be.true;

            const staker = stakers[1];

            const maxAllowedWithraw = await stakingHbbft.maxWithdrawAllowed(stakingPool.address, staker.address);
            expect(maxAllowedWithraw).to.equal(0);

            await expect(
                stakingHbbft.connect(staker).withdraw(stakingPool.address, delegatorMinStake)
            ).to.be.revertedWithCustomError(stakingHbbft, "MaxAllowedWithdrawExceeded")
                .withArgs(maxAllowedWithraw, delegatorMinStake);
        });
    });

    describe('restake()', async () => {
        it('should allow calling only to BlockReward contract', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];
            await expect(stakingHbbft.connect(caller).restake(ethers.ZeroAddress, 0n))
                .to.be.revertedWithCustomError(stakingHbbft, "Unauthorized");
        });

        it('should do nothing if zero value provided', async () => {
            const { stakingHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = await impersonateAcc(await blockRewardHbbft.getAddress());

            await expect(stakingHbbft.connect(caller).restake(
                initialStakingAddresses[1],
                0n,
                { value: 0n }
            )).to.not.emit(stakingHbbft, "RestakeReward");
        });

        describe('without node operator', async () => {
            it('should restake all rewards to validator without delegators', async () => {
                const {
                    stakingHbbft,
                    blockRewardHbbft,
                    validatorSetHbbft,
                    candidateMinStake
                } = await helpers.loadFixture(deployContractsFixture);

                expect(await ethers.provider.getBalance(await blockRewardHbbft.getAddress())).to.be.equal(0n);

                for (let i = 0; i < initialStakingAddresses.length; ++i) {
                    const pool = await ethers.getSigner(initialStakingAddresses[i]);
                    const mining = await ethers.getSigner(initialValidators[i]);

                    await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });

                    const latestBlock = await ethers.provider.getBlock('latest');
                    await validatorSetHbbft.connect(mining).announceAvailability(latestBlock!.number, latestBlock!.hash!);

                    expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.eq(candidateMinStake);
                }

                let systemSigner = await impersonateAcc(SystemAccountAddress);

                await blockRewardHbbft.connect(systemSigner).reward(true);
                await blockRewardHbbft.connect(systemSigner).reward(true);

                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                const fixedEpochEndTime = await stakingHbbft.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const deltaPotValue = ethers.parseEther('50');
                await blockRewardHbbft.addToDeltaPot({ value: deltaPotValue });
                expect(await blockRewardHbbft.deltaPot()).to.be.equal(deltaPotValue);

                const validators = await validatorSetHbbft.getValidators();
                const potsShares = await blockRewardHbbft.getPotsShares(validators.length);

                const validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                const poolReward = validatorRewards / BigInt(validators.length);

                systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                for (let i = 0; i < initialStakingAddresses.length; ++i) {
                    const pool = await ethers.getSigner(initialStakingAddresses[i]);

                    expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.eq(candidateMinStake + poolReward);
                }
            });

            it('should restake delegators rewards according to stakes', async () => {
                const {
                    stakingHbbft,
                    blockRewardHbbft,
                    validatorSetHbbft,
                    candidateMinStake,
                } = await helpers.loadFixture(deployContractsFixture);

                expect(await ethers.provider.getBalance(await blockRewardHbbft.getAddress())).to.be.equal(0n);

                for (let i = 0; i < initialStakingAddresses.length; ++i) {
                    const pool = await ethers.getSigner(initialStakingAddresses[i]);
                    const mining = await ethers.getSigner(initialValidators[i]);

                    await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });

                    const latestBlock = await ethers.provider.getBlock('latest');
                    await validatorSetHbbft.connect(mining).announceAvailability(latestBlock!.number, latestBlock!.hash!);

                    expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.eq(candidateMinStake);
                }

                let systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                interface StakeRecord {
                    delegator: string;
                    pool: string;
                    stake: bigint;
                }

                const delegators = accounts.slice(15, 20);
                const stakeRecords = new Array<StakeRecord>();
                const poolTotalStakes = new Map<string, bigint>();

                for (const _pool of initialStakingAddresses) {
                    let _poolTotalStake = candidateMinStake;

                    // first delegator will stake minimum, 2nd = 2x, 3rd = 3x ....
                    let stake = BigInt(0);
                    for (const _delegator of delegators) {

                        stake += minStakeDelegators;
                        stakeRecords.push({ delegator: _delegator.address, pool: _pool, stake: stake });

                        _poolTotalStake += stake;

                        await stakingHbbft.connect(_delegator).stake(_pool, { value: stake });
                        expect(await stakingHbbft.stakeAmount(_pool, _delegator.address)).to.equal(stake);
                    }

                    poolTotalStakes.set(_pool, _poolTotalStake);

                    expect(await stakingHbbft.stakeAmountTotal(_pool)).to.be.eq(_poolTotalStake);
                }

                systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                const fixedEpochEndTime = await stakingHbbft.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const epoch = await stakingHbbft.stakingEpoch();

                const deltaPotValue = ethers.parseEther('10');
                await blockRewardHbbft.addToDeltaPot({ value: deltaPotValue });
                expect(await blockRewardHbbft.deltaPot()).to.be.equal(deltaPotValue);

                const validators = await validatorSetHbbft.getValidators();
                const potsShares = await blockRewardHbbft.getPotsShares(validators.length);

                const validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                const poolReward = validatorRewards / BigInt(validators.length);

                systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                const validatorFixedRewardPercent = await blockRewardHbbft.validatorMinRewardPercent(epoch);

                for (const _stakeRecord of stakeRecords) {
                    const validatorFixedReward = poolReward * validatorFixedRewardPercent / 100n;
                    const rewardsToDistribute = poolReward - validatorFixedReward;

                    const poolTotalStake = poolTotalStakes.get(_stakeRecord.pool)!;

                    const validatorShare = validatorFixedReward + rewardsToDistribute * candidateMinStake / poolTotalStake;
                    const delegatorShare = rewardsToDistribute * _stakeRecord.stake / poolTotalStake;

                    expect(
                        await stakingHbbft.stakeAmount(_stakeRecord.pool, _stakeRecord.pool)
                    ).to.be.closeTo(candidateMinStake + validatorShare, 100n);

                    expect(
                        await stakingHbbft.stakeAmount(_stakeRecord.pool, _stakeRecord.delegator)
                    ).to.be.closeTo(_stakeRecord.stake + delegatorShare, 100n);
                }
            });
        });

        describe('with node operator', async () => {
            it('should not distribute to node operator with 0% share', async () => {
                const {
                    stakingHbbft,
                    blockRewardHbbft,
                    validatorSetHbbft,
                    candidateMinStake
                } = await helpers.loadFixture(deployContractsFixture);

                expect(await ethers.provider.getBalance(await blockRewardHbbft.getAddress())).to.be.equal(0n);

                let poolOperators = new Map<HardhatEthersSigner, string>();

                for (let i = 0; i < initialStakingAddresses.length; ++i) {
                    const pool = await ethers.getSigner(initialStakingAddresses[i]);
                    const mining = await ethers.getSigner(initialValidators[i]);

                    await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });

                    const latestBlock = await ethers.provider.getBlock('latest');
                    await validatorSetHbbft.connect(mining).announceAvailability(latestBlock!.number, latestBlock!.hash!);

                    expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.eq(candidateMinStake);

                    poolOperators.set(pool, ethers.Wallet.createRandom().address);
                }

                let systemSigner = await impersonateAcc(SystemAccountAddress);

                await blockRewardHbbft.connect(systemSigner).reward(true);
                await blockRewardHbbft.connect(systemSigner).reward(true);

                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                for (let [pool, operator] of poolOperators) {
                    await stakingHbbft.connect(pool).setNodeOperator(operator, 0n);
                }

                const fixedEpochEndTime = await stakingHbbft.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const deltaPotValue = ethers.parseEther('50');
                await blockRewardHbbft.addToDeltaPot({ value: deltaPotValue });
                expect(await blockRewardHbbft.deltaPot()).to.be.equal(deltaPotValue);

                const validators = await validatorSetHbbft.getValidators();
                const potsShares = await blockRewardHbbft.getPotsShares(validators.length);

                const validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                const poolReward = validatorRewards / BigInt(validators.length);

                systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                for (let i = 0; i < initialStakingAddresses.length; ++i) {
                    const pool = await ethers.getSigner(initialStakingAddresses[i]);

                    expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.eq(candidateMinStake + poolReward);
                }
            });

            it('should include node operators in reward distribution', async () => {
                const {
                    stakingHbbft,
                    blockRewardHbbft,
                    validatorSetHbbft,
                    candidateMinStake
                } = await helpers.loadFixture(deployContractsFixture);

                interface NodeOperatorConfig {
                    operator: string;
                    share: bigint;
                }

                interface StakeRecord {
                    pool: HardhatEthersSigner;
                    delegator: string;
                    stake: bigint;
                }

                expect(await ethers.provider.getBalance(await blockRewardHbbft.getAddress())).to.be.equal(0n);

                let poolOperators = new Map<string, NodeOperatorConfig>();

                for (let i = 0; i < initialStakingAddresses.length; ++i) {
                    const pool = await ethers.getSigner(initialStakingAddresses[i]);
                    const mining = await ethers.getSigner(initialValidators[i]);

                    expect(await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake }));

                    const latestBlock = await ethers.provider.getBlock('latest');
                    await validatorSetHbbft.connect(mining).announceAvailability(latestBlock!.number, latestBlock!.hash!);

                    expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.eq(candidateMinStake);

                    poolOperators.set(
                        pool.address,
                        {
                            operator: ethers.Wallet.createRandom().address,
                            share: BigInt(200 * (i + 1)),
                        }
                    );
                }

                const delegators = accounts.slice(16, 21);
                const stakeRecords = new Array<StakeRecord>();
                const poolTotalStakes = new Map<string, bigint>();

                for (const _pool of initialStakingAddresses) {
                    let _poolTotalStake = candidateMinStake;

                    // first delegator will stake minimum, 2nd = 2x, 3rd = 3x ....
                    let stake = BigInt(0);
                    for (const _delegator of delegators) {

                        stake += minStakeDelegators;
                        stakeRecords.push({
                            delegator: _delegator.address,
                            pool: await ethers.getSigner(_pool),
                            stake: stake
                        });

                        _poolTotalStake += stake;

                        expect(await stakingHbbft.connect(_delegator).stake(_pool, { value: stake }));
                        expect(await stakingHbbft.stakeAmount(_pool, _delegator.address)).to.equal(stake);
                    }

                    poolTotalStakes.set(_pool, _poolTotalStake);

                    expect(await stakingHbbft.stakeAmountTotal(_pool)).to.be.eq(_poolTotalStake);
                }

                let systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                for (let [pool, cfg] of poolOperators) {
                    const poolSigner = await ethers.getSigner(pool);
                    expect(await stakingHbbft.connect(poolSigner).setNodeOperator(cfg.operator, cfg.share));
                }

                const fixedEpochEndTime = await stakingHbbft.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const deltaPotValue = ethers.parseEther('50');
                await blockRewardHbbft.addToDeltaPot({ value: deltaPotValue });
                expect(await blockRewardHbbft.deltaPot()).to.be.equal(deltaPotValue);

                const validators = await validatorSetHbbft.getValidators();
                const potsShares = await blockRewardHbbft.getPotsShares(validators.length);

                const validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                const poolReward = validatorRewards / BigInt(validators.length);

                const epoch = await stakingHbbft.stakingEpoch();
                const validatorFixedRewardPercent = await blockRewardHbbft.validatorMinRewardPercent(epoch);
                
                systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                for (const _stakeRecord of stakeRecords) {
                    const nodeOperatorCfg = poolOperators.get(_stakeRecord.pool.address)!;

                    const validatorFixedReward = poolReward * validatorFixedRewardPercent / 100n;
                    const rewardsToDistribute = poolReward - validatorFixedReward;
                    const nodeOperatorShare = poolReward * nodeOperatorCfg.share / 10000n;

                    const poolTotalStake = poolTotalStakes.get(_stakeRecord.pool.address)!;

                    const validatorShare = validatorFixedReward
                        - nodeOperatorShare
                        + rewardsToDistribute * candidateMinStake / poolTotalStake;
                    const delegatorShare = rewardsToDistribute * _stakeRecord.stake / poolTotalStake;
                    
                    expect(
                        await stakingHbbft.stakeAmount(_stakeRecord.pool.address, _stakeRecord.pool.address)
                    ).to.be.closeTo(candidateMinStake + validatorShare, 100n);

                    expect(
                        await stakingHbbft.stakeAmount(_stakeRecord.pool.address, _stakeRecord.delegator)
                    ).to.be.closeTo(_stakeRecord.stake + delegatorShare, 100n);

                    expect(
                        await stakingHbbft.stakeAmount(_stakeRecord.pool.address, nodeOperatorCfg.operator)
                    ).to.be.equal(nodeOperatorShare);
                }
            });

            it('should send operator share to new address if it was changed', async () => {
                const {
                    stakingHbbft,
                    blockRewardHbbft,
                    validatorSetHbbft,
                    candidateMinStake
                } = await helpers.loadFixture(deployContractsFixture);

                expect(await ethers.provider.getBalance(await blockRewardHbbft.getAddress())).to.be.equal(0n);

                const pool = await ethers.getSigner(initialStakingAddresses[0]);
                const mining = await ethers.getSigner(initialValidators[0]);
                const nodeOperator = ethers.Wallet.createRandom().address;
                const nodeOperatorShare = 2000n;

                await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
                const latestBlock = await ethers.provider.getBlock('latest');
                await validatorSetHbbft.connect(mining).announceAvailability(latestBlock!.number, latestBlock!.hash!);
                expect(await stakingHbbft.stakeAmountTotal(pool.address)).to.be.eq(candidateMinStake);

                let systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                // set node operator
                await stakingHbbft.connect(pool).setNodeOperator(nodeOperator, nodeOperatorShare);

                const fixedEpochEndTime = await stakingHbbft.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const deltaPotValue = ethers.parseEther('50');
                await blockRewardHbbft.addToDeltaPot({ value: deltaPotValue });
                expect(await blockRewardHbbft.deltaPot()).to.be.equal(deltaPotValue);

                const validators = await validatorSetHbbft.getValidators();
                let potsShares = await blockRewardHbbft.getPotsShares(validators.length);

                let validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                let poolReward = validatorRewards;

                let poolTotalStake = await stakingHbbft.stakeAmountTotal(pool.address);

                // distribute epoch rewards, so node operator will get shares
                systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                // node operator should get all of the fixed validator rewards;
                let expectedOperatorStake = poolReward * nodeOperatorShare / 10000n;
                let expectedValidatorStake = candidateMinStake + (poolReward - expectedOperatorStake) * candidateMinStake / poolTotalStake;

                expect(await stakingHbbft.stakeAmount(pool.address, nodeOperator)).to.equal(expectedOperatorStake);
                expect(await stakingHbbft.stakeAmount(pool.address, pool.address)).to.equal(expectedValidatorStake);

                const newOperator = ethers.Wallet.createRandom();
                const oldOperatorStake = await stakingHbbft.stakeAmount(pool.address, nodeOperator);
                const prevValidatorStake = await stakingHbbft.stakeAmount(pool.address, pool.address);

                await stakingHbbft.connect(pool).setNodeOperator(newOperator, nodeOperatorShare);

                systemSigner = await impersonateAcc(SystemAccountAddress);
                await blockRewardHbbft.connect(systemSigner).reward(true);
                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                potsShares = await blockRewardHbbft.getPotsShares(validators.length);
                validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                poolReward = validatorRewards;

                poolTotalStake = await stakingHbbft.stakeAmountTotal(pool.address);

                const newOperatorStake = poolReward * nodeOperatorShare / 10000n;
                const expectedOldOperatorStake = oldOperatorStake + (poolReward - newOperatorStake) * oldOperatorStake / poolTotalStake;
                expectedValidatorStake = prevValidatorStake + (poolReward - newOperatorStake) * prevValidatorStake / poolTotalStake;

                expect(await stakingHbbft.stakeAmount(pool.address, newOperator)).to.equal(newOperatorStake);
                expect(await stakingHbbft.stakeAmount(pool.address, nodeOperator)).to.equal(expectedOldOperatorStake);
                expect(await stakingHbbft.stakeAmount(pool.address, pool.address)).to.equal(expectedValidatorStake);
            });
        });
    });

    describe('setStakingTransitionTimeframeLength()', async () => {
        it('should allow calling only to contract owner', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];
            await expect(stakingHbbft.connect(caller).setStakingTransitionTimeframeLength(300n))
                .to.be.revertedWithCustomError(stakingHbbft, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should set staking transition time frame length', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.setStakingTransitionTimeframeLength(300n);
            expect(await stakingHbbft.stakingTransitionTimeframeLength()).to.be.equal(300n);
        });

        it('should not set staking transition time frame length to low value', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.setStakingTransitionTimeframeLength(9n))
                .to.be.revertedWithCustomError(stakingHbbft, "InvalidStakingTransitionTimeframe");
        });

        it('should not set staking transition time frame length to high value', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.setStakingTransitionTimeframeLength(100000n))
                .to.be.revertedWithCustomError(stakingHbbft, "InvalidStakingTransitionTimeframe");
        });

    });

    describe('setStakingFixedEpochDuration()', async () => {
        it('should allow calling only to contract owner', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];
            await expect(stakingHbbft.connect(caller).setStakingFixedEpochDuration(600000n))
                .to.be.revertedWithCustomError(stakingHbbft, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should set staking fixed epoch transition', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.setStakingFixedEpochDuration(600000n);
            expect(await stakingHbbft.stakingFixedEpochDuration()).to.be.equal(600000n);
        });

        it('should not set staking transition time frame length to low value', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            let tranitionTimeFrame = await stakingHbbft.stakingTransitionTimeframeLength();
            await expect(stakingHbbft.setStakingFixedEpochDuration(tranitionTimeFrame))
                .to.be.revertedWithCustomError(stakingHbbft, "InvalidStakingFixedEpochDuration");
        });
    });

    describe('setDelegatorMinStake()', async () => {
        it('should allow calling only to contract owner', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];
            await expect(stakingHbbft.connect(caller).setDelegatorMinStake(ethers.parseEther('10')))
                .to.be.revertedWithCustomError(stakingHbbft, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should set delegator min stake', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const minStakeValue = ethers.parseEther('150')
            await stakingHbbft.setDelegatorMinStake(minStakeValue);
            expect(await stakingHbbft.delegatorMinStake()).to.be.equal(minStakeValue);
        });
    });

    describe('snapshotPoolStakeAmounts()', async () => {
        it('should allow calling only by BlockReward contract', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];
            await expect(stakingHbbft.connect(caller).snapshotPoolStakeAmounts(0n, initialStakingAddresses[1]))
                .to.be.revertedWithCustomError(stakingHbbft, "Unauthorized");
        });

        it('should create validator stake snapshot after epoch close', async () => {
            const {
                stakingHbbft,
                blockRewardHbbft,
                candidateMinStake,
                delegatorMinStake
            } = await helpers.loadFixture(deployContractsFixture);

            const delegator = accounts[10];

            let stakingEpoch = await stakingHbbft.stakingEpoch();
            for (let i = 0; i < initialStakingAddresses.length; ++i) {
                const pool = await ethers.getSigner(initialStakingAddresses[i]);
                const stakeAmount = BigInt(i + 1) * delegatorMinStake;

                await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });

                await stakingHbbft.connect(delegator).stake(pool, { value: stakeAmount });
                expect(await stakingHbbft.stakeAmountTotal(pool)).to.be.equal(candidateMinStake + stakeAmount);
                expect(await stakingHbbft.snapshotPoolTotalStakeAmount(stakingEpoch, pool)).to.be.eq(0n);
                expect(await stakingHbbft.snapshotPoolValidatorStakeAmount(stakingEpoch, pool.address)).to.be.eq(0n);
            }

            await callReward(blockRewardHbbft, true);
            stakingEpoch = await stakingHbbft.stakingEpoch();

            for (let i = 0; i < initialStakingAddresses.length; ++i) {
                const pool = await ethers.getSigner(initialStakingAddresses[i]);
                const stakeAmount = BigInt(i + 1) * delegatorMinStake;

                expect(await stakingHbbft.stakeAmountTotal(pool)).to.be.equal(candidateMinStake + stakeAmount);
                expect(await stakingHbbft.snapshotPoolTotalStakeAmount(stakingEpoch, pool)).to.be.eq(candidateMinStake + stakeAmount);
                expect(await stakingHbbft.getPoolValidatorStakeAmount(stakingEpoch, pool.address)).to.be.eq(candidateMinStake);
            }
        });
    });

    describe('other functions', async () => {
        it('should restrict calling notifyKeyGenFailed to validator set contract', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await expect(stakingHbbft.connect(caller).notifyKeyGenFailed())
                .to.be.revertedWithCustomError(stakingHbbft, "Unauthorized");
        });

        it('should restrict calling notifyNetworkOfftimeDetected to validator set contract', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await expect(stakingHbbft.connect(caller).notifyNetworkOfftimeDetected(0n))
                .to.be.revertedWithCustomError(stakingHbbft, "Unauthorized");
        });

        it('should restrict calling notifyAvailability to validator set contract', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await expect(stakingHbbft.connect(caller).notifyAvailability(initialStakingAddresses[1]))
                .to.be.revertedWithCustomError(stakingHbbft, "Unauthorized");
        });

        it('should restrict calling setStakingEpochStartTime to validator set contract', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await expect(stakingHbbft.connect(caller).setStakingEpochStartTime(0n))
                .to.be.revertedWithCustomError(stakingHbbft, "Unauthorized");
        });

        it('should restrict calling setValidatorInternetAddress to validator set contract', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await expect(stakingHbbft.connect(caller).setValidatorInternetAddress(
                ethers.ZeroAddress,
                ZeroIpAddress,
                '0x6987',
            )).to.be.revertedWithCustomError(stakingHbbft, "Unauthorized");
        });

        it('should update validator ip:port using setValidatorInternetAddress', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[1];
            const ipAddress = ethers.zeroPadBytes("0xfe", 16);
            const port = '0x6987';

            const validatorSetSigner = await impersonateAcc(await validatorSetHbbft.getAddress());
            expect(await stakingHbbft.connect(validatorSetSigner).setValidatorInternetAddress(validator, ipAddress, port));
            await helpers.stopImpersonatingAccount(validatorSetSigner.address);

            const poolInfo = await stakingHbbft.poolInfo(validator);
            expect(poolInfo.internetAddress).to.equal(ipAddress);
            expect(poolInfo.port).to.equal(port);
        });

        it('should update own pool info using setPoolInfo', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = await ethers.getSigner(initialValidators[1]);
            const publicKey = ethers.zeroPadBytes("0xdeadbeef", 64);
            const ipAddress = ethers.zeroPadBytes("0xfe", 16);
            const port = '0x6987';

            expect(await stakingHbbft.connect(validator).setPoolInfo(
                publicKey,
                ipAddress,
                port,
            ));

            const poolInfo = await stakingHbbft.poolInfo(validator);
            expect(poolInfo.publicKey).to.equal(publicKey);
            expect(poolInfo.internetAddress).to.equal(ipAddress);
            expect(poolInfo.port).to.equal(port);
        });
    });

    async function callReward(blockRewardContract: BlockRewardHbbftMock, isEpochEndBlock: boolean) {
        const systemSigner = await impersonateAcc(SystemAccountAddress);

        const tx = await blockRewardContract.connect(systemSigner).reward(isEpochEndBlock);
        const receipt = await tx.wait();

        await helpers.stopImpersonatingAccount(SystemAccountAddress);

        if (receipt!.logs.length > 0) {
            // Emulate minting native coins
            const event = blockRewardContract.interface.parseLog(receipt!.logs[0]);

            expect(event!.name).to.be.equal("CoinsRewarded");

            const totalReward = event!.args.rewards;
            await blockRewardContract.connect(owner).sendCoins({ value: totalReward });
        }
    }

    // time travels forward to the beginning of the next transition,
    // and simulate a block mining (calling reward())
    async function timeTravelToTransition(
        blockRewardContract: BlockRewardHbbftMock,
        stakingContract: StakingHbbftMock
    ) {
        let startTimeOfNextPhaseTransition = await stakingContract.startTimeOfNextPhaseTransition();

        await helpers.time.increaseTo(startTimeOfNextPhaseTransition);
        await callReward(blockRewardContract, false);
    }

    async function timeTravelToEndEpoch(
        blockRewardContract: BlockRewardHbbftMock,
        stakingContract: StakingHbbftMock
    ) {
        const tsBeforeTimeTravel = await helpers.time.latest();
        const endTimeOfCurrentEpoch = await stakingContract.stakingFixedEpochEndTime();
        // console.log('tsBefore:', tsBeforeTimeTravel.toString());
        // console.log('endTimeOfCurrentEpoch:', endTimeOfCurrentEpoch.toString());

        if (endTimeOfCurrentEpoch < tsBeforeTimeTravel) {
            console.error('Trying to timetravel back in time !!');
        }

        await helpers.time.increaseTo(endTimeOfCurrentEpoch);
        await callReward(blockRewardContract, true);
    }
});

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

