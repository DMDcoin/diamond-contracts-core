import { ethers, network, upgrades } from "hardhat";

import {
    AdminUpgradeabilityProxy,
    RandomHbbftMock,
    ValidatorSetHbbftMock,
} from "../src/types";

import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

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
let adminUpgradeabilityProxy: AdminUpgradeabilityProxy;
let randomHbbft: RandomHbbftMock;
let validatorSetHbbft: ValidatorSetHbbftMock;

//addresses
let owner: SignerWithAddress;
let accounts: SignerWithAddress[];

let seedsArray: BigNumber[] = [];

describe('RandomHbbft', () => {
    describe('Initializer', async () => {

        it('Deploy Contracts', async () => {
            [owner, ...accounts] = await ethers.getSigners();
            let initialValidators: string[];
            let initialStakingAddresses: string[];
            const accountAddresses = accounts.map(item => item.address);

            initialValidators = accountAddresses.slice(1, 16 + 1); // accounts[1...3]
            initialStakingAddresses = accountAddresses.slice(17, 33); // accounts[4...6]
            initialValidators.length.should.be.equal(16);
            initialValidators[0].should.not.be.equal('0x0000000000000000000000000000000000000000');
            initialValidators[1].should.not.be.equal('0x0000000000000000000000000000000000000000');
            initialValidators[2].should.not.be.equal('0x0000000000000000000000000000000000000000');
            const AdminUpgradeabilityProxyFactory = await ethers.getContractFactory("AdminUpgradeabilityProxy")
            // Deploy RandomHbbft contract
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbftMock");
            randomHbbft = await RandomHbbftFactory.deploy() as RandomHbbftMock;
            if (useUpgradeProxy) {
                adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(randomHbbft.address, owner.address, []);
                randomHbbft = await ethers.getContractAt("RandomHbbftMock", adminUpgradeabilityProxy.address);
            }

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            validatorSetHbbft = await ValidatorSetFactory.deploy() as ValidatorSetHbbftMock;
            if (useUpgradeProxy) {
                adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(validatorSetHbbft.address, owner.address, []);
                validatorSetHbbft = await ethers.getContractAt("ValidatorSetHbbftMock", adminUpgradeabilityProxy.address);
            }

            await validatorSetHbbft.initialize(
                '0x1000000000000000000000000000000000000001', // _blockRewardContract
                randomHbbft.address, // _randomContract
                '0x3000000000000000000000000000000000000001', // _stakingContract
                '0x4000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            );

            await randomHbbft.setSystemAddress(owner.address);
            await randomHbbft.initialize(validatorSetHbbft.address)
        });

        it('random seed generation for multiple blocks ', async () => {
            for (let i = 0; i < 100; i++) {
                let randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));
                seedsArray.push(randomSeed);
                await randomHbbft.connect(owner).setCurrentSeed(randomSeed);
            }
        })

        it('last 10 seeds must be equal to last 10 elements in the array', async () => {
            let currentBlock = Number(await ethers.provider.getBlockNumber());
            (await randomHbbft.currentSeed()).should.be.equal(seedsArray[seedsArray.length - 1]);
            (await randomHbbft.getSeedsHistoric(range(currentBlock - 9, currentBlock + 1))).should.be.deep.equal(seedsArray.slice(-10));
        })

        it('setCurrentSeed must revert if called by non-owner', async () => {
            await randomHbbft.connect(accounts[7]).setCurrentSeed(100).should.be.rejected;
        })
    }); // describe

}); // contract

function random(low: number, high: number) {
    return Math.floor((Math.random() * (high - low) + low));
}

const range = (start: number, end: number) => Array.from({ length: (end - start) }, (v, k) => k + start);
