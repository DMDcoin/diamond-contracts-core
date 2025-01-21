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
    CertifierHbbft,
    ConnectivityTrackerHbbftMock
} from "../src/types";


import { getTestPartNAcks } from './testhelpers/data';
import { Permission } from "./testhelpers/Permission";
import { deployDao } from "./testhelpers/daoDeployment";

// you can set this to true for debugging uses.
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
    let connectivityTracker: ConnectivityTrackerHbbftMock;
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


    async function printEarlyEpochEndInfo() {

        if (!logOutput) {
            return;
        }

        const epoch = await stakingHbbft.stakingEpoch();
        const keyGenRound = await keyGenHistory.currentKeyGenRound();
        const isEarlyEpochEnd = await blockRewardHbbft.earlyEpochEnd();

        console.log(`epoch ${epoch} keyGenRound ${keyGenRound} isEarlyEpochEnd ${isEarlyEpochEnd}`);

    }
    // checks if a validator is able to write parts for free
    // and executes it.
    // NOTE: It does not really send the transaction with 0 gas price,
    // because that would only work if the network nodes would already
    // run on the test contracts deployed here.
    async function writePart(upcomingEpochNumber: string, round: string, parts: any, from: string) {
        await keyGenHistoryPermission.callFunction('writePart', from, [upcomingEpochNumber, round, parts]);
    }

    async function writeAcks(upcomingEpochNumber: string, round: string, parts: any, from: string) {
        await keyGenHistoryPermission.callFunction('writeAcks', from, [upcomingEpochNumber, round, parts]);
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
        let respone = await (await ethers.getSigner(pool)).sendTransaction({ to: await validatorSetHbbft.getAddress(), data: asEncoded });
        await respone.wait();
    }

    async function callReward() {

        // mimic the behavor of the nodes here:
        // if The Validators managed to write the correct number
        // of Acks and Parts, we are happy and set a "true"
        // if not, we send a "false"
        // note: the Nodes they DO check if the ACKS and PARTS
        // make it possible to generate a treshold key here,
        // but within the tests, we just mimic this behavior.


        const systemSigner = await impersonateSystemAcc();
        let isEpochEndBlock = false;
        let pendingValidators = await validatorSetHbbft.getPendingValidators();

        if (pendingValidators.length > 0) {
            const keyGenFragments = await keyGenHistory.getNumberOfKeyFragmentsWritten();
            if (keyGenFragments[0] === BigInt(pendingValidators.length) && keyGenFragments[1] === BigInt(pendingValidators.length)) {
                isEpochEndBlock = true;
            }
        }

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
        await callReward();
    }

    async function timeTravelToEndEpoch() {


        const endTimeOfCurrentEpoch = await stakingHbbft.stakingFixedEpochEndTime();

        await helpers.time.increaseTo(endTimeOfCurrentEpoch);
        await callReward();
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

        await deployDao();

        const bonusScoreContractMockFactory = await ethers.getContractFactory("BonusScoreSystemMock");
        const bonusScoreContractMock = await bonusScoreContractMockFactory.deploy();
        await bonusScoreContractMock.waitForDeployment();

        const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbftMock");
        connectivityTracker = await ConnectivityTrackerFactory.deploy();
        await connectivityTracker.waitForDeployment();

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: await bonusScoreContractMock.getAddress(),
            connectivityTrackerContract: await connectivityTracker.getAddress(),
            validatorInactivityThreshold: validatorInactivityThreshold,
        }

        // Deploy ValidatorSet contract
        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        validatorSetHbbft = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                validatorSetParams,           // _params
                initializingMiningAddresses,  // _initialMiningAddresses
                initializingStakingAddresses, // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as ValidatorSetHbbftMock;

        await validatorSetHbbft.waitForDeployment();

        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        blockRewardHbbft = await upgrades.deployProxy(
            BlockRewardHbbftFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(),
                await connectivityTracker.getAddress()
            ],
            { initializer: 'initialize' }
        ) as unknown as BlockRewardHbbftMock;

        await blockRewardHbbft.waitForDeployment();

        const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
        randomHbbft = await upgrades.deployProxy(
            RandomHbbftFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress()
            ],
            { initializer: 'initialize' }
        ) as unknown as RandomHbbft;

        await randomHbbft.waitForDeployment();

        const stakingParams = {
            _validatorSetContract: await validatorSetHbbft.getAddress(),
            _bonusScoreContract: await bonusScoreContractMock.getAddress(),
            _initialStakingAddresses: initializingStakingAddresses,
            _delegatorMinStake: delegatorMinStake,
            _candidateMinStake: candidateMinStake,
            _maxStake: maxStake,
            _stakingFixedEpochDuration: stakingEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionwindowLength,
            _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
        };

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
        ) as unknown as StakingHbbftMock;

        await stakingHbbft.waitForDeployment();

        const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
        keyGenHistory = await upgrades.deployProxy(
            KeyGenFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(),
                initializingMiningAddresses,
                parts,
                acks
            ],
            { initializer: 'initialize' }
        ) as unknown as KeyGenHistory;

        await keyGenHistory.waitForDeployment();

        const CertifierFactory = await ethers.getContractFactory("CertifierHbbft");
        certifier = await upgrades.deployProxy(
            CertifierFactory,
            [
                [owner.address],
                await validatorSetHbbft.getAddress(),
                owner.address
            ],
            { initializer: 'initialize' }
        ) as unknown as CertifierHbbft;

        await certifier.waitForDeployment()

        const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");
        txPermission = await upgrades.deployProxy(
            TxPermissionFactory,
            [
                [owner.address],
                await certifier.getAddress(),
                await validatorSetHbbft.getAddress(),
                await keyGenHistory.getAddress(),
                stubAddress,
                owner.address
            ],
            { initializer: 'initialize' }
        ) as unknown as TxPermissionHbbft;

        await txPermission.waitForDeployment();

        keyGenHistoryPermission = new Permission(txPermission, keyGenHistory, logOutput);

        await validatorSetHbbft.setBlockRewardContract(await blockRewardHbbft.getAddress());
        await validatorSetHbbft.setRandomContract(await randomHbbft.getAddress());
        await validatorSetHbbft.setStakingContract(await stakingHbbft.getAddress());
        await validatorSetHbbft.setKeyGenHistoryContract(await keyGenHistory.getAddress());

        const validators = await validatorSetHbbft.getValidators();

        expect(validators).to.be.deep.equal(initializingMiningAddresses);
    });

    describe('initialize', async () => {
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
            )).to.be.revertedWithCustomError(KeyGenFactory, "ZeroAddress");
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
            )).to.be.revertedWithCustomError(KeyGenFactory, "ZeroAddress");
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
            )).to.be.revertedWithCustomError(KeyGenFactory, "ValidatorsListEmpty");
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
            )).to.be.revertedWithCustomError(KeyGenFactory, "WrongPartsNumber");
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
            )).to.be.revertedWithCustomError(KeyGenFactory, "WrongAcksNumber");
        });

        it('should not allow reinitialization', async () => {
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
            )).to.be.revertedWithCustomError(contract, "InvalidInitialization");
        });

        it('should initialize and set parts, acks', async () => {
            const KeyGenFactoryFactory = await ethers.getContractFactory("KeyGenHistory");
            const keyGenHistory = await upgrades.deployProxy(
                KeyGenFactoryFactory,
                [
                    owner.address,
                    await validatorSetHbbft.getAddress(),
                    initializingMiningAddresses,
                    parts,
                    acks
                ],
                { initializer: 'initialize' }
            ) as unknown as KeyGenHistory;

            await keyGenHistory.waitForDeployment();

            let actualPartsCount = 0;
            let actualAcksCount = 0;
            for (const miningAddress of initializingMiningAddresses) {
                const storedPart = await keyGenHistory.getPart(miningAddress);
                const storedAcksLength = await keyGenHistory.getAcksLength(miningAddress);

                if (storedPart.length > 0) {
                    actualPartsCount++;
                }

                if (storedAcksLength > 0) {
                    actualAcksCount++;
                }
            }

            const [
                numberOfPartsWritten,
                numberOfAcksWritten
            ] = await keyGenHistory.getNumberOfKeyFragmentsWritten();

            expect(await keyGenHistory.getCurrentKeyGenRound()).to.eq(1n);
            expect(numberOfPartsWritten).to.eq(actualPartsCount);
            expect(numberOfAcksWritten).to.eq(actualAcksCount);
        });
    });

    describe('contract functions', async () => {
        it('should restrict calling clearPrevKeyGenState to ValidatorSet contract', async function () {
            const caller = accounts[5];
            await expect(keyGenHistory.connect(caller).clearPrevKeyGenState([]))
                .to.be.revertedWithCustomError(keyGenHistory, "Unauthorized");
        });

        it('should restrict calling notifyNewEpoch to ValidatorSet contract', async function () {
            const caller = accounts[5];

            await expect(keyGenHistory.connect(caller).notifyNewEpoch())
                .to.be.revertedWithCustomError(keyGenHistory, "Unauthorized");
        });

        it('should restrict calling notifyKeyGenFailed to ValidatorSet contract', async function () {
            const caller = accounts[5];

            await expect(keyGenHistory.connect(caller).notifyKeyGenFailed())
                .to.be.revertedWithCustomError(keyGenHistory, "Unauthorized");
        });

        it('should revert writePart for wrong epoch', async () => {
            const roundCounter = await keyGenHistory.getCurrentKeyGenRound();

            const caller = await ethers.getSigner(miningAddresses[0]);
            const epoch = await stakingHbbft.stakingEpoch();

            await expect(keyGenHistory.connect(caller).writePart(epoch, roundCounter, parts[0]))
                .to.be.revertedWithCustomError(keyGenHistory, "IncorrectEpoch");
        });

        it('should revert writePart for wrong round', async () => {
            const roundCounter = await keyGenHistory.getCurrentKeyGenRound();

            const caller = await ethers.getSigner(miningAddresses[0]);
            const epoch = await stakingHbbft.stakingEpoch();

            const wrongRound = roundCounter + 1n;

            await expect(keyGenHistory.connect(caller).writePart(epoch + 1n, wrongRound, parts[0]))
                .to.be.revertedWithCustomError(keyGenHistory, "IncorrectRound")
                .withArgs(roundCounter, wrongRound);
        });

        it('should revert writePart by non-pending validator', async () => {
            const roundCounter = await keyGenHistory.getCurrentKeyGenRound();

            const caller = await ethers.getSigner(miningAddresses[0]);
            const epoch = await stakingHbbft.stakingEpoch();

            await expect(keyGenHistory.connect(caller).writePart(epoch + 1n, roundCounter, parts[0]))
                .to.be.revertedWithCustomError(keyGenHistory, "NotPendingValidator")
                .withArgs(caller.address);
        });

        it('should revert writeAcks for wrong epoch', async () => {
            const roundCounter = await keyGenHistory.getCurrentKeyGenRound();

            const caller = await ethers.getSigner(miningAddresses[0]);
            const epoch = await stakingHbbft.stakingEpoch();

            await expect(keyGenHistory.connect(caller).writeAcks(epoch, roundCounter, acks[0]))
                .to.be.revertedWithCustomError(keyGenHistory, "IncorrectEpoch");
        });

        it('should revert writeAcks for wrong round', async () => {
            const roundCounter = await keyGenHistory.getCurrentKeyGenRound();

            const caller = await ethers.getSigner(miningAddresses[0]);
            const epoch = await stakingHbbft.stakingEpoch();

            const wrongRound = roundCounter + 1n;

            await expect(keyGenHistory.connect(caller).writeAcks(epoch + 1n, wrongRound, acks[0]))
                .to.be.revertedWithCustomError(keyGenHistory, "IncorrectRound")
                .withArgs(roundCounter, wrongRound);
        });

        it('should revert writeAcks by non-pending validator', async () => {
            const roundCounter = await keyGenHistory.getCurrentKeyGenRound();

            const caller = await ethers.getSigner(miningAddresses[0]);
            const epoch = await stakingHbbft.stakingEpoch();

            await expect(keyGenHistory.connect(caller).writeAcks(epoch + 1n, roundCounter, acks[0]))
                .to.be.revertedWithCustomError(keyGenHistory, "NotPendingValidator")
                .withArgs(caller.address);
        });

        it('failed KeyGeneration, availability.', async () => {
            const currentTS = await helpers.time.latest();
            const newPoolStakingAddress = stakingAddresses[4];
            const newPoolMiningAddress = miningAddresses[4];

            if (logOutput) {
                console.log('currentTS:', currentTS);
                console.log('newPoolStakingAddress:', newPoolStakingAddress);
                console.log('newPoolMiningAddress:', newPoolMiningAddress);
            }

            expect(await stakingHbbft.isPoolActive(newPoolStakingAddress)).to.be.false;

            await stakingHbbft.connect(await ethers.getSigner(newPoolStakingAddress)).addPool(
                newPoolMiningAddress,
                ethers.ZeroAddress,
                0n,
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

            const newPoolSigner = await ethers.getSigner(newPoolMiningAddress);

            await expect(
                keyGenHistory.connect(newPoolSigner).writePart(2n, 1n, parts[0])
            ).to.be.revertedWithCustomError(keyGenHistory, "PartsAlreadySubmitted");

            await expect(
                keyGenHistory.connect(newPoolSigner).writeAcks(2n, 1n, acks[0])
            ).to.be.revertedWithCustomError(keyGenHistory, "AcksAlreadySubmitted");

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

            const connectivityTrackerCaller = await ethers.getImpersonatedSigner(await connectivityTracker.getAddress());


            await blockRewardHbbft.connect(connectivityTrackerCaller).notifyEarlyEpochEnd({ gasPrice: "0" });

            await printEarlyEpochEndInfo();

            const poolMiningAddress1 = miningAddresses[4];

            // address1 is already picked up and a validator.
            // we double check if he is also marked for being available:


            expect(await validatorSetHbbft.validatorAvailableSince(poolMiningAddress1)).to.be.not.equal(0n);

            const poolStakingAddress2 = stakingAddresses[5];
            const poolMiningAddress2 = miningAddresses[5];


            await stakingHbbft.connect(await ethers.getSigner(poolStakingAddress2)).addPool(
                poolMiningAddress2,
                ethers.ZeroAddress,
                0n,
                ethers.zeroPadBytes("0x00", 64),
                ethers.zeroPadBytes("0x00", 16),
                { value: candidateMinStake }
            );

            await printValidatorState('After adding mining address2:');
            await timeTravelToTransition();
            await printValidatorState('validator2 pending:');

            // now let pending validator 2 write it's Part,
            // but pending validator 1 misses out to write it's part.
            await printEarlyEpochEndInfo();

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


            // console.log("isEarlyEpochEnd 2 - 2:", await blockRewardHbbft.earlyEpochEnd());
            await printEarlyEpochEndInfo();

            await writePart('3', '2', parts[0], poolMiningAddress2);
            await writeAcks('3', '2', acks[0], poolMiningAddress2);

            await callReward();


            expect(await stakingHbbft.stakingEpoch()).to.be.equal(3n);
            expect(await validatorSetHbbft.getValidators()).to.be.deep.equal([poolMiningAddress2]);

        });

        it('1/2 KeyGeneration - ACKS Failure', async () => {

            //tests a 2 validators setup.
            // both  manage to write it's part.
            // 1 does not manage to write it's ACK.
            // expected behavior:
            // system goes into an extra key gen round,
            // without the failing party as pending validator.

            const poolMiningAddress1 = miningAddresses[4];
            const poolMiningAddress2 = miningAddresses[5];

            let pools = await stakingHbbft.getPools();

            // address1 is already picked up and a validator.
            // we double check if he is also marked for being available:
            await announceAvailability(poolMiningAddress1);
            await announceAvailability(poolMiningAddress2);

            pools = await stakingHbbft.getPools();

            expect(await validatorSetHbbft.validatorAvailableSince(poolMiningAddress1)).to.be.not.equal(0n);
            expect(await validatorSetHbbft.validatorAvailableSince(poolMiningAddress2)).to.be.not.equal(0n);

            await timeTravelToTransition();
            await printValidatorState('validator2 pending:');

            // now let pending validator 2 write it's Part,
            // but pending validator 1 misses out to write it's part.
            await printEarlyEpochEndInfo();

            await writePart('4', '1', parts[0], poolMiningAddress2);
            await writePart('4', '1', parts[0], poolMiningAddress1);

            await writeAcks('4', '1', acks[0], poolMiningAddress1);

            if (logOutput) {
                console.log('numberOfPartsWritten: ', await keyGenHistory.numberOfPartsWritten());
                console.log('numberOfAcksWritten: ', await keyGenHistory.numberOfAcksWritten());
            }

            await timeTravelToEndEpoch();
            await printValidatorState('failedEnd:');

            // we expect that there was NO epoch change.
            // since Validator 2 failed writing his ACKs.
            expect(await stakingHbbft.stakingEpoch()).to.be.equal(3n);

            // we expect Validator 2 now to be marked as unavailable,
            // since he failed to write his key.
            expect(await validatorSetHbbft.validatorAvailableSince(poolMiningAddress2)).to.be.equal(0n);

            // and only validator 2 is part of the Set.
            // validator 2 needs to write his keys again.
            expect(await validatorSetHbbft.getPendingValidators()).to.be.deep.equal([poolMiningAddress1]);

            // we are in another round,
            expect(await keyGenHistory.getCurrentKeyGenRound()).to.be.equal(2n);

            await printEarlyEpochEndInfo();
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
                .to.be.revertedWithCustomError(certifier, "ZeroAddress");
        })
    })
});
