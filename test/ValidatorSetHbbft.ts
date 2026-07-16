import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import {
    encodePacked,
    getAddress,
    hexToBytes,
    parseEther,
    parseEventLogs,
    sha256,
    toHex,
    zeroAddress,
    type Account,
    type Address,
    type Hex,
} from "viem";

import { Permission } from "./fixtures/permission.js";
import { random, splitPublicKeys } from "./fixtures/utils.js";
import { getNValidatorsPartNAcks, getTestPartNAcks } from "./fixtures/data.js";
import { KeyGenMode, type ValidatorSetHbbftMock, type StakingHbbftMock, type KeyGenHistory } from "./fixtures/types.js";
import { Validator, ZeroIpAddress } from "./fixtures/validator.js";
import { createRandomWallet } from "./fixtures/wallet.js";
import { deployProxy } from "./fixtures/proxy.js";

const connection = await hre.network.getOrCreate();
const { viem: hhViem, networkHelpers: helpers } = connection;

const publicClient = await hhViem.getPublicClient();
type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

// one epoch in 1 day.
const stakingFixedEpochDuration = 86400n;

// the transition time window is 1 hour.
const stakingTransitionTimeframeLength = 3600n;
const stakingWithdrawDisallowPeriod = 1n;
const MAX_STAKE = parseEther("100000");

const validatorInactivityThreshold = 365n * 86400n; // 1 year

const SystemAccountAddress: Address = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";

