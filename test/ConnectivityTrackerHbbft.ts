import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import {
    Hex,
    keccak256,
    parseEther,
    parseEventLogs,
    stringToBytes,
    zeroAddress,
    type Address,
} from "viem";

import { getNValidatorsPartNAcks } from "./fixtures/data.js";
import { createNetworkFixtures } from "./fixtures/network.js";
import { splitPublicKeys } from "./fixtures/utils.js";
import { deployProxy } from "./fixtures/proxy.js";
import { Validator, ZeroIpAddress } from "./fixtures/validator.js";
import { createRandomWallet } from "./fixtures/wallet.js";

import type { StakingHbbftMock } from "./fixtures/types.js";

const connection = await hre.network.getOrCreate();
const { viem: hhViem, networkHelpers: helpers } = connection;

const { impersonateAcc } = createNetworkFixtures(connection);

const publicClient = await hhViem.getPublicClient();
type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

const MinuteInSeconds = 60n;
const HourInSeconds = MinuteInSeconds * 60n;
const DayInSeconds = HourInSeconds * 24n;

describe("ConnectivityTrackerHbbft", () => {
    const validatorInactivityThreshold = DayInSeconds;
    const reportDisallowPeriod = 15n * MinuteInSeconds;

    let accounts: TestWalletClient[];
    let owner: TestWalletClient;

    let stubAddress: Hex;

    before(async function () {
        [owner, ...accounts] = await hhViem.getWalletClients();

        stubAddress = createRandomWallet().address;
    });

    async function deployContracts() {
        const initialValidators = new Array<Validator>();
        for (let i = 0; i < 25; ++i) {
            const validator = await Validator.create();
            initialValidators.push(validator);
        }

        const initialMiningAddresses = initialValidators.map((validator) => validator.miningAddress());
        const initialStakingAddresses = initialValidators.map((validator) => validator.stakingAddress());

        const initialValidatorsPubKeys = splitPublicKeys(
            initialValidators.map((validator) => validator.publicKey()),
        );

        const initialValidatorsIpAddresses = Array(initialValidators.length).fill(ZeroIpAddress);

        const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

        const bonusScoreContractMock = await hhViem.deployContract("BonusScoreSystemMock");

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: bonusScoreContractMock.address,
            connectivityTrackerContract: stubAddress,
            validatorInactivityThreshold: validatorInactivityThreshold,
        };

        const validatorSetHbbft = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
            initArgs: [
                owner.account.address,
                validatorSetParams,       // _params
                initialMiningAddresses,   // _initialMiningAddresses
                initialStakingAddresses,  // _initialStakingAddresses
            ],
            initializer: "initialize",
        });

        const keyGenHistory = await deployProxy(hhViem, "KeyGenHistory", {
            initArgs: [owner.account.address, validatorSetHbbft.address, initialMiningAddresses, parts, acks],
            initializer: "initialize",
        });

        const stakingParams = {
            _validatorSetContract: validatorSetHbbft.address,
            _bonusScoreContract: bonusScoreContractMock.address,
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: parseEther("1"),
            _candidateMinStake: parseEther("10"),
            _maxStake: parseEther("100"),
            _stakingFixedEpochDuration: 86400n,
            _stakingTransitionTimeframeLength: 3600n,
            _stakingWithdrawDisallowPeriod: 1n,
        };

        const stakingHbbft = await deployProxy(hhViem, "StakingHbbftMock", {
            initArgs: [
                owner.account.address,
                stakingParams,
                initialValidatorsPubKeys,      // _publicKeys
                initialValidatorsIpAddresses,  // _internetAddresses
            ],
            initializer: "initialize",
        });

        const blockRewardHbbft = await deployProxy(hhViem, "BlockRewardHbbftMock", {
            initArgs: [owner.account.address, validatorSetHbbft.address, stubAddress],
            initializer: "initialize",
        });

        const connectivityTracker = await deployProxy(hhViem, "ConnectivityTrackerHbbft", {
            initArgs: [
                owner.account.address,
                validatorSetHbbft.address,
                stakingHbbft.address,
                blockRewardHbbft.address,
                bonusScoreContractMock.address,
                reportDisallowPeriod,
            ],
            initializer: "initialize",
        });

        await blockRewardHbbft.write.setConnectivityTracker([connectivityTracker.address]);
        await validatorSetHbbft.write.setStakingContract([stakingHbbft.address]);
        await validatorSetHbbft.write.setBlockRewardContract([blockRewardHbbft.address]);
        await validatorSetHbbft.write.setKeyGenHistoryContract([keyGenHistory.address]);
        await validatorSetHbbft.write.setConnectivityTracker([connectivityTracker.address]);

        return {
            initialValidators,
            connectivityTracker,
            validatorSetHbbft,
            stakingHbbft,
            blockRewardHbbft,
            bonusScoreContractMock,
        };
    }

    async function setStakingEpochStartTime(caller: Address, stakingHbbft: StakingHbbftMock) {
        const signer = await impersonateAcc(caller);

        const latest = await helpers.time.latest();
        await stakingHbbft.write.setStakingEpochStartTime([BigInt(latest)], { account: signer });

        await helpers.stopImpersonatingAccount(caller);
    }

    async function disallowPeriodPassed() {
        await helpers.time.increase(reportDisallowPeriod + 1n);
    }

    describe("Initializer", async function () {
        it("should revert if owner = address(0)", async function () {
            const implementation = await hhViem.deployContract("ConnectivityTrackerHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ConnectivityTrackerHbbft", {
                    initArgs: [zeroAddress, stubAddress, stubAddress, stubAddress, stubAddress, reportDisallowPeriod],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert if validator set contract = address(0)", async function () {
            const implementation = await hhViem.deployContract("ConnectivityTrackerHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ConnectivityTrackerHbbft", {
                    initArgs: [
                        owner.account.address,
                        zeroAddress,
                        stubAddress,
                        stubAddress,
                        stubAddress,
                        reportDisallowPeriod,
                    ],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert if staking contract = address(0)", async function () {
            const implementation = await hhViem.deployContract("ConnectivityTrackerHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ConnectivityTrackerHbbft", {
                    initArgs: [
                        owner.account.address,
                        stubAddress,
                        zeroAddress,
                        stubAddress,
                        stubAddress,
                        reportDisallowPeriod,
                    ],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert if block reward contract = address(0)", async function () {
            const implementation = await hhViem.deployContract("ConnectivityTrackerHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ConnectivityTrackerHbbft", {
                    initArgs: [
                        owner.account.address,
                        stubAddress,
                        stubAddress,
                        zeroAddress,
                        stubAddress,
                        reportDisallowPeriod,
                    ],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert if block bonus score contract = address(0)", async function () {
            const implementation = await hhViem.deployContract("ConnectivityTrackerHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ConnectivityTrackerHbbft", {
                    initArgs: [
                        owner.account.address,
                        stubAddress,
                        stubAddress,
                        stubAddress,
                        zeroAddress,
                        reportDisallowPeriod,
                    ],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert double initialization", async function () {
            const contract = await deployProxy(hhViem, "ConnectivityTrackerHbbft", {
                initArgs: [
                    owner.account.address,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    reportDisallowPeriod,
                ],
                initializer: "initialize",
            });

            await hhViem.assertions.revertWithCustomError(
                contract.write.initialize([
                    owner.account.address,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    reportDisallowPeriod,
                ]),
                contract,
                "InvalidInitialization",
            );
        });
    });

    describe("setReportDisallowPeriod", async function () {
        it("should revert calling function by unauthorized account", async function () {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const caller = accounts[4];

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                connectivityTracker.write.setReportDisallowPeriod(
                    [HourInSeconds],
                    { account: caller.account },
                ),
                connectivityTracker,
                "OwnableUnauthorizedAccount",
                [caller.account.address],
            );
        });

        it("should set report disallow period and emit event", async function () {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);

            const newValue = reportDisallowPeriod + 3n * 60n;

            await hhViem.assertions.emitWithArgs(
                connectivityTracker.write.setReportDisallowPeriod([newValue], { account: owner.account }),
                connectivityTracker,
                "SetReportDisallowPeriod",
                [newValue],
            );

            assert.equal(await connectivityTracker.read.reportDisallowPeriod(), newValue);
        });
    });

    describe("reportMissingConnectivity", async function () {
        it("should restrict calling function only to validators", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await publicClient.getBlock();
            const caller = accounts[0];

            await hhViem.assertions.revertWithCustomError(
                connectivityTracker.write.reportMissingConnectivity(
                    [initialValidators[0].miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: caller.account },
                ),
                connectivityTracker,
                "OnlyValidator",
            );
        });

        it("should revert calling for future block", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomError(
                connectivityTracker.write.reportMissingConnectivity(
                    [initialValidators[1].miningAddress(), latestBlock.number + 5n, latestBlock.hash],
                    { account: initialValidators[0].mining },
                ),
                connectivityTracker,
                "InvalidBlock",
            );
        });

        it("should revert calling with invalid block hash", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomError(
                connectivityTracker.write.reportMissingConnectivity(
                    [
                        initialValidators[1].miningAddress(),
                        latestBlock.number,
                        keccak256(stringToBytes(latestBlock.hash)),
                    ],
                    { account: initialValidators[0].mining },
                ),
                connectivityTracker,
                "InvalidBlock",
            );
        });

        it("should revert too early report", async function () {
            const {
                initialValidators,
                connectivityTracker,
                validatorSetHbbft,
                stakingHbbft,
            } = await helpers.loadFixture(deployContracts);

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            const latestBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomError(
                connectivityTracker.write.reportMissingConnectivity(
                    [initialValidators[1].miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: initialValidators[0].mining },
                ),
                connectivityTracker,
                "ReportTooEarly",
            );
        });

        it("should revert duplicate report by same validator", async function () {
            const {
                initialValidators,
                connectivityTracker,
                validatorSetHbbft,
                stakingHbbft,
            } = await helpers.loadFixture(deployContracts);

            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            await connectivityTracker.write.reportMissingConnectivity(
                [validator.miningAddress(), latestBlock.number, latestBlock.hash],
                { account: reporter.mining },
            );

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                connectivityTracker.write.reportMissingConnectivity(
                    [validator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: reporter.mining },
                ),
                connectivityTracker,
                "AlreadyReported",
                [reporter.miningAddress(), validator.miningAddress()],
            );
        });

        it("should revert report by flagged validator", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);

            await disallowPeriodPassed();

            const reporter = initialValidators[0];
            const validator = initialValidators[1];
            const latestBlock = await publicClient.getBlock();

            await connectivityTracker.write.reportMissingConnectivity(
                [validator.miningAddress(), latestBlock.number, latestBlock.hash],
                { account: reporter.mining },
            );

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                connectivityTracker.write.reportMissingConnectivity(
                    [reporter.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: validator.mining },
                ),
                connectivityTracker,
                "CannotReportByFlaggedValidator",
                [validator.miningAddress()],
            );
        });

        it("should report missing connectivity and emit event", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);

            await disallowPeriodPassed();

            const reporter = initialValidators[0];
            const validator = initialValidators[1];
            const latestBlock = await publicClient.getBlock();

            await hhViem.assertions.emitWithArgs(
                connectivityTracker.write.reportMissingConnectivity(
                    [validator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: reporter.mining },
                ),
                connectivityTracker,
                "ReportMissingConnectivity",
                [reporter.miningAddress(), validator.miningAddress(), latestBlock.number],
            );
        });

        it("should report missing connectivity and flag validator", async function () {
            const { initialValidators, connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            const currentEpoch = await stakingHbbft.read.stakingEpoch();
            const validator = initialValidators[1].miningAddress();

            const previousScore = await connectivityTracker.read.getValidatorConnectivityScore(
                [currentEpoch, validator],
            );
            assert.ok(!(await connectivityTracker.read.getFlaggedValidators()).includes(validator));

            await connectivityTracker.write.reportMissingConnectivity(
                [validator, latestBlock.number, latestBlock.hash],
                { account: initialValidators[0].mining },
            );

            assert.ok((await connectivityTracker.read.getFlaggedValidators()).includes(validator));
            assert.equal(
                await connectivityTracker.read.getValidatorConnectivityScore([currentEpoch, validator]),
                previousScore + 1n,
            );
        });

        it("should increase validator connectivity score with each report", async function () {
            const { initialValidators, connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            await disallowPeriodPassed();

            const validator = initialValidators[0].miningAddress();

            const epoch = await stakingHbbft.read.stakingEpoch();
            const initialScore = await connectivityTracker.read.getValidatorConnectivityScore([epoch, validator]);
            const latestBlock = await publicClient.getBlock();

            for (let i = 1; i < initialValidators.length; ++i) {
                await connectivityTracker.write.reportMissingConnectivity(
                    [validator, latestBlock.number, latestBlock.hash],
                    { account: initialValidators[i].mining },
                );

                assert.equal(
                    await connectivityTracker.read.getValidatorConnectivityScore([epoch, validator]),
                    initialScore + BigInt(i),
                );
            }

            assert.equal(
                await connectivityTracker.read.getValidatorConnectivityScore([epoch, validator]),
                BigInt(initialValidators.length - 1),
            );
        });

        it("should set faulty validator as unavailable", async function () {
            const {
                initialValidators,
                connectivityTracker,
                stakingHbbft,
                validatorSetHbbft,
            } = await helpers.loadFixture(deployContracts);

            await disallowPeriodPassed();

            const badValidator = initialValidators[0];
            const goodValidators = initialValidators.slice(1);

            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const announceBlock = await publicClient.getBlock();
            await helpers.mine(1);

            await validatorSetHbbft.write.announceAvailability(
                [announceBlock.number, announceBlock.hash],
                { account: badValidator.mining },
            );

            const availableSinceTimestamp = await helpers.time.latest();

            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSince([badValidator.miningAddress()]),
                BigInt(availableSinceTimestamp),
            );
            await helpers.mine(5);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            const latestBlock = await publicClient.getBlock();

            for (let j = 0; j < reportsThreshold; ++j) {
                await connectivityTracker.write.reportMissingConnectivity(
                    [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: goodValidators[j].mining },
                );
            }

            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSince([badValidator.miningAddress()]),
                0n,
            );
        });

        it("should not mark validator faulty if it's already marked", async function () {
            const {
                initialValidators,
                connectivityTracker,
                stakingHbbft,
                validatorSetHbbft,
            } = await helpers.loadFixture(deployContracts);

            await disallowPeriodPassed();

            const badValidator = initialValidators[0];
            const goodValidators = initialValidators.slice(1);

            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const announceBlock = await publicClient.getBlock();
            await helpers.mine(1);

            await validatorSetHbbft.write.announceAvailability(
                [announceBlock.number, announceBlock.hash],
                { account: badValidator.mining },
            );

            const availableSinceTimestamp = await helpers.time.latest();

            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSince([badValidator.miningAddress()]),
                BigInt(availableSinceTimestamp),
            );
            await helpers.mine(5);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            let latestBlock = await publicClient.getBlock();

            for (let i = 0; i < reportsThreshold; ++i) {
                await connectivityTracker.write.reportMissingConnectivity(
                    [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: goodValidators[i].mining },
                );
            }

            const unavailableWriteTimestamp = await helpers.time.latest();

            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSince([badValidator.miningAddress()]),
                0n,
            );
            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSinceLastWrite([badValidator.miningAddress()]),
                BigInt(unavailableWriteTimestamp),
            );

            await helpers.mine(10);

            latestBlock = await publicClient.getBlock();
            const nextReporter = goodValidators[reportsThreshold];

            const txHash = await connectivityTracker.write.reportMissingConnectivity(
                [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                { account: nextReporter.mining },
            );
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

            const unavailableEvents = parseEventLogs({
                abi: validatorSetHbbft.abi,
                eventName: "ValidatorUnavailable",
                logs: receipt.logs,
            });

            assert.equal(unavailableEvents.length, 0);

            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSince([badValidator.miningAddress()]),
                0n,
            );
            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSinceLastWrite([badValidator.miningAddress()]),
                BigInt(unavailableWriteTimestamp),
            );
        });
    });

    describe("reportReconnect", async function () {
        it("should restrict calling function only to validators", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await publicClient.getBlock();
            const caller = accounts[0];

            await hhViem.assertions.revertWithCustomError(
                connectivityTracker.write.reportReconnect(
                    [initialValidators[0].miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: caller.account },
                ),
                connectivityTracker,
                "OnlyValidator",
            );
        });

        it("should revert calling for future block", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);

            const latestBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomError(
                connectivityTracker.write.reportReconnect(
                    [initialValidators[1].miningAddress(), latestBlock.number + 5n, latestBlock.hash],
                    { account: initialValidators[0].mining },
                ),
                connectivityTracker,
                "InvalidBlock",
            );
        });

        it("should revert calling with invalid block hash", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);

            const latestBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomError(
                connectivityTracker.write.reportReconnect(
                    [
                        initialValidators[1].miningAddress(),
                        latestBlock.number,
                        keccak256(stringToBytes(latestBlock.hash)),
                    ],
                    { account: initialValidators[0].mining },
                ),
                connectivityTracker,
                "InvalidBlock",
            );
        });

        it("should revert too early report", async function () {
            const {
                initialValidators,
                connectivityTracker,
                validatorSetHbbft,
                stakingHbbft,
            } = await helpers.loadFixture(deployContracts);

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            const latestBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomError(
                connectivityTracker.write.reportReconnect(
                    [initialValidators[1].miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: initialValidators[0].mining },
                ),
                connectivityTracker,
                "ReportTooEarly",
            );
        });

        it("should revert report reconnect without disconnect report", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);
            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                connectivityTracker.write.reportReconnect(
                    [validator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: reporter.mining },
                ),
                connectivityTracker,
                "UnknownReconnectReporter",
                [reporter.miningAddress(), validator.miningAddress()],
            );
        });

        it("should revert report reconnect by flagged validator", async function () {
            const {
                initialValidators,
                connectivityTracker,
                validatorSetHbbft,
                stakingHbbft,
            } = await helpers.loadFixture(deployContracts);

            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            await connectivityTracker.write.reportMissingConnectivity(
                [validator.miningAddress(), latestBlock.number, latestBlock.hash],
                { account: reporter.mining },
            );

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                connectivityTracker.write.reportReconnect(
                    [validator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: validator.mining },
                ),
                connectivityTracker,
                "CannotReportByFlaggedValidator",
                [validator.miningAddress()],
            );
        });

        it("should report validator reconnected and emit event", async function () {
            const {
                initialValidators,
                connectivityTracker,
                validatorSetHbbft,
                stakingHbbft,
            } = await helpers.loadFixture(deployContracts);

            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            await disallowPeriodPassed();

            let latestBlock = await publicClient.getBlock();

            await connectivityTracker.write.reportMissingConnectivity(
                [validator.miningAddress(), latestBlock.number, latestBlock.hash],
                { account: reporter.mining },
            );

            latestBlock = await publicClient.getBlock();

            await hhViem.assertions.emitWithArgs(
                connectivityTracker.write.reportReconnect(
                    [validator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: reporter.mining },
                ),
                connectivityTracker,
                "ReportReconnect",
                [reporter.miningAddress(), validator.miningAddress(), latestBlock.number],
            );
        });

        it("should report validator reconnected and unflag it", async function () {
            const { initialValidators, connectivityTracker } = await helpers.loadFixture(deployContracts);
            const caller = initialValidators[0];
            const validator = initialValidators[1].miningAddress();

            await disallowPeriodPassed();
            const latestBlock = await publicClient.getBlock();

            await connectivityTracker.write.reportMissingConnectivity(
                [validator, latestBlock.number, latestBlock.hash],
                { account: initialValidators[0].mining },
            );

            assert.ok((await connectivityTracker.read.getFlaggedValidators()).includes(validator));
            await helpers.mine(1);

            await connectivityTracker.write.reportReconnect(
                [validator, latestBlock.number, latestBlock.hash],
                { account: caller.mining },
            );

            assert.ok(!(await connectivityTracker.read.getFlaggedValidators()).includes(validator));
        });

        it("should decrease validator connectivity score if reported reconnect", async function () {
            const { initialValidators, connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);
            const validator = initialValidators[2].miningAddress();

            await disallowPeriodPassed();
            const latestBlock = await publicClient.getBlock();

            for (const reporter of [initialValidators[0], initialValidators[1]]) {
                await connectivityTracker.write.reportMissingConnectivity(
                    [validator, latestBlock.number, latestBlock.hash],
                    { account: reporter.mining },
                );
            }

            const epoch = await stakingHbbft.read.stakingEpoch();
            const previousScore = await connectivityTracker.read.getValidatorConnectivityScore([epoch, validator]);
            await helpers.mine(1);

            await connectivityTracker.write.reportReconnect(
                [validator, latestBlock.number, latestBlock.hash],
                { account: initialValidators[0].mining },
            );

            const currentScore = await connectivityTracker.read.getValidatorConnectivityScore([epoch, validator]);

            assert.equal(currentScore, previousScore - 1n);
        });

        it("should send bad performance penalty after faulty validator full reconnect", async function () {
            const {
                initialValidators,
                connectivityTracker,
                stakingHbbft,
                bonusScoreContractMock,
            } = await helpers.loadFixture(deployContracts);

            const [badValidator, ...goodValidators] = initialValidators;
            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            await disallowPeriodPassed();

            let latestBlock = await publicClient.getBlock();

            assert.equal(
                await connectivityTracker.read.isFaultyValidator([epoch, badValidator.miningAddress()]),
                false,
            );

            for (let i = 0; i < reportsThreshold; ++i) {
                await connectivityTracker.write.reportMissingConnectivity(
                    [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: goodValidators[i].mining },
                );
            }

            assert.equal(
                await connectivityTracker.read.isFaultyValidator([epoch, badValidator.miningAddress()]),
                true,
            );

            const initialScore = 250n;
            await bonusScoreContractMock.write.setValidatorScore([badValidator.miningAddress(), initialScore]);

            const expectedScore = initialScore - (await bonusScoreContractMock.read.DEFAULT_BAD_PERF_FACTOR());

            latestBlock = await publicClient.getBlock();

            for (let i = 0; i < reportsThreshold; ++i) {
                await connectivityTracker.write.reportReconnect(
                    [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: goodValidators[i].mining },
                );
            }

            assert.equal(
                await connectivityTracker.read.isFaultyValidator([epoch, badValidator.miningAddress()]),
                false,
            );
            assert.equal(
                await connectivityTracker.read.getValidatorConnectivityScore([epoch, badValidator.miningAddress()]),
                0n,
            );
            assert.equal(
                await bonusScoreContractMock.read.getValidatorScore([badValidator.miningAddress()]),
                expectedScore,
            );
        });
    });

    describe("penaliseFaultyValidators", async function () {
        it("should restrict calling to BlockReward contract", async function () {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);

            const caller = accounts[0];

            await hhViem.assertions.revertWithCustomError(
                connectivityTracker.write.penaliseFaultyValidators([0n], { account: caller.account }),
                connectivityTracker,
                "Unauthorized",
            );
        });

        it("should not send penalties twice for same epoch", async function () {
            const { connectivityTracker, stakingHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContracts);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);

            const signer = await impersonateAcc(blockRewardHbbft.address);

            await connectivityTracker.write.penaliseFaultyValidators([epoch], { account: signer });

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                connectivityTracker.write.penaliseFaultyValidators([epoch], { account: signer }),
                connectivityTracker,
                "EpochPenaltiesAlreadySent",
                [epoch],
            );

            await helpers.stopImpersonatingAccount(signer);
        });

        it("should penalise faulty validators", async function () {
            const {
                initialValidators,
                connectivityTracker,
                stakingHbbft,
                blockRewardHbbft,
                bonusScoreContractMock,
            } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            for (const badValidator of badValidators) {
                for (let j = 0; j < reportsThreshold; ++j) {
                    await connectivityTracker.write.reportMissingConnectivity(
                        [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                        { account: goodValidators[j].mining },
                    );
                }
            }

            const initialScore = 205n;
            const scoreAfter = initialScore - 100n;

            for (const badValidator of badValidators) {
                await bonusScoreContractMock.write.setValidatorScore(
                    [badValidator.miningAddress(), initialScore],
                );
            }

            const signer = await impersonateAcc(blockRewardHbbft.address);

            await connectivityTracker.write.penaliseFaultyValidators([epoch], { account: signer });

            for (const badValidator of badValidators) {
                assert.equal(
                    await bonusScoreContractMock.read.getValidatorScore([badValidator.miningAddress()]),
                    scoreAfter,
                );
            }

            await helpers.stopImpersonatingAccount(signer);
        });

        it("should not penalise flagged but non faulty validators", async function () {
            const {
                initialValidators,
                connectivityTracker,
                stakingHbbft,
                blockRewardHbbft,
                bonusScoreContractMock,
            } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            for (const badValidator of badValidators) {
                for (let j = 0; j < reportsThreshold - 2; ++j) {
                    await connectivityTracker.write.reportMissingConnectivity(
                        [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                        { account: goodValidators[j].mining },
                    );
                }
            }

            const initialScore = 205n;

            for (const badValidator of badValidators) {
                await bonusScoreContractMock.write.setValidatorScore(
                    [badValidator.miningAddress(), initialScore],
                );
            }

            const signer = await impersonateAcc(blockRewardHbbft.address);
            await connectivityTracker.write.penaliseFaultyValidators([epoch], { account: signer });

            for (const badValidator of badValidators) {
                assert.equal(
                    await bonusScoreContractMock.read.getValidatorScore([badValidator.miningAddress()]),
                    initialScore,
                );
            }

            await helpers.stopImpersonatingAccount(signer);
        });
    });

    describe("countFaultyValidators", async function () {
        it("should count faulty validators", async function () {
            const { initialValidators, connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            for (const badValidator of badValidators) {
                for (let j = 0; j < reportsThreshold; ++j) {
                    await connectivityTracker.write.reportMissingConnectivity(
                        [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                        { account: goodValidators[j].mining },
                    );
                }
            }

            assert.equal(
                await connectivityTracker.read.countFaultyValidators([epoch]),
                BigInt(badValidatorsCount),
            );
        });

        it("should return 0 if validators reported but not faulty", async function () {
            const { initialValidators, connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            for (const badValidator of badValidators) {
                for (let j = 0; j < reportsThreshold - 1; ++j) {
                    await connectivityTracker.write.reportMissingConnectivity(
                        [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                        { account: goodValidators[j].mining },
                    );
                }
            }

            assert.equal(await connectivityTracker.read.countFaultyValidators([epoch]), 0n);
        });
    });

    describe("isReported", async function () {
        it("should check if validator reported", async function () {
            const { initialValidators, connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const [badValidator, ...goodValidators] = initialValidators;
            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            assert.equal(
                await connectivityTracker.read.isFaultyValidator([epoch, badValidator.miningAddress()]),
                false,
            );

            for (let i = 0; i < reportsThreshold - 1; ++i) {
                await connectivityTracker.write.reportMissingConnectivity(
                    [badValidator.miningAddress(), latestBlock.number, latestBlock.hash],
                    { account: goodValidators[i].mining },
                );

                assert.equal(
                    await connectivityTracker.read.isReported(
                        [epoch, badValidator.miningAddress(), goodValidators[i].miningAddress()],
                    ),
                    true,
                );
            }
        });
    });

    describe("earlyEpochEndThreshold", async function () {
        const EpochEndTriggers = [
            { hbbftFaultTolerance: 0n, networkSize: 1n, threshold: 0n },
            { hbbftFaultTolerance: 0n, networkSize: 2n, threshold: 0n },
            { hbbftFaultTolerance: 0n, networkSize: 3n, threshold: 0n },
            { hbbftFaultTolerance: 1n, networkSize: 4n, threshold: 0n },
            { hbbftFaultTolerance: 2n, networkSize: 7n, threshold: 0n },
            { hbbftFaultTolerance: 3n, networkSize: 10n, threshold: 1n },
            { hbbftFaultTolerance: 4n, networkSize: 13n, threshold: 2n },
            { hbbftFaultTolerance: 5n, networkSize: 16n, threshold: 3n },
            { hbbftFaultTolerance: 6n, networkSize: 19n, threshold: 4n },
            { hbbftFaultTolerance: 7n, networkSize: 22n, threshold: 5n },
            { hbbftFaultTolerance: 8n, networkSize: 25n, threshold: 6n },
        ];

        EpochEndTriggers.forEach((args) => {
            it(`should get epoch end threshold for hbbft fault tolerance: ${args.hbbftFaultTolerance}, network size: ${args.networkSize}`, async function () {
                const { connectivityTracker, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

                await validatorSetHbbft.write.setValidatorsNum([args.networkSize]);
                assert.equal(await validatorSetHbbft.read.getCurrentValidatorsCount(), args.networkSize);

                assert.equal(await connectivityTracker.read.earlyEpochEndThreshold(), args.threshold);
            });
        });
    });

    describe("early epoch end", async function () {
        it("should set early epoch end = true with sufficient reports", async function () {
            const {
                initialValidators,
                connectivityTracker,
                stakingHbbft,
                blockRewardHbbft,
            } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            assert.equal(await connectivityTracker.read.isEarlyEpochEnd([epoch]), false);

            for (let i = 0; i < badValidators.length; ++i) {
                for (let j = 0; j < reportsThreshold; ++j) {
                    if (i == badValidators.length - 1 && j == reportsThreshold - 1) {
                        break;
                    }

                    await connectivityTracker.write.reportMissingConnectivity(
                        [badValidators[i].miningAddress(), latestBlock.number, latestBlock.hash],
                        { account: goodValidators[j].mining },
                    );
                }
            }

            const lastBlock = await helpers.time.latestBlock();

            const lastReporter = goodValidators[reportsThreshold - 1];

            await hhViem.assertions.emitWithArgs(
                connectivityTracker.write.reportMissingConnectivity(
                    [
                        badValidators[badValidators.length - 1].miningAddress(),
                        latestBlock.number,
                        latestBlock.hash,
                    ],
                    { account: lastReporter.mining },
                ),
                connectivityTracker,
                "NotifyEarlyEpochEnd",
                [epoch, BigInt(lastBlock + 1)],
            );

            assert.equal(await connectivityTracker.read.isEarlyEpochEnd([epoch]), true);
            assert.equal(await blockRewardHbbft.read.earlyEpochEnd(), true);
        });

        it("should skip check for current epoch if early end already set", async function () {
            const {
                initialValidators,
                connectivityTracker,
                stakingHbbft,
                blockRewardHbbft,
            } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor((goodValidators.length * 2) / 3 + 1);

            const epoch = 5n;
            await stakingHbbft.write.setStakingEpoch([epoch]);
            await disallowPeriodPassed();

            const latestBlock = await publicClient.getBlock();

            assert.equal(await connectivityTracker.read.isEarlyEpochEnd([epoch]), false);

            for (let i = 0; i < badValidators.length; ++i) {
                for (let j = 0; j < reportsThreshold; ++j) {
                    if (i == badValidators.length - 1 && j == reportsThreshold - 1) {
                        break;
                    }

                    await connectivityTracker.write.reportMissingConnectivity(
                        [badValidators[i].miningAddress(), latestBlock.number, latestBlock.hash],
                        { account: goodValidators[j].mining },
                    );
                }
            }

            const lastBlock = await helpers.time.latestBlock();

            let reporter = goodValidators[reportsThreshold - 1];

            await hhViem.assertions.emitWithArgs(
                connectivityTracker.write.reportMissingConnectivity(
                    [
                        badValidators[badValidators.length - 1].miningAddress(),
                        latestBlock.number,
                        latestBlock.hash,
                    ],
                    { account: reporter.mining },
                ),
                connectivityTracker,
                "NotifyEarlyEpochEnd",
                [epoch, BigInt(lastBlock + 1)],
            );

            assert.equal(await connectivityTracker.read.isEarlyEpochEnd([epoch]), true);
            assert.equal(await blockRewardHbbft.read.earlyEpochEnd(), true);

            reporter = goodValidators[reportsThreshold];

            const txHash = await connectivityTracker.write.reportMissingConnectivity(
                [
                    badValidators[badValidators.length - 1].miningAddress(),
                    latestBlock.number,
                    latestBlock.hash,
                ],
                { account: reporter.mining },
            );
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

            const earlyEpochEndEvents = parseEventLogs({
                abi: connectivityTracker.abi,
                eventName: "NotifyEarlyEpochEnd",
                logs: receipt.logs,
            });

            assert.equal(earlyEpochEndEvents.length, 0);
        });
    });
});
