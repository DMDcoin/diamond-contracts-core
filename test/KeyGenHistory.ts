import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import {
    encodeFunctionData,
    parseEther,
    zeroAddress,
    type Account,
    type Address,
    type Hex,
} from "viem";

import { getTestPartNAcks } from "./fixtures/data.js";
import { deployDao } from "./fixtures/dao.js";
import { createNetworkFixtures, SystemAccountAddress } from "./fixtures/network.js";
import { Permission } from "./fixtures/permission.js";
import { deployProxy } from "./fixtures/proxy.js";
import { Validator } from "./fixtures/validator.js";
import { splitPublicKeys } from "./fixtures/utils.js";
import type {
    BlockRewardHbbftMock,
    CertifierHbbft,
    ConnectivityTrackerHbbftMock,
    KeyGenHistory,
    RandomHbbft,
    StakingHbbftMock,
    TxPermissionHbbft,
    ValidatorSetHbbftMock,
} from "./fixtures/types.js";

const connection = await hre.network.getOrCreate();
const { viem: hhViem, networkHelpers: helpers } = connection;

const { impersonateAcc } = createNetworkFixtures(connection);

const publicClient = await hhViem.getPublicClient();
type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

// you can set this to true for debugging uses.
const logOutput = false;

const candidateMinStake = parseEther("2");
const delegatorMinStake = parseEther("1");
const maxStake = parseEther("100000");

// one epoch in 1000 seconds.
const stakingEpochDuration = 1000n;

// the transition time window is 100 seconds.
const stakingTransitionwindowLength = 100n;
const stakingWithdrawDisallowPeriod = 100n;

const validatorInactivityThreshold = 365n * 86400n; // 1 year

