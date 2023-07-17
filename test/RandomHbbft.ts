import { ethers, upgrades } from "hardhat";

import {
    RandomHbbftMock,
    StakingHbbftCoinsMock,
    ValidatorSetHbbftMock,
} from "../src/types";

import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import fp from "lodash/fp";

const testdata = require('./testhelpers/data');

require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bn')(BigNumber))
    .should();

// delegatecall are a problem for truffle debugger
// therefore it makes sense to use a proxy for automated testing to have the proxy testet.
// and to not use it if specific transactions needs to get debugged,
// like truffle `debug 0xabc`.
const useUpgradeProxy = !(process.env.CONTRACTS_NO_UPGRADE_PROXY == 'true');
console.log('useUpgradeProxy:', useUpgradeProxy);
const logOutput = false;

//smart contracts
let randomHbbft: RandomHbbftMock;
let validatorSetHbbft: ValidatorSetHbbftMock;
let stakingHbbft: StakingHbbftCoinsMock;

//addresses
let owner: SignerWithAddress;
let accounts: SignerWithAddress[];
let initialValidators: string[];
let initialStakingAddresses: string[];

let seedsArray: BigNumber[] = [];

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

describe('RandomHbbft', () => {
    describe('Initializer', async () => {

        beforeEach('Deploy Contracts', async () => {
            [owner, ...accounts] = await ethers.getSigners();
            const accountAddresses = accounts.map(item => item.address);

            const stubAddress = owner.address;

            initialValidators = accountAddresses.slice(1, 25 + 1); // accounts[1...3]
            initialStakingAddresses = accountAddresses.slice(26, 51); // accounts[4...6]
            initialValidators.length.should.be.equal(25);
            initialStakingAddresses.length.should.be.equal(25);
            initialValidators[0].should.not.be.equal('0x0000000000000000000000000000000000000000');
            initialValidators[1].should.not.be.equal('0x0000000000000000000000000000000000000000');
            initialValidators[2].should.not.be.equal('0x0000000000000000000000000000000000000000');

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
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbftMock");
            randomHbbft = await upgrades.deployProxy(
                RandomHbbftFactory,
                [
                    owner.address,
                    validatorSetHbbft.address
                ],
                { initializer: 'initialize' }
            ) as RandomHbbftMock;

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

            await randomHbbft.setSystemAddress(owner.address);
            await validatorSetHbbft.setSystemAddress(owner.address);
            await validatorSetHbbft.setRandomContract(randomHbbft.address);
            await validatorSetHbbft.setStakingContract(stakingHbbft.address);
        });

        describe("currentSeed()", async () => {
            it('last 10 seeds must be equal to last 10 elements in the array', async () => {
                for (let i = 0; i < 100; i++) {
                    let randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));
                    seedsArray.push(randomSeed);
                    await randomHbbft.connect(owner).setCurrentSeed(randomSeed);
                }
                let currentBlock = Number(await ethers.provider.getBlockNumber());
                (await randomHbbft.currentSeed()).should.be.equal(seedsArray[seedsArray.length - 1]);
                (await randomHbbft.getSeedsHistoric(range(currentBlock - 9, currentBlock + 1))).should.be.deep.equal(seedsArray.slice(-10));
            })

            it('setCurrentSeed must revert if called by non-owner', async () => {
                await randomHbbft.connect(accounts[7]).setCurrentSeed(100).should.be.rejected;
            })
        })

        // describe("FullHealth()", async function () {
        //     it('should display health correctly', async () => {
        //         ((await validatorSetHbbft.getValidators()).length).should.be.equal(25);
        //         (await randomHbbft.isFullHealth()).should.be.equal(true);
        //         await validatorSetHbbft.connect(owner).removeMaliciousValidators([accounts[15].address]);
        //         ((await validatorSetHbbft.getValidators()).length).should.be.equal(24);
        //         (await randomHbbft.isFullHealth()).should.be.equal(false);
        //     })

        //     it('should set historical FullHealth() value as true when the block is healthy', async () => {
        //         let randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));
        //         // storing current seed and the health state of the network, network is healthy with 25 validators
        //         await randomHbbft.connect(owner).setCurrentSeed(randomSeed);
        //         ((await validatorSetHbbft.getValidators()).length).should.be.equal(25);

        //         // removing a validator so the network is not healthy
        //         await validatorSetHbbft.connect(owner).removeMaliciousValidators([accounts[15].address]);

        //         randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));
        //         // storing current seed and the health state of the network, network is NOT healthy with 24 validators
        //         await randomHbbft.connect(owner).setCurrentSeed(randomSeed);
        //         ((await validatorSetHbbft.getValidators()).length).should.be.equal(24);
        //         // getting historical health values for both previous and current block
        //         let blockNumber = await ethers.provider.getBlockNumber();
        //         (await randomHbbft.isFullHealthsHistoric([blockNumber, blockNumber - 1])).should.be.deep.equal([false, true]);
        //     })
        // })
    }); // describe

}); // contract

function random(low: number, high: number) {
    return Math.floor((Math.random() * (high - low) + low));
}

const range = (start: number, end: number) => Array.from({ length: (end - start) }, (v, k) => k + start);
