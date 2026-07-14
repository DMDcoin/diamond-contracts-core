import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import { type Account, type Address, getAddress, parseEther, parseEventLogs, parseUnits, zeroAddress } from "viem";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { GovernanceAddress } from "./fixtures/dao.js";
import { createDeploymentFixture, DeploymentFixture, type DeployedContracts } from "./fixtures/deployment.js";
import { Validator } from "./fixtures/types.js";
import { deployProxy } from "./fixtures/proxy.js";

const { viem: hhViem, networkHelpers: helpers } = await hre.network.getOrCreate();

const publicClient = await hhViem.getPublicClient();
type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

type BlockRewardContract = DeployedContracts["blockReward"];
type StakingContract = DeployedContracts["staking"];
type ValidatorSetContract = DeployedContracts["validatorSet"];

const SystemAccountAddress = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE" as Address;
const addToDeltaPotValue = parseEther("60");

describe("BlockRewardHbbft", function () {
    const additionalValidatorsCount = 25;

    let owner: TestWalletClient;
    let accounts: TestWalletClient[];
    let additionalValidators: Validator[];

    let stubAddress: Address;

    let deployContractsFixture: DeploymentFixture;

    before(async function () {
        [owner, ...accounts] = await hhViem.getWalletClients();

        stubAddress = privateKeyToAccount(generatePrivateKey()).address;

        additionalValidators = new Array<Validator>();
        for (let i = 0; i < additionalValidatorsCount; ++i) {
            const validator = await Validator.create();
            additionalValidators.push(validator);
        }

        deployContractsFixture = createDeploymentFixture(owner.account);
    });

    async function impersonateAcc(address: Address): Promise<Address> {
        await helpers.impersonateAccount(address);
        await helpers.setBalance(address, parseEther("10"));

        return address;
    }

    async function callReward(blockReward: BlockRewardContract, isEpochEndBlock: boolean): Promise<void> {
        const systemAccount = await impersonateAcc(SystemAccountAddress);

        await blockReward.write.reward([isEpochEndBlock], { account: systemAccount });

        await helpers.stopImpersonatingAccount(SystemAccountAddress);
    }

    async function getCurrentGovernancePotValue(blockReward: BlockRewardContract): Promise<bigint> {
        const governancePotAddress = await blockReward.read.governancePotAddress();
        assert.notEqual(governancePotAddress, zeroAddress);

        return publicClient.getBalance({ address: governancePotAddress });
    }

    // time travels forward to the beginning of the next transition,
    // and simulate a block mining (calling reward())
    async function timeTravelToTransition(staking: StakingContract, blockReward: BlockRewardContract): Promise<void> {
        const startTimeOfNextPhaseTransition = await staking.read.startTimeOfNextPhaseTransition();

        await helpers.time.increaseTo(startTimeOfNextPhaseTransition);
        await callReward(blockReward, false);
    }

    async function timeTravelToEndEpoch(staking: StakingContract, blockReward: BlockRewardContract): Promise<void> {
        const endTimeOfCurrentEpoch = await staking.read.stakingFixedEpochEndTime();

        await helpers.time.increaseTo(endTimeOfCurrentEpoch);
        await callReward(blockReward, true);
    }

    async function finishEpochPrelim(
        staking: StakingContract,
        blockReward: BlockRewardContract,
        percentage: bigint,
    ): Promise<void> {
        const stakingFixedEpochEndTime = await staking.read.stakingFixedEpochEndTime();
        const stakingEpochStartTime = await staking.read.stakingEpochStartTime();

        const epochDuration = ((stakingFixedEpochEndTime - stakingEpochStartTime) * percentage) / 100n + 1n;
        const endTimeOfCurrentEpoch = stakingEpochStartTime + epochDuration;

        await helpers.time.increaseTo(endTimeOfCurrentEpoch);
        await callReward(blockReward, true);
    }

    async function announceAvailability(validatorSet: ValidatorSetContract, account: Account | Address): Promise<void> {
        const block = await publicClient.getBlock();

        await validatorSet.write.announceAvailability([block.number, block.hash], { account });
    }

    async function getValidatorStake(
        { validatorSet, staking }: DeployedContracts,
        validatorAddr: Address,
    ): Promise<bigint> {
        const stakingAddr = await validatorSet.read.stakingByMiningAddress([validatorAddr]);
        return staking.read.stakeAmount([stakingAddr, stakingAddr]);
    }

    async function mine(contracts: DeployedContracts): Promise<void> {
        const { blockReward, validatorSet, staking } = contracts;

        const expectedEpochDuration =
            (await staking.read.stakingFixedEpochEndTime()) - (await staking.read.stakingEpochStartTime());
        const blocktime = (expectedEpochDuration * 5n) / 100n + 1n; //5% of the epoch

        await helpers.time.increase(blocktime);

        if ((await validatorSet.read.getPendingValidators()).length > 0) {
            const currentValidators = await validatorSet.read.getValidators();
            const maxValidators = await validatorSet.read.maxValidators();

            const initialGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);
            const deltaPotValue = await blockReward.read.deltaPot();
            const reinsertPotValue = await blockReward.read.reinsertPot();
            const epochPercentage = await blockReward.read.epochPercentage();

            const lastValidator = currentValidators[currentValidators.length - 1];
            const stakeBeforeReward = await getValidatorStake(contracts, lastValidator);

            await callReward(blockReward, true);

            const currentGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);
            const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

            const deltaPotShare =
                (deltaPotValue * BigInt(currentValidators.length) * epochPercentage) / 6000n / maxValidators / 100n;
            const reinsertPotShare =
                (reinsertPotValue * BigInt(currentValidators.length) * epochPercentage) / 6000n / maxValidators / 100n;
            const nativeRewardUndistributed = await blockReward.read.nativeRewardUndistributed();

            const totalReward = deltaPotShare + reinsertPotShare + nativeRewardUndistributed;
            const expectedDAOShare = totalReward / 10n;

            // we expect 1 wei difference, since the reward combination from 2 pots results in that.
            //expectedDAOShare.sub(governancePotIncrease).should.to.be.bignumber.lte(BigNumber.from('1'));
            assertCloseTo(governancePotIncrease, expectedDAOShare, expectedDAOShare / 10000n);

            const singleValidatorReward = (totalReward - expectedDAOShare) / BigInt(currentValidators.length);
            const validator = lastValidator;

            const expectedValidatorReward = await getValidatorReward(contracts, singleValidatorReward, validator);
            const stakeAfterReward = await getValidatorStake(contracts, validator);
            const actualValidatorReward = stakeAfterReward - stakeBeforeReward;

            assertCloseTo(actualValidatorReward, expectedValidatorReward, expectedValidatorReward / 10000n);
        } else {
            await callReward(blockReward, false);
        }
    }

    async function getValidatorReward(
        contracts: DeployedContracts,
        totalReward: bigint,
        validator: Address,
    ): Promise<bigint> {
        const validatorMinRewardPercent = await contracts.blockReward.read.VALIDATOR_FIXED_REWARD_PERCENT();
        const validatorFixedReward = (totalReward * validatorMinRewardPercent) / 100n;

        const validatorStake = await getValidatorStake(contracts, validator);
        const stakingAddress = await contracts.validatorSet.read.stakingByMiningAddress([validator]);
        const totalStake = await contracts.staking.read.stakeAmountTotal([stakingAddress]);

        return validatorFixedReward + ((totalReward - validatorFixedReward) * validatorStake) / totalStake;
    }

    function assertCloseTo(actual: bigint, expected: bigint, tolerance: bigint): void {
        assert.ok(
            actual >= expected - tolerance && actual <= expected + tolerance,
            `expected ${actual} to be within ${tolerance} of ${expected}`,
        );
    }

    describe("initialize", async function () {
        it("should fail if owner = address(0)", async function () {
            const implementation = await hhViem.deployContract("BlockRewardHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "BlockRewardHbbft", {
                    initArgs: [zeroAddress, stubAddress, stubAddress],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should fail if ValidatorSet = address(0)", async function () {
            const implementation = await hhViem.deployContract("BlockRewardHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "BlockRewardHbbft", {
                    initArgs: [stubAddress, zeroAddress, stubAddress],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should fail if ConnectivityTracker = address(0)", async function () {
            const implementation = await hhViem.deployContract("BlockRewardHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "BlockRewardHbbft", {
                    initArgs: [stubAddress, stubAddress, zeroAddress],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should fail on double initialization", async function () {
            const blockReward = await deployProxy(hhViem, "BlockRewardHbbft", {
                initArgs: [stubAddress, stubAddress, stubAddress],
                initializer: "initialize",
            });

            await hhViem.assertions.revertWithCustomError(
                blockReward.write.initialize([stubAddress, stubAddress, stubAddress]),
                blockReward,
                "InvalidInitialization",
            );
        });
    });

    describe("setGovernancePotShareNominator", async function () {
        let GovernancePotShareNominatorAllowedParams = new Array(11).fill(null).map((_, i) => i + 10);

        it("should restrict calling to contract owner", async function () {
            const { blockReward } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                blockReward.write.setGovernancePotShareNominator([1n], { account: caller.account }),
                blockReward,
                "OwnableUnauthorizedAccount",
                [caller.account.address],
            );
        });

        it("should not allow values outside allowed range", async function () {
            const { blockReward } = await helpers.loadFixture(deployContractsFixture);

            const paramsCount = GovernancePotShareNominatorAllowedParams.length;

            const lower = BigInt(GovernancePotShareNominatorAllowedParams[0] - 1);
            const higher = BigInt(GovernancePotShareNominatorAllowedParams[paramsCount - 1] + 1);

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                blockReward.write.setGovernancePotShareNominator([lower]),
                blockReward,
                "NewValueOutOfRange",
                [lower],
            );

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                blockReward.write.setGovernancePotShareNominator([higher]),
                blockReward,
                "NewValueOutOfRange",
                [higher],
            );
        });

        it("should allow value increase within allowed range", async function () {
            const { blockReward } = await helpers.loadFixture(deployContractsFixture);

            for (const val of GovernancePotShareNominatorAllowedParams) {
                await blockReward.write.setGovernancePotShareNominator([BigInt(val)]);

                assert.equal(await blockReward.read.governancePotShareNominator(), BigInt(val));
            }
        });

        it("should allow value decrease within allowed range", async function () {
            const { blockReward } = await helpers.loadFixture(deployContractsFixture);

            // value guards only allow single-step changes, so ramp up to the max value first
            for (const val of GovernancePotShareNominatorAllowedParams) {
                await blockReward.write.setGovernancePotShareNominator([BigInt(val)]);
            }

            for (const val of [...GovernancePotShareNominatorAllowedParams].reverse()) {
                await blockReward.write.setGovernancePotShareNominator([BigInt(val)]);
                assert.equal(await blockReward.read.governancePotShareNominator(), BigInt(val));
            }
        });
    });

    describe("reward", async function () {
        it("should restrict calling reward only to system address", async function () {
            const { blockReward } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];

            await hhViem.assertions.revertWithCustomError(
                blockReward.write.reward([false], { account: caller.account }),
                blockReward,
                "Unauthorized",
            );
        });

        it("should revert for zero validators", async function () {
            const { blockReward, validatorSet, staking } = await helpers.loadFixture(deployContractsFixture);

            await validatorSet.write.forceFinalizeNewValidators();

            const validatorSetAccount = await impersonateAcc(validatorSet.address);
            await staking.write.incrementStakingEpoch({ account: validatorSetAccount });
            await helpers.stopImpersonatingAccount(validatorSetAccount);

            assert.deepEqual(await validatorSet.read.getValidators(), []);

            const systemAccount = await impersonateAcc(SystemAccountAddress);
            await hhViem.assertions.revertWithCustomError(
                blockReward.write.reward([true], { account: systemAccount }),
                blockReward,
                "ValidatorsListEmpty",
            );
            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });

        it("should save epochs in which validator was awarded", async function () {
            const { blockReward, staking, validatorSet, initialValidators } =
                await helpers.loadFixture(deployContractsFixture);

            const candidateMinStake = await staking.read.candidateMinStake();

            for (const validator of initialValidators) {
                const pool = validator.stakingAddress();

                await staking.write.stake([pool], { account: validator.staking, value: candidateMinStake });

                const latestBlock = await publicClient.getBlock();
                await validatorSet.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                    account: validator.mining,
                });

                assert.equal(await staking.read.stakeAmountTotal([pool]), candidateMinStake);
            }

            for (const _validator of initialValidators) {
                assert.deepEqual(await blockReward.read.epochsPoolGotRewardFor([_validator.miningAddress()]), []);
            }

            await callReward(blockReward, true);

            const deltaPotValue = parseEther("10");
            await blockReward.write.addToDeltaPot({ value: deltaPotValue });
            assert.equal(await blockReward.read.deltaPot(), deltaPotValue);

            const expectedEpochsCount = 10;
            let passedEpochs = new Array<bigint>();

            for (let i = 0; i < expectedEpochsCount; ++i) {
                const fixedEpochEndTime = await staking.read.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const epochNumber = await staking.read.stakingEpoch();

                passedEpochs.push(epochNumber);
                await callReward(blockReward, true);
            }

            assert.equal(passedEpochs.length, expectedEpochsCount);

            for (const _validator of initialValidators) {
                const poolRewardedEpochs = await blockReward.read.epochsPoolGotRewardFor([_validator.miningAddress()]);

                assert.equal(poolRewardedEpochs.length, expectedEpochsCount);
                assert.deepEqual(poolRewardedEpochs, passedEpochs);
            }
        });

        it("should not reward validators who announced availability in the current epoch", async function () {
            const { blockReward, staking, validatorSet, connectivityTracker, initialValidators } =
                await helpers.loadFixture(deployContractsFixture);

            const candidateMinStake = await staking.read.candidateMinStake();

            for (const validator of initialValidators) {
                const pool = validator.stakingAddress();

                await staking.write.stake([pool], { account: validator.staking, value: candidateMinStake });

                const latestBlock = await publicClient.getBlock();
                await validatorSet.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                    account: validator.mining,
                });

                assert.equal(await staking.read.stakeAmountTotal([pool]), candidateMinStake);
            }

            await callReward(blockReward, true);

            const deltaPotValue = parseEther("10");
            await blockReward.write.addToDeltaPot({ value: deltaPotValue });
            assert.equal(await blockReward.read.deltaPot(), deltaPotValue);

            const validator = initialValidators[0];
            const connectivityTrackerCaller = await impersonateAcc(connectivityTracker.address);

            await owner.sendTransaction({
                value: parseEther("1"),
                to: connectivityTrackerCaller,
            });

            await validatorSet.write.notifyUnavailability([validator.miningAddress()], {
                account: connectivityTrackerCaller,
            });
            assert.equal(await validatorSet.read.validatorAvailableSince([validator.miningAddress()]), 0n);
            await helpers.mine(5);

            const announceBlock = await publicClient.getBlock();
            await validatorSet.write.announceAvailability([announceBlock.number, announceBlock.hash], {
                account: validator.mining,
            });

            const availabilityTimestamp = await helpers.time.latest();
            assert.equal(
                await validatorSet.read.validatorAvailableSince([validator.miningAddress()]),
                BigInt(availabilityTimestamp),
            );

            const epochNumber = await staking.read.stakingEpoch();

            const fixedEpochEndTime = await staking.read.stakingFixedEpochEndTime();
            await helpers.time.increaseTo(fixedEpochEndTime + 1n);
            await helpers.mine(1);

            await callReward(blockReward, true);

            for (const _validator of initialValidators) {
                if (_validator === validator) {
                    assert.deepEqual(await blockReward.read.epochsPoolGotRewardFor([_validator.miningAddress()]), []);
                } else {
                    assert.deepEqual(await blockReward.read.epochsPoolGotRewardFor([_validator.miningAddress()]), [
                        epochNumber,
                    ]);
                }
            }

            await helpers.stopImpersonatingAccount(connectivityTrackerCaller);
        });

        it("should not distribute rewards if there is no rewarded validators", async function () {
            const { blockReward, staking, validatorSet, connectivityTracker, initialValidators } =
                await helpers.loadFixture(deployContractsFixture);

            const candidateMinStake = await staking.read.candidateMinStake();

            for (const validator of initialValidators) {
                const pool = validator.stakingAddress();

                await staking.write.stake([pool], { account: validator.staking, value: candidateMinStake });

                const latestBlock = await publicClient.getBlock();
                await validatorSet.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                    account: validator.mining,
                });

                assert.equal(await staking.read.stakeAmountTotal([pool]), candidateMinStake);
            }

            await callReward(blockReward, true);

            const deltaPotValue = parseEther("10");
            await blockReward.write.addToDeltaPot({ value: deltaPotValue });
            assert.equal(await blockReward.read.deltaPot(), deltaPotValue);

            const connectivityTrackerCaller = await impersonateAcc(connectivityTracker.address);

            await owner.sendTransaction({
                value: parseEther("10"),
                to: connectivityTrackerCaller,
            });

            const currentValidators = await validatorSet.read.getValidators();

            for (const validatorAddress of currentValidators) {
                await validatorSet.write.notifyUnavailability([validatorAddress], {
                    account: connectivityTrackerCaller,
                });
                assert.equal(await validatorSet.read.validatorAvailableSince([validatorAddress]), 0n);
            }

            await helpers.mine(5);

            const fixedEpochEndTime = await staking.read.stakingFixedEpochEndTime();
            await helpers.time.increaseTo(fixedEpochEndTime + 1n);
            await helpers.mine(1);

            const systemAccount = await impersonateAcc(SystemAccountAddress);

            await hhViem.assertions.emitWithArgs(
                blockReward.write.reward([true], { account: systemAccount }),
                blockReward,
                "CoinsRewarded",
                [0n],
            );

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
            await helpers.stopImpersonatingAccount(connectivityTrackerCaller);

            for (const validatorAddress of currentValidators) {
                assert.deepEqual(await blockReward.read.epochsPoolGotRewardFor([validatorAddress]), []);
            }
        });

        it("should not distribute rewards if pool reward = 0", async function () {
            const { blockReward, staking, validatorSet, initialValidators } =
                await helpers.loadFixture(deployContractsFixture);

            const candidateMinStake = await staking.read.candidateMinStake();

            for (const validator of initialValidators) {
                const pool = validator.stakingAddress();

                await staking.write.stake([pool], { account: validator.staking, value: candidateMinStake });

                const latestBlock = await publicClient.getBlock();
                await validatorSet.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                    account: validator.mining,
                });

                assert.equal(await staking.read.stakeAmountTotal([pool]), candidateMinStake);
            }

            await callReward(blockReward, true);

            // Following pot values and default payout fractions will result in 0 pool reward value
            const potValue = 90000n;
            await blockReward.write.addToDeltaPot({ value: potValue });
            await blockReward.write.sendCoins({ value: potValue });

            assert.equal(await blockReward.read.deltaPot(), potValue);
            assert.equal(await blockReward.read.reinsertPot(), potValue);

            await helpers.mine(5);

            const fixedEpochEndTime = await staking.read.stakingFixedEpochEndTime();
            await helpers.time.increaseTo(fixedEpochEndTime + 1n);
            await helpers.mine(1);

            const validators = await validatorSet.read.getValidators();
            const potsShares = await blockReward.read.getPotsShares([BigInt(validators.length)]);

            const expectedUndistributedNativeRewards = potsShares.totalRewards - potsShares.governancePotAmount;

            const systemAccount = await impersonateAcc(SystemAccountAddress);

            await hhViem.assertions.emitWithArgs(
                blockReward.write.reward([true], { account: systemAccount }),
                blockReward,
                "CoinsRewarded",
                [potsShares.governancePotAmount],
            );

            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            assert.equal(await blockReward.read.nativeRewardUndistributed(), expectedUndistributedNativeRewards);

            const currentValidators = await validatorSet.read.getValidators();
            for (const validatorAddress of currentValidators) {
                assert.deepEqual(await blockReward.read.epochsPoolGotRewardFor([validatorAddress]), []);
            }
        });

        it("should not reward validators with stake amount = 0 and save undistributed amount", async function () {
            const { blockReward, staking, validatorSet } = await helpers.loadFixture(deployContractsFixture);

            await callReward(blockReward, true);

            // Following pot values and default payout fractions will result in 0 pool reward value
            const potValue = parseEther("1");
            await blockReward.write.addToDeltaPot({ value: potValue });
            await blockReward.write.sendCoins({ value: potValue });

            assert.equal(await blockReward.read.deltaPot(), potValue);
            assert.equal(await blockReward.read.reinsertPot(), potValue);

            await helpers.mine(5);

            const fixedEpochEndTime = await staking.read.stakingFixedEpochEndTime();
            await helpers.time.increaseTo(fixedEpochEndTime + 1n);
            await helpers.mine(1);

            const validators = await validatorSet.read.getValidators();
            const potsShares = await blockReward.read.getPotsShares([BigInt(validators.length)]);

            const expectedUndistributedNativeRewards = potsShares.totalRewards - potsShares.governancePotAmount;

            const systemAccount = await impersonateAcc(SystemAccountAddress);

            await hhViem.assertions.emitWithArgs(
                blockReward.write.reward([true], { account: systemAccount }),
                blockReward,
                "CoinsRewarded",
                [0n],
            );

            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            assert.equal(await blockReward.read.nativeRewardUndistributed(), expectedUndistributedNativeRewards);

            const currentValidators = await validatorSet.read.getValidators();
            for (const validatorAddress of currentValidators) {
                assert.deepEqual(await blockReward.read.epochsPoolGotRewardFor([validatorAddress]), []);
            }
        });
    });

    describe("notifyEarlyEpochEnd", async function () {
        it("should restrict calling notifyEarlyEpochEnd to connectivity tracker contract only", async function () {
            const { blockReward } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[11];

            await hhViem.assertions.revertWithCustomError(
                blockReward.write.notifyEarlyEpochEnd({ account: caller.account }),
                blockReward,
                "Unauthorized",
            );
        });

        it("should emit event on early epoch end notification receive", async function () {
            const { blockReward, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

            const connTracker = await impersonateAcc(connectivityTracker.address);

            assert.equal(await blockReward.read.earlyEpochEnd(), false);

            await hhViem.assertions.emit(
                blockReward.write.notifyEarlyEpochEnd({ account: connTracker }),
                blockReward,
                "EarlyEpochEndNotificationReceived",
            );

            assert.equal(await blockReward.read.earlyEpochEnd(), true);

            await helpers.stopImpersonatingAccount(connTracker);
        });

        it("should end epoch earlier if notified", async function () {
            const { blockReward } = await helpers.loadFixture(deployContractsFixture);

            const connTracker = await impersonateAcc(await blockReward.read.connectivityTracker());

            assert.equal(await blockReward.read.earlyEpochEnd(), false);
            await blockReward.write.notifyEarlyEpochEnd({ account: connTracker });
            assert.equal(await blockReward.read.earlyEpochEnd(), true);

            await helpers.stopImpersonatingAccount(connTracker);

            const systemAccount = await impersonateAcc(SystemAccountAddress);

            await blockReward.write.reward([false], { account: systemAccount });
            assert.equal(await blockReward.read.earlyEpochEnd(), false);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });

        it("should not end epoch earlier if not notified", async function () {
            const { blockReward } = await helpers.loadFixture(deployContractsFixture);

            assert.equal(await blockReward.read.earlyEpochEnd(), false);

            const systemAccount = await impersonateAcc(SystemAccountAddress);

            const hash = await blockReward.write.reward([false], { account: systemAccount });
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            const rewardEvents = parseEventLogs({
                abi: blockReward.abi,
                logs: receipt.logs,
                eventName: "CoinsRewarded",
            });
            assert.equal(rewardEvents.length, 0);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });

        it("should ignore and reset early epoch end flag received during key generation phase", async function () {
            const { blockReward, staking, validatorSet, connectivityTracker } =
                await helpers.loadFixture(deployContractsFixture);

            assert.equal(await blockReward.read.earlyEpochEnd(), false);

            await timeTravelToTransition(staking, blockReward);

            const pendingValidators = await validatorSet.read.getPendingValidators();
            assert.ok(pendingValidators.length > 0);

            const connTracker = await impersonateAcc(connectivityTracker.address);
            await hhViem.assertions.emit(
                blockReward.write.notifyEarlyEpochEnd({ account: connTracker }),
                blockReward,
                "EarlyEpochEndNotificationReceived",
            );
            await helpers.stopImpersonatingAccount(connTracker);

            assert.equal(await blockReward.read.earlyEpochEnd(), true);

            await callReward(blockReward, false);

            assert.equal(await blockReward.read.earlyEpochEnd(), false);
            assert.deepEqual(await validatorSet.read.getPendingValidators(), pendingValidators);
        });
    });

    it("should get governance address", async function () {
        const { blockReward } = await helpers.loadFixture(deployContractsFixture);

        assert.equal(await blockReward.read.getGovernanceAddress(), GovernanceAddress);
    });

    describe("staking epochs lifecycle", async function () {
        let contracts: DeployedContracts;

        before(async function () {
            contracts = await helpers.loadFixture(deployContractsFixture);
        });

        it("staking epoch #0 finished", async function () {
            const { blockReward, validatorSet, staking } = contracts;

            assert.equal(await staking.read.stakingEpoch(), 0n);

            await callReward(blockReward, false);

            assert.deepEqual(await validatorSet.read.getPendingValidators(), []);

            await timeTravelToTransition(staking, blockReward);
            await timeTravelToEndEpoch(staking, blockReward);

            assert.equal(await staking.read.stakingEpoch(), 1n);

            assert.deepEqual(await validatorSet.read.getPendingValidators(), []);
            assert.equal(await blockReward.read.nativeRewardUndistributed(), 0n);
        });

        it("staking epoch #1 started", async function () {
            const { validatorSet, staking } = contracts;

            assert.equal(await staking.read.stakingEpoch(), 1n);
            assert.equal((await validatorSet.read.getValidators()).length, 3);

            assert.deepEqual(await validatorSet.read.getPendingValidators(), []);
            assert.deepEqual(await staking.read.getPoolsToBeElected(), []);
        });

        it("validators and their delegators place stakes during the epoch #1", async function () {
            const { validatorSet, staking, initialValidators } = contracts;

            const candidateMinStake = await staking.read.candidateMinStake();
            const delegatorMinStake = await staking.read.delegatorMinStake();

            for (let i = 0; i < initialValidators.length; i++) {
                const validator = initialValidators[i];
                const stakingAddress = validator.stakingAddress();

                await staking.write.stake([stakingAddress], { account: validator.staking, value: candidateMinStake });

                const delegatorsLength = 3;
                const delegators = accounts.slice(
                    11 + i * delegatorsLength,
                    11 + i * delegatorsLength + delegatorsLength,
                );
                for (let j = 0; j < delegators.length; j++) {
                    await staking.write.stake([stakingAddress], {
                        account: delegators[j].account,
                        value: delegatorMinStake,
                    });
                }

                const latestBlock = await publicClient.getBlock();
                await validatorSet.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                    account: validator.mining,
                });
            }
        });

        it("staking epoch #1 finished", async function () {
            const { blockReward, validatorSet, staking, initialValidators } = contracts;

            const candidateMinStake = await staking.read.candidateMinStake();
            const delegatorMinStake = await staking.read.delegatorMinStake();

            assert.equal(await staking.read.stakingEpoch(), 1n);

            assert.deepEqual(await validatorSet.read.getPendingValidators(), []);

            assert.equal((await staking.read.getPoolsToBeElected()).length, 3);

            await timeTravelToTransition(staking, blockReward);

            const pendingValidators = await validatorSet.read.getPendingValidators();

            assert.deepEqual(
                pendingValidators,
                initialValidators.map((validator) => getAddress(validator.miningAddress())),
            );

            assert.equal(await staking.read.stakingEpoch(), 1n);
            assert.equal(await blockReward.read.nativeRewardUndistributed(), 0n);

            await timeTravelToEndEpoch(staking, blockReward);

            const nextStakingEpoch = await staking.read.stakingEpoch();
            assert.equal(nextStakingEpoch, 2n);

            assert.deepEqual(await validatorSet.read.getPendingValidators(), []);

            const validators = await validatorSet.read.getValidators();
            assert.deepEqual(
                validators,
                initialValidators.map((validator) => getAddress(validator.miningAddress())),
            );

            for (let i = 0; i < validators.length; i++) {
                const stakingAddress = await validatorSet.read.stakingByMiningAddress([validators[i]]);

                assert.equal(
                    await staking.read.snapshotPoolValidatorStakeAmount([nextStakingEpoch, stakingAddress]),
                    candidateMinStake,
                );

                assert.equal(
                    await staking.read.snapshotPoolTotalStakeAmount([nextStakingEpoch, stakingAddress]),
                    candidateMinStake + delegatorMinStake * 3n,
                );
            }
        });

        it("DMD Pots: filling delta pot", async function () {
            const { blockReward, staking } = contracts;

            assert.equal(await staking.read.stakingEpoch(), 2n);

            assert.equal(await publicClient.getBalance({ address: blockReward.address }), 0n);

            assert.equal(await blockReward.read.deltaPot(), 0n);
            assert.equal(await blockReward.read.reinsertPot(), 0n);

            await blockReward.write.addToDeltaPot({ value: addToDeltaPotValue });

            assert.equal(await blockReward.read.deltaPot(), addToDeltaPotValue);
        });

        it("DMD Pots: governance pot got correct share.", async function () {
            const { blockReward, validatorSet, staking } = contracts;

            const maxValidators = await validatorSet.read.maxValidators();
            const currentValidators = await validatorSet.read.getValidators();

            assert.equal(currentValidators.length, 3);

            const initialGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);

            await timeTravelToTransition(staking, blockReward);
            await timeTravelToEndEpoch(staking, blockReward);

            const currentGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);
            const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

            const totalReward = ((addToDeltaPotValue / 6000n) * BigInt(currentValidators.length)) / maxValidators;
            const expectedDAOShare = totalReward / 10n;

            assert.equal(governancePotIncrease, expectedDAOShare);
        });

        it("DMD Pots: reinsert pot works as expected.", async function () {
            const { blockReward, validatorSet, staking } = contracts;

            const maxValidators = await validatorSet.read.maxValidators();
            const currentValidators = await validatorSet.read.getValidators();

            const deltaPotCurrentValue = await blockReward.read.deltaPot();
            const fillUpMissing = addToDeltaPotValue - deltaPotCurrentValue;

            await blockReward.write.addToDeltaPot({ value: fillUpMissing });
            assert.equal(await blockReward.read.deltaPot(), addToDeltaPotValue);

            const addedToReinsertPot = parseEther("60");

            await blockReward.write.sendCoins({ value: addedToReinsertPot });
            assert.equal(await blockReward.read.reinsertPot(), addedToReinsertPot);

            const initialGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);

            await timeTravelToTransition(staking, blockReward);
            await timeTravelToEndEpoch(staking, blockReward);

            const currentGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);
            const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

            const totalReward =
                (((addToDeltaPotValue + addedToReinsertPot) / 6000n) * BigInt(currentValidators.length)) /
                maxValidators;

            const expectedDAOShare = totalReward / 10n;

            assert.equal(governancePotIncrease, expectedDAOShare);
        });

        it("transfers to reward contract works with 100k gas and fills reinsert pot", async function () {
            const { blockReward } = contracts;

            const fillUpValue = parseEther("1");

            const balanceBefore = await publicClient.getBalance({ address: blockReward.address });
            const reinsertPotBefore = await blockReward.read.reinsertPot();

            let fillUpTx = {
                to: blockReward.address,
                value: fillUpValue,
                gas: 100000n,
                gasPrice: parseUnits("100", 9), //in some configurations the default gasPrice is used here, it uses 0 instead..
            };

            await accounts[0].sendTransaction(fillUpTx);

            const balanceAfter = await publicClient.getBalance({ address: blockReward.address });
            const reinsertPotAfter = await blockReward.read.reinsertPot();

            assert.equal(balanceAfter, balanceBefore + fillUpValue);
            assert.equal(reinsertPotAfter, reinsertPotBefore + fillUpValue);
        });

        it("reduces the reward if the epoch was shorter than expected", async function () {
            const { blockReward, validatorSet, staking } = contracts;

            const currentValidators = await validatorSet.read.getValidators();
            const maxValidators = await validatorSet.read.maxValidators();

            const deltaPotPayoutFraction = await blockReward.read.deltaPotPayoutFraction();
            const reinsertPotPayoutFraction = await blockReward.read.reinsertPotPayoutFraction();
            const governancePotShareNominator = await blockReward.read.governancePotShareNominator();
            const governancePotShareDenominator = await blockReward.read.governancePotShareDenominator();

            const stakeBeforeReward = await getValidatorStake(contracts, currentValidators[1]);

            const deltaPotValue = await blockReward.read.deltaPot();
            const reinsertPotValue = await blockReward.read.reinsertPot();
            const nativeRewardUndistributed = await blockReward.read.nativeRewardUndistributed();

            const initialGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);
            let _epochPercentage = 30n;
            await finishEpochPrelim(staking, blockReward, _epochPercentage);

            const currentGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);
            const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

            const deltaPotShare =
                (deltaPotValue * BigInt(currentValidators.length) * _epochPercentage) /
                deltaPotPayoutFraction /
                maxValidators /
                100n;

            const reinsertPotShare =
                (reinsertPotValue * BigInt(currentValidators.length) * _epochPercentage) /
                reinsertPotPayoutFraction /
                maxValidators /
                100n;

            const totalReward = deltaPotShare + reinsertPotShare + nativeRewardUndistributed;
            const expectedDAOShare = (totalReward * governancePotShareNominator) / governancePotShareDenominator;

            assertCloseTo(governancePotIncrease, expectedDAOShare, expectedDAOShare / 100000n);

            const singleValidatorRewards = (totalReward - expectedDAOShare) / BigInt(currentValidators.length);
            const expectedValidatorReward = await getValidatorReward(
                contracts,
                singleValidatorRewards,
                currentValidators[1],
            );

            const stakeAfterReward = await getValidatorStake(contracts, currentValidators[1]);
            const actualValidatorReward = stakeAfterReward - stakeBeforeReward;

            assertCloseTo(actualValidatorReward, expectedValidatorReward, expectedValidatorReward / 100000n);
        });

        it("gives full reward if the epoch was longer than expected", async function () {
            const { blockReward, validatorSet, staking } = contracts;

            const currentValidators = await validatorSet.read.getValidators();
            const maxValidators = await validatorSet.read.maxValidators();

            const deltaPotPayoutFraction = await blockReward.read.deltaPotPayoutFraction();
            const reinsertPotPayoutFraction = await blockReward.read.reinsertPotPayoutFraction();
            const governancePotShareNominator = await blockReward.read.governancePotShareNominator();
            const governancePotShareDenominator = await blockReward.read.governancePotShareDenominator();

            const stakeBeforeReward = await getValidatorStake(contracts, currentValidators[1]);

            const deltaPotValue = await blockReward.read.deltaPot();
            const reinsertPotValue = await blockReward.read.reinsertPot();
            const nativeRewardUndistributed = await blockReward.read.nativeRewardUndistributed();

            const initialGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);
            const _epochPercentage = 120n;
            await finishEpochPrelim(staking, blockReward, _epochPercentage);

            const currentGovernancePotBalance = await getCurrentGovernancePotValue(blockReward);
            const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

            const deltaPotShare =
                (deltaPotValue * BigInt(currentValidators.length)) / deltaPotPayoutFraction / maxValidators;

            const reinsertPotShare =
                (reinsertPotValue * BigInt(currentValidators.length)) / reinsertPotPayoutFraction / maxValidators;

            const totalReward = deltaPotShare + reinsertPotShare + nativeRewardUndistributed;
            const expectedDAOShare = (totalReward * governancePotShareNominator) / governancePotShareDenominator;

            assertCloseTo(governancePotIncrease, expectedDAOShare, expectedDAOShare / 10000n);

            const singleValidatorRewards = (totalReward - expectedDAOShare) / BigInt(currentValidators.length);
            const expectedValidatorReward = await getValidatorReward(
                contracts,
                singleValidatorRewards,
                currentValidators[1],
            );

            const stakeAfterReward = await getValidatorStake(contracts, currentValidators[1]);
            const actualValidatorReward = stakeAfterReward - stakeBeforeReward;

            assertCloseTo(actualValidatorReward, expectedValidatorReward, expectedValidatorReward / 10000n);
        });

        it("upscaling: add multiple validator pools and upscale if needed", async function () {
            const { blockReward, validatorSet, staking, params } = contracts;

            for (const validator of additionalValidators) {
                const uncompressedPublicKey = validator.publicKey();
                await staking.write.addPool(
                    [
                        validator.miningAddress() as Address,
                        zeroAddress,
                        0n,
                        `0x${uncompressedPublicKey.slice(4)}`,
                        validator.ipAddress as `0x${string}`,
                    ],
                    { account: validator.staking, value: params.candidateMinStake },
                );
                await announceAvailability(validatorSet, validator.mining);
                await mine(contracts);

                const toBeElected = (await staking.read.getPoolsToBeElected()).length;
                const pendingValidators = (await validatorSet.read.getPendingValidators()).length;

                if (toBeElected > 4 && toBeElected <= 19 && pendingValidators == 0) {
                    assert.equal(
                        await validatorSet.read.getValidatorCountSweetSpot([
                            BigInt((await staking.read.getPoolsToBeElected()).length),
                        ]),
                        BigInt((await validatorSet.read.getValidators()).length),
                    );
                }
            }

            await timeTravelToTransition(staking, blockReward);
            await timeTravelToEndEpoch(staking, blockReward);

            const maxValidators = await validatorSet.read.maxValidators();

            assert.equal(BigInt((await validatorSet.read.getValidators()).length), maxValidators);
            assert.equal(
                (await staking.read.getPoolsToBeElected()).length,
                contracts.initialValidators.length + additionalValidatorsCount,
            );
        });

        it("upscaling: removing validators up to 16", async function () {
            const { validatorSet } = contracts;

            while ((await validatorSet.read.getValidators()).length > 16) {
                await mine(contracts);
                const validators = await validatorSet.read.getValidators();

                const systemAccount = await impersonateAcc(SystemAccountAddress);
                await validatorSet.write.kickValidator([validators[13]], { account: systemAccount });
                await helpers.stopImpersonatingAccount(systemAccount);
            }

            assert.equal((await validatorSet.read.getValidators()).length, 16);
        });

        it("upscaling: mining twice shouldn't change pending validator set", async function () {
            const { blockReward, validatorSet } = contracts;

            await callReward(blockReward, false);

            const pendingValidators = await validatorSet.read.getPendingValidators();
            assert.equal(pendingValidators.length, 25);

            await callReward(blockReward, false);

            assert.deepEqual(await validatorSet.read.getPendingValidators(), pendingValidators);
        });

        it("upscaling: set is scaled to 25", async function () {
            const { validatorSet } = contracts;

            await mine(contracts);

            assert.equal((await validatorSet.read.getValidators()).length, 25);
            assert.deepEqual(await validatorSet.read.getPendingValidators(), []);
        });
    });
});
