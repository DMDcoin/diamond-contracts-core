import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import {
    CertifierHbbft,
    KeyGenHistory,
    TxPermissionHbbft,
    ValidatorSetHbbftMock,
} from "../src/types";

const testdata = require('./testhelpers/data');

// delegatecall are a problem for truffle debugger
// therefore it makes sense to use a proxy for automated testing to have the proxy testet.
// and to not use it if specific transactions needs to get debugged,
// like truffle `debug 0xabc`.
const useUpgradeProxy = !(process.env.CONTRACTS_NO_UPGRADE_PROXY == 'true');
console.log('useUpgradeProxy:', useUpgradeProxy);
const logOutput = false;

const validatorInactivityThreshold = 365 * 86400 // 1 year

const contractName = "TX_PERMISSION_CONTRACT";
const contractNameHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(contractName));
const contractVersion = 3;

describe('TxPermissionHbbft', () => {
    let owner: SignerWithAddress;
    let accounts: SignerWithAddress[];

    let allowedSenders: string[];
    let accountAddresses: string[];

    let initialValidators: string[];
    let initialStakingAddresses: string[];

    async function deployContracts() {
        const stubAddress = accountAddresses[0];

        const { parts, acks } = testdata.getTestPartNAcks();

        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbft = await upgrades.deployProxy(
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
        ) as ValidatorSetHbbftMock;

        const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
        const keyGenHistory = await upgrades.deployProxy(
            KeyGenFactory,
            [
                owner.address,
                validatorSetHbbft.address,
                initialValidators,
                parts,
                acks
            ],
            { initializer: 'initialize' }
        ) as KeyGenHistory;

        const CertifierFactory = await ethers.getContractFactory("CertifierHbbft");
        const certifier = await upgrades.deployProxy(
            CertifierFactory,
            [
                [owner.address],
                validatorSetHbbft.address,
                owner.address
            ],
            { initializer: 'initialize' }
        ) as CertifierHbbft;

        const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");
        const txPermission = await upgrades.deployProxy(
            TxPermissionFactory,
            [
                allowedSenders,
                certifier.address,
                validatorSetHbbft.address,
                keyGenHistory.address,
                owner.address
            ],
            { initializer: 'initialize' }
        ) as TxPermissionHbbft;

        await validatorSetHbbft.setKeyGenHistoryContract(keyGenHistory.address);

        return { txPermission, validatorSetHbbft, certifier, keyGenHistory };
    }

    before(async () => {
        [owner, ...accounts] = await ethers.getSigners();
        accountAddresses = accounts.map(item => item.address);

        allowedSenders = [owner.address, accountAddresses[0], accountAddresses[1]];

        initialValidators = accountAddresses.slice(1, 4); // accounts[1...3]
        initialStakingAddresses = accountAddresses.slice(4, 7); // accounts[4...6]
    });

    describe('deployment', async () => {
        it("should deploy and initialize contract", async function () {
            const certifierAddress = accountAddresses[0];
            const validatorSetAddress = accountAddresses[1];
            const keyGenHistoryAddress = accountAddresses[2];

            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");
            const txPermission = await upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    certifierAddress,
                    validatorSetAddress,
                    keyGenHistoryAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            ) as TxPermissionHbbft;

            expect(await txPermission.deployed());

            expect(await txPermission.certifierContract()).to.equal(certifierAddress);
            expect(await txPermission.keyGenHistoryContract()).to.equal(keyGenHistoryAddress);
            expect(await txPermission.validatorSetContract()).to.equal(validatorSetAddress);
            expect(await txPermission.owner()).to.equal(owner.address);

            expect(await txPermission.allowedSenders()).to.deep.equal(allowedSenders);
        });

        it("should revert initialization with CertifierHbbft = address(0)", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");

            await expect(upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    ethers.constants.AddressZero,
                    accountAddresses[0],
                    accountAddresses[0],
                    owner.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Certifier address must not be 0');
        });

        it("should revert initialization with ValidatorSet = address(0)", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");

            await expect(upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    accountAddresses[0],
                    ethers.constants.AddressZero,
                    accountAddresses[0],
                    owner.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('ValidatorSet address must not be 0');
        });

        it("should revert initialization with KeyGenHistory = address(0)", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");

            await expect(upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    accountAddresses[0],
                    accountAddresses[0],
                    ethers.constants.AddressZero,
                    owner.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('KeyGenHistory address must not be 0');
        });

        it("should revert initialization with owner = address(0)", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");

            await expect(upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    accountAddresses[0],
                    accountAddresses[0],
                    accountAddresses[0],
                    ethers.constants.AddressZero,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Owner address must not be 0');
        });

        it("should not allow initialization if initialized contract", async () => {
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");

            const contract = await upgrades.deployProxy(
                TxPermissionFactory,
                [
                    allowedSenders,
                    accountAddresses[0],
                    accountAddresses[0],
                    accountAddresses[0],
                    owner.address
                ],
                { initializer: 'initialize' }
            );

            expect(await contract.deployed());

            await expect(contract.initialize(
                allowedSenders,
                accountAddresses[0],
                accountAddresses[0],
                accountAddresses[0],
                owner.address
            )).to.be.revertedWith('Initializable: contract is already initialized');
        });
    });

    describe('contract functions', async function () {
        it("should get contract name", async function () {
            const { txPermission } = await helpers.loadFixture(deployContracts);

            expect(await txPermission.contractName()).to.equal(contractName);
        });

        it("should get contract name hash", async function () {
            const { txPermission } = await helpers.loadFixture(deployContracts);

            expect(await txPermission.contractNameHash()).to.equal(contractNameHash);
        });

        it("should get contract version", async function () {
            const { txPermission } = await helpers.loadFixture(deployContracts);

            expect(await txPermission.contractVersion()).to.equal(contractVersion);
        });

        describe('addAllowedSender()', async function () {
            it("should restrict calling addAllowedSender to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContracts);

                const caller = accounts[1];

                await expect(
                    txPermission.connect(caller).addAllowedSender(caller.address)
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should revert if sender address is 0", async function () {
                const { txPermission } = await helpers.loadFixture(deployContracts);

                await expect(
                    txPermission.connect(owner).addAllowedSender(ethers.constants.AddressZero)
                ).to.be.reverted;
            });

            it("should add allowed sender", async function () {
                const { txPermission } = await helpers.loadFixture(deployContracts);

                const sender = accounts[10];

                expect(await txPermission.isSenderAllowed(sender.address)).to.be.false;
                expect(await txPermission.connect(owner).addAllowedSender(sender.address));
                expect(await txPermission.isSenderAllowed(sender.address)).to.be.true;

                expect(await txPermission.allowedSenders()).to.contain(sender.address);
            });

            it("should revert adding same address twice", async function () {
                const { txPermission } = await helpers.loadFixture(deployContracts);

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
                const { txPermission } = await helpers.loadFixture(deployContracts);

                const caller = accounts[1];

                await expect(
                    txPermission.connect(caller).removeAllowedSender(caller.address)
                ).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should revert calling if sender already removed", async function () {
                const { txPermission } = await helpers.loadFixture(deployContracts);

                const sender = accounts[11];

                // expect(await txPermission.isSenderAllowed(sender.address)).to.be.false;
                // expect(await txPermission.connect(owner).addAllowedSender(sender.address));
                // expect(await txPermission.isSenderAllowed(sender.address)).to.be.true;

                await expect(
                    txPermission.connect(owner).removeAllowedSender(sender.address)
                ).to.be.reverted;
            });

            it("should remove sender", async function () {
                const { txPermission } = await helpers.loadFixture(deployContracts);

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
                const { txPermission } = await helpers.loadFixture(deployContracts);

                const caller = accounts[1];

                await expect(txPermission.connect(caller).setMinimumGasPrice(1)).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should not allow to set minimum gas price 0", async function() {
                const { txPermission } = await helpers.loadFixture(deployContracts);

                await expect(
                    txPermission.connect(owner).setMinimumGasPrice(0)
                ).to.be.revertedWith('Minimum gas price must not be zero');
            });

            it("should set minimum gas price", async function() {
                const { txPermission } = await helpers.loadFixture(deployContracts);

                const minGasPrice = 123;

                await expect(
                    txPermission.connect(owner).setMinimumGasPrice(minGasPrice)
                ).to.emit(txPermission, "gasPriceChanged")
                .withArgs(minGasPrice);

                expect(await txPermission.minimumGasPrice()).to.equal(minGasPrice);
            });
        });

        describe('setBlockGasLimit()', async function () {
            it("should restrict calling setBlockGasLimit to contract owner", async function () {
                const { txPermission } = await helpers.loadFixture(deployContracts);

                const caller = accounts[1];

                await expect(txPermission.connect(caller).setBlockGasLimit(1)).to.be.revertedWith("Ownable: caller is not the owner");
            });

            it("should not allow to set block gas limit less than 1_000_000", async function() {
                const { txPermission } = await helpers.loadFixture(deployContracts);

                const blockGasLimit = 10_000;

                await expect(
                    txPermission.connect(owner).setBlockGasLimit(blockGasLimit)
                ).to.be.revertedWith('Block Gas limit gas price must be at minimum 1,000,000');
            });

            it("should set block gas limit", async function() {
                const { txPermission } = await helpers.loadFixture(deployContracts);

                const blockGasLimit = 15_000_000;

                expect(await txPermission.connect(owner).setBlockGasLimit(blockGasLimit));

                expect(await txPermission.blockGasLimit()).to.equal(blockGasLimit);
            });
        });

        describe('allowedTxTypes()', async function() {});
    });
});
