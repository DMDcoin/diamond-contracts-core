import assert from "node:assert/strict";
import { describe, it, before, beforeEach } from "node:test";
import hre from "hardhat";

import {
    getAddress,
    parseEther,
    parseEventLogs,
    zeroAddress,
    type Account,
    type Address,
    type Hex,
} from "viem";

import type { } from "../artifacts/contracts/RandomHbbft.sol/artifacts.js";
import type { } from "../artifacts/contracts/KeyGenHistory.sol/artifacts.js";
import type { } from "../artifacts/contracts/mocks/BlockRewardHbbftMock.sol/artifacts.js";
import type { } from "../artifacts/contracts/mocks/BonusScoreSystemMock.sol/artifacts.js";
import type { } from "../artifacts/contracts/mocks/ConnectivityTrackerHbbftMock.sol/artifacts.js";
import type { } from "../artifacts/contracts/mocks/StakingHbbftMock.sol/artifacts.js";
import type { } from "../artifacts/contracts/mocks/ValidatorSetHbbftMock.sol/artifacts.js";

import { getNValidatorsPartNAcks } from "./fixtures/data.js";
import { deployDao } from "./fixtures/dao.js";
import { createNetworkFixtures, SystemAccountAddress } from "./fixtures/network.js";
import { deployProxy } from "./fixtures/proxy.js";
import { assertCloseTo, splitPublicKeys } from "./fixtures/utils.js";
import { createRandomWallet } from "./fixtures/wallet.js";
import { Validator } from "./fixtures/validator.js";
import type { BlockRewardHbbftMock, StakingHbbftMock, ValidatorSetHbbftMock } from "./fixtures/types.js";

const connection = await hre.network.getOrCreate();
const { viem: hhViem, networkHelpers: helpers } = connection;

const networkFixtures = createNetworkFixtures(connection);
const { impersonateAcc, timeTravelToTransition } = networkFixtures;

// StakingHbbft tests emulate native coins minting on epoch end blocks.
const callReward = (blockReward: BlockRewardHbbftMock, isEpochEndBlock: boolean) =>
    networkFixtures.callReward(blockReward, isEpochEndBlock, true);

const timeTravelToEndEpoch = (blockReward: BlockRewardHbbftMock, staking: StakingHbbftMock) =>
    networkFixtures.timeTravelToEndEpoch(blockReward, staking, true);

const publicClient = await hhViem.getPublicClient();
type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

