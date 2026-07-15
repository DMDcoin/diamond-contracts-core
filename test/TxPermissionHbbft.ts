import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import {
    encodeAbiParameters,
    encodeFunctionData,
    getAddress,
    keccak256,
    parseEther,
    parseGwei,
    stringToBytes,
    toFunctionSelector,
    zeroAddress,
    zeroHash,
    type Address,
    type Hex,
} from "viem";

import { getTestPartNAcks } from "./fixtures/data.js";
import { deployProxy } from "./fixtures/proxy.js";
import { KeyGenMode, AllowedTxTypeMask } from "./fixtures/types.js";
import { splitPublicKeys } from "./fixtures/utils.js";
import { createRandomWallet } from "./fixtures/wallet.js";
import { ZeroIpAddress, Validator } from "./fixtures/validator.js";

const { viem: hhViem, networkHelpers: helpers } = await hre.network.getOrCreate();

const publicClient = await hhViem.getPublicClient();
type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

const EmptyBytes: Hex = "0x";
const validatorInactivityThreshold = 365n * 86400n; // 1 year
const minReportAgeBlocks = 10n;

const contractName = "TX_PERMISSION_CONTRACT";
const contractNameHash = keccak256(stringToBytes(contractName));
const contractVersion = 3n;

describe("TxPermissionHbbft", () => {
    let owner: TestWalletClient;
    let accounts: TestWalletClient[];

    let allowedSenders: Address[];
    let stubAddress: Address;

    before(async () => {
        [owner, ...accounts] = await hhViem.getWalletClients();

        allowedSenders = [
            owner.account.address,
            accounts[0].account.address,
            accounts[1].account.address,
        ];

        stubAddress = createRandomWallet().address;
    });

    async function deployContractsFixture() {
        const initialValidators = new Array<Validator>();
        for (let i = 0; i < 3; ++i) {
            const validator = await Validator.create();
            initialValidators.push(validator);
        }

        const initialMiningAddresses = initialValidators.map((validator) => validator.miningAddress());
        const initialStakingAddresses = initialValidators.map((validator) => validator.stakingAddress());
        const initialValidatorsIpAddresses = Array(initialStakingAddresses.length).fill(ZeroIpAddress);

        const initialValidatorsPubKeys = splitPublicKeys(
            initialValidators.map((validator) => validator.publicKey()),
        );

        const { parts, acks } = getTestPartNAcks();

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
                validatorSetParams,      // _params
                initialMiningAddresses,  // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ],
            initializer: "initialize",
        });

        const stakingParams = {
            _validatorSetContract: validatorSetHbbft.address,
            _bonusScoreContract: bonusScoreContractMock.address,
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: parseEther("1"),
            _candidateMinStake: parseEther("1"),
            _maxStake: parseEther("100000"),
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

        const keyGenHistory = await deployProxy(hhViem, "KeyGenHistory", {
            initArgs: [
                owner.account.address,
                validatorSetHbbft.address,
                initialMiningAddresses,
                parts,
                acks,
            ],
            initializer: "initialize",
        });

        const certifier = await deployProxy(hhViem, "CertifierHbbft", {
            initArgs: [[owner.account.address], validatorSetHbbft.address, owner.account.address],
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
                minReportAgeBlocks,
            ],
            initializer: "initialize",
        });

        const txPermission = await deployProxy(hhViem, "TxPermissionHbbftMock", {
            initArgs: [
                allowedSenders,
                certifier.address,
                validatorSetHbbft.address,
                keyGenHistory.address,
                connectivityTracker.address,
                owner.account.address,
            ],
            initializer: "initialize",
        });

        await blockRewardHbbft.write.setConnectivityTracker([connectivityTracker.address]);
        await validatorSetHbbft.write.setKeyGenHistoryContract([keyGenHistory.address]);
        await validatorSetHbbft.write.setStakingContract([stakingHbbft.address]);
        await validatorSetHbbft.write.setConnectivityTracker([connectivityTracker.address]);

        return {
            initialValidators,
            txPermission,
            validatorSetHbbft,
            certifier,
            keyGenHistory,
            stakingHbbft,
            connectivityTracker,
        };
    }

    async function deployMocks() {
        const mockStaking = await hhViem.deployContract("MockStaking");
        const mockValidatorSet = await hhViem.deployContract("MockValidatorSet");

        await mockValidatorSet.write.setStakingContract([mockStaking.address]);

        return { mockValidatorSet, mockStaking };
    }

    describe("deployment", async () => {
        it("should deploy and initialize contract", async function () {
            const certifierAddress = createRandomWallet().address;
            const validatorSetAddress = createRandomWallet().address;
            const keyGenHistoryAddress = createRandomWallet().address;
            const connectivityTrackerAddress = createRandomWallet().address;

            const txPermission = await deployProxy(hhViem, "TxPermissionHbbftMock", {
                initArgs: [
                    allowedSenders,
                    certifierAddress,
                    validatorSetAddress,
                    keyGenHistoryAddress,
                    connectivityTrackerAddress,
                    owner.account.address,
                ],
                initializer: "initialize",
            });

            assert.equal(await txPermission.read.certifierContract(), certifierAddress);
            assert.equal(await txPermission.read.keyGenHistoryContract(), keyGenHistoryAddress);
            assert.equal(await txPermission.read.validatorSetContract(), validatorSetAddress);
            assert.equal(await txPermission.read.connectivityTracker(), connectivityTrackerAddress);
            assert.equal(await txPermission.read.owner(), getAddress(owner.account.address));

            assert.deepEqual(
                await txPermission.read.allowedSenders(),
                allowedSenders.map((addr) => getAddress(addr)),
            );
        });

        it("should revert initialization with CertifierHbbft = address(0)", async () => {
            const implementation = await hhViem.deployContract("TxPermissionHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "TxPermissionHbbftMock", {
                    initArgs: [allowedSenders, zeroAddress, stubAddress, stubAddress, stubAddress, owner.account.address],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert initialization with ValidatorSet = address(0)", async () => {
            const implementation = await hhViem.deployContract("TxPermissionHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "TxPermissionHbbftMock", {
                    initArgs: [allowedSenders, stubAddress, zeroAddress, stubAddress, stubAddress, owner.account.address],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert initialization with KeyGenHistory = address(0)", async () => {
            const implementation = await hhViem.deployContract("TxPermissionHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "TxPermissionHbbftMock", {
                    initArgs: [allowedSenders, stubAddress, stubAddress, zeroAddress, stubAddress, owner.account.address],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert initialization with ConnectivityTracker = address(0)", async () => {
            const implementation = await hhViem.deployContract("TxPermissionHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "TxPermissionHbbftMock", {
                    initArgs: [allowedSenders, stubAddress, stubAddress, stubAddress, zeroAddress, owner.account.address],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert initialization with owner = address(0)", async () => {
            const implementation = await hhViem.deployContract("TxPermissionHbbftMock");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "TxPermissionHbbftMock", {
                    initArgs: [allowedSenders, stubAddress, stubAddress, stubAddress, stubAddress, zeroAddress],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should not allow initialization if initialized contract", async () => {
            const contract = await deployProxy(hhViem, "TxPermissionHbbftMock", {
                initArgs: [allowedSenders, stubAddress, stubAddress, stubAddress, stubAddress, owner.account.address],
                initializer: "initialize",
            });

            await hhViem.assertions.revertWithCustomError(
                contract.write.initialize([
                    allowedSenders,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    owner.account.address,
                ]),
                contract,
                "InvalidInitialization",
            );
        });
    });

    describe("contract functions", async function () {
        it("should get contract name", async function () {
            const { txPermission } = await helpers.loadFixture(deployContractsFixture);

            assert.equal(await txPermission.read.contractName(), contractName);
        });

        it("should get contract name hash", async function () {
            const { txPermission } = await helpers.loadFixture(deployContractsFixture);

            assert.equal(await txPermission.read.contractNameHash(), contractNameHash);
        });

        it("should get contract version", async function () {
            const { txPermission } = await helpers.loadFixture(deployContractsFixture);

            assert.equal(await txPermission.read.contractVersion(), contractVersion);
        });

        it("should revert when accessing data out of bounds", async function () {
            const { txPermission } = await helpers.loadFixture(deployContractsFixture);

            const smallData: Hex = `0x${"00".repeat(10)}`;

            await hhViem.assertions.revertWithCustomError(
                txPermission.read.testGetSliceUInt256([30n, smallData]),
                txPermission,
                "ReadOutOfBounds",
            );
        });

        describe("addAllowedSender()", async function () {
            it("should restrict calling addAllowedSender to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const caller = accounts[1];

                await hhViem.assertions.revertWithCustomErrorWithArgs(
                    txPermission.write.addAllowedSender([caller.account.address], { account: caller.account }),
                    txPermission,
                    "OwnableUnauthorizedAccount",
                    [caller.account.address],
                );
            });

            it("should revert if sender address is 0", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                await hhViem.assertions.revertWithCustomError(
                    txPermission.write.addAllowedSender([zeroAddress], { account: owner.account }),
                    txPermission,
                    "ZeroAddress",
                );
            });

            it("should add allowed sender", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10].account.address;

                assert.equal(await txPermission.read.isSenderAllowed([sender]), false);

                await hhViem.assertions.emitWithArgs(
                    txPermission.write.addAllowedSender([sender], { account: owner.account }),
                    txPermission,
                    "AddAllowedSender",
                    [sender],
                );

                assert.equal(await txPermission.read.isSenderAllowed([sender]), true);
                assert.ok((await txPermission.read.allowedSenders()).includes(getAddress(sender)));
            });

            it("should revert adding same address twice", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10].account.address;

                assert.equal(await txPermission.read.isSenderAllowed([sender]), false);

                await txPermission.write.addAllowedSender([sender], { account: owner.account });

                assert.equal(await txPermission.read.isSenderAllowed([sender]), true);

                await hhViem.assertions.revertWithCustomErrorWithArgs(
                    txPermission.write.addAllowedSender([sender], { account: owner.account }),
                    txPermission,
                    "AlreadyExist",
                    [sender],
                );
            });
        });

        describe("removeAllowedSender()", async function () {
            it("should restrict calling removeAllowedSender to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const caller = accounts[1];

                await hhViem.assertions.revertWithCustomErrorWithArgs(
                    txPermission.write.removeAllowedSender([caller.account.address], { account: caller.account }),
                    txPermission,
                    "OwnableUnauthorizedAccount",
                    [caller.account.address],
                );
            });

            it("should revert for non-existing sender", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[11].account.address;

                await hhViem.assertions.revertWithCustomErrorWithArgs(
                    txPermission.write.removeAllowedSender([sender], { account: owner.account }),
                    txPermission,
                    "NotExist",
                    [sender],
                );
            });

            it("should remove sender", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[11].account.address;

                await txPermission.write.addAllowedSender([sender], { account: owner.account });

                assert.equal(await txPermission.read.isSenderAllowed([sender]), true);
                assert.ok((await txPermission.read.allowedSenders()).includes(getAddress(sender)));

                await hhViem.assertions.emitWithArgs(
                    txPermission.write.removeAllowedSender([sender], { account: owner.account }),
                    txPermission,
                    "RemoveAllowedSender",
                    [sender],
                );

                assert.equal(await txPermission.read.isSenderAllowed([sender]), false);
                assert.ok(!(await txPermission.read.allowedSenders()).includes(getAddress(sender)));
            });
        });

        describe("setMinimumGasPrice()", async function () {
            it("should restrict calling setMinimumGasPrice to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const caller = accounts[1];

                await hhViem.assertions.revertWithCustomErrorWithArgs(
                    txPermission.write.setMinimumGasPrice([1n], { account: caller.account }),
                    txPermission,
                    "OwnableUnauthorizedAccount",
                    [caller.account.address],
                );
            });

            it("should not allow to set minimum gas price 0", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                await hhViem.assertions.revertWithCustomError(
                    txPermission.write.setMinimumGasPrice([0n], { account: owner.account }),
                    txPermission,
                    "NewValueOutOfRange",
                );
            });

            it("should set minimum gas price", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const minGasPrice = parseGwei("0.8");

                await hhViem.assertions.emitWithArgs(
                    txPermission.write.setMinimumGasPrice([minGasPrice], { account: owner.account }),
                    txPermission,
                    "SetMinimumGasPrice",
                    [minGasPrice],
                );

                assert.equal(await txPermission.read.minimumGasPrice(), minGasPrice);
            });

            it("should set allowed minimum gas price value range", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const funcSelector = toFunctionSelector("setMinimumGasPrice(uint256)");
                const allowedRange = (await txPermission.read.getAllowedParamsRangeWithSelector([funcSelector])).range;

                const expectedRange = [
                    parseGwei("0.1"),
                    parseGwei("0.2"),
                    parseGwei("0.4"),
                    parseGwei("0.6"),
                    parseGwei("0.8"),
                    parseGwei("1"),
                    parseGwei("2"),
                    parseGwei("4"),
                    parseGwei("6"),
                    parseGwei("8"),
                    parseGwei("10"),
                    parseGwei("15"),
                    parseGwei("20"),
                    parseGwei("30"),
                    parseGwei("40"),
                    parseGwei("50"),
                ];

                assert.deepEqual(allowedRange, expectedRange);
            });

            it("should set minimumGasPrice to 50 gwei in V2", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const defaultGasPrice = parseGwei("1");
                assert.equal(await txPermission.read.minimumGasPrice(), defaultGasPrice);

                await txPermission.write.initializeV2();

                const expectedGasPrice = parseGwei("50");
                assert.equal(await txPermission.read.minimumGasPrice(), expectedGasPrice);
            });
        });

        describe("setBlockGasLimit()", async function () {
            it("should restrict calling setBlockGasLimit to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const caller = accounts[1];

                await hhViem.assertions.revertWithCustomErrorWithArgs(
                    txPermission.write.setBlockGasLimit([1n], { account: caller.account }),
                    txPermission,
                    "OwnableUnauthorizedAccount",
                    [caller.account.address],
                );
            });

            it("should not allow to set block gas limit less than 100_000", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const blockGasLimit = 10_000n;

                await hhViem.assertions.revertWithCustomError(
                    txPermission.write.setBlockGasLimit([blockGasLimit], { account: owner.account }),
                    txPermission,
                    "NewValueOutOfRange",
                );
            });

            it("should set block gas limit", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const blockGasLimit = 200_000_000n;

                await hhViem.assertions.emitWithArgs(
                    txPermission.write.setBlockGasLimit([blockGasLimit], { account: owner.account }),
                    txPermission,
                    "SetBlockGasLimit",
                    [blockGasLimit],
                );

                assert.equal(await txPermission.read.blockGasLimit(), blockGasLimit);
            });
        });

        describe("allowedTxTypes()", async function () {
            it("should allow all transaction types for allowed sender", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10].account.address;

                await txPermission.write.addAllowedSender([sender], { account: owner.account });
                assert.equal(await txPermission.read.isSenderAllowed([sender]), true);

                const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                    sender,
                    zeroAddress,
                    0n,
                    1n,
                    EmptyBytes,
                ]);

                assert.equal(typesMask, AllowedTxTypeMask.All);
                assert.equal(cache, false);
            });

            it("should not allow zero gas price transactions for uncertified senders", async function () {
                const { txPermission, certifier } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10].account.address;

                assert.equal(await certifier.read.certified([sender]), false);

                const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                    sender,
                    zeroAddress,
                    0n,
                    0n,
                    EmptyBytes,
                ]);

                assert.equal(typesMask, AllowedTxTypeMask.None);
                assert.equal(cache, false);
            });

            it("should allow zero gas price transactions for certified senders", async function () {
                const { txPermission, certifier } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10].account.address;

                assert.equal(await certifier.read.certified([sender]), false);
                await certifier.write.certify([sender], { account: owner.account });
                assert.equal(await certifier.read.certified([sender]), true);

                const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                    sender,
                    zeroAddress,
                    0n,
                    0n,
                    EmptyBytes,
                ]);

                assert.equal(typesMask, AllowedTxTypeMask.All);
                assert.equal(cache, false);
            });

            it("should not allow usual transaction with gas price less than minimumGasPrice", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10].account.address;
                const minGasPrice = parseGwei("0.8");

                await txPermission.write.setMinimumGasPrice([minGasPrice], { account: owner.account });
                assert.equal(await txPermission.read.minimumGasPrice(), minGasPrice);

                const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                    sender,
                    zeroAddress,
                    0n,
                    minGasPrice / 2n,
                    EmptyBytes,
                ]);

                assert.equal(typesMask, AllowedTxTypeMask.None);
                assert.equal(cache, false);
            });

            it("should allow usual transaction with sufficient gas price", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10].account.address;
                const minGasPrice = parseGwei("0.8");

                await txPermission.write.setMinimumGasPrice([minGasPrice], { account: owner.account });
                assert.equal(await txPermission.read.minimumGasPrice(), minGasPrice);

                const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                    sender,
                    zeroAddress,
                    0n,
                    minGasPrice,
                    EmptyBytes,
                ]);

                assert.equal(typesMask, AllowedTxTypeMask.All);
                assert.equal(cache, false);
            });

            it("should not allow transactions to mining addresses", async function () {
                const { initialValidators, txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10].account.address;
                const gasPrice = await txPermission.read.minimumGasPrice();

                for (const validator of initialValidators) {
                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        sender,
                        validator.miningAddress(),
                        0n,
                        gasPrice,
                        EmptyBytes,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                }
            });

            it("should allow basic transactions from mining addresses with sufficient gas price", async function () {
                const { initialValidators, txPermission } = await helpers.loadFixture(deployContractsFixture);

                const gasPrice = await txPermission.read.minimumGasPrice();

                for (const validator of initialValidators) {
                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        validator.miningAddress(),
                        zeroAddress,
                        0n,
                        gasPrice,
                        EmptyBytes,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.Basic);
                    assert.equal(cache, false);
                }
            });

            it("should not allow transactions from mining addresses with zero balance", async function () {
                const { initialValidators, txPermission } = await helpers.loadFixture(deployContractsFixture);

                const gasPrice = await txPermission.read.minimumGasPrice();

                for (const validator of initialValidators) {
                    await helpers.setBalance(validator.miningAddress(), 0n);

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        validator.miningAddress(),
                        zeroAddress,
                        0n,
                        gasPrice,
                        EmptyBytes,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                }
            });

            describe("calls to ValidatorSet contract", async function () {
                const ipAddress: Hex = "0x11111111111111111111111111111111";
                const port: Hex = "0xbeef";

                it("should allow announce availability by known unvailable validator", async function () {
                    const {
                        initialValidators,
                        txPermission,
                        validatorSetHbbft,
                    } = await helpers.loadFixture(deployContractsFixture);

                    await validatorSetHbbft.write.setValidatorAvailableSince([initialValidators[0].miningAddress(), 0n]);

                    const gasPrice = await txPermission.read.minimumGasPrice();
                    const latestBlock = await publicClient.getBlock();

                    const calldata = encodeFunctionData({
                        abi: validatorSetHbbft.abi,
                        functionName: "announceAvailability",
                        args: [latestBlock.number, latestBlock.hash],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        initialValidators[0].miningAddress(),
                        validatorSetHbbft.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.Call);
                    assert.equal(cache, false);
                });

                it("should not allow announce availability by unknown validator", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();
                    const latestBlock = await publicClient.getBlock();

                    const calldata = encodeFunctionData({
                        abi: validatorSetHbbft.abi,
                        functionName: "announceAvailability",
                        args: [latestBlock.number, latestBlock.hash],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        accounts[8].account.address,
                        validatorSetHbbft.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should allow to set validator ip address for active staking pool", async function () {
                    const { initialValidators, txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();

                    const calldata = encodeFunctionData({
                        abi: validatorSetHbbft.abi,
                        functionName: "setValidatorInternetAddress",
                        args: [ipAddress, port],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        initialValidators[1].miningAddress(),
                        validatorSetHbbft.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.Call);
                    assert.equal(cache, false);
                });

                it("should not allow to set validator ip address for inactive staking pool", async function () {
                    const {
                        initialValidators,
                        txPermission,
                        validatorSetHbbft,
                        stakingHbbft,
                    } = await helpers.loadFixture(deployContractsFixture);

                    await stakingHbbft.write.setValidatorSetAddress([owner.account.address]);
                    await stakingHbbft.write.removePool([initialValidators[0].stakingAddress()]);
                    await stakingHbbft.write.setValidatorSetAddress([validatorSetHbbft.address]);

                    const gasPrice = await txPermission.read.minimumGasPrice();

                    const calldata = encodeFunctionData({
                        abi: validatorSetHbbft.abi,
                        functionName: "setValidatorInternetAddress",
                        args: [ipAddress, port],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        initialValidators[0].miningAddress(),
                        validatorSetHbbft.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should not allow to set validator ip address for non existing validator", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();

                    const calldata = encodeFunctionData({
                        abi: validatorSetHbbft.abi,
                        functionName: "setValidatorInternetAddress",
                        args: [ipAddress, port],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        accounts[8].account.address,
                        validatorSetHbbft.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should not allow other methods calls by validators with non-zero gas price", async function () {
                    const { initialValidators, txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();

                    const calldata = encodeFunctionData({
                        abi: validatorSetHbbft.abi,
                        functionName: "newValidatorSet",
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        initialValidators[0].miningAddress(),
                        validatorSetHbbft.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should allow other methods calls by non-validators with non-zero gas price", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();

                    const calldata = encodeFunctionData({
                        abi: validatorSetHbbft.abi,
                        functionName: "newValidatorSet",
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        accounts[8].account.address,
                        validatorSetHbbft.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.Call);
                    assert.equal(cache, false);
                });

                it("should use default validation for other methods calls with zero gas price", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const sender = accounts[11].account.address;

                    const calldata = encodeFunctionData({
                        abi: validatorSetHbbft.abi,
                        functionName: "newValidatorSet",
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        sender,
                        validatorSetHbbft.address,
                        0n,
                        0n,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });
            });

            describe("calls to KeyGenHistory contract", async function () {
                it("should not allow writePart transactions outside of write part time", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "writePart",
                        args: [0n, 0n, EmptyBytes],
                    });

                    const caller = accounts[8].account.address;

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        0n,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should not allow writePart transaction with data size < 36", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet } = await deployMocks();

                    await txPermission.write.setValidatorSetContract([mockValidatorSet.address]);
                    await mockValidatorSet.write.setKeyGenMode([KeyGenMode.WritePart]);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "writePart",
                        args: [0n, 0n, EmptyBytes],
                    });

                    const slicedCalldata = calldata.slice(0, 10) as Hex;
                    const caller = accounts[8].account.address;

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        0n,
                        slicedCalldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should not allow writePart transaction with wrong epoch number", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10n;

                    await txPermission.write.setValidatorSetContract([mockValidatorSet.address]);
                    await mockValidatorSet.write.setKeyGenMode([KeyGenMode.WritePart]);
                    await mockStaking.write.setStakingEpoch([epoch]);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "writePart",
                        args: [epoch - 1n, 0n, EmptyBytes],
                    });

                    const caller = accounts[8].account.address;

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        0n,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should allow writePart transaction", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10n;

                    await txPermission.write.setValidatorSetContract([mockValidatorSet.address]);
                    await mockValidatorSet.write.setKeyGenMode([KeyGenMode.WritePart]);
                    await mockStaking.write.setStakingEpoch([epoch]);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "writePart",
                        args: [epoch + 1n, 0n, EmptyBytes],
                    });

                    const caller = accounts[8].account.address;

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        0n,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.Call);
                    assert.equal(cache, false);
                });

                it("should not allow writeAcks transactions outside of write acks time", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "writeAcks",
                        args: [0n, 0n, [EmptyBytes]],
                    });

                    const caller = accounts[8].account.address;

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        0n,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should not allow writeAck transaction with data size < 36", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet } = await deployMocks();

                    await txPermission.write.setValidatorSetContract([mockValidatorSet.address]);
                    await mockValidatorSet.write.setKeyGenMode([KeyGenMode.WriteAck]);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "writeAcks",
                        args: [0n, 0n, [EmptyBytes]],
                    });

                    const slicedCalldata = calldata.slice(0, 10) as Hex;
                    const caller = accounts[8].account.address;

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        0n,
                        slicedCalldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should not allow writeAck transaction with incorrect epoch and round", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10n;

                    await txPermission.write.setValidatorSetContract([mockValidatorSet.address]);
                    await mockValidatorSet.write.setKeyGenMode([KeyGenMode.WriteAck]);
                    await mockStaking.write.setStakingEpoch([epoch]);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "writeAcks",
                        args: [epoch - 1n, epoch - 2n, [EmptyBytes]],
                    });

                    const caller = accounts[8].account.address;

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        0n,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should allow writeAck transaction with correct epoch", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10n;

                    await txPermission.write.setValidatorSetContract([mockValidatorSet.address]);
                    await mockValidatorSet.write.setKeyGenMode([KeyGenMode.WriteAck]);
                    await mockStaking.write.setStakingEpoch([epoch]);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "writeAcks",
                        args: [epoch + 1n, 0n, [EmptyBytes]],
                    });

                    const caller = accounts[8].account.address;

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        0n,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.Call);
                    assert.equal(cache, false);
                });

                it("should allow writeAck transaction with correct round", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10n;

                    await txPermission.write.setValidatorSetContract([mockValidatorSet.address]);
                    await mockValidatorSet.write.setKeyGenMode([KeyGenMode.WriteAck]);
                    await mockStaking.write.setStakingEpoch([epoch]);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "writeAcks",
                        args: [epoch - 1n, epoch + 1n, [EmptyBytes]],
                    });

                    const caller = accounts[8].account.address;

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        0n,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.Call);
                    assert.equal(cache, false);
                });

                it("should use default validation for other methods calls", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10n;

                    await txPermission.write.setValidatorSetContract([mockValidatorSet.address]);
                    await mockValidatorSet.write.setKeyGenMode([KeyGenMode.WriteAck]);
                    await mockStaking.write.setStakingEpoch([epoch]);

                    const calldata = encodeFunctionData({
                        abi: keyGenHistory.abi,
                        functionName: "clearPrevKeyGenState",
                        args: [[]],
                    });

                    const caller = accounts[8].account.address;
                    const gasPrice = await txPermission.read.minimumGasPrice();

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        keyGenHistory.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.All);
                    assert.equal(cache, false);
                });
            });

            describe("calls to ConnectivityTracker contract", async function () {
                it("should allow reportMissingConnectivity if callable", async function () {
                    const { initialValidators, txPermission, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();
                    const reporter = initialValidators[0].miningAddress();

                    await helpers.mine(minReportAgeBlocks + 1n);

                    const latestBlockNum = await helpers.time.latestBlock();
                    const block = await publicClient.getBlock({ blockNumber: BigInt(latestBlockNum - 1) });

                    const calldata = encodeFunctionData({
                        abi: connectivityTracker.abi,
                        functionName: "reportMissingConnectivity",
                        args: [initialValidators[1].miningAddress(), block.number, block.hash],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        reporter,
                        connectivityTracker.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.Call);
                    assert.equal(cache, false);
                });

                it("should not allow reportMissingConnectivity if not callable", async function () {
                    const { initialValidators, txPermission, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();
                    const reporter = initialValidators[0];

                    await helpers.mine(minReportAgeBlocks + 1n);

                    const latestBlockNum = await helpers.time.latestBlock();
                    const block = await publicClient.getBlock({ blockNumber: BigInt(latestBlockNum - 1) });

                    const calldata = encodeFunctionData({
                        abi: connectivityTracker.abi,
                        functionName: "reportMissingConnectivity",
                        args: [initialValidators[1].miningAddress(), block.number, zeroHash],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        reporter.miningAddress(),
                        connectivityTracker.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should allow reportReconnect if callable", async function () {
                    const { initialValidators, txPermission, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();
                    const reporter = initialValidators[0];
                    const validator = initialValidators[1];

                    await helpers.mine(minReportAgeBlocks + 1n);

                    let latestBlockNum = await helpers.time.latestBlock();
                    let block = await publicClient.getBlock({ blockNumber: BigInt(latestBlockNum - 1) });

                    await connectivityTracker.write.reportMissingConnectivity(
                        [validator.miningAddress(), block.number, block.hash],
                        { account: reporter.mining },
                    );

                    latestBlockNum = await helpers.time.latestBlock();
                    block = await publicClient.getBlock({ blockNumber: BigInt(latestBlockNum - 1) });

                    const calldata = encodeFunctionData({
                        abi: connectivityTracker.abi,
                        functionName: "reportReconnect",
                        args: [validator.miningAddress(), block.number, block.hash],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        reporter.miningAddress(),
                        connectivityTracker.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.Call);
                    assert.equal(cache, false);
                });

                it("should not allow reportReconnect if not callable", async function () {
                    const { initialValidators, txPermission, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();
                    const reporter = initialValidators[0];

                    await helpers.mine(minReportAgeBlocks + 1n);

                    const latestBlockNum = await helpers.time.latestBlock();
                    const block = await publicClient.getBlock({ blockNumber: BigInt(latestBlockNum - 1) });

                    const calldata = encodeFunctionData({
                        abi: connectivityTracker.abi,
                        functionName: "reportReconnect",
                        args: [initialValidators[1].miningAddress(), block.number, zeroHash],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        reporter.miningAddress(),
                        connectivityTracker.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });

                it("should use default validation for other methods calls", async function () {
                    const { txPermission, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10n;

                    const gasPrice = await txPermission.read.minimumGasPrice();
                    const caller = accounts[10].account.address;

                    await txPermission.write.setValidatorSetContract([mockValidatorSet.address]);
                    await mockValidatorSet.write.setKeyGenMode([KeyGenMode.WriteAck]);
                    await mockStaking.write.setStakingEpoch([epoch]);

                    const calldata = encodeFunctionData({
                        abi: connectivityTracker.abi,
                        functionName: "penaliseFaultyValidators",
                        args: [epoch],
                    });

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        caller,
                        connectivityTracker.address,
                        0n,
                        gasPrice,
                        calldata,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.All);
                    assert.equal(cache, false);
                });

                it("should skip unknown params in calldata", async function () {
                    const {
                        initialValidators,
                        txPermission,
                        connectivityTracker,
                    } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.read.minimumGasPrice();
                    const reporter = initialValidators[0];

                    await helpers.mine(minReportAgeBlocks + 1n);

                    const latestBlockNum = await helpers.time.latestBlock();
                    const block = await publicClient.getBlock({ blockNumber: BigInt(latestBlockNum - 1) });

                    const calldata = encodeFunctionData({
                        abi: connectivityTracker.abi,
                        functionName: "reportReconnect",
                        args: [initialValidators[1].miningAddress(), block.number, zeroHash],
                    });

                    const additionalArg = encodeAbiParameters([{ type: "address" }], [reporter.miningAddress()]);

                    const [typesMask, cache] = await txPermission.read.allowedTxTypes([
                        reporter.miningAddress(),
                        connectivityTracker.address,
                        0n,
                        gasPrice,
                        (calldata + additionalArg.slice(2)) as Hex,
                    ]);

                    assert.equal(typesMask, AllowedTxTypeMask.None);
                    assert.equal(cache, false);
                });
            });
        });
    });
});
