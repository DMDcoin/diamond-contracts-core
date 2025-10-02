import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import { BonusScoreSystem, StakingHbbft, StakingHbbftMock, ValidatorSetHbbftMock } from "../src/types";

// one epoch in 12 hours.
const STAKING_FIXED_EPOCH_DURATION = 43200n;

// the transition time window is 30 minutes.
const STAKING_TRANSITION_WINDOW_LENGTH = 1800n;

const MIN_SCORE = 1n;
const MAX_SCORE = 1000n;
const STAND_BY_BONUS = 20n;
const STAND_BY_PENALTY = 15n;
const NO_KEY_WRITE_PENALTY = 100n;
const BAD_PERFORMANCE_PENALTY = 100n;

enum ScoringFactor {
    StandByBonus,
    NoStandByPenalty,
    NoKeyWritePenalty,
    BadPerformancePenalty
}

const ScoringFactors = [
    { factor: ScoringFactor.StandByBonus, value: STAND_BY_BONUS },
    { factor: ScoringFactor.NoStandByPenalty, value: STAND_BY_PENALTY },
    { factor: ScoringFactor.NoKeyWritePenalty, value: NO_KEY_WRITE_PENALTY },
    { factor: ScoringFactor.BadPerformancePenalty, value: BAD_PERFORMANCE_PENALTY },
];

