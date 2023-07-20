import { ethers, upgrades } from "hardhat";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import {
    RandomHbbft,
    StakingHbbftCoinsMock,
    ValidatorSetHbbftMock,
} from "../src/types";

// delegatecall are a problem for truffle debugger
// therefore it makes sense to use a proxy for automated testing to have the proxy testet.
// and to not use it if specific transactions needs to get debugged,
// like truffle `debug 0xabc`.
const useUpgradeProxy = !(process.env.CONTRACTS_NO_UPGRADE_PROXY == 'true');
console.log('useUpgradeProxy:', useUpgradeProxy);
const logOutput = false;

//smart contracts
let randomHbbft: RandomHbbft;
let validatorSetHbbft: ValidatorSetHbbftMock;
let stakingHbbft: StakingHbbftCoinsMock;

//addresses
let owner: SignerWithAddress;
let accounts: SignerWithAddress[];
let initialValidators: string[];
let initialStakingAddresses: string[];

const minStake = BigNumber.from(ethers.utils.parseEther('1'));
const maxStake = BigNumber.from(ethers.utils.parseEther('100000'));
// one epoch in 1 day.
const stakingFixedEpochDuration = BigNumber.from(86400);

// the transition time window is 1 hour.
const stakingTransitionTimeframeLength = BigNumber.from(3600);

const stakingWithdrawDisallowPeriod = BigNumber.from(1);

// the reward for the first epoch.
const epochReward = BigNumber.from(ethers.utils.parseEther('1'));

const validatorInactivityThreshold = 365 * 86400 // 1 year

const SystemAccountAddress = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";

