import { ethers, upgrades } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import { CertifierHbbft, ValidatorSetHbbftMock } from "../src/types";

const validatorInactivityThreshold = 365 * 86400 // 1 year

describe('CertifierHbbft contract', () => {
    let accounts: SignerWithAddress[];
    let owner: SignerWithAddress;

    let initialValidators: string[];
    let initialStakingAddresses: string[];

    let accountAddresses: string[];

    async function deployContracts() {
        const stubAddress = accounts[1].address;

        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbft = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                stubAddress,                  // _blockRewardContract
                stubAddress,                  // _randomContract
                stubAddress,                  // _stakingContract
                stubAddress,                  // _keyGenHistoryContract
                validatorInactivityThreshold, // _validatorInactivityThreshold
                initialValidators,            // _initialMiningAddresses
                initialStakingAddresses,      // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as ValidatorSetHbbftMock;

        await validatorSetHbbft.deployed();

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

        await certifier.deployed();

        return { certifier, validatorSetHbbft };
    }

    before(async function() {
        [owner, ...accounts] = await ethers.getSigners();

        accountAddresses = accounts.map(item => item.address);
        initialValidators = accountAddresses.slice(1, 3 + 1); // accounts[1...3]
        initialStakingAddresses = accountAddresses.slice(4, 6 + 1); // accounts[4...6]
    });

    describe('Initializer', async () => {
        it("should revert initialization with validator contract = address(0)", async () => {
            const contractFactory = await ethers.getContractFactory("CertifierHbbft");
            await expect(upgrades.deployProxy(
                contractFactory,
                [
                    [],
                    ethers.constants.AddressZero,
                    owner.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Validatorset must not be 0');
        });

        it("should revert initialization with owner = address(0)", async () => {
            const contractFactory = await ethers.getContractFactory("CertifierHbbft");
            await expect(upgrades.deployProxy(
                contractFactory,
                [
                    [],
                    accounts[1].address,
                    ethers.constants.AddressZero
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Owner address must not be 0');
        });

        it("should not allow initialization if initialized contract", async () => {
            const contractFactory = await ethers.getContractFactory("CertifierHbbft");
            const contract = await upgrades.deployProxy(
                contractFactory,
                [
                    [],
                    accounts[1].address,
                    owner.address
                ],
                { initializer: 'initialize' }
            );

            expect(await contract.deployed());

            await expect(contract.initialize(
                [],
                accounts[1].address,
                owner.address
            )).to.be.revertedWith('Initializable: contract is already initialized');
        });
    });

    describe('certification', async () => {
        it('should restrict calling certify to contract owner', async function() {
            const { certifier } = await helpers.loadFixture(deployContracts);

            const caller = accounts[5];

            await expect(certifier.connect(caller).certify(caller.address))
                .to.be.revertedWith('Ownable: caller is not the owner');
        });

        it('should restrict calling revoke to contract owner', async function() {
            const { certifier } = await helpers.loadFixture(deployContracts);

            const caller = accounts[5];

            await expect(certifier.connect(caller).revoke(caller.address))
                .to.be.revertedWith('Ownable: caller is not the owner');
        });

        it("should sertify address", async function() {
            const { certifier } = await helpers.loadFixture(deployContracts);
            const who = accounts[4];

            await expect(certifier.connect(owner).certify(who.address))
                .to.emit(certifier, "Confirmed")
                .withArgs(who.address);

            expect(await certifier.certifiedExplicitly(who.address)).to.be.true;
            expect(await certifier.certified(who.address)).to.be.true;
        });

        it("should revoke cerification", async function() {
            const { certifier } = await helpers.loadFixture(deployContracts);
            const who = accounts[6];

            await expect(certifier.connect(owner).certify(who.address))
                .to.emit(certifier, "Confirmed")
                .withArgs(who.address);

            expect(await certifier.certifiedExplicitly(who.address)).to.be.true;

            await expect(certifier.connect(owner).revoke(who.address))
                .to.emit(certifier, "Revoked")
                .withArgs(who.address);

                expect(await certifier.certifiedExplicitly(who.address)).to.be.false;
                expect(await certifier.certified(who.address)).to.be.false;
        });

        it("validator account should be certified by default", async function() {
            const { certifier } = await helpers.loadFixture(deployContracts);

            expect(await certifier.certifiedExplicitly(initialValidators[0])).to.be.false;
            expect(await certifier.certified(initialValidators[0])).to.be.true;
        });
    });
});