describe("ValidatorSetHbbft", () => {
    let owner: TestWalletClient;
    let accounts: TestWalletClient[];

    let stubAddress: Address;

    const getValidatorSetParams = () => {
        return {
            blockRewardContract: createRandomWallet().address,
            randomContract: createRandomWallet().address,
            stakingContract: createRandomWallet().address,
            keyGenHistoryContract: createRandomWallet().address,
            bonusScoreContract: createRandomWallet().address,
            connectivityTrackerContract: createRandomWallet().address,
            validatorInactivityThreshold: validatorInactivityThreshold,
        };
    };

    async function deployContractsFixture() {
        const initialValidators = new Array<Validator>();
        for (let i = 0; i < 3; ++i) {
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

        const validatorSetHbbft = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
            initArgs: [
                owner.account.address,
                validatorSetParams,      // _params
                initialMiningAddresses,  // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ],
            initializer: "initialize",
        });

        const randomHbbft = await deployProxy(hhViem, "RandomHbbft", {
            initArgs: [owner.account.address, validatorSetHbbft.address],
            initializer: "initialize",
        });

        const keyGenHistory = await deployProxy(hhViem, "KeyGenHistory", {
            initArgs: [owner.account.address, validatorSetHbbft.address, initialMiningAddresses, parts, acks],
            initializer: "initialize",
        });

        const certifier = await deployProxy(hhViem, "CertifierHbbft", {
            initArgs: [[owner.account.address], validatorSetHbbft.address, owner.account.address],
            initializer: "initialize",
        });

        const txPermission = await deployProxy(hhViem, "TxPermissionHbbft", {
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

        const blockRewardHbbft = await deployProxy(hhViem, "BlockRewardHbbftMock", {
            initArgs: [owner.account.address, validatorSetHbbft.address, connectivityTracker.address],
            initializer: "initialize",
        });

        const stakingParams = {
            _validatorSetContract: validatorSetHbbft.address,
            _bonusScoreContract: bonusScoreContractMock.address,
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: parseEther("1"),
            _candidateMinStake: parseEther("1"),
            _maxStake: MAX_STAKE,
            _stakingFixedEpochDuration: stakingFixedEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
            _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod,
        };

        const stakingHbbft = await deployProxy(hhViem, "StakingHbbftMock", {
            initArgs: [
                owner.account.address,
                stakingParams,                 // initializer structure
                initialValidatorsPubKeys,      // _publicKeys
                initialValidatorsIpAddresses,  // _internetAddresses
            ],
            initializer: "initialize",
        });

        await validatorSetHbbft.write.setBlockRewardContract([blockRewardHbbft.address]);
        await validatorSetHbbft.write.setRandomContract([randomHbbft.address]);
        await validatorSetHbbft.write.setStakingContract([stakingHbbft.address]);
        await validatorSetHbbft.write.setKeyGenHistoryContract([keyGenHistory.address]);

        return {
            initialValidators,
            validatorSetHbbft,
            blockRewardHbbft,
            stakingHbbft,
            randomHbbft,
            keyGenHistory,
            certifier,
            txPermission,
            connectivityTracker,
        };
    }

    async function impersonateAcc(address: Address): Promise<Address> {
        await helpers.impersonateAccount(address);
        await helpers.setBalance(address, parseEther("10"));

        return address;
    }

    before(async function () {
        [owner, ...accounts] = await hhViem.getWalletClients();

        stubAddress = createRandomWallet().address;
    });

    describe("initialize", async function () {
        let validatorMiningAddresses: Address[];
        let validatorStakingAddresses: Address[];

        before(async function () {
            validatorMiningAddresses = new Array<Address>();
            validatorStakingAddresses = new Array<Address>();

            for (let i = 0; i < 3; ++i) {
                validatorMiningAddresses.push(createRandomWallet().address);
                validatorStakingAddresses.push(createRandomWallet().address);
            }
        });

        const ZeroInitializerTestCases = [
            {
                caseName: "BlockRewardHbbft",
                params: {
                    ...getValidatorSetParams(),
                    blockRewardContract: zeroAddress,
                },
            },
            {
                caseName: "RandomHbbft",
                params: {
                    ...getValidatorSetParams(),
                    randomContract: zeroAddress,
                },
            },
            {
                caseName: "StakingHbbft",
                params: {
                    ...getValidatorSetParams(),
                    stakingContract: zeroAddress,
                },
            },
            {
                caseName: "KeyGenHistory",
                params: {
                    ...getValidatorSetParams(),
                    keyGenHistoryContract: zeroAddress,
                },
            },
            {
                caseName: "BonusScoreSystem",
                params: {
                    ...getValidatorSetParams(),
                    bonusScoreContract: zeroAddress,
                },
            },
        ];

        ZeroInitializerTestCases.forEach((args) => {
            it(`should revert initialization with ${args.caseName} contract address`, async function () {
                const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

                await hhViem.assertions.revertWithCustomError(
                    deployProxy(hhViem, "ValidatorSetHbbftMock", {
                        initArgs: [owner.account.address, args.params, validatorMiningAddresses, validatorStakingAddresses],
                        initializer: "initialize",
                    }),
                    implementation,
                    "ZeroAddress",
                );
            });
        });

        it("should initialize successfully", async function () {
            const params = getValidatorSetParams();

            const validatorSetHbbft = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
                initArgs: [owner.account.address, params, validatorMiningAddresses, validatorStakingAddresses],
                initializer: "initialize",
            });

            assert.equal(await validatorSetHbbft.read.blockRewardContract(), params.blockRewardContract);
            assert.equal(await validatorSetHbbft.read.randomContract(), params.randomContract);
            assert.equal(await validatorSetHbbft.read.getStakingContract(), params.stakingContract);
            assert.equal(await validatorSetHbbft.read.keyGenHistoryContract(), params.keyGenHistoryContract);
            assert.equal(await validatorSetHbbft.read.bonusScoreSystem(), params.bonusScoreContract);

            assert.deepEqual(await validatorSetHbbft.read.getValidators(), validatorMiningAddresses);
            assert.equal((await validatorSetHbbft.read.getPendingValidators()).length, 0);

            for (let i = 0; i < validatorMiningAddresses.length; ++i) {
                assert.equal(await validatorSetHbbft.read.isValidator([validatorMiningAddresses[i]]), true);
                assert.equal(
                    await validatorSetHbbft.read.miningByStakingAddress([validatorStakingAddresses[i]]),
                    validatorMiningAddresses[i],
                );
                assert.equal(
                    await validatorSetHbbft.read.stakingByMiningAddress([validatorMiningAddresses[i]]),
                    validatorStakingAddresses[i],
                );
            }

            assert.equal(await validatorSetHbbft.read.isValidator([zeroAddress]), false);
            assert.equal(await validatorSetHbbft.read.validatorInactivityThreshold(), validatorInactivityThreshold);
        });

        it("should fail if owner address is zero", async function () {
            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [zeroAddress, getValidatorSetParams(), validatorMiningAddresses, validatorStakingAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should fail if initial mining addresses are empty", async function () {
            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [owner.account.address, getValidatorSetParams(), [], validatorStakingAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "ValidatorsListEmpty",
            );
        });

        it("should fail if already initialized", async function () {
            const validatorSetHbbft = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
                initArgs: [owner.account.address, getValidatorSetParams(), validatorMiningAddresses, validatorStakingAddresses],
                initializer: "initialize",
            });

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.initialize([
                    owner.account.address,
                    getValidatorSetParams(),
                    validatorMiningAddresses,
                    validatorStakingAddresses,
                ]),
                validatorSetHbbft,
                "InvalidInitialization",
            );
        });

        it("should fail if the number of mining addresses is not the same as the number of staking ones", async function () {
            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            const reducedStakingAddresses = validatorStakingAddresses.slice(1);

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [owner.account.address, getValidatorSetParams(), validatorMiningAddresses, reducedStakingAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InitialAddressesLengthMismatch",
            );
        });

        it("should fail if the mining addresses are the same as the staking ones", async function () {
            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [owner.account.address, getValidatorSetParams(), validatorMiningAddresses, validatorMiningAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "InvalidAddressPair",
            );
        });

        it("should fail if some mining address is 0", async function () {
            const alteredMiningAddresses = validatorMiningAddresses.slice();
            alteredMiningAddresses[0] = zeroAddress;

            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [owner.account.address, getValidatorSetParams(), alteredMiningAddresses, validatorStakingAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should fail if some staking address is 0", async function () {
            const alteredStakingAddresses = validatorStakingAddresses.slice();
            alteredStakingAddresses[0] = zeroAddress;

            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [owner.account.address, getValidatorSetParams(), validatorMiningAddresses, alteredStakingAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should fail if a staking address was already used", async function () {
            const alteredStakingAddresses = validatorStakingAddresses.slice();
            alteredStakingAddresses[0] = validatorStakingAddresses[1];

            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [owner.account.address, getValidatorSetParams(), validatorMiningAddresses, alteredStakingAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "StakingAddressAlreadyUsed",
                [validatorStakingAddresses[1]],
            );
        });

        it("should fail if a mining address is currently being used as a staking one", async function () {
            const alteredMiningAddresses = validatorMiningAddresses.slice();
            alteredMiningAddresses[1] = validatorStakingAddresses[0];

            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [owner.account.address, getValidatorSetParams(), alteredMiningAddresses, validatorStakingAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "MiningAddressAlreadyUsed",
                [alteredMiningAddresses[1]],
            );
        });

        it("should fail if a staking address is currently being used as a mining one", async function () {
            const alteredStakingAddresses = validatorStakingAddresses.slice();
            alteredStakingAddresses[1] = validatorMiningAddresses[0];

            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [owner.account.address, getValidatorSetParams(), validatorMiningAddresses, alteredStakingAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "StakingAddressAlreadyUsed",
                [alteredStakingAddresses[1]],
            );
        });

        it("should fail if a mining address was already used", async function () {
            const alteredMiningAddresses = validatorMiningAddresses.slice();
            alteredMiningAddresses[1] = alteredMiningAddresses[0];

            const implementation = await hhViem.deployContract("ValidatorSetHbbftMock");

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                deployProxy(hhViem, "ValidatorSetHbbftMock", {
                    initArgs: [owner.account.address, getValidatorSetParams(), alteredMiningAddresses, validatorStakingAddresses],
                    initializer: "initialize",
                }),
                implementation,
                "MiningAddressAlreadyUsed",
                [alteredMiningAddresses[1]],
            );
        });
    });

    describe("setValidatorInternetAddress", async function () {
        it("should revert for unknown mining address", async function () {
            const unknownMiningWallet = accounts[18];
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const ip = ZeroIpAddress;
            const port: Hex = "0x0000";

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                validatorSetHbbft.write.setValidatorInternetAddress([ip, port], {
                    account: unknownMiningWallet.account,
                }),
                validatorSetHbbft,
                "StakingPoolNotExist",
                [getAddress(unknownMiningWallet.account.address)],
            );
        });

        it("should allow validator candidates to write and read their IP address", async function () {
            const validators = new Array<Validator>();
            for (let i = 0; i < 4; ++i) {
                const validator = await Validator.create();
                validators.push(validator);
            }

            const initialMiningAddr = [validators[0].miningAddress()];
            const initialStakingAddr = [validators[0].stakingAddress()];
            const initialPublicKeys = splitPublicKeys([validators[0].publicKey()]);
            const initialIpAddresses = [validators[0].ipAddress];

            const stubAddress = owner.account.address;

            const validatorSetParams = getValidatorSetParams();

            const bonusScoreContractMock = await hhViem.deployContract("BonusScoreSystemMock");

            const validatorSetHbbft = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
                initArgs: [
                    owner.account.address,
                    validatorSetParams,
                    initialMiningAddr,  // _initialMiningAddresses
                    initialStakingAddr, // _initialStakingAddresses
                ],
                initializer: "initialize",
            });

            const blockRewardHbbft = await deployProxy(hhViem, "BlockRewardHbbftMock", {
                initArgs: [owner.account.address, validatorSetHbbft.address, stubAddress],
                initializer: "initialize",
            });

            const certifier = await deployProxy(hhViem, "CertifierHbbft", {
                initArgs: [[owner.account.address], validatorSetHbbft.address, owner.account.address],
                initializer: "initialize",
            });

            const keyGenHistoryFake: Address = "0x8000000000000000000000000000000000000001";

            const txPermission = await deployProxy(hhViem, "TxPermissionHbbft", {
                initArgs: [
                    [owner.account.address],
                    certifier.address,
                    validatorSetHbbft.address,
                    keyGenHistoryFake,
                    stubAddress,
                    owner.account.address,
                ],
                initializer: "initialize",
            });

            const stakingParams = {
                _candidateMinStake: 1000n,
                _delegatorMinStake: 100n,
                _initialStakingAddresses: initialStakingAddr,
                _stakingFixedEpochDuration: 60n,
                _maxStake: 5000n,
                _stakingTransitionTimeframeLength: 10n,
                _stakingWithdrawDisallowPeriod: 10n,
                _validatorSetContract: validatorSetHbbft.address,
                _bonusScoreContract: bonusScoreContractMock.address,
            };

            const stakingHbbft = await deployProxy(hhViem, "StakingHbbftMock", {
                initArgs: [
                    owner.account.address,
                    stakingParams,      // initializer structure
                    initialPublicKeys,  // _publicKeys
                    initialIpAddresses, // _internetAddresses
                ],
                initializer: "initialize",
            });

            const validatorSetPermission = new Permission(connection, txPermission, validatorSetHbbft, false);

            await validatorSetHbbft.write.setBlockRewardContract([blockRewardHbbft.address]);
            await validatorSetHbbft.write.setStakingContract([stakingHbbft.address]);

            assert.equal(await validatorSetHbbft.read.blockRewardContract(), getAddress(blockRewardHbbft.address));
            assert.equal(await validatorSetHbbft.read.getStakingContract(), getAddress(stakingHbbft.address));
            assert.equal(await validatorSetHbbft.read.randomContract(), validatorSetParams.randomContract);
            assert.equal(await validatorSetHbbft.read.keyGenHistoryContract(), validatorSetParams.keyGenHistoryContract);

            assert.ok((await stakingHbbft.read.getPools()).length > 0);

            let ipLast = 1;
            for (const pool of validators) {
                if (await stakingHbbft.read.isPoolActive([pool.stakingAddress()])) {
                    const ipAddress = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 192, 168, 0, ipLast++]);
                    const port = 30303;

                    await setValidatorInternetAddress(validatorSetPermission, pool.mining, ipAddress, port);
                    const writtenIP = await getValidatorInternetAddress(stakingHbbft, pool.stakingAddress());

                    assert.deepEqual(writtenIP, { ipAddress: ipAddress, port: BigInt(port) });
                }
            }
        });
    });

    describe("setStakingAddress", async function () {
        it("should restrict calling to staking contract", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.setStakingAddress([zeroAddress, zeroAddress], { account: caller.account }),
                validatorSetHbbft,
                "Unauthorized",
            );
        });

        it("should set stakingAddress", async function () {
            const { validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.write.addBalance({ value: parseEther("1") });
            const stakingCaller = await impersonateAcc(stakingHbbft.address);

            const poolMining = createRandomWallet().address;
            const poolStaking = createRandomWallet().address;

            await validatorSetHbbft.write.setStakingAddress([poolMining, poolStaking], { account: stakingCaller });
            await helpers.stopImpersonatingAccount(stakingCaller);

            assert.equal(await validatorSetHbbft.read.stakingByMiningAddress([poolMining]), poolStaking);
        });
    });

    describe("newValidatorSet", async function () {
        it("should restrict calling to block reward contract", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.newValidatorSet({ account: owner.account }),
                validatorSetHbbft,
                "Unauthorized",
            );

            await validatorSetHbbft.write.setBlockRewardContract([accounts[4].account.address]);
            await validatorSetHbbft.write.newValidatorSet({ account: accounts[4].account });
        });

        it("should enqueue all initial validators (active pools) if there is no staking", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validatorMiningAddresses = initialValidators.map(validator => validator.miningAddress());

            // Check the returned value of the pending validators; it should be an empty list
            assert.equal((await validatorSetHbbft.read.getPendingValidators()).length, 0);

            // Emulate calling `newValidatorSet()` at the last block of the fixed epoch duration
            await validatorSetHbbft.write.setBlockRewardContract([accounts[4].account.address]);
            await validatorSetHbbft.write.newValidatorSet({ account: accounts[4].account });

            // Check the returned value of the pending validators; it should be an empty list
            assert.equal((await validatorSetHbbft.read.getPendingValidators()).length, 3);
            assert.deepEqual(await validatorSetHbbft.read.getPendingValidators(), validatorMiningAddresses);
        });

        it("should enqueue only one validator which has non-empty pool", async function () {
            const { initialValidators, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];

            // Emulate staking: the first validator stakes into their own pool
            const stakeAmount = parseEther("1");
            await stakingHbbft.write.stake([validator.stakingAddress()], {
                account: validator.staking,
                value: stakeAmount,
            });

            assert.equal(
                await stakingHbbft.read.stakeAmount([validator.stakingAddress(), validator.stakingAddress()]),
                stakeAmount,
            );

            // Emulate calling `newValidatorSet()` at the last block of the fixed epoch duration
            await validatorSetHbbft.write.setBlockRewardContract([accounts[4].account.address]);
            await validatorSetHbbft.write.newValidatorSet({ account: accounts[4].account });

            // Check the returned value of `getPendingValidators()`
            assert.deepEqual(await validatorSetHbbft.read.getPendingValidators(), [validator.miningAddress()]);
        });

        it("should choose validators randomly", async function () {
            const { validatorSetHbbft, stakingHbbft, randomHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validators = new Array<Validator>();
            for (let i = 0; i < 25; ++i) {
                const validator = await Validator.create();
                validators.push(validator);
            }

            const stakeUnit = parseEther("1");

            // Emulate staking by the candidates into their own pool
            for (let i = 0; i < validators.length; i++) {
                const stakeAmount = stakeUnit * BigInt(i + 1);

                await stakingHbbft.write.addPool(
                    [validators[i].miningAddress(), zeroAddress, 0n, validators[i].publicKey(), validators[i].ipAddress],
                    { account: validators[i].staking, value: stakeAmount },
                );

                const stakingAddr = validators[i].stakingAddress();

                assert.equal(await stakingHbbft.read.stakeAmount([stakingAddr, stakingAddr]), stakeAmount);
            }

            // Check pools of the new candidates
            assert.deepEqual(
                await stakingHbbft.read.getPoolsToBeElected(),
                validators.map((x) => x.stakingAddress()),
            );

            const poolsLikelihood = await stakingHbbft.read.getPoolsLikelihood();

            let likelihoodSum = 0n;
            for (let i = 0; i < validators.length; i++) {
                const poolLikelihood = stakeUnit * BigInt(i + 1);

                assert.equal(poolsLikelihood[0][i], poolLikelihood);
                likelihoodSum = likelihoodSum + poolLikelihood;
            }

            assert.equal(poolsLikelihood[1], likelihoodSum);
            assert.equal(await randomHbbft.read.currentSeed(), 0n);

            const seed = random(1000000, 2000000);
            const systemAccount = await impersonateAcc(SystemAccountAddress);

            await randomHbbft.write.setCurrentSeed([seed], { account: systemAccount });
            assert.equal(await randomHbbft.read.currentSeed(), seed);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            // Emulate calling `newValidatorSet()` at the last block of the staking epoch
            await validatorSetHbbft.write.setBlockRewardContract([accounts[4].account.address]);
            await validatorSetHbbft.write.newValidatorSet({ account: accounts[4].account });

            const newValidators = await validatorSetHbbft.read.getPendingValidators();

            assert.equal(await validatorSetHbbft.read.maxValidators(), BigInt(newValidators.length));

            const miningAddresses = validators.map((x) => x.miningAddress());
            for (let i = 0; i < newValidators.length; i++) {
                assert.ok(miningAddresses.indexOf(newValidators[i]) >= 0);
            }
        });
    });

    describe("announceAvailability", async function () {
        it("should revert for non-validator caller", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[20];
            const announceBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.announceAvailability([announceBlock.number, announceBlock.hash], {
                    account: caller.account,
                }),
                validatorSetHbbft,
                "CantAnnounceAvailability",
            );
        });

        it("should revert if validator is already announced availability", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const announceBlock = await publicClient.getBlock();

            await validatorSetHbbft.write.announceAvailability([announceBlock.number, announceBlock.hash], {
                account: validator.mining,
            });

            await helpers.mine(5);
            const reannounceBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.announceAvailability([reannounceBlock.number, reannounceBlock.hash], {
                    account: validator.mining,
                }),
                validatorSetHbbft,
                "CantAnnounceAvailability",
            );
        });

        it("should revert for future block", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const announceBlock = await publicClient.getBlock();

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.announceAvailability([announceBlock.number + 1n, announceBlock.hash], {
                    account: validator.mining,
                }),
                validatorSetHbbft,
                "InvalidAnnounceBlockNumber",
            );
        });

        it("should revert if provided block hash is wrong", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];
            const announceBlock = await publicClient.getBlock();

            await helpers.mine(1);
            const anotherBlockHash = (await publicClient.getBlock()).hash;

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.announceAvailability([announceBlock.number, anotherBlockHash], {
                    account: validator.mining,
                }),
                validatorSetHbbft,
                "InvalidAnnounceBlockHash",
            );
        });

        it("should revert if announce block too old", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const maxBlockAge = 16;

            const validator = initialValidators[0];
            const announceBlock = await publicClient.getBlock();

            await helpers.mine(maxBlockAge + 1);

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.announceAvailability([announceBlock.number, announceBlock.hash], {
                    account: validator.mining,
                }),
                validatorSetHbbft,
                "AnnounceBlockNumberTooOld",
            );
        });

        it("should announce availability and emit event", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];

            assert.equal(await validatorSetHbbft.read.validatorAvailableSince([validator.miningAddress()]), 0n);

            const announceBlock = await publicClient.getBlock();

            const txHash = await validatorSetHbbft.write.announceAvailability(
                [announceBlock.number, announceBlock.hash],
                { account: validator.mining },
            );

            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

            const events = parseEventLogs({
                abi: validatorSetHbbft.abi,
                eventName: "ValidatorAvailable",
                logs: receipt.logs,
            });

            assert.equal(events.length, 1);
            assert.equal(events[0].args.validator, validator.miningAddress());
            assert.equal(events[0].args.timestamp, BigInt(await helpers.time.latest()));
        });
    });

    describe("notifyUnavailability", async function () {
        it("should restrict calling to staking contract", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.notifyUnavailability([initialValidators[1].stakingAddress()], { account: owner.account }),
                validatorSetHbbft,
                "Unauthorized",
            );
        });

        it("should notfiy unavailable by connectivity tracker contract", async function () {
            const { initialValidators, validatorSetHbbft, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

            const caller = await impersonateAcc(connectivityTracker.address);

            const validator = initialValidators[2];
            const validatorMiningAddress = validator.miningAddress();

            const announceBlock = await publicClient.getBlock();
            const announceTxHash = await validatorSetHbbft.write.announceAvailability(
                [announceBlock.number, announceBlock.hash],
                { account: validator.mining },
            );

            const announceReceipt = await publicClient.waitForTransactionReceipt({ hash: announceTxHash });
            const announceTimestamp = (await publicClient.getBlock({ blockHash: announceReceipt.blockHash })).timestamp;

            assert.equal(await validatorSetHbbft.read.validatorAvailableSince([validatorMiningAddress]), announceTimestamp);

            const txHash = await validatorSetHbbft.write.notifyUnavailability([validatorMiningAddress], {
                account: caller,
            });

            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
            const txTimestamp = (await publicClient.getBlock({ blockHash: receipt.blockHash })).timestamp;

            await helpers.stopImpersonatingAccount(caller);

            const events = parseEventLogs({
                abi: validatorSetHbbft.abi,
                eventName: "ValidatorUnavailable",
                logs: receipt.logs,
            });

            assert.equal(events.length, 1);
            assert.equal(events[0].args.validator, validatorMiningAddress);
            assert.equal(events[0].args.timestamp, txTimestamp);

            assert.equal(await validatorSetHbbft.read.validatorAvailableSince([validatorMiningAddress]), 0n);
            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSinceLastWrite([validatorMiningAddress]),
                txTimestamp,
            );
        });

        it("should remove pool from active and to be elected", async function () {
            const { initialValidators, validatorSetHbbft, connectivityTracker, stakingHbbft } =
                await helpers.loadFixture(deployContractsFixture);

            const caller = await impersonateAcc(connectivityTracker.address);

            const poolStaking = initialValidators[2].staking;
            const poolStakingAddress = initialValidators[2].stakingAddress();
            const poolMining = initialValidators[2].mining;
            const poolMiningAddress = initialValidators[2].miningAddress();

            await stakingHbbft.write.stake([poolStakingAddress], {
                account: poolStaking,
                value: await stakingHbbft.read.candidateMinStake(),
            });

            const announceBlock = await publicClient.getBlock();
            await validatorSetHbbft.write.announceAvailability([announceBlock.number, announceBlock.hash], {
                account: poolMining,
            });

            assert.ok((await stakingHbbft.read.getPools()).includes(poolStakingAddress));
            assert.ok((await stakingHbbft.read.getPoolsToBeElected()).includes(poolStakingAddress));
            assert.ok(!(await stakingHbbft.read.getPoolsInactive()).includes(poolStakingAddress));

            await validatorSetHbbft.write.notifyUnavailability([poolMiningAddress], { account: caller });
            await helpers.stopImpersonatingAccount(caller);

            assert.ok(!(await stakingHbbft.read.getPools()).includes(poolStakingAddress));
            assert.ok(!(await stakingHbbft.read.getPoolsToBeElected()).includes(poolStakingAddress));
            assert.ok((await stakingHbbft.read.getPoolsInactive()).includes(poolStakingAddress));
        });
    });

    describe("validator availability tests", async function () {
        it("should set validatorAvailableSince=timestamp and update last write timestamp", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];

            const availableSince = BigInt(await helpers.time.latest()) + 3600n;
            await validatorSetHbbft.write.setValidatorAvailableSince([validator.miningAddress(), availableSince]);

            const expectedLastWriteTimestamp = BigInt(await helpers.time.latest());

            assert.equal(await validatorSetHbbft.read.validatorAvailableSince([validator.miningAddress()]), availableSince);
            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSinceLastWrite([validator.miningAddress()]),
                expectedLastWriteTimestamp,
            );
        });

        it("should set validatorAvailableSince=0 and update last write timestamp", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];

            await validatorSetHbbft.write.setValidatorAvailableSince([validator.miningAddress(), 0n]);

            const expectedLastWriteTimestamp = BigInt(await helpers.time.latest());

            assert.equal(await validatorSetHbbft.read.validatorAvailableSince([validator.miningAddress()]), 0n);
            assert.equal(
                await validatorSetHbbft.read.validatorAvailableSinceLastWrite([validator.miningAddress()]),
                expectedLastWriteTimestamp,
            );
        });

        it("should return false from isValidatorAbandoned for active validator", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[1];
            const staking = validator.stakingAddress();

            const availableSince = BigInt(await helpers.time.latest());

            await validatorSetHbbft.write.setValidatorAvailableSince([validator.miningAddress(), availableSince]);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([staking]), false);

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([staking]), false);
        });

        it("should return true from isValidatorAbandoned for abandoned validator", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[1];
            const staking = validator.stakingAddress()

            await validatorSetHbbft.write.setValidatorAvailableSince([validator.miningAddress(), 0n]);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([staking]), false);

            await helpers.time.increase(validatorInactivityThreshold - 1n);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([staking]), false);

            await helpers.time.increase(1);
            assert.equal(await validatorSetHbbft.read.isValidatorAbandoned([staking]), true);
        });
    });

    describe("handleFailedKeyGeneration", async function () {
        it("should restrict calling to block reward contract", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.handleFailedKeyGeneration({ account: owner.account }),
                validatorSetHbbft,
                "Unauthorized",
            );
        });

        it("should not be called before epoch end", async function () {
            const { validatorSetHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContractsFixture);

            const blockRewardCaller = await impersonateAcc(blockRewardHbbft.address);

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.handleFailedKeyGeneration({ account: blockRewardCaller }),
                validatorSetHbbft,
                "EpochNotYetFinished",
            );

            await helpers.stopImpersonatingAccount(blockRewardCaller);
        });

        it("should immediately return if there is pools to be elected", async function () {
            const {
                validatorSetHbbft,
                blockRewardHbbft,
                stakingHbbft,
                keyGenHistory,
            } = await helpers.loadFixture(deployContractsFixture);

            const stakingEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
            await helpers.time.increaseTo(stakingEpochEndTime + 1n);

            const blockRewardCaller = await impersonateAcc(blockRewardHbbft.address);

            const previousKeyGenRound = await keyGenHistory.read.getCurrentKeyGenRound();

            assert.equal(
                (await stakingHbbft.read.getPoolsToBeElected()).length,
                0,
                "precondition not met: poolsToBeElected must be empty",
            );

            await validatorSetHbbft.write.handleFailedKeyGeneration({ account: blockRewardCaller });

            assert.equal(
                await keyGenHistory.read.getCurrentKeyGenRound(),
                previousKeyGenRound,
                "keygen round should remain the same",
            );

            await helpers.stopImpersonatingAccount(blockRewardCaller);
        });

        it("should immediately return if there is no pending validators", async function () {
            const {
                initialValidators,
                validatorSetHbbft,
                blockRewardHbbft,
                stakingHbbft,
                keyGenHistory,
            } = await helpers.loadFixture(deployContractsFixture);

            const stakingEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
            await helpers.time.increaseTo(stakingEpochEndTime + 1n);

            const blockRewardCaller = await impersonateAcc(blockRewardHbbft.address);

            const pool = initialValidators[0].staking;
            const mining = initialValidators[0].mining;

            const latestBlock = await publicClient.getBlock();
            await validatorSetHbbft.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                account: mining,
            });

            await stakingHbbft.write.stake([getAddress(pool.address)], {
                account: pool,
                value: await stakingHbbft.read.candidateMinStake(),
            });

            assert.ok(
                (await stakingHbbft.read.getPoolsToBeElected()).length > 0,
                "precondition not met: getPoolsToBeElected must not be empty",
            );

            assert.equal(
                (await validatorSetHbbft.read.getPendingValidators()).length,
                0,
                "precondition not met: _pendingValidators must be empty",
            );

            const previousKeyGenRound = await keyGenHistory.read.getCurrentKeyGenRound();

            await validatorSetHbbft.write.handleFailedKeyGeneration({ account: blockRewardCaller });

            assert.equal(
                await keyGenHistory.read.getCurrentKeyGenRound(),
                previousKeyGenRound,
                "keygen round should remain the same",
            );

            await helpers.stopImpersonatingAccount(blockRewardCaller);
        });

        it("should keep existing pending validators when there is no other candidates (w/o network offtime)", async function () {
            const {
                initialValidators,
                validatorSetHbbft,
                blockRewardHbbft,
                stakingHbbft,
                keyGenHistory,
            } = await helpers.loadFixture(deployContractsFixture);

            const networkOffTime = 600n;

            const stakingTransitionTimeframeLength = await stakingHbbft.read.stakingTransitionTimeframeLength();
            const stakingEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
            await helpers.time.increaseTo(stakingEpochEndTime + networkOffTime);

            assert.equal(await stakingHbbft.read.currentKeyGenExtraTimeWindow(), 0n);

            for (let i = 0; i < initialValidators.length; ++i) {
                const pool = initialValidators[i].staking;
                const mining = initialValidators[i].mining;

                const latestBlock = await publicClient.getBlock();
                await validatorSetHbbft.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                    account: mining,
                });

                await stakingHbbft.write.stake([getAddress(pool.address)], {
                    account: pool,
                    value: await stakingHbbft.read.candidateMinStake(),
                });

                await validatorSetHbbft.write.addPendingValidator([getAddress(mining.address)]);
            }

            const validatorMiningAddresses = initialValidators.map(validator => validator.miningAddress());

            assert.ok(
                (await stakingHbbft.read.getPoolsToBeElected()).length > 0,
                "precondition not met: getPoolsToBeElected must not be empty",
            );

            assert.deepEqual(await validatorSetHbbft.read.getPendingValidators(), validatorMiningAddresses);

            const previousKeyGenRound = await keyGenHistory.read.getCurrentKeyGenRound();

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await keyGenHistory.write.clearPrevKeyGenState([validatorMiningAddresses], { account: validatorSetCaller });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            const blockRewardCaller = await impersonateAcc(blockRewardHbbft.address);

            await validatorSetHbbft.write.handleFailedKeyGeneration({ account: blockRewardCaller });

            await helpers.stopImpersonatingAccount(blockRewardCaller);

            assert.equal(
                await keyGenHistory.read.getCurrentKeyGenRound(),
                previousKeyGenRound + 1n,
                "keygen round counter should be increased",
            );

            assert.deepEqual(await validatorSetHbbft.read.getPendingValidators(), validatorMiningAddresses);

            assert.equal(await stakingHbbft.read.currentKeyGenExtraTimeWindow(), stakingTransitionTimeframeLength);
        });

        it("should select new pending validators when there are other candidates (with network offtime)", async function () {
            const {
                initialValidators,
                validatorSetHbbft,
                blockRewardHbbft,
                stakingHbbft,
                keyGenHistory,
            } = await helpers.loadFixture(deployContractsFixture);

            const stakingTransitionTimeframeLength = await stakingHbbft.read.stakingTransitionTimeframeLength();
            const stakingEpochEndTime = await stakingHbbft.read.stakingFixedEpochEndTime();
            await helpers.time.increaseTo(stakingEpochEndTime + 600n + stakingTransitionTimeframeLength);

            for (let i = 0; i < initialValidators.length; ++i) {
                const pool = initialValidators[i].staking;
                const mining = initialValidators[i].mining;

                await stakingHbbft.write.stake([getAddress(pool.address)], {
                    account: pool,
                    value: await stakingHbbft.read.candidateMinStake(),
                });

                const latestBlock = await publicClient.getBlock();
                await validatorSetHbbft.write.announceAvailability([latestBlock.number, latestBlock.hash], {
                    account: mining,
                });

                await validatorSetHbbft.write.addPendingValidator([getAddress(mining.address)]);
            }

            const newValidator = await Validator.create();

            await stakingHbbft.write.addPool(
                [newValidator.miningAddress(), zeroAddress, 0n, newValidator.publicKey(), newValidator.ipAddress],
                { account: newValidator.staking, value: await stakingHbbft.read.candidateMinStake() },
            );

            const lastBlock = await publicClient.getBlock();
            await validatorSetHbbft.write.announceAvailability([lastBlock.number, lastBlock.hash], {
                account: newValidator.mining,
            });

            assert.ok(
                (await stakingHbbft.read.getPoolsToBeElected()).length > 0,
                "precondition not met: getPoolsToBeElected must not be empty",
            );

            const validatorMiningAddresses = initialValidators.map(validator => validator.miningAddress());

            assert.deepEqual(await validatorSetHbbft.read.getPendingValidators(), validatorMiningAddresses);

            const previousKeyGenRound = await keyGenHistory.read.getCurrentKeyGenRound();

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await keyGenHistory.write.clearPrevKeyGenState([validatorMiningAddresses], { account: validatorSetCaller });
            await helpers.stopImpersonatingAccount(validatorSetCaller);

            const blockRewardCaller = await impersonateAcc(blockRewardHbbft.address);

            await validatorSetHbbft.write.handleFailedKeyGeneration({ account: blockRewardCaller });

            const networkOffTime =
                (await publicClient.getBlock()).timestamp - stakingEpochEndTime - stakingTransitionTimeframeLength;

            await helpers.stopImpersonatingAccount(blockRewardCaller);

            assert.equal(
                await keyGenHistory.read.getCurrentKeyGenRound(),
                previousKeyGenRound + 1n,
                "keygen round counter should be increased",
            );

            assert.deepEqual(await validatorSetHbbft.read.getPendingValidators(), [newValidator.miningAddress()]);
            assert.equal(
                await stakingHbbft.read.currentKeyGenExtraTimeWindow(),
                networkOffTime + stakingTransitionTimeframeLength * 2n,
                "keygen extra time window should also include network offtime",
            );
        });
    });

    describe("finalizeChange", async function () {
        it("should restrict calling to block reward contract", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.write.finalizeChange({ account: owner.account }),
                validatorSetHbbft,
                "Unauthorized",
            );
        });

        it("should be callable by block reward address", async function () {
            const { validatorSetHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContractsFixture);

            const blockRewardCaller = await impersonateAcc(blockRewardHbbft.address);
            await validatorSetHbbft.write.finalizeChange({ account: blockRewardCaller });

            await helpers.stopImpersonatingAccount(blockRewardCaller);
        });

        it("should save current validators as previous after change", async function () {
            const { initialValidators, validatorSetHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContractsFixture);

            const newValidatorMining = initialValidators[0].miningAddress();
            const previousValidatorMiningAddresses = initialValidators.map(validator => validator.miningAddress());

            await validatorSetHbbft.write.addPendingValidator([newValidatorMining]);

            const blockRewardCaller = await impersonateAcc(blockRewardHbbft.address);
            await validatorSetHbbft.write.finalizeChange({ account: blockRewardCaller });
            await helpers.stopImpersonatingAccount(blockRewardCaller);

            assert.deepEqual(await validatorSetHbbft.read.getPreviousValidators(), previousValidatorMiningAddresses);
            assert.deepEqual(await validatorSetHbbft.read.getValidators(), [newValidatorMining]);
            assert.equal((await validatorSetHbbft.read.getPendingValidators()).length, 0);
        });
    });

    describe("getPendingValidatorKeyGenerationMode", async function () {
        async function clearPrevKeyGenState(
            validators: Validator[],
            validatorSetHbbft: ValidatorSetHbbftMock,
            keyGenHistory: KeyGenHistory,
        ) {
            const validatorMiningAddresses = validators.map(validator => validator.miningAddress());

            const validatorSetCaller = await impersonateAcc(validatorSetHbbft.address);
            await keyGenHistory.write.clearPrevKeyGenState([validatorMiningAddresses], { account: validatorSetCaller });
            await helpers.stopImpersonatingAccount(validatorSetCaller);
        }

        it("should return correct mode for non-pending validator", async function () {
            const { initialValidators, validatorSetHbbft, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);

            await clearPrevKeyGenState(initialValidators, validatorSetHbbft, keyGenHistory);

            const validator = initialValidators[0];
            assert.equal(
                await validatorSetHbbft.read.getPendingValidatorKeyGenerationMode([validator.miningAddress()]),
                KeyGenMode.NotAPendingValidator,
            );
        });

        it("should return correct mode for pending validator", async function () {
            const { initialValidators, validatorSetHbbft, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);

            await clearPrevKeyGenState(initialValidators, validatorSetHbbft, keyGenHistory);

            const validator = initialValidators[0];
            await validatorSetHbbft.write.addPendingValidator([validator.miningAddress()]);

            assert.equal(
                await validatorSetHbbft.read.getPendingValidatorKeyGenerationMode([validator.miningAddress()]),
                KeyGenMode.WritePart,
            );
        });

        it("should return correct mode if parts written and waiting others", async function () {
            const {
                initialValidators,
                validatorSetHbbft,
                stakingHbbft,
                keyGenHistory,
            } = await helpers.loadFixture(deployContractsFixture);

            await clearPrevKeyGenState(initialValidators, validatorSetHbbft, keyGenHistory);

            for (const validator of initialValidators) {
                await validatorSetHbbft.write.addPendingValidator([validator.miningAddress()]);
            }

            const currentEpoch = await stakingHbbft.read.stakingEpoch();
            const currentRound = await keyGenHistory.read.getCurrentKeyGenRound();
            const validator = initialValidators[0];

            const { parts } = getTestPartNAcks();

            await keyGenHistory.write.writePart([currentEpoch + 1n, currentRound, parts[0]], {
                account: validator.mining,
            });

            assert.equal(
                await validatorSetHbbft.read.getPendingValidatorKeyGenerationMode([validator.miningAddress()]),
                KeyGenMode.WaitForOtherParts,
            );
        });

        it("should return correct mode if all parts written", async function () {
            const {
                initialValidators,
                validatorSetHbbft,
                stakingHbbft,
                keyGenHistory,
            } = await helpers.loadFixture(deployContractsFixture);

            await clearPrevKeyGenState(initialValidators, validatorSetHbbft, keyGenHistory);

            const validator = initialValidators[0];
            const currentEpoch = await stakingHbbft.read.stakingEpoch();
            const currentRound = await keyGenHistory.read.getCurrentKeyGenRound();

            const { parts } = getTestPartNAcks();

            await validatorSetHbbft.write.addPendingValidator([validator.miningAddress()]);

            await keyGenHistory.write.writePart([currentEpoch + 1n, currentRound, parts[0]], {
                account: validator.mining,
            });

            assert.equal(
                await validatorSetHbbft.read.getPendingValidatorKeyGenerationMode([validator.miningAddress()]),
                KeyGenMode.WriteAck,
            );
        });

        it("should return correct mode if ack written and waiting others", async function () {
            const {
                initialValidators,
                validatorSetHbbft,
                stakingHbbft,
                keyGenHistory,
            } = await helpers.loadFixture(deployContractsFixture);

            await clearPrevKeyGenState(initialValidators, validatorSetHbbft, keyGenHistory);

            for (const validator of initialValidators) {
                await validatorSetHbbft.write.addPendingValidator([validator.miningAddress()]);
            }

            const currentEpoch = await stakingHbbft.read.stakingEpoch();
            const currentRound = await keyGenHistory.read.getCurrentKeyGenRound();

            const { parts, acks } = getTestPartNAcks();

            for (let i = 0; i < initialValidators.length; ++i) {
                await keyGenHistory.write.writePart([currentEpoch + 1n, currentRound, parts[i]], {
                    account: initialValidators[i].mining,
                });
            }

            await keyGenHistory.write.writeAcks([currentEpoch + 1n, currentRound, acks[0]], {
                account: initialValidators[0].mining,
            });

            assert.equal(
                await validatorSetHbbft.read.getPendingValidatorKeyGenerationMode([initialValidators[0].miningAddress()]),
                KeyGenMode.WaitForOtherAcks,
            );
        });

        it("should return correct mode when all keys done", async function () {
            const {
                initialValidators,
                validatorSetHbbft,
                stakingHbbft,
                keyGenHistory,
            } = await helpers.loadFixture(deployContractsFixture);

            await clearPrevKeyGenState(initialValidators, validatorSetHbbft, keyGenHistory);

            for (const validator of initialValidators) {
                await validatorSetHbbft.write.addPendingValidator([validator.miningAddress()]);
            }

            const currentEpoch = await stakingHbbft.read.stakingEpoch();
            const currentRound = await keyGenHistory.read.getCurrentKeyGenRound();

            const { parts, acks } = getTestPartNAcks();

            for (let i = 0; i < initialValidators.length; ++i) {
                await keyGenHistory.write.writePart([currentEpoch + 1n, currentRound, parts[i]], {
                    account: initialValidators[i].mining,
                });
            }

            for (let i = 0; i < initialValidators.length; ++i) {
                await keyGenHistory.write.writeAcks([currentEpoch + 1n, currentRound, acks[0]], {
                    account: initialValidators[i].mining,
                });
            }

            assert.equal(
                await validatorSetHbbft.read.getPendingValidatorKeyGenerationMode([initialValidators[0].miningAddress()]),
                KeyGenMode.AllKeysDone,
            );
        });
    });

    describe("getPublicKey", async function () {
        it("should get public key by mining address", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);
            const validator = initialValidators[2];

            assert.equal(
                await validatorSetHbbft.read.getPublicKey([validator.miningAddress()]),
                validator.publicKey(),
            );
        });

        it("should get public key by staking address", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);
            const validator = initialValidators[2];

            assert.equal(
                await validatorSetHbbft.read.publicKeyByStakingAddress([validator.stakingAddress()]),
                validator.publicKey(),
            );
        });
    });

    describe("isValidatorOrPending", async function () {
        it("should return true for current validator", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];

            assert.equal(await validatorSetHbbft.read.isValidatorOrPending([validator.miningAddress()]), true);
        });

        it("should return true for pending validator", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = createRandomWallet().address;
            await validatorSetHbbft.write.addPendingValidator([validator]);

            assert.equal(await validatorSetHbbft.read.isValidatorOrPending([validator]), true);
        });

        it("should return false for other validators", async function () {
            const { validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = await Validator.create();

            await stakingHbbft.write.addPool(
                [validator.miningAddress(), zeroAddress, 0n, validator.publicKey(), validator.ipAddress],
                { account: validator.staking, value: await stakingHbbft.read.candidateMinStake() },
            );

            const lastBlock = await publicClient.getBlock();
            await validatorSetHbbft.write.announceAvailability([lastBlock.number, lastBlock.hash], {
                account: validator.mining,
            });

            assert.equal(await validatorSetHbbft.read.isValidatorOrPending([validator.miningAddress()]), false);
        });
    });

    describe("isPendingValidator", async function () {
        it("should return true for pending validator", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[1];
            await validatorSetHbbft.write.addPendingValidator([validator.miningAddress()]);

            assert.equal(await validatorSetHbbft.read.isPendingValidator([validator.miningAddress()]), true);
        });

        it("should return false for unknown validator", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = createRandomWallet().address;

            assert.equal(await validatorSetHbbft.read.isPendingValidator([validator]), false);
        });

        it("should return false for current validator", async function () {
            const { initialValidators, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[1];

            assert.equal(await validatorSetHbbft.read.isPendingValidator([validator.miningAddress()]), false);
        });
    });

    describe("getCurrentValidatorsCount", async function () {
        it("should get current validators count", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const currentValidators = await validatorSetHbbft.read.getValidators();

            assert.equal(await validatorSetHbbft.read.getCurrentValidatorsCount(), BigInt(currentValidators.length));
        });
    });

    describe("_getRandomIndex", async function () {
        it("should return an adjusted index for defined inputs", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const likelihood = [100n, 200n, 300n, 400n, 500n, 600n, 700n];
            const likelihoodSum = likelihood.reduce((accumulator, currentValue) => accumulator + currentValue, 0n);

            const randomNumbers = [
                "102295698372522486450340395642197401505767984240419462599162533279732332782651",
                "88025212233336166694158733213902358522896299602970367772879732461395027846748",
                "3523742620359620556816465264713466573401040793358132246666974190393877305106",
                "114287137201841041676259866712650409340573048931079410295991941812580890362241",
                "56538372295469756217105752313834104791610579310176881601739166767736723828094",
                "68894736484717464620468052267132544577303666765971723802696502263332160676293",
                "2687897135972768982863977619384943065126168850144103674632415860805119241205",
                "24156724137176021809787734003047081984697808114992466341401603861146655392651",
                "25832498784249909278064625550198896956883678749506959657822549797979716953904",
                "83427681337508775305223983109488324606217343189389013271254642438269351755393",
                "89240493523877502173991078619437290376114395569336992401719662797476983687349",
                "32853052436845401068458327441561229850088309385635363390209017592145381901382",
                "92757373761302092632106569748694156597982600321652929951701742642022538783264",
                "67100691778885672569176318615234924603932468421815258024949536088416049543990",
                "39719159917163831412538990465342603972769478329347733852265531421865718849185",
                "11999966582708588347446743916419096256885726657832588083780562629766444127924",
                "3010033826674280221348240369209662207451628800231593904185251036266265501228",
                "104413946901985991618369747356151891708096310010480784960228664399399331870677",
                "46702964557713889464151228598162726133335720586871289696077799307058716500554",
                "33559859380160476336881942583444222658690349088979267802639562440185523997062",
                "88164666426323367273712257076795707964138351637743196085165838265474516578736",
                "65103249564951811056118667152373579848051986877071782497698315108889906670108",
                "72821055933320812937250747090735048382600804178995301517010109398983401788049",
                "99208478519263809245343193866271416846250644213811563487317845411846195381743",
                "43244103797891865076724512787658122057625989128787310921522570707520428148373",
                "52593213271200799069017680398601742889781965771702477275560701649706236275690",
                "108328978994570005091822140894920607469753367145808907051759972778893235527605",
                "106243412807859477512275680165822018408062239633748780895951018757528890023894",
                "100523913914531030393977247260355055750370476166866773273692522317156719075854",
                "77022898496333694502068353640750783584648231690398908206984568236564244491382",
                "41979375344302562213493428021758696472517069655026004024762400804791650208434",
                "43628854778068621724043940318620457362856035361685143045720331752230463022095",
                "82285705897178482139228255154026207979788495615016066666460634531254361700322",
                "103033773949537101659963963063505003708388612890360333986921649759562312839480",
                "90770865318369187790230484859485855456585867208388117002983261502339419006204",
                "26815346888796872071397186407189158071870764013785636988299203117345299034401",
                "109773710075222485244630344395494360152079130725134468924787713882051145672746",
                "39403951878453528586564883635284384469843277424612617097230872271502436953145",
                "39389791094920594224321489203186955206743847893381281919090308687926471241472",
                "93046390131440905160726040276266392159114510166775585212343442741436904797202",
                "54170062802343058895719474837092940503100946361183675631561437940603180035660",
                "47885497876255822026761249333701662294944183779830405146054765546172721805412",
                "85784108075793984715971258928372040611210416723184976507035355612383079708374",
                "975231504725199172058136797192737545453371688771241516140759234478419802859",
                "11221695937635509523634019528204860046172097301950632766664824992008610905586",
                "107436738580825641164015325500403818249158286517547805162070908854567423888257",
                "95131259382133028521920698684605162235171126887687165345810768990116888018363",
                "32093301002413573589394148587673090493082958864884746627245068789892859808298",
                "88877363243051860109462313934196367092545400665058685614791669873785662729846",
                "93303263974274844888269460050007671790319652816365815159843581987373074921653",
                "2838589525588108250288537685649588904049605284200358625857231445075798244256",
                "103440835631677484504289133413857661716343392137124352829588867199056428014608",
                "14834897586325978641677634740309984613791219233942292334268919899179999089427",
                "90592739484283286958273216485369225962659619600146792320515852466657598765134",
                "90009074497738073685802439049113289828004402439066889514902444182938602209126",
                "85446725415529547155742409866805383130577708568559028346751611699611011965692",
                "65338189934805816499720020632343445443773750636821931638972192112064593536084",
                "68894736484717464620468052267132544577303666765971723802696502263332160676293",
                "97038415570065070631636413689846636057583460394114803408406438433553572855219",
                "37174481483698717274508692458943206319646761313668452904666599193190263829226",
                "83293654371769887530231273428029838254071141275752836966434884009154334272471",
                "61550675608757547480427728231220369062183692943133553616606393063245090570238",
                "106310422063868805710005503758389364559077338757562463680315994157927102319153",
                "92316372422720713132834387635796571697148072536922335291921606080588893618074",
                "38851776122105484438816516456270700216579032737823857667223570744638236996564",
                "91931610975789749530771289631457740460089882038525235577892199819123862300768",
                "12584022001269166953738601736475241704543867143251821698991913500991013184565",
                "93838766957989869741843637162267026686800430761690851182846725406625910762822",
                "37527235859951512630084295239070248050772227070293275276310077413880965859648",
                "10029852584219766552202521629257119585310608286735288902896374319246007520547",
                "100531592418921996440959660218081004075084077325762235445092461282455443776592",
                "70360301780279317294526696738122950206853248320606760459000212639207738599755",
                "42615335097200622363427787014986340987435795544127844838513465698022325549070",
                "97179166642841831901710211011434773821974291088367923187565757087014715556023",
                "35700707592987123768295375654492959504360595047325542190366022889869127210877",
                "61466192968763487567230878115575886253903086088440811010550926385451886494782",
                "21081112160100882571933565571444206767966165752831043953100274757688624040309",
                "43600512080977603081232319401589971747578355235034101951568657558733599985311",
                "93046390131440905160726040276266392159114510166775585212343442741436904797202",
                "78166256786997532299895132208906760280082009588209678686600716400062852428405",
                "13222897386810906888619556934369590110383618401108006840064914837471049962790",
                "1578602856830276566247637536764056525646602601434018088262687436606906368471",
                "71251492413200829753765707207416712328940017555460320629775672005788805406038",
                "49473946423701235119114128891150684565057594399210078568622426111576160796776",
                "2795241924893775962338639421462660396880272895841450532860602370352763967428",
                "1368176909817681289535734912268540340083367565311628960255594700153503166951",
                "102261823055652808807641282805776330377598366626091044675628029769297795448573",
                "98333942429624994334088114537313280633768758375747170937650280702106049631163",
                "101084934713827664963652249459825932313523258148511708462071053005419555774093",
                "100436038107430274336090680869036994691021844216896199595301884506738559689882",
                "21029750837416702025158549833474322060763342167147939813379699113300579329884",
                "41747798356210327951828864606739475704670278732672411923226952550562810994269",
                "48797956882581040238328998452706637312526017192747728857965049344578930185689",
                "84075528317472161332110783338824603002333331699958015220146204384887016317460",
                "109137764198542875397010922573213806461038404637611535658969502477953977062158",
                "80035044963460208738839148866504952156311667250384896327472835098317653499856",
                "17617865953480899987668249746368539050669466120508322054265245207241748794585",
                "85801402425178001324027499648440415057772242639989974198794870373495420146359",
                "54552824519765246569647140014258846853726582476686673581485232345599309803850",
                "50071681440615794591592854304870967989140492470769568917917087979516067576429",
            ];

            const sampleIndexes = [
                3, 6, 6, 2, 2, 6, 1, 4, 5, 3, 3, 6, 2, 6, 0, 2, 6, 3, 6, 0, 2, 3, 5, 6, 5, 4, 4, 5, 4, 6, 6, 4, 6, 2, 5,
                4, 3, 3, 3, 5, 5, 4, 3, 0, 6, 2, 3, 6, 6, 2, 4, 2, 6, 6, 0, 5, 6, 6, 6, 6, 6, 4, 6, 4, 5, 2, 6, 5, 3, 5,
                3, 6, 3, 6, 2, 1, 5, 4, 5, 5, 5, 1, 4, 6, 6, 6, 3, 4, 1, 3, 5, 4, 4, 4, 6, 4, 4, 2, 5, 6,
            ];

            const results = new Array<number>();
            for (let i = 0; i < randomNumbers.length; i++) {
                const index = await validatorSetHbbft.read.getRandomIndex([
                    likelihood,
                    likelihoodSum,
                    BigInt(randomNumbers[i]),
                ]);

                results.push(Number(index));
            }

            assert.deepEqual(results, sampleIndexes);
        });

        it("should always return an index within the input array size", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            for (let i = 0; i < 100; i++) {
                const size = Number(random(19, 100));

                const likelihood = new Array<bigint>();
                let likelihoodSum = 0n;
                for (let j = 0; j < size; j++) {
                    const randomLikelihood = random(100, 1000);
                    likelihood.push(randomLikelihood);
                    likelihoodSum += randomLikelihood;
                }

                let currentSize = size;
                let randomNumber = random(0, Number.MAX_SAFE_INTEGER);

                for (let j = 0; j < size; j++) {
                    const index = await validatorSetHbbft.read.getRandomIndex([
                        likelihood,
                        likelihoodSum,
                        randomNumber,
                    ]);

                    assert.ok(index < BigInt(currentSize));

                    likelihoodSum -= likelihood[Number(index)];
                    likelihood[Number(index)] = likelihood[currentSize - 1];
                    currentSize--;

                    randomNumber = BigInt(sha256(encodePacked(["uint256"], [randomNumber])));
                }
            }
        });

        it("should return indexes according to given likelihood", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const repeats = 2000;
            const maxFluctuation = 2; // percents, +/-

            const stakeAmounts = [
                170000n, // 17%
                130000n, // 13%
                10000n, // 1%
                210000n, // 21%
                90000n, // 9%
                60000n, // 6%
                0n, // 0%
                100000n, // 10%
                40000n, // 4%
                140000n, // 14%
                30000n, // 3%
                0n, // 0%
                20000n, // 2%
            ];

            const stakeAmountsTotal = stakeAmounts.reduce((accumulator, value) => accumulator + value);
            const stakeAmountsExpectedShares = stakeAmounts.map((value) =>
                Math.round(Number(value * 100n) / Number(stakeAmountsTotal)),
            );
            const indexesStats = stakeAmounts.map(() => 0);

            for (let i = 0; i < repeats; i++) {
                const index = await validatorSetHbbft.read.getRandomIndex([
                    stakeAmounts,
                    stakeAmountsTotal,
                    random(0, Number.MAX_SAFE_INTEGER),
                ]);

                indexesStats[Number(index)]++;
            }

            const stakeAmountsRandomShares = indexesStats.map((value) => Math.round((value / repeats) * 100));

            stakeAmountsRandomShares.forEach((value, index) => {
                if (stakeAmountsExpectedShares[index] == 0) {
                    assert.equal(value, 0);
                } else {
                    assert.ok(Math.abs(stakeAmountsExpectedShares[index] - value) <= maxFluctuation);
                }
            });
        });
    });

    describe("getValidatorCountSweetSpot", async function () {
        it("should revert for possible validator count = 0", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await hhViem.assertions.revertWithCustomError(
                validatorSetHbbft.read.getValidatorCountSweetSpot([0n]),
                validatorSetHbbft,
                "InvalidPossibleValidatorCount",
            );
        });

        it("should correctly calculate hbbft sweet spots", async function () {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const expectedResults = [
                1n, 2n, 3n,
                4n, 4n, 4n,
                7n, 7n, 7n,
                10n, 10n, 10n,
                13n, 13n, 13n,
                16n, 16n, 16n,
                19n, 19n, 19n,
                22n, 22n, 22n,
                25n,
            ];

            for (let i = 0; i < expectedResults.length; i++) {
                const expected = expectedResults[i];
                const result = await validatorSetHbbft.read.getValidatorCountSweetSpot([BigInt(i + 1)]);

                assert.equal(result, expected);
            }
        });
    });
});

function convertToBigEndian(number: number): Uint8Array {
    const byte1 = number & 0xff;
    const byte2 = (number >> 8) & 0xff;
    return new Uint8Array([byte2, byte1]);
}

interface InternetAddress {
    ipAddress: Uint8Array;
    port: bigint;
}

async function getValidatorInternetAddress(stakingHbbft: StakingHbbftMock, pool: Address): Promise<InternetAddress> {
    const [ip, port] = await stakingHbbft.read.getPoolInternetAddress([pool]);

    return {
        ipAddress: hexToBytes(ip),
        port: BigInt(port),
    };
}

async function setValidatorInternetAddress(
    validatorSetPermission: Permission<ValidatorSetHbbftMock>,
    miner: Account,
    ipAddress: Uint8Array,
    port: number,
): Promise<Hex> {
    if (port > 65535) {
        throw new Error("Port number is too big");
    }

    // transform the Port number into a 2 bytes little endian number Array.
    const portArray = convertToBigEndian(port);
    return validatorSetPermission.callFunction("setValidatorInternetAddress", miner, [
        toHex(ipAddress),
        toHex(portArray),
    ]);
}