describe("KeyGenHistory", () => {
    let owner: TestWalletClient;
    let accounts: TestWalletClient[];
    let initialValidators: Validator[];
    let otherValidators: Validator[];
    let stubAddress: Address;

    let initMiningAddresses: Address[];

    let keyGenHistory: KeyGenHistory;
    let txPermission: TxPermissionHbbft;
    let validatorSetHbbft: ValidatorSetHbbftMock;
    let stakingHbbft: StakingHbbftMock;
    let blockRewardHbbft: BlockRewardHbbftMock;
    let connectivityTracker: ConnectivityTrackerHbbftMock;
    let randomHbbft: RandomHbbft;
    let certifier: CertifierHbbft;
    let keyGenHistoryPermission: Permission<KeyGenHistory>;

    const { parts, acks } = getTestPartNAcks();

    async function printValidatorState(info: string) {
        if (!logOutput) {
            return;
        }

        const validators = await validatorSetHbbft.read.getValidators();
        const pendingValidators = await validatorSetHbbft.read.getPendingValidators();

        // Note: toBeElected are Pool (staking) addresses, and not Mining adresses.
        // all other adresses are mining adresses.
        const toBeElected = await stakingHbbft.read.getPoolsToBeElected();
        const pools = await stakingHbbft.read.getPools();
        const poolsInactive = await stakingHbbft.read.getPoolsInactive();
        const epoch = await stakingHbbft.read.stakingEpoch();

        console.log(info + " epoch : ", epoch);
        console.log(info + " pending   :", pendingValidators);
        console.log(info + " validators:", validators);
        console.log(info + " pools: ", pools);
        console.log(info + " inactive pools: ", poolsInactive);
        console.log(info + " pools toBeElected: ", toBeElected);
    }

    async function printEarlyEpochEndInfo() {
        if (!logOutput) {
            return;
        }

        const epoch = await stakingHbbft.read.stakingEpoch();
        const keyGenRound = await keyGenHistory.read.currentKeyGenRound();
        const isEarlyEpochEnd = await blockRewardHbbft.read.earlyEpochEnd();

        console.log(`epoch ${epoch} keyGenRound ${keyGenRound} isEarlyEpochEnd ${isEarlyEpochEnd}`);
    }

    // checks if a validator is able to write parts for free
    // and executes it.
    // NOTE: It does not really send the transaction with 0 gas price,
    // because that would only work if the network nodes would already
    // run on the test contracts deployed here.
    async function writePart(upcomingEpochNumber: bigint, round: bigint, parts: Hex, from: Account) {
        await keyGenHistoryPermission.callFunction("writePart", from, [upcomingEpochNumber, round, parts]);
    }

    async function writeAcks(upcomingEpochNumber: bigint, round: bigint, acks: Hex[], from: Account) {
        await keyGenHistoryPermission.callFunction("writeAcks", from, [upcomingEpochNumber, round, acks]);
    }

    async function announceAvailability(mining: Account) {
        const block = await publicClient.getBlock();

        const asEncoded = encodeFunctionData({
            abi: validatorSetHbbft.abi,
            functionName: "announceAvailability",
            args: [block.number, block.hash],
        });

        if (logOutput) {
            console.log("calling: announceAvailability");
            console.log("pool mining: ", mining.address);
            console.log("ecodedCall: ", asEncoded);
        }

        const [typesMask, cache] = await txPermission.read.allowedTxTypes([
            mining.address,
            validatorSetHbbft.address,
            0n, // value
            0n, // gas price
            asEncoded,
        ]);

        // don't ask to cache this result.
        assert.equal(cache, false);

        /// 0x01 - basic transaction (e.g. ether transferring to user wallet);
        /// 0x02 - contract call;
        /// 0x04 - contract creation;
        /// 0x08 - private transaction.

        assert.equal(typesMask, 2, "Transaction should be allowed according to TxPermission Contract.");

        // we know now, that this call is allowed.
        // so we can execute it.
        const txHash = await owner.sendTransaction({
            account: mining,
            to: validatorSetHbbft.address,
            data: asEncoded,
        });

        await publicClient.waitForTransactionReceipt({ hash: txHash });
    }

    async function callReward() {
        // mimic the behavor of the nodes here:
        // if The Validators managed to write the correct number
        // of Acks and Parts, we are happy and set a "true"
        // if not, we send a "false"
        // note: the Nodes they DO check if the ACKS and PARTS
        // make it possible to generate a treshold key here,
        // but within the tests, we just mimic this behavior.

        const systemAccount = await impersonateAcc(SystemAccountAddress);

        let isEpochEndBlock = false;
        const pendingValidators = await validatorSetHbbft.read.getPendingValidators();

        if (pendingValidators.length > 0) {
            const keyGenFragments = await keyGenHistory.read.getNumberOfKeyFragmentsWritten();
            if (
                keyGenFragments[0] === BigInt(pendingValidators.length) &&
                keyGenFragments[1] === BigInt(pendingValidators.length)
            ) {
                isEpochEndBlock = true;
            }
        }

        await blockRewardHbbft.write.reward([isEpochEndBlock], { account: systemAccount });

        await helpers.stopImpersonatingAccount(SystemAccountAddress);
    }

    // time travels forward to the beginning of the next transition,
    // and simulate a block mining (calling reward())
    async function timeTravelToTransition() {
        const currentTimestamp = await helpers.time.latest();
        const startTimeOfNextPhaseTransition = await stakingHbbft.read.startTimeOfNextPhaseTransition();

        if (logOutput) {
            console.log(`timetraveling from ${currentTimestamp} to ${startTimeOfNextPhaseTransition}`);
        }

        await helpers.time.increaseTo(startTimeOfNextPhaseTransition);
        await callReward();
    }

    async function timeTravelToEndEpoch() {
        const endTimeOfCurrentEpoch = await stakingHbbft.read.stakingFixedEpochEndTime();

        await helpers.time.increaseTo(endTimeOfCurrentEpoch);
        await callReward();
    }

    before(async function () {
        [owner, ...accounts] = await hhViem.getWalletClients();
        stubAddress = owner.account.address;

        initialValidators = new Array<Validator>();
        otherValidators = new Array<Validator>();

        for (let i = 0; i < 3; ++i) {
            const validator = await Validator.create();
            initialValidators.push(validator);
        }

        for (let i = 0; i < 5; ++i) {
            const validator = await Validator.create();
            otherValidators.push(validator);
        }

        initMiningAddresses = initialValidators.map((x) => x.miningAddress());

        const initStakingAddresses = initialValidators.map((x) => x.stakingAddress());
        const initPublicKeys = splitPublicKeys(initialValidators.map((x) => x.publicKey()));

        if (logOutput) {
            console.log("initial Mining Addresses", initMiningAddresses);
            console.log("initial Staking Addresses", initStakingAddresses);
        }

        await deployDao();

        const bonusScoreContractMock = await hhViem.deployContract("BonusScoreSystemMock");

        connectivityTracker = await hhViem.deployContract("ConnectivityTrackerHbbftMock");

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
        validatorSetHbbft = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
            initArgs: [
                owner.account.address,
                validatorSetParams,   // _params
                initMiningAddresses,  // _initialMiningAddresses
                initStakingAddresses, // _initialStakingAddresses
            ],
            initializer: "initialize",
        });

        blockRewardHbbft = await deployProxy(hhViem, "BlockRewardHbbftMock", {
            initArgs: [owner.account.address, validatorSetHbbft.address, connectivityTracker.address],
            initializer: "initialize",
        });

        randomHbbft = await deployProxy(hhViem, "RandomHbbft", {
            initArgs: [owner.account.address, validatorSetHbbft.address],
            initializer: "initialize",
        });

        const stakingParams = {
            _validatorSetContract: validatorSetHbbft.address,
            _bonusScoreContract: bonusScoreContractMock.address,
            _initialStakingAddresses: initStakingAddresses,
            _delegatorMinStake: delegatorMinStake,
            _candidateMinStake: candidateMinStake,
            _maxStake: maxStake,
            _stakingFixedEpochDuration: stakingEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionwindowLength,
            _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod,
        };

        stakingHbbft = await deployProxy(hhViem, "StakingHbbftMock", {
            initArgs: [
                owner.account.address,
                stakingParams,
                initPublicKeys,
                initialValidators.map((x) => x.ipAddress),
            ],
            initializer: "initialize",
        });

        keyGenHistory = await deployProxy(hhViem, "KeyGenHistory", {
            initArgs: [owner.account.address, validatorSetHbbft.address, initMiningAddresses, parts, acks],
            initializer: "initialize",
        });

        certifier = await deployProxy(hhViem, "CertifierHbbft", {
            initArgs: [[owner.account.address], validatorSetHbbft.address, owner.account.address],
            initializer: "initialize",
        });

        txPermission = await deployProxy(hhViem, "TxPermissionHbbft", {
            initArgs: [
                [owner.account.address],
                certifier.address,
                validatorSetHbbft.address,
                keyGenHistory.address,
                stubAddress,
                owner.account.address,
            ],
            initializer: "initialize",
        });

        keyGenHistoryPermission = new Permission(connection, txPermission, keyGenHistory, logOutput);

        await validatorSetHbbft.write.setBlockRewardContract([blockRewardHbbft.address]);
        await validatorSetHbbft.write.setRandomContract([randomHbbft.address]);
        await validatorSetHbbft.write.setStakingContract([stakingHbbft.address]);
        await validatorSetHbbft.write.setKeyGenHistoryContract([keyGenHistory.address]);

        const validators = await validatorSetHbbft.read.getValidators();

        assert.deepEqual(validators, initMiningAddresses.map((validator) => validator));
    });

    describe("initialize", async function () {
        it("should revert initialization with owner = address(0)", async function () {
            const implementation = await hhViem.deployContract("KeyGenHistory");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "KeyGenHistory", {
                    initArgs: [zeroAddress, stubAddress, initMiningAddresses, parts, acks],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert initialization with validator contract address = address(0)", async function () {
            const implementation = await hhViem.deployContract("KeyGenHistory");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "KeyGenHistory", {
                    initArgs: [owner.account.address, zeroAddress, initMiningAddresses, parts, acks],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert initialization with empty validators array", async function () {
            const implementation = await hhViem.deployContract("KeyGenHistory");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "KeyGenHistory", {
                    initArgs: [owner.account.address, stubAddress, [], parts, acks],
                    initializer: "initialize",
                }),
                implementation,
                "ValidatorsListEmpty",
            );
        });

        it("should revert initialization with wrong number of parts", async function () {
            const implementation = await hhViem.deployContract("KeyGenHistory");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "KeyGenHistory", {
                    initArgs: [owner.account.address, stubAddress, initMiningAddresses, [], acks],
                    initializer: "initialize",
                }),
                implementation,
                "WrongPartsNumber",
            );
        });

        it("should revert initialization with wrong number of acks", async function () {
            const implementation = await hhViem.deployContract("KeyGenHistory");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "KeyGenHistory", {
                    initArgs: [owner.account.address, stubAddress, initMiningAddresses, parts, []],
                    initializer: "initialize",
                }),
                implementation,
                "WrongAcksNumber",
            );
        });

        it("should not allow reinitialization", async function () {
            const contract = await deployProxy(hhViem, "KeyGenHistory", {
                initArgs: [owner.account.address, stubAddress, initMiningAddresses, parts, acks],
                initializer: "initialize",
            });

            await hhViem.assertions.revertWithCustomError(
                contract.write.initialize([
                    owner.account.address,
                    stubAddress,
                    initMiningAddresses,
                    parts,
                    acks,
                ]),
                contract,
                "InvalidInitialization",
            );
        });

        it("should initialize and set parts, acks", async function () {
            const keyGenHistory = await deployProxy(hhViem, "KeyGenHistory", {
                initArgs: [owner.account.address, validatorSetHbbft.address, initMiningAddresses, parts, acks],
                initializer: "initialize",
            });

            let actualPartsCount = 0;
            let actualAcksCount = 0;
            for (const miningAddress of initMiningAddresses) {
                const storedPart = await keyGenHistory.read.getPart([miningAddress]);
                const storedAcksLength = await keyGenHistory.read.getAcksLength([miningAddress]);

                if (storedPart !== "0x") {
                    actualPartsCount++;
                }

                if (storedAcksLength > 0n) {
                    actualAcksCount++;
                }
            }

            const [numberOfPartsWritten, numberOfAcksWritten] = await keyGenHistory.read.getNumberOfKeyFragmentsWritten();

            assert.equal(await keyGenHistory.read.getCurrentKeyGenRound(), 1n);
            assert.equal(numberOfPartsWritten, BigInt(actualPartsCount));
            assert.equal(numberOfAcksWritten, BigInt(actualAcksCount));
        });
    });

    describe("contract functions", async function () {
        it("should restrict calling clearPrevKeyGenState to ValidatorSet contract", async function () {
            const caller = accounts[5];

            await hhViem.assertions.revertWithCustomError(
                keyGenHistory.write.clearPrevKeyGenState([[]], { account: caller.account }),
                keyGenHistory,
                "Unauthorized",
            );
        });

        it("should restrict calling notifyNewEpoch to ValidatorSet contract", async function () {
            const caller = accounts[5];

            await hhViem.assertions.revertWithCustomError(
                keyGenHistory.write.notifyNewEpoch({ account: caller.account }),
                keyGenHistory,
                "Unauthorized",
            );
        });

        it("should restrict calling notifyKeyGenFailed to ValidatorSet contract", async function () {
            const caller = accounts[5];

            await hhViem.assertions.revertWithCustomError(
                keyGenHistory.write.notifyKeyGenFailed({ account: caller.account }),
                keyGenHistory,
                "Unauthorized",
            );
        });

        it("should revert writePart for wrong epoch", async function () {
            const roundCounter = await keyGenHistory.read.getCurrentKeyGenRound();

            const caller = initialValidators[0].mining;
            const epoch = await stakingHbbft.read.stakingEpoch();

            await hhViem.assertions.revertWithCustomError(
                keyGenHistory.write.writePart([epoch, roundCounter, parts[0]], { account: caller }),
                keyGenHistory,
                "IncorrectEpoch",
            );
        });

        it("should revert writePart for wrong round", async function () {
            const roundCounter = await keyGenHistory.read.getCurrentKeyGenRound();

            const caller = initialValidators[0].mining;
            const epoch = await stakingHbbft.read.stakingEpoch();

            const wrongRound = roundCounter + 1n;

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                keyGenHistory.write.writePart([epoch + 1n, wrongRound, parts[0]], { account: caller }),
                keyGenHistory,
                "IncorrectRound",
                [roundCounter, wrongRound],
            );
        });

        it("should revert writePart by non-pending validator", async function () {
            const roundCounter = await keyGenHistory.read.getCurrentKeyGenRound();

            const caller = initialValidators[0].mining;
            const epoch = await stakingHbbft.read.stakingEpoch();

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                keyGenHistory.write.writePart([epoch + 1n, roundCounter, parts[0]], { account: caller }),
                keyGenHistory,
                "NotPendingValidator",
                [caller.address],
            );
        });

        it("should revert writeAcks for wrong epoch", async function () {
            const roundCounter = await keyGenHistory.read.getCurrentKeyGenRound();

            const caller = initialValidators[0].mining;
            const epoch = await stakingHbbft.read.stakingEpoch();

            await hhViem.assertions.revertWithCustomError(
                keyGenHistory.write.writeAcks([epoch, roundCounter, acks[0]], { account: caller }),
                keyGenHistory,
                "IncorrectEpoch",
            );
        });

        it("should revert writeAcks for wrong round", async function () {
            const roundCounter = await keyGenHistory.read.getCurrentKeyGenRound();

            const caller = initialValidators[0].mining;
            const epoch = await stakingHbbft.read.stakingEpoch();

            const wrongRound = roundCounter + 1n;

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                keyGenHistory.write.writeAcks([epoch + 1n, wrongRound, acks[0]], { account: caller }),
                keyGenHistory,
                "IncorrectRound",
                [roundCounter, wrongRound],
            );
        });

        it("should revert writeAcks by non-pending validator", async function () {
            const roundCounter = await keyGenHistory.read.getCurrentKeyGenRound();

            const caller = initialValidators[0].mining;
            const epoch = await stakingHbbft.read.stakingEpoch();

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                keyGenHistory.write.writeAcks([epoch + 1n, roundCounter, acks[0]], { account: caller }),
                keyGenHistory,
                "NotPendingValidator",
                [caller.address],
            );
        });

        it("failed KeyGeneration, availability", async function () {
            const currentTS = await helpers.time.latest();
            const validator = otherValidators[0];

            if (logOutput) {
                console.log("currentTS:", currentTS);
                console.log("newPoolStakingAddress:", validator.stakingAddress());
                console.log("newPoolMiningAddress:", validator.miningAddress());
            }

            assert.equal(await stakingHbbft.read.isPoolActive([validator.stakingAddress()]), false);

            await stakingHbbft.write.addPool(
                [validator.miningAddress(), zeroAddress, 0n, validator.publicKey(), validator.ipAddress],
                { account: validator.staking, value: candidateMinStake },
            );

            assert.equal(await stakingHbbft.read.isPoolActive([validator.stakingAddress()]), true);

            await printValidatorState("after staking on new Pool:");
            await timeTravelToTransition();
            await printValidatorState("after travel to transition:");

            await timeTravelToEndEpoch();

            // the pools did not manage to write it's part and acks.

            await printValidatorState("after failure:");

            assert.equal((await stakingHbbft.read.getPoolsToBeElected()).length, 0);
            assert.deepEqual(
                await stakingHbbft.read.getPoolsInactive(),
                [validator.stakingAddress()],
            );

            // announcing availability.
            // this should place us back on the list of active and available pools.
            await announceAvailability(validator.mining);
            await printValidatorState("after announceAvailability:");

            // pool is available again!
            assert.deepEqual(
                await stakingHbbft.read.getPoolsToBeElected(),
                [validator.stakingAddress()],
            );
            assert.equal((await stakingHbbft.read.getPoolsInactive()).length, 0);

            // the original validators took over.
            // lets travel again to the end of the epoch, to switch into the next epoch
            // to invoke another voting.

            //write the PART and ACK for the pending validator:

            const pendingValidators = await validatorSetHbbft.read.getPendingValidators();

            // since there was never  another electable candidate, the system should still
            // tread the one and only pending validator still as pending validator.
            assert.deepEqual(pendingValidators, [validator.miningAddress()]);

            // since the initial round was failed, we are in the second round.
            const currentRoundCounter = 2n;

            await writePart(1n, currentRoundCounter, parts[0], validator.mining);

            //confirm that part was written.
            assert.equal(await keyGenHistory.read.getPart([pendingValidators[0]]), parts[0]);

            await writeAcks(1n, currentRoundCounter, acks[0], validator.mining);
            await timeTravelToEndEpoch();

            await printValidatorState("epoch1 start:");
            assert.equal(await stakingHbbft.read.stakingEpoch(), 1n);

            await timeTravelToTransition();
            await printValidatorState("epoch1 phase2:");

            // now write the ACK and the PART:
            await writePart(2n, 1n, parts[0], validator.mining);
            await writeAcks(2n, 1n, acks[0], validator.mining);

            await hhViem.assertions.revertWithCustomError(
                keyGenHistory.write.writePart([2n, 1n, parts[0]], { account: validator.mining }),
                keyGenHistory,
                "PartsAlreadySubmitted",
            );

            await hhViem.assertions.revertWithCustomError(
                keyGenHistory.write.writeAcks([2n, 1n, acks[0]], { account: validator.mining }),
                keyGenHistory,
                "AcksAlreadySubmitted",
            );

            // it's now job of the current validators to verify the correct write of the PARTS and ACKS
            // (this is simulated by the next call)
            await timeTravelToEndEpoch();

            // now everything is fine, we can do the transition after failing
            // the first one.

            await printValidatorState("epoch2 start:");
            assert.equal(await stakingHbbft.read.stakingEpoch(), 2n);

            // now the new node should be a validator.
            assert.deepEqual(
                await validatorSetHbbft.read.getValidators(),
                [validator.miningAddress()],
            );
        });

        it("1/2 KeyGeneration - PART Failure", async function () {
            //tests a 2 validators setup.
            // 1 manages to write it's part.
            // 1 does not manage to write it's part.
            // expected behavior:
            // system goes into an extra key gen round,
            // without the failing party as pending validator.
            // even if the failing party manages to announce availability
            // within the extra-key-gen round he wont be picked up this round.

            const connectivityTrackerCaller = await impersonateAcc(connectivityTracker.address);

            await blockRewardHbbft.write.notifyEarlyEpochEnd({ account: connectivityTrackerCaller });
            await helpers.stopImpersonatingAccount(connectivityTrackerCaller);

            await printEarlyEpochEndInfo();

            const validator = otherValidators[0];
            assert.notEqual(
                await validatorSetHbbft.read.validatorAvailableSince([validator.miningAddress()]),
                0n,
            );

            const additionalValidator = otherValidators[1];
            await stakingHbbft.write.addPool(
                [
                    additionalValidator.miningAddress(),
                    zeroAddress,
                    0n,
                    additionalValidator.publicKey(),
                    additionalValidator.ipAddress,
                ],
                { account: additionalValidator.staking, value: candidateMinStake },
            );

            await printValidatorState("After adding mining address2:");
            await timeTravelToTransition();
            await printValidatorState("validator2 pending:");

            // now let pending validator 2 write it's Part,
            // but pending validator 1 misses out to write it's part.
            await printEarlyEpochEndInfo();

            await writePart(3n, 1n, parts[0], additionalValidator.mining);
            await assert.rejects(writeAcks(3n, 1n, acks[0], additionalValidator.mining));

            if (logOutput) {
                console.log("numberOfPartsWritten: ", await keyGenHistory.read.numberOfPartsWritten());
                console.log("numberOfAcksWritten: ", await keyGenHistory.read.numberOfAcksWritten());
            }

            await timeTravelToEndEpoch();
            await printValidatorState("failedEnd:");

            // another TimeTravel to end epoch happened,
            // we expect that there was NO epoch change.
            // since Validator 1 failed writing his keys.
            assert.equal(await stakingHbbft.read.stakingEpoch(), 2n);

            // we expect Validator 1 now to be marked as unavailable,
            // since he failed to write his key.
            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSince([validator.miningAddress()]),
                0n,
            );

            // and only validator 2 is part of the Set.
            // validator 2 needs to write his keys again.
            assert.deepEqual(
                await validatorSetHbbft.read.getPendingValidators(),
                [additionalValidator.miningAddress()],
            );

            await printEarlyEpochEndInfo();

            await writePart(3n, 2n, parts[0], additionalValidator.mining);
            await writeAcks(3n, 2n, acks[0], additionalValidator.mining);

            await callReward();

            assert.equal(await stakingHbbft.read.stakingEpoch(), 3n);
            assert.deepEqual(
                await validatorSetHbbft.read.getValidators(),
                [additionalValidator.miningAddress()],
            );
        });

        it("1/2 KeyGeneration - ACKS Failure", async function () {
            //tests a 2 validators setup.
            // both  manage to write it's part.
            // 1 does not manage to write it's ACK.
            // expected behavior:
            // system goes into an extra key gen round,
            // without the failing party as pending validator.

            const validator1 = otherValidators[0];
            const validator2 = otherValidators[1];

            // address1 is already picked up and a validator.
            // we double check if he is also marked for being available:
            await announceAvailability(validator1.mining);
            await announceAvailability(validator2.mining);

            assert.notEqual(
                await validatorSetHbbft.read.validatorAvailableSince([validator1.miningAddress()]),
                0n,
            );
            assert.notEqual(
                await validatorSetHbbft.read.validatorAvailableSince([validator2.miningAddress()]),
                0n,
            );

            await timeTravelToTransition();
            await printValidatorState("validator2 pending:");

            // now let pending validator 2 write it's Part,
            // but pending validator 1 misses out to write it's part.
            await printEarlyEpochEndInfo();

            await writePart(4n, 1n, parts[0], validator2.mining);
            await writePart(4n, 1n, parts[0], validator1.mining);

            await writeAcks(4n, 1n, acks[0], validator1.mining);

            if (logOutput) {
                console.log("numberOfPartsWritten: ", await keyGenHistory.read.numberOfPartsWritten());
                console.log("numberOfAcksWritten: ", await keyGenHistory.read.numberOfAcksWritten());
            }

            await timeTravelToEndEpoch();
            await printValidatorState("failedEnd:");

            // we expect that there was NO epoch change.
            // since Validator 2 failed writing his ACKs.
            assert.equal(await stakingHbbft.read.stakingEpoch(), 3n);

            // we expect Validator 2 now to be marked as unavailable,
            // since he failed to write his key.
            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSince([validator2.miningAddress()]),
                0n,
            );

            // and only validator 2 is part of the Set.
            // validator 2 needs to write his keys again.
            assert.deepEqual(
                await validatorSetHbbft.read.getPendingValidators(),
                [validator1.miningAddress()],
            );

            // we are in another round,
            assert.equal(await keyGenHistory.read.getCurrentKeyGenRound(), 2n);

            await printEarlyEpochEndInfo();
        });
    });

    describe("Certifier", async function () {
        it("Owner must be able to certify any user", async function () {
            const who = accounts[35].account.address;

            await certifier.write.certify([who], { account: owner.account });

            assert.equal(await certifier.read.certified([who]), true);
            assert.equal(await certifier.read.certifiedExplicitly([who]), true);
        });

        it("Mining addresses with pools should be certified by default", async function () {
            const miningAddress = initialValidators[1].miningAddress();

            assert.equal(await certifier.read.certified([miningAddress]), true);
            assert.equal(await certifier.read.certifiedExplicitly([miningAddress]), false);
        });

        it("Should be able to revoke from non-validators", async function () {
            const who = accounts[35].account.address;

            await certifier.write.revoke([who], { account: owner.account });

            assert.equal(await certifier.read.certified([who]), false);
        });

        it("Shouldn't be able to revoke from working validators", async function () {
            const miningAddress = initialValidators[1].miningAddress();

            await certifier.write.revoke([miningAddress], { account: owner.account });

            assert.equal(await certifier.read.certified([miningAddress]), true);
        });

        it("Shouldn't be able to certify zero address", async function () {
            await hhViem.assertions.revertWithCustomError(
                certifier.write.certify([zeroAddress], { account: owner.account }),
                certifier,
                "ZeroAddress",
            );
        });
    });
});
