import { ethers, upgrades } from "hardhat";

import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import {
    BlockRewardHbbftMock,
    RandomHbbft,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    KeyGenHistory,
    TxPermissionHbbft,
    CertifierHbbft,
    ConnectivityTrackerHbbftMock
} from "../src/types";

import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Permission } from "./testhelpers/Permission";
import { expect } from "chai";

const testdata = require('./testhelpers/data');

require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bn')(BigNumber))
    .should();

const logOutput = false;

//smart contracts
let blockRewardHbbft: BlockRewardHbbftMock;
let randomHbbft: RandomHbbft;
let validatorSetHbbft: ValidatorSetHbbftMock;
let stakingHbbft: StakingHbbftMock;
let keyGenHistory: KeyGenHistory;
let txPermission: TxPermissionHbbft;
let certifier: CertifierHbbft;
let connectivityTracker: ConnectivityTrackerHbbftMock;

let keyGenHistoryPermission: Permission<KeyGenHistory>;

//addresses
let owner: SignerWithAddress;
let accounts: SignerWithAddress[];
let accountAddresses: string[];
let miningAddresses: string[];
let stakingAddresses: string[];
let initializingMiningAddresses: string[];
let initializingStakingAddresses: string[];

//consts
let candidateMinStake = BigNumber.from(ethers.utils.parseEther('2'));
let delegatorMinStake = BigNumber.from(ethers.utils.parseEther('1'));
let maxStake = BigNumber.from(ethers.utils.parseEther('100000'));

