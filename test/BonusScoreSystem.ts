import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import {
    getAddress,
    parseEther,
    toFunctionSelector,
    zeroAddress,
    type Address,
} from "viem";

import { createNetworkFixtures } from "./fixtures/network.js";
import { splitPublicKeys } from "./fixtures/utils.js";
import { deployProxy } from "./fixtures/proxy.js";
import { createRandomWallet } from "./fixtures/wallet.js";
import { Validator, ZeroIpAddress } from "./fixtures/validator.js";
import { BonusScoreSystem, StakingHbbftMock } from "./fixtures/types.js";

const connection = await hre.network.getOrCreate();
const { viem: hhViem, networkHelpers: helpers } = connection;

const { impersonateAcc } = createNetworkFixtures(connection);

const publicClient = await hhViem.getPublicClient();
type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

// one epoch in 12 hours.
const STAKING_FIXED_EPOCH_DURATION = 43200n;

// the transition time window is 30 minutes.
const STAKING_TRANSITION_WINDOW_LENGTH = 1800n;

const MIN_SCORE = 1n;
const MAX_SCORE = 1000n;
const STANDBY_BONUS = 20n;
const STANDBY_PENALTY = 20n;
const NO_KEY_WRITE_PENALTY = 100n;
const BAD_PERFORMANCE_PENALTY = 100n;

enum ScoringFactor {
    StandByBonus,
    NoStandByPenalty,
    NoKeyWritePenalty,
    BadPerformancePenalty,
}

const ScoringFactors = [
    { factor: ScoringFactor.StandByBonus, value: STANDBY_BONUS },
    { factor: ScoringFactor.NoStandByPenalty, value: STANDBY_PENALTY },
    { factor: ScoringFactor.NoKeyWritePenalty, value: NO_KEY_WRITE_PENALTY },
    { factor: ScoringFactor.BadPerformancePenalty, value: BAD_PERFORMANCE_PENALTY },
];

const randomWallet = () => createRandomWallet().address;

