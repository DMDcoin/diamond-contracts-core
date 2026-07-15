import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import { Hex, parseEther, zeroAddress, type Address } from "viem";

import { random, range, splitPublicKeys } from "./fixtures/utils.js";
import { deployProxy } from "./fixtures/proxy.js";
import { Validator, ZeroIpAddress } from "./fixtures/validator.js";
import { createRandomWallet } from "./fixtures/wallet.js";

const { viem: hhViem, networkHelpers: helpers } = await hre.network.getOrCreate();

type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

const minStake = parseEther("1");
const maxStake = parseEther("100000");

// one epoch in 1 day.
const stakingFixedEpochDuration = 86400n;
// the transition time window is 1 hour.
const stakingTransitionTimeframeLength = 3600n;
const stakingWithdrawDisallowPeriod = 1n;
const validatorInactivityThreshold = 365n * 86400n; // 1 year

const SystemAccountAddress: Address = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";

describe("RandomHbbft", () => {
    let owner: TestWalletClient;
    let accounts: TestWalletClient[];
    let stubAddress: Hex;

    async function deployContracts() {
        const initialValidators = new Array<Validator>();
        for (let i = 0; i < 25; ++i) {
            const validator = await Validator.create();
            initialValidators.push(validator);
        }

        const initialMiningAddresses = initialValidators.map((validator) => validator.miningAddress());
        const initialStakingAddresses = initialValidators.map((validator) => validator.stakingAddress());

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: stubAddress,
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

        const randomHbbft = await deployProxy(hhViem, "RandomHbbft", {
            initArgs: [owner.account.address, validatorSetHbbft.address],
            initializer: "initialize",
        });

        const stakingParams = {
            _validatorSetContract: validatorSetHbbft.address,
            _bonusScoreContract: stubAddress,
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: minStake,
            _candidateMinStake: minStake,
            _maxStake: maxStake,
            _stakingFixedEpochDuration: stakingFixedEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
            _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod,
        };

        // The exact key values are irrelevant for these unit tests.
        const initialValidatorsPubKeys = splitPublicKeys(initialValidators.map((validator) => validator.publicKey()));
        const initialValidatorsIpAddresses = initialStakingAddresses.map(() => ZeroIpAddress);

        const stakingHbbft = await deployProxy(hhViem, "StakingHbbftMock", {
            initArgs: [
                owner.account.address,
                stakingParams,
                initialValidatorsPubKeys,       // _publicKeys
                initialValidatorsIpAddresses,   // _internetAddresses
            ],
            initializer: "initialize",
        });

        await validatorSetHbbft.write.setRandomContract([randomHbbft.address]);
        await validatorSetHbbft.write.setStakingContract([stakingHbbft.address]);

        return { initialValidators, randomHbbft, validatorSetHbbft, stakingHbbft };
    }

    async function impersonateSystemAcc(): Promise<Address> {
        await helpers.impersonateAccount(SystemAccountAddress);
        await helpers.setBalance(SystemAccountAddress, parseEther("10"));

        return SystemAccountAddress;
    }

    before(async function () {
        [owner, ...accounts] = await hhViem.getWalletClients();

        stubAddress = createRandomWallet().address;
    });

    describe("Initializer", async () => {
        it("should revert initialization with validator contract = address(0)", async () => {
            const implementation = await hhViem.deployContract("RandomHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "RandomHbbft", {
                    initArgs: [stubAddress, zeroAddress],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert initialization with owner = address(0)", async () => {
            const implementation = await hhViem.deployContract("RandomHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "RandomHbbft", {
                    initArgs: [zeroAddress, stubAddress],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should not allow initialization if initialized contract", async () => {
            const contract = await deployProxy(hhViem, "RandomHbbft", {
                initArgs: [stubAddress, stubAddress],
                initializer: "initialize",
            });

            await hhViem.assertions.revertWithCustomError(
                contract.write.initialize([stubAddress, stubAddress]),
                contract,
                "InvalidInitialization",
            );
        });
    });

    describe("currentSeed()", async () => {
        it("setCurrentSeed must revert if called by non-owner", async () => {
            const { randomHbbft } = await helpers.loadFixture(deployContracts);

            await hhViem.assertions.revertWithCustomError(
                randomHbbft.write.setCurrentSeed([100n]),
                randomHbbft,
                "Unauthorized",
            );
        });

        it("should set current seed by system", async function () {
            const { randomHbbft } = await helpers.loadFixture(deployContracts);

            const systemAccount = await impersonateSystemAcc();

            const blockNumber = await helpers.time.latestBlock();
            const randomSeed = random(0, Number.MAX_SAFE_INTEGER);
            const healthy = await randomHbbft.read.isFullHealth();

            await hhViem.assertions.emitWithArgs(
                randomHbbft.write.setCurrentSeed([randomSeed], { account: systemAccount }),
                randomHbbft,
                "SetCurrentSeed",
                [BigInt(blockNumber + 1), randomSeed, healthy],
            );

            assert.equal(await randomHbbft.read.getSeedHistoric([BigInt(blockNumber + 1)]), randomSeed);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });

        it("last 10 seeds must be equal to last 10 elements in the array", async () => {
            const { randomHbbft } = await helpers.loadFixture(deployContracts);

            const systemAccount = await impersonateSystemAcc();
            const seedsArray = new Array<bigint>();

            for (let i = 0; i < 100; ++i) {
                const randomSeed = random(0, Number.MAX_SAFE_INTEGER);
                seedsArray.push(randomSeed);

                await randomHbbft.write.setCurrentSeed([randomSeed], { account: systemAccount });
            }

            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            const currentBlock = await helpers.time.latestBlock();

            assert.equal(await randomHbbft.read.currentSeed(), seedsArray[seedsArray.length - 1]);
            assert.deepEqual(
                await randomHbbft.read.getSeedsHistoric([
                    range(currentBlock - 9, currentBlock + 1).map(BigInt),
                ]),
                seedsArray.slice(-10),
            );
        });
    });

    describe("FullHealth()", async function () {
        it("should display health correctly", async () => {
            const { initialValidators, randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const validators = await validatorSetHbbft.read.getValidators();
            assert.equal(validators.length, initialValidators.length);
            assert.equal(await randomHbbft.read.isFullHealth(), true);

            await validatorSetHbbft.write.kickValidator([validators[1]]);
            assert.equal(await randomHbbft.read.isFullHealth(), false);
        });

        it("should mark unhealty blocks", async () => {
            const { initialValidators, randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const validators = await validatorSetHbbft.read.getValidators();
            assert.equal(validators.length, initialValidators.length);
            assert.equal(await randomHbbft.read.isFullHealth(), true);

            const systemAccount = await impersonateSystemAcc();
            await validatorSetHbbft.write.kickValidator([validators[0]]);

            const blockNumber = await helpers.time.latestBlock();
            const randomSeed = random(0, Number.MAX_SAFE_INTEGER);
            await randomHbbft.write.setCurrentSeed([randomSeed], { account: systemAccount });

            assert.equal(await randomHbbft.read.getSeedHistoric([BigInt(blockNumber + 1)]), randomSeed);
            assert.equal(await randomHbbft.read.isFullHealthHistoric([BigInt(blockNumber + 1)]), false);
            assert.equal(await helpers.time.latestBlock(), blockNumber + 1);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });

        it("should get full health historic array ", async () => {
            const { randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const systemAccount = await impersonateSystemAcc();

            const blocks = new Array<bigint>();
            const expected = new Array<boolean>();

            assert.equal(await randomHbbft.read.isFullHealth(), true);
            const validators = await validatorSetHbbft.read.getValidators();

            let startBlock = await helpers.time.latestBlock();

            for (let i = 0; i < 50; ++i) {
                const randomSeed = random(0, Number.MAX_SAFE_INTEGER);
                await randomHbbft.write.setCurrentSeed([randomSeed], { account: systemAccount });

                blocks.push(BigInt(startBlock + i + 1));
                expected.push(true);
            }

            assert.equal(await randomHbbft.read.isFullHealth(), true);
            await validatorSetHbbft.write.kickValidator([validators[0]]);
            startBlock = await helpers.time.latestBlock();

            for (let i = 0; i < 50; ++i) {
                const randomSeed = random(0, Number.MAX_SAFE_INTEGER);
                await randomHbbft.write.setCurrentSeed([randomSeed], { account: systemAccount });

                blocks.push(BigInt(startBlock + i + 1));
                expected.push(false);
            }

            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            assert.deepEqual(await randomHbbft.read.isFullHealthsHistoric([blocks]), expected);
        });

        it("should be consistent in block healthiness tracking", async () => {
            const { initialValidators, randomHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const systemAccount = await impersonateSystemAcc();
            const validators = await validatorSetHbbft.read.getValidators();

            const blocksSeedHealth = new Map<number, boolean>();

            assert.equal((await validatorSetHbbft.read.getValidators()).length, initialValidators.length);
            assert.equal(await randomHbbft.read.isFullHealth(), true);

            // Block 1: Set to unhealthy by kicking a validator
            await validatorSetHbbft.write.kickValidator([validators[0]]);
            assert.equal((await validatorSetHbbft.read.getValidators()).length, initialValidators.length - 1);
            assert.equal(await randomHbbft.read.isFullHealth(), false);

            // Block 2: Set current seed, should be unhealthy since validators count decreased
            await randomHbbft.write.setCurrentSeed(
                [random(0, Number.MAX_SAFE_INTEGER)],
                { account: systemAccount },
            );
            let latestBlock = await helpers.time.latestBlock();
            assert.equal(await randomHbbft.read.isFullHealthHistoric([BigInt(latestBlock)]), false);
            blocksSeedHealth.set(latestBlock, false);

            // Block 3: Simulate returning to healthy state
            await validatorSetHbbft.write.setValidatorsNum([25n]);
            assert.equal((await validatorSetHbbft.read.getValidators()).length, initialValidators.length);
            assert.equal(await randomHbbft.read.isFullHealth(), true);

            await randomHbbft.write.setCurrentSeed(
                [random(0, Number.MAX_SAFE_INTEGER)],
                { account: systemAccount },
            );
            latestBlock = await helpers.time.latestBlock();
            assert.equal(await randomHbbft.read.isFullHealthHistoric([BigInt(latestBlock)]), true);
            blocksSeedHealth.set(latestBlock, true);

            // Block 4: Another block
            await randomHbbft.write.setCurrentSeed(
                [random(0, Number.MAX_SAFE_INTEGER)],
                { account: systemAccount },
            );
            latestBlock = await helpers.time.latestBlock();
            blocksSeedHealth.set(latestBlock, true);

            for (const [blockNum, healthyValue] of blocksSeedHealth) {
                assert.equal(await randomHbbft.read.isFullHealthHistoric([BigInt(blockNum)]), healthyValue);
            }

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });
    });
});