describe("BonusScoreSystem", function () {
    let users: HardhatEthersSigner[];
    let owner: HardhatEthersSigner;
    let initialValidators: string[];
    let initialStakingAddresses: string[];
    let initialValidatorsPubKeys;
    let initialValidatorsIpAddresses;

    let randomWallet = () => ethers.Wallet.createRandom().address;

    before(async function () {
        users = await ethers.getSigners();
        owner = users[0];
    });

    async function deployContracts() {
        const stubAddress = users[5].address;

        initialValidators = users.slice(10, 12 + 1).map(x => x.address); // accounts[10...12]
        initialStakingAddresses = users.slice(13, 15 + 1).map(x => x.address); // accounts[10...12]

        initialValidatorsPubKeys = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            ([
                '0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
                '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
                '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56'
            ]);

        // The IP addresses are irrelevant for these unit test, just initialize them to 0.
        initialValidatorsIpAddresses = Array(initialValidators.length).fill(ethers.zeroPadBytes("0x00", 16));

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: stubAddress,
            connectivityTrackerContract: stubAddress,
            validatorInactivityThreshold: 86400,
        }

        const validatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbft = await upgrades.deployProxy(
            validatorSetFactory,
            [
                owner.address,
                validatorSetParams,       // _params
                initialValidators,        // _initialMiningAddresses
                initialStakingAddresses,  // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as ValidatorSetHbbftMock;

        await validatorSetHbbft.waitForDeployment();

        let stakingParams = {
            _validatorSetContract: await validatorSetHbbft.getAddress(),
            _bonusScoreContract: stubAddress,
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: ethers.parseEther('100'),
            _candidateMinStake: ethers.parseEther('1'),
            _maxStake: ethers.parseEther('100000'),
            _stakingFixedEpochDuration: STAKING_FIXED_EPOCH_DURATION,
            _stakingTransitionTimeframeLength: STAKING_TRANSITION_WINDOW_LENGTH,
            _stakingWithdrawDisallowPeriod: 2n
        };

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingHbbft = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                stakingParams, // initializer structure
                initialValidatorsPubKeys, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as StakingHbbftMock;

        await stakingHbbft.waitForDeployment();

        const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");

        const bonusScoreSystem = await upgrades.deployProxy(
            bonusScoreSystemFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(), // _validatorSetHbbft
                randomWallet(),                       // _connectivityTracker
                await stakingHbbft.getAddress(),      // _stakingContract
            ],
            { initializer: 'initialize' }
        ) as unknown as BonusScoreSystem;

        await bonusScoreSystem.waitForDeployment();

        await stakingHbbft.setBonusScoreContract(await bonusScoreSystem.getAddress());
        await validatorSetHbbft.setBonusScoreSystemAddress(await bonusScoreSystem.getAddress());

        const reentrancyAttackerFactory = await ethers.getContractFactory("ReentrancyAttacker");
        const reentrancyAttacker = await reentrancyAttackerFactory.deploy();
        await reentrancyAttacker.waitForDeployment();

        await reentrancyAttacker.setBonusScoreContract(await bonusScoreSystem.getAddress());

        return { bonusScoreSystem, stakingHbbft, validatorSetHbbft, reentrancyAttacker };
    }

    async function impersonateAcc(accAddress: string) {
        await helpers.impersonateAccount(accAddress);

        await owner.sendTransaction({
            to: accAddress,
            value: ethers.parseEther('10'),
        });

        return await ethers.getSigner(accAddress);
    }

    async function getPoolLikelihood(
        stakingHbbft: StakingHbbft,
        stakingAddress: string
    ): Promise<bigint> {
        const poolsToBeElected = await stakingHbbft.getPoolsToBeElected();
        const poolsLikelihood = (await stakingHbbft.getPoolsLikelihood()).likelihoods;

        const index = Number(await stakingHbbft.poolToBeElectedIndex(stakingAddress));
        if (poolsToBeElected.length <= index || poolsToBeElected[index] != stakingAddress) {
            throw new Error("pool not found");
        }

        return poolsLikelihood[index];
    }

    async function increaseScore(
        bonusScoreContract: BonusScoreSystem,
        validator: string,
        score: bigint
    ) {
        const timeToGetScorePoint = await bonusScoreContract.getTimePerScorePoint(ScoringFactor.StandByBonus);
        const timeToGetFullBonus = timeToGetScorePoint * STAND_BY_BONUS;

        const validatorSetAddress = await bonusScoreContract.validatorSetHbbft();
        const validatorSet = await impersonateAcc(validatorSetAddress);

        let currentScore = await bonusScoreContract.getValidatorScore(validator);

        while (currentScore < score) {
            let scoreDiff = score - currentScore;
            let timeInterval = scoreDiff < STAND_BY_BONUS
                ? scoreDiff * timeToGetScorePoint
                : timeToGetFullBonus;

            const block = await ethers.provider.getBlock("latest");

            await helpers.time.increase(timeInterval + 1n);
            await bonusScoreContract.connect(validatorSet).rewardStandBy(validator, block?.timestamp!);

            currentScore = await bonusScoreContract.getValidatorScore(validator);

            if (currentScore == MAX_SCORE) {
                break;
            }
        }

        await helpers.stopImpersonatingAccount(validatorSet.address);
    }

    describe('Initializer', async () => {
        let InitializeCases = [
            [ethers.ZeroAddress, randomWallet(), randomWallet(), randomWallet()],
            [randomWallet(), ethers.ZeroAddress, randomWallet(), randomWallet()],
            [randomWallet(), randomWallet(), ethers.ZeroAddress, randomWallet()],
            [randomWallet(), randomWallet(), randomWallet(), ethers.ZeroAddress],
        ];

        InitializeCases.forEach((args, index) => {
            it(`should revert initialization with zero address argument, test #${index + 1}`, async function () {
                const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");

                await expect(upgrades.deployProxy(
                    bonusScoreSystemFactory,
                    args,
                    { initializer: 'initialize' }
                )).to.be.revertedWithCustomError(bonusScoreSystemFactory, "ZeroAddress");
            });
        });

        it("should not allow re-initialization", async () => {
            const args = [randomWallet(), randomWallet(), randomWallet(), randomWallet()];

            const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");
            const bonusScoreSystem = await upgrades.deployProxy(
                bonusScoreSystemFactory,
                args,
                { initializer: 'initialize' }
            );

            await bonusScoreSystem.waitForDeployment();

            await expect(
                bonusScoreSystem.initialize(...args)
            ).to.be.revertedWithCustomError(bonusScoreSystem, "InvalidInitialization");
        });

        ScoringFactors.forEach((args) => {
            it(`should set initial scoring factor ${ScoringFactor[args.factor]}`, async () => {
                const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");
                const bonusScoreSystem = await upgrades.deployProxy(
                    bonusScoreSystemFactory,
                    [randomWallet(), randomWallet(), randomWallet(), randomWallet()],
                    { initializer: 'initialize' }
                );

                await bonusScoreSystem.waitForDeployment();

                expect(await bonusScoreSystem.getScoringFactorValue(args.factor)).to.equal(args.value);
            });
        });
    });

    describe('setStandByFactor (ValueGuards)', async () => {
        it('should initialize with default standByFactor value of 20', async function () {
            const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");
            const bonusScoreSystem = await upgrades.deployProxy(
                bonusScoreSystemFactory,
                [randomWallet(), randomWallet(), randomWallet(), randomWallet()],
                { initializer: 'initialize' }
            );

            await bonusScoreSystem.waitForDeployment();

            expect(await bonusScoreSystem.standByFactor()).to.equal(20);
        });

        it('should restrict calling to contract owner', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[2];

            await expect(bonusScoreSystem.connect(caller).setStandByFactor(25))
                .to.be.revertedWithCustomError(bonusScoreSystem, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should allow single step increase from default value (20 to 25)', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(bonusScoreSystem.setStandByFactor(25))
                .to.emit(bonusScoreSystem, "SetStandByFactor")
                .withArgs(25);

            expect(await bonusScoreSystem.standByFactor()).to.equal(25);
            expect(await bonusScoreSystem.getScoringFactorValue(ScoringFactor.StandByBonus)).to.equal(25);
        });

        it('should allow single step decrease from default value (20 to 15)', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(bonusScoreSystem.setStandByFactor(15))
                .to.emit(bonusScoreSystem, "SetStandByFactor")
                .withArgs(15);

            expect(await bonusScoreSystem.standByFactor()).to.equal(15);
            expect(await bonusScoreSystem.getScoringFactorValue(ScoringFactor.StandByBonus)).to.equal(15);
        });

        it('should reject multi-step changes (20 to 30)', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(bonusScoreSystem.setStandByFactor(30))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange")
                .withArgs(30);
        });

        it('should reject multi-step changes (20 to 10)', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(bonusScoreSystem.setStandByFactor(10))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange")
                .withArgs(10);
        });

        it('should reject values outside allowed range (5)', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(bonusScoreSystem.setStandByFactor(5))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange")
                .withArgs(5);
        });

        it('should reject values outside allowed range (55)', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(bonusScoreSystem.setStandByFactor(55))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange")
                .withArgs(55);
        });

        it('should reject non-step values within range (22)', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(bonusScoreSystem.setStandByFactor(22))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange")
                .withArgs(22);
        });

        it('should allow step-by-step traversal to minimum value (20 → 15 → 10)', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            // First step: 20 → 15
            await bonusScoreSystem.setStandByFactor(15);
            expect(await bonusScoreSystem.standByFactor()).to.equal(15);

            // Second step: 15 → 10
            await bonusScoreSystem.setStandByFactor(10);
            expect(await bonusScoreSystem.standByFactor()).to.equal(10);

            // Verify we can't go below minimum
            await expect(bonusScoreSystem.setStandByFactor(5))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange")
                .withArgs(5);
        });

        it('should allow step-by-step traversal to maximum value (20 → 25 → 30 → 35 → 40 → 45 → 50)', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const steps = [25, 30, 35, 40, 45, 50];
            
            for (const step of steps) {
                await bonusScoreSystem.setStandByFactor(step);
                expect(await bonusScoreSystem.standByFactor()).to.equal(step);
            }

            // Verify we can't go above maximum
            await expect(bonusScoreSystem.setStandByFactor(55))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange")
                .withArgs(55);
        });

        it('should allow bidirectional movement between adjacent values', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            // Start at 20, go to 25
            await bonusScoreSystem.setStandByFactor(25);
            expect(await bonusScoreSystem.standByFactor()).to.equal(25);

            // Go back to 20
            await bonusScoreSystem.setStandByFactor(20);
            expect(await bonusScoreSystem.standByFactor()).to.equal(20);

            // Go to 15
            await bonusScoreSystem.setStandByFactor(15);
            expect(await bonusScoreSystem.standByFactor()).to.equal(15);

            // Go back to 20
            await bonusScoreSystem.setStandByFactor(20);
            expect(await bonusScoreSystem.standByFactor()).to.equal(20);
        });

        it('should validate transitions from boundary values', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            // Navigate to minimum value (10)
            await bonusScoreSystem.setStandByFactor(15);
            await bonusScoreSystem.setStandByFactor(10);

            // From 10, can only go to 15
            await expect(bonusScoreSystem.setStandByFactor(5))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange");
            
            await expect(bonusScoreSystem.setStandByFactor(20))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange");

            await bonusScoreSystem.setStandByFactor(15);
            expect(await bonusScoreSystem.standByFactor()).to.equal(15);

            // Navigate to maximum value (50)
            const stepsToMax = [20, 25, 30, 35, 40, 45, 50];
            for (const step of stepsToMax) {
                await bonusScoreSystem.setStandByFactor(step);
            }

            // From 50, can only go to 45
            await expect(bonusScoreSystem.setStandByFactor(55))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange");
            
            await expect(bonusScoreSystem.setStandByFactor(40))
                .to.be.revertedWithCustomError(bonusScoreSystem, "NewValueOutOfRange");

            await bonusScoreSystem.setStandByFactor(45);
            expect(await bonusScoreSystem.standByFactor()).to.equal(45);
        });

        it('should validate all allowed values can be set in sequence', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            
            const allowedValues = [10, 15, 20, 25, 30, 35, 40, 45, 50];
            
            // Test ascending sequence
            let currentValue = 20; // starting value
            for (let i = allowedValues.indexOf(currentValue) + 1; i < allowedValues.length; i++) {
                await bonusScoreSystem.setStandByFactor(allowedValues[i]);
                expect(await bonusScoreSystem.standByFactor()).to.equal(allowedValues[i]);
                currentValue = allowedValues[i];
            }

            // Test descending sequence
            for (let i = allowedValues.indexOf(currentValue) - 1; i >= 0; i--) {
                await bonusScoreSystem.setStandByFactor(allowedValues[i]);
                expect(await bonusScoreSystem.standByFactor()).to.equal(allowedValues[i]);
                currentValue = allowedValues[i];
            }
        });

        it('should update internal _factors mapping when standByFactor changes', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            // Initial state
            expect(await bonusScoreSystem.getScoringFactorValue(ScoringFactor.StandByBonus)).to.equal(20);

            // Change to 25
            await bonusScoreSystem.setStandByFactor(25);
            expect(await bonusScoreSystem.getScoringFactorValue(ScoringFactor.StandByBonus)).to.equal(25);

            // Change to 30
            await bonusScoreSystem.setStandByFactor(30);
            expect(await bonusScoreSystem.getScoringFactorValue(ScoringFactor.StandByBonus)).to.equal(30);
        });
    });

    describe('getScoringFactorValue', async () => {
        it('should revert for unknown scoring factor', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const unknownFactor = ScoringFactor.BadPerformancePenalty + 1;

            await expect(
                bonusScoreSystem.getScoringFactorValue(unknownFactor)
            ).to.be.reverted;
        });

        it('should get scoring factor value', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            expect(await bonusScoreSystem.getScoringFactorValue(ScoringFactor.BadPerformancePenalty))
                .to.equal(await bonusScoreSystem.DEFAULT_BAD_PERF_FACTOR());
        });
    });

    describe('getTimePerScorePoint', async () => {
        ScoringFactors.forEach((args) => {
            it(`should get time per ${ScoringFactor[args.factor]} factor point`, async () => {
                const { bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);
                const fixedEpochDuration = await stakingHbbft.stakingFixedEpochDuration();

                const expected = fixedEpochDuration / args.value;

                expect(await bonusScoreSystem.getTimePerScorePoint(args.factor)).to.equal(expected);
            });
        });
    });

    describe('getValidatorScore', async () => {
        it('should return MIN_SCORE if not previously recorded', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = ethers.Wallet.createRandom().address;

            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(MIN_SCORE);
        });
    });

    describe('rewardStandBy', async () => {
        it('should restrict calling to ValidatorSet contract', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[2];

            await expect(bonusScoreSystem.connect(caller).rewardStandBy(randomWallet(), 100))
                .to.be.revertedWithCustomError(bonusScoreSystem, "Unauthorized");
        });

        it('should revert for availability timestamp in the future', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const availableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            await expect(bonusScoreSystem.connect(validatorSet).rewardStandBy(validator, availableSince + 5))
                .to.be.revertedWithCustomError(bonusScoreSystem, "InvalidIntervalStartTimestamp");

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should increase validator score depending on stand by interval', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const availableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;

            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(MIN_SCORE);

            const standByTime = 6n * 60n * 60n // 6 hours

            const timePerPoint = await bonusScoreSystem.getTimePerScorePoint(ScoringFactor.StandByBonus);
            const expectedScore = standByTime / timePerPoint + MIN_SCORE;

            await helpers.time.increase(standByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            expect(await bonusScoreSystem.connect(validatorSet).rewardStandBy(validator, availableSince));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(expectedScore);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should emit event', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const availableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;

            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(MIN_SCORE);

            const standByTime = 1n * 60n * 60n // 1 hours

            const timePerPoint = await bonusScoreSystem.getTimePerScorePoint(ScoringFactor.StandByBonus);
            const expectedScore = standByTime / timePerPoint + MIN_SCORE;

            await helpers.time.increase(standByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            await expect(bonusScoreSystem.connect(validatorSet).rewardStandBy(validator, availableSince))
                .to.emit(bonusScoreSystem, "ValidatorScoreChanged")
                .withArgs(validator, ScoringFactor.StandByBonus, expectedScore);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should not exceed MAX_SCORE', async function () {
            const { bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const availableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;

            const initialScore = MAX_SCORE - 2n;
            await increaseScore(bonusScoreSystem, validator, initialScore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(initialScore);

            const standByTime = await stakingHbbft.stakingFixedEpochDuration();

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());

            await helpers.time.increase(standByTime + 1n);

            expect(await bonusScoreSystem.connect(validatorSet).rewardStandBy(validator, availableSince));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(MAX_SCORE);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should use last score change timestamp if its higher than availability timestamp', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const availableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;

            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(MIN_SCORE);

            let standByTime = 6n * 60n * 60n // 6 hours

            const timePerPoint = await bonusScoreSystem.getTimePerScorePoint(ScoringFactor.StandByBonus);
            const expectedScore = standByTime / timePerPoint + MIN_SCORE;

            await helpers.time.increase(standByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            expect(await bonusScoreSystem.connect(validatorSet).rewardStandBy(validator, availableSince));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(expectedScore);

            const additionalPoints = 5n;
            standByTime = timePerPoint * additionalPoints; // time to accumulate 5 stand by points

            await helpers.time.increase(standByTime);
            expect(await bonusScoreSystem.connect(validatorSet).rewardStandBy(validator, availableSince));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(expectedScore + additionalPoints);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should increase pool likelihood', async function () {
            const { bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const mining = await ethers.getSigner(initialValidators[0]);
            const staking = await ethers.getSigner(initialStakingAddresses[0]);
            const canidateStake = await stakingHbbft.candidateMinStake();

            const availableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;

            expect(await bonusScoreSystem.getValidatorScore(mining.address)).to.equal(MIN_SCORE);

            await stakingHbbft.connect(staking).stake(staking.address, {
                value: canidateStake
            });

            expect(await getPoolLikelihood(stakingHbbft, staking.address)).to.equal(canidateStake);

            const standByTime = 1n * 60n * 60n // 1 hours

            const timePerPoint = await bonusScoreSystem.getTimePerScorePoint(ScoringFactor.StandByBonus);
            const expectedScore = standByTime / timePerPoint + MIN_SCORE;

            await helpers.time.increase(standByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            expect(await bonusScoreSystem.connect(validatorSet).rewardStandBy(mining.address, availableSince));
            expect(await bonusScoreSystem.getValidatorScore(mining.address)).to.equal(expectedScore);

            expect(await getPoolLikelihood(stakingHbbft, staking.address)).to.equal(canidateStake * expectedScore);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should be non-reentrant', async () => {
            const { reentrancyAttacker } = await helpers.loadFixture(deployContracts);

            const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");
            const bonusScoreSystem = await upgrades.deployProxy(
                bonusScoreSystemFactory,
                [
                    owner.address,
                    await reentrancyAttacker.getAddress(), // _validatorSetHbbft
                    randomWallet(),                        // _connectivityTracker
                    await reentrancyAttacker.getAddress(), // _stakingContract
                ],
                { initializer: 'initialize' }
            ) as unknown as BonusScoreSystem;

            const selector = bonusScoreSystem.interface.getFunction('rewardStandBy').selector;

            await reentrancyAttacker.setBonusScoreContract(await bonusScoreSystem.getAddress());
            await reentrancyAttacker.setFuncId(selector);

            const mining = await ethers.getSigner(initialValidators[0]);
            const timestamp = await helpers.time.latest();

            await helpers.time.increase(1000);

            await expect(reentrancyAttacker.attack(mining, timestamp))
                .to.be.revertedWithCustomError(bonusScoreSystem, "ReentrancyGuardReentrantCall");
        });
    });

    describe('penaliseNoStandBy', async () => {
        it('should restrict calling to ValidatorSet contract', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[3];

            await expect(bonusScoreSystem.connect(caller).penaliseNoStandBy(randomWallet(), 100))
                .to.be.revertedWithCustomError(bonusScoreSystem, "Unauthorized");
        });

        it('should revert for availability timestamp in the future', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const availableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            await expect(bonusScoreSystem.connect(validatorSet).penaliseNoStandBy(validator, availableSince + 5))
                .to.be.revertedWithCustomError(bonusScoreSystem, "InvalidIntervalStartTimestamp");

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should decrease validator score depending on no stand by interval', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const scoreBefore = 110n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore);

            const unavailableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;
            const noStandByTime = 6n * 60n * 60n // 6 hours

            const timePerPoint = await bonusScoreSystem.getTimePerScorePoint(ScoringFactor.NoStandByPenalty);
            const scorePenalty = noStandByTime / timePerPoint;

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            expect(await bonusScoreSystem.connect(validatorSet).penaliseNoStandBy(validator, unavailableSince));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore - scorePenalty);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should emit event', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const scoreBefore = 110n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore);

            const unavailableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;
            const noStandByTime = 1n * 60n * 60n // 1 hours

            const timePerPoint = await bonusScoreSystem.getTimePerScorePoint(ScoringFactor.NoStandByPenalty);
            const scoreAfter = scoreBefore - noStandByTime / timePerPoint;

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            await expect(bonusScoreSystem.connect(validatorSet).penaliseNoStandBy(validator, unavailableSince))
                .to.emit(bonusScoreSystem, "ValidatorScoreChanged")
                .withArgs(validator, ScoringFactor.NoStandByPenalty, scoreAfter);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should not decrease below MIN_SCORE', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const initialScore = MIN_SCORE + 1n;
            await increaseScore(bonusScoreSystem, validator, initialScore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(initialScore);

            const unavailableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;
            const noStandByTime = 12n * 60n * 60n // 12 hours

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            expect(await bonusScoreSystem.connect(validatorSet).penaliseNoStandBy(validator, unavailableSince));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(MIN_SCORE);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should use last score change timestamp if its higher than availability timestamp', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const initialScore = 250n;
            await increaseScore(bonusScoreSystem, validator, initialScore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(initialScore);

            const unavailableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;
            let noStandByTime = 10n * 60n * 60n // 10 hours

            const timePerPoint = await bonusScoreSystem.getTimePerScorePoint(ScoringFactor.NoStandByPenalty);
            const expectedScore = initialScore - noStandByTime / timePerPoint;

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            expect(await bonusScoreSystem.connect(validatorSet).penaliseNoStandBy(validator, unavailableSince));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(expectedScore);

            const additionalPenatlies = 5n;
            noStandByTime = timePerPoint * additionalPenatlies; // time to accumulate 5 no stand by points

            await helpers.time.increase(noStandByTime);
            expect(await bonusScoreSystem.connect(validatorSet).penaliseNoStandBy(validator, unavailableSince));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(expectedScore - additionalPenatlies);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should decrease pool likelihood', async function () {
            const { bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const mining = await ethers.getSigner(initialValidators[0]);
            const staking = await ethers.getSigner(initialStakingAddresses[0]);
            const canidateStake = await stakingHbbft.candidateMinStake();

            await stakingHbbft.connect(staking).stake(staking.address, {
                value: canidateStake
            });

            const initialScore = 250n;
            await increaseScore(bonusScoreSystem, mining.address, initialScore);
            expect(await bonusScoreSystem.getValidatorScore(mining.address)).to.equal(initialScore);
            expect(await getPoolLikelihood(stakingHbbft, staking.address)).to.equal(canidateStake * initialScore);

            const unavailableSince = (await ethers.provider.getBlock('latest'))?.timestamp!;
            const noStandByTime = 10n * 60n * 60n // 10 hours

            const timePerPoint = await bonusScoreSystem.getTimePerScorePoint(ScoringFactor.NoStandByPenalty);
            const expectedScore = initialScore - noStandByTime / timePerPoint;

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());

            expect(await bonusScoreSystem.connect(validatorSet).penaliseNoStandBy(mining.address, unavailableSince));
            expect(await bonusScoreSystem.getValidatorScore(mining.address)).to.equal(expectedScore);
            expect(await getPoolLikelihood(stakingHbbft, staking.address)).to.equal(canidateStake * expectedScore);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should be non-reentrant', async () => {
            const { reentrancyAttacker } = await helpers.loadFixture(deployContracts);

            const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");
            const bonusScoreSystem = await upgrades.deployProxy(
                bonusScoreSystemFactory,
                [
                    owner.address,
                    await reentrancyAttacker.getAddress(), // _validatorSetHbbft
                    randomWallet(),                        // _connectivityTracker
                    await reentrancyAttacker.getAddress(), // _stakingContract
                ],
                { initializer: 'initialize' }
            ) as unknown as BonusScoreSystem;

            const selector = bonusScoreSystem.interface.getFunction('penaliseNoStandBy').selector;

            await reentrancyAttacker.setBonusScoreContract(await bonusScoreSystem.getAddress());
            await reentrancyAttacker.setFuncId(selector);

            const mining = await ethers.getSigner(initialValidators[0]);
            const timestamp = await helpers.time.latest();

            await helpers.time.increase(1000);

            await expect(reentrancyAttacker.attack(mining, timestamp))
                .to.be.revertedWithCustomError(bonusScoreSystem, "ReentrancyGuardReentrantCall");
        });
    });

    describe('penaliseNoKeyWrite', async () => {
        it('should restrict calling to ValidatorSet contract', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[4];

            await expect(bonusScoreSystem.connect(caller).penaliseNoKeyWrite(randomWallet()))
                .to.be.revertedWithCustomError(bonusScoreSystem, "Unauthorized");
        });

        it('should decrease validator score', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const scoreBefore = 110n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore);

            const expectedScore = scoreBefore - NO_KEY_WRITE_PENALTY;

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            expect(await bonusScoreSystem.connect(validatorSet).penaliseNoKeyWrite(validator));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(expectedScore);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should not decrease below MIN_SCORE', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const scoreBefore = 100n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            expect(await bonusScoreSystem.connect(validatorSet).penaliseNoKeyWrite(validator));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(MIN_SCORE);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should emit event', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const scoreBefore = 110n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore);

            const expectedScore = scoreBefore - NO_KEY_WRITE_PENALTY;

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());

            await expect(bonusScoreSystem.connect(validatorSet).penaliseNoKeyWrite(validator))
                .to.emit(bonusScoreSystem, "ValidatorScoreChanged")
                .withArgs(validator, ScoringFactor.NoKeyWritePenalty, expectedScore);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should decrease pool likelihood', async function () {
            const { bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const mining = await ethers.getSigner(initialValidators[0]);
            const staking = await ethers.getSigner(initialStakingAddresses[0]);
            const canidateStake = await stakingHbbft.candidateMinStake();

            await stakingHbbft.connect(staking).stake(staking.address, {
                value: canidateStake
            });

            const bonusScoreBefore = 110n;
            const bonusScoreAfter = bonusScoreBefore - NO_KEY_WRITE_PENALTY;
            await increaseScore(bonusScoreSystem, mining.address, bonusScoreBefore);

            expect(await bonusScoreSystem.getValidatorScore(mining.address)).to.equal(bonusScoreBefore);
            expect(await getPoolLikelihood(stakingHbbft, staking.address)).to.equal(canidateStake * bonusScoreBefore);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.validatorSetHbbft());
            expect(await bonusScoreSystem.connect(validatorSet).penaliseNoKeyWrite(mining.address));

            const stakeAmount = await stakingHbbft.stakeAmountTotal(staking.address);
            expect(await getPoolLikelihood(stakingHbbft, staking.address)).to.equal(stakeAmount * bonusScoreAfter);

            await helpers.stopImpersonatingAccount(validatorSet.address);
        });

        it('should be non-reentrant', async () => {
            const { reentrancyAttacker } = await helpers.loadFixture(deployContracts);

            const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");
            const bonusScoreSystem = await upgrades.deployProxy(
                bonusScoreSystemFactory,
                [
                    owner.address,
                    await reentrancyAttacker.getAddress(), // _validatorSetHbbft
                    randomWallet(),                        // _connectivityTracker
                    await reentrancyAttacker.getAddress(), // _stakingContract
                ],
                { initializer: 'initialize' }
            ) as unknown as BonusScoreSystem;

            const selector = bonusScoreSystem.interface.getFunction('penaliseNoKeyWrite').selector;

            await reentrancyAttacker.setBonusScoreContract(await bonusScoreSystem.getAddress());
            await reentrancyAttacker.setFuncId(selector);

            const mining = await ethers.getSigner(initialValidators[0]);
            const timestamp = await helpers.time.latest();

            await helpers.time.increase(1000);

            await expect(reentrancyAttacker.attack(mining, timestamp))
                .to.be.revertedWithCustomError(bonusScoreSystem, "ReentrancyGuardReentrantCall");
        });
    });

    describe('penaliseBadPerformance', async () => {
        it('should restrict calling to ConnectivityTracker contract', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[5];

            await expect(bonusScoreSystem.connect(caller).penaliseBadPerformance(randomWallet(), 100))
                .to.be.revertedWithCustomError(bonusScoreSystem, "Unauthorized");
        });

        it('should decrease validator score depending on disconnect interval', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const scoreBefore = 150n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore);

            const lostPoints = 60n;
            const timePerPoint = await bonusScoreSystem.getTimePerScorePoint(ScoringFactor.BadPerformancePenalty);
            const disconnectInterval = lostPoints * timePerPoint;

            const connectivityTracker = await impersonateAcc(await bonusScoreSystem.connectivityTracker());
            expect(await bonusScoreSystem.connect(connectivityTracker).penaliseBadPerformance(validator, disconnectInterval));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore - lostPoints);

            await helpers.stopImpersonatingAccount(connectivityTracker.address);
        });

        it('should fully penalise for bad performance', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const scoreBefore = 150n;
            const scoreAfter = scoreBefore - BAD_PERFORMANCE_PENALTY;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore);

            const connectivityTracker = await impersonateAcc(await bonusScoreSystem.connectivityTracker());
            expect(await bonusScoreSystem.connect(connectivityTracker).penaliseBadPerformance(validator, 0));
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreAfter);

            await helpers.stopImpersonatingAccount(connectivityTracker.address);
        });

        it('should emit event', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const scoreBefore = 150n;
            const scoreAfter = scoreBefore - BAD_PERFORMANCE_PENALTY;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            expect(await bonusScoreSystem.getValidatorScore(validator)).to.equal(scoreBefore);

            const connectivityTracker = await impersonateAcc(await bonusScoreSystem.connectivityTracker());
            await expect(bonusScoreSystem.connect(connectivityTracker).penaliseBadPerformance(validator, 0))
                .to.emit(bonusScoreSystem, "ValidatorScoreChanged")
                .withArgs(validator, ScoringFactor.BadPerformancePenalty, scoreAfter);


            await helpers.stopImpersonatingAccount(connectivityTracker.address);
        });

        it('should decrease pool likelihood', async function () {
            const { bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const mining = await ethers.getSigner(initialValidators[0]);
            const staking = await ethers.getSigner(initialStakingAddresses[0]);
            const canidateStake = await stakingHbbft.candidateMinStake();

            await stakingHbbft.connect(staking).stake(staking.address, {
                value: canidateStake
            });

            const bonusScoreBefore = 210n;
            const bonusScoreAfter = bonusScoreBefore - BAD_PERFORMANCE_PENALTY;
            await increaseScore(bonusScoreSystem, mining.address, bonusScoreBefore);

            expect(await bonusScoreSystem.getValidatorScore(mining.address)).to.equal(bonusScoreBefore);
            expect(await getPoolLikelihood(stakingHbbft, staking.address)).to.equal(canidateStake * bonusScoreBefore);

            const connectivityTracker = await impersonateAcc(await bonusScoreSystem.connectivityTracker());
            expect(await bonusScoreSystem.connect(connectivityTracker).penaliseBadPerformance(mining.address, 0));

            const stakeAmount = await stakingHbbft.stakeAmountTotal(staking.address);
            expect(await getPoolLikelihood(stakingHbbft, staking.address)).to.equal(stakeAmount * bonusScoreAfter);

            await helpers.stopImpersonatingAccount(connectivityTracker.address);
        });

        it('should be non-reentrant', async () => {
            const { validatorSetHbbft, reentrancyAttacker } = await helpers.loadFixture(deployContracts);

            const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");
            const bonusScoreSystem = await upgrades.deployProxy(
                bonusScoreSystemFactory,
                [
                    owner.address,
                    await validatorSetHbbft.getAddress(),  // _validatorSetHbbft
                    await reentrancyAttacker.getAddress(), // _connectivityTracker
                    await reentrancyAttacker.getAddress(), // _stakingContract
                ],
                { initializer: 'initialize' }
            ) as unknown as BonusScoreSystem;

            const selector = bonusScoreSystem.interface.getFunction('penaliseBadPerformance').selector;

            await reentrancyAttacker.setBonusScoreContract(await bonusScoreSystem.getAddress());
            await reentrancyAttacker.setFuncId(selector);

            const mining = await ethers.getSigner(initialValidators[0]);
            const timestamp = await helpers.time.latest();

            await helpers.time.increase(1000);

            await expect(reentrancyAttacker.attack(mining, timestamp))
                .to.be.revertedWithCustomError(bonusScoreSystem, "ReentrancyGuardReentrantCall");
        });
    });
});
