import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import {
    RandomHbbft,
    StakingHbbftMock,
    ValidatorSetHbbftMock,
} from "../src/types";

import { random, range } from "./utils/utils";

const minStake = ethers.parseEther('1');
const maxStake = ethers.parseEther('100000');

// one epoch in 1 day.
const stakingFixedEpochDuration = 86400n;
// the transition time window is 1 hour.
const stakingTransitionTimeframeLength = 3600n;
const stakingWithdrawDisallowPeriod = 1n;
const validatorInactivityThreshold = 365 * 86400 // 1 year

const SystemAccountAddress = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";
const ZeroIpAddress = ethers.zeroPadBytes("0x00", 16);

describe('RandomHbbft', () => {
    let owner: HardhatEthersSigner;
    let accounts: HardhatEthersSigner[];
    let initialValidators: string[];
    let initialStakingAddresses: string[];
    let stubAddress: string

    async function deployContracts() {
        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: stubAddress,
            validatorInactivityThreshold: validatorInactivityThreshold,
        }

        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbft = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                validatorSetParams,      // _params
                initialValidators,       // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as ValidatorSetHbbftMock;

        await validatorSetHbbft.waitForDeployment();

        const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
        const randomHbbft = await upgrades.deployProxy(
            RandomHbbftFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress()
            ],
            { initializer: 'initialize' }
        ) as unknown as RandomHbbft;

        await randomHbbft.waitForDeployment();

        let stakingParams = {
            _validatorSetContract: await validatorSetHbbft.getAddress(),
            _bonusScoreContract: stubAddress,
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: minStake,
            _candidateMinStake: minStake,
            _maxStake: maxStake,
            _stakingFixedEpochDuration: stakingFixedEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
            _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
        };

        let initialValidatorsPubKeys: string[] = [];
        let initialValidatorsIpAddresses: string[] = [];

        for (let i = 0; i < initialStakingAddresses.length; i++) {
            initialValidatorsPubKeys.push(ethers.Wallet.createRandom().signingKey.publicKey);
            initialValidatorsIpAddresses.push(ZeroIpAddress);
        }

        let initialValidatorsPubKeysSplit = fp.flatMap(
            (x: string) => [
                x.substring(0, 66),
                "0x" + x.substring(66, 130),
            ])(initialValidatorsPubKeys);

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingHbbft = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                stakingParams,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as StakingHbbftMock;

        await stakingHbbft.waitForDeployment();

        await validatorSetHbbft.setRandomContract(await randomHbbft.getAddress());
        await validatorSetHbbft.setStakingContract(await stakingHbbft.getAddress());

        return { randomHbbft, validatorSetHbbft, stakingHbbft };
    }

    async function impersonateSystemAcc() {
        await helpers.impersonateAccount(SystemAccountAddress);

        await owner.sendTransaction({
            to: SystemAccountAddress,
            value: ethers.parseEther('10'),
        });

        return await ethers.getSigner(SystemAccountAddress);
    }

    before(async function () {
        [owner, ...accounts] = await ethers.getSigners();

        stubAddress = owner.address;

        const accountAddresses = accounts.map(item => item.address);

        initialValidators = accountAddresses.slice(1, 25 + 1); // accounts[1...25]
        initialStakingAddresses = accountAddresses.slice(26, 51); // accounts[26...50]

        expect(initialValidators.length).to.be.equal(25);
        expect(initialStakingAddresses.length).to.be.equal(25);
    });

    describe('Initializer', async () => {
        it("should revert initialization with validator contract = address(0)", async () => {
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
            await expect(upgrades.deployProxy(
                RandomHbbftFactory,
                [
                    stubAddress,
                    ethers.ZeroAddress
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(RandomHbbftFactory, "ZeroAddress");
        });

        it("should revert initialization with owner = address(0)", async () => {
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
            await expect(upgrades.deployProxy(
                RandomHbbftFactory,
                [
                    ethers.ZeroAddress,
                    stubAddress,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(RandomHbbftFactory, "ZeroAddress");
        });

        it("should not allow initialization if initialized contract", async () => {
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
            const contract = await upgrades.deployProxy(
                RandomHbbftFactory,
                [
                    stubAddress,
                    stubAddress,
                ],
                { initializer: 'initialize' }
            );

            await contract.waitForDeployment();

            await expect(contract.initialize(
                stubAddress,
                stubAddress,
            )).to.be.revertedWithCustomError(contract, "InvalidInitialization");
        });
    });

    describe("currentSeed()", async () => {
        it('setCurrentSeed must revert if called by non-owner', async () => {
            const { randomHbbft } = await helpers.loadFixture(deployContracts);

            await expect(randomHbbft.setCurrentSeed(100n))
                .to.be.revertedWithCustomError(randomHbbft, "Unauthorized");
        });

        it('should set current seed by system', async function () {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const systemSigner = await impersonateSystemAcc();

            await validatorSetHbbft.setIsFullHealth(true);

            const blockNumber = await helpers.time.latestBlock();
            const randomSeed = random(0, Number.MAX_SAFE_INTEGER);

            await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

            expect(await randomHbbft.getSeedHistoric(blockNumber + 1)).to.equal(randomSeed);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });

        it('last 10 seeds must be equal to last 10 elements in the array', async () => {
            const { randomHbbft } = await helpers.loadFixture(deployContracts);

            const systemSigner = await impersonateSystemAcc();
            let seedsArray = new Array<bigint>();

            for (let i = 0; i < 100; ++i) {
                let randomSeed = random(0, Number.MAX_SAFE_INTEGER);
                seedsArray.push(randomSeed);

                await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);
            }

            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            let currentBlock = await helpers.time.latestBlock();

            expect(await randomHbbft.currentSeed()).to.be.equal(seedsArray[seedsArray.length - 1]);
            expect(await randomHbbft.getSeedsHistoric(range(currentBlock - 9, currentBlock + 1))).to.be.deep.equal(seedsArray.slice(-10));
        });
    });

    describe("FullHealth()", async function () {
        it.skip('should display health correctly', async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(25);
            expect(await randomHbbft.isFullHealth()).to.be.true;

            await validatorSetHbbft.connect(owner).removeMaliciousValidators([accounts[15].address]);

            expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(24);
            expect(await randomHbbft.isFullHealth()).to.be.false;
        });

        it.skip('should set historical FullHealth() value as true when the block is healthy', async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            let randomSeed = random(0, Number.MAX_SAFE_INTEGER);

            // storing current seed and the health state of the network, network is healthy with 25 validators
            await randomHbbft.connect(owner).setCurrentSeed(randomSeed);
            expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(25);

            // removing a validator so the network is not healthy
            await validatorSetHbbft.connect(owner).removeMaliciousValidators([accounts[15].address]);

            randomSeed = random(0, Number.MAX_SAFE_INTEGER);

            // storing current seed and the health state of the network, network is NOT healthy with 24 validators
            await randomHbbft.connect(owner).setCurrentSeed(randomSeed);
            expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(24);

            // getting historical health values for both previous and current block
            let blockNumber = await ethers.provider.getBlockNumber();
            expect(await randomHbbft.isFullHealthsHistoric([blockNumber, blockNumber - 1])).to.be.deep.equal([false, true]);
        });

        it('should display health correctly', async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            let healthy = false;

            await validatorSetHbbft.setIsFullHealth(healthy);
            expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);

            healthy = true;

            await validatorSetHbbft.setIsFullHealth(healthy);
            expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);
        });

        it('should mark unhealty blocks', async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            let healthy = false;

            await validatorSetHbbft.setIsFullHealth(healthy);
            expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);

            const systemSigner = await impersonateSystemAcc();

            const blockNumber = await helpers.time.latestBlock();
            const randomSeed = random(0, Number.MAX_SAFE_INTEGER);

            await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

            expect(await randomHbbft.getSeedHistoric(blockNumber + 1)).to.equal(randomSeed);
            expect(await randomHbbft.isFullHealthHistoric(blockNumber + 1)).to.equal(healthy);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            healthy = true;
            await validatorSetHbbft.setIsFullHealth(true);
        });

        it('should get full health historic array ', async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const systemSigner = await impersonateSystemAcc();

            let blocks = new Array<bigint>();
            let expected = new Array<boolean>();

            let healthy = true;
            await validatorSetHbbft.setIsFullHealth(healthy);
            expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);

            let startBlock = await helpers.time.latestBlock();

            for (let i = 0; i < 50; ++i) {
                const randomSeed = random(0, Number.MAX_SAFE_INTEGER);

                await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

                blocks.push(BigInt(startBlock + i + 1));
                expected.push(healthy);
            }

            healthy = false;
            await validatorSetHbbft.setIsFullHealth(healthy);
            expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);

            startBlock = await helpers.time.latestBlock();

            for (let i = 0; i < 50; ++i) {
                const randomSeed = random(0, Number.MAX_SAFE_INTEGER);

                await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

                blocks.push(BigInt(startBlock + i + 1));
                expected.push(healthy);
            }

            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            const result = await randomHbbft.isFullHealthsHistoric(blocks);

            expect(result).to.be.deep.equal(expected);
        });
    })
});
