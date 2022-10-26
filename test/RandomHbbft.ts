import { ethers, network, upgrades } from "hardhat";

import {
    AdminUpgradeabilityProxy,
    RandomHbbftMock,
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

//addresses
let owner: SignerWithAddress;
let accounts: SignerWithAddress[];

let seedsArray: BigNumber[] = [];

describe('RandomHbbft', () => {
    describe('Initializer', async () => {
        it('Deploy Contracts', async () => {
            [owner, ...accounts] = await ethers.getSigners();
            const AdminUpgradeabilityProxyFactory = await ethers.getContractFactory("AdminUpgradeabilityProxy")
            // Deploy BlockRewardHbbft contract
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbftMock");
            randomHbbft = await RandomHbbftFactory.deploy() as RandomHbbftMock;
            if (useUpgradeProxy) {
                adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(randomHbbft.address, owner.address, []);
                randomHbbft = await ethers.getContractAt("RandomHbbftMock", adminUpgradeabilityProxy.address);
            }
            await randomHbbft.setSystemAddress(owner.address).should.be.fulfilled;
        });

        it('random seed generation for multiple blocks ', async () => {
            for (let i = 0; i < 100; i++) {
                let randomSeed = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));
                seedsArray.push(randomSeed);
                await randomHbbft.connect(owner).setCurrentSeed(randomSeed).should.be.fulfilled;
            }
        })

        it('last 10 seeds must be equal to last 10 elements in the array', async () => {
            let currentBlock = Number(await ethers.provider.getBlockNumber());
            (await randomHbbft.currentSeed()).should.be.equal(seedsArray[seedsArray.length - 1]);
            (await randomHbbft.getHistoricalSeeds(range(currentBlock - 9, currentBlock + 1))).should.be.deep.equal(seedsArray.slice(-10))
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