describe.skip('KeyGenHistory', () => {
    describe('Deployment', async () => {
        //this info does not match the mininAccounts, but thats not a problem for this tests.
        let publicKeys = [
            '0x1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1',
            '0x1BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1',
            '0x2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2',
            '0x2BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2',
            '0x3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA3',
            '0x3BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB3'
        ];


        let initialValidatorsIpAddresses = [
            '0x10100000000000000000000000000000',
            '0x20200000000000000000000000000000',
            '0x30300000000000000000000000000000'];

        const { parts, acks } = testdata.getTestPartNAcks();

        // one epoch in 1000 seconds.
        const stakingEpochDuration = BigNumber.from(1000);

        // the transition time window is 100 seconds.
        const stakingTransitionwindowLength = BigNumber.from(100);

        const stakingWithdrawDisallowPeriod = BigNumber.from(100);

        const validatorInactivityThreshold = 365 * 86400 // 1 year

        it('Deploy Contracts', async () => {
            [owner, ...accounts] = await ethers.getSigners();
            const stubAddress = owner.address;

            accountAddresses = accounts.map(item => item.address);

            miningAddresses = accountAddresses.slice(11, 20);
            stakingAddresses = accountAddresses.slice(21, 30);

            initializingMiningAddresses = miningAddresses.slice(0, 3);
            initializingStakingAddresses = stakingAddresses.slice(0, 3);

            if (logOutput) {
                console.log('initial Mining Addresses', initializingMiningAddresses);
                console.log('initial Staking Addresses', initializingStakingAddresses);
            }

            const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbftMock");
            connectivityTracker = await upgrades.deployProxy(ConnectivityTrackerFactory) as ConnectivityTrackerHbbftMock;
            await connectivityTracker.deployed();

            // Deploy ValidatorSet contract
            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            validatorSetHbbft = await upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    stubAddress,                  // _blockRewardContract
                    stubAddress,                  // _randomContract
                    stubAddress,                  // _stakingContract
                    stubAddress,                  // _keyGenHistoryContract
                    validatorInactivityThreshold, // _validatorInactivityThreshold
                    initializingMiningAddresses,  // _initialMiningAddresses
                    initializingStakingAddresses, // _initialStakingAddresses
                ],
                { initializer: 'initialize' }
            ) as ValidatorSetHbbftMock;

            // Deploy BlockRewardHbbft contract
            const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
            blockRewardHbbft = await upgrades.deployProxy(
                BlockRewardHbbftFactory,
                [
                    owner.address,
                    validatorSetHbbft.address,
                    connectivityTracker.address
                ],
                { initializer: 'initialize' }
            ) as BlockRewardHbbftMock;

            // Deploy BlockRewardHbbft contract
            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
            randomHbbft = await upgrades.deployProxy(
                RandomHbbftFactory,
                [
                    owner.address,
                    validatorSetHbbft.address
                ],
                { initializer: 'initialize' }
            ) as RandomHbbft;

            const stakingParams = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initializingStakingAddresses,
                _delegatorMinStake: delegatorMinStake,
                _candidateMinStake: candidateMinStake,
                _maxStake: maxStake,
                _stakingFixedEpochDuration: stakingEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionwindowLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            // Deploy BlockRewardHbbft contract
            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            stakingHbbft = await upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams,
                    publicKeys,
                    initialValidatorsIpAddresses
                ],
                { initializer: 'initialize' }
            ) as StakingHbbftMock;

            const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
            keyGenHistory = await upgrades.deployProxy(
                KeyGenFactory,
                [
                    owner.address,
                    validatorSetHbbft.address,
                    initializingMiningAddresses,
                    parts,
                    acks
                ],
                { initializer: 'initialize' }
            ) as KeyGenHistory;

            // Deploy Certifier contract
            const CertifierFactory = await ethers.getContractFactory("CertifierHbbft");
            certifier = await upgrades.deployProxy(
                CertifierFactory,
                [
                    [owner.address],
                    validatorSetHbbft.address,
                    owner.address
                ],
                { initializer: 'initialize' }
            ) as CertifierHbbft;

            // Deploy TxPermission contract
            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");
            txPermission = await upgrades.deployProxy(
                TxPermissionFactory,
                [
                    [owner.address],
                    certifier.address,
                    validatorSetHbbft.address,
                    keyGenHistory.address,
                    stubAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            ) as TxPermissionHbbft;

            keyGenHistoryPermission = new Permission(txPermission, keyGenHistory, logOutput);

            await validatorSetHbbft.setBlockRewardContract(blockRewardHbbft.address);
            await validatorSetHbbft.setRandomContract(randomHbbft.address);
            await validatorSetHbbft.setStakingContract(stakingHbbft.address);
            await validatorSetHbbft.setKeyGenHistoryContract(keyGenHistory.address);

            const validators = await validatorSetHbbft.getValidators();

            validators.should.be.deep.equal(initializingMiningAddresses);
        });

        it('should revert initialization with owner = address(0)', async () => {
            const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
            await expect(upgrades.deployProxy(
                KeyGenFactory,
                [
                    ethers.constants.AddressZero,
                    validatorSetHbbft.address,
                    initializingMiningAddresses,
                    parts,
                    acks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Owner address must not be 0');
        });

        it('should revert initialization with validator contract address = address(0)', async () => {
            const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
            await expect(upgrades.deployProxy(
                KeyGenFactory,
                [
                    owner.address,
                    ethers.constants.AddressZero,
                    initializingMiningAddresses,
                    parts,
                    acks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Validator contract address cannot be 0.');
        });

        it('should revert initialization with empty validators array', async () => {
            const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
            await expect(upgrades.deployProxy(
                KeyGenFactory,
                [
                    owner.address,
                    validatorSetHbbft.address,
                    [],
                    parts,
                    acks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Validators must be more than 0.');
        });

        it('should revert initialization with wrong number of parts', async () => {
            const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");

            await expect(upgrades.deployProxy(
                KeyGenFactory,
                [
                    owner.address,
                    validatorSetHbbft.address,
                    initializingMiningAddresses,
                    [],
                    acks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Wrong number of Parts!');
        });

        it('should revert initialization with wrong number of acks', async () => {
            const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");

            await expect(upgrades.deployProxy(
                KeyGenFactory,
                [
                    owner.address,
                    validatorSetHbbft.address,
                    initializingMiningAddresses,
                    parts,
                    []
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWith('Wrong number of Acks!');
        });

        it('should not allow initialization if initialized contract', async () => {
            const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
            const contract = await upgrades.deployProxy(
                KeyGenFactory,
                [
                    owner.address,
                    validatorSetHbbft.address,
                    initializingMiningAddresses,
                    parts,
                    acks
                ],
                { initializer: 'initialize' }
            );

            expect(await contract.deployed());

            await expect(contract.initialize(
                owner.address,
                validatorSetHbbft.address,
                initializingMiningAddresses,
                parts,
                acks
            )).to.be.revertedWith('Initializable: contract is already initialized');
        });

        it('should restrict calling clearPrevKeyGenState to ValidatorSet contract', async function() {
            const caller = accounts[5];

            await expect(keyGenHistory.connect(caller).clearPrevKeyGenState([]))
                .to.be.revertedWith("Must by executed by validatorSetContract");
        });

        it('should restrict calling notifyNewEpoch to ValidatorSet contract', async function() {
            const caller = accounts[5];

            await expect(keyGenHistory.connect(caller).notifyNewEpoch())
                .to.be.revertedWith("Must by executed by validatorSetContract");
        });

        it('should restrict calling notifyKeyGenFailed to ValidatorSet contract', async function() {
            const caller = accounts[5];

            await expect(keyGenHistory.connect(caller).notifyKeyGenFailed())
                .to.be.revertedWith("Must by executed by validatorSetContract");
        });


        it('failed KeyGeneration, availability.', async () => {

            // console.log('start failed key gen');
            // await timeTravelToTransition();
            // console.log('transition OK');
            // await timeTravelToEndEpoch();
            // console.log('end epoch');

            const stakingBanned = await validatorSetHbbft.bannedUntil(stakingAddresses[0]);
            const miningBanned = await validatorSetHbbft.bannedUntil(miningAddresses[0]);
            const currentTS = await helpers.time.latest();
            const newPoolStakingAddress = stakingAddresses[4];
            const newPoolMiningAddress = miningAddresses[4];

            if (logOutput) {
                console.log('stakingBanned?', stakingBanned);
                console.log('miningBanned?', miningBanned);
                console.log('currentTS:', currentTS);
                console.log('newPoolStakingAddress:', newPoolStakingAddress);
                console.log('newPoolMiningAddress:', newPoolMiningAddress);
            }

            false.should.be.equal(await stakingHbbft.isPoolActive(newPoolStakingAddress));

            await stakingHbbft.connect(await ethers.getSigner(newPoolStakingAddress)).addPool(newPoolMiningAddress, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: candidateMinStake });

            //await stakingHbbft.addPool(miningAddresses[5], '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            //'0x00000000000000000000000000000000', {from: stakingAddresses[5], value: candidateMinStake});

            const poolIsActiveNow = await stakingHbbft.isPoolActive(newPoolStakingAddress);
            poolIsActiveNow.should.be.equal(true);

            //await stakingHbbft.stake(stakingAddresses[0], {from: stakingAddresses[0], value: candidateMinStake});
            //await stakingHbbft.stake(stakingAddresses[1], {from: stakingAddresses[1], value: candidateMinStake});
            //await stakingHbbft.stake(stakingAddresses[2], {from: stakingAddresses[2], value: candidateMinStake});

            await printValidatorState('after staking on new Pool:');
            await timeTravelToTransition();
            await printValidatorState('after travel to transition:');

            // let isPending = await validatorSetHbbft.isPendingValidator(miningAddresses[0]);
            // console.log('isPending?', isPending);

            // let validators = await validatorSetHbbft.getValidators();
            // console.log('validators while pending: ', validators);

            await timeTravelToEndEpoch();

            // the pools did not manage to write it's part and acks.

            await printValidatorState('after failure:');

            (await stakingHbbft.getPoolsToBeElected()).should.be.deep.equal([]);
            (await stakingHbbft.getPoolsInactive()).should.be.deep.equal([newPoolStakingAddress]);

            // pending validators still should not have changed, since we dit not call end block.
            // WIP: this test currently failes. one of the initial validators takes over the list of pending validators
            // what should it be anyway ? the original validators ?
            // they are gone :-o
            //(await validatorSetHbbft.getPendingValidators()).should.be.deep.equal([]);


            // announcing availability.
            // this should place us back on the list of active and available pools.
            await announceAvailability(newPoolMiningAddress);

            await printValidatorState('after announceAvailability:');

            // pool is available again!
            (await stakingHbbft.getPoolsToBeElected()).should.be.deep.equal([newPoolStakingAddress]);
            (await stakingHbbft.getPoolsInactive()).should.be.deep.equal([]);


            // the original validators took over.
            // lets travel again to the end of the epoch, to switch into the next epoch
            // to invoke another voting.

            //write the PART and ACK for the pending validator:

            const pendingValidators = await validatorSetHbbft.getPendingValidators();

            // since there was never  another electable candidate, the system should still
            // tread the one and only pending validator still as pending validator.
            pendingValidators.should.be.deep.equal([newPoolMiningAddress]);



            // since the initial round was failed, we are in the second round.
            const currentRoundCounter = '2';

            await writePart('1', currentRoundCounter, parts[0], pendingValidators[0]);

            //confirm that part was written.
            const partFromBc = await keyGenHistory.getPart(pendingValidators[0]);
            partFromBc.should.be.equal('0x' + parts[0].toString('hex')); //TODO! what was it supposed to be? , partFromBc, 'parts read from the blockchain require to be equal to the written data.'

            await writeAcks('1', currentRoundCounter, acks[0], pendingValidators[0]);

            await timeTravelToEndEpoch();

            let epoch = (await stakingHbbft.stakingEpoch());

            await printValidatorState('epoch1 start:');

            epoch.should.be.equal(BigNumber.from('1'));


            await timeTravelToTransition();

            await printValidatorState('epoch1 phase2:');

            // // now write the ACK and the PART:
            await writePart('2', '1', parts[0], newPoolMiningAddress);
            await writeAcks('2', '1', acks[0], newPoolMiningAddress);

            // it's now job of the current validators to verify the correct write of the PARTS and ACKS
            // (this is simulated by the next call)
            await timeTravelToEndEpoch();

            // now everything is fine, we can do the transition after failing
            // the first one.

            epoch = (await stakingHbbft.stakingEpoch());
            await printValidatorState('epoch2 start:');
            epoch.should.be.equal(BigNumber.from('2'));

            // // now the new node should be a validator.
            (await validatorSetHbbft.getValidators()).should.be.deep.equal([newPoolMiningAddress]);

        });

        it('1/2 KeyGeneration - PART Failure', async () => {
            //tests a 2 validators setup.
            // 1 manages to write it's part.
            // 1 does not manage to write it's part.
            // expected behavior:
            // system goes into an extra key gen round,
            // without the failing party as pending validator.
            // even if the failing party manages to announce availability
            // within the extra-key-gen round he wont be picked up this round.

            const poolStakingAddress1 = stakingAddresses[4];
            const poolMiningAddress1 = miningAddresses[4];

            // address1 is already picked up and a validator.
            // we double check if he is also marked for being available:

            let validatorAvailableSince = await validatorSetHbbft.validatorAvailableSince(poolMiningAddress1);
            validatorAvailableSince.should.not.be.equal(BigNumber.from('0'));

            const poolStakingAddress2 = stakingAddresses[5];
            const poolMiningAddress2 = miningAddresses[5];

            await stakingHbbft.connect(await ethers.getSigner(poolStakingAddress2)).addPool(poolMiningAddress2, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                '0x00000000000000000000000000000000', { value: candidateMinStake });

            await printValidatorState('After adding mining address2:');
            await timeTravelToTransition();
            await printValidatorState('validator2 pending:');

            // now let pending validator 2 write it's Part,
            // but pending validator 1 misses out to write it's part.

            await writePart('3', '1', parts[0], poolMiningAddress2);

            await writeAcks('3', '1', acks[0], poolMiningAddress2).should.be.rejected;

            if (logOutput) {
                console.log('numberOfPartsWritten: ', await keyGenHistory.numberOfPartsWritten());
                console.log('numberOfAcksWritten: ', await keyGenHistory.numberOfAcksWritten());
            }


            await timeTravelToEndEpoch();

            await printValidatorState('failedEnd:');

            // another TimeTravel to end epoch happened,
            // we expect that there was NO epoch change.
            // since Validator 1 failed writing his keys.
            let epoch = (await stakingHbbft.stakingEpoch());
            epoch.should.be.equal(BigNumber.from('2'));

            // we expect Validator 1 now to be marked as unavailable,
            // since he failed to write his key.
            validatorAvailableSince = await validatorSetHbbft.validatorAvailableSince(poolMiningAddress1);
            validatorAvailableSince.should.be.equal(BigNumber.from('0'));

            // and only validator 2 is part of the Set.
            // validator 2 needs to write his keys again.
            const pendingValidators = await validatorSetHbbft.getPendingValidators();
            pendingValidators.should.be.deep.equal([poolMiningAddress2]);

        });

    }); // describe
    describe('Certifier', async () => {
        it("Owner must be able to certify any user", async () => {
            await certifier.connect(owner).certify(accounts[35].address);
            (await certifier.certified(accounts[35].address)).should.be.equal(true);
            (await certifier.certifiedExplicitly(accounts[35].address)).should.be.equal(true);
        });

        it("Mining addresses with pools should be certified by default", async () => {
            (await certifier.certified(miningAddresses[1])).should.be.equal(true);
            (await certifier.certifiedExplicitly(miningAddresses[1])).should.be.equal(false);
        })

        it("Should be able to revoke from non-validators", async () => {
            await certifier.connect(owner).revoke(accounts[35].address);
            (await certifier.certified(accounts[35].address)).should.be.equal(false);
        });

        it("Shouldn't be able to revoke from working validators", async () => {
            await certifier.connect(owner).revoke(miningAddresses[1]);
            (await certifier.certified(miningAddresses[1])).should.be.equal(true);
        })

        it("Shouldn't be able to certify zero address", async () => {
            await certifier.connect(owner).certify("0x0000000000000000000000000000000000000000").should.be.rejectedWith("certifier must not be address 0");
        })
    })
}); // contract


async function printValidatorState(info: string) {

    if (!logOutput) {
        return;
    }
    const validators = await validatorSetHbbft.getValidators();
    const pendingValidators = await validatorSetHbbft.getPendingValidators();

    //Note: toBeElected are Pool (staking) addresses, and not Mining adresses.
    // all other adresses are mining adresses.
    const toBeElected = await stakingHbbft.getPoolsToBeElected();
    const pools = await stakingHbbft.getPools();
    const poolsInactive = await stakingHbbft.getPoolsInactive();
    const epoch = await stakingHbbft.stakingEpoch();

    console.log(info + ' epoch : ', epoch);
    console.log(info + ' pending   :', pendingValidators);
    console.log(info + ' validators:', validators);
    console.log(info + ' pools: ', pools);
    console.log(info + ' inactive pools: ', poolsInactive);
    console.log(info + ' pools toBeElected: ', toBeElected);
}

// checks if a validator is able to write parts for free
// and executes it.
// NOTE: It does not really send the transaction with 0 gas price,
// because that would only work if the network nodes would already
// run on the test contracts deployed here.
async function writePart(upcommingEpochNumber: string, round: string, parts: any, from: string) {

    await keyGenHistoryPermission.callFunction('writePart', from, [upcommingEpochNumber, round, parts]);
}

async function writeAcks(upcommingEpochNumber: string, round: string, parts: any, from: string) {
    await keyGenHistoryPermission.callFunction('writeAcks', from, [upcommingEpochNumber, round, parts]);
}


async function announceAvailability(pool: string) {

    const blockNumber = await ethers.provider.getBlockNumber()
    const block = await ethers.provider.getBlock(blockNumber);
    const asEncoded = validatorSetHbbft.interface.encodeFunctionData("announceAvailability", [blockNumber, block.hash]);
    if (logOutput) {
        console.log('calling: announceAvailability');
        console.log('pool: ', pool)
        console.log('ecodedCall: ', asEncoded);
    }

    const allowedTxType = await txPermission.allowedTxTypes(pool, validatorSetHbbft.address, '0x0' /* value */, '0x0' /* gas price */, asEncoded);

    //console.log(allowedTxType.typesMask.toString());
    // don't ask to cache this result.
    allowedTxType.cache.should.be.equal(false);

    /// 0x01 - basic transaction (e.g. ether transferring to user wallet);
    /// 0x02 - contract call;
    /// 0x04 - contract creation;
    /// 0x08 - private transaction.

    allowedTxType.typesMask.should.be.equal(BigNumber.from('2'), 'Transaction should be allowed according to TxPermission Contract.');

    // we know now, that this call is allowed.
    // so we can execute it.
    await (await ethers.getSigner(pool)).sendTransaction({ to: validatorSetHbbft.address, data: asEncoded });


}

async function callReward(isEpochEndBlock: boolean) {
    // console.log('getting validators...');
    // note: this call used to crash because of a internal problem with a previous call of evm_mine and evm_increase_time https://github.com/DMDcoin/hbbft-posdao-contracts/issues/13
    // console.log('got validators:', validators);
    await blockRewardHbbft.setSystemAddress(owner.address);
    await blockRewardHbbft.connect(owner).reward(isEpochEndBlock);
    await blockRewardHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE');
}

// time travels forward to the beginning of the next transition,
// and simulate a block mining (calling reward())
async function timeTravelToTransition() {
    let currentTimestamp = await helpers.time.latest();
    let startTimeOfNextPhaseTransition = await stakingHbbft.startTimeOfNextPhaseTransition();

    if (logOutput) {
        console.log(`timetraveling from ${currentTimestamp} to ${startTimeOfNextPhaseTransition}`);
    }

    await helpers.time.increaseTo(startTimeOfNextPhaseTransition);
    await callReward(false);
}

async function timeTravelToEndEpoch() {
    // todo: mimic the behavor of the nodes here:
    // if The Validators managed to write the correct number
    // of Acks and Parts, we are happy and set a "true"
    // if not, we send a "false"
    // note: the Nodes they DO check if the ACKS and PARTS
    // make it possible to generate a treshold key here,
    // but within the tests, we just mimic this behavior.
    const callResult = await keyGenHistory.getNumberOfKeyFragmentsWritten();

    const numberOfParts = callResult['0'].toNumber();
    const numberOfAcks = callResult['1'].toNumber();

    const pendingValidators = await validatorSetHbbft.getPendingValidators();
    const numberOfPendingValidators = pendingValidators.length;
    let callRewardParameter = (numberOfParts === numberOfPendingValidators && numberOfAcks === numberOfPendingValidators);

    const endTimeOfCurrentEpoch = await stakingHbbft.stakingFixedEpochEndTime();

    await helpers.time.increaseTo(endTimeOfCurrentEpoch);
    await callReward(callRewardParameter);
}