describe('RandomHbbft', () => {
    async function impersonateSystemAcc() {
        await helpers.impersonateAccount(SystemAccountAddress);

        await owner.sendTransaction({
            to: SystemAccountAddress,
            value: ethers.utils.parseEther('10'),
        });

        return await ethers.getSigner(SystemAccountAddress);
    }

    describe('Initializer', async () => {
        beforeEach('Deploy Contracts', async () => {
            [owner, ...accounts] = await ethers.getSigners();
            const accountAddresses = accounts.map(item => item.address);

            const stubAddress = owner.address;

            initialValidators = accountAddresses.slice(1, 25 + 1); // accounts[1...3]
            initialStakingAddresses = accountAddresses.slice(26, 51); // accounts[4...6]

            expect(initialValidators.length).to.be.equal(25);
            expect(initialStakingAddresses.length).to.be.equal(25);
            expect(initialValidators[0]).to.not.be.equal(ethers.constants.AddressZero);
            expect(initialValidators[1]).to.not.be.equal(ethers.constants.AddressZero);
            expect(initialValidators[2]).to.not.be.equal(ethers.constants.AddressZero);

            // Deploy ValidatorSetHbbft contract
            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            validatorSetHbbft = await upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    '0x1000000000000000000000000000000000000001', // _blockRewardContract
                    stubAddress,                                  // _randomContract
                    stubAddress,                                  // _stakingContract
                    '0x4000000000000000000000000000000000000001', // _keyGenHistoryContract
                    validatorInactivityThreshold,                 // _validatorInactivityThreshold
                    initialValidators,                            // _initialMiningAddresses
                    initialStakingAddresses,                      // _initialStakingAddresses
                ],
                { initializer: 'initialize' }
            ) as ValidatorSetHbbftMock;

            // Deploy RandomHbbft contract
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
            randomHbbft = await upgrades.deployProxy(
                RandomHbbftFactory,
                [
                    owner.address,
                    validatorSetHbbft.address
                ],
                { initializer: 'initialize' }
            ) as RandomHbbft;

            let stakingParams = {
                _validatorSetContract: validatorSetHbbft.address,
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
                initialValidatorsPubKeys.push(ethers.Wallet.createRandom().publicKey);
                initialValidatorsIpAddresses.push('0x00000000000000000000000000000000');
            }

            let initialValidatorsPubKeysSplit = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
                (initialValidatorsPubKeys);

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftCoinsMock");
            //Deploy StakingHbbft contract
            stakingHbbft = await upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    initialValidatorsPubKeysSplit, // _publicKeys
                    initialValidatorsIpAddresses // _internetAddresses
                ],
                { initializer: 'initialize' }
            ) as StakingHbbftCoinsMock;

            // await randomHbbft.setSystemAddress(owner.address);
            await validatorSetHbbft.setSystemAddress(owner.address);
            await validatorSetHbbft.setRandomContract(randomHbbft.address);
            await validatorSetHbbft.setStakingContract(stakingHbbft.address);
        });

        it("should revert initialization with validator contract = address(0)", async () => {
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
            await expect(upgrades.deployProxy(
                RandomHbbftFactory,
                [
                    owner.address,
                    ethers.constants.AddressZero
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('ValidatorSet must not be 0');
        });

        it("should revert initialization with owner = address(0)", async () => {
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
            await expect(upgrades.deployProxy(
                RandomHbbftFactory,
                [
                    ethers.constants.AddressZero,
                    validatorSetHbbft.address
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Owner address must not be 0');
        });

        it("should not allow initialization if initialized contract", async () => {
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
            const contract = await upgrades.deployProxy(
                RandomHbbftFactory,
                [
                    owner.address,
                    validatorSetHbbft.address
                ],
                { initializer: 'initialize' }
            );

            expect(await contract.deployed());

            await expect(contract.initialize(
                owner.address,
                validatorSetHbbft.address
            )).to.be.revertedWith('Initializable: contract is already initialized');
        });

        describe("currentSeed()", async () => {
            it('setCurrentSeed must revert if called by non-owner', async () => {
                await expect(randomHbbft.setCurrentSeed(100))
                    .to.be.revertedWith('Must be executed by System');
            });

            it('should set current seed by system', async function () {
                const systemSigner = await impersonateSystemAcc();

                await validatorSetHbbft.setIsFullHealth(true);

                const blockNumber = await helpers.time.latestBlock();
                const randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));

                await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

                expect(await randomHbbft.getSeedHistoric(blockNumber + 1)).to.equal(randomSeed);

                await helpers.stopImpersonatingAccount(SystemAccountAddress);
            });

            it('last 10 seeds must be equal to last 10 elements in the array', async () => {
                const systemSigner = await impersonateSystemAcc();
                let seedsArray = new Array<BigNumber>();

                for (let i = 0; i < 100; i++) {
                    let randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));
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
            // it('should display health correctly', async () => {
            //     ((await validatorSetHbbft.getValidators()).length).should.be.equal(25);
            //     (await randomHbbft.isFullHealth()).should.be.equal(true);
            //     await validatorSetHbbft.connect(owner).removeMaliciousValidators([accounts[15].address]);
            //     ((await validatorSetHbbft.getValidators()).length).should.be.equal(24);
            //     (await randomHbbft.isFullHealth()).should.be.equal(false);
            // });

            // it('should set historical FullHealth() value as true when the block is healthy', async () => {
            //     let randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));
            //     // storing current seed and the health state of the network, network is healthy with 25 validators
            //     await randomHbbft.connect(owner).setCurrentSeed(randomSeed);
            //     ((await validatorSetHbbft.getValidators()).length).should.be.equal(25);

            //     // removing a validator so the network is not healthy
            //     await validatorSetHbbft.connect(owner).removeMaliciousValidators([accounts[15].address]);

            //     randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));
            //     // storing current seed and the health state of the network, network is NOT healthy with 24 validators
            //     await randomHbbft.connect(owner).setCurrentSeed(randomSeed);
            //     ((await validatorSetHbbft.getValidators()).length).should.be.equal(24);
            //     // getting historical health values for both previous and current block
            //     let blockNumber = await ethers.provider.getBlockNumber();
            //     (await randomHbbft.isFullHealthsHistoric([blockNumber, blockNumber - 1])).should.be.deep.equal([false, true]);
            // });

            it('should display health correctly', async() => {
                let healthy = false;

                await validatorSetHbbft.setIsFullHealth(healthy);
                expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);

                healthy = true;

                await validatorSetHbbft.setIsFullHealth(healthy);
                expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);
            });

            it('should mark unhealty blocks', async() => {
                let healthy = false;

                await validatorSetHbbft.setIsFullHealth(healthy);
                expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);

                const systemSigner = await impersonateSystemAcc();

                const blockNumber = await helpers.time.latestBlock();
                const randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));

                await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

                expect(await randomHbbft.getSeedHistoric(blockNumber + 1)).to.equal(randomSeed);
                expect(await randomHbbft.isFullHealthHistoric(blockNumber + 1)).to.equal(healthy);

                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                healthy = true;
                await validatorSetHbbft.setIsFullHealth(true);
            });

            it('should get full health historic array ', async () => {
                const systemSigner = await impersonateSystemAcc();

                let blocks = new Array<BigNumber>();
                let expected = new Array<boolean>();

                let healthy = true;
                await validatorSetHbbft.setIsFullHealth(healthy);
                expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);

                let startBlock = await helpers.time.latestBlock();

                for (let i = 0; i < 50; ++i) {
                    const randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));

                    await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

                    blocks.push(BigNumber.from(startBlock).add(i + 1));
                    expected.push(healthy);
                }

                healthy = false;
                await validatorSetHbbft.setIsFullHealth(healthy);
                expect(await randomHbbft.isFullHealth()).to.be.equal(healthy);

                startBlock = await helpers.time.latestBlock();

                for (let i = 0; i < 50; ++i) {
                    const randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));

                    await randomHbbft.connect(systemSigner).setCurrentSeed(randomSeed);

                    blocks.push(BigNumber.from(startBlock).add(i + 1));
                    expected.push(healthy);
                }

                await helpers.stopImpersonatingAccount(SystemAccountAddress);

                const result = await randomHbbft.isFullHealthsHistoric(blocks);

                expect(result).to.be.deep.equal(expected);
            });
        })
    });
});

function random(low: number, high: number) {
    return Math.floor((Math.random() * (high - low) + low));
}

const range = (start: number, end: number) => Array.from({ length: (end - start) }, (v, k) => k + start);
