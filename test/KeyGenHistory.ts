import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import {
    BlockRewardHbbftMock,
    RandomHbbft,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    KeyGenHistory,
    TxPermissionHbbft,
    CertifierHbbft
} from "../src/types";


import { getTestPartNAcks } from './testhelpers/data';
import { Permission } from "./testhelpers/Permission";

const logOutput = false;

const candidateMinStake = ethers.parseEther('2');
const delegatorMinStake = ethers.parseEther('1');
const maxStake = ethers.parseEther('100000');

// one epoch in 1000 seconds.
const stakingEpochDuration = 1000n;

// the transition time window is 100 seconds.
const stakingTransitionwindowLength = 100n;
const stakingWithdrawDisallowPeriod = 100n;

const validatorInactivityThreshold = 365n * 86400n // 1 year

const SystemAccountAddress = '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE';

describe('KeyGenHistory', () => {
    let owner: HardhatEthersSigner;
    let accounts: HardhatEthersSigner[];
    let accountAddresses: string[];
    let miningAddresses: string[];
    let stakingAddresses: string[];
    let initializingMiningAddresses: string[];
    let initializingStakingAddresses: string[];
    let stubAddress: string;

    let keyGenHistory: KeyGenHistory;
    let txPermission: TxPermissionHbbft;
    let validatorSetHbbft: ValidatorSetHbbftMock;
    let stakingHbbft: StakingHbbftMock;
    let blockRewardHbbft: BlockRewardHbbftMock;
    let randomHbbft: RandomHbbft;
    let certifier: CertifierHbbft;
    let keyGenHistoryPermission: Permission<KeyGenHistory>;

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

    const { parts, acks } = getTestPartNAcks();

    async function impersonateSystemAcc() {
        await helpers.impersonateAccount(SystemAccountAddress);

        await owner.sendTransaction({
            to: SystemAccountAddress,
            value: ethers.parseEther('10'),
        });

        return await ethers.getSigner(SystemAccountAddress);
    }

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
        const asEncoded = validatorSetHbbft.interface.encodeFunctionData(
            "announceAvailability",
            [blockNumber, block!.hash!]
        );
        if (logOutput) {
            console.log('calling: announceAvailability');
            console.log('pool: ', pool)
            console.log('ecodedCall: ', asEncoded);
        }

        const allowedTxType = await txPermission.allowedTxTypes(pool, await validatorSetHbbft.getAddress(), '0x0' /* value */, '0x0' /* gas price */, asEncoded);

        //console.log(allowedTxType.typesMask.toString());
        // don't ask to cache this result.
        expect(allowedTxType.cache).to.be.false;

        /// 0x01 - basic transaction (e.g. ether transferring to user wallet);
        /// 0x02 - contract call;
        /// 0x04 - contract creation;
        /// 0x08 - private transaction.

        expect(allowedTxType.typesMask).to.be.equal(2n, 'Transaction should be allowed according to TxPermission Contract.');

        // we know now, that this call is allowed.
        // so we can execute it.
        await (await ethers.getSigner(pool)).sendTransaction({ to: await validatorSetHbbft.getAddress(), data: asEncoded });
    }

    async function callReward(isEpochEndBlock: boolean) {
        // console.log('getting validators...');
        // note: this call used to crash because of a internal problem with a previous call of evm_mine and evm_increase_time https://github.com/DMDcoin/hbbft-posdao-contracts/issues/13
        // console.log('got validators:', validators);
        const systemSigner = await impersonateSystemAcc();

        await blockRewardHbbft.connect(systemSigner).reward(isEpochEndBlock);

        await helpers.stopImpersonatingAccount(SystemAccountAddress);
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

        const numberOfParts = callResult[0];
        const numberOfAcks = callResult[1];

        const pendingValidators = await validatorSetHbbft.getPendingValidators();
        const numberOfPendingValidators = BigInt(pendingValidators.length);
        let callRewardParameter = (numberOfParts === numberOfPendingValidators && numberOfAcks === numberOfPendingValidators);

        const endTimeOfCurrentEpoch = await stakingHbbft.stakingFixedEpochEndTime();

        await helpers.time.increaseTo(endTimeOfCurrentEpoch);
        await callReward(callRewardParameter);
    }

    before(async function () {
        [owner, ...accounts] = await ethers.getSigners();
        stubAddress = owner.address;

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
        const connectivityTracker = await ConnectivityTrackerFactory.deploy();
        await connectivityTracker.waitForDeployment();

        // Deploy ValidatorSet contract
        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbftProxy = await upgrades.deployProxy(
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
        );

        await validatorSetHbbftProxy.waitForDeployment();

        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        const blockRewardHbbftProxy = await upgrades.deployProxy(
            BlockRewardHbbftFactory,
            [
                owner.address,
                await validatorSetHbbftProxy.getAddress(),
                await connectivityTracker.getAddress()
            ],
            { initializer: 'initialize' }
        );

        await blockRewardHbbftProxy.waitForDeployment();

        const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
        const randomHbbftProxy = await upgrades.deployProxy(
            RandomHbbftFactory,
            [
                owner.address,
                await validatorSetHbbftProxy.getAddress()
            ],
            { initializer: 'initialize' }
        );

        await randomHbbftProxy.waitForDeployment();

        const stakingParams = {
            _validatorSetContract: await validatorSetHbbftProxy.getAddress(),
            _initialStakingAddresses: initializingStakingAddresses,
            _delegatorMinStake: delegatorMinStake,
            _candidateMinStake: candidateMinStake,
            _maxStake: maxStake,
            _stakingFixedEpochDuration: stakingEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionwindowLength,
            _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
        };

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingHbbftProxy = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                stakingParams,
                publicKeys,
                initialValidatorsIpAddresses
            ],
            { initializer: 'initialize' }
        );

        await stakingHbbftProxy.waitForDeployment();

        const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
        const keyGenHistoryProxy = await upgrades.deployProxy(
            KeyGenFactory,
            [
                owner.address,
                await validatorSetHbbftProxy.getAddress(),
                initializingMiningAddresses,
                parts,
                acks
            ],
            { initializer: 'initialize' }
        );

        await keyGenHistoryProxy.waitForDeployment();

        const CertifierFactory = await ethers.getContractFactory("CertifierHbbft");
        const certifierProxy = await upgrades.deployProxy(
            CertifierFactory,
            [
                [owner.address],
                await validatorSetHbbftProxy.getAddress(),
                owner.address
            ],
            { initializer: 'initialize' }
        );

        await certifierProxy.waitForDeployment()

        const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");
        const txPermissionProxy = await upgrades.deployProxy(
            TxPermissionFactory,
            [
                [owner.address],
                await certifierProxy.getAddress(),
                await validatorSetHbbftProxy.getAddress(),
                await keyGenHistoryProxy.getAddress(),
                stubAddress,
                owner.address
            ],
            { initializer: 'initialize' }
        );

        await txPermissionProxy.waitForDeployment();

        validatorSetHbbft = ValidatorSetFactory.attach(
            await validatorSetHbbftProxy.getAddress()
        ) as ValidatorSetHbbftMock;

        blockRewardHbbft = BlockRewardHbbftFactory.attach(
            await blockRewardHbbftProxy.getAddress()
        ) as BlockRewardHbbftMock;

        randomHbbft = RandomHbbftFactory.attach(await randomHbbftProxy.getAddress()) as RandomHbbft;

        stakingHbbft = StakingHbbftFactory.attach(
            await stakingHbbftProxy.getAddress()
        ) as StakingHbbftMock;

        keyGenHistory = KeyGenFactory.attach(
            await keyGenHistoryProxy.getAddress()
        ) as KeyGenHistory;

        certifier = CertifierFactory.attach(
            await certifierProxy.getAddress()
        ) as CertifierHbbft;

        txPermission = TxPermissionFactory.attach(
            await txPermissionProxy.getAddress()
        ) as TxPermissionHbbft;

        keyGenHistoryPermission = new Permission(txPermission, keyGenHistory, logOutput);

        await validatorSetHbbft.setBlockRewardContract(await blockRewardHbbft.getAddress());
        await validatorSetHbbft.setRandomContract(await randomHbbft.getAddress());
        await validatorSetHbbft.setStakingContract(await stakingHbbft.getAddress());
        await validatorSetHbbft.setKeyGenHistoryContract(await keyGenHistory.getAddress());

        const validators = await validatorSetHbbft.getValidators();

        expect(validators).to.be.deep.equal(initializingMiningAddresses);
    });

    describe('Deployment', async () => {
        it('should revert initialization with owner = address(0)', async () => {
            const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
            await expect(upgrades.deployProxy(
                KeyGenFactory,
                [
                    ethers.ZeroAddress,
                    stubAddress,
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
                    ethers.ZeroAddress,
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
                    stubAddress,
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
                    stubAddress,
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
                    stubAddress,
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
                    stubAddress,
                    initializingMiningAddresses,
                    parts,
                    acks
                ],
                { initializer: 'initialize' }
            );

            await contract.waitForDeployment();

            await expect(contract.initialize(
                owner.address,
                stubAddress,
                initializingMiningAddresses,
                parts,
                acks
            )).to.be.revertedWith('Initializable: contract is already initialized');
        });

        it('should restrict calling clearPrevKeyGenState to ValidatorSet contract', async function () {
            const caller = accounts[5];
            await expect(keyGenHistory.connect(caller).clearPrevKeyGenState([]))
                .to.be.revertedWith("Must by executed by validatorSetContract");
        });

        it('should restrict calling notifyNewEpoch to ValidatorSet contract', async function () {
            const caller = accounts[5];

            await expect(keyGenHistory.connect(caller).notifyNewEpoch())
                .to.be.revertedWith("Must by executed by validatorSetContract");
        });

        it('should restrict calling notifyKeyGenFailed to ValidatorSet contract', async function () {
            const caller = accounts[5];

            await expect(keyGenHistory.connect(caller).notifyKeyGenFailed())
                .to.be.revertedWith("Must by executed by validatorSetContract");
        });

        it('failed KeyGeneration, availability.', async () => {
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

            expect(await stakingHbbft.isPoolActive(newPoolStakingAddress)).to.be.false;

            await stakingHbbft.connect(await ethers.getSigner(newPoolStakingAddress)).addPool(
                newPoolMiningAddress,
                ethers.zeroPadBytes("0x00", 64),
                ethers.zeroPadBytes("0x00", 16),
                { value: candidateMinStake }
            );

            //await stakingHbbft.addPool(miningAddresses[5], '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
            //'0x00000000000000000000000000000000', {from: stakingAddresses[5], value: candidateMinStake});

            expect(await stakingHbbft.isPoolActive(newPoolStakingAddress)).to.be.true;

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

            expect(await stakingHbbft.getPoolsToBeElected()).to.be.empty;
            expect(await stakingHbbft.getPoolsInactive()).to.be.deep.equal([newPoolStakingAddress]);

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
            expect(await stakingHbbft.getPoolsToBeElected()).to.be.deep.equal([newPoolStakingAddress]);
            expect(await stakingHbbft.getPoolsInactive()).to.be.empty;

            // the original validators took over.
            // lets travel again to the end of the epoch, to switch into the next epoch
            // to invoke another voting.

            //write the PART and ACK for the pending validator:

            const pendingValidators = await validatorSetHbbft.getPendingValidators();

            // since there was never  another electable candidate, the system should still
            // tread the one and only pending validator still as pending validator.
            expect(pendingValidators).to.be.deep.equal([newPoolMiningAddress]);

            // since the initial round was failed, we are in the second round.
            const currentRoundCounter = '2';

            await writePart('1', currentRoundCounter, parts[0], pendingValidators[0]);

            //confirm that part was written.
            //TODO! what was it supposed to be? , partFromBc, 'parts read from the blockchain require to be equal to the written data.'
            expect(await keyGenHistory.getPart(pendingValidators[0])).to.be.equal(ethers.hexlify(parts[0]));

            await writeAcks('1', currentRoundCounter, acks[0], pendingValidators[0]);
            await timeTravelToEndEpoch();

            await printValidatorState('epoch1 start:');
            expect(await stakingHbbft.stakingEpoch()).to.equal(1n);

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

            await printValidatorState('epoch2 start:');
            expect(await stakingHbbft.stakingEpoch()).to.be.equal(2n);

            // // now the new node should be a validator.
            expect(await validatorSetHbbft.getValidators()).to.be.deep.equal([newPoolMiningAddress]);
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

            const poolMiningAddress1 = miningAddresses[4];

            // address1 is already picked up and a validator.
            // we double check if he is also marked for being available:

            expect(await validatorSetHbbft.validatorAvailableSince(poolMiningAddress1)).to.be.not.equal(0n);

            const poolStakingAddress2 = stakingAddresses[5];
            const poolMiningAddress2 = miningAddresses[5];

            await stakingHbbft.connect(await ethers.getSigner(poolStakingAddress2)).addPool(
                poolMiningAddress2,
                ethers.zeroPadBytes("0x00", 64),
                ethers.zeroPadBytes("0x00", 16),
                { value: candidateMinStake }
            );

            await printValidatorState('After adding mining address2:');
            await timeTravelToTransition();
            await printValidatorState('validator2 pending:');

            // now let pending validator 2 write it's Part,
            // but pending validator 1 misses out to write it's part.

            await writePart('3', '1', parts[0], poolMiningAddress2);
            await expect(writeAcks('3', '1', acks[0], poolMiningAddress2)).to.be.rejected;

            if (logOutput) {
                console.log('numberOfPartsWritten: ', await keyGenHistory.numberOfPartsWritten());
                console.log('numberOfAcksWritten: ', await keyGenHistory.numberOfAcksWritten());
            }

            await timeTravelToEndEpoch();
            await printValidatorState('failedEnd:');

            // another TimeTravel to end epoch happened,
            // we expect that there was NO epoch change.
            // since Validator 1 failed writing his keys.
            expect(await stakingHbbft.stakingEpoch()).to.be.equal(2n);

            // we expect Validator 1 now to be marked as unavailable,
            // since he failed to write his key.
            expect(await validatorSetHbbft.validatorAvailableSince(poolMiningAddress1)).to.be.equal(0n);

            // and only validator 2 is part of the Set.
            // validator 2 needs to write his keys again.
            expect(await validatorSetHbbft.getPendingValidators()).to.be.deep.equal([poolMiningAddress2]);
        });
    });

    describe('Certifier', async () => {
        it("Owner must be able to certify any user", async () => {
            await certifier.connect(owner).certify(accounts[35].address);
            expect(await certifier.certified(accounts[35].address)).to.be.true;
            expect(await certifier.certifiedExplicitly(accounts[35].address)).to.be.true;
        });

        it("Mining addresses with pools should be certified by default", async () => {
            expect(await certifier.certified(miningAddresses[1])).to.be.true;
            expect(await certifier.certifiedExplicitly(miningAddresses[1])).to.be.false;
        })

        it("Should be able to revoke from non-validators", async () => {
            await certifier.connect(owner).revoke(accounts[35].address);
            expect(await certifier.certified(accounts[35].address)).to.be.false;
        });

        it("Shouldn't be able to revoke from working validators", async () => {
            await certifier.connect(owner).revoke(miningAddresses[1]);
            expect(await certifier.certified(miningAddresses[1])).to.be.true;
        })

        it("Shouldn't be able to certify zero address", async () => {
            await expect(certifier.connect(owner).certify(ethers.ZeroAddress))
                .to.be.revertedWith("certifier must not be address 0");
        })
    })
});