describe("BonusScoreSystem", function () {
    let users: TestWalletClient[];
    let owner: TestWalletClient;

    before(async function () {
        users = await hhViem.getWalletClients();

        owner = users[0];
    });

    async function deployContracts() {
        const initialValidators = new Array<Validator>();
        for (let i = 0; i < 3; ++i) {
            const validator = await Validator.create();
            initialValidators.push(validator);
        }

        const initialMiningAddresses = initialValidators.map((validator) => validator.miningAddress());
        const initialStakingAddresses = initialValidators.map((validator) => validator.stakingAddress());

        const stubAddress = createRandomWallet().address;

        // The exact key values are irrelevant for these unit tests.
        const initialValidatorsPubKeys = splitPublicKeys(
            initialValidators.map((validator) => validator.publicKey()),
        );

        // The IP addresses are irrelevant for these unit test, just initialize them to 0.
        const initialValidatorsIpAddresses = Array(initialValidators.length).fill(ZeroIpAddress);

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: stubAddress,
            connectivityTrackerContract: stubAddress,
            validatorInactivityThreshold: 86400n,
        };

        const validatorSetHbbft = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
            initArgs: [
                owner.account.address,
                validatorSetParams,      // _params
                initialMiningAddresses,  // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ],
            initializer: "initialize",
        });

        const stakingParams = {
            _validatorSetContract: validatorSetHbbft.address,
            _bonusScoreContract: stubAddress,
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: parseEther("100"),
            _candidateMinStake: parseEther("1"),
            _maxStake: parseEther("100000"),
            _stakingFixedEpochDuration: STAKING_FIXED_EPOCH_DURATION,
            _stakingTransitionTimeframeLength: STAKING_TRANSITION_WINDOW_LENGTH,
            _stakingWithdrawDisallowPeriod: 2n,
        };

        const stakingHbbft = await deployProxy(hhViem, "StakingHbbftMock", {
            initArgs: [
                owner.account.address,
                stakingParams,                // initializer structure
                initialValidatorsPubKeys,     // _publicKeys
                initialValidatorsIpAddresses, // _internetAddresses
            ],
            initializer: "initialize",
        });

        const bonusScoreSystem = await deployProxy(hhViem, "BonusScoreSystem", {
            initArgs: [
                owner.account.address,
                validatorSetHbbft.address, // _validatorSetHbbft
                randomWallet(),            // _connectivityTracker
                stakingHbbft.address,      // _stakingContract
            ],
            initializer: "initialize",
        });

        await stakingHbbft.write.setBonusScoreContract([bonusScoreSystem.address]);
        await validatorSetHbbft.write.setBonusScoreSystemAddress([bonusScoreSystem.address]);

        const reentrancyAttacker = await hhViem.deployContract("ReentrancyAttacker");
        await reentrancyAttacker.write.setBonusScoreContract([bonusScoreSystem.address]);

        return { initialValidators, bonusScoreSystem, stakingHbbft, validatorSetHbbft, reentrancyAttacker };
    }

    async function getPoolLikelihood(
        stakingHbbft: StakingHbbftMock,
        stakingAddress: Address,
    ): Promise<bigint> {
        const poolsToBeElected = await stakingHbbft.read.getPoolsToBeElected();
        const [poolsLikelihood] = await stakingHbbft.read.getPoolsLikelihood();

        const index = Number(await stakingHbbft.read.poolToBeElectedIndex([stakingAddress]));
        if (poolsToBeElected.length <= index || poolsToBeElected[index] !== getAddress(stakingAddress)) {
            throw new Error("pool not found");
        }

        return poolsLikelihood[index];
    }

    async function increaseScore(
        bonusScoreContract: BonusScoreSystem,
        validator: Address,
        score: bigint,
    ) {
        const timeToGetScorePoint =
            await bonusScoreContract.read.getTimePerScorePoint([ScoringFactor.StandByBonus]);
        const timeToGetFullBonus = timeToGetScorePoint * STANDBY_BONUS;

        const validatorSet = await impersonateAcc(await bonusScoreContract.read.validatorSetHbbft());

        let currentScore = await bonusScoreContract.read.getValidatorScore([validator]);

        while (currentScore < score) {
            const scoreDiff = score - currentScore;
            const timeInterval = scoreDiff < STANDBY_BONUS
                ? scoreDiff * timeToGetScorePoint
                : timeToGetFullBonus;

            const block = await publicClient.getBlock();

            await helpers.time.increase(timeInterval + 1n);
            await bonusScoreContract.write.rewardStandBy(
                [validator, block.timestamp],
                { account: validatorSet },
            );

            currentScore = await bonusScoreContract.read.getValidatorScore([validator]);

            if (currentScore === MAX_SCORE) {
                break;
            }
        }

        await helpers.stopImpersonatingAccount(validatorSet);
    }

    describe("Initializer", async function () {
        const InitializeCases: Array<[Address, Address, Address, Address]> = [
            [zeroAddress, randomWallet(), randomWallet(), randomWallet()],
            [randomWallet(), zeroAddress, randomWallet(), randomWallet()],
            [randomWallet(), randomWallet(), zeroAddress, randomWallet()],
            [randomWallet(), randomWallet(), randomWallet(), zeroAddress],
        ];

        InitializeCases.forEach((args, index) => {
            it(`should revert initialization with zero address argument, test #${index + 1}`, async function () {
                const implementation = await hhViem.deployContract("BonusScoreSystem");

                await hhViem.assertions.revertWithCustomError(
                    deployProxy(hhViem, "BonusScoreSystem", {
                        initArgs: args,
                        initializer: "initialize",
                    }),
                    implementation,
                    "ZeroAddress",
                );
            });
        });

        it("should not allow re-initialization", async function () {
            const args: Array<Address> =
                [randomWallet(), randomWallet(), randomWallet(), randomWallet()];

            const bonusScoreSystem = await deployProxy(hhViem, "BonusScoreSystem", {
                initArgs: args,
                initializer: "initialize",
            });

            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.initialize([args[0], args[1], args[2], args[3]]),
                bonusScoreSystem,
                "InvalidInitialization",
            );
        });

        ScoringFactors.forEach((args) => {
            it(`should set initial scoring factor ${ScoringFactor[args.factor]}`, async function () {
                const bonusScoreSystem = await deployProxy(hhViem, "BonusScoreSystem", {
                    initArgs: [randomWallet(), randomWallet(), randomWallet(), randomWallet()],
                    initializer: "initialize",
                });

                assert.equal(
                    await bonusScoreSystem.read.getScoringFactorValue([args.factor]),
                    args.value,
                );
            });
        });
    });

    describe("setStandByFactor (ValueGuards)", async function () {
        it("should initialize with default standByFactor value of 20", async function () {
            const bonusScoreSystem = await deployProxy(hhViem, "BonusScoreSystem", {
                initArgs: [randomWallet(), randomWallet(), randomWallet(), randomWallet()],
                initializer: "initialize",
            });

            assert.equal(await bonusScoreSystem.read.standByFactor(), 20n);
        });

        it("should restrict calling to contract owner", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[2];

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                bonusScoreSystem.write.setStandByFactor([25n], { account: caller.account }),
                bonusScoreSystem,
                "OwnableUnauthorizedAccount",
                [caller.account.address],
            );
        });

        it("should allow single step increase from default value (20 to 25)", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await hhViem.assertions.emitWithArgs(
                bonusScoreSystem.write.setStandByFactor([25n]),
                bonusScoreSystem,
                "SetStandByFactor",
                [25n],
            );

            assert.equal(await bonusScoreSystem.read.standByFactor(), 25n);
            assert.equal(
                await bonusScoreSystem.read.getScoringFactorValue([ScoringFactor.StandByBonus]),
                25n,
            );
        });

        it("should allow single step decrease from default value (20 to 15)", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await hhViem.assertions.emitWithArgs(
                bonusScoreSystem.write.setStandByFactor([15n]),
                bonusScoreSystem,
                "SetStandByFactor",
                [15n],
            );

            assert.equal(await bonusScoreSystem.read.standByFactor(), 15n);
            assert.equal(
                await bonusScoreSystem.read.getScoringFactorValue([ScoringFactor.StandByBonus]),
                15n,
            );
        });

        const OutOfRangeCases = [
            { name: "should reject multi-step changes (20 to 30)", value: 30n },
            { name: "should reject multi-step changes (20 to 10)", value: 10n },
            { name: "should reject values outside allowed range (5)", value: 5n },
            { name: "should reject values outside allowed range (55)", value: 55n },
            { name: "should reject non-step values within range (22)", value: 22n },
        ];

        OutOfRangeCases.forEach((testCase) => {
            it(testCase.name, async function () {
                const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

                await hhViem.assertions.revertWithCustomErrorWithArgs(
                    bonusScoreSystem.write.setStandByFactor([testCase.value]),
                    bonusScoreSystem,
                    "NewValueOutOfRange",
                    [testCase.value],
                );
            });
        });

        it("should allow step-by-step traversal to minimum value (20 → 15 → 10)", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            // First step: 20 → 15
            await bonusScoreSystem.write.setStandByFactor([15n]);
            assert.equal(await bonusScoreSystem.read.standByFactor(), 15n);

            // Second step: 15 → 10
            await bonusScoreSystem.write.setStandByFactor([10n]);
            assert.equal(await bonusScoreSystem.read.standByFactor(), 10n);

            // Verify we can't go below minimum
            await hhViem.assertions.revertWithCustomErrorWithArgs(
                bonusScoreSystem.write.setStandByFactor([5n]),
                bonusScoreSystem,
                "NewValueOutOfRange",
                [5n],
            );
        });

        it("should allow step-by-step traversal to maximum value (20 → 25 → 30 → 35 → 40 → 45 → 50)", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const steps = [25n, 30n, 35n, 40n, 45n, 50n];

            for (const step of steps) {
                await bonusScoreSystem.write.setStandByFactor([step]);
                assert.equal(await bonusScoreSystem.read.standByFactor(), step);
            }

            // Verify we can't go above maximum
            await hhViem.assertions.revertWithCustomErrorWithArgs(
                bonusScoreSystem.write.setStandByFactor([55n]),
                bonusScoreSystem,
                "NewValueOutOfRange",
                [55n],
            );
        });

        it("should allow bidirectional movement between adjacent values", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            // Start at 20, go to 25
            await bonusScoreSystem.write.setStandByFactor([25n]);
            assert.equal(await bonusScoreSystem.read.standByFactor(), 25n);

            // Go back to 20
            await bonusScoreSystem.write.setStandByFactor([20n]);
            assert.equal(await bonusScoreSystem.read.standByFactor(), 20n);

            // Go to 15
            await bonusScoreSystem.write.setStandByFactor([15n]);
            assert.equal(await bonusScoreSystem.read.standByFactor(), 15n);

            // Go back to 20
            await bonusScoreSystem.write.setStandByFactor([20n]);
            assert.equal(await bonusScoreSystem.read.standByFactor(), 20n);
        });

        it("should validate transitions from boundary values", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            // Navigate to minimum value (10)
            await bonusScoreSystem.write.setStandByFactor([15n]);
            await bonusScoreSystem.write.setStandByFactor([10n]);

            // From 10, can only go to 15
            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.setStandByFactor([5n]),
                bonusScoreSystem,
                "NewValueOutOfRange",
            );

            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.setStandByFactor([20n]),
                bonusScoreSystem,
                "NewValueOutOfRange",
            );

            await bonusScoreSystem.write.setStandByFactor([15n]);
            assert.equal(await bonusScoreSystem.read.standByFactor(), 15n);

            // Navigate to maximum value (50)
            const stepsToMax = [20n, 25n, 30n, 35n, 40n, 45n, 50n];
            for (const step of stepsToMax) {
                await bonusScoreSystem.write.setStandByFactor([step]);
            }

            // From 50, can only go to 45
            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.setStandByFactor([55n]),
                bonusScoreSystem,
                "NewValueOutOfRange",
            );

            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.setStandByFactor([40n]),
                bonusScoreSystem,
                "NewValueOutOfRange",
            );

            await bonusScoreSystem.write.setStandByFactor([45n]);
            assert.equal(await bonusScoreSystem.read.standByFactor(), 45n);
        });

        it("should validate all allowed values can be set in sequence", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const allowedValues = [10n, 15n, 20n, 25n, 30n, 35n, 40n, 45n, 50n];

            // Test ascending sequence
            let currentValue = 20n; // starting value
            for (let i = allowedValues.indexOf(currentValue) + 1; i < allowedValues.length; i++) {
                await bonusScoreSystem.write.setStandByFactor([allowedValues[i]]);
                assert.equal(await bonusScoreSystem.read.standByFactor(), allowedValues[i]);
                currentValue = allowedValues[i];
            }

            // Test descending sequence
            for (let i = allowedValues.indexOf(currentValue) - 1; i >= 0; i--) {
                await bonusScoreSystem.write.setStandByFactor([allowedValues[i]]);
                assert.equal(await bonusScoreSystem.read.standByFactor(), allowedValues[i]);
                currentValue = allowedValues[i];
            }
        });

        it("should update internal _factors mapping when standByFactor changes", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            // Initial state
            assert.equal(
                await bonusScoreSystem.read.getScoringFactorValue([ScoringFactor.StandByBonus]),
                20n,
            );

            // Change to 25
            await bonusScoreSystem.write.setStandByFactor([25n]);
            assert.equal(
                await bonusScoreSystem.read.getScoringFactorValue([ScoringFactor.StandByBonus]),
                25n,
            );

            // Change to 30
            await bonusScoreSystem.write.setStandByFactor([30n]);
            assert.equal(
                await bonusScoreSystem.read.getScoringFactorValue([ScoringFactor.StandByBonus]),
                30n,
            );
        });
    });

    describe("getScoringFactorValue", async function () {
        it("should revert for unknown scoring factor", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const unknownFactor = ScoringFactor.BadPerformancePenalty + 1;

            await hhViem.assertions.revert(
                bonusScoreSystem.read.getScoringFactorValue([unknownFactor]),
            );
        });

        it("should get scoring factor value", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            assert.equal(
                await bonusScoreSystem.read.getScoringFactorValue([ScoringFactor.BadPerformancePenalty]),
                await bonusScoreSystem.read.DEFAULT_BAD_PERF_FACTOR(),
            );
        });
    });

    describe("getTimePerScorePoint", async function () {
        ScoringFactors.forEach((args) => {
            it(`should get time per ${ScoringFactor[args.factor]} factor point`, async function () {
                const { bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);
                const fixedEpochDuration = await stakingHbbft.read.stakingFixedEpochDuration();

                const expected = fixedEpochDuration / args.value;

                assert.equal(
                    await bonusScoreSystem.read.getTimePerScorePoint([args.factor]),
                    expected,
                );
            });
        });
    });

    describe("getValidatorScore", async function () {
        it("should return MIN_SCORE if not previously recorded", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = randomWallet();

            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), MIN_SCORE);
        });
    });

    describe("rewardStandBy", async function () {
        it("should restrict calling to ValidatorSet contract", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[2];

            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.rewardStandBy(
                    [randomWallet(), 100n],
                    { account: caller.account },
                ),
                bonusScoreSystem,
                "Unauthorized",
            );
        });

        it("should revert for availability timestamp in the future", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();
            const availableSince = (await publicClient.getBlock()).timestamp;

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());

            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.rewardStandBy(
                    [validator, availableSince + 5n],
                    { account: validatorSet },
                ),
                bonusScoreSystem,
                "InvalidIntervalStartTimestamp",
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should increase validator score depending on stand by interval", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();
            const availableSince = (await publicClient.getBlock()).timestamp;

            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), MIN_SCORE);

            const standByTime = 6n * 60n * 60n; // 6 hours

            const timePerPoint =
                await bonusScoreSystem.read.getTimePerScorePoint([ScoringFactor.StandByBonus]);
            const expectedScore = standByTime / timePerPoint + MIN_SCORE;

            await helpers.time.increase(standByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());
            await bonusScoreSystem.write.rewardStandBy(
                [validator, availableSince],
                { account: validatorSet },
            );
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), expectedScore);

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should emit event", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();
            const availableSince = (await publicClient.getBlock()).timestamp;

            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), MIN_SCORE);

            const standByTime = 1n * 60n * 60n; // 1 hours

            const timePerPoint =
                await bonusScoreSystem.read.getTimePerScorePoint([ScoringFactor.StandByBonus]);
            const expectedScore = standByTime / timePerPoint + MIN_SCORE;

            await helpers.time.increase(standByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());

            await hhViem.assertions.emitWithArgs(
                bonusScoreSystem.write.rewardStandBy(
                    [validator, availableSince],
                    { account: validatorSet },
                ),
                bonusScoreSystem,
                "ValidatorScoreChanged",
                [getAddress(validator), ScoringFactor.StandByBonus, expectedScore],
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should not exceed MAX_SCORE", async function () {
            const { initialValidators, bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();
            const availableSince = (await publicClient.getBlock()).timestamp;

            const initialScore = MAX_SCORE - 2n;
            await increaseScore(bonusScoreSystem, validator, initialScore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), initialScore);

            const standByTime = await stakingHbbft.read.stakingFixedEpochDuration();

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());

            await helpers.time.increase(standByTime + 1n);

            await bonusScoreSystem.write.rewardStandBy(
                [validator, availableSince],
                { account: validatorSet },
            );
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), MAX_SCORE);

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should use last score change timestamp if its higher than availability timestamp", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();
            const availableSince = (await publicClient.getBlock()).timestamp;

            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), MIN_SCORE);

            let standByTime = 6n * 60n * 60n; // 6 hours

            const timePerPoint =
                await bonusScoreSystem.read.getTimePerScorePoint([ScoringFactor.StandByBonus]);
            const expectedScore = standByTime / timePerPoint + MIN_SCORE;

            await helpers.time.increase(standByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());
            await bonusScoreSystem.write.rewardStandBy(
                [validator, availableSince],
                { account: validatorSet },
            );
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), expectedScore);

            const additionalPoints = 5n;
            standByTime = timePerPoint * additionalPoints; // time to accumulate 5 stand by points

            await helpers.time.increase(standByTime);
            await bonusScoreSystem.write.rewardStandBy(
                [validator, availableSince],
                { account: validatorSet },
            );
            assert.equal(
                await bonusScoreSystem.read.getValidatorScore([validator]),
                expectedScore + additionalPoints,
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should increase pool likelihood", async function () {
            const { initialValidators, bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const mining = initialValidators[0].miningAddress();
            const staking = initialValidators[0].staking;
            const stakingAddress = staking.address;
            const canidateStake = await stakingHbbft.read.candidateMinStake();

            const availableSince = (await publicClient.getBlock()).timestamp;

            assert.equal(await bonusScoreSystem.read.getValidatorScore([mining]), MIN_SCORE);

            await stakingHbbft.write.stake(
                [stakingAddress],
                { account: staking, value: canidateStake },
            );

            assert.equal(await getPoolLikelihood(stakingHbbft, stakingAddress), canidateStake);

            const standByTime = 1n * 60n * 60n; // 1 hours

            const timePerPoint =
                await bonusScoreSystem.read.getTimePerScorePoint([ScoringFactor.StandByBonus]);
            const expectedScore = standByTime / timePerPoint + MIN_SCORE;

            await helpers.time.increase(standByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());
            await bonusScoreSystem.write.rewardStandBy(
                [mining, availableSince],
                { account: validatorSet },
            );
            assert.equal(await bonusScoreSystem.read.getValidatorScore([mining]), expectedScore);

            assert.equal(
                await getPoolLikelihood(stakingHbbft, stakingAddress),
                canidateStake * expectedScore,
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should be non-reentrant", async function () {
            const { initialValidators, reentrancyAttacker } = await helpers.loadFixture(deployContracts);

            const bonusScoreSystem = await deployProxy(hhViem, "BonusScoreSystem", {
                initArgs: [
                    owner.account.address,
                    reentrancyAttacker.address, // _validatorSetHbbft
                    randomWallet(),             // _connectivityTracker
                    reentrancyAttacker.address, // _stakingContract
                ],
                initializer: "initialize",
            });

            const selector = toFunctionSelector("rewardStandBy(address,uint256)");

            await reentrancyAttacker.write.setBonusScoreContract([bonusScoreSystem.address]);
            await reentrancyAttacker.write.setFuncId([selector]);

            const mining = initialValidators[0].miningAddress();
            const timestamp = await helpers.time.latest();

            await helpers.time.increase(1000);

            await hhViem.assertions.revertWithCustomError(
                reentrancyAttacker.write.attack([mining, BigInt(timestamp)]),
                bonusScoreSystem,
                "ReentrancyGuardReentrantCall",
            );
        });
    });

    describe("penaliseNoStandBy", async function () {
        it("should restrict calling to ValidatorSet contract", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[3];

            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.penaliseNoStandBy(
                    [randomWallet(), 100n],
                    { account: caller.account },
                ),
                bonusScoreSystem,
                "Unauthorized",
            );
        });

        it("should revert for availability timestamp in the future", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();
            const availableSince = (await publicClient.getBlock()).timestamp;

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());

            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.penaliseNoStandBy(
                    [validator, availableSince + 5n],
                    { account: validatorSet },
                ),
                bonusScoreSystem,
                "InvalidIntervalStartTimestamp",
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should decrease validator score depending on no stand by interval", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();

            const scoreBefore = 110n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), scoreBefore);

            const unavailableSince = (await publicClient.getBlock()).timestamp;
            const noStandByTime = 6n * 60n * 60n; // 6 hours

            const timePerPoint =
                await bonusScoreSystem.read.getTimePerScorePoint([ScoringFactor.NoStandByPenalty]);
            const scorePenalty = noStandByTime / timePerPoint;

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());
            await bonusScoreSystem.write.penaliseNoStandBy(
                [validator, unavailableSince],
                { account: validatorSet },
            );
            assert.equal(
                await bonusScoreSystem.read.getValidatorScore([validator]),
                scoreBefore - scorePenalty,
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should emit event", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();
            const scoreBefore = 110n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), scoreBefore);

            const unavailableSince = (await publicClient.getBlock()).timestamp;
            const noStandByTime = 1n * 60n * 60n; // 1 hours

            const timePerPoint =
                await bonusScoreSystem.read.getTimePerScorePoint([ScoringFactor.NoStandByPenalty]);
            const scoreAfter = scoreBefore - noStandByTime / timePerPoint;

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());

            await hhViem.assertions.emitWithArgs(
                bonusScoreSystem.write.penaliseNoStandBy(
                    [validator, unavailableSince],
                    { account: validatorSet },
                ),
                bonusScoreSystem,
                "ValidatorScoreChanged",
                [getAddress(validator), ScoringFactor.NoStandByPenalty, scoreAfter],
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should not decrease below MIN_SCORE", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();

            const initialScore = MIN_SCORE + 1n;
            await increaseScore(bonusScoreSystem, validator, initialScore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), initialScore);

            const unavailableSince = (await publicClient.getBlock()).timestamp;
            const noStandByTime = 12n * 60n * 60n; // 12 hours

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());
            await bonusScoreSystem.write.penaliseNoStandBy(
                [validator, unavailableSince],
                { account: validatorSet },
            );
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), MIN_SCORE);

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should use last score change timestamp if its higher than availability timestamp", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();
            const initialScore = 250n;
            await increaseScore(bonusScoreSystem, validator, initialScore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), initialScore);

            const unavailableSince = (await publicClient.getBlock()).timestamp;
            let noStandByTime = 10n * 60n * 60n; // 10 hours

            const timePerPoint =
                await bonusScoreSystem.read.getTimePerScorePoint([ScoringFactor.NoStandByPenalty]);
            const expectedScore = initialScore - noStandByTime / timePerPoint;

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());
            await bonusScoreSystem.write.penaliseNoStandBy(
                [validator, unavailableSince],
                { account: validatorSet },
            );
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), expectedScore);

            const additionalPenatlies = 5n;
            noStandByTime = timePerPoint * additionalPenatlies; // time to accumulate 5 no stand by points

            await helpers.time.increase(noStandByTime);
            await bonusScoreSystem.write.penaliseNoStandBy(
                [validator, unavailableSince],
                { account: validatorSet },
            );
            assert.equal(
                await bonusScoreSystem.read.getValidatorScore([validator]),
                expectedScore - additionalPenatlies,
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should decrease pool likelihood", async function () {
            const { initialValidators, bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const canidateStake = await stakingHbbft.read.candidateMinStake();

            await stakingHbbft.write.stake(
                [validator.stakingAddress()],
                { account: validator.staking, value: canidateStake },
            );

            const initialScore = 250n;
            await increaseScore(bonusScoreSystem, validator.miningAddress(), initialScore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator.miningAddress()]), initialScore);
            assert.equal(
                await getPoolLikelihood(stakingHbbft, validator.stakingAddress()),
                canidateStake * initialScore,
            );

            const unavailableSince = (await publicClient.getBlock()).timestamp;
            const noStandByTime = 10n * 60n * 60n; // 10 hours

            const timePerPoint =
                await bonusScoreSystem.read.getTimePerScorePoint([ScoringFactor.NoStandByPenalty]);
            const expectedScore = initialScore - noStandByTime / timePerPoint;

            await helpers.time.increase(noStandByTime);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());

            await bonusScoreSystem.write.penaliseNoStandBy(
                [validator.miningAddress(), unavailableSince],
                { account: validatorSet },
            );
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator.miningAddress()]), expectedScore);
            assert.equal(
                await getPoolLikelihood(stakingHbbft, validator.stakingAddress()),
                canidateStake * expectedScore,
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should be non-reentrant", async function () {
            const { initialValidators, reentrancyAttacker } = await helpers.loadFixture(deployContracts);

            const bonusScoreSystem = await deployProxy(hhViem, "BonusScoreSystem", {
                initArgs: [
                    owner.account.address,
                    reentrancyAttacker.address, // _validatorSetHbbft
                    randomWallet(),             // _connectivityTracker
                    reentrancyAttacker.address, // _stakingContract
                ],
                initializer: "initialize",
            });

            const selector = toFunctionSelector("penaliseNoStandBy(address,uint256)");

            await reentrancyAttacker.write.setBonusScoreContract([bonusScoreSystem.address]);
            await reentrancyAttacker.write.setFuncId([selector]);

            const mining = initialValidators[0].miningAddress();
            const timestamp = await helpers.time.latest();

            await helpers.time.increase(1000);

            await hhViem.assertions.revertWithCustomError(
                reentrancyAttacker.write.attack([mining, BigInt(timestamp)]),
                bonusScoreSystem,
                "ReentrancyGuardReentrantCall",
            );
        });
    });

    describe("penaliseNoKeyWrite", async function () {
        it("should restrict calling to ValidatorSet contract", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[4];

            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.penaliseNoKeyWrite(
                    [randomWallet()],
                    { account: caller.account },
                ),
                bonusScoreSystem,
                "Unauthorized",
            );
        });

        it("should decrease validator score", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();

            const scoreBefore = 110n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), scoreBefore);

            const expectedScore = scoreBefore - NO_KEY_WRITE_PENALTY;

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());
            await bonusScoreSystem.write.penaliseNoKeyWrite([validator], { account: validatorSet });
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), expectedScore);

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should not decrease below MIN_SCORE", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();

            const scoreBefore = 100n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), scoreBefore);

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());
            await bonusScoreSystem.write.penaliseNoKeyWrite([validator], { account: validatorSet });
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), MIN_SCORE);

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should emit event", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();

            const scoreBefore = 110n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), scoreBefore);

            const expectedScore = scoreBefore - NO_KEY_WRITE_PENALTY;

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());

            await hhViem.assertions.emitWithArgs(
                bonusScoreSystem.write.penaliseNoKeyWrite([validator], { account: validatorSet }),
                bonusScoreSystem,
                "ValidatorScoreChanged",
                [getAddress(validator), ScoringFactor.NoKeyWritePenalty, expectedScore],
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should decrease pool likelihood", async function () {
            const { initialValidators, bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const canidateStake = await stakingHbbft.read.candidateMinStake();

            await stakingHbbft.write.stake(
                [validator.stakingAddress()],
                { account: validator.staking, value: canidateStake },
            );

            const bonusScoreBefore = 110n;
            const bonusScoreAfter = bonusScoreBefore - NO_KEY_WRITE_PENALTY;
            await increaseScore(bonusScoreSystem, validator.miningAddress(), bonusScoreBefore);

            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator.miningAddress()]), bonusScoreBefore);
            assert.equal(
                await getPoolLikelihood(stakingHbbft, validator.stakingAddress()),
                canidateStake * bonusScoreBefore,
            );

            const validatorSet = await impersonateAcc(await bonusScoreSystem.read.validatorSetHbbft());
            await bonusScoreSystem.write.penaliseNoKeyWrite([validator.miningAddress()], { account: validatorSet });

            const stakeAmount = await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]);
            assert.equal(
                await getPoolLikelihood(stakingHbbft, validator.stakingAddress()),
                stakeAmount * bonusScoreAfter,
            );

            await helpers.stopImpersonatingAccount(validatorSet);
        });

        it("should be non-reentrant", async function () {
            const { initialValidators, reentrancyAttacker } = await helpers.loadFixture(deployContracts);

            const bonusScoreSystem = await deployProxy(hhViem, "BonusScoreSystem", {
                initArgs: [
                    owner.account.address,
                    reentrancyAttacker.address, // _validatorSetHbbft
                    randomWallet(),             // _connectivityTracker
                    reentrancyAttacker.address, // _stakingContract
                ],
                initializer: "initialize",
            });

            const selector = toFunctionSelector("penaliseNoKeyWrite(address)");

            await reentrancyAttacker.write.setBonusScoreContract([bonusScoreSystem.address]);
            await reentrancyAttacker.write.setFuncId([selector]);

            const mining = initialValidators[0].miningAddress();
            const timestamp = await helpers.time.latest();

            await helpers.time.increase(1000);

            await hhViem.assertions.revertWithCustomError(
                reentrancyAttacker.write.attack([mining, BigInt(timestamp)]),
                bonusScoreSystem,
                "ReentrancyGuardReentrantCall",
            );
        });
    });

    describe("penaliseBadPerformance", async function () {
        it("should restrict calling to ConnectivityTracker contract", async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[5];

            await hhViem.assertions.revertWithCustomError(
                bonusScoreSystem.write.penaliseBadPerformance(
                    [randomWallet(), 100n],
                    { account: caller.account },
                ),
                bonusScoreSystem,
                "Unauthorized",
            );
        });

        it("should decrease validator score depending on disconnect interval", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();

            const scoreBefore = 150n;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), scoreBefore);

            const lostPoints = 60n;
            const timePerPoint =
                await bonusScoreSystem.read.getTimePerScorePoint([ScoringFactor.BadPerformancePenalty]);
            const disconnectInterval = lostPoints * timePerPoint;

            const connectivityTracker =
                await impersonateAcc(await bonusScoreSystem.read.connectivityTracker());
            await bonusScoreSystem.write.penaliseBadPerformance(
                [validator, disconnectInterval],
                { account: connectivityTracker },
            );
            assert.equal(
                await bonusScoreSystem.read.getValidatorScore([validator]),
                scoreBefore - lostPoints,
            );

            await helpers.stopImpersonatingAccount(connectivityTracker);
        });

        it("should fully penalise for bad performance", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();

            const scoreBefore = 150n;
            const scoreAfter = scoreBefore - BAD_PERFORMANCE_PENALTY;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), scoreBefore);

            const connectivityTracker =
                await impersonateAcc(await bonusScoreSystem.read.connectivityTracker());
            await bonusScoreSystem.write.penaliseBadPerformance(
                [validator, 0n],
                { account: connectivityTracker },
            );
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), scoreAfter);

            await helpers.stopImpersonatingAccount(connectivityTracker);
        });

        it("should emit event", async function () {
            const { initialValidators, bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();

            const scoreBefore = 150n;
            const scoreAfter = scoreBefore - BAD_PERFORMANCE_PENALTY;
            await increaseScore(bonusScoreSystem, validator, scoreBefore);
            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator]), scoreBefore);

            const connectivityTracker =
                await impersonateAcc(await bonusScoreSystem.read.connectivityTracker());

            await hhViem.assertions.emitWithArgs(
                bonusScoreSystem.write.penaliseBadPerformance(
                    [validator, 0n],
                    { account: connectivityTracker },
                ),
                bonusScoreSystem,
                "ValidatorScoreChanged",
                [getAddress(validator), ScoringFactor.BadPerformancePenalty, scoreAfter],
            );

            await helpers.stopImpersonatingAccount(connectivityTracker);
        });

        it("should decrease pool likelihood", async function () {
            const { initialValidators, bonusScoreSystem, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];
            const canidateStake = await stakingHbbft.read.candidateMinStake();

            await stakingHbbft.write.stake(
                [validator.stakingAddress()],
                { account: validator.staking, value: canidateStake },
            );

            const bonusScoreBefore = 210n;
            const bonusScoreAfter = bonusScoreBefore - BAD_PERFORMANCE_PENALTY;
            await increaseScore(bonusScoreSystem, validator.miningAddress(), bonusScoreBefore);

            assert.equal(await bonusScoreSystem.read.getValidatorScore([validator.miningAddress()]), bonusScoreBefore);
            assert.equal(
                await getPoolLikelihood(stakingHbbft, validator.stakingAddress()),
                canidateStake * bonusScoreBefore,
            );

            const connectivityTracker =
                await impersonateAcc(await bonusScoreSystem.read.connectivityTracker());
            await bonusScoreSystem.write.penaliseBadPerformance(
                [validator.miningAddress(), 0n],
                { account: connectivityTracker },
            );

            const stakeAmount = await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]);
            assert.equal(
                await getPoolLikelihood(stakingHbbft, validator.stakingAddress()),
                stakeAmount * bonusScoreAfter,
            );

            await helpers.stopImpersonatingAccount(connectivityTracker);
        });

        it("should be non-reentrant", async function () {
            const { initialValidators, validatorSetHbbft, reentrancyAttacker } = await helpers.loadFixture(deployContracts);

            const bonusScoreSystem = await deployProxy(hhViem, "BonusScoreSystem", {
                initArgs: [
                    owner.account.address,
                    validatorSetHbbft.address,  // _validatorSetHbbft
                    reentrancyAttacker.address, // _connectivityTracker
                    reentrancyAttacker.address, // _stakingContract
                ],
                initializer: "initialize",
            });

            const selector = toFunctionSelector("penaliseBadPerformance(address,uint256)");

            await reentrancyAttacker.write.setBonusScoreContract([bonusScoreSystem.address]);
            await reentrancyAttacker.write.setFuncId([selector]);

            const mining = initialValidators[0].miningAddress();
            const timestamp = await helpers.time.latest();

            await helpers.time.increase(1000);

            await hhViem.assertions.revertWithCustomError(
                reentrancyAttacker.write.attack([mining, BigInt(timestamp)]),
                bonusScoreSystem,
                "ReentrancyGuardReentrantCall",
            );
        });
    });
});
