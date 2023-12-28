import { ethers, network, upgrades } from "hardhat";

import * as helpers from "@nomicfoundation/hardhat-network-helpers";

import {
    BlockRewardHbbftMock,
    RandomHbbft,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    KeyGenHistory,
    ConnectivityTrackerHbbftMock
} from "../src/types";

import fp from 'lodash/fp';
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";


require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bn')(BigNumber))
    .should();

//smart contracts
let blockRewardHbbft: BlockRewardHbbftMock;
let randomHbbft: RandomHbbft;
let validatorSetHbbft: ValidatorSetHbbftMock;
let stakingHbbft: StakingHbbftMock;
let keyGenHistory: KeyGenHistory;
let connectivityTracker: ConnectivityTrackerHbbftMock;

//addresses
let owner: SignerWithAddress;
let accounts: SignerWithAddress[];
let initialValidatorsPubKeys;
let initialValidatorsIpAddresses;
let validators;

//vars
let candidateMinStake: BigNumber;
let delegatorMinStake: BigNumber;
let stakingEpoch;
let nativeRewardUndistributed = BigNumber.from(0);

//consts
// one epoch in 1 day.
const STAKING_FIXED_EPOCH_DURATION = BigNumber.from(86400);

// the transition time window is 1 hour.
const STAKING_TRANSITION_WINDOW_LENGTH = BigNumber.from(3600);

//const STAKING_EPOCH_DURATION = BigNumber.from(120954 + 2);

const KEY_GEN_DURATION = BigNumber.from(2); // we assume that there is a fixed duration in blocks, in reality it varies.
const STAKE_WITHDRAW_DISALLOW_PERIOD = 2; // one less than EPOCH DURATION, therefore it meets the conditions.
const MIN_STAKE = BigNumber.from(ethers.utils.parseEther('1'));
const MAX_STAKE = BigNumber.from(ethers.utils.parseEther('100000'));

