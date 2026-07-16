import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import { parseEther, zeroAddress, type Address } from "viem";

import { getNValidatorsPartNAcks } from "./fixtures/data.js";
import { deployDao } from "./fixtures/dao.js";
import { deployProxy } from "./fixtures/proxy.js";
import { splitPublicKeys } from "./fixtures/utils.js";
import { Validator } from "./fixtures/validator.js";
import type { BlockRewardHbbftMock, KeyGenHistory, ValidatorSetHbbftMock } from "./fixtures/types.js";

const connection = await hre.network.getOrCreate();
const { viem: hhViem, networkHelpers: helpers } = connection;

const publicClient = await hhViem.getPublicClient();
type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

const stakingTransitionWindowLength = 3600n;
const stakeWithdrawDisallowPeriod = 2n; // one less than EPOCH DURATION, therefore it meets the conditions.
const stakingFixedEpochDuration = 86400n;
const validatorInactivityThreshold = 365n * 86400n; // 1 year

const reportDisallowPeriod = 15n * 60n;

const candidateMinStake = parseEther("1");
const delegatorMinStake = parseEther("100");

const SystemAccountAddress: Address = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";

describe("Early Epoch End", async function () {
    let owner: TestWalletClient;
    let stubAccount: TestWalletClient;

    let initialValidators: Array<Validator>;
    let pendingValidators: Array<Validator>;

    before(async () => {
        [owner, stubAccount] = await hhViem.getWalletClients();

        initialValidators = new Array<Validator>();
        pendingValidators = new Array<Validator>();

        for (let i = 0; i < 3; ++i) {
            const validator = await Validator.create();
            initialValidators.push(validator);
        }

        for (let i = 0; i < 3; ++i) {
            const validator = await Validator.create();
            pendingValidators.push(validator);
        }
    });

    async function announceAvailability(validator: Validator, validatorSet: ValidatorSetHbbftMock) {
        const latestBlock = await publicClient.getBlock();

        await validatorSet.write.announceAvailability([latestBlock.number, latestBlock.hash], {
            account: validator.mining,
        });
    }

    async function deployContractsFixture() {
        const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

        const initStakingAddresses = initialValidators.map((x) => x.stakingAddress());
        const initMiningAddresses = initialValidators.map((x) => x.miningAddress());
        const initIpAddresses = initialValidators.map((x) => x.ipAddress);
        const initPublicKeys = splitPublicKeys(initialValidators.map((x) => x.publicKey()));

        const bonusScoreContractMock = await hhViem.deployContract("BonusScoreSystemMock");

        await deployDao();

        const validatorSetParams = {
            blockRewardContract: stubAccount.account.address,
            randomContract: stubAccount.account.address,
            stakingContract: stubAccount.account.address,
            keyGenHistoryContract: stubAccount.account.address,
            bonusScoreContract: bonusScoreContractMock.address,
            connectivityTrackerContract: stubAccount.account.address,
            validatorInactivityThreshold: validatorInactivityThreshold,
        };

        const validatorSetContract = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
            initArgs: [
                owner.account.address,
                validatorSetParams,   // _params
                initMiningAddresses,  // _initialMiningAddresses
                initStakingAddresses, // _initialStakingAddresses
            ],
            initializer: "initialize",
        });

        const randomHbbftContract = await deployProxy(hhViem, "RandomHbbft", {
            initArgs: [owner.account.address, validatorSetContract.address],
            initializer: "initialize",
        });

        const keyGenHistoryContract = await deployProxy(hhViem, "KeyGenHistory", {
            initArgs: [owner.account.address, validatorSetContract.address, initMiningAddresses, parts, acks],
            initializer: "initialize",
        });

        const certifierContract = await deployProxy(hhViem, "CertifierHbbft", {
            initArgs: [[owner.account.address], validatorSetContract.address, owner.account.address],
            initializer: "initialize",
        });

        const txPermissionContract = await deployProxy(hhViem, "TxPermissionHbbftMock", {
            initArgs: [
                [owner.account.address],
                certifierContract.address,
                validatorSetContract.address,
                keyGenHistoryContract.address,
                stubAccount.account.address,
                owner.account.address,
            ],
            initializer: "initialize",
        });

        const blockRewardContract = await deployProxy(hhViem, "BlockRewardHbbftMock", {
            initArgs: [owner.account.address, validatorSetContract.address, stubAccount.account.address],
            initializer: "initialize",
        });

        const structure = {
            _validatorSetContract: validatorSetContract.address,
            _bonusScoreContract: bonusScoreContractMock.address,
            _initialStakingAddresses: initStakingAddresses,
            _delegatorMinStake: delegatorMinStake,
            _candidateMinStake: candidateMinStake,
            _maxStake: parseEther("100000"),
            _stakingFixedEpochDuration: stakingFixedEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionWindowLength,
            _stakingWithdrawDisallowPeriod: stakeWithdrawDisallowPeriod,
        };

        const stakingContract = await deployProxy(hhViem, "StakingHbbftMock", {
            initArgs: [
                owner.account.address,
                structure,       // initializer structure
                initPublicKeys,  // _publicKeys
                initIpAddresses, // _internetAddresses
            ],
            initializer: "initialize",
        });

        const connectivityTracker = await deployProxy(hhViem, "ConnectivityTrackerHbbft", {
            initArgs: [
                owner.account.address,
                validatorSetContract.address,
                stakingContract.address,
                blockRewardContract.address,
                bonusScoreContractMock.address,
                reportDisallowPeriod,
            ],
            initializer: "initialize",
        });

        await blockRewardContract.write.setConnectivityTracker([connectivityTracker.address]);
        await txPermissionContract.write.setConnectivityTracker([connectivityTracker.address]);
        await validatorSetContract.write.setConnectivityTracker([connectivityTracker.address]);
        await validatorSetContract.write.setBlockRewardContract([blockRewardContract.address]);
        await validatorSetContract.write.setRandomContract([randomHbbftContract.address]);
        await validatorSetContract.write.setStakingContract([stakingContract.address]);
        await validatorSetContract.write.setKeyGenHistoryContract([keyGenHistoryContract.address]);

        for (const validator of initialValidators) {
            await stakingContract.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: candidateMinStake,
            });

            await announceAvailability(validator, validatorSetContract);
        }

        return {
            blockRewardContract,
            validatorSetContract,
            stakingContract,
            connectivityTracker,
            keyGenHistoryContract,
        };
    }

    describe("Early epoch end cases", async function () {
        async function impersonateAcc(address: Address): Promise<Address> {
            await helpers.impersonateAccount(address);
            await helpers.setBalance(address, parseEther("10"));

            return address;
        }

        async function callReward(_blockReward: BlockRewardHbbftMock, isEpochEndBlock: boolean) {
            const systemAccount = await impersonateAcc(SystemAccountAddress);

            await _blockReward.write.reward([isEpochEndBlock], { account: systemAccount });

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        }

        async function writePart(currentEpoch: bigint, validator: Validator, keyGenContract: KeyGenHistory) {
            const { parts } = getNValidatorsPartNAcks(1);
            const currentRound = await keyGenContract.read.currentKeyGenRound();

            await keyGenContract.write.writePart([currentEpoch + 1n, currentRound, parts[0]], {
                account: validator.mining,
            });
        }

        async function writeAck(currentEpoch: bigint, validator: Validator, keyGenContract: KeyGenHistory) {
            const { acks } = getNValidatorsPartNAcks(1);
            const currentRound = await keyGenContract.read.currentKeyGenRound();

            await keyGenContract.write.writeAcks([currentEpoch + 1n, currentRound, acks[0]], {
                account: validator.mining,
            });
        }

        it("should end epoch earlier and select new validators", async function () {
            const {
                validatorSetContract,
                blockRewardContract,
                stakingContract,
                connectivityTracker,
                keyGenHistoryContract,
            } = await helpers.loadFixture(deployContractsFixture);

            const additionalValidator = pendingValidators[0];

            // There are 3 initial validators, adding one more
            await stakingContract.write.addPool(
                [
                    additionalValidator.miningAddress(),
                    zeroAddress,
                    0n,
                    additionalValidator.publicKey(),
                    additionalValidator.ipAddress,
                ],
                { account: additionalValidator.staking, value: candidateMinStake },
            );

            await announceAvailability(additionalValidator, validatorSetContract);

            // Configure staking epoch
            const validatorSetCaller = await impersonateAcc(validatorSetContract.address);
            await stakingContract.write.incrementStakingEpoch({ account: validatorSetCaller });

            let latestBlock = await publicClient.getBlock();
            await stakingContract.write.setStakingEpochStartTime([latestBlock.timestamp], {
                account: validatorSetCaller,
            });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            // Report one active validator after disallow period
            const validatorToReport = initialValidators[initialValidators.length - 1];
            await helpers.time.increase(await connectivityTracker.read.reportDisallowPeriod());

            for (const validator of initialValidators) {
                if (validator.miningAddress() != validatorToReport.miningAddress()) {
                    const latestBlock = await publicClient.getBlock();

                    await connectivityTracker.write.reportMissingConnectivity(
                        [validatorToReport.miningAddress(), latestBlock.number, latestBlock.hash],
                        { account: validator.mining },
                    );
                }
            }

            assert.equal(
                await stakingContract.read.earlyEpochEndTriggerTime(),
                0n,
                "early epoch end trigger time should not be set",
            );
            assert.equal(await stakingContract.read.earlyEpochEndTime(), 0n, "early epoch end time should not be set");

            const currentEpoch = await stakingContract.read.stakingEpoch();
            assert.equal(await connectivityTracker.read.isEarlyEpochEnd([currentEpoch]), true);
            assert.equal(await blockRewardContract.read.earlyEpochEnd(), true);
            assert.equal((await validatorSetContract.read.getPendingValidators()).length, 0);

            // Emulate block generation
            await callReward(blockRewardContract, false);

            // BlockReward contract should write EarlyEpochEnd trigger time, reset own flag
            // and initiate key generation
            latestBlock = await publicClient.getBlock();
            assert.equal(await blockRewardContract.read.earlyEpochEnd(), false);
            assert.equal(await stakingContract.read.earlyEpochEndTriggerTime(), latestBlock.timestamp);

            const selectedPendingValidators = await validatorSetContract.read.getPendingValidators();
            assert.notEqual(selectedPendingValidators.length, 0);

            const expectedEarlyEpochEndTime =
                latestBlock.timestamp +
                stakingTransitionWindowLength +
                (await stakingContract.read.currentKeyGenExtraTimeWindow());

            assert.equal(await stakingContract.read.earlyEpochEndTime(), expectedEarlyEpochEndTime);

            // Write pending validators parts and acks
            for (const validator of [...initialValidators, ...pendingValidators]) {
                if (!selectedPendingValidators.includes(validator.miningAddress())) {
                    continue;
                }

                await writePart(currentEpoch, validator, keyGenHistoryContract);
            }

            for (const validator of [...initialValidators, ...pendingValidators]) {
                if (!selectedPendingValidators.includes(validator.miningAddress())) {
                    continue;
                }

                await writeAck(currentEpoch, validator, keyGenHistoryContract);
            }

            // Emulate block generation
            await callReward(blockRewardContract, true);

            assert.deepEqual(await validatorSetContract.read.getValidators(), selectedPendingValidators);
            assert.equal(await stakingContract.read.stakingEpoch(), currentEpoch + 1n);
            assert.equal(await stakingContract.read.earlyEpochEndTriggerTime(), 0n);
            assert.equal(await stakingContract.read.earlyEpochEndTime(), 0n);
        });

        it("should handle failed key generation during early epoch end", async function () {
            const {
                validatorSetContract,
                blockRewardContract,
                stakingContract,
                connectivityTracker,
                keyGenHistoryContract,
            } = await helpers.loadFixture(deployContractsFixture);

            const additionalValidator = pendingValidators[0];

            // There are 3 initial validators, adding one more
            await stakingContract.write.addPool(
                [
                    additionalValidator.miningAddress(),
                    zeroAddress,
                    0n,
                    additionalValidator.publicKey(),
                    additionalValidator.ipAddress,
                ],
                { account: additionalValidator.staking, value: candidateMinStake },
            );

            await announceAvailability(additionalValidator, validatorSetContract);

            // Configure staking epoch
            const validatorSetCaller = await impersonateAcc(validatorSetContract.address);
            await stakingContract.write.incrementStakingEpoch({ account: validatorSetCaller });

            let latestBlock = await publicClient.getBlock();
            await stakingContract.write.setStakingEpochStartTime([latestBlock.timestamp], {
                account: validatorSetCaller,
            });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            // Report one active validator after disallow period
            const validatorToReport = initialValidators[initialValidators.length - 1];
            await helpers.time.increase(await connectivityTracker.read.reportDisallowPeriod());

            for (const validator of initialValidators) {
                if (validator.miningAddress() != validatorToReport.miningAddress()) {
                    const latestBlock = await publicClient.getBlock();

                    await connectivityTracker.write.reportMissingConnectivity(
                        [validatorToReport.miningAddress(), latestBlock.number, latestBlock.hash],
                        { account: validator.mining },
                    );
                }
            }

            assert.equal(
                await stakingContract.read.earlyEpochEndTriggerTime(),
                0n,
                "early epoch end trigger time should not be set",
            );
            assert.equal(await stakingContract.read.earlyEpochEndTime(), 0n, "early epoch end time should not be set");

            const currentEpoch = await stakingContract.read.stakingEpoch();
            assert.equal(await connectivityTracker.read.isEarlyEpochEnd([currentEpoch]), true);
            assert.equal(await blockRewardContract.read.earlyEpochEnd(), true);
            assert.equal((await validatorSetContract.read.getPendingValidators()).length, 0);

            // Emulate block generation
            await callReward(blockRewardContract, false);

            // BlockReward contract should write EarlyEpochEnd trigger time, reset own flag
            // and initiate key generation
            latestBlock = await publicClient.getBlock();
            assert.equal(await blockRewardContract.read.earlyEpochEnd(), false);
            assert.equal(await stakingContract.read.earlyEpochEndTriggerTime(), latestBlock.timestamp);

            let expectedEarlyEpochEndTime =
                latestBlock.timestamp +
                stakingTransitionWindowLength +
                (await stakingContract.read.currentKeyGenExtraTimeWindow());

            assert.equal(await stakingContract.read.earlyEpochEndTime(), expectedEarlyEpochEndTime);

            const selectedPendingValidators = await validatorSetContract.read.getPendingValidators();
            assert.notEqual(selectedPendingValidators.length, 0);

            const validatorsToWriteParts = selectedPendingValidators.slice(0, 2);

            // Emulate failed key generation, 2 of 3 pending validators writtern their parts
            for (const validator of [...initialValidators, ...pendingValidators]) {
                if (!validatorsToWriteParts.includes(validator.miningAddress())) {
                    continue;
                }

                await writePart(currentEpoch, validator, keyGenHistoryContract);
            }

            const keyGenRoundPreviousValue = await keyGenHistoryContract.read.getCurrentKeyGenRound();

            const earlyEpochEndTime = await stakingContract.read.earlyEpochEndTime();
            await helpers.time.increaseTo(earlyEpochEndTime + 1n);
            await callReward(blockRewardContract, false);

            expectedEarlyEpochEndTime += stakingTransitionWindowLength;
            assert.equal(await keyGenHistoryContract.read.getCurrentKeyGenRound(), keyGenRoundPreviousValue + 1n);
            assert.equal(
                await stakingContract.read.earlyEpochEndTime(),
                expectedEarlyEpochEndTime,
                "keygen extra time windown should have increased",
            );

            // Emulate block generation
            await callReward(blockRewardContract, true);

            assert.deepEqual(await validatorSetContract.read.getValidators(), validatorsToWriteParts);
            assert.equal(await stakingContract.read.stakingEpoch(), currentEpoch + 1n);
            assert.equal(await stakingContract.read.earlyEpochEndTriggerTime(), 0n);
            assert.equal(await stakingContract.read.earlyEpochEndTime(), 0n);
            assert.equal(await keyGenHistoryContract.read.currentKeyGenRound(), 1n);
        });

        it("should handle failed key generation during upscaling", async function () {
            const {
                validatorSetContract,
                blockRewardContract,
                stakingContract,
                connectivityTracker,
                keyGenHistoryContract,
            } = await helpers.loadFixture(deployContractsFixture);

            // Configure staking epoch
            const validatorSetCaller = await impersonateAcc(validatorSetContract.address);
            await stakingContract.write.incrementStakingEpoch({ account: validatorSetCaller });

            let latestBlock = await publicClient.getBlock();
            await stakingContract.write.setStakingEpochStartTime([latestBlock.timestamp], {
                account: validatorSetCaller,
            });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            // There are 3 initial validators, adding 3 more to trigger upscaling
            for (const validator of pendingValidators) {
                await stakingContract.write.addPool(
                    [validator.miningAddress(), zeroAddress, 0n, validator.publicKey(), validator.ipAddress],
                    { account: validator.staking, value: candidateMinStake },
                );

                await announceAvailability(validator, validatorSetContract);
            }

            assert.equal(
                await stakingContract.read.earlyEpochEndTriggerTime(),
                0n,
                "early epoch end trigger time should not be set",
            );
            assert.equal(await stakingContract.read.earlyEpochEndTime(), 0n, "early epoch end time should not be set");

            const currentEpoch = await stakingContract.read.stakingEpoch();
            assert.equal(await connectivityTracker.read.isEarlyEpochEnd([currentEpoch]), false);
            assert.equal(await blockRewardContract.read.earlyEpochEnd(), false);
            assert.equal((await validatorSetContract.read.getPendingValidators()).length, 0);

            const poolsToBeElected = await stakingContract.read.getPoolsToBeElected();
            const currentValidatorsCount = await validatorSetContract.read.getCurrentValidatorsCount();
            assert.equal(poolsToBeElected.length, pendingValidators.length + initialValidators.length);

            assert.ok(
                (await validatorSetContract.read.getValidatorCountSweetSpot([BigInt(poolsToBeElected.length)])) >
                currentValidatorsCount,
                "precondition not met: must trigger upscaling",
            );

            // Emulate block generation
            await callReward(blockRewardContract, false);

            // BlockReward contract should write EarlyEpochEnd trigger time, and initiate key generation
            latestBlock = await publicClient.getBlock();
            assert.notEqual((await validatorSetContract.read.getPendingValidators()).length, 0);
            assert.equal(await blockRewardContract.read.earlyEpochEnd(), false);
            assert.equal(await stakingContract.read.earlyEpochEndTriggerTime(), latestBlock.timestamp);

            let expectedEarlyEpochEndTime =
                latestBlock.timestamp +
                stakingTransitionWindowLength +
                (await stakingContract.read.currentKeyGenExtraTimeWindow());

            assert.equal(await stakingContract.read.earlyEpochEndTime(), expectedEarlyEpochEndTime);

            const expectedPendingValidators = await validatorSetContract.read.getValidatorCountSweetSpot([
                BigInt(poolsToBeElected.length),
            ]);
            const currentPendingValidators = await validatorSetContract.read.getPendingValidators();
            assert.equal(BigInt(currentPendingValidators.length), expectedPendingValidators);

            const missedValidators = currentPendingValidators.slice(0, 2);
            const validatorsToWriteParts = currentPendingValidators.slice(2);

            // Emulate failed key generation, 3 of pending validators did not write his part
            for (const validator of [...initialValidators, ...pendingValidators]) {
                if (!validatorsToWriteParts.includes(validator.miningAddress())) {
                    continue;
                }

                await writePart(currentEpoch, validator, keyGenHistoryContract);
            }

            const keyGenRoundPreviousValue = await keyGenHistoryContract.read.getCurrentKeyGenRound();

            const earlyEpochEndTime = await stakingContract.read.earlyEpochEndTime();
            await helpers.time.increaseTo(earlyEpochEndTime + 1n);
            await callReward(blockRewardContract, false);

            expectedEarlyEpochEndTime += stakingTransitionWindowLength;
            assert.equal(await keyGenHistoryContract.read.getCurrentKeyGenRound(), keyGenRoundPreviousValue + 1n);
            assert.equal(
                await stakingContract.read.earlyEpochEndTime(),
                expectedEarlyEpochEndTime,
                "keygen extra time windown should have increased",
            );

            // Emulate block generation
            await callReward(blockRewardContract, true);

            const newValidators = await validatorSetContract.read.getValidators();

            for (const validator of validatorsToWriteParts) {
                assert.ok(newValidators.includes(validator));
            }

            for (const validator of missedValidators) {
                assert.ok(!newValidators.includes(validator));
            }

            assert.equal(await stakingContract.read.stakingEpoch(), currentEpoch + 1n);
            assert.equal(await stakingContract.read.earlyEpochEndTriggerTime(), 0n);
            assert.equal(await stakingContract.read.earlyEpochEndTime(), 0n);
            assert.equal(await keyGenHistoryContract.read.currentKeyGenRound(), 1n);
        });
    });
});
