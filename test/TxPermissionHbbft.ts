import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import {
    CertifierHbbft,
    KeyGenHistory,
    StakingHbbftMock,
    TxPermissionHbbftMock,
    ValidatorSetHbbftMock,
    ConnectivityTrackerHbbft
} from "../src/types";

import { getTestPartNAcks } from './testhelpers/data';

const EmptyBytes = ethers.hexlify(new Uint8Array());
const validatorInactivityThreshold = BigInt(365 * 86400); // 1 year
const minReportAgeBlocks = 10n;

const contractName = "TX_PERMISSION_CONTRACT";
const contractNameHash = ethers.keccak256(ethers.toUtf8Bytes(contractName));
const contractVersion = 3;

enum AllowedTxTypeMask {
    None = 0x00,
    Basic = 0x01,
    Call = 0x02,
    Create = 0x04,
    Private = 0x08,
    All = 0xffffffff
};

enum KeyGenMode {
    NotAPendingValidator,
    WritePart,
    WaitForOtherParts,
    WriteAck,
    WaitForOtherAcks,
    AllKeysDone
}

describe('TxPermissionHbbft', () => {
    let owner: HardhatEthersSigner;
    let accounts: HardhatEthersSigner[];

    let allowedSenders: string[];
    let accountAddresses: string[];

    let initialValidators: string[];
    let initialStakingAddresses: string[];

    async function deployContractsFixture() {
        const stubAddress = accountAddresses[0];

        const { parts, acks } = getTestPartNAcks();

        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbftProxy = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                stubAddress,                   // _blockRewardContract
                stubAddress,                   // _randomContract
                stubAddress,                   // _stakingContract
                stubAddress,                   // _keyGenHistoryContract
                validatorInactivityThreshold,  // _validatorInactivityThreshold
                initialValidators,             // _initialMiningAddresses
                initialStakingAddresses,       // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        );

        await validatorSetHbbftProxy.waitForDeployment();

        let stakingParams = {
            _validatorSetContract: await validatorSetHbbftProxy.getAddress(),
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: ethers.parseEther('1'),
            _candidateMinStake: ethers.parseEther('1'),
            _maxStake: ethers.parseEther('100000'),
            _stakingFixedEpochDuration: 86400n,
            _stakingTransitionTimeframeLength: 3600n,
            _stakingWithdrawDisallowPeriod: 1n
        };

        let initialValidatorsPubKeys: string[] = [];
        let initialValidatorsIpAddresses: string[] = [];

        for (let i = 0; i < initialStakingAddresses.length; i++) {
            initialValidatorsPubKeys.push(ethers.Wallet.createRandom().signingKey.publicKey);
            initialValidatorsIpAddresses.push(ethers.zeroPadBytes("0x00", 16));
        }

        let initialValidatorsPubKeysSplit = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            (initialValidatorsPubKeys);

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        //Deploy StakingHbbft contract
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

        const CertifierFactory = await ethers.getContractFactory("CertifierHbbft");
        const certifierProxy = await upgrades.deployProxy(
            CertifierFactory,
            [
                [owner.address],
                await validatorSetHbbftProxy.getAddress(),
                owner.address
            ],
            { initializer: 'initialize' }
        );

        await certifierProxy.waitForDeployment();

        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        const blockRewardHbbftProxy = await upgrades.deployProxy(
            BlockRewardHbbftFactory,
            [
                owner.address,
                await validatorSetHbbftProxy.getAddress(),
                stubAddress
            ],
            { initializer: 'initialize' }
        );

        await blockRewardHbbftProxy.waitForDeployment();

        const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
        const connectivityTrackerProxy = await upgrades.deployProxy(
            ConnectivityTrackerFactory,
            [
                owner.address,
                await validatorSetHbbftProxy.getAddress(),
                await stakingHbbftProxy.getAddress(),
                await blockRewardHbbftProxy.getAddress(),
                minReportAgeBlocks,
            ],
            { initializer: 'initialize' }
        );

        await connectivityTrackerProxy.waitForDeployment();

        const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbftMock");
        const txPermissionProxy = await upgrades.deployProxy(
            TxPermissionFactory,
            [
                allowedSenders,
                await certifierProxy.getAddress(),
                await validatorSetHbbftProxy.getAddress(),
                await keyGenHistoryProxy.getAddress(),
                await connectivityTrackerProxy.getAddress(),
                owner.address
            ],
            { initializer: 'initialize' }
        );

        await txPermissionProxy.waitForDeployment();

        const txPermission = TxPermissionFactory.attach(await txPermissionProxy.getAddress()) as TxPermissionHbbftMock;
        const keyGenHistory = KeyGenFactory.attach(await keyGenHistoryProxy.getAddress()) as KeyGenHistory;
        const certifier = CertifierFactory.attach(await certifierProxy.getAddress()) as CertifierHbbft;

        const validatorSetHbbft = ValidatorSetFactory.attach(
            await validatorSetHbbftProxy.getAddress()
        ) as ValidatorSetHbbftMock;

        const stakingHbbft = StakingHbbftFactory.attach(
            await stakingHbbftProxy.getAddress()
        ) as StakingHbbftMock;

        const connectivityTracker = ConnectivityTrackerFactory.attach(
            await connectivityTrackerProxy.getAddress()
        ) as ConnectivityTrackerHbbft;

        await blockRewardHbbftProxy.setConnectivityTracker(await connectivityTrackerProxy.getAddress());
        await validatorSetHbbftProxy.setKeyGenHistoryContract(await keyGenHistoryProxy.getAddress());
        await validatorSetHbbftProxy.setStakingContract(await stakingHbbftProxy.getAddress());

        return { txPermission, validatorSetHbbft, certifier, keyGenHistory, stakingHbbft, connectivityTracker };
    }

    before(async () => {
        [owner, ...accounts] = await ethers.getSigners();
        accountAddresses = accounts.map(item => item.address);

        allowedSenders = [owner.address, accountAddresses[15], accountAddresses[16]];

        initialValidators = accountAddresses.slice(1, 4); // accounts[1...3]
        initialStakingAddresses = accountAddresses.slice(4, 7); // accounts[4...6]
    });

    describe('deployment', async () => {
        it("should deploy and initialize contract", async function () {
            const certifierAddress = accountAddresses[0];
            const validatorSetAddress = accountAddresses[1];
            const keyGenHistoryAddress = accountAddresses[2];
            const connectivityTrackerAddress = accountAddresses[3];

            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbftMock");
            const txPermission = await upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    certifierAddress,
                    validatorSetAddress,
                    keyGenHistoryAddress,
                    connectivityTrackerAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            );

            await txPermission.waitForDeployment();

            expect(await txPermission.certifierContract()).to.equal(certifierAddress);
            expect(await txPermission.keyGenHistoryContract()).to.equal(keyGenHistoryAddress);
            expect(await txPermission.validatorSetContract()).to.equal(validatorSetAddress);
            expect(await txPermission.connectivityTracker()).to.equal(connectivityTrackerAddress);
            expect(await txPermission.owner()).to.equal(owner.address);

            expect(await txPermission.allowedSenders()).to.deep.equal(allowedSenders);
        });

        it("should revert initialization with CertifierHbbft = address(0)", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbftMock");
            const stubAddress = accountAddresses[0];

            await expect(upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    ethers.ZeroAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Certifier address must not be 0');
        });

        it("should revert initialization with ValidatorSet = address(0)", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbftMock");
            const stubAddress = accountAddresses[0];

            await expect(upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    stubAddress,
                    ethers.ZeroAddress,
                    stubAddress,
                    stubAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('ValidatorSet address must not be 0');
        });

        it("should revert initialization with KeyGenHistory = address(0)", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbftMock");
            const stubAddress = accountAddresses[0];

            await expect(upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    stubAddress,
                    stubAddress,
                    ethers.ZeroAddress,
                    stubAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('KeyGenHistory address must not be 0');
        });

        it("should revert initialization with ConnectivityTracker = address(0)", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbftMock");
            const stubAddress = accountAddresses[0];

            await expect(upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    ethers.ZeroAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('ConnectivityTracker address must not be 0');
        });

        it("should revert initialization with owner = address(0)", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbftMock");
            const stubAddress = accountAddresses[0];

            await expect(upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    ethers.ZeroAddress,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Owner address must not be 0');
        });

        it("should not allow initialization if initialized contract", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbftMock");
            const stubAddress = accountAddresses[0];

            const contract = await upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            );

            await contract.waitForDeployment();

            await expect(contract.initialize(
                allowedSenders,
                stubAddress,
                stubAddress,
                stubAddress,
                stubAddress,
                owner.address
            )).to.be.revertedWith('Initializable: contract is already initialized');
        });
    });

    describe('contract functions', async function () {
        it("should get contract name", async function () {
            const { txPermission } = await helpers.loadFixture(deployContractsFixture);

            expect(await txPermission.contractName()).to.equal(contractName);
        });

        it("should get contract name hash", async function () {
            const { txPermission } = await helpers.loadFixture(deployContractsFixture);

            expect(await txPermission.contractNameHash()).to.equal(contractNameHash);
        });

        it("should get contract version", async function () {
            const { txPermission } = await helpers.loadFixture(deployContractsFixture);

            expect(await txPermission.contractVersion()).to.equal(contractVersion);
        });

        describe('addAllowedSender()', async function () {
            it("should restrict calling addAllowedSender to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const caller = accounts[1];

                await expect(
                    txPermission.connect(caller).addAllowedSender(caller.address)
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should revert if sender address is 0", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                await expect(
                    txPermission.connect(owner).addAllowedSender(ethers.ZeroAddress)
                ).to.be.reverted;
            });

            it("should add allowed sender", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10];

                expect(await txPermission.isSenderAllowed(sender.address)).to.be.false;
                expect(await txPermission.connect(owner).addAllowedSender(sender.address));
                expect(await txPermission.isSenderAllowed(sender.address)).to.be.true;

                expect(await txPermission.allowedSenders()).to.contain(sender.address);
            });

            it("should revert adding same address twice", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10];

                expect(await txPermission.isSenderAllowed(sender.address)).to.be.false;
                expect(await txPermission.connect(owner).addAllowedSender(sender.address));
                expect(await txPermission.isSenderAllowed(sender.address)).to.be.true;

                await expect(
                    txPermission.connect(owner).addAllowedSender(sender.address)
                ).to.be.rejected;
            });
        });

        describe('removeAllowedSender()', async function () {
            it("should restrict calling removeAllowedSender to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const caller = accounts[1];

                await expect(
                    txPermission.connect(caller).removeAllowedSender(caller.address)
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should revert calling if sender already removed", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[11];

                // expect(await txPermission.isSenderAllowed(sender.address)).to.be.false;
                // expect(await txPermission.connect(owner).addAllowedSender(sender.address));
                // expect(await txPermission.isSenderAllowed(sender.address)).to.be.true;

                await expect(
                    txPermission.connect(owner).removeAllowedSender(sender.address)
                ).to.be.reverted;
            });

            it("should remove sender", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[11];

                expect(await txPermission.connect(owner).addAllowedSender(sender.address));
                expect(await txPermission.isSenderAllowed(sender.address)).to.be.true;
                expect(await txPermission.allowedSenders()).to.contain(sender.address);

                expect(await txPermission.connect(owner).removeAllowedSender(sender.address));

                expect(await txPermission.isSenderAllowed(sender.address)).to.be.false;
                expect(await txPermission.allowedSenders()).to.not.contain(sender.address);
            });
        });

        describe('setMinimumGasPrice()', async function () {
            it("should restrict calling setMinimumGasPrice to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const caller = accounts[1];

                await expect(txPermission.connect(caller).setMinimumGasPrice(1)).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should not allow to set minimum gas price 0", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                await expect(
                    txPermission.connect(owner).setMinimumGasPrice(0)
                ).to.be.revertedWith('new value not within allowed range');
            });

            it("should set minimum gas price", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const minGasPrice = ethers.utils.parseUnits('0.8', 'gwei');
                await expect(
                    txPermission.connect(owner).setMinimumGasPrice(minGasPrice)
                ).to.emit(txPermission, "gasPriceChanged")
                    .withArgs(minGasPrice);

                expect(await txPermission.minimumGasPrice()).to.equal(minGasPrice);
            });
        });

        describe('setBlockGasLimit()', async function () {
            it("should restrict calling setBlockGasLimit to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const caller = accounts[1];

                await expect(txPermission.connect(caller).setBlockGasLimit(1)).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should not allow to set block gas limit less than 100_000", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const blockGasLimit = 10_000;

                await expect(
                    txPermission.connect(owner).setBlockGasLimit(blockGasLimit)
                ).to.be.revertedWith('new value not within allowed range');
            });

            it("should set block gas limit", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const blockGasLimit = 200_000;

                expect(await txPermission.connect(owner).setBlockGasLimit(blockGasLimit));

                expect(await txPermission.blockGasLimit()).to.equal(blockGasLimit);
            });
        });

        describe('allowedTxTypes()', async function () {
            it("should allow all transaction types for allowed sender", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10];

                expect(await txPermission.connect(owner).addAllowedSender(sender.address));
                expect(await txPermission.isSenderAllowed(sender.address)).to.be.true;

                const result = await txPermission.allowedTxTypes(
                    sender.address,
                    ethers.ZeroAddress,
                    0n,
                    1n,
                    EmptyBytes,
                );

                expect(result.typesMask).to.equal(AllowedTxTypeMask.All);
                expect(result.cache).to.be.false;
            });

            it("should not allow zero gas price transactions for uncertified senders", async function () {
                const { txPermission, certifier } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10];

                expect(await certifier.certified(sender.address)).to.be.false;

                const result = await txPermission.allowedTxTypes(
                    sender.address,
                    ethers.ZeroAddress,
                    0n,
                    0n,
                    EmptyBytes,
                );

                expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                expect(result.cache).to.be.false;
            });

            it("should allow zero gas price transactions for certified senders", async function () {
                const { txPermission, certifier } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10];

                expect(await certifier.certified(sender.address)).to.be.false;
                await certifier.connect(owner).certify(sender.address);
                expect(await certifier.certified(sender.address)).to.be.true;

                const result = await txPermission.allowedTxTypes(
                    sender.address,
                    ethers.ZeroAddress,
                    0,
                    0,
                    EmptyBytes,
                );

                expect(result.typesMask).to.equal(AllowedTxTypeMask.All);
                expect(result.cache).to.be.false;
            });

            it("should not allow usual transaction with gas price less than minimumGasPrice", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10];
                const minGasPrice = ethers.utils.parseUnits('0.8', 'gwei');

                await txPermission.connect(owner).setMinimumGasPrice(minGasPrice);
                expect(await txPermission.minimumGasPrice()).to.equal(minGasPrice);

                const result = await txPermission.allowedTxTypes(
                    sender.address,
                    ethers.ZeroAddress,
                    0,
                    Number(minGasPrice) / 2,
                    '0x00',
                );

                expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                expect(result.cache).to.be.false;
            });

            it("should allow usual transaction with sufficient gas price", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10];
                const minGasPrice = ethers.utils.parseUnits('0.8', 'gwei');

                await txPermission.connect(owner).setMinimumGasPrice(minGasPrice);
                expect(await txPermission.minimumGasPrice()).to.equal(minGasPrice);

                const result = await txPermission.allowedTxTypes(
                    sender.address,
                    ethers.ZeroAddress,
                    0,
                    minGasPrice,
                    EmptyBytes,
                );

                expect(result.typesMask).to.equal(AllowedTxTypeMask.All);
                expect(result.cache).to.be.false;
            });

            it("should not allow transactions to mining addresses", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const sender = accounts[10];
                const gasPrice = await txPermission.minimumGasPrice();

                for (let validator of initialValidators) {
                    const result = await txPermission.allowedTxTypes(
                        sender.address,
                        validator,
                        0,
                        gasPrice,
                        EmptyBytes,
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                }
            });

            it("should allow basic transactions from mining addresses with sufficient gas price", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const gasPrice = await txPermission.minimumGasPrice();

                for (let validator of initialValidators) {
                    const result = await txPermission.allowedTxTypes(
                        validator,
                        ethers.ZeroAddress,
                        0,
                        gasPrice,
                        EmptyBytes,
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Basic);
                    expect(result.cache).to.be.false;
                }
            });

            it("should not allow transactions from mining addresses with zero balance", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const gasPrice = await txPermission.minimumGasPrice();

                for (let validator of initialValidators) {
                    await helpers.setBalance(validator, 0);

                    const result = await txPermission.allowedTxTypes(
                        validator,
                        ethers.ZeroAddress,
                        0n,
                        gasPrice,
                        EmptyBytes,
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                }
            });

            it("should not allow transactions from mining addresses with zero balance", async function () {
                const { txPermission } = await helpers.loadFixture(deployContractsFixture);

                const gasPrice = await txPermission.minimumGasPrice();

                for (let validator of initialValidators) {
                    await helpers.setBalance(validator, 0);

                    const result = await txPermission.allowedTxTypes(
                        validator,
                        ethers.ZeroAddress,
                        0,
                        gasPrice,
                        EmptyBytes,
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                }
            });

            describe('calls to ValidatorSet contract', async function () {
                const ipAddress = '0x11111111111111111111111111111111';
                const port = '0xbeef';

                it("should allow reportMalicious if callable", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const reporter = await ethers.getSigner(initialValidators[0]);
                    const malicious = initialValidators[1];

                    const latestBlock = await helpers.time.latestBlock();

                    const calldata = validatorSetHbbft.interface.encodeFunctionData(
                        "reportMalicious",
                        [
                            malicious,
                            latestBlock - 1,
                            EmptyBytes,
                        ]
                    );

                    const result = await txPermission.allowedTxTypes(
                        reporter.address,
                        await validatorSetHbbft.getAddress(),
                        0n,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });

                it("should allow reportMalicious if callable with data length <= 64", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const reporter = await ethers.getSigner(initialValidators[0]);
                    const malicious = initialValidators[1];

                    const latestBlock = await helpers.time.latestBlock();

                    const calldata = validatorSetHbbft.interface.encodeFunctionData(
                        'reportMalicious',
                        [
                            malicious,
                            latestBlock - 1,
                            EmptyBytes
                        ]
                    );

                    const slicedCalldata = calldata.slice(0, calldata.length - 128);

                    const result = await txPermission.allowedTxTypes(
                        reporter.address,
                        await validatorSetHbbft.getAddress(),
                        0n,
                        gasPrice,
                        ethers.hexlify(slicedCalldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });

                it("should not allow reportMalicious if not callable", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();

                    // If reporter is not validator, reportMalicious is not callable, that means tx is not allowed
                    const reporter = await ethers.getSigner(initialStakingAddresses[0]);
                    const malicious = initialValidators[1];

                    const latestBlock = await helpers.time.latestBlock();

                    const calldata = validatorSetHbbft.interface.encodeFunctionData(
                        'reportMalicious',
                        [
                            malicious,
                            latestBlock - 1,
                            EmptyBytes
                        ]
                    );

                    const result = await txPermission.allowedTxTypes(
                        reporter.address,
                        await validatorSetHbbft.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should allow announce availability by known unvailable validator", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    await validatorSetHbbft.setValidatorAvailableSince(initialValidators[0], 0);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const latestBlock = await ethers.provider.getBlock('latest');

                    const calldata = validatorSetHbbft.interface.encodeFunctionData(
                        'announceAvailability',
                        [
                            latestBlock!.number,
                            latestBlock!.hash!
                        ]
                    );

                    const result = await txPermission.allowedTxTypes(
                        initialValidators[0],
                        await validatorSetHbbft.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });

                it("should not allow announce availability by unknown validator", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const latestBlock = await ethers.provider.getBlock('latest');

                    const calldata = validatorSetHbbft.interface.encodeFunctionData(
                        'announceAvailability',
                        [
                            latestBlock!.number,
                            latestBlock!.hash!
                        ]
                    );

                    const result = await txPermission.allowedTxTypes(
                        accounts[8].address,
                        await validatorSetHbbft.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should allow to set validator ip address for active staking pool", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const calldata = validatorSetHbbft.interface.encodeFunctionData(
                        'setValidatorInternetAddress',
                        [ipAddress, port]
                    );

                    const result = await txPermission.allowedTxTypes(
                        initialValidators[1],
                        await validatorSetHbbft.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });

                it("should not allow to set validator ip address for inactive staking pool", async function () {
                    const { txPermission, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

                    await stakingHbbft.setValidatorSetAddress(owner.address);
                    await stakingHbbft.removePool(initialStakingAddresses[0]);
                    await stakingHbbft.setValidatorSetAddress(await validatorSetHbbft.getAddress());

                    const gasPrice = await txPermission.minimumGasPrice();
                    const calldata = validatorSetHbbft.interface.encodeFunctionData(
                        'setValidatorInternetAddress',
                        [ipAddress, port]
                    );

                    const result = await txPermission.allowedTxTypes(
                        initialValidators[0],
                        await validatorSetHbbft.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should not allow to set validator ip address for non existing validator", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const calldata = validatorSetHbbft.interface.encodeFunctionData(
                        'setValidatorInternetAddress',
                        [ipAddress, port]
                    );

                    const result = await txPermission.allowedTxTypes(
                        accounts[8].address,
                        await validatorSetHbbft.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should not allow other methods calls by validators with non-zero gas price", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const calldata = validatorSetHbbft.interface.encodeFunctionData('newValidatorSet');

                    const result = await txPermission.allowedTxTypes(
                        initialValidators[0],
                        await validatorSetHbbft.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should allow other methods calls by non-validators with non-zero gas price", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();

                    const calldata = validatorSetHbbft.interface.encodeFunctionData('newValidatorSet');

                    const result = await txPermission.allowedTxTypes(
                        accounts[8].address,
                        await validatorSetHbbft.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });

                it("should use default validation for other methods calls with zero gas price", async function () {
                    const { txPermission, validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

                    const calldata = validatorSetHbbft.interface.encodeFunctionData('newValidatorSet');

                    const result = await txPermission.allowedTxTypes(
                        owner.address,
                        await validatorSetHbbft.getAddress(),
                        0,
                        0,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.All);
                    expect(result.cache).to.be.false;
                });
            });

            describe('calls to KeyGenHistory contract', async function () {
                async function deployMocks() {
                    const mockStakingFactory = await ethers.getContractFactory("MockStaking");
                    const mockStaking = await mockStakingFactory.deploy();
                    await mockStaking.waitForDeployment();

                    const mockValidatorSetFactory = await ethers.getContractFactory("MockValidatorSet");
                    const mockValidatorSet = await mockValidatorSetFactory.deploy();
                    await mockValidatorSet.waitForDeployment();

                    await mockValidatorSet.setStakingContract(await mockStaking.getAddress());

                    return { mockValidatorSet, mockStaking };
                }

                it("should not allow writePart transactions outside of write part time", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);

                    const calldata = keyGenHistory.interface.encodeFunctionData(
                        'writePart',
                        [0, 0, EmptyBytes]
                    );

                    const caller = accounts[8];

                    const result = await txPermission.allowedTxTypes(
                        caller.address,
                        await keyGenHistory.getAddress(),
                        0,
                        0,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should not allow writePart transaction with data size < 36", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet } = await deployMocks();

                    await txPermission.setValidatorSetContract(await mockValidatorSet.getAddress());
                    await mockValidatorSet.setKeyGenMode(KeyGenMode.WritePart);

                    const calldata = keyGenHistory.interface.encodeFunctionData(
                        'writePart',
                        [0, 0, EmptyBytes]
                    );

                    const slicedCalladata = calldata.slice(0, 10);
                    const caller = accounts[8];

                    const result = await txPermission.allowedTxTypes(
                        caller.address,
                        await keyGenHistory.getAddress(),
                        0,
                        0,
                        ethers.hexlify(slicedCalladata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should not allow writePart transaction with wrong epoch number", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10;

                    await txPermission.setValidatorSetContract(await mockValidatorSet.getAddress());
                    await mockValidatorSet.setKeyGenMode(KeyGenMode.WritePart);
                    await mockStaking.setStakingEpoch(epoch);

                    const calldata = keyGenHistory.interface.encodeFunctionData(
                        'writePart',
                        [epoch - 1, 0, EmptyBytes]
                    );

                    const caller = accounts[8];

                    const result = await txPermission.allowedTxTypes(
                        caller.address,
                        await keyGenHistory.getAddress(),
                        0,
                        0,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should allow writePart transaction", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10;

                    await txPermission.setValidatorSetContract(await mockValidatorSet.getAddress());
                    await mockValidatorSet.setKeyGenMode(KeyGenMode.WritePart);
                    await mockStaking.setStakingEpoch(epoch);

                    const calldata = keyGenHistory.interface.encodeFunctionData(
                        'writePart',
                        [epoch + 1, 0, EmptyBytes]
                    );

                    const caller = accounts[8];

                    const result = await txPermission.allowedTxTypes(
                        caller.address,
                        await keyGenHistory.getAddress(),
                        0,
                        0,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });

                it("should not allow writeAcks transactions outside of write acks time", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);

                    const calldata = keyGenHistory.interface.encodeFunctionData(
                        'writeAcks',
                        [0, 0, [EmptyBytes]]
                    );

                    const caller = accounts[8];

                    const result = await txPermission.allowedTxTypes(
                        caller.address,
                        await keyGenHistory.getAddress(),
                        0,
                        0,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should not allow writeAck transaction with data size < 36", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet } = await deployMocks();

                    await txPermission.setValidatorSetContract(await mockValidatorSet.getAddress());
                    await mockValidatorSet.setKeyGenMode(KeyGenMode.WriteAck);

                    const calldata = keyGenHistory.interface.encodeFunctionData(
                        'writeAcks',
                        [0, 0, [EmptyBytes]]
                    );

                    const caller = accounts[8];

                    const slicedCalldata = calldata.slice(0, 10);

                    const result = await txPermission.allowedTxTypes(
                        caller.address,
                        await keyGenHistory.getAddress(),
                        0,
                        0,
                        ethers.hexlify(slicedCalldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should not allow writeAck transaction with incorrect epoch and round", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10;

                    await txPermission.setValidatorSetContract(await mockValidatorSet.getAddress());
                    await mockValidatorSet.setKeyGenMode(KeyGenMode.WriteAck);
                    await mockStaking.setStakingEpoch(epoch);

                    const calldata = keyGenHistory.interface.encodeFunctionData(
                        'writeAcks',
                        [epoch - 1, epoch - 2, [EmptyBytes]]
                    );

                    const caller = accounts[8];

                    const result = await txPermission.allowedTxTypes(
                        caller.address,
                        await keyGenHistory.getAddress(),
                        0,
                        0,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should allow writeAck transaction with correct epoch", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10;

                    await txPermission.setValidatorSetContract(await mockValidatorSet.getAddress());
                    await mockValidatorSet.setKeyGenMode(KeyGenMode.WriteAck);
                    await mockStaking.setStakingEpoch(epoch);

                    const calldata = keyGenHistory.interface.encodeFunctionData(
                        'writeAcks',
                        [epoch + 1, 0, [EmptyBytes]]
                    );

                    const caller = accounts[8];

                    const result = await txPermission.allowedTxTypes(
                        caller.address,
                        await keyGenHistory.getAddress(),
                        0,
                        0,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });

                it("should allow writeAck transaction with correct round", async function () {
                    const { txPermission, keyGenHistory } = await helpers.loadFixture(deployContractsFixture);
                    const { mockValidatorSet, mockStaking } = await deployMocks();

                    const epoch = 10;

                    await txPermission.setValidatorSetContract(await mockValidatorSet.getAddress());
                    await mockValidatorSet.setKeyGenMode(KeyGenMode.WriteAck);
                    await mockStaking.setStakingEpoch(epoch);

                    const calldata = keyGenHistory.interface.encodeFunctionData(
                        'writeAcks',
                        [epoch - 1, epoch + 1, [EmptyBytes]]
                    );

                    const caller = accounts[8];

                    const result = await txPermission.allowedTxTypes(
                        caller.address,
                        await keyGenHistory.getAddress(),
                        0,
                        0,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });
            });

            describe('calls to ConnectivityTracker contract', async function () {
                it("should allow reportMissingConnectivity if callable", async function () {
                    const { txPermission, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const reporter = await ethers.getSigner(initialValidators[0]);

                    await helpers.mine(minReportAgeBlocks + 1n);

                    const latestBlockNum = await helpers.time.latestBlock();
                    const block = await ethers.provider.getBlock(latestBlockNum - 1);

                    const calldata = connectivityTracker.interface.encodeFunctionData(
                        'reportMissingConnectivity',
                        [
                            initialValidators[1],
                            block!.number,
                            block!.hash!
                        ]
                    );

                    const result = await txPermission.allowedTxTypes(
                        reporter.address,
                        await connectivityTracker.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });

                it("should not allow reportMissingConnectivity if not callable", async function () {
                    const { txPermission, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const reporter = await ethers.getSigner(initialValidators[0]);

                    await helpers.mine(minReportAgeBlocks + 1n);

                    const latestBlockNum = await helpers.time.latestBlock();
                    const block = await ethers.provider.getBlock(latestBlockNum - 1);

                    const calldata = connectivityTracker.interface.encodeFunctionData(
                        'reportMissingConnectivity',
                        [
                            initialValidators[1],
                            block!.number,
                            ethers.ZeroHash
                        ]
                    );

                    const result = await txPermission.allowedTxTypes(
                        reporter.address,
                        await connectivityTracker.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });

                it("should allow reportReconnect if callable", async function () {
                    const { txPermission, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const reporter = await ethers.getSigner(initialValidators[0]);
                    const validator = initialValidators[1];

                    await helpers.mine(minReportAgeBlocks + 1n);

                    let latestBlockNum = await helpers.time.latestBlock();
                    let block = await ethers.provider.getBlock(latestBlockNum - 1);

                    expect(await connectivityTracker.connect(reporter).reportMissingConnectivity(
                        validator,
                        block!.number,
                        block!.hash!
                    ));

                    latestBlockNum = await helpers.time.latestBlock();
                    block = await ethers.provider.getBlock(latestBlockNum - 1);

                    const calldata = connectivityTracker.interface.encodeFunctionData(
                        'reportReconnect',
                        [
                            initialValidators[1],
                            block!.number,
                            block!.hash!
                        ]
                    );

                    const result = await txPermission.allowedTxTypes(
                        reporter.address,
                        await connectivityTracker.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.Call);
                    expect(result.cache).to.be.false;
                });

                it("should not allow reportReconnect if not callable", async function () {
                    const { txPermission, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

                    const gasPrice = await txPermission.minimumGasPrice();
                    const reporter = await ethers.getSigner(initialValidators[0]);

                    await helpers.mine(minReportAgeBlocks + 1n);

                    const latestBlockNum = await helpers.time.latestBlock();
                    const block = await ethers.provider.getBlock(latestBlockNum - 1);

                    const calldata = connectivityTracker.interface.encodeFunctionData(
                        'reportReconnect',
                        [
                            initialValidators[1],
                            block!.number,
                            ethers.ZeroHash
                        ]
                    );

                    const result = await txPermission.allowedTxTypes(
                        reporter.address,
                        await connectivityTracker.getAddress(),
                        0,
                        gasPrice,
                        ethers.hexlify(calldata),
                    );

                    expect(result.typesMask).to.equal(AllowedTxTypeMask.None);
                    expect(result.cache).to.be.false;
                });
            });
        });
    });
});