describe('BlockRewardHbbft', () => {
    it('network started', async () => {
        [owner, ...accounts] = await ethers.getSigners();

        const accountAddresses = accounts.map(item => item.address);
        const initialValidators = accountAddresses.slice(1, 3 + 1); // accounts[1...3]
        const initialStakingAddresses = accountAddresses.slice(4, 6 + 1); // accounts[4...6]
        const stubAddress = accounts[7].address;

        initialStakingAddresses.length.should.be.equal(3);
        initialStakingAddresses[0].should.not.be.equal('0x0000000000000000000000000000000000000000');
        initialStakingAddresses[1].should.not.be.equal('0x0000000000000000000000000000000000000000');
        initialStakingAddresses[2].should.not.be.equal('0x0000000000000000000000000000000000000000');

        const validatorInactivityThreshold = 365 * 86400 // 1 year

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
                initialValidators,            // _initialMiningAddresses
                initialStakingAddresses,      // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as ValidatorSetHbbftMock;

        await validatorSetHbbft.deployed();

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

        await blockRewardHbbft.deployed();

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

        await randomHbbft.deployed();

        // The following private keys belong to the accounts 1-3, fixed by using the "--mnemonic" option when starting ganache.
        // const initialValidatorsPrivKeys = ["0x272b8400a202c08e23641b53368d603e5fec5c13ea2f438bce291f7be63a02a7", "0xa8ea110ffc8fe68a069c8a460ad6b9698b09e21ad5503285f633b3ad79076cf7", "0x5da461ff1378256f69cb9a9d0a8b370c97c460acbe88f5d897cb17209f891ffc"];
        // Public keys corresponding to the three private keys above.
        initialValidatorsPubKeys = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            (['0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
                '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
                '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56']);
        // The IP addresses are irrelevant for these unit test, just initialize them to 0.
        initialValidatorsIpAddresses = ['0x00000000000000000000000000000000', '0x00000000000000000000000000000000', '0x00000000000000000000000000000000'];

        let structure = {
            _validatorSetContract: validatorSetHbbft.address,
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: MIN_STAKE,
            _candidateMinStake: MIN_STAKE,
            _maxStake: MAX_STAKE,
            _stakingFixedEpochDuration: STAKING_FIXED_EPOCH_DURATION,
            _stakingTransitionTimeframeLength: STAKING_TRANSITION_WINDOW_LENGTH,
            _stakingWithdrawDisallowPeriod: STAKE_WITHDRAW_DISALLOW_PERIOD
        };

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        stakingHbbft = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                structure, // initializer structure
                initialValidatorsPubKeys, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ],
            { initializer: 'initialize' }
        ) as StakingHbbftMock;

        await stakingHbbft.deployed();

        candidateMinStake = await stakingHbbft.candidateMinStake();
        delegatorMinStake = await stakingHbbft.delegatorMinStake();

        const parts =
            [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 181, 129, 31, 84, 186, 242, 5, 151, 59, 35, 196, 140, 106, 29, 40, 112, 142, 156, 132, 158, 47, 223, 253, 185, 227, 249, 190, 96, 5, 99, 239, 213, 127, 29, 136, 115, 71, 164, 202, 44, 6, 171, 131, 251, 147, 159, 54, 49, 1, 0, 0, 0, 0, 0, 0, 0, 153, 0, 0, 0, 0, 0, 0, 0, 4, 177, 133, 61, 18, 58, 222, 74, 65, 5, 126, 253, 181, 113, 165, 43, 141, 56, 226, 132, 208, 218, 197, 119, 179, 128, 30, 162, 251, 23, 33, 73, 38, 120, 246, 223, 233, 11, 104, 60, 154, 241, 182, 147, 219, 81, 45, 134, 239, 69, 169, 198, 188, 152, 95, 254, 170, 108, 60, 166, 107, 254, 204, 195, 170, 234, 154, 134, 26, 91, 9, 139, 174, 178, 248, 60, 65, 196, 218, 46, 163, 218, 72, 1, 98, 12, 109, 186, 152, 148, 159, 121, 254, 34, 112, 51, 70, 121, 51, 167, 35, 240, 5, 134, 197, 125, 252, 3, 213, 84, 70, 176, 160, 36, 73, 140, 104, 92, 117, 184, 80, 26, 240, 106, 230, 241, 26, 79, 46, 241, 195, 20, 106, 12, 186, 49, 254, 168, 233, 25, 179, 96, 62, 104, 118, 153, 95, 53, 127, 160, 237, 246, 41],
            [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 181, 129, 31, 84, 186, 242, 5, 151, 59, 35, 196, 140, 106, 29, 40, 112, 142, 156, 132, 158, 47, 223, 253, 185, 227, 249, 190, 96, 5, 99, 239, 213, 127, 29, 136, 115, 71, 164, 202, 44, 6, 171, 131, 251, 147, 159, 54, 49, 1, 0, 0, 0, 0, 0, 0, 0, 153, 0, 0, 0, 0, 0, 0, 0, 4, 177, 133, 61, 18, 58, 222, 74, 65, 5, 126, 253, 181, 113, 165, 43, 141, 56, 226, 132, 208, 218, 197, 119, 179, 128, 30, 162, 251, 23, 33, 73, 38, 120, 246, 223, 233, 11, 104, 60, 154, 241, 182, 147, 219, 81, 45, 134, 239, 69, 169, 198, 188, 152, 95, 254, 170, 108, 60, 166, 107, 254, 204, 195, 170, 234, 154, 134, 26, 91, 9, 139, 174, 178, 248, 60, 65, 196, 218, 46, 163, 218, 72, 1, 98, 12, 109, 186, 152, 148, 159, 121, 254, 34, 112, 51, 70, 121, 51, 167, 35, 240, 5, 134, 197, 125, 252, 3, 213, 84, 70, 176, 160, 36, 73, 140, 104, 92, 117, 184, 80, 26, 240, 106, 230, 241, 26, 79, 46, 241, 195, 20, 106, 12, 186, 49, 254, 168, 233, 25, 179, 96, 62, 104, 118, 153, 95, 53, 127, 160, 237, 246, 41],
            [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 181, 129, 31, 84, 186, 242, 5, 151, 59, 35, 196, 140, 106, 29, 40, 112, 142, 156, 132, 158, 47, 223, 253, 185, 227, 249, 190, 96, 5, 99, 239, 213, 127, 29, 136, 115, 71, 164, 202, 44, 6, 171, 131, 251, 147, 159, 54, 49, 1, 0, 0, 0, 0, 0, 0, 0, 153, 0, 0, 0, 0, 0, 0, 0, 4, 177, 133, 61, 18, 58, 222, 74, 65, 5, 126, 253, 181, 113, 165, 43, 141, 56, 226, 132, 208, 218, 197, 119, 179, 128, 30, 162, 251, 23, 33, 73, 38, 120, 246, 223, 233, 11, 104, 60, 154, 241, 182, 147, 219, 81, 45, 134, 239, 69, 169, 198, 188, 152, 95, 254, 170, 108, 60, 166, 107, 254, 204, 195, 170, 234, 154, 134, 26, 91, 9, 139, 174, 178, 248, 60, 65, 196, 218, 46, 163, 218, 72, 1, 98, 12, 109, 186, 152, 148, 159, 121, 254, 34, 112, 51, 70, 121, 51, 167, 35, 240, 5, 134, 197, 125, 252, 3, 213, 84, 70, 176, 160, 36, 73, 140, 104, 92, 117, 184, 80, 26, 240, 106, 230, 241, 26, 79, 46, 241, 195, 20, 106, 12, 186, 49, 254, 168, 233, 25, 179, 96, 62, 104, 118, 153, 95, 53, 127, 160, 237, 246, 41]];

        const acks =
            [[[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 4, 239, 1, 112, 13, 13, 251, 103, 186, 212, 78, 44, 47, 250, 221, 84, 118, 88, 7, 64, 206, 186, 11, 2, 8, 204, 140, 106, 179, 52, 251, 237, 19, 53, 74, 187, 217, 134, 94, 66, 68, 89, 42, 85, 207, 155, 220, 101, 223, 51, 199, 37, 38, 203, 132, 13, 77, 78, 114, 53, 219, 114, 93, 21, 25, 164, 12, 43, 252, 160, 16, 23, 111, 79, 230, 121, 95, 223, 174, 211, 172, 231, 0, 52, 25, 49, 152, 79, 128, 39, 117, 216, 85, 201, 237, 242, 151, 219, 149, 214, 77, 233, 145, 47, 10, 184, 175, 162, 174, 237, 177, 131, 45, 126, 231, 32, 147, 227, 170, 125, 133, 36, 123, 164, 232, 129, 135, 196, 136, 186, 45, 73, 226, 179, 169, 147, 42, 41, 140, 202, 191, 12, 73, 146, 2]],
            [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 4, 239, 1, 112, 13, 13, 251, 103, 186, 212, 78, 44, 47, 250, 221, 84, 118, 88, 7, 64, 206, 186, 11, 2, 8, 204, 140, 106, 179, 52, 251, 237, 19, 53, 74, 187, 217, 134, 94, 66, 68, 89, 42, 85, 207, 155, 220, 101, 223, 51, 199, 37, 38, 203, 132, 13, 77, 78, 114, 53, 219, 114, 93, 21, 25, 164, 12, 43, 252, 160, 16, 23, 111, 79, 230, 121, 95, 223, 174, 211, 172, 231, 0, 52, 25, 49, 152, 79, 128, 39, 117, 216, 85, 201, 237, 242, 151, 219, 149, 214, 77, 233, 145, 47, 10, 184, 175, 162, 174, 237, 177, 131, 45, 126, 231, 32, 147, 227, 170, 125, 133, 36, 123, 164, 232, 129, 135, 196, 136, 186, 45, 73, 226, 179, 169, 147, 42, 41, 140, 202, 191, 12, 73, 146, 2]],
            [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 4, 239, 1, 112, 13, 13, 251, 103, 186, 212, 78, 44, 47, 250, 221, 84, 118, 88, 7, 64, 206, 186, 11, 2, 8, 204, 140, 106, 179, 52, 251, 237, 19, 53, 74, 187, 217, 134, 94, 66, 68, 89, 42, 85, 207, 155, 220, 101, 223, 51, 199, 37, 38, 203, 132, 13, 77, 78, 114, 53, 219, 114, 93, 21, 25, 164, 12, 43, 252, 160, 16, 23, 111, 79, 230, 121, 95, 223, 174, 211, 172, 231, 0, 52, 25, 49, 152, 79, 128, 39, 117, 216, 85, 201, 237, 242, 151, 219, 149, 214, 77, 233, 145, 47, 10, 184, 175, 162, 174, 237, 177, 131, 45, 126, 231, 32, 147, 227, 170, 125, 133, 36, 123, 164, 232, 129, 135, 196, 136, 186, 45, 73, 226, 179, 169, 147, 42, 41, 140, 202, 191, 12, 73, 146, 2]]];


        const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
        keyGenHistory = await upgrades.deployProxy(
            KeyGenFactory,
            [
                owner.address,
                validatorSetHbbft.address,
                initialValidators,
                parts,
                acks
            ],
            { initializer: 'initialize' }
        ) as KeyGenHistory;

        await keyGenHistory.deployed();

        await validatorSetHbbft.setBlockRewardContract(blockRewardHbbft.address);
        await validatorSetHbbft.setRandomContract(randomHbbft.address);
        await validatorSetHbbft.setStakingContract(stakingHbbft.address);
        await validatorSetHbbft.setKeyGenHistoryContract(keyGenHistory.address);
    });

    it('staking epoch #0 finished', async () => {

        let stakingEpoch = await stakingHbbft.stakingEpoch();
        stakingEpoch.should.be.equal(BigNumber.from(0));
        // we are now in the Phase 1: Regular Block Creation
        //means: just a normal and boring block.
        await callReward(false);

        //boring, thing happened, we still should have zero pendingValidors.
        let pendingValidators = await validatorSetHbbft.getPendingValidators();
        pendingValidators.length.should.be.equal(0);

        //lets spin up the time until the beginning of the Transition phase.
        await timeTravelToTransition();
        await timeTravelToEndEpoch();

        // that was the end of epoch 0,
        // we should be in epoch 1 now.
        stakingEpoch = await stakingHbbft.stakingEpoch();
        stakingEpoch.should.be.equal(BigNumber.from(1));

        // since noone stacked after all, pending validators should still be 0
        pendingValidators = await validatorSetHbbft.getPendingValidators();
        pendingValidators.length.should.be.equal(0);

        (await blockRewardHbbft.nativeRewardUndistributed()).should.be.equal(nativeRewardUndistributed);
    });

    it('staking epoch #1 started', async () => {
        (await stakingHbbft.stakingEpoch()).should.be.equal(BigNumber.from(1));
        //const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock();
        //stakingEpochStartBlock.should.be.equal(STAKING_EPOCH_START_BLOCK.add(STAKING_FIXED_EPOCH_DURATION).add(KEY_GEN_DURATION));


        const currentValudators = await validatorSetHbbft.getValidators();
        currentValudators.length.should.be.equal(3);

        //Docs: The pendingValidators set returned by the ValidatorSet contract is empty in this phase,.
        const pendingValidators = await validatorSetHbbft.getPendingValidators();
        pendingValidators.length.should.be.equal(0);

        const pools = await stakingHbbft.getPoolsToBeElected();
        pools.length.should.be.equal(0);

    });

    it('validators and their delegators place stakes during the epoch #1', async () => {
        const validators = await validatorSetHbbft.getValidators();

        for (let i = 0; i < validators.length; i++) {
            const stakingAddress = await validatorSetHbbft.stakingByMiningAddress(validators[i]);
            // Validator places stake on themselves
            await stakingHbbft.connect(ethers.provider.getSigner(stakingAddress)).stake(stakingAddress, { value: candidateMinStake });
            const delegatorsLength = 3;
            const delegators = accounts.slice(11 + i * delegatorsLength, 11 + i * delegatorsLength + delegatorsLength);
            for (let j = 0; j < delegators.length; j++) {
                // Delegator places stake on the validator
                await stakingHbbft.connect(delegators[j]).stake(stakingAddress, { value: delegatorMinStake });
            }
        }
    });

    it('staking epoch #1 finished', async () => {

        const stakingEpoch = await stakingHbbft.stakingEpoch();
        stakingEpoch.should.be.equal(BigNumber.from(1));

        // const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock();
        // stakingEpochStartBlock.should.be.equal(STAKING_EPOCH_START_BLOCK.add(STAKING_EPOCH_DURATION));

        (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(0);

        // we have staked just before, now there should be 3 pools.
        const pools = await stakingHbbft.getPoolsToBeElected();
        pools.length.should.be.equal(3);

        //lets spin up the time until the beginning of the Transition phase.
        await timeTravelToTransition();

        let pendingValidators = await validatorSetHbbft.getPendingValidators();
        sortedEqual(pendingValidators, [
            accounts[1].address,
            accounts[2].address,
            accounts[3].address
        ]);

        // now we are in phase 2.
        // Nodes are now responsible for creating a key together.
        // they have a timeframe for this (see )

        // since we are now  in phase 2 of the same epoch.
        (await stakingHbbft.stakingEpoch()).should.be.equal('1');
        (await blockRewardHbbft.nativeRewardUndistributed()).should.be.equal(nativeRewardUndistributed);

        await timeTravelToEndEpoch();

        //since the endEpoch happened, we should be in the epoch 2 now.
        const nextStakingEpoch = await stakingHbbft.stakingEpoch();
        nextStakingEpoch.should.be.equal('2');

        // pending validators get deleted after being finalized
        (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(0);

        validators = await validatorSetHbbft.getValidators();
        sortedEqual(validators, [
            accounts[1].address,
            accounts[2].address,
            accounts[3].address
        ]);

        for (let i = 0; i < validators.length; i++) {

            (await blockRewardHbbft.snapshotPoolValidatorStakeAmount(nextStakingEpoch, validators[i])).should.be.equal(
                candidateMinStake
            );
            (await blockRewardHbbft.snapshotPoolTotalStakeAmount(nextStakingEpoch, validators[i])).should.be.equal(
                candidateMinStake.add(delegatorMinStake.mul(BigNumber.from(3)))
            );
        }
    });

    const addToDeltaPotValue = BigNumber.from(ethers.utils.parseEther('60'));

    it('DMD Pots: filling delta pot', async () => {

        const stakingEpoch = await stakingHbbft.stakingEpoch();
        stakingEpoch.should.be.equal(BigNumber.from(2));

        //checking preconditions.
        // get the current address pof the governance pot.

        const blockRewardBalance = await ethers.provider.getBalance(blockRewardHbbft.address);
        blockRewardBalance.should.be.equal('0');

        (await blockRewardHbbft.deltaPot()).should.be.equal(BigNumber.from('0'));
        (await blockRewardHbbft.reinsertPot()).should.be.equal(BigNumber.from('0'));

        await blockRewardHbbft.addToDeltaPot({ value: addToDeltaPotValue });
        (await blockRewardHbbft.deltaPot()).should.be.equal(addToDeltaPotValue);

    });


    it('DMD Pots: governance and validators got correct share.', async () => {
        const maxValidators = await validatorSetHbbft.maxValidators();
        const currentValidators = await validatorSetHbbft.getValidators();
        currentValidators.length.should.be.equal(3);
        const initialGovernancePotBalance = await getCurrentGovernancePotValue();
        stakingEpoch = await stakingHbbft.stakingEpoch();

        await timeTravelToTransition();
        await timeTravelToEndEpoch();

        const currentGovernancePotBalance = await getCurrentGovernancePotValue();
        const governancePotIncrease = currentGovernancePotBalance.sub(initialGovernancePotBalance);

        const totalReward = addToDeltaPotValue.div(BigNumber.from('6000')).mul(BigNumber.from(currentValidators.length)).div(maxValidators);
        const expectedDAOShare = totalReward.div(BigNumber.from('10'));

        governancePotIncrease.should.to.be.equal(expectedDAOShare);

        //since there are a lot of delegators, we need to calc it on a basis that pays out the validator min reward.
        const minValidatorSharePercent = await blockRewardHbbft.VALIDATOR_MIN_REWARD_PERCENT();

        const expectedValidatorReward = totalReward.sub(expectedDAOShare).div(BigNumber.from(currentValidators.length)).mul(minValidatorSharePercent).div(BigNumber.from('100'));
        const actualValidatorReward = await blockRewardHbbft.getValidatorReward(stakingEpoch, currentValidators[1]);

        actualValidatorReward.should.be.equal(expectedValidatorReward);

    });

    it('DMD Pots: reinsert pot works as expected.', async () => {
        const maxValidators = await validatorSetHbbft.maxValidators();
        const currentValidators = await validatorSetHbbft.getValidators();
        //refilling the delta pot.
        const deltaPotCurrentValue = await blockRewardHbbft.deltaPot()
        const fillUpMissing = addToDeltaPotValue.sub(deltaPotCurrentValue);

        await blockRewardHbbft.addToDeltaPot({ value: fillUpMissing });
        (await blockRewardHbbft.deltaPot()).should.be.equal(addToDeltaPotValue);

        const addedToReinsertPot = BigNumber.from(ethers.utils.parseEther('60'));

        await blockRewardHbbft.addToReinsertPot({ value: addedToReinsertPot });
        const reinsertPotAfterAdd = await blockRewardHbbft.reinsertPot();
        reinsertPotAfterAdd.should.be.equal(addedToReinsertPot);

        stakingEpoch = await stakingHbbft.stakingEpoch();

        const initialGovernancePotBalance = await getCurrentGovernancePotValue();

        await timeTravelToTransition();
        await timeTravelToEndEpoch();

        const currentGovernancePotBalance = await getCurrentGovernancePotValue();
        const governancePotIncrease = currentGovernancePotBalance.sub(initialGovernancePotBalance);

        const totalReward = addToDeltaPotValue.div(BigNumber.from('6000')).add(addedToReinsertPot.div(BigNumber.from('6000'))).mul(BigNumber.from(currentValidators.length)).div(maxValidators);

        const expectedDAOShare = totalReward.div(BigNumber.from('10'));

        // we expect 1 wei difference, since the reward combination from 2 pots results in that.
        //expectedDAOShare.sub(governancePotIncrease).should.to.be.bignumber.lte(BigNumber.from('1'));
        governancePotIncrease.should.to.be.equal(expectedDAOShare);

        //since there are a lot of delegators, we need to calc it on a basis that pays out the validator min reward.
        const minValidatorSharePercent = await blockRewardHbbft.VALIDATOR_MIN_REWARD_PERCENT();
        const expectedValidatorReward = totalReward.sub(expectedDAOShare).div(BigNumber.from(currentValidators.length)).mul(minValidatorSharePercent).div(BigNumber.from('100'));
        const actualValidatorReward = await blockRewardHbbft.getValidatorReward(stakingEpoch, currentValidators[1]);

        actualValidatorReward.should.be.equal(expectedValidatorReward);
    });

    it('transfers to reward contract works with 100k gas and fills reinsert pot', async () => {

        const fillUpValue = BigNumber.from(ethers.utils.parseEther('1'));

        const balanceBefore = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
        const reinsertPotBefore = BigNumber.from(await blockRewardHbbft.reinsertPot());


        let fillUpTx = {
            to: blockRewardHbbft.address,
            value: fillUpValue,
            gasLimit: '100000',
            gasPrice: ethers.utils.parseUnits('100', 9) //in some configurations the default gasPrice is used here, it uses 0 instead..
        };

        //blockRewardHbbft.address
        await accounts[0].sendTransaction(fillUpTx);

        const balanceAfter = BigNumber.from(await ethers.provider.getBalance(blockRewardHbbft.address));
        const reinsertPotAfter = BigNumber.from(await blockRewardHbbft.reinsertPot());

        balanceAfter.should.be.equal(balanceBefore.add(fillUpValue));
        reinsertPotAfter.should.be.equal(reinsertPotBefore.add(fillUpValue));
    });

    it('reduces the reward if the epoch was shorter than expected', async () => {
        const currentValidators = await validatorSetHbbft.getValidators();
        const maxValidators = await validatorSetHbbft.maxValidators();
        stakingEpoch = await stakingHbbft.stakingEpoch();

        const initialGovernancePotBalance = await getCurrentGovernancePotValue();
        let _epochPercentage = BigNumber.from(30);
        await finishEpochPrelim(_epochPercentage);

        const currentGovernancePotBalance = await getCurrentGovernancePotValue();
        const governancePotIncrease = currentGovernancePotBalance.sub(initialGovernancePotBalance);

        let deltaPotValue = await blockRewardHbbft.deltaPot();
        let reinsertPotValue = await blockRewardHbbft.reinsertPot();

        const deltaPotShare = deltaPotValue.mul(BigNumber.from(currentValidators.length)).mul(_epochPercentage).div(BigNumber.from('6000')).div(maxValidators).div(100);
        const reinsertPotShare = reinsertPotValue.mul(BigNumber.from(currentValidators.length)).mul(_epochPercentage).div(BigNumber.from('6000')).div(maxValidators).div(100);
        const nativeRewardUndistributed = await blockRewardHbbft.nativeRewardUndistributed();

        const totalReward = deltaPotShare.add(reinsertPotShare).add(nativeRewardUndistributed);
        const expectedDAOShare = totalReward.div(BigNumber.from('10'));

        // we expect 1 wei difference, since the reward combination from 2 pots results in that.
        //expectedDAOShare.sub(governancePotIncrease).should.to.be.bignumber.lte(BigNumber.from('1'));
        governancePotIncrease.should.to.be.closeTo(expectedDAOShare, expectedDAOShare.div(100000));

        //since there are a lot of delegators, we need to calc it on a basis that pays out the validator min reward.
        const minValidatorSharePercent = await blockRewardHbbft.VALIDATOR_MIN_REWARD_PERCENT();
        const expectedValidatorReward = totalReward.sub(expectedDAOShare).div(BigNumber.from(currentValidators.length)).mul(minValidatorSharePercent).div(BigNumber.from('100'));
        const actualValidatorReward = await blockRewardHbbft.getValidatorReward(stakingEpoch, currentValidators[1]);

        actualValidatorReward.should.be.closeTo(expectedValidatorReward, expectedValidatorReward.div(100000));
    })

    it('gives full reward if the epoch was longer than expected', async () => {
        const currentValidators = await validatorSetHbbft.getValidators();
        const maxValidators = await validatorSetHbbft.maxValidators();
        stakingEpoch = await stakingHbbft.stakingEpoch();

        const initialGovernancePotBalance = await getCurrentGovernancePotValue();
        let _epochPercentage = BigNumber.from(120);
        await finishEpochPrelim(_epochPercentage);

        const currentGovernancePotBalance = await getCurrentGovernancePotValue();
        const governancePotIncrease = currentGovernancePotBalance.sub(initialGovernancePotBalance);

        let deltaPotValue = await blockRewardHbbft.deltaPot();
        let reinsertPotValue = await blockRewardHbbft.reinsertPot();

        const deltaPotShare = deltaPotValue.mul(BigNumber.from(currentValidators.length)).div(BigNumber.from('6000')).div(maxValidators);
        const reinsertPotShare = reinsertPotValue.mul(BigNumber.from(currentValidators.length)).div(BigNumber.from('6000')).div(maxValidators);
        const nativeRewardUndistributed = await blockRewardHbbft.nativeRewardUndistributed();

        const totalReward = deltaPotShare.add(reinsertPotShare).add(nativeRewardUndistributed);
        const expectedDAOShare = totalReward.div(BigNumber.from('10'));

        // we expect 1 wei difference, since the reward combination from 2 pots results in that.
        //expectedDAOShare.sub(governancePotIncrease).should.to.be.bignumber.lte(BigNumber.from('1'));
        governancePotIncrease.should.to.be.closeTo(expectedDAOShare, expectedDAOShare.div(10000));

        //since there are a lot of delegators, we need to calc it on a basis that pays out the validator min reward.
        const minValidatorSharePercent = await blockRewardHbbft.VALIDATOR_MIN_REWARD_PERCENT();
        const expectedValidatorReward = totalReward.sub(expectedDAOShare).div(BigNumber.from(currentValidators.length)).mul(minValidatorSharePercent).div(BigNumber.from('100'));
        const actualValidatorReward = await blockRewardHbbft.getValidatorReward(stakingEpoch, currentValidators[1]);

        actualValidatorReward.should.be.closeTo(expectedValidatorReward, expectedValidatorReward.div(10000));
    })

    it("epochsToClaimRewardFrom should return correct values", async () => {
        const miningAddress = (await validatorSetHbbft.getValidators())[0]; //mining address
        const stakingAddress = await validatorSetHbbft.stakingByMiningAddress(miningAddress); //stakingaddress
        (await blockRewardHbbft.epochsToClaimRewardFrom(stakingAddress, stakingAddress))[0].should.be.eq(2);
        (await blockRewardHbbft.epochsToClaimRewardFrom(stakingAddress, accounts[11].address))[0].should.be.eq(2);
    })

    it("validatorRewardPercent should return correct values", async () => {
        const miningAddress = (await validatorSetHbbft.getValidators())[2]; //mining address
        const stakingAddress = await validatorSetHbbft.stakingByMiningAddress(miningAddress); //stakingaddress
        //percentage of a validator with delegators should be equal 30%
        (await blockRewardHbbft.validatorRewardPercent(stakingAddress)).should.be.equal(300000);
    })

    describe("Upscaling tests", async () => {
        it("Add multiple validator pools and upscale if needed.", async () => {
            const accountAddresses = accounts.map(item => item.address);
            const additionalValidators = accountAddresses.slice(7, 52 + 1); // accounts[7...32]
            const additionalStakingAddresses = accountAddresses.slice(53, 99 + 1); // accounts[33...59]

            additionalValidators.length.should.be.equal(46);
            additionalStakingAddresses.length.should.be.equal(46);

            await network.provider.send("evm_setIntervalMining", [8]);

            for (let i = 0; i < additionalValidators.length; i++) {
                let stakingAddress = await ethers.getSigner(additionalStakingAddresses[i]);
                let miningAddress = await ethers.getSigner(additionalValidators[i]);

                await stakingHbbft.connect(stakingAddress).addPool(miningAddress.address, '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                    '0x00000000000000000000000000000000', { value: MIN_STAKE });
                await announceAvailability(miningAddress.address);
                await mine();

                let toBeElected = (await stakingHbbft.getPoolsToBeElected()).length;
                let pendingValidators = (await validatorSetHbbft.getPendingValidators()).length
                if (toBeElected > 4 && toBeElected <= 19 && pendingValidators == 0) {
                    (await validatorSetHbbft.getValidatorCountSweetSpot((await stakingHbbft.getPoolsToBeElected()).length)).should.be.equal((await validatorSetHbbft.getValidators()).length);
                }
            }

            await timeTravelToTransition();
            await timeTravelToEndEpoch();
            // after epoch was finalized successfully, validator set length is healthy
            (await validatorSetHbbft.getValidators()).length.should.be.eq(25);
            (await stakingHbbft.getPoolsToBeElected()).length.should.be.eq(49);
        })

        it("banning validator up to 16", async () => {
            await validatorSetHbbft.setSystemAddress(owner.address);
            while ((await validatorSetHbbft.getValidators()).length > 16) {
                await mine();
                await validatorSetHbbft.connect(owner).removeMaliciousValidators([(await validatorSetHbbft.getValidators())[13]]);
            }
            (await validatorSetHbbft.getValidators()).length.should.be.eq(16);
        })
        it("mining twice shouldn't change pending validator set", async () => {
            await callReward(false);
            (await validatorSetHbbft.getPendingValidators()).length.should.be.eq(25);
            let pendingValidators = await validatorSetHbbft.getPendingValidators();
            await callReward(false);
            sortedEqual(pendingValidators, await validatorSetHbbft.getPendingValidators());
        })
        it("set is scaled to 25", async () => {
            await mine();
            (await validatorSetHbbft.getValidators()).length.should.be.eq(25);
            (await validatorSetHbbft.getPendingValidators()).length.should.be.eq(0);
            await network.provider.send("evm_setIntervalMining", [0]);
        })
    })
});

function sortedEqual<T>(arr1: T[], arr2: T[]): void {
    [...arr1].sort().should.be.deep.equal([...arr2].sort());
}

// async function callFinalizeChange() {
//   await validatorSetHbbft.setSystemAddress(owner);
//   await validatorSetHbbft.finalizeChange({from: owner});
//   await validatorSetHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE');
// }

async function getCurrentGovernancePotValue() {
    const governnancePotAddress = await blockRewardHbbft.governancePotAddress();
    (BigNumber.from(governnancePotAddress)).should.be.gt(BigNumber.from(0));
    const result = BigNumber.from(await ethers.provider.getBalance(governnancePotAddress));
    return result;
}


async function callReward(isEpochEndBlock: boolean) {
    // console.log('getting validators...');
    // note: this call used to crash because of a internal problem with a previous call of evm_mine and evm_increase_time https://github.com/DMDcoin/hbbft-posdao-contracts/issues/13
    // const validators = await validatorSetHbbft.getValidators();
    // console.log('got validators:', validators);
    await blockRewardHbbft.setSystemAddress(owner.address);
    await blockRewardHbbft.connect(owner).reward(isEpochEndBlock);
    await blockRewardHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE');
}

// time travels forward to the beginning of the next transition,
// and simulate a block mining (calling reward())
async function timeTravelToTransition() {
    let startTimeOfNextPhaseTransition = await stakingHbbft.startTimeOfNextPhaseTransition();

    await helpers.time.increaseTo(startTimeOfNextPhaseTransition);
    await callReward(false);
}

async function timeTravelToEndEpoch() {
    const endTimeOfCurrentEpoch = await stakingHbbft.stakingFixedEpochEndTime();

    await helpers.time.increaseTo(endTimeOfCurrentEpoch);
    await callReward(true);
}

async function finishEpochPrelim(_percentage: BigNumber) {
    const epochDuration = (await stakingHbbft.stakingFixedEpochEndTime()).sub((await stakingHbbft.stakingEpochStartTime())).mul(_percentage).div(100).add(1);
    const endTimeOfCurrentEpoch = (await stakingHbbft.stakingEpochStartTime()).add(epochDuration);

    await helpers.time.increaseTo(endTimeOfCurrentEpoch.toNumber());
    await callReward(true);
}

async function announceAvailability(pool: string) {
    const blockNumber = await ethers.provider.getBlockNumber()
    const block = await ethers.provider.getBlock(blockNumber);
    const asEncoded = validatorSetHbbft.interface.encodeFunctionData("announceAvailability", [blockNumber, block.hash]);

    // we know now, that this call is allowed.
    // so we can execute it.
    await (await ethers.getSigner(pool)).sendTransaction({ to: validatorSetHbbft.address, data: asEncoded });
}

async function mine() {
    let expectedEpochDuration = (await stakingHbbft
        .stakingFixedEpochEndTime()).sub(await stakingHbbft.stakingEpochStartTime());
    let blocktime = expectedEpochDuration.mul(5).div(100).add(1); //5% of the epoch
    // let blocksPerEpoch = 60 * 60 * 12 / blocktime;

    await helpers.time.increase(blocktime.toNumber());

    if ((await validatorSetHbbft.getPendingValidators()).length > 0) {
        const currentValidators = await validatorSetHbbft.getValidators();
        const maxValidators = await validatorSetHbbft.maxValidators();
        stakingEpoch = await stakingHbbft.stakingEpoch();

        const initialGovernancePotBalance = await getCurrentGovernancePotValue();
        let deltaPotValue = await blockRewardHbbft.deltaPot();
        let reinsertPotValue = await blockRewardHbbft.reinsertPot();
        let _epochPercentage = await blockRewardHbbft.epochPercentage();

        await callReward(true);

        const currentGovernancePotBalance = await getCurrentGovernancePotValue();
        const governancePotIncrease = currentGovernancePotBalance.sub(initialGovernancePotBalance);


        const deltaPotShare = deltaPotValue.mul(BigNumber.from(currentValidators.length)).mul(_epochPercentage).div(BigNumber.from('6000')).div(maxValidators).div(100);
        const reinsertPotShare = reinsertPotValue.mul(BigNumber.from(currentValidators.length)).mul(_epochPercentage).div(BigNumber.from('6000')).div(maxValidators).div(100);
        const nativeRewardUndistributed = await blockRewardHbbft.nativeRewardUndistributed();

        const totalReward = deltaPotShare.add(reinsertPotShare).add(nativeRewardUndistributed);
        const expectedDAOShare = totalReward.div(BigNumber.from('10'));

        // we expect 1 wei difference, since the reward combination from 2 pots results in that.
        //expectedDAOShare.sub(governancePotIncrease).should.to.be.bignumber.lte(BigNumber.from('1'));
        governancePotIncrease.should.to.be.closeTo(expectedDAOShare, expectedDAOShare.div(10000));

        //since there are a lot of delegators, we need to calc it on a basis that pays out the validator min reward.
        let minValidatorSharePercent = 100;
        //staking address of the validator
        let stakingAddress = await validatorSetHbbft.stakingByMiningAddress(currentValidators[currentValidators.length - 1])
        ///first 4 validators have delegators so they receive less DMD
        if ((await stakingHbbft.poolDelegators(stakingAddress)).length) {
            minValidatorSharePercent = 30;
        }

        const expectedValidatorReward = totalReward.sub(expectedDAOShare).div(BigNumber.from(currentValidators.length)).mul(minValidatorSharePercent).div(BigNumber.from('100'));
        const actualValidatorReward = await blockRewardHbbft.getValidatorReward(stakingEpoch, currentValidators[currentValidators.length - 1]);

        actualValidatorReward.should.be.closeTo(expectedValidatorReward, expectedValidatorReward.div(10000));
    } else {
        await callReward(false);
    }
}
