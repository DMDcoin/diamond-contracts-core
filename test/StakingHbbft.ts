import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import {
    BlockRewardHbbftMock,
    RandomHbbft,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    KeyGenHistory,
} from "../src/types";

import { getNValidatorsPartNAcks } from "./testhelpers/data";

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

    const minStake = ethers.parseEther('1');
    const maxStake = ethers.parseEther('100000');

    // the reward for the first epoch.
    const epochReward = ethers.parseEther('1');

    // one epoch in 1 day.
    const stakingFixedEpochDuration = 86400n;

    // the transition time window is 1 hour.
    const stakingTransitionTimeframeLength = 3600n;
    const stakingWithdrawDisallowPeriod = 1n;

    // the amount the deltaPot gets filled up.
    // this is 60-times more, since the deltaPot get's
    // drained each step by 60 by default.
    const deltaPotFillupValue = epochReward * 60n;

    const validatorInactivityThreshold = 365n * 86400n // 1 year

    async function impersonateSystemAcc() {
        await helpers.impersonateAccount(SystemAccountAddress);

        await owner.sendTransaction({
            to: SystemAccountAddress,
            value: ethers.parseEther('10'),
        });

        return await ethers.getSigner(SystemAccountAddress);
    }

    async function deployContractsFixture() {
        const stubAddress = owner.address;

        const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbftMock");
        const connectivityTracker = await ConnectivityTrackerFactory.deploy();
        await connectivityTracker.waitForDeployment();

        // Deploy ValidatorSet contract
        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbftProxy = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                stubAddress,                  // _blockRewardContract
                stubAddress,                  // _randomContract
                stubAddress,                  // _stakingContract
                stubAddress,                  // _keyGenHistoryContract
                validatorInactivityThreshold, // _validatorInactivityThreshold
                initialValidators,            // _initialMiningAddresses
                initialStakingAddresses,      // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        );

        await validatorSetHbbftProxy.waitForDeployment();

        // Deploy BlockRewardHbbft contract
        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        const blockRewardHbbftProxy = await upgrades.deployProxy(
            BlockRewardHbbftFactory,
            [
                owner.address,
                await validatorSetHbbftProxy.getAddress(),
                await connectivityTracker.getAddress(),
            ],
            { initializer: 'initialize' }
        );

        await blockRewardHbbftProxy.waitForDeployment();

        await validatorSetHbbftProxy.setBlockRewardContract(await blockRewardHbbftProxy.getAddress());

        const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
        const randomHbbftProxy = await upgrades.deployProxy(
            RandomHbbftFactory,
            [
                owner.address,
                await validatorSetHbbftProxy.getAddress()
            ],
            { initializer: 'initialize' }
        );

        await randomHbbftProxy.waitForDeployment();

        //without that, the Time is 0,
        //meaning a lot of checks that expect time to have some value deliver incorrect results.
        // await increaseTime(1);

        const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

        const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
        const keyGenHistoryProxy = await upgrades.deployProxy(
            KeyGenFactory,
            [
                owner.address,
                await validatorSetHbbftProxy.getAddress(),
                initialValidators,
                parts,
                acks
            ],
            { initializer: 'initialize' }
        );

        await keyGenHistoryProxy.waitForDeployment();

        let stakingParams = {
            _validatorSetContract: await validatorSetHbbftProxy.getAddress(),
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: minStake,
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
        const stakingHbbftProxy = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                stakingParams,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ],
            { initializer: 'initialize' }
        );

        await stakingHbbftProxy.waitForDeployment();

        await validatorSetHbbftProxy.setRandomContract(await randomHbbftProxy.getAddress());
        await validatorSetHbbftProxy.setStakingContract(await stakingHbbftProxy.getAddress());
        await validatorSetHbbftProxy.setKeyGenHistoryContract(await keyGenHistoryProxy.getAddress());

        const validatorSetHbbft = ValidatorSetFactory.attach(
            await validatorSetHbbftProxy.getAddress()
        ) as ValidatorSetHbbftMock;

        const stakingHbbft = StakingHbbftFactory.attach(
            await stakingHbbftProxy.getAddress()
        ) as StakingHbbftMock;

        const blockRewardHbbft = BlockRewardHbbftFactory.attach(
            await blockRewardHbbftProxy.getAddress()
        ) as BlockRewardHbbftMock;

        const delegatorMinStake = await stakingHbbft.delegatorMinStake();
        const candidateMinStake = await stakingHbbft.candidateMinStake();

        const randomHbbft = RandomHbbftFactory.attach(await randomHbbftProxy.getAddress()) as RandomHbbft;
        const keyGenHistory = KeyGenFactory.attach(await keyGenHistoryProxy.getAddress()) as KeyGenHistory;

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
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.true;
        });

        it('should fail if created with overstaked pool', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.false;

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: maxStake + minStake }
            )).to.be.revertedWith('stake limit has been exceeded');
        });

        it('should fail if mining address is 0', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                ethers.ZeroAddress,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Mining address can't be 0");
        });

        it('should fail if mining address is equal to staking', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateStakingAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Mining address cannot be the same as the staking one");
        });

        it('should fail if the pool with the same mining/staking address is already existing', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const candidateMiningAddress2 = accounts[9];
            const candidateStakingAddress2 = accounts[10];

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            await expect(stakingHbbft.connect(candidateStakingAddress2).addPool(
                candidateMiningAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Mining address already used as a mining one");

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress2.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Staking address already used as a staking one");

            await expect(stakingHbbft.connect(candidateMiningAddress2).addPool(
                candidateStakingAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Mining address already used as a staking one");

            await expect(stakingHbbft.connect(candidateMiningAddress).addPool(
                candidateStakingAddress2.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Staking address already used as a mining one");

            await expect(stakingHbbft.connect(candidateMiningAddress2).addPool(
                candidateMiningAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Mining address already used as a mining one");

            await expect(stakingHbbft.connect(candidateMiningAddress).addPool(
                candidateMiningAddress2.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Staking address already used as a mining one");

            await expect(stakingHbbft.connect(candidateStakingAddress2).addPool(
                candidateStakingAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Mining address already used as a staking one");

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateStakingAddress2.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("Staking address already used as a staking one");

            expect(await stakingHbbft.connect(candidateStakingAddress2).addPool(
                candidateMiningAddress2.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            ));
        });

        it('should fail if gasPrice is 0', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { gasPrice: 0, value: minStake }
            )).to.be.revertedWith("GasPrice is 0");
        });

        it('should fail if staking amount is 0', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: 0n }
            )).to.be.revertedWith("Stake: stakingAmount is 0");
        });

        // it('should fail if stacking time is inside disallowed range', async () => {
        //   await stakingHbbft.addPool(candidateMiningAddress.address, ZeroPublicKey,
        //   ZeroIpAddress, {connect(candidateStakingAddress).value: minStake}).to.be.rejectedWith("Stake: disallowed period");
        //   await increaseTime(2);
        //   await stakingHbbft.addPool(candidateMiningAddress.address, ZeroPublicKey,
        //   ZeroIpAddress, {connect(candidateStakingAddress).value: minStake});
        // });

        it('should fail if staking amount is less than CANDIDATE_MIN_STAKE', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake / 2n }
            )).to.be.revertedWith("Stake: candidateStake less than candidateMinStake");
        });

        it('stake amount should be increased', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const amount = minStake * 2n;
            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
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
                ZeroPublicKey,
                ZeroIpAddress,
                { value: amount1 }
            );

            await stakingHbbft.connect(candidate2StakingAddress).addPool(
                candidate2MiningAddress.address,
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

            for (let i = initialValidators.length; i < 100; ++i) {
                // Add a new pool
                await stakingHbbft.addPoolActiveMock(candidateStakingAddress);
            }

            // Try to add a new pool outside of max limit, max limit is 100 in mock contract.
            await expect(stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            )).to.be.revertedWith("MAX_CANDIDATES pools exceeded");

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.false;
        });

        it('should remove added pool from the list of inactive pools', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.addPoolInactiveMock(candidateStakingAddress.address);
            expect(await stakingHbbft.getPoolsInactive()).to.be.deep.equal([candidateStakingAddress.address]);

            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
                ZeroPublicKey,
                ZeroIpAddress,
                { value: minStake }
            );

            expect(await stakingHbbft.isPoolActive(candidateStakingAddress.address)).to.be.true;
            expect(await stakingHbbft.getPoolsInactive()).to.be.empty;
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
                .to.be.revertedWith("Not payable");

            await owner.sendTransaction({ to: accounts[1].address, value: 1n });
            expect(await ethers.provider.getBalance(await stakingHbbft.getAddress())).to.be.equal(0n);
        });

        it('can be increased by sending coins to payable functions', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await ethers.provider.getBalance(await stakingHbbft.getAddress())).to.be.equal(0n);
            await stakingHbbft.connect(candidateStakingAddress).addPool(
                candidateMiningAddress.address,
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

    describe('claimReward()', async () => {
        let delegator: HardhatEthersSigner;
        let delegatorMinStake: bigint;

        let stakingHbbftContract: StakingHbbftMock;
        let validatorSetContract: ValidatorSetHbbftMock;
        let blockRewardContract: BlockRewardHbbftMock;

        beforeEach(async () => {
            const { stakingHbbft, validatorSetHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContractsFixture);

            stakingHbbftContract = stakingHbbft;
            validatorSetContract = validatorSetHbbft;
            blockRewardContract = blockRewardHbbft;

            // Staking epoch #0 starts on block #1
            expect(await stakingHbbft.stakingEpoch()).to.be.equal(0n);
            //(await stakingHbbft.stakingEpochStartBlock()).to.be.equal( 1));
            //(await validatorSetHbbft.getCurrentBlockNumber()).to.be.equal( 1));
            //(await stakingHbbft.getCurrentBlockNumber()).to.be.equal( 1));

            // Validators place stakes during the epoch #0
            const candidateMinStake = await stakingHbbft.candidateMinStake();
            for (let i = 0; i < initialStakingAddresses.length; i++) {
                // Validator places stake on themselves
                await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[i])).stake(
                    initialStakingAddresses[i],
                    { value: candidateMinStake }
                );
            }

            // The delegator places stake on the first validator
            delegator = accounts[10];
            delegatorMinStake = await stakingHbbft.delegatorMinStake();
            await stakingHbbft.connect(delegator).stake(initialStakingAddresses[0], { value: delegatorMinStake });

            // Epoch's fixed duration ends
            //const stakingFixedEpochEndBlock = await stakingHbbft.stakingFixedEpochEndBlock();

            await timeTravelToTransition(blockRewardContract, stakingHbbftContract);

            // the pending validator set should be updated
            expect(await validatorSetHbbft.getPendingValidators()).to.be.lengthOf(3);

            // Staking epoch #0 finishes
            //const stakingEpochEndBlock = stakingFixedEpochEndBlock + keyGenerationDuration);

            await timeTravelToEndEpoch(blockRewardContract, stakingHbbftContract);
            expect(await stakingHbbft.stakingEpoch()).to.be.equal(1n);
        });

        async function _claimRewardStakeIncreasing(epochsPoolRewarded: number[], epochsStakeIncreased: number[]) {
            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];
            const epochPoolReward = ethers.parseEther('1');

            const maxStakingEpoch = Math.max(
                Math.max.apply(null, epochsPoolRewarded),
                Math.max.apply(null, epochsStakeIncreased)
            );

            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(0n);

            // Emulate rewards for the pool
            for (let i = 0; i < epochsPoolRewarded.length; i++) {
                const stakingEpoch = epochsPoolRewarded[i];
                await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            }

            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress()))
                .to.be.equal(epochPoolReward * BigInt(epochsPoolRewarded.length));

            let prevStakingEpoch = 0;
            const validatorStakeAmount = await stakingHbbftContract.stakeAmount(stakingAddress, stakingAddress);

            let stakeAmount = await stakingHbbftContract.stakeAmount(stakingAddress, delegator.address);
            let stakeAmountOnEpoch = [0n];

            let s = 0;
            for (let epoch = 1; epoch <= maxStakingEpoch; epoch++) {
                const stakingEpoch = epochsStakeIncreased[s];

                if (stakingEpoch == epoch) {
                    const startBlock = BigInt(120954 * stakingEpoch + 1);

                    await stakingHbbftContract.setStakingEpoch(stakingEpoch);
                    await stakingHbbftContract.setValidatorMockSetAddress(owner.address);

                    //await stakingHbbft.setStakingEpochStartBlock(startBlock);
                    await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());

                    // Emulate delegator's stake increasing
                    await stakingHbbftContract.connect(delegator).stake(stakingAddress, { value: delegatorMinStake });

                    for (let e = prevStakingEpoch + 1; e <= stakingEpoch; e++) {
                        stakeAmountOnEpoch[e] = stakeAmount;
                    }

                    stakeAmount = await stakingHbbftContract.stakeAmount(stakingAddress, delegator.address);
                    prevStakingEpoch = stakingEpoch;
                    s++;
                }

                // Emulate snapshotting for the pool
                await blockRewardContract.snapshotPoolStakeAmounts(
                    await stakingHbbftContract.getAddress(),
                    epoch + 1,
                    miningAddress
                );
            }

            const lastEpochRewarded = epochsPoolRewarded[epochsPoolRewarded.length - 1];
            await stakingHbbftContract.setStakingEpoch(lastEpochRewarded + 1);

            if (prevStakingEpoch < lastEpochRewarded) {
                for (let e = prevStakingEpoch + 1; e <= lastEpochRewarded; e++) {
                    stakeAmountOnEpoch[e] = stakeAmount;
                }
            }

            let delegatorRewardExpected = 0n;
            let validatorRewardExpected = 0n;

            for (let i = 0; i < epochsPoolRewarded.length; i++) {
                const stakingEpoch = epochsPoolRewarded[i];

                await blockRewardContract.setValidatorMinRewardPercent(stakingEpoch, 30);
                const delegatorShare = await blockRewardContract.delegatorShare(
                    stakingEpoch,
                    stakeAmountOnEpoch[stakingEpoch],
                    validatorStakeAmount,
                    validatorStakeAmount + stakeAmountOnEpoch[stakingEpoch],
                    epochPoolReward
                );

                const validatorShare = await blockRewardContract.validatorShare(
                    stakingEpoch,
                    validatorStakeAmount,
                    validatorStakeAmount + stakeAmountOnEpoch[stakingEpoch],
                    epochPoolReward
                );

                delegatorRewardExpected = delegatorRewardExpected + delegatorShare;
                validatorRewardExpected = validatorRewardExpected + validatorShare
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

            const epochPoolReward = ethers.parseEther('1');
            const deltaPotFillupValue = epochPoolReward * 60n;

            await blockRewardContract.addToDeltaPot({ value: deltaPotFillupValue });

            // the beforeeach  alsready runs 1 epoch, so we expect to be in epoch 1 here.
            expect(await stakingHbbftContract.stakingEpoch()).to.be.equal(1n);

            //await timeTravelToEndEpoch(blockRewardContract, stakingHbbftContract);
            //(await stakingHbbft.stakingEpoch()).to.be.equal( 2));

            // the pending validator set should be empy
            expect(await validatorSetContract.getPendingValidators()).to.be.empty;

            // Staking epoch #1: Start
            expect(await validatorSetContract.getValidators()).to.be.deep.equal(initialValidators);
            expect(await stakingHbbftContract.areStakeAndWithdrawAllowed()).to.be.true;
            await stakingHbbftContract.connect(delegator).orderWithdraw(stakingAddress, delegatorMinStake);

            expect(await validatorSetContract.getPendingValidators()).to.be.empty;

            // Staking epoch #1: start of Transition Phase!
            await timeTravelToTransition(blockRewardContract, stakingHbbftContract);

            // the pending validator set should be updated
            expect(await validatorSetContract.getPendingValidators()).to.be.lengthOf(3);

            //!!! here it failes for some reason
            //Staking epoch #1: Epoch end block
            await timeTravelToEndEpoch(blockRewardContract, stakingHbbftContract);

            // we restock this one epoch reward that got payed out.
            // todo: think about: Maybe this restocking should happen in the timeTravelToEndEpoch function to have
            // constant epoch payouts.
            await blockRewardContract.addToDeltaPot({ value: epochPoolReward });

            // now epoch #2 has started.
            expect(await stakingHbbftContract.stakingEpoch()).to.be.equal(2n);

            // the pending validator set should be empty
            expect(await validatorSetContract.getPendingValidators()).to.be.empty;

            // epoch #2: the delegator withdraws their stake
            await stakingHbbftContract.connect(delegator).claimOrderedWithdraw(stakingAddress);

            expect(await stakingHbbftContract.stakeAmount(stakingAddress, delegator.address)).to.be.equal(0n);
            expect(await stakingHbbftContract.orderedWithdrawAmount(stakingAddress, delegator.address)).to.be.equal(0n);
            expect(await stakingHbbftContract.stakeFirstEpoch(stakingAddress, delegator.address)).to.be.equal(1n);
            expect(await stakingHbbftContract.stakeLastEpoch(stakingAddress, delegator.address)).to.be.equal(2n);

            await stakingHbbftContract.setStakeFirstEpoch(stakingAddress, delegator.address, 0n);
            await stakingHbbftContract.setStakeLastEpoch(stakingAddress, delegator.address, 0n);
            await stakingHbbftContract.clearDelegatorStakeSnapshot(stakingAddress, delegator.address, 1n);
            await stakingHbbftContract.clearDelegatorStakeSnapshot(stakingAddress, delegator.address, 2n);

            // Staking epoch #2: end of fixed duration
            await timeTravelToTransition(blockRewardContract, stakingHbbftContract);

            // Staking epoch #2: Epoch end block
            await timeTravelToEndEpoch(blockRewardContract, stakingHbbftContract);

            expect(await stakingHbbftContract.stakingEpoch()).to.be.equal(3n);

            //(await stakingHbbft.stakingEpochStartBlock()).to.be.equal(stakingEpochEndBlock +  1)));
            return { miningAddress, stakingAddress, epochPoolReward };
        }

        async function testClaimRewardRandom(epochsPoolRewarded: number[], epochsStakeIncreased: number[]) {
            const {
                stakingAddress,
                epochPoolReward,
                delegatorRewardExpected,
                validatorRewardExpected
            } = await _claimRewardStakeIncreasing(
                epochsPoolRewarded,
                epochsStakeIncreased
            );

            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);

            let weiSpent = 0n;
            let epochsPoolRewardedRandom = epochsPoolRewarded;

            shuffle(epochsPoolRewardedRandom);

            for (let i = 0; i < epochsPoolRewardedRandom.length; i++) {
                const stakingEpoch = epochsPoolRewardedRandom[i];

                let result = await stakingHbbftContract.connect(delegator).claimReward([stakingEpoch], stakingAddress);
                let receipt = await ethers.provider.getTransactionReceipt(result.hash);

                weiSpent += receipt!.gasUsed * result.gasPrice;

                // Call once again to ensure the reward cannot be withdrawn twice
                result = await stakingHbbftContract.connect(delegator).claimReward([stakingEpoch], stakingAddress);
                receipt = await ethers.provider.getTransactionReceipt(result.hash);

                weiSpent += receipt!.gasUsed * result.gasPrice;
            }

            expect(await ethers.provider.getBalance(delegator.address)).to.be.equal(
                delegatorCoinsBalanceBefore + delegatorRewardExpected - weiSpent
            );

            const validatorCoinsBalanceBefore = await ethers.provider.getBalance(stakingAddress);

            weiSpent = 0n;
            shuffle(epochsPoolRewardedRandom);

            for (let i = 0; i < epochsPoolRewardedRandom.length; i++) {
                const stakingEpoch = epochsPoolRewardedRandom[i];
                const result = await stakingHbbftContract.connect(await ethers.getSigner(stakingAddress))
                    .claimReward([stakingEpoch], stakingAddress);

                let receipt = await ethers.provider.getTransactionReceipt(result.hash);

                weiSpent += receipt!.gasUsed * result.gasPrice;
            }

            expect(await ethers.provider.getBalance(stakingAddress)).to.be.equal(
                validatorCoinsBalanceBefore + validatorRewardExpected - weiSpent
            );

            const blockRewardBalanceExpected = epochPoolReward * BigInt(epochsPoolRewarded.length)
                - delegatorRewardExpected - validatorRewardExpected;

            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(blockRewardBalanceExpected);
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

            let rewardAmountsCalculated = await stakingHbbftContract.getRewardAmount([], stakingAddress, delegator.address);
            expect(rewardAmountsCalculated).to.be.equal(delegatorRewardExpected);

            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
            const result = await stakingHbbftContract.connect(delegator).claimReward([], stakingAddress);
            const receipt = await result.wait();
            const weiSpent = receipt!.gasUsed * result.gasPrice;

            const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);

            expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore + delegatorRewardExpected - weiSpent);
            expect(await stakingHbbftContract.getRewardAmount([], stakingAddress, stakingAddress)).to.be.equal(validatorRewardExpected);

            await stakingHbbftContract.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);

            const blockRewardBalanceExpected = epochPoolReward * BigInt(epochsPoolRewarded.length)
                - delegatorRewardExpected - validatorRewardExpected;

            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(blockRewardBalanceExpected);
        }

        async function testClaimRewardAfterStakeMovements(epochsPoolRewarded: number[], epochsStakeMovement: number[]) {
            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];
            const epochPoolReward = ethers.parseEther('1');

            const deltaPotFillupValue = epochPoolReward * 60n;

            await blockRewardContract.addToDeltaPot({ value: deltaPotFillupValue });

            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(deltaPotFillupValue);

            for (let i = 0; i < epochsPoolRewarded.length; i++) {
                const stakingEpoch = epochsPoolRewarded[i];

                // Emulate snapshotting for the pool
                await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch, miningAddress);

                // Emulate rewards for the pool
                await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            }

            // initial validator got reward for epochsPoolRewarded
            expect(await blockRewardContract.epochsPoolGotRewardFor(miningAddress)).to.be.lengthOf(epochsPoolRewarded.length);
            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress()))
                .to.be.equal(deltaPotFillupValue + epochPoolReward * BigInt(epochsPoolRewarded.length));

            for (let i = 0; i < epochsStakeMovement.length; i++) {
                const stakingEpoch = epochsStakeMovement[i];

                // Emulate delegator's stake movement
                const startBlock = 120954 * stakingEpoch + 1;
                await stakingHbbftContract.setStakingEpoch(stakingEpoch);
                await stakingHbbftContract.setValidatorMockSetAddress(owner.address);

                //await stakingHbbft.setStakingEpochStartBlock(startBlock);
                await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());
                await stakingHbbftContract.connect(delegator).orderWithdraw(stakingAddress, delegatorMinStake);
                await stakingHbbftContract.connect(delegator).orderWithdraw(stakingAddress, -delegatorMinStake);
            }

            const stakeFirstEpoch = await stakingHbbftContract.stakeFirstEpoch(stakingAddress, delegator.address);
            await stakingHbbftContract.setStakeFirstEpoch(stakingAddress, delegator.address, 0);
            await expect(stakingHbbftContract.connect(delegator).claimReward([], stakingAddress))
                .to.be.revertedWith("Claim: first epoch can't be 0");
            await stakingHbbftContract.setStakeFirstEpoch(stakingAddress, delegator.address, stakeFirstEpoch);

            if (epochsPoolRewarded.length > 0) {
                if (epochsPoolRewarded.length > 1) {
                    const reversedEpochsPoolRewarded = [...epochsPoolRewarded].reverse();
                    const currentEpoch = await stakingHbbftContract.stakingEpoch();
                    if (reversedEpochsPoolRewarded[0] < currentEpoch) {
                        await expect(stakingHbbftContract.connect(delegator).claimReward(reversedEpochsPoolRewarded, stakingAddress))
                            .to.be.revertedWith("Claim: need strictly increasing order");
                    } else {
                        await expect(stakingHbbftContract.connect(delegator).claimReward([], stakingAddress))
                            .to.be.revertedWith("Claim: only before current epoch");
                    }
                }

                await stakingHbbftContract.setStakingEpoch(epochsPoolRewarded[epochsPoolRewarded.length - 1]);
                await expect(stakingHbbftContract.connect(delegator).claimReward([], stakingAddress))
                    .to.be.revertedWith("Claim: only before current epoch");
                await stakingHbbftContract.setStakingEpoch(epochsPoolRewarded[epochsPoolRewarded.length - 1] + 1);

                if (epochsPoolRewarded.length == 1) {
                    const validatorStakeAmount = await blockRewardContract.snapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress);
                    await blockRewardContract.setSnapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress, 0);
                    const result = await stakingHbbftContract.connect(delegator).claimReward([], stakingAddress);
                    const receipt = await result.wait();

                    expect(receipt!.logs).to.be.lengthOf(1);
                    const claimRewardEvent = stakingHbbftContract.interface.parseLog(receipt!.logs[0]);

                    expect(claimRewardEvent!.args.nativeCoinsAmount).to.be.equal(0n);

                    await blockRewardContract.setSnapshotPoolValidatorStakeAmount(epochsPoolRewarded[0], miningAddress, validatorStakeAmount);
                    await stakingHbbftContract.clearRewardWasTaken(stakingAddress, delegator.address, epochsPoolRewarded[0]);
                }
            }
            //staked half the amount, hence .div(2)
            const delegatorRewardExpected = epochPoolReward * BigInt(epochsPoolRewarded.length) / 2n;

            const rewardAmountsCalculated = await stakingHbbftContract.getRewardAmount([], stakingAddress, delegator.address);
            expect(rewardAmountsCalculated).to.be.equal(delegatorRewardExpected);

            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
            let weiSpent = 0n;

            for (let i = 0; i < 3; i++) {
                // We call `claimReward` several times, but it withdraws the reward only once
                const result = await stakingHbbftContract.connect(delegator).claimReward([], stakingAddress);
                const receipt = await result.wait();
                weiSpent += receipt!.gasUsed * result.gasPrice;
            }

            expect(await ethers.provider.getBalance(delegator.address))
                .to.be.equal(delegatorCoinsBalanceBefore + delegatorRewardExpected - weiSpent);

            for (let i = 0; i < 3; i++) {
                // We call `claimReward` several times, but it withdraws the reward only once
                const result = await stakingHbbftContract.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);
                const receipt = await result.wait();

                if (i == 0) {
                    expect(receipt!.logs).to.be.lengthOf(epochsPoolRewarded.length);
                } else {
                    expect(receipt!.logs).to.be.empty;
                }
            }

            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(deltaPotFillupValue);
        }

        it('reward tries to be withdrawn before first stake', async () => {
            const {
                miningAddress,
                stakingAddress,
            } = await _delegatorNeverStakedBefore();

            //const deltaPotFillupValue =  web3.eth.toWei(60));
            //await blockRewardHbbft.addToDeltaPot({value: deltaPotFillupValue});

            // a fake epoch reward.
            const epochPoolReward = 1000n;

            // Emulate snapshotting and rewards for the pool on the epoch #9
            let stakingEpoch = 9n;
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch, miningAddress);
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });

            expect(await blockRewardContract.epochPoolNativeReward(stakingEpoch, miningAddress)).to.be.equal(epochPoolReward);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1n, miningAddress);

            // Emulate the delegator's first stake on epoch #10
            stakingEpoch = 10n;

            await stakingHbbftContract.setStakingEpoch(stakingEpoch);
            await stakingHbbftContract.setValidatorMockSetAddress(owner.address);
            //await stakingHbbft.setStakingEpochStartBlock(startBlock);
            await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());

            await stakingHbbftContract.connect(delegator).stake(stakingAddress, { value: delegatorMinStake });
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            expect(await blockRewardContract.epochPoolNativeReward(stakingEpoch, miningAddress)).to.be.equal(epochPoolReward);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1n, miningAddress);

            // // Emulate rewards for the pool on epoch #11
            stakingEpoch = 11n;
            await stakingHbbftContract.setStakingEpoch(stakingEpoch);
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            expect(await blockRewardContract.epochPoolNativeReward(stakingEpoch, miningAddress)).to.be.equal(epochPoolReward);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1n, miningAddress);

            await stakingHbbftContract.setStakingEpoch(12);

            const rewardAmountsCalculated = await stakingHbbftContract.getRewardAmount([9, 10], stakingAddress, delegator.address);
            expect(rewardAmountsCalculated).to.be.equal(0n);

            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
            let result = await stakingHbbftContract.connect(delegator).claimReward([9, 10], stakingAddress);
            let receipt = await result.wait();

            const weiSpent = receipt!.gasUsed * result.gasPrice;
            const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);

            expect(receipt!.logs).to.be.empty;
            expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore - weiSpent);

            result = await stakingHbbftContract.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);
            receipt = await result.wait();

            expect(receipt!.logs).to.be.lengthOf(5);

            const expectedEpochs = [1n, 2n, 9n, 10n, 11n];

            for (let i = 0; i < receipt!.logs.length; ++i) {
                const event = stakingHbbftContract.interface.parseLog(receipt!.logs[i]);
                expect(event!.args.stakingEpoch).to.be.equal(expectedEpochs[i]);
            }

            result = await stakingHbbftContract.connect(delegator).claimReward([], stakingAddress);
            receipt = await result.wait();

            expect(receipt!.logs).to.be.lengthOf(1);
            const event = stakingHbbftContract.interface.parseLog(receipt!.logs[0]);
            expect(event!.args.stakingEpoch).to.be.equal(11n)

            expect(await stakingHbbftContract.stakeFirstEpoch(stakingAddress, delegator.address)).to.be.equal(11);
            expect(await stakingHbbftContract.stakeLastEpoch(stakingAddress, delegator.address)).to.be.equal(0n);
        });

        it('delegator stakes and withdraws at the same epoch', async () => {
            const {
                miningAddress,
                stakingAddress
            } = await _delegatorNeverStakedBefore();

            const epochPoolReward = 1000n

            // Emulate snapshotting and rewards for the pool on the epoch #9
            let stakingEpoch = 9n;
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch, miningAddress);
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            expect(await blockRewardContract.epochPoolNativeReward(stakingEpoch, miningAddress)).to.be.equal(epochPoolReward);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1n, miningAddress);

            // Emulate the delegator's first stake and withdrawal on epoch #10
            stakingEpoch = 10n;
            const startBlock = 120954n * stakingEpoch + 1n;

            await stakingHbbftContract.setStakingEpoch(stakingEpoch);
            await stakingHbbftContract.setValidatorMockSetAddress(owner.address);
            //await stakingHbbftContract.setStakingEpochStartBlock(startBlock);
            await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());

            await stakingHbbftContract.connect(delegator).stake(stakingAddress, { value: delegatorMinStake });
            await stakingHbbftContract.connect(delegator).withdraw(stakingAddress, delegatorMinStake);
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1n, miningAddress);

            // Emulate rewards for the pool on epoch #11
            stakingEpoch = 11n;
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1n, miningAddress);

            await stakingHbbftContract.setStakingEpoch(12);

            const rewardAmountsCalculated = await stakingHbbftContract.getRewardAmount([], stakingAddress, delegator.address);
            expect(rewardAmountsCalculated).to.be.equal(0n);

            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
            let result = await stakingHbbftContract.connect(delegator).claimReward([], stakingAddress);
            let receipt = await result.wait();

            const weiSpent = receipt!.gasUsed * result.gasPrice;
            const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);

            expect(receipt!.logs).to.be.empty;
            expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore - weiSpent);

            result = await stakingHbbftContract.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);
            receipt = await result.wait();

            expect(receipt!.logs).to.be.lengthOf(5);

            const expectedEpochs = [1n, 2n, 9n, 10n, 11n];

            for (let i = 0; i < expectedEpochs.length; ++i) {
                const event = stakingHbbftContract.interface.parseLog(receipt!.logs[i]);
                expect(event!.args.stakingEpoch).to.equal(expectedEpochs[i]);
            }

            expect(await stakingHbbftContract.stakeFirstEpoch(stakingAddress, delegator.address)).to.be.equal(11);
            expect(await stakingHbbftContract.stakeLastEpoch(stakingAddress, delegator.address)).to.be.equal(11);
        });

        it('non-rewarded epochs are passed', async () => {
            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];
            const epochPoolReward = ethers.parseEther('1');

            const epochsPoolRewarded = [10, 20, 30, 40, 50];
            for (let i = 0; i < epochsPoolRewarded.length; i++) {
                const stakingEpoch = epochsPoolRewarded[i];

                // Emulate snapshotting for the pool
                await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch, miningAddress);

                // Emulate rewards for the pool
                await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            }

            // initial validator got reward for epochs: [10, 20, 30, 40, 50]
            expect(await blockRewardContract.epochsPoolGotRewardFor(miningAddress)).to.be.lengthOf(5);

            await stakingHbbftContract.setStakingEpoch(51);

            const epochsToWithdrawFrom = [15, 25, 35, 45];
            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
            const result = await stakingHbbftContract.connect(delegator).claimReward(epochsToWithdrawFrom, stakingAddress);
            const receipt = await result.wait();
            const weiSpent = receipt!.gasUsed * result.gasPrice;
            const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);

            expect(receipt!.logs).to.be.lengthOf(epochsToWithdrawFrom.length);
            for (let i = 0; i < epochsToWithdrawFrom.length; i++) {
                const event = stakingHbbftContract.interface.parseLog(receipt!.logs[i]);
                expect(event!.args.stakingEpoch).to.be.equal(epochsToWithdrawFrom[i]);
                expect(event!.args!.nativeCoinsAmount).to.be.equal(0n);
            }

            expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore - weiSpent);
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
            const epochPoolReward = ethers.parseEther('1');

            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal('0');

            let stakingEpoch;

            // Emulate snapshotting and rewards for the pool
            stakingEpoch = 9;
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch, miningAddress);
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(epochPoolReward);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1, miningAddress);

            // Emulate delegator's stake withdrawal
            stakingEpoch = 10;
            //const stakingEpochStartBlock =  120954 * stakingEpoch + 1);
            await stakingHbbftContract.setStakingEpoch(stakingEpoch);
            await stakingHbbftContract.setValidatorMockSetAddress(owner.address);
            //await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock);
            await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());

            await stakingHbbftContract.connect(delegator).orderWithdraw(stakingAddress, delegatorMinStake);
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(epochPoolReward * 2n);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1, miningAddress);

            // Emulate rewards for the pool
            stakingEpoch = 11;
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(epochPoolReward * 3n);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1, miningAddress);

            await stakingHbbftContract.setStakingEpoch(12);

            const delegatorRewardExpected = epochPoolReward * 2n / 2n;

            const rewardAmountsCalculated = await stakingHbbftContract.getRewardAmount([], stakingAddress, delegator.address);
            expect(rewardAmountsCalculated).to.be.equal(delegatorRewardExpected);

            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
            let tx = stakingHbbftContract.connect(delegator).claimReward([], stakingAddress);

            await expect(tx)
                .to.emit(stakingHbbftContract, "ClaimedReward")
                .withArgs(stakingAddress, delegator.address, 9n, epochPoolReward / 2n)
                .and.to.emit(stakingHbbftContract, "ClaimedReward")
                .withArgs(stakingAddress, delegator.address, 10n, epochPoolReward / 2n);

            const txResponse = await tx;

            let receipt = await (await tx).wait();
            const weiSpent = receipt!.gasUsed * txResponse.gasPrice;
            const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);
            expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore + delegatorRewardExpected - weiSpent);

            const result = await stakingHbbftContract.connect(await ethers.getSigner(stakingAddress)).claimReward([], stakingAddress);
            receipt = await result.wait();

            const expectedEpochs = [9n, 10n, 11n];
            expect(receipt!.logs).to.be.lengthOf(3);
            for (let i = 0; i < expectedEpochs.length; ++i) {
                const event = stakingHbbftContract.interface.parseLog(receipt!.logs[i]);
                expect(event!.args.stakingEpoch).to.be.equal(expectedEpochs[i]);
            }

            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(0n);
        });

        it('stake is withdrawn forever 2', async () => {
            const miningAddress = initialValidators[0];
            const stakingAddress = initialStakingAddresses[0];
            const epochPoolReward = ethers.parseEther('1');

            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(0n);

            let stakingEpoch = 9n

            // Emulate snapshotting and rewards for the pool
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch, miningAddress);
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(epochPoolReward);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1n, miningAddress);

            // Emulate delegator's stake withdrawal
            stakingEpoch = 10n;
            //const stakingEpochStartBlock =  120954 * stakingEpoch + 1);
            await stakingHbbftContract.setStakingEpoch(stakingEpoch);
            await stakingHbbftContract.setValidatorMockSetAddress(owner.address);
            //await stakingHbbft.setStakingEpochStartBlock(stakingEpochStartBlock);
            await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());

            await stakingHbbftContract.connect(delegator).orderWithdraw(stakingAddress, delegatorMinStake);
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(epochPoolReward * 2n);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1n, miningAddress);

            // Emulate rewards for the pool
            stakingEpoch = 11n;
            await blockRewardContract.setEpochPoolReward(stakingEpoch, miningAddress, { value: epochPoolReward });
            expect(await ethers.provider.getBalance(await blockRewardContract.getAddress())).to.be.equal(epochPoolReward * 3n);
            await blockRewardContract.snapshotPoolStakeAmounts(await stakingHbbftContract.getAddress(), stakingEpoch + 1n, miningAddress);

            await stakingHbbftContract.setStakingEpoch(12);

            const rewardAmountsCalculated = await stakingHbbftContract.getRewardAmount([11], stakingAddress, delegator.address);
            expect(rewardAmountsCalculated).to.be.equal(0n);

            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
            const result = await stakingHbbftContract.connect(delegator).claimReward([11], stakingAddress);
            const receipt = await result.wait();
            const weiSpent = receipt!.gasUsed * result.gasPrice;
            const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);

            expect(receipt!.logs).to.be.lengthOf(0);
            expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore - weiSpent);
        });

        it('gas consumption for one staking epoch is OK', async () => {
            const stakingEpoch = 2600n;

            await blockRewardContract.addToDeltaPot({ value: deltaPotFillupValue });

            for (let i = 0; i < initialValidators.length; i++) {
                await blockRewardContract.snapshotPoolStakeAmounts(
                    await stakingHbbftContract.getAddress(),
                    stakingEpoch, initialValidators[i]
                );
            }

            await stakingHbbftContract.setStakingEpoch(stakingEpoch - 1n);
            await stakingHbbftContract.setValidatorMockSetAddress(owner.address);
            //await stakingHbbftContract.setStakingEpochStartBlock(epochStartBlock);
            await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());
            // new validatorSet at the end of fixed epoch duration

            await timeTravelToTransition(blockRewardContract, stakingHbbftContract);
            await timeTravelToEndEpoch(blockRewardContract, stakingHbbftContract);

            expect(await validatorSetContract.getValidators()).to.be.deep.equal(initialValidators);
            expect(await stakingHbbftContract.stakingEpoch()).to.be.equal(stakingEpoch);


            let blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());

            for (let i = 0; i < initialValidators.length; i++) {
                expect(await blockRewardContract.epochPoolNativeReward(stakingEpoch, initialValidators[i])).to.be.equal(0n);
            }

            await timeTravelToTransition(blockRewardContract, stakingHbbftContract);
            await timeTravelToEndEpoch(blockRewardContract, stakingHbbftContract);

            expect(await stakingHbbftContract.stakingEpoch()).to.be.equal(stakingEpoch + 1n);

            //epochStartBlock = await stakingHbbftContract.stakingEpochStartBlock();
            //epochStartBlock.to.be.equal( 120954 * (stakingEpoch + 1) + 2 + 2 + 1)); // +2 for kegen duration

            let distributedCoinsAmount = 0n;
            for (let i = 0; i < initialValidators.length; i++) {
                const epochPoolNativeReward = await blockRewardContract.epochPoolNativeReward(stakingEpoch, initialValidators[i]);
                expect(epochPoolNativeReward).to.be.above(0n);
                distributedCoinsAmount = distributedCoinsAmount + epochPoolNativeReward;
            }

            // const blockRewardContract.maintenanceFundAddress();
            // console.log('DAO Coin amount');
            // distributedCoinsAmount

            let blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());
            expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore + distributedCoinsAmount);

            // The delegator claims their rewards
            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);

            blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());

            const expectedClaimRewardAmounts = (await stakingHbbftContract.getRewardAmount([stakingEpoch], initialStakingAddresses[0], delegator.address));

            const tx = stakingHbbftContract.connect(delegator).claimReward(
                [stakingEpoch],
                initialStakingAddresses[0]
            );

            await expect(tx).to.emit(stakingHbbftContract, "ClaimedReward")
                .withArgs(
                    initialStakingAddresses[0],
                    delegator.address,
                    stakingEpoch,
                    expectedClaimRewardAmounts,
                );

            const txResult = await tx;
            const receipt = await txResult.wait();

            const weiUsed = txResult.gasPrice * receipt!.gasUsed;

            if (!!process.env.SOLIDITY_COVERAGE !== true) {
                // receipt!.gasUsed.to.be.below(1700000);
                expect(receipt!.gasUsed).to.be.below(3120000); // for Istanbul
            }

            const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);
            blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());
            expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore + expectedClaimRewardAmounts - weiUsed);
            expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore - expectedClaimRewardAmounts);
        });

        it('gas consumption for 20 staking epochs is OK', async () => {
            const maxStakingEpoch = 20;
            expect(maxStakingEpoch).to.be.above(2);

            await blockRewardContract.addToDeltaPot({ value: deltaPotFillupValue });

            // Loop of staking epochs
            for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
                // Finalize change i.e. finalize pending validators, increase epoch and set stakingEpochStartBlock
                if (stakingEpoch == 1) {
                    await stakingHbbftContract.setStakingEpoch(1);

                    await stakingHbbftContract.setValidatorMockSetAddress(owner.address);
                    //await stakingHbbftContract.setStakingEpochStartBlock(startBlock);
                    await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());
                }

                expect(await validatorSetContract.getValidators()).to.be.deep.equal(initialValidators);
                expect(await stakingHbbftContract.stakingEpoch()).to.be.equal(stakingEpoch);

                // await timeTravelToTransition(validatorSetContract, blockRewardContract, stakingHbbftContract);
                // await timeTravelToEndEpoch(validatorSetContract, blockRewardContract, stakingHbbftContract);

                const blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                for (let i = 0; i < initialValidators.length; i++) {
                    expect(await blockRewardContract.epochPoolNativeReward(stakingEpoch, initialValidators[i])).to.be.equal(0n);
                }

                await timeTravelToTransition(blockRewardContract, stakingHbbftContract);
                await timeTravelToEndEpoch(blockRewardContract, stakingHbbftContract);

                let distributedCoinsAmount = 0n;
                for (let i = 0; i < initialValidators.length; i++) {
                    const epochPoolNativeReward = await blockRewardContract.epochPoolNativeReward(stakingEpoch, initialValidators[i]);
                    expect(epochPoolNativeReward).to.be.above(0n);
                    distributedCoinsAmount += epochPoolNativeReward;
                }

                const blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore + distributedCoinsAmount);
            }

            // The delegator claims their rewards
            let initialGasConsumption = 0n;
            let startGasConsumption = 0n;
            let endGasConsumption = 0n;
            let blockRewardCoinsBalanceTotalBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());

            let coinsDelegatorGotForAllEpochs = 0n;
            for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
                const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
                const blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                const expectedClaimRewardAmounts = await stakingHbbftContract.getRewardAmount(
                    [stakingEpoch],
                    initialStakingAddresses[0],
                    delegator.address,
                );

                const tx = stakingHbbftContract.connect(delegator).claimReward([stakingEpoch], initialStakingAddresses[0]);
                const txResult = await tx;

                await expect(tx).to.emit(stakingHbbftContract, "ClaimedReward")
                    .withArgs(
                        initialStakingAddresses[0],
                        delegator.address,
                        stakingEpoch,
                        expectedClaimRewardAmounts,
                    );

                let receipt = await txResult.wait();
                const weiSpent = receipt!.gasUsed * txResult.gasPrice;

                if (stakingEpoch == 1) {
                    initialGasConsumption = receipt!.gasUsed;
                } else if (stakingEpoch == 2) {
                    startGasConsumption = receipt!.gasUsed;
                } else if (stakingEpoch == maxStakingEpoch) {
                    endGasConsumption = receipt!.gasUsed;
                }

                const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);
                const blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore + expectedClaimRewardAmounts - weiSpent);
                expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore - expectedClaimRewardAmounts);

                coinsDelegatorGotForAllEpochs += expectedClaimRewardAmounts;
            }

            if (!!process.env.SOLIDITY_COVERAGE !== true) {
                const perEpochGasConsumption = (endGasConsumption - startGasConsumption) / BigInt(maxStakingEpoch - 2);
                // perEpochGasConsumption.to.be.equal( 509));
                expect(perEpochGasConsumption).to.be.equal(1159); // for Istanbul

                // Check gas consumption for the case when the delegator didn't touch their
                // stake for 50 years (2600 staking epochs)
                const maxGasConsumption = initialGasConsumption - perEpochGasConsumption + perEpochGasConsumption * 2600n;
                // maxGasConsumption.to.be.below( 1700000));
                expect(maxGasConsumption).to.be.below(3120000); // for Istanbul
            }

            let blockRewardCoinsBalanceTotalAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());

            expect(blockRewardCoinsBalanceTotalAfter).to.be.equal(blockRewardCoinsBalanceTotalBefore - coinsDelegatorGotForAllEpochs);

            // The validators claim their rewards
            let coinsValidatorsGotForAllEpochs = 0n;
            for (let v = 0; v < initialStakingAddresses.length; v++) {
                for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
                    const validator = initialStakingAddresses[v];
                    const validatorCoinsBalanceBefore = await ethers.provider.getBalance(validator);
                    const blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());

                    const expectedClaimRewardAmounts = await stakingHbbftContract.getRewardAmount([stakingEpoch], validator, validator);

                    const tx = stakingHbbftContract.connect(await ethers.getSigner(validator)).claimReward([stakingEpoch], validator);
                    await expect(tx).to.emit(stakingHbbftContract, "ClaimedReward")
                        .withArgs(
                            validator,
                            validator,
                            stakingEpoch,
                            expectedClaimRewardAmounts,
                        );

                    const txResult = await tx;
                    const receipt = await txResult.wait()
                    const weiSpent = receipt!.gasUsed * txResult.gasPrice;

                    const validatorCoinsBalanceAfter = await ethers.provider.getBalance(validator);
                    const blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());

                    expect(validatorCoinsBalanceAfter).to.be.equal(validatorCoinsBalanceBefore + expectedClaimRewardAmounts - weiSpent);
                    expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore - expectedClaimRewardAmounts);

                    coinsValidatorsGotForAllEpochs += expectedClaimRewardAmounts;
                }
            }

            blockRewardCoinsBalanceTotalAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());
            expect(blockRewardCoinsBalanceTotalAfter).to.be.equal(blockRewardCoinsBalanceTotalBefore - coinsDelegatorGotForAllEpochs - coinsValidatorsGotForAllEpochs);
            expect(blockRewardCoinsBalanceTotalAfter).to.be.gte(0n);
        });

        it('gas consumption for 52 staking epochs is OK 1', async () => {
            const maxStakingEpoch = 52;

            await blockRewardContract.addToDeltaPot({ value: deltaPotFillupValue });

            // Loop of staking epochs
            for (let stakingEpoch = 1; stakingEpoch <= maxStakingEpoch; stakingEpoch++) {
                if (stakingEpoch == 1) {
                    await stakingHbbftContract.setStakingEpoch(1);
                    //const startBlock =  120954 + 2 + 1);

                    await stakingHbbftContract.setValidatorMockSetAddress(owner.address);
                    //await stakingHbbft.setStakingEpochStartBlock(startBlock);
                    await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());
                }

                expect(await validatorSetContract.getValidators()).to.be.deep.equal(initialValidators);
                expect(await stakingHbbftContract.stakingEpoch()).to.be.equal(stakingEpoch);

                await callReward(blockRewardContract, false);

                const blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                for (let i = 0; i < initialValidators.length; i++) {
                    expect(await blockRewardContract.epochPoolNativeReward(stakingEpoch, initialValidators[i])).to.be.equal(0n);
                }

                await timeTravelToTransition(blockRewardContract, stakingHbbftContract);
                await timeTravelToEndEpoch(blockRewardContract, stakingHbbftContract);

                let distributedCoinsAmount = 0n;
                for (let i = 0; i < initialValidators.length; i++) {
                    const epochPoolNativeReward = await blockRewardContract.epochPoolNativeReward(stakingEpoch, initialValidators[i]);
                    expect(epochPoolNativeReward).to.be.above(0n);
                    distributedCoinsAmount += epochPoolNativeReward;
                }

                const blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore + distributedCoinsAmount);
            }

            // The delegator claims their rewards
            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
            const blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());
            const blockRewardCoinsBalanceTotalBefore = blockRewardCoinsBalanceBefore;

            const expectedClaimRewardAmounts = await stakingHbbftContract.getRewardAmount(
                [],
                initialStakingAddresses[0],
                delegator.address
            );

            const result = await stakingHbbftContract.connect(delegator).claimReward([], initialStakingAddresses[0]);
            let receipt = await result.wait();

            let coinsDelegatorGotForAllEpochs = 0n;
            for (let i = 0; i < maxStakingEpoch; i++) {
                const event = stakingHbbftContract.interface.parseLog(receipt!.logs[i]);

                expect(event!.name).to.be.equal("ClaimedReward");
                expect(event!.args.fromPoolStakingAddress).to.be.equal(initialStakingAddresses[0]);
                expect(event!.args.staker).to.be.equal(delegator.address);
                expect(event!.args.stakingEpoch).to.be.equal(i + 1);
                coinsDelegatorGotForAllEpochs += event!.args.nativeCoinsAmount;
            }

            expect(expectedClaimRewardAmounts).to.be.equal(coinsDelegatorGotForAllEpochs);

            const weiSpent = receipt!.gasUsed * result.gasPrice;

            if (!!process.env.SOLIDITY_COVERAGE !== true) {
                // receipt!.gasUsed.to.be.below(1710000);
                expect(receipt!.gasUsed).to.be.below(2100000); // for Istanbul
            }

            const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);
            const blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());

            expect(coinsDelegatorGotForAllEpochs).to.be.gte(0n);
            expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore + coinsDelegatorGotForAllEpochs - weiSpent);
            expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore - coinsDelegatorGotForAllEpochs);

            // The validators claim their rewards
            let coinsValidatorsGotForAllEpochs = 0n;
            for (let v = 0; v < initialStakingAddresses.length; v++) {
                const validator = initialStakingAddresses[v];
                const validatorCoinsBalanceBefore = await ethers.provider.getBalance(validator);
                const blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                const expectedClaimRewardAmounts = (await stakingHbbftContract.getRewardAmount([], validator, validator));
                const result = await stakingHbbftContract.connect(await ethers.getSigner(validator)).claimReward([], validator);
                const receipt = await result.wait();

                let claimedCoinsAmount = 0n;
                for (let i = 0; i < maxStakingEpoch; i++) {
                    const event = stakingHbbftContract.interface.parseLog(receipt!.logs[i]);

                    expect(event!.name).to.be.equal("ClaimedReward");
                    expect(event!.args.fromPoolStakingAddress).to.be.equal(validator);
                    expect(event!.args.staker).to.be.equal(validator);
                    expect(event!.args.stakingEpoch).to.be.equal(i + 1);
                    claimedCoinsAmount += event!.args.nativeCoinsAmount;
                }

                expect(expectedClaimRewardAmounts).to.be.equal(claimedCoinsAmount);

                const weiSpent = receipt!.gasUsed * result.gasPrice;

                const validatorCoinsBalanceAfter = await ethers.provider.getBalance(validator);
                const blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());

                expect(claimedCoinsAmount).to.be.gte(0n);
                expect(validatorCoinsBalanceAfter).to.be.equal(validatorCoinsBalanceBefore + claimedCoinsAmount - weiSpent);
                expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore - claimedCoinsAmount);
                coinsValidatorsGotForAllEpochs += claimedCoinsAmount;
            }

            const blockRewardCoinsBalanceTotalAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());
            expect(blockRewardCoinsBalanceTotalAfter).to.be.equal(blockRewardCoinsBalanceTotalBefore - coinsDelegatorGotForAllEpochs - coinsValidatorsGotForAllEpochs);
            expect(blockRewardCoinsBalanceTotalAfter).to.be.gte(0n);
        });

        it('gas consumption for 52 staking epochs (including gaps ~ 10 years) is OK', async () => {
            const maxStakingEpochs = 52;
            const gapSize = 10n;

            await blockRewardContract.addToDeltaPot({ value: deltaPotFillupValue });

            // Loop of staking epochs
            for (let s = 0; s < maxStakingEpochs; s++) {
                if (s == 0) {
                    await stakingHbbftContract.setStakingEpoch(1);
                    await stakingHbbftContract.setValidatorMockSetAddress(owner.address);
                    await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());
                }

                const stakingEpoch = await stakingHbbftContract.stakingEpoch();

                expect(await validatorSetContract.getValidators()).to.be.deep.equal(initialValidators);
                expect(await stakingHbbftContract.stakingEpoch()).to.be.equal(stakingEpoch);

                const blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                for (let i = 0; i < initialValidators.length; i++) {
                    expect(await blockRewardContract.epochPoolNativeReward(stakingEpoch, initialValidators[i])).to.be.equal(0n);
                }

                await timeTravelToTransition(blockRewardContract, stakingHbbftContract);
                await timeTravelToEndEpoch(blockRewardContract, stakingHbbftContract);

                let distributedCoinsAmount = 0n;
                for (let i = 0; i < initialValidators.length; i++) {
                    const epochPoolNativeReward = await blockRewardContract.epochPoolNativeReward(stakingEpoch, initialValidators[i]);
                    expect(epochPoolNativeReward).to.be.above(0n);
                    distributedCoinsAmount += epochPoolNativeReward;
                }

                const blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore + distributedCoinsAmount);

                const nextStakingEpoch = stakingEpoch + gapSize; // jump through a few epochs
                await stakingHbbftContract.setStakingEpoch(nextStakingEpoch);
                await stakingHbbftContract.setValidatorMockSetAddress(owner.address);
                //await stakingHbbft.setStakingEpochStartBlock((120954 + 2) * nextStakingEpoch + 1);
                await stakingHbbftContract.setValidatorMockSetAddress(await validatorSetContract.getAddress());
                for (let i = 0; i < initialValidators.length; i++) {
                    await blockRewardContract.snapshotPoolStakeAmounts(
                        await stakingHbbftContract.getAddress(),
                        nextStakingEpoch,
                        initialValidators[i]
                    );
                }
            }

            const epochsPoolGotRewardFor = await blockRewardContract.epochsPoolGotRewardFor(initialValidators[0]);

            // The delegator claims their rewards
            const delegatorCoinsBalanceBefore = await ethers.provider.getBalance(delegator.address);
            const blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());
            const blockRewardCoinsBalanceTotalBefore = blockRewardCoinsBalanceBefore;

            const expectedClaimRewardAmounts = await stakingHbbftContract.getRewardAmount(
                [],
                initialStakingAddresses[0],
                delegator.address
            );

            const result = await stakingHbbftContract.connect(delegator).claimReward([], initialStakingAddresses[0]);
            const receipt = await result.wait();

            let coinsDelegatorGotForAllEpochs = 0n;
            for (let i = 0; i < maxStakingEpochs; i++) {
                const event = stakingHbbftContract.interface.parseLog(receipt!.logs[i]);

                expect(event!.name).to.be.equal("ClaimedReward");
                expect(event!.args.fromPoolStakingAddress).to.be.equal(initialStakingAddresses[0]);
                expect(event!.args.staker).to.be.equal(delegator.address);
                expect(event!.args.stakingEpoch).to.be.equal(epochsPoolGotRewardFor[i]);

                coinsDelegatorGotForAllEpochs += event!.args.nativeCoinsAmount;
            }

            expect(expectedClaimRewardAmounts).to.be.equal(coinsDelegatorGotForAllEpochs);

            const weiSpent = receipt!.gasUsed * result.gasPrice;
            if (!!process.env.SOLIDITY_COVERAGE !== true) {
                // receipt!.gasUsed.to.be.below(2000000);
                expect(receipt!.gasUsed).to.be.below(2610000); // for Istanbul
            }

            const delegatorCoinsBalanceAfter = await ethers.provider.getBalance(delegator.address);
            const blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());

            expect(coinsDelegatorGotForAllEpochs).to.be.gte(0n);
            expect(delegatorCoinsBalanceAfter).to.be.equal(delegatorCoinsBalanceBefore + coinsDelegatorGotForAllEpochs - weiSpent);
            expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore - coinsDelegatorGotForAllEpochs);

            // The validators claim their rewards
            let coinsValidatorsGotForAllEpochs = 0n;
            for (let v = 0; v < initialStakingAddresses.length; v++) {
                const validator = initialStakingAddresses[v];
                const validatorCoinsBalanceBefore = await ethers.provider.getBalance(validator);
                const blockRewardCoinsBalanceBefore = await ethers.provider.getBalance(await blockRewardContract.getAddress());
                const expectedClaimRewardAmounts = await stakingHbbftContract.getRewardAmount([], validator, validator);
                const result = await stakingHbbftContract.connect(await ethers.getSigner(validator)).claimReward([], validator);
                const receipt = await result.wait();

                let claimedCoinsAmount = 0n;
                for (let i = 0; i < maxStakingEpochs; i++) {
                    const event = stakingHbbftContract.interface.parseLog(receipt!.logs[i]);

                    expect(event!.name).to.be.equal("ClaimedReward");
                    expect(event!.args.fromPoolStakingAddress).to.be.equal(validator);
                    expect(event!.args.staker).to.be.equal(validator);
                    expect(event!.args.stakingEpoch).to.be.equal(epochsPoolGotRewardFor[i]);
                    claimedCoinsAmount += event!.args.nativeCoinsAmount;
                }

                expect(expectedClaimRewardAmounts).to.be.equal(claimedCoinsAmount);

                const weiSpent = receipt!.gasUsed * result.gasPrice;
                const validatorCoinsBalanceAfter = await ethers.provider.getBalance(validator);
                const blockRewardCoinsBalanceAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());

                expect(claimedCoinsAmount).to.be.gte(0n);
                expect(validatorCoinsBalanceAfter).to.be.equal(validatorCoinsBalanceBefore + claimedCoinsAmount - BigInt(weiSpent));
                expect(blockRewardCoinsBalanceAfter).to.be.equal(blockRewardCoinsBalanceBefore - claimedCoinsAmount);
                coinsValidatorsGotForAllEpochs += claimedCoinsAmount;
            }

            const blockRewardCoinsBalanceTotalAfter = await ethers.provider.getBalance(await blockRewardContract.getAddress());
            expect(blockRewardCoinsBalanceTotalAfter).to.be.equal(blockRewardCoinsBalanceTotalBefore - coinsDelegatorGotForAllEpochs - coinsValidatorsGotForAllEpochs);
            expect(blockRewardCoinsBalanceTotalAfter).to.be.gte(0n);
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
                .to.be.revertedWith("Only ValidatorSet");
        });
    });


    describe('initialize()', async () => {
        const validatorSetContract = '0x1000000000000000000000000000000000000001';

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

            expect(await stakingHbbft.stakingFixedEpochDuration()).to.be.equal(stakingFixedEpochDuration);
            expect(await stakingHbbft.stakingWithdrawDisallowPeriod()).to.be.equal(stakingWithdrawDisallowPeriod);
            expect(await stakingHbbft.validatorSetContract()).to.be.equal(validatorSetContract)

            for (const stakingAddress of initialStakingAddresses) {
                expect(await stakingHbbft.isPoolActive(stakingAddress)).to.be.true;
                expect(await stakingHbbft.getPools()).to.include(stakingAddress);
                expect(await stakingHbbft.getPoolsToBeRemoved()).to.include(stakingAddress);
            }

            expect(await stakingHbbft.getPools()).to.be.deep.equal(initialStakingAddresses);
            expect(await stakingHbbft.delegatorMinStake()).to.be.equal(ethers.parseEther('1'));
            expect(await stakingHbbft.candidateMinStake()).to.be.equal(ethers.parseEther('1'))
        });

        it('should fail if ValidatorSet contract address is zero', async () => {
            let stakingParams = {
                _validatorSetContract: ethers.ZeroAddress,
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
            )).to.be.revertedWith("ValidatorSet can't be 0");
        });

        it('should fail if delegatorMinStake is zero', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
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
            )).to.be.revertedWith("DelegatorMinStake is 0");
        });

        it('should fail if candidateMinStake is zero', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
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
            )).to.be.revertedWith("CandidateMinStake is 0");
        });

        it('should fail if already initialized', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
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
            )).to.be.revertedWith("Initializable: contract is already initialized");
        });

        it('should fail if stakingEpochDuration is 0', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
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
            )).to.be.revertedWith("FixedEpochDuration is 0");
        });

        it('should fail if stakingstakingEpochStartBlockWithdrawDisallowPeriod is 0', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
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
            )).to.be.revertedWith("WithdrawDisallowPeriod is 0");
        });

        it('should fail if stakingWithdrawDisallowPeriod >= stakingEpochDuration', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
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
            )).to.be.revertedWith("FixedEpochDuration must be longer than withdrawDisallowPeriod");
        });

        it('should fail if some staking address is 0', async () => {
            initialStakingAddresses[0] = ethers.ZeroAddress;

            let stakingParams = {
                _validatorSetContract: validatorSetContract,
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
            )).to.be.revertedWith("InitialStakingAddresses can't be 0");
        });

        it('should fail if timewindow is 0', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
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
            )).to.be.revertedWith("The transition timeframe must be longer than 0");
        });

        it('should fail if transition timewindow is smaller than the staking time window', async () => {
            let stakingParams = {
                _validatorSetContract: validatorSetContract,
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
            )).to.be.revertedWith("The transition timeframe must be shorter then the epoch duration");
        });
    });

    describe('moveStake()', async () => {
        let delegatorAddress: HardhatEthersSigner;
        let stakingContract: StakingHbbftMock;
        const stakeAmount = minStake * 2n;

        beforeEach(async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            delegatorAddress = accounts[7];
            stakingContract = stakingHbbft;

            // Place stakes
            await stakingContract.connect(await ethers.getSigner(initialStakingAddresses[0])).stake(initialStakingAddresses[0], { value: stakeAmount });
            await stakingContract.connect(await ethers.getSigner(initialStakingAddresses[1])).stake(initialStakingAddresses[1], { value: stakeAmount });
            await stakingContract.connect(delegatorAddress).stake(initialStakingAddresses[0], { value: stakeAmount });
        });

        it('should move entire stake', async () => {
            // we can move the stake, since the staking address is not part of the active validator set,
            // since we never did never a time travel.
            // If we do, the stakingAddresses are blocked to withdraw without an orderwithdraw.
            expect(await stakingContract.stakeAmount(initialStakingAddresses[0], delegatorAddress.address)).to.be.equal(stakeAmount);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);

            await stakingContract.connect(delegatorAddress).moveStake(initialStakingAddresses[0], initialStakingAddresses[1], stakeAmount);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[0], delegatorAddress.address)).to.be.equal(0n);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(stakeAmount);
        });

        it('should move part of the stake', async () => {
            expect(await stakingContract.stakeAmount(initialStakingAddresses[0], delegatorAddress.address)).to.be.equal(stakeAmount);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);

            await stakingContract.connect(delegatorAddress).moveStake(initialStakingAddresses[0], initialStakingAddresses[1], minStake);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[0], delegatorAddress.address)).to.be.equal(minStake);
            expect(await stakingContract.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(minStake);
        });

        it('should move part of the stake', async () => {
            await stakingContract.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: stakeAmount });

            const sourcePool = initialStakingAddresses[0];
            const targetPool = initialStakingAddresses[1];

            expect(await stakingContract.stakeAmount(sourcePool, delegatorAddress.address)).to.be.equal(stakeAmount);
            expect(await stakingContract.stakeAmount(targetPool, delegatorAddress.address)).to.be.equal(stakeAmount);

            const moveAmount = minStake / 2n;
            expect(moveAmount).to.be.below(await stakingContract.delegatorMinStake());

            await stakingContract.connect(delegatorAddress).moveStake(sourcePool, targetPool, moveAmount);
            expect(await stakingContract.stakeAmount(sourcePool, delegatorAddress.address)).to.be.equal(stakeAmount - moveAmount);
            expect(await stakingContract.stakeAmount(targetPool, delegatorAddress.address)).to.be.equal(stakeAmount + moveAmount);
        });

        it('should fail for zero gas price', async () => {
            await expect(stakingContract.connect(delegatorAddress).moveStake(
                initialStakingAddresses[0],
                initialStakingAddresses[1],
                stakeAmount,
                { gasPrice: 0 }
            )).to.be.revertedWith("GasPrice is 0");
        });

        it('should fail if the source and destination addresses are the same', async () => {
            await expect(stakingContract.connect(delegatorAddress).moveStake(
                initialStakingAddresses[0],
                initialStakingAddresses[0],
                stakeAmount
            )).to.be.revertedWith("MoveStake: src and dst pool is the same");
        });

        it('should fail if the staker tries to move more than they have', async () => {
            await expect(stakingContract.connect(delegatorAddress).moveStake(
                initialStakingAddresses[0],
                initialStakingAddresses[1],
                stakeAmount * 2n
            )).to.be.revertedWith("Withdraw: maxWithdrawAllowed exceeded");
        });

        it('should fail if the staker tries to overstake by moving stake.', async () => {
            // stake source pool and target pool to the max.
            // then move 1 from source to target - that should be the drop on the hot stone.
            const sourcePool = initialStakingAddresses[0];
            const targetPool = initialStakingAddresses[1];

            let currentSourceStake = await stakingContract.stakeAmountTotal(sourcePool);
            const totalStakeableSource = maxStake - currentSourceStake;
            await stakingContract.connect(delegatorAddress).stake(sourcePool, { value: totalStakeableSource });

            let currentTargetStake = await stakingContract.stakeAmountTotal(targetPool);
            const totalStakeableTarget = maxStake - currentTargetStake;
            await stakingContract.connect(delegatorAddress).stake(targetPool, { value: totalStakeableTarget });
            // source is at max stake now, now tip it over.
            await expect(stakingContract.connect(delegatorAddress).moveStake(
                sourcePool,
                targetPool,
                1n
            )).to.be.revertedWith("stake limit has been exceeded");
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
            )).to.be.revertedWith("GasPrice is 0");
        });

        it('should fail for a non-existing pool', async () => {
            const { stakingHbbft, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(delegatorAddress).stake(accounts[10].address, { value: delegatorMinStake }))
                .to.be.revertedWith("Pool does not exist. miningAddress for that staking address is 0");
            await expect(stakingHbbft.connect(delegatorAddress).stake(ethers.ZeroAddress, { value: delegatorMinStake }))
                .to.be.revertedWith("Pool does not exist. miningAddress for that staking address is 0");
        });

        it('should fail for a zero amount', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.connect(delegatorAddress).stake(initialStakingAddresses[1], { value: 0 }))
                .to.be.revertedWith("Stake: stakingAmount is 0");
        });

        it('should fail for a banned validator', async () => {
            const {
                stakingHbbft,
                validatorSetHbbft,
                candidateMinStake,
                delegatorMinStake
            } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            await validatorSetHbbft.setSystemAddress(owner.address);
            await validatorSetHbbft.connect(owner).removeMaliciousValidators([initialValidators[1]]);

            await expect(stakingHbbft.connect(delegatorAddress).stake(
                pool.address,
                { value: delegatorMinStake }
            )).to.be.revertedWith("Stake: Mining address is banned");
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
            )).to.be.revertedWith("Stake: candidateStake less than candidateMinStake");
        });

        it('should fail if a delegator stakes less than DELEGATOR_MIN_STAKE', async () => {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            const halfOfDelegatorMinStake = delegatorMinStake / 2n;

            await expect(stakingHbbft.connect(delegatorAddress).stake(
                pool.address,
                { value: halfOfDelegatorMinStake }
            )).to.be.revertedWith("Stake: delegatorStake is less than delegatorMinStake");
        });

        it('should fail if a delegator stakes more than maxStake', async () => {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: candidateMinStake });
            await expect(stakingHbbft.connect(delegatorAddress).stake(
                pool.address,
                { value: maxStake + 1n }
            )).to.be.revertedWith("stake limit has been exceeded");
        });

        it('should fail if a delegator stakes into an empty pool', async () => {
            const { stakingHbbft, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            expect(await stakingHbbft.stakeAmount(pool.address, pool.address)).to.be.equal(0n);
            await expect(stakingHbbft.connect(delegatorAddress).stake(
                pool.address,
                { value: delegatorMinStake }
            )).to.be.revertedWith("Stake: can't delegate in empty pool");
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
                .to.be.revertedWith("Only ValidatorSet");
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
            expect(await stakingHbbft.poolInactiveIndex(initialStakingAddresses[0])).to.be.equal(0n);

            await stakingHbbft.connect(accounts[7]).removePool(initialStakingAddresses[1]);
            expect(await stakingHbbft.getPoolsToBeRemoved()).to.be.deep.equal([initialStakingAddresses[2]]);
        });
    });

    describe('removeMyPool()', async () => {
        it('should fail for zero gas price', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorMockSetAddress(await validatorSetHbbft.getAddress());
            await expect(stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).removeMyPool({ gasPrice: 0n }))
                .to.be.rejectedWith("GasPrice is 0");
        });

        it('should fail for initial validator during the initial staking epoch', async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            expect(await stakingHbbft.stakingEpoch()).to.be.equal(0n);
            expect(await validatorSetHbbft.isValidator(initialValidators[0])).to.be.true;
            expect(await validatorSetHbbft.miningByStakingAddress(initialStakingAddresses[0])).to.be.equal(initialValidators[0]);

            await expect(stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).removeMyPool({}))
                .to.be.revertedWith("Can't remove pool during 1st staking epoch");

            await stakingHbbft.setValidatorMockSetAddress(accounts[7].address);
            await stakingHbbft.connect(accounts[7]).incrementStakingEpoch();
            await stakingHbbft.setValidatorMockSetAddress(await validatorSetHbbft.getAddress());

            await expect(stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).removeMyPool({})).to.be.fulfilled
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
            )).to.be.revertedWith("GasPrice is 0");
        });

        it('should fail for a zero pool address', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const staker = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(staker).stake(staker.address, { value: stakeAmount });
            await expect(stakingHbbft.connect(staker).withdraw(ethers.ZeroAddress, stakeAmount))
                .to.be.revertedWith("Withdraw pool staking address must not be null");

            await stakingHbbft.connect(staker).withdraw(staker.address, stakeAmount);
        });

        it('should fail for a zero amount', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const staker = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(staker).stake(staker.address, { value: stakeAmount });
            await expect(stakingHbbft.connect(staker).withdraw(staker.address, 0n))
                .to.be.revertedWith("amount to withdraw must not be 0");

            await stakingHbbft.connect(staker).withdraw(staker.address, stakeAmount);
        });

        it("shouldn't allow withdrawing from a banned pool", async () => {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: stakeAmount });
            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: stakeAmount });

            await validatorSetHbbft.setBannedUntil(initialValidators[1], '0xffffffffffffffff');
            await expect(stakingHbbft.connect(pool).withdraw(pool.address, stakeAmount))
                .to.be.revertedWith("Withdraw: maxWithdrawAllowed exceeded");
            await expect(stakingHbbft.connect(delegatorAddress).withdraw(pool.address, stakeAmount))
                .to.be.revertedWith("Withdraw: maxWithdrawAllowed exceeded");

            await validatorSetHbbft.setBannedUntil(initialValidators[1], 0n);
            await stakingHbbft.connect(pool).withdraw(pool.address, stakeAmount);
            await stakingHbbft.connect(delegatorAddress).withdraw(pool.address, stakeAmount);
        });

        // it('shouldn\'t allow withdrawing during the stakingWithdrawDisallowPeriod', async () => {
        //   await stakingHbbft.stake(initialStakingAddresses[1], {from: initialStakingAddresses[1], value: stakeAmount});
        //   //await stakingHbbft.setCurrentBlockNumber(117000);
        //   //await validatorSetHbbft.setCurrentBlockNumber(117000);
        //   await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]}).to.be.rejectedWith(ERROR_MSG);
        //   //await stakingHbbft.setCurrentBlockNumber(116000);
        //   //await validatorSetHbbft.setCurrentBlockNumber(116000);
        //   await stakingHbbft.withdraw(initialStakingAddresses[1], stakeAmount, {from: initialStakingAddresses[1]});
        // });

        it('should fail if non-zero residue is less than CANDIDATE_MIN_STAKE', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const candidateMinStake = await stakingHbbft.candidateMinStake();
            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: stakeAmount });
            await expect(stakingHbbft.connect(pool).withdraw(pool.address, stakeAmount - candidateMinStake + 1n))
                .to.be.revertedWith("newStake amount must be greater equal than the min stake.");

            await stakingHbbft.connect(pool).withdraw(pool.address, stakeAmount - candidateMinStake);
            await stakingHbbft.connect(pool).withdraw(pool.address, candidateMinStake);
        });

        it('should fail if non-zero residue is less than DELEGATOR_MIN_STAKE', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const delegatorMinStake = await stakingHbbft.delegatorMinStake();
            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: stakeAmount });
            await stakingHbbft.connect(delegatorAddress).stake(pool.address, { value: stakeAmount });
            await expect(stakingHbbft.connect(delegatorAddress).withdraw(pool.address, stakeAmount - delegatorMinStake + 1n))
                .to.be.revertedWith("newStake amount must be greater equal than the min stake.");
            await stakingHbbft.connect(delegatorAddress).withdraw(pool.address, stakeAmount - delegatorMinStake);
            await stakingHbbft.connect(delegatorAddress).withdraw(pool.address, delegatorMinStake);
        });

        it('should fail if withdraw more than staked', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = await ethers.getSigner(initialStakingAddresses[1]);

            await stakingHbbft.connect(pool).stake(pool.address, { value: stakeAmount });
            await expect(stakingHbbft.connect(pool).withdraw(pool.address, stakeAmount + 1n))
                .to.be.revertedWith("Withdraw: maxWithdrawAllowed exceeded");
            await stakingHbbft.connect(pool).withdraw(pool.address, stakeAmount);
        });

        it('should fail if withdraw already ordered amount', async () => {
            const { stakingHbbft, validatorSetHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContractsFixture);

            await validatorSetHbbft.setSystemAddress(owner.address);

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

            await expect(stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], stakeAmount))
                .to.be.revertedWith("Withdraw: maxWithdrawAllowed exceeded");
            await expect(stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], restOfAmount + 1n))
                .to.be.revertedWith("Withdraw: maxWithdrawAllowed exceeded");

            await stakingHbbft.connect(delegatorAddress).withdraw(initialStakingAddresses[1], restOfAmount);
            expect(await stakingHbbft.stakeAmountByCurrentEpoch(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);
            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(0n);
            expect(await stakingHbbft.orderedWithdrawAmount(initialStakingAddresses[1], delegatorAddress.address)).to.be.equal(orderedAmount);
            expect(await stakingHbbft.poolDelegators(initialStakingAddresses[1])).to.be.empty;
            expect(await stakingHbbft.poolDelegatorsInactive(initialStakingAddresses[1])).to.be.deep.equal([delegatorAddress.address]);
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
        // TODO: add unit tests for native coin withdrawal
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

        it("should revert if there is no inactive pools", async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.recoverAbandonedStakes())
                .to.be.revertedWith("nothing to recover");
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

            await expect(stakingHbbft.recoverAbandonedStakes()).to.be.revertedWith("nothing to recover");
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
            ).to.be.revertedWith("Stake: pool abandoned")
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

            expect(await stakingHbbft.maxWithdrawAllowed(stakingPool.address, staker.address)).to.equal(0);

            await expect(
                stakingHbbft.connect(staker).withdraw(stakingPool.address, delegatorMinStake)
            ).to.be.revertedWith("Withdraw: maxWithdrawAllowed exceeded")
        });
    });

    describe('setStakingTransitionTimeframeLength()', async () => {
        it('should set staking transition time frame length', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.setStakingTransitionTimeframeLength(300n);
            expect(await stakingHbbft.stakingTransitionTimeframeLength()).to.be.equal(300n);
        });

        it('should not set staking transition time frame length to low value', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.setStakingTransitionTimeframeLength(9n))
                .to.be.revertedWith("The transition timeframe must be longer than 10");
        });

        it('should not set staking transition time frame length to high value', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(stakingHbbft.setStakingTransitionTimeframeLength(100000n))
                .to.be.revertedWith("The transition timeframe must be smaller than the epoch duration");
        });

    });

    describe('setStakingFixedEpochDuration()', async () => {
        it('should set staking fixed epoch transition', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.setStakingFixedEpochDuration(600000n);
            expect(await stakingHbbft.stakingFixedEpochDuration()).to.be.equal(600000n);
        });

        it('should not set staking transition time frame length to low value', async () => {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            let tranitionTimeFrame = await stakingHbbft.stakingTransitionTimeframeLength();
            await expect(stakingHbbft.setStakingFixedEpochDuration(tranitionTimeFrame))
                .to.be.revertedWith("The fixed epoch duration timeframe must be greater than the transition timeframe length");
        });
    });

    async function callReward(blockRewardContract: BlockRewardHbbftMock, isEpochEndBlock: boolean) {
        const systemSigner = await impersonateSystemAcc();

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

