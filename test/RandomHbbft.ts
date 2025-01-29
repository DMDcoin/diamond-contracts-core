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
            connectivityTrackerContract: stubAddress,
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
            const { randomHbbft } = await helpers.loadFixture(deployContracts);

            const systemSigner = await impersonateSystemAcc();

            const blockNumber = await helpers.time.latestBlock();
            const randomSeed = random(0, Number.MAX_SAFE_INTEGER);
            const healthy = await randomHbbft.isFullHealth();

            await expect(randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed))
                .to.emit(randomHbbft, "SetCurrentSeed")
                .withArgs(blockNumber + 1, randomSeed, healthy);

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
        it('should display health correctly', async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);
            const validators = await validatorSetHbbft.getValidators();
            expect(validators.length).to.be.equal(25);
            expect((await randomHbbft.isFullHealth())).to.be.equal(true);
            await validatorSetHbbft.kickValidator(validators[1]);
            expect((await randomHbbft.isFullHealth())).to.be.equal(false);
        })

        it('should mark unhealty blocks', async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const validators = await validatorSetHbbft.getValidators();
            expect(validators.length).to.be.equal(25);
            expect(await randomHbbft.isFullHealth()).to.be.equal(true);

            const systemSigner = await impersonateSystemAcc();
            await validatorSetHbbft.kickValidator(validators[0]);

            const blockNumber = await helpers.time.latestBlock();
            const randomSeed = random(0, Number.MAX_SAFE_INTEGER);
            await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

            expect(await randomHbbft.getSeedHistoric(blockNumber + 1)).to.equal(randomSeed);
            expect(await randomHbbft.isFullHealthHistoric(blockNumber + 1)).to.equal(false);
            expect(await helpers.time.latestBlock()).to.be.equal(blockNumber + 1);
            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });

        it('should get full health historic array ', async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const systemSigner = await impersonateSystemAcc();

            let blocks = new Array<bigint>();
            let expected = new Array<boolean>();

            expect(await randomHbbft.isFullHealth()).to.be.equal(true);
            const validators = await validatorSetHbbft.getValidators();

            let startBlock = await helpers.time.latestBlock();

            for (let i = 0; i < 50; ++i) {
                const randomSeed = random(0, Number.MAX_SAFE_INTEGER);
                await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);
                blocks.push(BigInt(startBlock + i + 1));
                expected.push(true);
            }

            expect(await randomHbbft.isFullHealth()).to.be.equal(true);
            await validatorSetHbbft.kickValidator(validators[0]);
            startBlock = await helpers.time.latestBlock();

            for (let i = 0; i < 50; ++i) {
                const randomSeed = random(0, Number.MAX_SAFE_INTEGER);

                await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

                blocks.push(BigInt(startBlock + i + 1));
                expected.push(false);
            }

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
            const result = await randomHbbft.isFullHealthsHistoric(blocks);
            expect(result).to.be.deep.equal(expected);
        });

        it('should be consistent in block healthiness tracking', async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);
            const systemSigner = await impersonateSystemAcc();
            const validators = await validatorSetHbbft.getValidators();

            const blocksSeedHealth = new Map<number, boolean>();

            expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(25);
            expect(await randomHbbft.isFullHealth()).to.be.true;

            // Block 1: Set to unhealthy by kicking a validator
            await validatorSetHbbft.kickValidator(validators[0]);
            expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(24);
            expect(await randomHbbft.isFullHealth()).to.be.false;

            // Block 2: Set current seed, should be unhealthy since validators count decreased
            await randomHbbft.connect(systemSigner).setCurrentSeed(random(0, Number.MAX_SAFE_INTEGER));
            expect(await randomHbbft.isFullHealthHistoric(await helpers.time.latestBlock())).to.be.false;
            blocksSeedHealth.set(await helpers.time.latestBlock(), false);

            // Block 3: Simulate returning to healthy state
            await validatorSetHbbft.setValidatorsNum(25);
            expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(25);
            expect(await randomHbbft.isFullHealth()).to.be.true;

            await randomHbbft.connect(systemSigner).setCurrentSeed(random(0, Number.MAX_SAFE_INTEGER));
            expect(await randomHbbft.isFullHealthHistoric(await helpers.time.latestBlock())).to.be.true;
            blocksSeedHealth.set(await helpers.time.latestBlock(), true);

            // Block 4: Another block
            await randomHbbft.connect(systemSigner).setCurrentSeed(random(0, Number.MAX_SAFE_INTEGER));
            blocksSeedHealth.set(await helpers.time.latestBlock(), true);

            for (const [blockNum, healthyValue] of blocksSeedHealth) {
                expect(await randomHbbft.isFullHealthHistoric(blockNum)).to.eq(healthyValue);
            }

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });
    })
});
