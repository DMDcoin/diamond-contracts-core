import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { CertifierHbbft, ValidatorSetHbbftMock } from "../src/types";

const validatorInactivityThreshold = 365 * 86400 // 1 year

describe('CertifierHbbft contract', () => {
    let accounts: HardhatEthersSigner[];
    let owner: HardhatEthersSigner;

    let initialValidators: string[];
    let initialStakingAddresses: string[];

    let accountAddresses: string[];

    async function deployContracts() {
        const stubAddress = accounts[1].address;

        const validatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbftProxy = await upgrades.deployProxy(
            validatorSetFactory,
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
        );

        await validatorSetHbbftProxy.waitForDeployment();

        const certifierFactory = await ethers.getContractFactory("CertifierHbbft");
        const certifierProxy = await upgrades.deployProxy(
            certifierFactory,
            [
                [owner.address],
                await validatorSetHbbftProxy.getAddress(),
                owner.address
            ],
            { initializer: 'initialize' }
        );

        await certifierProxy.waitForDeployment();

        const validatorSetHbbft = validatorSetFactory.attach(
            await validatorSetHbbftProxy.getAddress()
        ) as ValidatorSetHbbftMock;

        const certifier = certifierFactory.attach(await certifierProxy.getAddress()) as CertifierHbbft;

        return { certifier, validatorSetHbbft };
    }

    before(async function () {
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
                    ethers.ZeroAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(contractFactory, "ZeroAddress");
        });

        it("should revert initialization with owner = address(0)", async () => {
            const contractFactory = await ethers.getContractFactory("CertifierHbbft");
            await expect(upgrades.deployProxy(
                contractFactory,
                [
                    [],
                    accounts[1].address,
                    ethers.ZeroAddress
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(contractFactory, "ZeroAddress");
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

            expect(await contract.waitForDeployment());

            await expect(contract.initialize(
                [],
                accounts[1].address,
                owner.address
            )).to.be.revertedWithCustomError(contract, "InvalidInitialization");
        });
    });

    describe('certification', async () => {
        it('should restrict calling certify to contract owner', async function () {
            const { certifier } = await loadFixture(deployContracts);

            const caller = accounts[5];

            await expect(certifier.connect(caller).certify(caller.address))
                .to.be.revertedWithCustomError(certifier, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should restrict calling revoke to contract owner', async function () {
            const { certifier } = await loadFixture(deployContracts);

            const caller = accounts[5];

            await expect(certifier.connect(caller).revoke(caller.address))
                .to.be.revertedWithCustomError(certifier, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it("should sertify address", async function () {
            const { certifier } = await loadFixture(deployContracts);
            const who = accounts[4];

            await expect(certifier.connect(owner).certify(who.address))
                .to.emit(certifier, "Confirmed")
                .withArgs(who.address);

            expect(await certifier.certifiedExplicitly(who.address)).to.be.true;
            expect(await certifier.certified(who.address)).to.be.true;
        });

        it("should revoke cerification", async function () {
            const { certifier } = await loadFixture(deployContracts);
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

        it("validator account should be certified by default", async function () {
            const { certifier } = await loadFixture(deployContracts);

            expect(await certifier.certifiedExplicitly(initialValidators[0])).to.be.false;
            expect(await certifier.certified(initialValidators[0])).to.be.true;
        });
    });
});