describe("StakingHbbft", () => {
    let owner: TestWalletClient;
    let accounts: TestWalletClient[];

    let initialValidators: Validator[];
    let candidate: Validator;

    const minStake = parseEther("100");
    const minStakeDelegators = parseEther("100");
    const maxStake = parseEther("50000");

    // one epoch in 1 day.
    const stakingFixedEpochDuration = 86400n;

    // the transition time window is 1 hour.
    const stakingTransitionTimeframeLength = 3600n;
    const stakingWithdrawDisallowPeriod = 1n;

    const validatorInactivityThreshold = 365n * 86400n; // 1 year

    async function deployContractsFixture() {
        const stubAddress = owner.account.address;

        const initStakingAddresses = initialValidators.map((x) => x.stakingAddress());
        const initMiningAddresses = initialValidators.map((x) => x.miningAddress());
        const initPublicKeys = splitPublicKeys(initialValidators.map((x) => x.publicKey()));

        await deployDao();

        const bonusScoreContractMock = await hhViem.deployContract("BonusScoreSystemMock");
        const connectivityTracker = await hhViem.deployContract("ConnectivityTrackerHbbftMock");

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: bonusScoreContractMock.address,
            connectivityTrackerContract: connectivityTracker.address,
            validatorInactivityThreshold: validatorInactivityThreshold,
        };

        // Deploy ValidatorSet contract
        const validatorSetHbbft = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
            initArgs: [
                owner.account.address,
                validatorSetParams,
                initMiningAddresses,  // _initialMiningAddresses
                initStakingAddresses, // _initialStakingAddresses
            ],
            initializer: "initialize",
        });

        // Deploy BlockRewardHbbft contract
        const blockRewardHbbft = await deployProxy(hhViem, "BlockRewardHbbftMock", {
            initArgs: [owner.account.address, validatorSetHbbft.address, connectivityTracker.address],
            initializer: "initialize",
        });

        await validatorSetHbbft.write.setBlockRewardContract([blockRewardHbbft.address]);

        const randomHbbft = await deployProxy(hhViem, "RandomHbbft", {
            initArgs: [owner.account.address, validatorSetHbbft.address],
            initializer: "initialize",
        });

        const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

        const keyGenHistory = await deployProxy(hhViem, "KeyGenHistory", {
            initArgs: [owner.account.address, validatorSetHbbft.address, initMiningAddresses, parts, acks],
            initializer: "initialize",
        });

        const stakingParams = {
            _validatorSetContract: validatorSetHbbft.address,
            _bonusScoreContract: bonusScoreContractMock.address,
            _initialStakingAddresses: initStakingAddresses,
            _delegatorMinStake: minStakeDelegators,
            _candidateMinStake: minStake,
            _maxStake: maxStake,
            _stakingFixedEpochDuration: stakingFixedEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
            _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod,
        };

        const stakingHbbft = await deployProxy(hhViem, "StakingHbbftMock", {
            initArgs: [
                owner.account.address,
                stakingParams,
                initPublicKeys,                            // _publicKeys
                initialValidators.map((x) => x.ipAddress), // _internetAddresses
            ],
            initializer: "initialize",
        });

        await validatorSetHbbft.write.setRandomContract([randomHbbft.address]);
        await validatorSetHbbft.write.setStakingContract([stakingHbbft.address]);
        await validatorSetHbbft.write.setKeyGenHistoryContract([keyGenHistory.address]);

        const delegatorMinStake = await stakingHbbft.read.delegatorMinStake();
        const candidateMinStake = await stakingHbbft.read.candidateMinStake();

        return {
            validatorSetHbbft,
            stakingHbbft,
            blockRewardHbbft,
            randomHbbft,
            keyGenHistory,
            candidateMinStake,
            delegatorMinStake,
        };
    }

    before(async function () {
        [owner, ...accounts] = await hhViem.getWalletClients();

        initialValidators = new Array<Validator>();
        for (let i = 0; i < 3; ++i) {
            const validator = await Validator.create();
            initialValidators.push(validator);
        }

        candidate = await Validator.create();

        assert.equal(initialValidators.length, 3);
    });

    describe("addPool", async function () {
        it("should create a new pool and emit event", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            assert.equal(await stakingHbbft.read.isPoolActive([candidate.stakingAddress()]), false);

            const stakingEpoch = await stakingHbbft.read.stakingEpoch();

            await hhViem.assertions.emitWithArgs(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: candidate.staking, value: minStake },
                ),
                stakingHbbft,
                "PlacedStake",
                [candidate.stakingAddress(), candidate.stakingAddress(), stakingEpoch, minStake],
            );

            assert.equal(await stakingHbbft.read.isPoolActive([candidate.stakingAddress()]), true);
        });

        it("should create pool and set node operator configuration", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            assert.equal(await stakingHbbft.read.isPoolActive([candidate.stakingAddress()]), false);

            const nodeOperator = getAddress(accounts[10].account.address);
            const nodeOperatorShare = 2000n;

            await hhViem.assertions.emitWithArgs(
                stakingHbbft.write.addPool(
                    [
                        candidate.miningAddress(),
                        nodeOperator,
                        nodeOperatorShare,
                        candidate.publicKey(),
                        candidate.ipAddress,
                    ],
                    { account: candidate.staking, value: minStake },
                ),
                stakingHbbft,
                "SetNodeOperator",
                [candidate.stakingAddress(), nodeOperator, nodeOperatorShare],
            );

            assert.equal(await stakingHbbft.read.isPoolActive([candidate.stakingAddress()]), true);
            assert.equal(await stakingHbbft.read.poolNodeOperator([candidate.stakingAddress()]), nodeOperator);
            assert.equal(
                await stakingHbbft.read.poolNodeOperatorShare([candidate.stakingAddress()]),
                nodeOperatorShare,
            );
        });

        it("should fail if created with overstaked pool", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: candidate.staking, value: maxStake + minStake },
                ),
                stakingHbbft,
                "PoolStakeLimitExceeded",
                [candidate.stakingAddress(), candidate.stakingAddress()],
            );
        });

        it("should fail if mining address is 0", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [zeroAddress, zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: candidate.staking, value: minStake },
                ),
                stakingHbbft,
                "ZeroAddress",
            );
        });

        it("should fail if mining address is equal to staking", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.stakingAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: candidate.staking, value: minStake },
                ),
                validatorSetHbbft,
                "InvalidAddressPair",
            );
        });

        it("should fail if the pool with the same mining/staking address is already existing", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const otherCandidate = await Validator.create();

            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: minStake },
            );

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, otherCandidate.publicKey(), otherCandidate.ipAddress],
                    { account: otherCandidate.staking, value: minStake },
                ),
                validatorSetHbbft,
                "MiningAddressAlreadyUsed",
            );

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [
                        otherCandidate.miningAddress(),
                        zeroAddress,
                        0n,
                        otherCandidate.publicKey(),
                        otherCandidate.ipAddress,
                    ],
                    { account: candidate.staking, value: minStake },
                ),
                validatorSetHbbft,
                "StakingAddressAlreadyUsed",
            );

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.stakingAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: otherCandidate.mining, value: minStake },
                ),
                validatorSetHbbft,
                "MiningAddressAlreadyUsed",
            );

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [otherCandidate.stakingAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: candidate.mining, value: minStake },
                ),
                validatorSetHbbft,
                "StakingAddressAlreadyUsed",
            );

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: otherCandidate.mining, value: minStake },
                ),
                validatorSetHbbft,
                "MiningAddressAlreadyUsed",
            );

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [
                        otherCandidate.miningAddress(),
                        zeroAddress,
                        0n,
                        otherCandidate.publicKey(),
                        otherCandidate.ipAddress,
                    ],
                    { account: candidate.mining, value: minStake },
                ),
                validatorSetHbbft,
                "StakingAddressAlreadyUsed",
            );

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.stakingAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: otherCandidate.staking, value: minStake },
                ),
                validatorSetHbbft,
                "MiningAddressAlreadyUsed",
            );

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [
                        otherCandidate.stakingAddress(),
                        zeroAddress,
                        0n,
                        otherCandidate.publicKey(),
                        otherCandidate.ipAddress,
                    ],
                    { account: candidate.staking, value: minStake },
                ),
                validatorSetHbbft,
                "StakingAddressAlreadyUsed",
            );

            await stakingHbbft.write.addPool(
                [
                    otherCandidate.miningAddress(),
                    zeroAddress,
                    0n,
                    otherCandidate.publicKey(),
                    otherCandidate.ipAddress,
                ],
                { account: otherCandidate.staking, value: minStake },
            );
        });

        it("should fail if gasPrice is 0", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: candidate.staking, value: minStake, gasPrice: 0n },
                ),
                stakingHbbft,
                "ZeroGasPrice",
            );
        });

        it("should fail if staking amount is 0", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: candidate.staking, value: 0n },
                ),
                stakingHbbft,
                "InsufficientStakeAmount",
            );
        });

        it("should fail if staking amount is less than CANDIDATE_MIN_STAKE", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: candidate.staking, value: minStake / 2n },
                ),
                stakingHbbft,
                "InsufficientStakeAmount",
            );
        });

        it("should revert for invalid public key", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const publicKey = (candidate.publicKey().slice(0, -2) + "ff") as Hex;

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, publicKey, candidate.ipAddress],
                    { account: candidate.staking, value: minStake },
                ),
                stakingHbbft,
                "InvalidPublicKey",
            );
        });

        it("should revert if mining address and corresponding public key mismatched", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const otherValidator = await Validator.create();

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, otherValidator.publicKey(), candidate.ipAddress],
                    { account: candidate.staking, value: minStake },
                ),
                stakingHbbft,
                "MiningAddressPublicKeyMismatch",
            );
        });

        it("should increase stake amount", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const amount = minStake * 2n;
            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: amount },
            );

            assert.equal(
                await stakingHbbft.read.stakeAmount([candidate.stakingAddress(), candidate.stakingAddress()]),
                amount,
            );
            assert.equal(
                await stakingHbbft.read.stakeAmountByCurrentEpoch([
                    candidate.stakingAddress(),
                    candidate.stakingAddress(),
                ]),
                amount,
            );
            assert.equal(await stakingHbbft.read.stakeAmountTotal([candidate.stakingAddress()]), amount);
        });

        it("should be able to add more than one pool", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const otherCandidate = await Validator.create();

            const amount1 = minStake * 2n;
            const amount2 = minStake * 3n;

            // Add two new pools
            assert.equal(await stakingHbbft.read.isPoolActive([candidate.stakingAddress()]), false);
            assert.equal(await stakingHbbft.read.isPoolActive([otherCandidate.stakingAddress()]), false);

            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: amount1 },
            );

            await stakingHbbft.write.addPool(
                [
                    otherCandidate.miningAddress(),
                    zeroAddress,
                    0n,
                    otherCandidate.publicKey(),
                    otherCandidate.ipAddress,
                ],
                { account: otherCandidate.staking, value: amount2 },
            );

            assert.equal(await stakingHbbft.read.isPoolActive([candidate.stakingAddress()]), true);
            assert.equal(await stakingHbbft.read.isPoolActive([otherCandidate.stakingAddress()]), true);

            // Check indexes in the `poolsToBeElected` list
            assert.equal(await stakingHbbft.read.poolToBeElectedIndex([candidate.stakingAddress()]), 0n);
            assert.equal(await stakingHbbft.read.poolToBeElectedIndex([otherCandidate.stakingAddress()]), 1n);

            // Check pools' existence
            const validators = await validatorSetHbbft.read.getValidators();

            assert.deepEqual(await stakingHbbft.read.getPools(), [
                await validatorSetHbbft.read.stakingByMiningAddress([validators[0]]),
                await validatorSetHbbft.read.stakingByMiningAddress([validators[1]]),
                await validatorSetHbbft.read.stakingByMiningAddress([validators[2]]),
                candidate.stakingAddress(),
                otherCandidate.stakingAddress(),
            ]);
        });

        it("should not allow adding more than MAX_CANDIDATES pools", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const maxCandidates = await stakingHbbft.read.getMaxCandidates();

            for (let i = initialValidators.length; i < Number(maxCandidates); ++i) {
                // Add a new pool
                await stakingHbbft.write.addPoolActiveMock([createRandomWallet().address]);
            }

            // Try to add a new pool outside of max limit, max limit is 100 in mock contract.
            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.addPool(
                    [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                    { account: candidate.staking, value: minStake },
                ),
                stakingHbbft,
                "MaxPoolsCountExceeded",
            );

            assert.equal(await stakingHbbft.read.isPoolActive([candidate.stakingAddress()]), false);
        });

        it("should remove added pool from the list of inactive pools", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.write.addPoolInactiveMock([candidate.stakingAddress()]);
            assert.deepEqual(await stakingHbbft.read.getPoolsInactive(), [candidate.stakingAddress()]);

            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: minStake },
            );

            assert.equal(await stakingHbbft.read.isPoolActive([candidate.stakingAddress()]), true);
            assert.equal((await stakingHbbft.read.getPoolsInactive()).length, 0);
        });
    });

    describe("setNodeOperator", async function () {
        it("should revert for non-existing pool", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const operator = createRandomWallet().address;
            const share = 1000n;

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.setNodeOperator([operator, share], { account: candidate.staking }),
                stakingHbbft,
                "PoolNotExist",
                [candidate.stakingAddress()],
            );
        });

        it("should not allow to set pool staking address as node operator", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: minStake },
            );

            const share = 1000n;

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.setNodeOperator([candidate.stakingAddress(), share], {
                    account: candidate.staking,
                }),
                stakingHbbft,
                "InvalidNodeOperatorAddress",
                [candidate.stakingAddress()],
            );
        });

        it("should not allow to change node operator twice within same epoch", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: minStake },
            );

            const operator = createRandomWallet().address;
            const share = 1000n;

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await stakingHbbft.write.incrementStakingEpoch({ account: validatorSetCaller });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            await stakingHbbft.write.setNodeOperator([operator, share], { account: candidate.staking });
            assert.equal(await stakingHbbft.read.poolNodeOperator([candidate.stakingAddress()]), operator);
            assert.equal(await stakingHbbft.read.poolNodeOperatorShare([candidate.stakingAddress()]), share);

            const newOperator = createRandomWallet().address;
            const stakingEpoch = await stakingHbbft.read.stakingEpoch();

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.setNodeOperator([newOperator, share], { account: candidate.staking }),
                stakingHbbft,
                "OnlyOncePerEpoch",
                [stakingEpoch],
            );
        });

        it("should not allow zero address and non-zero percent", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: minStake },
            );

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await stakingHbbft.write.incrementStakingEpoch({ account: validatorSetCaller });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            const operator = zeroAddress;
            const share = 1000n;

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.setNodeOperator([operator, share], { account: candidate.staking }),
                stakingHbbft,
                "InvalidNodeOperatorConfiguration",
                [operator, share],
            );
        });

        it("should not exceed max share percent", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: minStake },
            );

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await stakingHbbft.write.incrementStakingEpoch({ account: validatorSetCaller });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            const operator = createRandomWallet().address;
            const share = 2001n;

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.setNodeOperator([operator, share], { account: candidate.staking }),
                stakingHbbft,
                "InvalidNodeOperatorShare",
                [share],
            );
        });

        it("should change pool node operator configuration", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: minStake },
            );

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await stakingHbbft.write.incrementStakingEpoch({ account: validatorSetCaller });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            const operator = createRandomWallet().address;
            const share = 1950n;

            await hhViem.assertions.emitWithArgs(
                stakingHbbft.write.setNodeOperator([operator, share], { account: candidate.staking }),
                stakingHbbft,
                "SetNodeOperator",
                [candidate.stakingAddress(), operator, share],
            );

            assert.equal(await stakingHbbft.read.poolNodeOperator([candidate.stakingAddress()]), operator);
            assert.equal(await stakingHbbft.read.poolNodeOperatorShare([candidate.stakingAddress()]), share);
        });
    });

    describe("contract balance", async function () {
        it("should not allow to change balance by sending native coins", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                owner.sendTransaction({ to: stakingHbbft.address, value: 1n }),
                stakingHbbft,
                "NotPayable",
            );

            assert.equal(await publicClient.getBalance({ address: stakingHbbft.address }), 0n);
        });

        it("should increase balance using payable functions", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            assert.equal(await publicClient.getBalance({ address: stakingHbbft.address }), 0n);

            await stakingHbbft.write.addPool(
                [candidate.miningAddress(), zeroAddress, 0n, candidate.publicKey(), candidate.ipAddress],
                { account: candidate.staking, value: minStake },
            );

            assert.equal(await publicClient.getBalance({ address: stakingHbbft.address }), minStake);

            await stakingHbbft.write.stake([candidate.stakingAddress()], {
                account: candidate.staking,
                value: minStake,
            });

            assert.equal(await publicClient.getBalance({ address: stakingHbbft.address }), minStake * 2n);
        });
    });

    describe("incrementStakingEpoch", async function () {
        let stakingContract: StakingHbbftMock;
        let validatorSetContract: TestWalletClient;

        beforeEach(async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            stakingContract = stakingHbbft;
            validatorSetContract = accounts[7];

            await stakingHbbft.write.setValidatorMockSetAddress([getAddress(validatorSetContract.account.address)]);
        });

        it("should increment if called by the ValidatorSet", async function () {
            assert.equal(await stakingContract.read.stakingEpoch(), 0n);
            await stakingContract.write.incrementStakingEpoch({ account: validatorSetContract.account });

            assert.equal(await stakingContract.read.stakingEpoch(), 1n);
        });

        it("can only be called by ValidatorSet contract", async function () {
            await hhViem.assertions.revertWithCustomError(
                stakingContract.write.incrementStakingEpoch({ account: accounts[8].account }),
                stakingContract,
                "Unauthorized",
            );
        });
    });

    describe("initialize", async function () {
        const validatorSetContract = createRandomWallet().address;
        const bonusScoreContract = createRandomWallet().address;

        interface StakingParams {
            _validatorSetContract: Address;
            _bonusScoreContract: Address;
            _initialStakingAddresses: Address[];
            _delegatorMinStake: bigint;
            _candidateMinStake: bigint;
            _maxStake: bigint;
            _stakingFixedEpochDuration: bigint;
            _stakingTransitionTimeframeLength: bigint;
            _stakingWithdrawDisallowPeriod: bigint;
        }

        let initStakingAddresses: Address[];
        let initPublicKeys: Hex[];
        let initIpAddresses: Hex[];
        let stakingParams: StakingParams;

        before(async function () {
            initStakingAddresses = initialValidators.map((x) => x.stakingAddress());
            initPublicKeys = splitPublicKeys(initialValidators.map((x) => x.publicKey())) as Hex[];
            initIpAddresses = initialValidators.map((x) => x.ipAddress);

            stakingParams = {
                _validatorSetContract: validatorSetContract,
                _bonusScoreContract: bonusScoreContract,
                _initialStakingAddresses: initStakingAddresses,
                _delegatorMinStake: minStakeDelegators,
                _candidateMinStake: minStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod,
            };
        });

        it("should initialize successfully", async function () {
            const stakingHbbft = await deployProxy(hhViem, "StakingHbbftMock", {
                initArgs: [
                    owner.account.address,
                    stakingParams,
                    initPublicKeys,  // _publicKeys
                    initIpAddresses, // _internetAddresses
                ],
                initializer: "initialize",
            });

            assert.equal(await stakingHbbft.read.stakingFixedEpochDuration(), stakingFixedEpochDuration);
            assert.equal(await stakingHbbft.read.stakingWithdrawDisallowPeriod(), 0n);
            assert.equal(await stakingHbbft.read.validatorSetContract(), validatorSetContract);

            for (const stakingAddress of initStakingAddresses) {
                assert.equal(await stakingHbbft.read.isPoolActive([stakingAddress]), true);
                assert.ok((await stakingHbbft.read.getPools()).includes(stakingAddress));
                assert.ok((await stakingHbbft.read.getPoolsToBeRemoved()).includes(stakingAddress));
            }

            assert.deepEqual(await stakingHbbft.read.getPools(), initStakingAddresses);
            assert.equal(await stakingHbbft.read.delegatorMinStake(), minStakeDelegators);
            assert.equal(await stakingHbbft.read.candidateMinStake(), minStake);
        });

        it("should set the corresponding public keys", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            for (const validator of initialValidators) {
                assert.equal(
                    await stakingHbbft.read.getPoolPublicKey([validator.stakingAddress()]),
                    validator.publicKey(),
                );
            }
        });

        it("should set the corresponding IP addresses", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            for (const validator of initialValidators) {
                const netAddress = await stakingHbbft.read.getPoolInternetAddress([validator.stakingAddress()]);

                assert.equal(netAddress[0], validator.ipAddress);
            }
        });

        it("should fail if owner = address(0)", async function () {
            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [zeroAddress, stakingParams, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should fail if ValidatorSet contract address is zero", async function () {
            const params = {
                ...stakingParams,
                _validatorSetContract: zeroAddress,
            };

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, params, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should fail if delegatorMinStake is zero", async function () {
            const params = {
                ...stakingParams,
                _delegatorMinStake: 0n,
            };

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, params, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InvalidInitialStakeAmount",
                [minStake, 0n],
            );
        });

        it("should fail if candidateMinStake is zero", async function () {
            const params = {
                ...stakingParams,
                _candidateMinStake: 0n,
            };

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, params, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InvalidInitialStakeAmount",
                [0n, minStake],
            );
        });

        it("should fail if already initialized", async function () {
            const stakingHbbft = await deployProxy(hhViem, "StakingHbbftMock", {
                initArgs: [owner.account.address, stakingParams, initPublicKeys, initIpAddresses],
                initializer: "initialize",
            });

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.initialize([
                    owner.account.address,
                    stakingParams,
                    initPublicKeys,  // _publicKeys
                    initIpAddresses, // _internetAddresses
                ]),
                stakingHbbft,
                "InvalidInitialization",
            );
        });

        it("should fail if stakingEpochDuration is 0", async function () {
            const params = {
                ...stakingParams,
                _stakingFixedEpochDuration: 0n,
            };

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, params, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InvalidFixedEpochDuration",
            );
        });

        it("should fail if some staking address is 0", async function () {
            const stakingAddresses = initStakingAddresses.slice();
            stakingAddresses[0] = zeroAddress;

            const params = {
                ...stakingParams,
                _initialStakingAddresses: stakingAddresses,
            };

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, params, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should fail if timewindow is 0", async function () {
            const params = {
                ...stakingParams,
                _stakingTransitionTimeframeLength: 0n,
            };

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, params, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InvalidTransitionTimeFrame",
            );
        });

        it("should fail if transition timewindow is smaller than the staking time window", async function () {
            const params = {
                ...stakingParams,
                _stakingTransitionTimeframeLength: stakingFixedEpochDuration,
            };

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, params, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InvalidTransitionTimeFrame",
            );
        });

        it("should revert for empty initial staking addresses list", async function () {
            const params = {
                ...stakingParams,
                _initialStakingAddresses: [],
            };

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, params, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InitialStakingPoolsListEmpty",
            );
        });

        it("should revert for maxStake <= candidate min stake", async function () {
            const params = {
                ...stakingParams,
                _maxStake: minStake,
            };

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, params, initPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InvalidMaxStakeAmount",
            );
        });

        it("should revert for public keys / staking addresses count mismatch", async function () {
            const lessPublicKeys = initPublicKeys.slice(0, -2);

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, stakingParams, lessPublicKeys, initIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InvalidPublicKeysCount",
            );
        });

        it("should revert for ip addresses / staking addresses count mismatch", async function () {
            const lessIpAddresses = initIpAddresses.slice(0, -1);

            const implementation = await hhViem.deployContract("StakingHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "StakingHbbftMock", {
                    initArgs: [owner.account.address, stakingParams, initPublicKeys, lessIpAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InvalidIpAddressesCount",
            );
        });
    });

    describe("moveStake", async function () {
        let delegator: TestWalletClient;
        let delegatorAddr: Address;
        let stakingContract: StakingHbbftMock;
        const stakeAmount = minStake * 2n;

        beforeEach(async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            delegator = accounts[7];
            delegatorAddr = getAddress(delegator.account.address);
            stakingContract = stakingHbbft;

            // Place stakes
            await stakingContract.write.stake([initialValidators[0].stakingAddress()], {
                account: initialValidators[0].staking,
                value: stakeAmount,
            });

            await stakingContract.write.stake([initialValidators[1].stakingAddress()], {
                account: initialValidators[1].staking,
                value: stakeAmount,
            });

            await stakingContract.write.stake([initialValidators[0].stakingAddress()], {
                account: delegator.account,
                value: stakeAmount,
            });
        });

        it("should move entire stake", async function () {
            // we can move the stake, since the staking address is not part of the active validator set,
            // since we never did never a time travel.
            // If we do, the stakingAddresses are blocked to withdraw without an orderwithdraw.
            const from = initialValidators[0].stakingAddress();
            const to = initialValidators[1].stakingAddress();

            assert.equal(await stakingContract.read.stakeAmount([from, delegatorAddr]), stakeAmount);
            assert.equal(await stakingContract.read.stakeAmount([to, delegatorAddr]), 0n);

            await stakingContract.write.moveStake([from, to, stakeAmount], { account: delegator.account });
            assert.equal(await stakingContract.read.stakeAmount([from, delegatorAddr]), 0n);
            assert.equal(await stakingContract.read.stakeAmount([to, delegatorAddr]), stakeAmount);
        });

        it("should move part of the stake", async function () {
            const from = initialValidators[0].stakingAddress();
            const to = initialValidators[1].stakingAddress();

            assert.equal(await stakingContract.read.stakeAmount([from, delegatorAddr]), stakeAmount);
            assert.equal(await stakingContract.read.stakeAmount([to, delegatorAddr]), 0n);

            await stakingContract.write.moveStake([from, to, minStake], { account: delegator.account });
            assert.equal(await stakingContract.read.stakeAmount([from, delegatorAddr]), minStake);
            assert.equal(await stakingContract.read.stakeAmount([to, delegatorAddr]), minStake);
        });

        it("should move part of the stake below delegator min stake", async function () {
            const sourcePool = initialValidators[0].stakingAddress();
            const targetPool = initialValidators[1].stakingAddress();

            await stakingContract.write.stake([targetPool], { account: delegator.account, value: stakeAmount });

            assert.equal(await stakingContract.read.stakeAmount([sourcePool, delegatorAddr]), stakeAmount);
            assert.equal(await stakingContract.read.stakeAmount([targetPool, delegatorAddr]), stakeAmount);

            const moveAmount = minStakeDelegators / 2n;
            assert.ok(moveAmount < (await stakingContract.read.delegatorMinStake()));

            await stakingContract.write.moveStake([sourcePool, targetPool, moveAmount], {
                account: delegator.account,
            });
            assert.equal(
                await stakingContract.read.stakeAmount([sourcePool, delegatorAddr]),
                stakeAmount - moveAmount,
            );
            assert.equal(
                await stakingContract.read.stakeAmount([targetPool, delegatorAddr]),
                stakeAmount + moveAmount,
            );
        });

        it("should fail for zero gas price", async function () {
            const from = initialValidators[0].stakingAddress();
            const to = initialValidators[1].stakingAddress();

            await hhViem.assertions.revertWithCustomError(
                stakingContract.write.moveStake([from, to, stakeAmount], {
                    account: delegator.account,
                    gasPrice: 0n,
                }),
                stakingContract,
                "ZeroGasPrice",
            );
        });

        it("should fail if the source and destination addresses are the same", async function () {
            const pool = initialValidators[0].stakingAddress();

            await hhViem.assertions.revertWithCustomError(
                stakingContract.write.moveStake([pool, pool, stakeAmount], { account: delegator.account }),
                stakingContract,
                "InvalidMoveStakePoolsAddress",
            );
        });

        it("should fail if the staker tries to move more than they have", async function () {
            const from = initialValidators[0].stakingAddress();
            const to = initialValidators[1].stakingAddress();

            await hhViem.assertions.revertWithCustomError(
                stakingContract.write.moveStake([from, to, stakeAmount * 2n], { account: delegator.account }),
                stakingContract,
                "MaxAllowedWithdrawExceeded",
            );
        });

        it("should fail if the staker tries to overstake by moving stake.", async function () {
            // stake source pool and target pool to the max.
            // then move 1 from source to target - that should be the drop on the hot stone.
            const sourcePool = initialValidators[0].stakingAddress();
            const targetPool = initialValidators[1].stakingAddress();

            const currentSourceStake = await stakingContract.read.stakeAmountTotal([sourcePool]);
            const totalStakeableSource = maxStake - currentSourceStake;
            await stakingContract.write.stake([sourcePool], {
                account: delegator.account,
                value: totalStakeableSource,
            });

            const currentTargetStake = await stakingContract.read.stakeAmountTotal([targetPool]);
            const totalStakeableTarget = maxStake - currentTargetStake;
            await stakingContract.write.stake([targetPool], {
                account: delegator.account,
                value: totalStakeableTarget,
            });

            // source is at max stake now, now tip it over.
            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingContract.write.moveStake([sourcePool, targetPool, 1n], { account: delegator.account }),
                stakingContract,
                "PoolStakeLimitExceeded",
                [targetPool, delegatorAddr],
            );
        });
    });

    describe("stake", async function () {
        let delegatorAddress: TestWalletClient;
        let delegatorAddr: Address;

        beforeEach(async function () {
            delegatorAddress = accounts[7];
            delegatorAddr = getAddress(delegatorAddress.account.address);
        });

        it("should be zero initially", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].stakingAddress();

            assert.equal(await stakingHbbft.read.stakeAmount([pool, pool]), 0n);
            assert.equal(await stakingHbbft.read.stakeAmount([pool, delegatorAddr]), 0n);
        });

        it("should place a stake", async function () {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });

            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, pool.address]), candidateMinStake);

            await hhViem.assertions.emitWithArgs(
                stakingHbbft.write.stake([pool.address], {
                    account: delegatorAddress.account,
                    value: delegatorMinStake,
                }),
                stakingHbbft,
                "PlacedStake",
                [pool.address, delegatorAddr, 0n, delegatorMinStake],
            );

            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), delegatorMinStake);
            assert.equal(
                await stakingHbbft.read.stakeAmountTotal([pool.address]),
                candidateMinStake + delegatorMinStake,
            );
        });

        it("should fail for zero gas price", async function () {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.stake([pool.address], {
                    account: pool,
                    value: candidateMinStake,
                    gasPrice: 0n,
                }),
                stakingHbbft,
                "ZeroGasPrice",
            );
        });

        it("should fail for a zero staking pool address", async function () {
            const { stakingHbbft, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.stake([zeroAddress], {
                    account: delegatorAddress.account,
                    value: delegatorMinStake,
                }),
                stakingHbbft,
                "ZeroAddress",
            );
        });

        it("should fail for a non-existing pool", async function () {
            const { stakingHbbft, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = getAddress(accounts[10].account.address);

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.stake([pool], { account: delegatorAddress.account, value: delegatorMinStake }),
                stakingHbbft,
                "PoolNotExist",
                [pool],
            );
        });

        it("should fail for a zero amount", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.stake([pool.address], { account: delegatorAddress.account, value: 0n }),
                stakingHbbft,
                "InsufficientStakeAmount",
                [pool.address, delegatorAddr],
            );
        });

        it("should fail if a candidate stakes less than CANDIDATE_MIN_STAKE", async function () {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            const halfOfCandidateMinStake = candidateMinStake / 2n;
            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.stake([pool.address], { account: pool, value: halfOfCandidateMinStake }),
                stakingHbbft,
                "InsufficientStakeAmount",
                [pool.address, pool.address],
            );
        });

        it("should fail if a delegator stakes less than DELEGATOR_MIN_STAKE", async function () {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });
            const halfOfDelegatorMinStake = delegatorMinStake / 2n;

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.stake([pool.address], {
                    account: delegatorAddress.account,
                    value: halfOfDelegatorMinStake,
                }),
                stakingHbbft,
                "InsufficientStakeAmount",
                [pool.address, delegatorAddr],
            );
        });

        it("should fail if a delegator stakes more than maxStake", async function () {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });
            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.stake([pool.address], {
                    account: delegatorAddress.account,
                    value: maxStake + 1n,
                }),
                stakingHbbft,
                "PoolStakeLimitExceeded",
                [pool.address, delegatorAddr],
            );
        });

        it("should fail if a delegator stakes into an empty pool", async function () {
            const { stakingHbbft, delegatorMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, pool.address]), 0n);
            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.stake([pool.address], {
                    account: delegatorAddress.account,
                    value: delegatorMinStake,
                }),
                stakingHbbft,
                "PoolEmpty",
                [pool.address],
            );
        });

        it("should increase a stake amount", async function () {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), 0n);

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), delegatorMinStake);

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), delegatorMinStake * 2n);
        });

        it("should increase the stakeAmountByCurrentEpoch", async function () {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });
            assert.equal(await stakingHbbft.read.stakeAmountByCurrentEpoch([pool.address, delegatorAddr]), 0n);

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });
            assert.equal(
                await stakingHbbft.read.stakeAmountByCurrentEpoch([pool.address, delegatorAddr]),
                delegatorMinStake,
            );

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });
            assert.equal(
                await stakingHbbft.read.stakeAmountByCurrentEpoch([pool.address, delegatorAddr]),
                delegatorMinStake * 2n,
            );
        });

        it("should increase a total stake amount", async function () {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });
            assert.equal(await stakingHbbft.read.stakeAmountTotal([pool.address]), candidateMinStake);

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });
            assert.equal(
                await stakingHbbft.read.stakeAmountTotal([pool.address]),
                candidateMinStake + delegatorMinStake,
            );

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });
            assert.equal(
                await stakingHbbft.read.stakeAmountTotal([pool.address]),
                candidateMinStake + delegatorMinStake * 2n,
            );
        });

        it("should add a delegator to the pool", async function () {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });
            assert.equal((await stakingHbbft.read.poolDelegators([pool.address])).length, 0);

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });
            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });

            assert.deepEqual(await stakingHbbft.read.poolDelegators([pool.address]), [delegatorAddr]);
        });

        it("should update pool's likelihood", async function () {
            const { stakingHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            let likelihoodInfo = await stakingHbbft.read.getPoolsLikelihood();
            assert.equal(likelihoodInfo[0].length, 0);
            assert.equal(likelihoodInfo[1], 0n);

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });
            likelihoodInfo = await stakingHbbft.read.getPoolsLikelihood();
            assert.equal(likelihoodInfo[0][0], candidateMinStake);
            assert.equal(likelihoodInfo[1], candidateMinStake);

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });
            likelihoodInfo = await stakingHbbft.read.getPoolsLikelihood();
            assert.equal(likelihoodInfo[0][0], candidateMinStake + delegatorMinStake);
            assert.equal(likelihoodInfo[1], candidateMinStake + delegatorMinStake);

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: delegatorMinStake,
            });
            likelihoodInfo = await stakingHbbft.read.getPoolsLikelihood();
            assert.equal(likelihoodInfo[0][0], candidateMinStake + delegatorMinStake * 2n);
            assert.equal(likelihoodInfo[1], candidateMinStake + delegatorMinStake * 2n);
        });

        it("should decrease the balance of the staker and increase the balance of the Staking contract", async function () {
            const { stakingHbbft, candidateMinStake } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            assert.equal(await publicClient.getBalance({ address: stakingHbbft.address }), 0n);

            const initialBalance = await publicClient.getBalance({ address: pool.address });
            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });

            assert.ok(
                (await publicClient.getBalance({ address: pool.address })) < initialBalance - candidateMinStake,
            );
            assert.equal(await publicClient.getBalance({ address: stakingHbbft.address }), candidateMinStake);
        });

        it("should not create stake snapshot on epoch 0", async function () {
            const { stakingHbbft, validatorSetHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;
            const mining = initialValidators[1].mining;
            const delegator = accounts[11];
            const delegatorAddr = getAddress(delegator.account.address);

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, pool.address]), candidateMinStake);

            const stakingEpoch = await stakingHbbft.read.stakingEpoch();
            assert.equal(stakingEpoch, 0n);

            await stakingHbbft.write.stake([pool.address], {
                account: delegator.account,
                value: delegatorMinStake,
            });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), delegatorMinStake);
            assert.equal(
                await stakingHbbft.read.getDelegatorStakeSnapshot([pool.address, delegatorAddr, stakingEpoch]),
                0n,
            );
            assert.equal(await stakingHbbft.read.getStakeSnapshotLastEpoch([pool.address, delegatorAddr]), 0n);

            assert.equal(await validatorSetHbbft.read.isValidatorOrPending([mining.address]), true);

            await stakingHbbft.write.stake([pool.address], {
                account: delegator.account,
                value: delegatorMinStake * 2n,
            });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), delegatorMinStake * 3n);
            assert.equal(
                await stakingHbbft.read.getDelegatorStakeSnapshot([pool.address, delegatorAddr, stakingEpoch]),
                0n,
            );
            assert.equal(await stakingHbbft.read.getStakeSnapshotLastEpoch([pool.address, delegatorAddr]), 0n);
        });

        it("should create stake snapshot if staking on an active validator", async function () {
            const { stakingHbbft, validatorSetHbbft, blockRewardHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;
            const mining = initialValidators[1].mining;
            const delegator = accounts[11];
            const delegatorAddr = getAddress(delegator.account.address);

            await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, pool.address]), candidateMinStake);

            let stakingEpoch = await stakingHbbft.read.stakingEpoch();
            await stakingHbbft.write.stake([pool.address], {
                account: delegator.account,
                value: delegatorMinStake,
            });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), delegatorMinStake);
            assert.equal(
                await stakingHbbft.read.getDelegatorStakeSnapshot([pool.address, delegatorAddr, stakingEpoch]),
                0n,
            );
            assert.equal(await stakingHbbft.read.getStakeSnapshotLastEpoch([pool.address, delegatorAddr]), 0n);

            await callReward(blockRewardHbbft, true);

            assert.equal(await validatorSetHbbft.read.isValidatorOrPending([mining.address]), true);
            assert.ok((await stakingHbbft.read.stakingEpoch()) > 0n);

            stakingEpoch = await stakingHbbft.read.stakingEpoch();
            await stakingHbbft.write.stake([pool.address], {
                account: delegator.account,
                value: delegatorMinStake * 2n,
            });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), delegatorMinStake * 3n);
            assert.equal(
                await stakingHbbft.read.getDelegatorStakeSnapshot([pool.address, delegatorAddr, stakingEpoch]),
                delegatorMinStake,
            );
            assert.equal(
                await stakingHbbft.read.getStakeSnapshotLastEpoch([pool.address, delegatorAddr]),
                stakingEpoch,
            );
        });
    });

    describe("removePool", async function () {
        let initStakingAddresses: Address[];

        before(async function () {
            initStakingAddresses = initialValidators.map((x) => x.stakingAddress());
        });

        it("should remove a pool", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            assert.deepEqual(await stakingHbbft.read.getPools(), initStakingAddresses);

            await stakingHbbft.write.setValidatorMockSetAddress([getAddress(accounts[7].account.address)]);
            await stakingHbbft.write.removePool([initStakingAddresses[0]], { account: accounts[7].account });

            assert.deepEqual(await stakingHbbft.read.getPools(), [initStakingAddresses[2], initStakingAddresses[1]]);

            assert.equal((await stakingHbbft.read.getPoolsInactive()).length, 0);
        });

        it("can only be called by the ValidatorSetHbbft contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.write.setValidatorMockSetAddress([getAddress(accounts[7].account.address)]);
            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.removePool([initStakingAddresses[0]], { account: accounts[8].account }),
                stakingHbbft,
                "Unauthorized",
            );
        });

        it("shouldn't fail when removing a nonexistent pool", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            assert.deepEqual(await stakingHbbft.read.getPools(), initStakingAddresses);

            await stakingHbbft.write.setValidatorMockSetAddress([getAddress(accounts[7].account.address)]);
            await stakingHbbft.write.removePool([getAddress(accounts[10].account.address)], {
                account: accounts[7].account,
            });

            assert.deepEqual(await stakingHbbft.read.getPools(), initStakingAddresses);
        });

        it("should add/remove a pool to/from the utility lists", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            // The first validator places stake for themselves
            assert.equal((await stakingHbbft.read.getPoolsToBeElected()).length, 0);
            assert.deepEqual(await stakingHbbft.read.getPoolsToBeRemoved(), initStakingAddresses);

            await stakingHbbft.write.stake([initStakingAddresses[0]], {
                account: initialValidators[0].staking,
                value: minStake,
            });

            assert.equal(await stakingHbbft.read.stakeAmountTotal([initStakingAddresses[0]]), minStake);
            assert.deepEqual(await stakingHbbft.read.getPoolsToBeElected(), [initStakingAddresses[0]]);
            assert.deepEqual(await stakingHbbft.read.getPoolsToBeRemoved(), [
                initStakingAddresses[2],
                initStakingAddresses[1],
            ]);

            // Remove the pool
            await stakingHbbft.write.setValidatorMockSetAddress([getAddress(accounts[7].account.address)]);
            await stakingHbbft.write.removePool([initStakingAddresses[0]], { account: accounts[7].account });
            assert.deepEqual(await stakingHbbft.read.getPoolsInactive(), [initStakingAddresses[0]]);

            await stakingHbbft.write.removePool([initStakingAddresses[0]], { account: accounts[7].account });
            assert.deepEqual(await stakingHbbft.read.getPoolsInactive(), [initStakingAddresses[0]]);

            await stakingHbbft.write.removePool([initStakingAddresses[1]], { account: accounts[7].account });
            assert.deepEqual(await stakingHbbft.read.getPoolsToBeRemoved(), [initStakingAddresses[2]]);
        });
    });

    describe("removePools", async function () {
        it("should restrict calling removePools to validator set contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.removePools({ account: caller.account }),
                stakingHbbft,
                "Unauthorized",
            );
        });
    });

    describe("removeMyPool", async function () {
        it("should fail for zero gas price", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await stakingHbbft.write.incrementStakingEpoch({ account: validatorSetCaller });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.removeMyPool({ account: initialValidators[0].staking, gasPrice: 0n }),
                stakingHbbft,
                "ZeroGasPrice",
            );
        });

        it("should fail for initial validator during the initial staking epoch", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];

            assert.equal(await stakingHbbft.read.stakingEpoch(), 0n);
            assert.equal(await validatorSetHbbft.read.isValidator([validator.miningAddress()]), true);
            assert.equal(
                await validatorSetHbbft.read.miningByStakingAddress([validator.stakingAddress()]),
                validator.miningAddress(),
            );

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.removeMyPool({ account: validator.staking }),
                stakingHbbft,
                "PoolCannotBeRemoved",
                [validator.stakingAddress()],
            );

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await stakingHbbft.write.incrementStakingEpoch({ account: validatorSetCaller });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            await stakingHbbft.write.removeMyPool({ account: validator.staking });
        });
    });

    describe("withdraw", async function () {
        const stakeAmount = minStake * 2n;

        let delegatorAddress: TestWalletClient;
        let delegatorAddr: Address;

        beforeEach(async function () {
            delegatorAddress = accounts[7];
            delegatorAddr = getAddress(delegatorAddress.account.address);
        });

        it("should withdraw a stake", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, pool.address]), 0n);
            assert.equal(await stakingHbbft.read.stakeAmountByCurrentEpoch([pool.address, pool.address]), 0n);
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), 0n);
            assert.equal(await stakingHbbft.read.stakeAmountByCurrentEpoch([pool.address, delegatorAddr]), 0n);

            await stakingHbbft.write.stake([pool.address], { account: pool, value: stakeAmount });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, pool.address]), stakeAmount);
            assert.equal(await stakingHbbft.read.stakeAmountByCurrentEpoch([pool.address, pool.address]), stakeAmount);

            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: stakeAmount,
            });
            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), stakeAmount);
            assert.equal(
                await stakingHbbft.read.stakeAmountByCurrentEpoch([pool.address, delegatorAddr]),
                stakeAmount,
            );
            assert.equal(await stakingHbbft.read.stakeAmountTotal([pool.address]), stakeAmount * 2n);

            await hhViem.assertions.emitWithArgs(
                stakingHbbft.write.withdraw([pool.address, stakeAmount], { account: delegatorAddress.account }),
                stakingHbbft,
                "WithdrewStake",
                [pool.address, delegatorAddr, 0n, stakeAmount],
            );

            assert.equal(await stakingHbbft.read.stakeAmount([pool.address, delegatorAddr]), 0n);
            assert.equal(await stakingHbbft.read.stakeAmountByCurrentEpoch([pool.address, delegatorAddr]), 0n);
            assert.equal(await stakingHbbft.read.stakeAmountTotal([pool.address]), stakeAmount);
        });

        it("should fail for zero gas price", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const staker = initialValidators[1].staking;

            await stakingHbbft.write.stake([staker.address], { account: staker, value: stakeAmount });
            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.withdraw([staker.address, stakeAmount], { account: staker, gasPrice: 0n }),
                stakingHbbft,
                "ZeroGasPrice",
            );
        });

        it("should fail for a zero pool address", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const staker = initialValidators[1].staking;

            await stakingHbbft.write.stake([staker.address], { account: staker, value: stakeAmount });
            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.withdraw([zeroAddress, stakeAmount], { account: staker }),
                stakingHbbft,
                "ZeroAddress",
            );

            await stakingHbbft.write.withdraw([staker.address, stakeAmount], { account: staker });
        });

        it("should fail for a zero amount", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const staker = initialValidators[1].staking;

            await stakingHbbft.write.stake([staker.address], { account: staker, value: stakeAmount });
            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.withdraw([staker.address, 0n], { account: staker }),
                stakingHbbft,
                "ZeroWidthrawAmount",
            );

            await stakingHbbft.write.withdraw([staker.address, stakeAmount], { account: staker });
        });

        it("should fail if non-zero residue is less than CANDIDATE_MIN_STAKE", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const candidateMinStake = await stakingHbbft.read.candidateMinStake();
            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: stakeAmount });

            const withdrawAmount = stakeAmount - candidateMinStake + 1n;
            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.withdraw([pool.address, withdrawAmount], { account: pool }),
                stakingHbbft,
                "InvalidWithdrawAmount",
                [pool.address, pool.address, withdrawAmount],
            );

            await stakingHbbft.write.withdraw([pool.address, stakeAmount - candidateMinStake], { account: pool });
            await stakingHbbft.write.withdraw([pool.address, candidateMinStake], { account: pool });
        });

        it("should fail if non-zero residue is less than DELEGATOR_MIN_STAKE", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const delegatorMinStake = await stakingHbbft.read.delegatorMinStake();
            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: stakeAmount });
            await stakingHbbft.write.stake([pool.address], {
                account: delegatorAddress.account,
                value: stakeAmount,
            });

            const withdrawAmount = stakeAmount - delegatorMinStake + 1n;
            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.withdraw([pool.address, withdrawAmount], { account: delegatorAddress.account }),
                stakingHbbft,
                "InvalidWithdrawAmount",
                [pool.address, delegatorAddr, withdrawAmount],
            );

            await stakingHbbft.write.withdraw([pool.address, stakeAmount - delegatorMinStake], {
                account: delegatorAddress.account,
            });
            await stakingHbbft.write.withdraw([pool.address, delegatorMinStake], {
                account: delegatorAddress.account,
            });
        });

        it("should fail if withdraw more than staked", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            await stakingHbbft.write.stake([pool.address], { account: pool, value: stakeAmount });

            const maxAllowed = await stakingHbbft.read.maxWithdrawAllowed([pool.address, pool.address]);
            const withdrawAmount = stakeAmount + 1n;

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.withdraw([pool.address, withdrawAmount], { account: pool }),
                stakingHbbft,
                "MaxAllowedWithdrawExceeded",
                [maxAllowed, withdrawAmount],
            );

            await stakingHbbft.write.withdraw([pool.address, stakeAmount], { account: pool });
        });

        it("should revert orderWithdraw with gasPrice = 0", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.orderWithdraw([initialValidators[1].stakingAddress(), parseEther("1")], {
                    gasPrice: 0n,
                }),
                stakingHbbft,
                "ZeroGasPrice",
            );
        });

        it("should revert orderWithdraw with pool = address(0)", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.orderWithdraw([zeroAddress, parseEther("1")]),
                stakingHbbft,
                "ZeroAddress",
            );
        });

        it("should revert orderWithdraw with amount = 0", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.orderWithdraw([initialValidators[1].stakingAddress(), 0n]),
                stakingHbbft,
                "ZeroWidthrawAmount",
            );
        });

        it("should fail if withdraw already ordered amount", async function () {
            const { stakingHbbft, validatorSetHbbft, blockRewardHbbft } =
                await helpers.loadFixture(deployContractsFixture);

            await impersonateAcc(SystemAccountAddress);

            // Place a stake during the initial staking epoch
            assert.equal(await stakingHbbft.read.stakingEpoch(), 0n);

            for (const validator of initialValidators) {
                await stakingHbbft.write.stake([validator.stakingAddress()], {
                    account: validator.staking,
                    value: stakeAmount,
                });
            }

            await stakingHbbft.write.stake([initialValidators[1].stakingAddress()], {
                account: delegatorAddress.account,
                value: stakeAmount,
            });

            // Finalize a new validator set and change staking epoch
            await validatorSetHbbft.write.setStakingContract([stakingHbbft.address]);

            // Set BlockRewardContract
            await validatorSetHbbft.write.setBlockRewardContract([getAddress(accounts[7].account.address)]);
            await validatorSetHbbft.write.newValidatorSet({ account: accounts[7].account });
            await validatorSetHbbft.write.setBlockRewardContract([blockRewardHbbft.address]);

            // (increases staking epoch)
            await timeTravelToTransition(blockRewardHbbft, stakingHbbft);
            await timeTravelToEndEpoch(blockRewardHbbft, stakingHbbft);

            assert.equal(await stakingHbbft.read.stakingEpoch(), 1n);

            // Order withdrawal
            const orderedAmount = stakeAmount / 4n;
            await stakingHbbft.write.orderWithdraw([initialValidators[1].stakingAddress(), orderedAmount], {
                account: delegatorAddress.account,
            });

            // The second validator removes their pool
            assert.equal(await validatorSetHbbft.read.isValidator([initialValidators[1].miningAddress()]), true);
            assert.equal((await stakingHbbft.read.getPoolsInactive()).length, 0);

            await stakingHbbft.write.removeMyPool({ account: initialValidators[1].staking });
            assert.deepEqual(await stakingHbbft.read.getPoolsInactive(), [initialValidators[1].stakingAddress()]);

            // Finalize a new validator set, change staking epoch and enqueue pending validators
            await validatorSetHbbft.write.setBlockRewardContract([getAddress(accounts[7].account.address)]);
            await validatorSetHbbft.write.newValidatorSet({ account: accounts[7].account });
            await validatorSetHbbft.write.setBlockRewardContract([blockRewardHbbft.address]);

            await timeTravelToTransition(blockRewardHbbft, stakingHbbft);
            await timeTravelToEndEpoch(blockRewardHbbft, stakingHbbft);

            assert.equal(await stakingHbbft.read.stakingEpoch(), 2n);
            assert.equal(await validatorSetHbbft.read.isValidator([initialValidators[1].miningAddress()]), false);

            // Check withdrawal for a delegator
            const restOfAmount = (stakeAmount * 3n) / 4n;

            assert.deepEqual(await stakingHbbft.read.poolDelegators([initialValidators[1].stakingAddress()]), [
                delegatorAddr,
            ]);
            assert.equal(
                await stakingHbbft.read.stakeAmount([initialValidators[1].stakingAddress(), delegatorAddr]),
                restOfAmount,
            );
            assert.equal(
                await stakingHbbft.read.stakeAmountByCurrentEpoch([
                    initialValidators[1].stakingAddress(),
                    delegatorAddr,
                ]),
                0n,
            );

            const pool = initialValidators[1].stakingAddress();
            const maxAllowed = await stakingHbbft.read.maxWithdrawAllowed([pool, delegatorAddr]);

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.withdraw([pool, stakeAmount], { account: delegatorAddress.account }),
                stakingHbbft,
                "MaxAllowedWithdrawExceeded",
                [maxAllowed, stakeAmount],
            );

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.withdraw([pool, restOfAmount + 1n], { account: delegatorAddress.account }),
                stakingHbbft,
                "MaxAllowedWithdrawExceeded",
                [maxAllowed, restOfAmount + 1n],
            );

            await stakingHbbft.write.withdraw([pool, restOfAmount], { account: delegatorAddress.account });
            assert.equal(await stakingHbbft.read.stakeAmountByCurrentEpoch([pool, delegatorAddr]), 0n);
            assert.equal(await stakingHbbft.read.stakeAmount([pool, delegatorAddr]), 0n);
            assert.equal(await stakingHbbft.read.orderedWithdrawAmount([pool, delegatorAddr]), orderedAmount);
            assert.equal((await stakingHbbft.read.poolDelegators([pool])).length, 0);
            assert.deepEqual(await stakingHbbft.read.poolDelegatorsInactive([pool]), [delegatorAddr]);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });

        it("should decrease likelihood", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const pool = initialValidators[1].staking;

            let likelihoodInfo = await stakingHbbft.read.getPoolsLikelihood();
            assert.equal(likelihoodInfo[1], 0n);

            await stakingHbbft.write.stake([pool.address], { account: pool, value: stakeAmount });

            likelihoodInfo = await stakingHbbft.read.getPoolsLikelihood();
            assert.equal(likelihoodInfo[0][0], stakeAmount);
            assert.equal(likelihoodInfo[1], stakeAmount);

            await stakingHbbft.write.withdraw([pool.address, stakeAmount / 2n], { account: pool });

            likelihoodInfo = await stakingHbbft.read.getPoolsLikelihood();
            assert.equal(likelihoodInfo[0][0], stakeAmount / 2n);
            assert.equal(likelihoodInfo[1], stakeAmount / 2n);
        });
    });

    describe("recoverAbandonedStakes", async function () {
        let stakingPool: Account;
        let stakers: TestWalletClient[];

        beforeEach(async function () {
            stakingPool = initialValidators[0].staking;

            stakers = accounts.slice(7, 15);
        });

        async function stake(
            stakingContract: StakingHbbftMock,
            poolAddress: Address,
            amount: bigint,
            stakers: Account[],
        ) {
            for (const staker of stakers) {
                await stakingContract.write.stake([poolAddress], { account: staker, value: amount });
            }
        }

        async function setValidatorInactive(
            stakingContract: StakingHbbftMock,
            validatorSetContract: ValidatorSetHbbftMock,
            poolAddress: Address,
        ) {
            const validator = await validatorSetContract.read.miningByStakingAddress([poolAddress]);

            await validatorSetContract.write.setValidatorAvailableSince([validator, 0n]);
            await stakingContract.write.addPoolInactiveMock([poolAddress]);

            const poolsInactive = await stakingContract.read.getPoolsInactive();

            assert.ok(poolsInactive.includes(poolAddress));
        }

        it("should revert with invalid gas price", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.recoverAbandonedStakes({ gasPrice: 0n }),
                stakingHbbft,
                "ZeroGasPrice",
            );
        });

        it("should revert if there is no inactive pools", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.recoverAbandonedStakes(),
                stakingHbbft,
                "NoStakesToRecover",
            );
        });

        it("should revert if validator inactive, but not abandonded", async function () {
            const { stakingHbbft, validatorSetHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const expectedTotalStakes = candidateMinStake + delegatorMinStake * BigInt(stakers.length);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool]);
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers.map((x) => x.account));

            assert.equal(await stakingHbbft.read.stakeAmountTotal([stakingPool.address]), expectedTotalStakes);

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([stakingPool.address]), false);

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.recoverAbandonedStakes(),
                stakingHbbft,
                "NoStakesToRecover",
            );
        });

        it("should recover abandoned stakes", async function () {
            const { stakingHbbft, validatorSetHbbft, blockRewardHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            await blockRewardHbbft.write.setGovernanceAddress([owner.account.address]);

            const governanceAddress = await blockRewardHbbft.read.governancePotAddress();
            const reinsertAddress = blockRewardHbbft.address;

            assert.equal(governanceAddress, getAddress(owner.account.address));

            const expectedTotalStakes = candidateMinStake + delegatorMinStake * BigInt(stakers.length);
            const caller = accounts[5];

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool]);
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers.map((x) => x.account));
            assert.equal(await stakingHbbft.read.stakeAmountTotal([stakingPool.address]), expectedTotalStakes);

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);
            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([stakingPool.address]), true);

            const expectedGovernanceShare = expectedTotalStakes / 2n;
            const expectedReinsertShare = expectedTotalStakes - expectedGovernanceShare;

            const txHash = await stakingHbbft.write.recoverAbandonedStakes({ account: caller.account });

            await hhViem.assertions.emitWithArgs(txHash, stakingHbbft, "GatherAbandonedStakes", [
                getAddress(caller.account.address),
                stakingPool.address,
                expectedTotalStakes,
            ]);

            await hhViem.assertions.emitWithArgs(txHash, stakingHbbft, "RecoverAbandonedStakes", [
                getAddress(caller.account.address),
                expectedReinsertShare,
                expectedGovernanceShare,
            ]);

            await hhViem.assertions.balancesHaveChanged(txHash, [
                { address: stakingHbbft.address, amount: -expectedTotalStakes },
                { address: reinsertAddress, amount: expectedReinsertShare },
                { address: governanceAddress, amount: expectedGovernanceShare },
            ]);

            assert.equal(await stakingHbbft.read.stakeAmountTotal([stakingPool.address]), 0n);
            assert.equal(await stakingHbbft.read.stakeAmount([stakingPool.address, stakingPool.address]), 0n);
            assert.equal((await stakingHbbft.read.poolDelegators([stakingPool.address])).length, 0);

            for (const staker of stakers) {
                assert.equal(
                    await stakingHbbft.read.stakeAmount([
                        stakingPool.address,
                        getAddress(staker.account.address),
                    ]),
                    0n,
                );
            }
        });

        it("should recover abandoned stakes, mark pool as abandoned and remove from inactive pools", async function () {
            const { stakingHbbft, validatorSetHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool]);
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers.map((x) => x.account));

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([stakingPool.address]), true);

            await hhViem.assertions.emit(
                stakingHbbft.write.recoverAbandonedStakes(),
                stakingHbbft,
                "RecoverAbandonedStakes",
            );

            assert.ok(!(await stakingHbbft.read.getPoolsInactive()).includes(stakingPool.address));
            assert.equal(await stakingHbbft.read.abandonedAndRemoved([stakingPool.address]), true);
        });

        it("should return maxWithdrawAllowed = 0 if pool was abandoned and removed", async function () {
            const { stakingHbbft, validatorSetHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool]);
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers.map((x) => x.account));

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([stakingPool.address]), true);

            await hhViem.assertions.emit(
                stakingHbbft.write.recoverAbandonedStakes(),
                stakingHbbft,
                "RecoverAbandonedStakes",
            );

            assert.equal(await stakingHbbft.read.abandonedAndRemoved([stakingPool.address]), true);

            for (const staker of stakers) {
                assert.equal(
                    await stakingHbbft.read.maxWithdrawAllowed([
                        stakingPool.address,
                        getAddress(staker.account.address),
                    ]),
                    0n,
                );
            }
        });

        it("should disallow staking to abandoned pool", async function () {
            const { stakingHbbft, validatorSetHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool]);
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers.map((x) => x.account));

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([stakingPool.address]), true);

            await hhViem.assertions.emit(
                stakingHbbft.write.recoverAbandonedStakes(),
                stakingHbbft,
                "RecoverAbandonedStakes",
            );

            assert.equal(await stakingHbbft.read.abandonedAndRemoved([stakingPool.address]), true);

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.stake([stakingPool.address], {
                    account: stakers[0].account,
                    value: delegatorMinStake,
                }),
                stakingHbbft,
                "PoolAbandoned",
                [stakingPool.address],
            );
        });

        it("should not allow stake withdrawal if pool was abandoned", async function () {
            const { stakingHbbft, validatorSetHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            await stake(stakingHbbft, stakingPool.address, candidateMinStake, [stakingPool]);
            await stake(stakingHbbft, stakingPool.address, delegatorMinStake, stakers.map((x) => x.account));

            await setValidatorInactive(stakingHbbft, validatorSetHbbft, stakingPool.address);

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([stakingPool.address]), true);

            await hhViem.assertions.emit(
                stakingHbbft.write.recoverAbandonedStakes(),
                stakingHbbft,
                "RecoverAbandonedStakes",
            );

            assert.equal(await stakingHbbft.read.abandonedAndRemoved([stakingPool.address]), true);

            const staker = stakers[1];

            const maxAllowedWithraw = await stakingHbbft.read.maxWithdrawAllowed([
                stakingPool.address,
                getAddress(staker.account.address),
            ]);
            assert.equal(maxAllowedWithraw, 0n);

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.withdraw([stakingPool.address, delegatorMinStake], { account: staker.account }),
                stakingHbbft,
                "MaxAllowedWithdrawExceeded",
                [maxAllowedWithraw, delegatorMinStake],
            );
        });
    });

    describe("restake", async function () {
        it("should allow calling only to BlockReward contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];
            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.restake([zeroAddress, 0n], { account: caller.account }),
                stakingHbbft,
                "Unauthorized",
            );
        });

        it("should do nothing if zero value provided", async function () {
            const { stakingHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = await impersonateAcc(blockRewardHbbft.address, parseEther("1000"));

            const txHash = await stakingHbbft.write.restake([initialValidators[1].stakingAddress(), 0n], {
                account: caller,
                value: 0n,
            });

            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
            const events = parseEventLogs({
                abi: stakingHbbft.abi,
                eventName: "RestakeReward",
                logs: receipt.logs,
            });

            assert.equal(events.length, 0, "should not emit RestakeReward event");

            await helpers.stopImpersonatingAccount(caller);
        });

        describe("without node operator", async function () {
            it("should restake all rewards to validator without delegators", async function () {
                const { stakingHbbft, blockRewardHbbft, validatorSetHbbft, candidateMinStake } =
                    await helpers.loadFixture(deployContractsFixture);

                assert.equal(await publicClient.getBalance({ address: blockRewardHbbft.address }), 0n);

                for (const validator of initialValidators) {
                    await stakingHbbft.write.stake([validator.stakingAddress()], {
                        account: validator.staking,
                        value: candidateMinStake,
                    });

                    const latestBlock = await publicClient.getBlock();
                    await validatorSetHbbft.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                        account: validator.mining,
                    });

                    assert.equal(
                        await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]),
                        candidateMinStake,
                    );
                }

                await callReward(blockRewardHbbft, true);
                await callReward(blockRewardHbbft, true);

                const fixedEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const deltaPotValue = parseEther("50");
                await blockRewardHbbft.write.addToDeltaPot({ value: deltaPotValue });
                assert.equal(await blockRewardHbbft.read.deltaPot(), deltaPotValue);

                const validators = await validatorSetHbbft.read.getValidators();
                const potsShares = await blockRewardHbbft.read.getPotsShares([BigInt(validators.length)]);

                const validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                const poolReward = validatorRewards / BigInt(validators.length);

                await callReward(blockRewardHbbft, true);

                for (const validator of initialValidators) {
                    assert.equal(
                        await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]),
                        candidateMinStake + poolReward,
                    );
                }
            });

            it("should restake delegators rewards according to stakes", async function () {
                const { stakingHbbft, blockRewardHbbft, validatorSetHbbft, candidateMinStake } =
                    await helpers.loadFixture(deployContractsFixture);

                assert.equal(await publicClient.getBalance({ address: blockRewardHbbft.address }), 0n);

                for (const validator of initialValidators) {
                    await stakingHbbft.write.stake([validator.stakingAddress()], {
                        account: validator.staking,
                        value: candidateMinStake,
                    });

                    const latestBlock = await publicClient.getBlock();
                    await validatorSetHbbft.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                        account: validator.mining,
                    });

                    assert.equal(
                        await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]),
                        candidateMinStake,
                    );
                }

                await callReward(blockRewardHbbft, true);

                interface StakeRecord {
                    delegator: Address;
                    pool: Address;
                    stake: bigint;
                }

                const delegators = accounts.slice(15, 20);
                const stakeRecords = new Array<StakeRecord>();
                const poolTotalStakes = new Map<Address, bigint>();

                for (const _pool of initialValidators) {
                    let _poolTotalStake = candidateMinStake;

                    // first delegator will stake minimum, 2nd = 2x, 3rd = 3x ....
                    let stake = 0n;
                    for (const _delegator of delegators) {
                        stake += minStakeDelegators;
                        stakeRecords.push({
                            delegator: getAddress(_delegator.account.address),
                            pool: _pool.stakingAddress(),
                            stake: stake,
                        });

                        _poolTotalStake += stake;

                        await stakingHbbft.write.stake([_pool.stakingAddress()], {
                            account: _delegator.account,
                            value: stake,
                        });

                        assert.equal(
                            await stakingHbbft.read.stakeAmount([
                                _pool.stakingAddress(),
                                getAddress(_delegator.account.address),
                            ]),
                            stake,
                        );
                    }

                    poolTotalStakes.set(_pool.stakingAddress(), _poolTotalStake);

                    assert.equal(
                        await stakingHbbft.read.stakeAmountTotal([_pool.stakingAddress()]),
                        _poolTotalStake,
                    );
                }

                await callReward(blockRewardHbbft, true);

                const fixedEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const epoch = await stakingHbbft.read.stakingEpoch();

                const deltaPotValue = parseEther("10");
                await blockRewardHbbft.write.addToDeltaPot({ value: deltaPotValue });
                assert.equal(await blockRewardHbbft.read.deltaPot(), deltaPotValue);

                const validators = await validatorSetHbbft.read.getValidators();
                const potsShares = await blockRewardHbbft.read.getPotsShares([BigInt(validators.length)]);

                const validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                const poolReward = validatorRewards / BigInt(validators.length);

                await callReward(blockRewardHbbft, true);

                const validatorFixedRewardPercent = await blockRewardHbbft.read.validatorMinRewardPercent([epoch]);

                for (const _stakeRecord of stakeRecords) {
                    const validatorFixedReward = (poolReward * validatorFixedRewardPercent) / 100n;
                    const rewardsToDistribute = poolReward - validatorFixedReward;

                    const poolTotalStake = poolTotalStakes.get(_stakeRecord.pool)!;

                    const validatorShare =
                        validatorFixedReward + (rewardsToDistribute * candidateMinStake) / poolTotalStake;
                    const delegatorShare = (rewardsToDistribute * _stakeRecord.stake) / poolTotalStake;

                    assertCloseTo(
                        await stakingHbbft.read.stakeAmount([_stakeRecord.pool, _stakeRecord.pool]),
                        candidateMinStake + validatorShare,
                        100n,
                    );

                    assertCloseTo(
                        await stakingHbbft.read.stakeAmount([_stakeRecord.pool, _stakeRecord.delegator]),
                        _stakeRecord.stake + delegatorShare,
                        100n,
                    );
                }
            });
        });

        describe("with node operator", async function () {
            it("should not distribute to node operator with 0% share", async function () {
                const { stakingHbbft, blockRewardHbbft, validatorSetHbbft, candidateMinStake } =
                    await helpers.loadFixture(deployContractsFixture);

                assert.equal(await publicClient.getBalance({ address: blockRewardHbbft.address }), 0n);

                const poolOperators = new Map<Account, Address>();

                for (const validator of initialValidators) {
                    await stakingHbbft.write.stake([validator.stakingAddress()], {
                        account: validator.staking,
                        value: candidateMinStake,
                    });

                    const latestBlock = await publicClient.getBlock();
                    await validatorSetHbbft.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                        account: validator.mining,
                    });

                    assert.equal(
                        await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]),
                        candidateMinStake,
                    );

                    poolOperators.set(validator.staking, createRandomWallet().address);
                }

                await callReward(blockRewardHbbft, true);
                await callReward(blockRewardHbbft, true);

                for (const [pool, operator] of poolOperators) {
                    await stakingHbbft.write.setNodeOperator([operator, 0n], { account: pool });
                }

                const fixedEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const deltaPotValue = parseEther("50");
                await blockRewardHbbft.write.addToDeltaPot({ value: deltaPotValue });
                assert.equal(await blockRewardHbbft.read.deltaPot(), deltaPotValue);

                const validators = await validatorSetHbbft.read.getValidators();
                const potsShares = await blockRewardHbbft.read.getPotsShares([BigInt(validators.length)]);

                const validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                const poolReward = validatorRewards / BigInt(validators.length);

                await callReward(blockRewardHbbft, true);

                for (const validator of initialValidators) {
                    assert.equal(
                        await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]),
                        candidateMinStake + poolReward,
                    );
                }
            });

            it("should include node operators in reward distribution", async function () {
                const { stakingHbbft, blockRewardHbbft, validatorSetHbbft, candidateMinStake } =
                    await helpers.loadFixture(deployContractsFixture);

                interface NodeOperatorConfig {
                    operator: Address;
                    share: bigint;
                }

                interface StakeRecord {
                    pool: Account;
                    delegator: Address;
                    stake: bigint;
                }

                assert.equal(await publicClient.getBalance({ address: blockRewardHbbft.address }), 0n);

                const poolOperators = new Map<Account, NodeOperatorConfig>();
                let i = 0;

                for (const validator of initialValidators) {
                    await stakingHbbft.write.stake([validator.stakingAddress()], {
                        account: validator.staking,
                        value: candidateMinStake,
                    });

                    const latestBlock = await publicClient.getBlock();
                    await validatorSetHbbft.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                        account: validator.mining,
                    });

                    assert.equal(
                        await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]),
                        candidateMinStake,
                    );

                    poolOperators.set(validator.staking, {
                        operator: createRandomWallet().address,
                        share: BigInt(200 * (i++ + 1)),
                    });
                }

                const delegators = accounts.slice(16, 21);
                const stakeRecords = new Array<StakeRecord>();
                const poolTotalStakes = new Map<Address, bigint>();

                for (const _pool of initialValidators) {
                    let _poolTotalStake = candidateMinStake;

                    // first delegator will stake minimum, 2nd = 2x, 3rd = 3x ....
                    let stake = 0n;
                    for (const _delegator of delegators) {
                        stake += minStakeDelegators;
                        stakeRecords.push({
                            delegator: getAddress(_delegator.account.address),
                            pool: _pool.staking,
                            stake: stake,
                        });

                        _poolTotalStake += stake;

                        await stakingHbbft.write.stake([_pool.stakingAddress()], {
                            account: _delegator.account,
                            value: stake,
                        });

                        assert.equal(
                            await stakingHbbft.read.stakeAmount([
                                _pool.stakingAddress(),
                                getAddress(_delegator.account.address),
                            ]),
                            stake,
                        );
                    }

                    poolTotalStakes.set(_pool.stakingAddress(), _poolTotalStake);

                    assert.equal(
                        await stakingHbbft.read.stakeAmountTotal([_pool.stakingAddress()]),
                        _poolTotalStake,
                    );
                }

                await callReward(blockRewardHbbft, true);

                for (const [pool, cfg] of poolOperators) {
                    await stakingHbbft.write.setNodeOperator([cfg.operator, cfg.share], { account: pool });
                }

                const fixedEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const deltaPotValue = parseEther("50");
                await blockRewardHbbft.write.addToDeltaPot({ value: deltaPotValue });
                assert.equal(await blockRewardHbbft.read.deltaPot(), deltaPotValue);

                const validators = await validatorSetHbbft.read.getValidators();
                const potsShares = await blockRewardHbbft.read.getPotsShares([BigInt(validators.length)]);

                const validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                const poolReward = validatorRewards / BigInt(validators.length);

                const epoch = await stakingHbbft.read.stakingEpoch();
                const validatorFixedRewardPercent = await blockRewardHbbft.read.validatorMinRewardPercent([epoch]);

                await callReward(blockRewardHbbft, true);

                for (const _stakeRecord of stakeRecords) {
                    const nodeOperatorCfg = poolOperators.get(_stakeRecord.pool)!;

                    const validatorFixedReward = (poolReward * validatorFixedRewardPercent) / 100n;
                    const rewardsToDistribute = poolReward - validatorFixedReward;
                    const nodeOperatorShare = (poolReward * nodeOperatorCfg.share) / 10000n;

                    const poolTotalStake = poolTotalStakes.get(_stakeRecord.pool.address)!;

                    const validatorShare =
                        validatorFixedReward -
                        nodeOperatorShare +
                        (rewardsToDistribute * candidateMinStake) / poolTotalStake;
                    const delegatorShare = (rewardsToDistribute * _stakeRecord.stake) / poolTotalStake;

                    assertCloseTo(
                        await stakingHbbft.read.stakeAmount([_stakeRecord.pool.address, _stakeRecord.pool.address]),
                        candidateMinStake + validatorShare,
                        100n,
                    );

                    assertCloseTo(
                        await stakingHbbft.read.stakeAmount([_stakeRecord.pool.address, _stakeRecord.delegator]),
                        _stakeRecord.stake + delegatorShare,
                        100n,
                    );

                    assert.equal(
                        await stakingHbbft.read.stakeAmount([_stakeRecord.pool.address, nodeOperatorCfg.operator]),
                        nodeOperatorShare,
                    );
                }
            });

            it("should send operator share to new address if it was changed", async function () {
                const { stakingHbbft, blockRewardHbbft, validatorSetHbbft, candidateMinStake } =
                    await helpers.loadFixture(deployContractsFixture);

                assert.equal(await publicClient.getBalance({ address: blockRewardHbbft.address }), 0n);

                const validator = initialValidators[0];
                const nodeOperator = createRandomWallet().address;
                const nodeOperatorShare = 2000n;

                await stakingHbbft.write.stake([validator.stakingAddress()], {
                    account: validator.staking,
                    value: candidateMinStake,
                });

                const latestBlock = await publicClient.getBlock();
                await validatorSetHbbft.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                    account: validator.mining,
                });
                assert.equal(
                    await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]),
                    candidateMinStake,
                );

                await callReward(blockRewardHbbft, true);

                // set node operator
                await stakingHbbft.write.setNodeOperator([nodeOperator, nodeOperatorShare], {
                    account: validator.staking,
                });

                const fixedEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const deltaPotValue = parseEther("50");
                await blockRewardHbbft.write.addToDeltaPot({ value: deltaPotValue });
                assert.equal(await blockRewardHbbft.read.deltaPot(), deltaPotValue);

                const validators = await validatorSetHbbft.read.getValidators();
                let potsShares = await blockRewardHbbft.read.getPotsShares([BigInt(validators.length)]);

                let validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                let poolReward = validatorRewards;

                let poolTotalStake = await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]);

                // distribute epoch rewards, so node operator will get shares
                await callReward(blockRewardHbbft, true);

                // node operator should get all of the fixed validator rewards;
                const expectedOperatorStake = (poolReward * nodeOperatorShare) / 10000n;
                let expectedValidatorStake =
                    candidateMinStake + ((poolReward - expectedOperatorStake) * candidateMinStake) / poolTotalStake;

                assert.equal(
                    await stakingHbbft.read.stakeAmount([validator.stakingAddress(), nodeOperator]),
                    expectedOperatorStake,
                );
                assert.equal(
                    await stakingHbbft.read.stakeAmount([validator.stakingAddress(), validator.stakingAddress()]),
                    expectedValidatorStake,
                );

                const newOperator = createRandomWallet().address;
                const oldOperatorStake = await stakingHbbft.read.stakeAmount([
                    validator.stakingAddress(),
                    nodeOperator,
                ]);
                const prevValidatorStake = await stakingHbbft.read.stakeAmount([
                    validator.stakingAddress(),
                    validator.stakingAddress(),
                ]);

                await stakingHbbft.write.setNodeOperator([newOperator, nodeOperatorShare], {
                    account: validator.staking,
                });

                await callReward(blockRewardHbbft, true);

                potsShares = await blockRewardHbbft.read.getPotsShares([BigInt(validators.length)]);
                validatorRewards = potsShares.totalRewards - potsShares.governancePotAmount;
                poolReward = validatorRewards;

                poolTotalStake = await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]);

                const newOperatorStake = (poolReward * nodeOperatorShare) / 10000n;
                const expectedOldOperatorStake =
                    oldOperatorStake + ((poolReward - newOperatorStake) * oldOperatorStake) / poolTotalStake;
                expectedValidatorStake =
                    prevValidatorStake + ((poolReward - newOperatorStake) * prevValidatorStake) / poolTotalStake;

                assert.equal(
                    await stakingHbbft.read.stakeAmount([validator.stakingAddress(), newOperator]),
                    newOperatorStake,
                );
                assert.equal(
                    await stakingHbbft.read.stakeAmount([validator.stakingAddress(), nodeOperator]),
                    expectedOldOperatorStake,
                );
                assert.equal(
                    await stakingHbbft.read.stakeAmount([validator.stakingAddress(), validator.stakingAddress()]),
                    expectedValidatorStake,
                );
            });
        });
    });

    describe("setDelegatorMinStake", async function () {
        it("should allow calling only to contract owner", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];
            await hhViem.assertions.revertWithCustomErrorWithArgs(
                stakingHbbft.write.setDelegatorMinStake([parseEther("10")], { account: caller.account }),
                stakingHbbft,
                "OwnableUnauthorizedAccount",
                [getAddress(caller.account.address)],
            );
        });

        it("should set delegator min stake", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const minStakeValue = parseEther("150");
            await stakingHbbft.write.setDelegatorMinStake([minStakeValue]);
            assert.equal(await stakingHbbft.read.delegatorMinStake(), minStakeValue);
        });
    });

    describe("snapshotPoolStakeAmounts", async function () {
        it("should allow calling only by BlockReward contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];
            const pool = initialValidators[1].stakingAddress();

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.snapshotPoolStakeAmounts([0n, pool], { account: caller.account }),
                stakingHbbft,
                "Unauthorized",
            );
        });

        it("should create validator stake snapshot after epoch close", async function () {
            const { stakingHbbft, blockRewardHbbft, candidateMinStake, delegatorMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const delegator = accounts[10];

            let stakingEpoch = await stakingHbbft.read.stakingEpoch();
            for (let i = 0; i < initialValidators.length; ++i) {
                const pool = initialValidators[i].staking;
                const stakeAmount = BigInt(i + 1) * delegatorMinStake;

                await stakingHbbft.write.stake([pool.address], { account: pool, value: candidateMinStake });

                await stakingHbbft.write.stake([pool.address], {
                    account: delegator.account,
                    value: stakeAmount,
                });
                assert.equal(
                    await stakingHbbft.read.stakeAmountTotal([pool.address]),
                    candidateMinStake + stakeAmount,
                );
                assert.equal(
                    await stakingHbbft.read.snapshotPoolTotalStakeAmount([stakingEpoch, pool.address]),
                    0n,
                );
                assert.equal(
                    await stakingHbbft.read.snapshotPoolValidatorStakeAmount([stakingEpoch, pool.address]),
                    0n,
                );
            }

            await callReward(blockRewardHbbft, true);
            stakingEpoch = await stakingHbbft.read.stakingEpoch();

            for (let i = 0; i < initialValidators.length; ++i) {
                const pool = initialValidators[i].staking;
                const stakeAmount = BigInt(i + 1) * delegatorMinStake;

                assert.equal(
                    await stakingHbbft.read.stakeAmountTotal([pool.address]),
                    candidateMinStake + stakeAmount,
                );
                assert.equal(
                    await stakingHbbft.read.snapshotPoolTotalStakeAmount([stakingEpoch, pool.address]),
                    candidateMinStake + stakeAmount,
                );
                assert.equal(
                    await stakingHbbft.read.getPoolValidatorStakeAmount([stakingEpoch, pool.address]),
                    candidateMinStake,
                );
            }
        });
    });

    describe("setPoolInfo", async function () {
        let stakingHbbft: StakingHbbftMock;
        let validator: Validator;

        beforeEach(async function () {
            const { stakingHbbft: _stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            stakingHbbft = _stakingHbbft;

            validator = initialValidators[1];
        });

        it("should update own pool info using setPoolInfo", async function () {
            const port: Hex = "0x6987";

            await stakingHbbft.write.setPoolInfo([validator.publicKey(), validator.ipAddress, port], {
                account: validator.staking,
            });

            const poolInfo = await stakingHbbft.read.poolInfo([validator.stakingAddress()]);
            assert.equal(poolInfo[0], validator.publicKey());
            assert.equal(poolInfo[1], validator.ipAddress);
            assert.equal(poolInfo[2], port);
        });
    });

    // The issue happened due to pool staking address set as node operator.
    // As a result, the pool's staking address was included in the list of delegators
    // and received extra epoch rewards that it shouldn't have received.
    //
    // https://github.com/DMDcoin/Diamond/issues/6
    describe("Epoch 22 incident", async function () {
        it("should not add node operator to delegators if poolStaking==nodeOperator", async function () {
            const { stakingHbbft, blockRewardHbbft, validatorSetHbbft } =
                await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const delegator = accounts[10];
            const delegatorAddr = getAddress(delegator.account.address);
            const nodeOperatorShare = 2000n; // 20% -> 100% of fixed validator rewards goes to the node operator

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: minStake,
            });

            const latestBlock = await publicClient.getBlock();
            await validatorSetHbbft.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                account: validator.mining,
            });

            await callReward(blockRewardHbbft, true);

            // Set validator as node operator
            await stakingHbbft.write.setNodeOperatorMock(
                [validator.stakingAddress(), validator.stakingAddress(), nodeOperatorShare],
                { account: validator.staking },
            );

            assert.equal(
                await stakingHbbft.read.poolNodeOperator([validator.stakingAddress()]),
                validator.stakingAddress(),
            );

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator.account,
                value: minStakeDelegators,
            });

            for (let i = 0; i < 10; i++) {
                const deltaPotValue = 498417145652170827726272n;
                await blockRewardHbbft.write.addToDeltaPot({ value: deltaPotValue });

                const fixedEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                await callReward(blockRewardHbbft, true);

                const delegators = await stakingHbbft.read.poolDelegators([validator.stakingAddress()]);

                const validatorStake = await stakingHbbft.read.stakeAmount([
                    validator.stakingAddress(),
                    validator.stakingAddress(),
                ]);
                const totalStake = await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]);
                const delegatorStake = await stakingHbbft.read.stakeAmount([
                    validator.stakingAddress(),
                    delegatorAddr,
                ]);

                assert.equal(delegators.includes(validator.stakingAddress()), false);
                assert.ok(validatorStake <= totalStake);
                assert.ok(validatorStake + delegatorStake <= totalStake);
            }
        });
    });

    // Another issue in rewards distribution, which caused pool self stake
    // to be higher than pool total stake. Fix includes updates
    // in orderWithdraw, restake, _snapshotDelegatorStake and _getDelegatorStake functions.
    describe("Epoch 79 incident", async function () {
        async function verifyStakeConsistency(
            stakingHbbft: StakingHbbftMock,
            poolAddress: Address,
            delegators: Address[],
            toleranceEther: string = "0",
        ) {
            const validatorStake = await stakingHbbft.read.stakeAmount([poolAddress, poolAddress]);
            const totalStake = await stakingHbbft.read.stakeAmountTotal([poolAddress]);

            let sumOfStakes = validatorStake;
            for (const delegator of delegators) {
                const delegatorStake = await stakingHbbft.read.stakeAmount([poolAddress, delegator]);
                sumOfStakes += delegatorStake;
            }

            assert.ok(sumOfStakes <= totalStake);

            const diff = totalStake - sumOfStakes;
            const tolerance = parseEther(toleranceEther) + 100n;

            assert.ok(diff <= tolerance, `expected stake diff ${diff} to be within tolerance ${tolerance}`);

            return { sumOfStakes, totalStake, diff };
        }

        it("should handle multiple withdraw orders and cancels", async function () {
            const { stakingHbbft, blockRewardHbbft, candidateMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const delegator = accounts[10];
            const delegatorAddr = getAddress(delegator.account.address);

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: candidateMinStake,
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator.account,
                value: parseEther("400"),
            });

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);

            for (let i = 0; i < 5; i++) {
                await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), parseEther("100")], {
                    account: delegator.account,
                });
                await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), -parseEther("100")], {
                    account: delegator.account,
                });
            }

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            const caller = await impersonateAcc(blockRewardHbbft.address, parseEther("1000"));
            await stakingHbbft.write.restake([validator.stakingAddress(), 30n], {
                account: caller,
                value: parseEther("100"),
            });
            await helpers.stopImpersonatingAccount(caller);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);
        });

        it("should handle delegator mid-epoch stakes", async function () {
            const { stakingHbbft, blockRewardHbbft, candidateMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const delegator1 = accounts[10];
            const delegator2 = accounts[11];

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: candidateMinStake,
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator1.account,
                value: parseEther("400"),
            });

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            const epoch1 = await stakingHbbft.read.stakingEpoch();
            assert.equal(epoch1, 1n);

            const delegator2StakeAmount = parseEther("500");
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator2.account,
                value: delegator2StakeAmount,
            });

            const delegator2StakeBefore = await stakingHbbft.read.stakeAmount([
                validator.stakingAddress(),
                getAddress(delegator2.account.address),
            ]);
            assert.equal(delegator2StakeBefore, delegator2StakeAmount);

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            const epoch2 = await stakingHbbft.read.stakingEpoch();
            assert.equal(epoch2, 2n);

            const delegator2StakeAfterEpoch1 = await stakingHbbft.read.stakeAmount([
                validator.stakingAddress(),
                getAddress(delegator2.account.address),
            ]);
            assert.equal(delegator2StakeAfterEpoch1, delegator2StakeAmount);

            const caller = await impersonateAcc(blockRewardHbbft.address, parseEther("1000"));
            await stakingHbbft.write.restake([validator.stakingAddress(), 30n], {
                account: caller,
                value: parseEther("100"),
            });
            await helpers.stopImpersonatingAccount(caller);

            const delegator2StakeAfterRewards = await stakingHbbft.read.stakeAmount([
                validator.stakingAddress(),
                getAddress(delegator2.account.address),
            ]);
            assert.ok(delegator2StakeAfterRewards > delegator2StakeAmount);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [
                getAddress(delegator1.account.address),
                getAddress(delegator2.account.address),
            ]);
        });

        it("should handle full withdraw and stake again", async function () {
            const { stakingHbbft, blockRewardHbbft, candidateMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const delegator = accounts[10];
            const delegatorAddr = getAddress(delegator.account.address);

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: candidateMinStake,
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator.account,
                value: parseEther("400"),
            });

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);

            await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), parseEther("400")], {
                account: delegator.account,
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator.account,
                value: parseEther("300"),
            });

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            const caller = await impersonateAcc(blockRewardHbbft.address, parseEther("1000"));
            await stakingHbbft.write.restake([validator.stakingAddress(), 30n], {
                account: caller,
                value: parseEther("100"),
            });
            await helpers.stopImpersonatingAccount(caller);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);
        });

        it("should handle multiple delegators actions", async function () {
            const { stakingHbbft, blockRewardHbbft, candidateMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const delegator1 = accounts[10];
            const delegator2 = accounts[11];
            const delegator3 = accounts[12];

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: candidateMinStake,
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator1.account,
                value: parseEther("300"),
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator2.account,
                value: parseEther("400"),
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator3.account,
                value: parseEther("200"),
            });

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            const delegators = [
                getAddress(delegator1.account.address),
                getAddress(delegator2.account.address),
                getAddress(delegator3.account.address),
            ];
            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), delegators);

            await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), parseEther("150")], {
                account: delegator1.account,
            });

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), -parseEther("150")], {
                account: delegator1.account,
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator3.account,
                value: parseEther("100"),
            });

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), delegators);

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            const caller = await impersonateAcc(blockRewardHbbft.address, parseEther("1000"));
            await stakingHbbft.write.restake([validator.stakingAddress(), 30n], {
                account: caller,
                value: parseEther("100"),
            });
            await helpers.stopImpersonatingAccount(caller);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), delegators, "10");
        });

        it("should handle random orderWitdhraw/cancel requests", async function () {
            const { stakingHbbft, blockRewardHbbft, candidateMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const delegators = [accounts[10], accounts[11], accounts[12]];

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: candidateMinStake,
            });
            for (const delegator of delegators) {
                await stakingHbbft.write.stake([validator.stakingAddress()], {
                    account: delegator.account,
                    value: parseEther("300"),
                });
            }

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            const delegatorAddresses = delegators.map((d) => getAddress(d.account.address));

            for (let epoch = 0; epoch < 10; ++epoch) {
                const delegatorIdx = epoch % 3;
                const delegator = delegators[delegatorIdx];
                const delegatorAddr = delegatorAddresses[delegatorIdx];

                if (epoch % 2 === 0) {
                    const maxWithdraw = await stakingHbbft.read.maxWithdrawOrderAllowed([
                        validator.stakingAddress(),
                        delegatorAddr,
                    ]);
                    if (maxWithdraw >= parseEther("50")) {
                        await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), parseEther("50")], {
                            account: delegator.account,
                        });
                    }
                } else {
                    const orderedAmount = await stakingHbbft.read.orderedWithdrawAmount([
                        validator.stakingAddress(),
                        delegatorAddr,
                    ]);
                    if (orderedAmount > 0n) {
                        await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), -orderedAmount], {
                            account: delegator.account,
                        });
                    }
                }

                await callReward(blockRewardHbbft, false);
                await callReward(blockRewardHbbft, true);

                const caller = await impersonateAcc(blockRewardHbbft.address, parseEther("1000"));
                await stakingHbbft.write.restake([validator.stakingAddress(), 30n], {
                    account: caller,
                    value: parseEther("50"),
                });
                await helpers.stopImpersonatingAccount(caller);

                await verifyStakeConsistency(
                    stakingHbbft,
                    validator.stakingAddress(),
                    delegatorAddresses,
                    String(epoch + 2),
                );
            }

            const finalValidator = await stakingHbbft.read.stakeAmount([
                validator.stakingAddress(),
                validator.stakingAddress(),
            ]);
            const finalTotal = await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), delegatorAddresses, "15");

            assert.ok(finalValidator <= finalTotal);
        });

        it("should handle validator stake withdraw order", async function () {
            const { stakingHbbft, blockRewardHbbft, candidateMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const delegator = accounts[10];
            const delegatorAddr = getAddress(delegator.account.address);

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: candidateMinStake,
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator.account,
                value: parseEther("400"),
            });

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            const caller = await impersonateAcc(blockRewardHbbft.address, parseEther("1000"));
            await stakingHbbft.write.restake([validator.stakingAddress(), 30n], {
                account: caller,
                value: parseEther("100"),
            });
            await helpers.stopImpersonatingAccount(caller);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);
        });

        it("should handle rapid stake/withdraw cycle", async function () {
            const { stakingHbbft, blockRewardHbbft, candidateMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const delegator = accounts[10];
            const delegatorAddr = getAddress(delegator.account.address);

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: candidateMinStake,
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator.account,
                value: parseEther("2000"),
            });

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            for (let i = 0; i < 20; i++) {
                if (i % 2 === 0) {
                    await stakingHbbft.write.stake([validator.stakingAddress()], {
                        account: delegator.account,
                        value: parseEther("10"),
                    });
                } else {
                    const maxOrder = await stakingHbbft.read.maxWithdrawOrderAllowed([
                        validator.stakingAddress(),
                        delegatorAddr,
                    ]);
                    if (maxOrder >= parseEther("10")) {
                        await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), parseEther("10")], {
                            account: delegator.account,
                        });
                    }
                }
            }

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            const caller = await impersonateAcc(blockRewardHbbft.address, parseEther("1000"));
            await stakingHbbft.write.restake([validator.stakingAddress(), 30n], {
                account: caller,
                value: parseEther("100"),
            });
            await helpers.stopImpersonatingAccount(caller);

            await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [delegatorAddr]);
        });

        it("should keep stake data consistent after orderWithdraw/cancel", async function () {
            const { stakingHbbft, blockRewardHbbft, candidateMinStake } =
                await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const delegator = accounts[10];
            const delegatorAddr = getAddress(delegator.account.address);

            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: candidateMinStake,
            });
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: delegator.account,
                value: parseEther("400"),
            });

            await callReward(blockRewardHbbft, false);
            await callReward(blockRewardHbbft, true);

            for (let i = 0; i < 5; ++i) {
                await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), parseEther("200")], {
                    account: delegator.account,
                });

                await callReward(blockRewardHbbft, false);
                await callReward(blockRewardHbbft, true);

                await stakingHbbft.write.orderWithdraw([validator.stakingAddress(), -parseEther("200")], {
                    account: delegator.account,
                });

                const caller = await impersonateAcc(blockRewardHbbft.address, parseEther("1000"));
                await stakingHbbft.write.restake([validator.stakingAddress(), 30n], {
                    account: caller,
                    value: parseEther("100"),
                });
                await helpers.stopImpersonatingAccount(caller);

                const result = await verifyStakeConsistency(stakingHbbft, validator.stakingAddress(), [
                    delegatorAddr,
                ]);

                assert.ok(result.diff <= 100n);
            }

            const finalValidator = await stakingHbbft.read.stakeAmount([
                validator.stakingAddress(),
                validator.stakingAddress(),
            ]);
            const finalTotal = await stakingHbbft.read.stakeAmountTotal([validator.stakingAddress()]);

            assert.ok(finalValidator <= finalTotal);
        });
    });

    describe("other functions", async function () {
        it("should restrict calling notifyKeyGenFailed to validator set contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.notifyKeyGenFailed({ account: caller.account }),
                stakingHbbft,
                "Unauthorized",
            );
        });

        it("should restrict calling notifyNetworkOfftimeDetected to validator set contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.notifyNetworkOfftimeDetected([0n], { account: caller.account }),
                stakingHbbft,
                "Unauthorized",
            );
        });

        it("should restrict calling notifyAvailability to validator set contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            const validator = initialValidators[1];

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.notifyAvailability([validator.stakingAddress()], { account: caller.account }),
                stakingHbbft,
                "Unauthorized",
            );
        });

        it("should restrict calling notifyEarlyEpochEnd to block reward contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.notifyEarlyEpochEnd([0n], { account: caller.account }),
                stakingHbbft,
                "Unauthorized",
            );
        });

        it("should restrict calling setStakingEpochStartTime to validator set contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.setStakingEpochStartTime([0n], { account: caller.account }),
                stakingHbbft,
                "Unauthorized",
            );
        });

        it("should restrict calling setValidatorInternetAddress to validator set contract", async function () {
            const { stakingHbbft } = await helpers.loadFixture(deployContractsFixture);
            const caller = accounts[10];

            await hhViem.assertions.revertWithCustomError(
                stakingHbbft.write.setValidatorInternetAddress([zeroAddress, candidate.ipAddress, "0x6987"], {
                    account: caller.account,
                }),
                stakingHbbft,
                "Unauthorized",
            );
        });

        it("should update validator ip:port using setValidatorInternetAddress", async function () {
            const { stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[1];
            const port: Hex = "0x6987";

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await stakingHbbft.write.setValidatorInternetAddress(
                [validator.stakingAddress(), validator.ipAddress, port],
                { account: validatorSetCaller },
            );
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            const poolInfo = await stakingHbbft.read.poolInfo([validator.stakingAddress()]);
            assert.equal(poolInfo[1], validator.ipAddress);
            assert.equal(poolInfo[2], port);
        });
    });
});
