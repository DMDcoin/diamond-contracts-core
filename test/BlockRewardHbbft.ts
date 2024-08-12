import { ethers, network, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import * as _ from "lodash";
import fp from "lodash/fp";

import {
    BlockRewardHbbftMock,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    RandomHbbft,
    KeyGenHistory,
    CertifierHbbft,
    TxPermissionHbbft,
} from "../src/types";

import { getNValidatorsPartNAcks } from "./testhelpers/data";
import { GovernanceAddress, deployDao } from "./testhelpers/daoDeployment";

// one epoch in 1 day.
const STAKING_FIXED_EPOCH_DURATION = 86400n;

// the transition time window is 1 hour.
const STAKING_TRANSITION_WINDOW_LENGTH = 3600n;

const STAKE_WITHDRAW_DISALLOW_PERIOD = 2n; // one less than EPOCH DURATION, therefore it meets the conditions.
const MIN_STAKE = ethers.parseEther('1');
const DELEGATOR_MIN_STAKE = ethers.parseEther('100');
const MAX_STAKE = ethers.parseEther('100000');

const SystemAccountAddress = '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE';

const addToDeltaPotValue = ethers.parseEther('60');
const validatorInactivityThreshold = 365n * 86400n // 1 year

let contractDeployCounter = 0;

describe('BlockRewardHbbft', () => {
    let owner: HardhatEthersSigner;
    let accounts: HardhatEthersSigner[];
    let initialValidators: string[];
    let initialStakingAddresses: string[];
    let initialValidatorsPubKeys;
    let initialValidatorsIpAddresses;
    let validators;

    let candidateMinStake: bigint;
    let delegatorMinStake: bigint;
    let nativeRewardUndistributed = 0n;

    let blockRewardHbbft: BlockRewardHbbftMock;
    let validatorSetHbbft: ValidatorSetHbbftMock;
    let stakingHbbft: StakingHbbftMock;

    let stubAddress: string;

    before(async () => {
        [owner, ...accounts] = await ethers.getSigners();
        const accountAddresses = accounts.map(item => item.address);

        stubAddress = accounts[7].address;

        initialValidators = accountAddresses.slice(1, 3 + 1); // accounts[1...3]
        initialStakingAddresses = accountAddresses.slice(4, 6 + 1); // accounts[4...6]

        expect(initialStakingAddresses).to.be.lengthOf(3);
        expect(initialStakingAddresses[0]).to.not.be.equal(ethers.ZeroAddress);
        expect(initialStakingAddresses[1]).to.not.be.equal(ethers.ZeroAddress);
        expect(initialStakingAddresses[2]).to.not.be.equal(ethers.ZeroAddress);

        const {
            blockRewardContract,
            validatorSetContract,
            stakingContract,
        } = await helpers.loadFixture(deployContractsFixture);

        blockRewardHbbft = blockRewardContract;
        validatorSetHbbft = validatorSetContract;
        stakingHbbft = stakingContract;

        candidateMinStake = await stakingHbbft.candidateMinStake();
        delegatorMinStake = await stakingHbbft.delegatorMinStake();
    });

    async function deployContractsFixture() {
        const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

        contractDeployCounter = contractDeployCounter + 1;

        // every second deployment we add the DAOMock contract,
        // so we also cover the possibility that no contract was deployed.
        await deployDao();

        const bonusScoreContractMockFactory = await ethers.getContractFactory("BonusScoreSystemMock");
        const bonusScoreContractMock = await bonusScoreContractMockFactory.deploy();
        await bonusScoreContractMock.waitForDeployment();

        const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbftMock");
        const connectivityTrackerContract = await ConnectivityTrackerFactory.deploy();
        await connectivityTrackerContract.waitForDeployment();

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: await bonusScoreContractMock.getAddress(),
            validatorInactivityThreshold: validatorInactivityThreshold,
        }

        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetContract = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                validatorSetParams,      // _params
                initialValidators,       // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as ValidatorSetHbbftMock;

        await validatorSetContract.waitForDeployment();

        const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
        const randomHbbftContract = await upgrades.deployProxy(
            RandomHbbftFactory,
            [
                owner.address,
                await validatorSetContract.getAddress()
            ],
            { initializer: 'initialize' },
        ) as unknown as RandomHbbft;

        await randomHbbftContract.waitForDeployment();

        const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
        const keyGenHistoryContract = await upgrades.deployProxy(
            KeyGenFactory,
            [
                owner.address,
                await validatorSetContract.getAddress(),
                initialValidators,
                parts,
                acks
            ],
            { initializer: 'initialize' }
        ) as unknown as KeyGenHistory;

        await keyGenHistoryContract.waitForDeployment();

        const CertifierFactory = await ethers.getContractFactory("CertifierHbbft");
        const certifierContract = await upgrades.deployProxy(
            CertifierFactory,
            [
                [owner.address],
                await validatorSetContract.getAddress(),
                owner.address
            ],
            { initializer: 'initialize' }
        ) as unknown as CertifierHbbft;

        await certifierContract.waitForDeployment();

        const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");
        const txPermissionContract = await upgrades.deployProxy(
            TxPermissionFactory,
            [
                [owner.address],
                await certifierContract.getAddress(),
                await validatorSetContract.getAddress(),
                await keyGenHistoryContract.getAddress(),
                await connectivityTrackerContract.getAddress(),
                owner.address
            ],
            { initializer: 'initialize' }
        ) as unknown as TxPermissionHbbft;

        await txPermissionContract.waitForDeployment();

        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        const blockRewardContract = await upgrades.deployProxy(
            BlockRewardHbbftFactory,
            [
                owner.address,
                await validatorSetContract.getAddress(),
                await connectivityTrackerContract.getAddress(),
            ],
            { initializer: 'initialize' }
        ) as unknown as BlockRewardHbbftMock;

        await blockRewardContract.waitForDeployment();

        // The following private keys belong to the accounts 1-3, fixed by using the "--mnemonic" option when starting ganache.
        // const initialValidatorsPrivKeys = ["0x272b8400a202c08e23641b53368d603e5fec5c13ea2f438bce291f7be63a02a7", "0xa8ea110ffc8fe68a069c8a460ad6b9698b09e21ad5503285f633b3ad79076cf7", "0x5da461ff1378256f69cb9a9d0a8b370c97c460acbe88f5d897cb17209f891ffc"];
        // Public keys corresponding to the three private keys above.
        initialValidatorsPubKeys = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            ([
                '0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
                '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
                '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56'
            ]);

        // The IP addresses are irrelevant for these unit test, just initialize them to 0.
        initialValidatorsIpAddresses = Array(initialValidators.length).fill(ethers.zeroPadBytes("0x00", 16));

        let structure = {
            _validatorSetContract: await validatorSetContract.getAddress(),
            _bonusScoreContract: await bonusScoreContractMock.getAddress(),
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: DELEGATOR_MIN_STAKE,
            _candidateMinStake: MIN_STAKE,
            _maxStake: MAX_STAKE,
            _stakingFixedEpochDuration: STAKING_FIXED_EPOCH_DURATION,
            _stakingTransitionTimeframeLength: STAKING_TRANSITION_WINDOW_LENGTH,
            _stakingWithdrawDisallowPeriod: STAKE_WITHDRAW_DISALLOW_PERIOD
        };

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingContract = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                structure, // initializer structure
                initialValidatorsPubKeys, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as StakingHbbftMock;

        await stakingContract.waitForDeployment();

        await validatorSetContract.setBlockRewardContract(await blockRewardContract.getAddress());
        await validatorSetContract.setRandomContract(await randomHbbftContract.getAddress());
        await validatorSetContract.setStakingContract(await stakingContract.getAddress());
        await validatorSetContract.setKeyGenHistoryContract(await keyGenHistoryContract.getAddress());

        return { blockRewardContract, validatorSetContract, stakingContract, connectivityTrackerContract };
    }

    async function impersonateAcc(address: string) {
        await helpers.impersonateAccount(address);

        await owner.sendTransaction({
            to: address,
            value: ethers.parseEther('10'),
        });

        return await ethers.getSigner(address);
    }

    async function callReward(_blockReward: BlockRewardHbbftMock, isEpochEndBlock: boolean) {
        // console.log('getting validators...');
        // note: this call used to crash because of a internal problem with a previous call of evm_mine and evm_increase_time https://github.com/DMDcoin/diamond-contracts-core/issues/13
        // const validators = await validatorSetHbbft.getValidators();
        // console.log('got validators:', validators);
        const systemSigner = await impersonateAcc(SystemAccountAddress);

        await _blockReward.connect(systemSigner).reward(isEpochEndBlock);

        await helpers.stopImpersonatingAccount(SystemAccountAddress);
    }

    async function getCurrentGovernancePotValue(): Promise<bigint> {
        const governnancePotAddress = await blockRewardHbbft.governancePotAddress();
        expect(governnancePotAddress).to.not.equal(ethers.ZeroAddress);

        return await ethers.provider.getBalance(governnancePotAddress);
    }

    // time travels forward to the beginning of the next transition,
    // and simulate a block mining (calling reward())
    async function timeTravelToTransition(_staking: StakingHbbftMock, _blockReward: BlockRewardHbbftMock) {
        let startTimeOfNextPhaseTransition = await _staking.startTimeOfNextPhaseTransition();

        await helpers.time.increaseTo(startTimeOfNextPhaseTransition);
        await callReward(_blockReward, false);
    }

    async function timeTravelToEndEpoch(_staking: StakingHbbftMock, _blockReward: BlockRewardHbbftMock) {
        const endTimeOfCurrentEpoch = await _staking.stakingFixedEpochEndTime();

        await helpers.time.increaseTo(endTimeOfCurrentEpoch);
        await callReward(_blockReward, true);
    }

    async function finishEpochPrelim(
        _staking: StakingHbbftMock,
        _blockReward: BlockRewardHbbftMock,
        _percentage: bigint
    ) {
        const stakingFixedEpochEndTime = await _staking.stakingFixedEpochEndTime();
        const stakingEpochStartTime = await _staking.stakingEpochStartTime();

        const epochDuration = (stakingFixedEpochEndTime - stakingEpochStartTime) * _percentage / 100n + 1n;
        const endTimeOfCurrentEpoch = stakingEpochStartTime + epochDuration;

        await helpers.time.increaseTo(endTimeOfCurrentEpoch);
        await callReward(_blockReward, true);
    }

    async function announceAvailability(pool: string) {
        const blockNumber = await ethers.provider.getBlockNumber()
        const block = await ethers.provider.getBlock(blockNumber);

        const asEncoded = validatorSetHbbft.interface.encodeFunctionData(
            "announceAvailability",
            [blockNumber, block!.hash!]
        );

        // we know now, that this call is allowed.
        // so we can execute it.
        await (await ethers.getSigner(pool)).sendTransaction({
            to: await validatorSetHbbft.getAddress(),
            data: asEncoded
        });
    }

    async function getValidatorStake(validatorAddr: string) {
        const stakingAddr = await validatorSetHbbft.stakingByMiningAddress(validatorAddr);
        return await stakingHbbft.stakeAmount(stakingAddr, stakingAddr);
    }

    async function mine() {
        let expectedEpochDuration = (await stakingHbbft
            .stakingFixedEpochEndTime()) - (await stakingHbbft.stakingEpochStartTime());
        let blocktime = expectedEpochDuration * 5n / 100n + 1n; //5% of the epoch
        // let blocksPerEpoch = 60 * 60 * 12 / blocktime;

        await helpers.time.increase(blocktime);

        if ((await validatorSetHbbft.getPendingValidators()).length > 0) {
            const currentValidators = await validatorSetHbbft.getValidators();
            const maxValidators = await validatorSetHbbft.maxValidators();

            const initialGovernancePotBalance = await getCurrentGovernancePotValue();
            let deltaPotValue = await blockRewardHbbft.deltaPot();
            let reinsertPotValue = await blockRewardHbbft.reinsertPot();
            let _epochPercentage = await blockRewardHbbft.epochPercentage();

            const stakeBeforeReward = await getValidatorStake(currentValidators.at(-1)!);

            await callReward(blockRewardHbbft, true);

            const currentGovernancePotBalance = await getCurrentGovernancePotValue();
            const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

            const deltaPotShare = deltaPotValue * BigInt(currentValidators.length) * _epochPercentage / 6000n / maxValidators / 100n;
            const reinsertPotShare = reinsertPotValue * BigInt(currentValidators.length) * _epochPercentage / 6000n / maxValidators / 100n;
            const nativeRewardUndistributed = await blockRewardHbbft.nativeRewardUndistributed();

            const totalReward = deltaPotShare + reinsertPotShare + nativeRewardUndistributed;
            const expectedDAOShare = totalReward / 10n;

            // we expect 1 wei difference, since the reward combination from 2 pots results in that.
            //expectedDAOShare.sub(governancePotIncrease).should.to.be.bignumber.lte(BigNumber.from('1'));
            expect(governancePotIncrease).to.be.closeTo(expectedDAOShare, expectedDAOShare / 10000n);

            //since there are a lot of delegators, we need to calc it on a basis that pays out the validator min reward.
            let minValidatorSharePercent = 100n;
            //staking address of the validator
            let stakingAddress = await validatorSetHbbft.stakingByMiningAddress(currentValidators[currentValidators.length - 1])
            ///first 4 validators have delegators so they receive less DMD
            if ((await stakingHbbft.poolDelegators(stakingAddress)).length) {
                minValidatorSharePercent = 30n;
            }

            const expectedValidatorReward = (totalReward - expectedDAOShare) / BigInt(currentValidators.length) * minValidatorSharePercent / 100n;
            const stakeAfterReward = await getValidatorStake(currentValidators.at(-1)!);
            const actualValidatorReward = stakeAfterReward - stakeBeforeReward;

            expect(actualValidatorReward).to.be.closeTo(expectedValidatorReward, expectedValidatorReward / 10000n);
        } else {
            await callReward(blockRewardHbbft, false);
        }
    }

    describe('initialize', async () => {
        it('should fail if owner = address(0)', async () => {
            const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbft");
            await expect(upgrades.deployProxy(
                BlockRewardHbbftFactory,
                [
                    ethers.ZeroAddress,
                    stubAddress,
                    stubAddress
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(BlockRewardHbbftFactory, "ZeroAddress");
        });

        it('should fail if ValidatorSet = address(0)', async () => {
            const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbft");
            await expect(upgrades.deployProxy(
                BlockRewardHbbftFactory,
                [
                    stubAddress,
                    ethers.ZeroAddress,
                    stubAddress
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(BlockRewardHbbftFactory, "ZeroAddress");
        });

        it('should fail if ConnectivityTracker = address(0)', async () => {
            const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbft");
            await expect(upgrades.deployProxy(
                BlockRewardHbbftFactory,
                [
                    stubAddress,
                    stubAddress,
                    ethers.ZeroAddress
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(BlockRewardHbbftFactory, "ZeroAddress");
        });

        it('should fail on double initialization', async () => {
            const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbft");
            const blockReward = await upgrades.deployProxy(
                BlockRewardHbbftFactory,
                [
                    stubAddress,
                    stubAddress,
                    stubAddress,
                ],
                { initializer: 'initialize' }
            );

            await blockReward.waitForDeployment();

            await expect(blockReward.initialize(
                stubAddress,
                stubAddress,
                stubAddress,
            )).to.be.revertedWithCustomError(blockReward, "InvalidInitialization");
        });
    });

    describe('setdeltaPotPayoutFraction', async () => {
        it('should restrict calling to contract owner', async () => {
            const caller = accounts[5];

            await expect(blockRewardHbbft.connect(caller).setdeltaPotPayoutFraction(1))
                .to.be.revertedWithCustomError(blockRewardHbbft, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should not allow zero payout fraction', async () => {
            await expect(blockRewardHbbft.setdeltaPotPayoutFraction(0))
                .to.be.revertedWithCustomError(blockRewardHbbft, "ZeroPayoutFraction");
        });

        it('should set delta pot payout fraction and emit event', async () => {
            const previousValue = await blockRewardHbbft.deltaPotPayoutFraction();
            const newValue = 10;

            await expect(blockRewardHbbft.setdeltaPotPayoutFraction(newValue))
                .to.emit(blockRewardHbbft, "SetDeltaPotPayoutFraction")
                .withArgs(newValue);
            expect(await blockRewardHbbft.deltaPotPayoutFraction()).to.be.equal(newValue);

            expect(await blockRewardHbbft.setdeltaPotPayoutFraction(previousValue));
            expect(await blockRewardHbbft.deltaPotPayoutFraction()).to.be.equal(previousValue);
        });
    });

    describe('setReinsertPotPayoutFraction', async () => {
        it('should restrict calling to contract owner', async () => {
            const caller = accounts[5];

            await expect(blockRewardHbbft.connect(caller).setReinsertPotPayoutFraction(1))
                .to.be.revertedWithCustomError(blockRewardHbbft, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should not allow zero payout fraction', async () => {
            await expect(blockRewardHbbft.setReinsertPotPayoutFraction(0))
                .to.be.revertedWithCustomError(blockRewardHbbft, "ZeroPayoutFraction");
        });

        it('should set reinsert pot payout fraction and emit event', async () => {
            const previousValue = await blockRewardHbbft.reinsertPotPayoutFraction();
            const newValue = 10;

            await expect(blockRewardHbbft.setReinsertPotPayoutFraction(newValue))
                .to.emit(blockRewardHbbft, "SetReinsertPotPayoutFraction")
                .withArgs(newValue);
            expect(await blockRewardHbbft.reinsertPotPayoutFraction()).to.be.equal(newValue);

            expect(await blockRewardHbbft.setReinsertPotPayoutFraction(previousValue));
            expect(await blockRewardHbbft.reinsertPotPayoutFraction()).to.be.equal(previousValue);
        });
    });

    describe('setConnectivityTracker', async () => {
        it('should restrict calling to contract owner', async () => {
            const caller = accounts[5];

            await expect(blockRewardHbbft.connect(caller).setConnectivityTracker(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(blockRewardHbbft, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should revert set zero address', async () => {
            await expect(blockRewardHbbft.setConnectivityTracker(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(blockRewardHbbft, "ZeroAddress");
        });

        it('should set connectivity tracker address and emit event', async () => {
            const previousValue = await blockRewardHbbft.connectivityTracker();
            const newValue = accounts[7];

            await expect(blockRewardHbbft.setConnectivityTracker(newValue))
                .to.emit(blockRewardHbbft, "SetConnectivityTracker")
                .withArgs(newValue);
            expect(await blockRewardHbbft.connectivityTracker()).to.be.equal(newValue);

            expect(await blockRewardHbbft.setConnectivityTracker(previousValue));
            expect(await blockRewardHbbft.connectivityTracker()).to.be.equal(previousValue);
        });
    });

    it('should get governance address', async () => {
        expect(await blockRewardHbbft.getGovernanceAddress()).to.be.equal(GovernanceAddress);
    });

    describe('reward', async () => {
        it('should restrict calling reward only to system address', async () => {
            const { blockRewardContract } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];

            await expect(blockRewardContract.connect(caller).reward(false)).to.be.reverted;
        });

        it('should revert for zero validators', async () => {
            const {
                blockRewardContract,
                validatorSetContract,
                stakingContract
            } = await helpers.loadFixture(deployContractsFixture);

            await validatorSetContract.forceFinalizeNewValidators();

            const validatorSetSigner = await impersonateAcc(await validatorSetContract.getAddress());
            await stakingContract.connect(validatorSetSigner).incrementStakingEpoch();
            await helpers.stopImpersonatingAccount(validatorSetSigner.address);

            expect(await validatorSetContract.getValidators()).to.be.empty;

            const systemSigner = await impersonateAcc(SystemAccountAddress);
            await expect(blockRewardContract.connect(systemSigner).reward(true))
                .to.be.revertedWithCustomError(blockRewardContract, "ValidatorsListEmpty");
            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        });

        it('should save epochs in which validator was awarded', async () => {
            const {
                blockRewardContract,
                stakingContract,
            } = await helpers.loadFixture(deployContractsFixture);

            for (const _staking of initialStakingAddresses) {
                const pool = await ethers.getSigner(_staking);

                await stakingContract.connect(pool).stake(pool.address, { value: candidateMinStake });
                expect(await stakingContract.stakeAmountTotal(pool.address)).to.be.eq(candidateMinStake);
            }

            for (const _validator of initialValidators) {
                expect(await blockRewardContract.epochsPoolGotRewardFor(_validator)).to.be.empty;
            }

            await callReward(blockRewardContract, true);

            const deltaPotValue = ethers.parseEther('10');
            await blockRewardContract.addToDeltaPot({ value: deltaPotValue });
            expect(await blockRewardContract.deltaPot()).to.be.eq(deltaPotValue);

            const expectedEpochsCount = 10;
            let passedEpochs = new Array<bigint>();

            for (let i = 0; i < expectedEpochsCount; ++i) {
                const fixedEpochEndTime = await stakingHbbft.stakingFixedEpochEndTime();
                await helpers.time.increaseTo(fixedEpochEndTime + 1n);
                await helpers.mine(1);

                const epochNumber = await stakingContract.stakingEpoch();

                passedEpochs.push(epochNumber);
                await callReward(blockRewardContract, true);
            }

            expect(passedEpochs).to.be.lengthOf(expectedEpochsCount);

            for (const _validator of initialValidators) {
                const poolRewardedEpochs = await blockRewardContract.epochsPoolGotRewardFor(_validator);

                expect(poolRewardedEpochs).to.be.lengthOf(expectedEpochsCount);
                expect(poolRewardedEpochs).to.deep.equal(passedEpochs);
            }
        });
    });

    it('staking epoch #0 finished', async () => {
        expect(await stakingHbbft.stakingEpoch()).to.equal(0n);

        // we are now in the Phase 1: Regular Block Creation
        //means: just a normal and boring block.
        await callReward(blockRewardHbbft, false);

        //boring, thing happened, we still should have zero pendingValidors.
        expect(await validatorSetHbbft.getPendingValidators()).to.be.empty;

        //lets spin up the time until the beginning of the Transition phase.
        await timeTravelToTransition(stakingHbbft, blockRewardHbbft);
        await timeTravelToEndEpoch(stakingHbbft, blockRewardHbbft);

        // that was the end of epoch 0,
        // we should be in epoch 1 now.
        expect(await stakingHbbft.stakingEpoch()).to.be.equal(1n);

        // since noone stacked after all, pending validators should still be 0
        expect(await validatorSetHbbft.getPendingValidators()).to.be.empty;
        expect(await blockRewardHbbft.nativeRewardUndistributed()).to.be.equal(nativeRewardUndistributed);
    });

    it('staking epoch #1 started', async () => {
        expect(await stakingHbbft.stakingEpoch()).to.be.equal(1n);
        expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(3);

        // Docs: The pendingValidators set returned by the ValidatorSet contract is empty in this phase,.
        expect(await validatorSetHbbft.getPendingValidators()).to.be.empty;
        expect(await stakingHbbft.getPoolsToBeElected()).to.be.empty;
    });

    it('validators and their delegators place stakes during the epoch #1', async () => {
        const validators = await validatorSetHbbft.getValidators();

        for (let i = 0; i < validators.length; i++) {
            const stakingAddress = await validatorSetHbbft.stakingByMiningAddress(validators[i]);

            // Validator places stake on themselves
            await stakingHbbft.connect(await ethers.provider.getSigner(stakingAddress)).stake(
                stakingAddress,
                { value: candidateMinStake }
            );

            const delegatorsLength = 3;
            const delegators = accounts.slice(11 + i * delegatorsLength, 11 + i * delegatorsLength + delegatorsLength);
            for (let j = 0; j < delegators.length; j++) {
                // Delegator places stake on the validator
                await stakingHbbft.connect(delegators[j]).stake(
                    stakingAddress,
                    { value: delegatorMinStake }
                );
            }
        }
    });

    it('staking epoch #1 finished', async () => {
        expect(await stakingHbbft.stakingEpoch()).to.equal(1n);

        // const stakingEpochStartBlock = await stakingHbbft.stakingEpochStartBlock();
        // stakingEpochStartBlock.should.be.equal(STAKING_EPOCH_START_BLOCK.add(STAKING_EPOCH_DURATION));

        expect(await validatorSetHbbft.getPendingValidators()).to.be.empty;

        // we have staked just before, now there should be 3 pools.
        expect(await stakingHbbft.getPoolsToBeElected()).to.be.lengthOf(3);

        //lets spin up the time until the beginning of the Transition phase.
        await timeTravelToTransition(stakingHbbft, blockRewardHbbft);

        let pendingValidators = await validatorSetHbbft.getPendingValidators();

        expect(
            _.isEqual(_.sortBy(pendingValidators), _.sortBy([
                accounts[1].address,
                accounts[2].address,
                accounts[3].address
            ]))
        ).to.be.true;

        // now we are in phase 2.
        // Nodes are now responsible for creating a key together.
        // they have a timeframe for this (see )

        // since we are now  in phase 2 of the same epoch.
        expect(await stakingHbbft.stakingEpoch()).to.equal(1n);
        expect(await blockRewardHbbft.nativeRewardUndistributed()).to.equal(nativeRewardUndistributed);

        await timeTravelToEndEpoch(stakingHbbft, blockRewardHbbft);

        const nextStakingEpoch = await stakingHbbft.stakingEpoch();
        //since the endEpoch happened, we should be in the epoch 2 now.
        expect(nextStakingEpoch).to.equal(2n);

        // pending validators get deleted after being finalized
        expect(await validatorSetHbbft.getPendingValidators()).to.be.empty;

        validators = await validatorSetHbbft.getValidators();
        expect(
            _.isEqual(_.sortBy(validators), _.sortBy([
                accounts[1].address,
                accounts[2].address,
                accounts[3].address
            ]))
        ).to.be.true;

        for (let i = 0; i < validators.length; i++) {
            const stakingAddress = await validatorSetHbbft.stakingByMiningAddress(validators[i]);

            expect(
                await stakingHbbft.snapshotPoolValidatorStakeAmount(nextStakingEpoch, stakingAddress)
            ).to.equal(candidateMinStake);

            expect(
                await stakingHbbft.snapshotPoolTotalStakeAmount(nextStakingEpoch, stakingAddress)
            ).to.equal(candidateMinStake + delegatorMinStake * 3n);
        }
    });

    it('DMD Pots: filling delta pot', async () => {
        expect(await stakingHbbft.stakingEpoch()).to.equal(2n);

        //checking preconditions.
        // get the current address pof the governance pot.
        expect(await ethers.provider.getBalance(await blockRewardHbbft.getAddress())).to.equal(0n);

        expect(await blockRewardHbbft.deltaPot()).to.equal(0n);
        expect(await blockRewardHbbft.reinsertPot()).to.equal(0n);

        await blockRewardHbbft.addToDeltaPot({ value: addToDeltaPotValue });

        expect(await blockRewardHbbft.deltaPot()).to.equal(addToDeltaPotValue);
    });

    it('DMD Pots: governance pot got correct share.', async () => {
        const maxValidators = await validatorSetHbbft.maxValidators();
        const currentValidators = await validatorSetHbbft.getValidators();

        expect(currentValidators).to.be.lengthOf(3);

        const initialGovernancePotBalance = await getCurrentGovernancePotValue();

        await timeTravelToTransition(stakingHbbft, blockRewardHbbft);
        await timeTravelToEndEpoch(stakingHbbft, blockRewardHbbft);

        const currentGovernancePotBalance = await getCurrentGovernancePotValue();
        const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

        const totalReward = addToDeltaPotValue / 6000n * BigInt(currentValidators.length) / maxValidators;
        const expectedDAOShare = totalReward / 10n;

        expect(governancePotIncrease).to.equal(expectedDAOShare);
    });

    it('DMD Pots: reinsert pot works as expected.', async () => {
        const maxValidators = await validatorSetHbbft.maxValidators();
        const currentValidators = await validatorSetHbbft.getValidators();

        //refilling the delta pot.
        const deltaPotCurrentValue = await blockRewardHbbft.deltaPot()
        const fillUpMissing = addToDeltaPotValue - deltaPotCurrentValue;

        await blockRewardHbbft.addToDeltaPot({ value: fillUpMissing });
        expect(await blockRewardHbbft.deltaPot()).to.be.equal(addToDeltaPotValue);

        const addedToReinsertPot = ethers.parseEther('60');

        await blockRewardHbbft.addToReinsertPot({ value: addedToReinsertPot });
        expect(await blockRewardHbbft.reinsertPot()).to.be.equal(addedToReinsertPot);

        const initialGovernancePotBalance = await getCurrentGovernancePotValue();

        await timeTravelToTransition(stakingHbbft, blockRewardHbbft);
        await timeTravelToEndEpoch(stakingHbbft, blockRewardHbbft);

        const currentGovernancePotBalance = await getCurrentGovernancePotValue();
        const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

        const totalReward = (addToDeltaPotValue + addedToReinsertPot) / 6000n * BigInt(currentValidators.length) / maxValidators;

        const expectedDAOShare = totalReward / 10n;

        // we expect 1 wei difference, since the reward combination from 2 pots results in that.
        //expectedDAOShare.sub(governancePotIncrease).should.to.be.bignumber.lte(BigNumber.from('1'));
        expect(governancePotIncrease).to.be.equal(expectedDAOShare);
    });

    it('transfers to reward contract works with 100k gas and fills reinsert pot', async () => {
        const fillUpValue = ethers.parseEther('1');

        const balanceBefore = await ethers.provider.getBalance(await blockRewardHbbft.getAddress());
        const reinsertPotBefore = await blockRewardHbbft.reinsertPot();

        let fillUpTx = {
            to: await blockRewardHbbft.getAddress(),
            value: fillUpValue,
            gasLimit: 100000n,
            gasPrice: ethers.parseUnits('100', 9) //in some configurations the default gasPrice is used here, it uses 0 instead..
        };

        await accounts[0].sendTransaction(fillUpTx);

        const balanceAfter = await ethers.provider.getBalance(await blockRewardHbbft.getAddress());
        const reinsertPotAfter = await blockRewardHbbft.reinsertPot();

        expect(balanceAfter).to.equal(balanceBefore + fillUpValue);
        expect(reinsertPotAfter).to.equal(reinsertPotBefore + fillUpValue);
    });

    it('reduces the reward if the epoch was shorter than expected', async () => {
        const currentValidators = await validatorSetHbbft.getValidators();
        const maxValidators = await validatorSetHbbft.maxValidators();

        const stakeBeforeReward = await getValidatorStake(currentValidators[1]);

        const initialGovernancePotBalance = await getCurrentGovernancePotValue();
        let _epochPercentage = 30n;
        await finishEpochPrelim(stakingHbbft, blockRewardHbbft, _epochPercentage);

        const currentGovernancePotBalance = await getCurrentGovernancePotValue();
        const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

        let deltaPotValue = await blockRewardHbbft.deltaPot();
        let reinsertPotValue = await blockRewardHbbft.reinsertPot();

        const deltaPotShare = deltaPotValue * BigInt(currentValidators.length) * _epochPercentage / 6000n / maxValidators / 100n;
        const reinsertPotShare = reinsertPotValue * BigInt(currentValidators.length) * _epochPercentage / 6000n / maxValidators / 100n;
        const nativeRewardUndistributed = await blockRewardHbbft.nativeRewardUndistributed();

        const totalReward = deltaPotShare + reinsertPotShare + nativeRewardUndistributed;
        const expectedDAOShare = totalReward / 10n;

        // we expect 1 wei difference, since the reward combination from 2 pots results in that.
        //expectedDAOShare.sub(governancePotIncrease).should.to.be.bignumber.lte(BigNumber.from('1'));
        expect(governancePotIncrease).to.be.closeTo(expectedDAOShare, expectedDAOShare / 100000n);

        //since there are a lot of delegators, we need to calc it on a basis that pays out the validator min reward.
        const minValidatorSharePercent = await blockRewardHbbft.VALIDATOR_MIN_REWARD_PERCENT();
        const expectedValidatorReward = (totalReward - expectedDAOShare) / BigInt(currentValidators.length) * minValidatorSharePercent / 100n;

        const stakeAfterReward = await getValidatorStake(currentValidators[1]);
        const actualValidatorReward = stakeAfterReward - stakeBeforeReward;

        expect(actualValidatorReward).to.be.closeTo(expectedValidatorReward, expectedValidatorReward / 100000n);
    });

    it('gives full reward if the epoch was longer than expected', async () => {
        const currentValidators = await validatorSetHbbft.getValidators();
        const maxValidators = await validatorSetHbbft.maxValidators();

        const stakeBeforeReward = await getValidatorStake(currentValidators[1]);

        const initialGovernancePotBalance = await getCurrentGovernancePotValue();
        let _epochPercentage = 120n;
        await finishEpochPrelim(stakingHbbft, blockRewardHbbft, _epochPercentage);

        const currentGovernancePotBalance = await getCurrentGovernancePotValue();
        const governancePotIncrease = currentGovernancePotBalance - initialGovernancePotBalance;

        let deltaPotValue = await blockRewardHbbft.deltaPot();
        let reinsertPotValue = await blockRewardHbbft.reinsertPot();

        const deltaPotShare = deltaPotValue * BigInt(currentValidators.length) / 6000n / maxValidators;
        const reinsertPotShare = reinsertPotValue * BigInt(currentValidators.length) / 6000n / maxValidators;
        const nativeRewardUndistributed = await blockRewardHbbft.nativeRewardUndistributed();

        const totalReward = deltaPotShare + reinsertPotShare + nativeRewardUndistributed;
        const expectedDAOShare = totalReward / 10n;

        // we expect 1 wei difference, since the reward combination from 2 pots results in that.
        //expectedDAOShare.sub(governancePotIncrease).should.to.be.bignumber.lte(BigNumber.from('1'));
        expect(governancePotIncrease).to.be.closeTo(expectedDAOShare, expectedDAOShare / 10000n);

        //since there are a lot of delegators, we need to calc it on a basis that pays out the validator min reward.
        const minValidatorSharePercent = await blockRewardHbbft.VALIDATOR_MIN_REWARD_PERCENT();
        const expectedValidatorReward = (totalReward - expectedDAOShare) / BigInt(currentValidators.length) * minValidatorSharePercent / 100n;

        const stakeAfterReward = await getValidatorStake(currentValidators[1]);
        const actualValidatorReward = stakeAfterReward - stakeBeforeReward;

        expect(actualValidatorReward).to.be.closeTo(expectedValidatorReward, expectedValidatorReward / 10000n);
    });

    it("should end epoch earlier if notified", async () => {
        const connectivityTracker = await impersonateAcc(await blockRewardHbbft.connectivityTracker());

        expect(await blockRewardHbbft.earlyEpochEnd()).to.be.false;
        expect(await blockRewardHbbft.connect(connectivityTracker).notifyEarlyEpochEnd()).to.not.be.reverted;
        expect(await blockRewardHbbft.earlyEpochEnd()).to.be.true;

        await helpers.stopImpersonatingAccount(connectivityTracker.address);

        const systemSigner = await impersonateAcc(SystemAccountAddress);

        expect(await blockRewardHbbft.connect(systemSigner).reward(false)).to.emit(
            blockRewardHbbft,
            "CoinsRewarded"
        );

        await helpers.stopImpersonatingAccount(SystemAccountAddress);
    });

    it("should not end epoch earlier if not notified", async () => {
        expect(await blockRewardHbbft.earlyEpochEnd()).to.be.false;

        const systemSigner = await impersonateAcc(SystemAccountAddress);

        expect(await blockRewardHbbft.connect(systemSigner).reward(false)).to.not.emit(
            blockRewardHbbft,
            "CoinsRewarded"
        );

        await helpers.stopImpersonatingAccount(SystemAccountAddress);
    });

    it("should restrict calling notifyEarlyEpochEnd to connectivity tracker contract only", async () => {
        const caller = accounts[11];

        await expect(blockRewardHbbft.connect(caller).notifyEarlyEpochEnd())
            .to.be.revertedWithCustomError(blockRewardHbbft, "Unauthorized");
    });

    it("upscaling: add multiple validator pools and upscale if needed.", async () => {
        const accountAddresses = accounts.map(item => item.address);
        const additionalValidators = accountAddresses.slice(7, 52 + 1); // accounts[7...32]
        const additionalStakingAddresses = accountAddresses.slice(53, 99 + 1); // accounts[33...59]

        expect(additionalValidators).to.be.lengthOf(46);
        expect(additionalStakingAddresses).to.be.lengthOf(46);

        await network.provider.send("evm_setIntervalMining", [8]);

        for (let i = 0; i < additionalValidators.length; i++) {
            let stakingAddress = await ethers.getSigner(additionalStakingAddresses[i]);
            let miningAddress = await ethers.getSigner(additionalValidators[i]);

            await stakingHbbft.connect(stakingAddress).addPool(
                miningAddress.address,
                ethers.zeroPadBytes("0x00", 64),
                ethers.zeroPadBytes("0x00", 16),
                { value: MIN_STAKE }
            );
            await announceAvailability(miningAddress.address);
            await mine();

            let toBeElected = (await stakingHbbft.getPoolsToBeElected()).length;
            let pendingValidators = (await validatorSetHbbft.getPendingValidators()).length
            if (toBeElected > 4 && toBeElected <= 19 && pendingValidators == 0) {
                expect(await validatorSetHbbft.getValidatorCountSweetSpot((await stakingHbbft.getPoolsToBeElected()).length))
                    .to.be.equal((await validatorSetHbbft.getValidators()).length);
            }
        }

        await timeTravelToTransition(stakingHbbft, blockRewardHbbft);
        await timeTravelToEndEpoch(stakingHbbft, blockRewardHbbft);

        // after epoch was finalized successfully, validator set length is healthy
        expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(25);
        expect(await stakingHbbft.getPoolsToBeElected()).to.be.lengthOf(49);
    })

    it("upscaling: removing validators up to 16", async () => {

        while ((await validatorSetHbbft.getValidators()).length > 16) {
            await mine();
            const validators = await validatorSetHbbft.getValidators();

            const systemSigner = await impersonateAcc(SystemAccountAddress);
            await validatorSetHbbft.connect(systemSigner).kickValidator(validators[13]);
            await helpers.stopImpersonatingAccount(systemSigner.address);
        }

        expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(16);
    });

    it("upscaling: mining twice shouldn't change pending validator set", async () => {
        await callReward(blockRewardHbbft, false);
        expect(await validatorSetHbbft.getPendingValidators()).to.be.lengthOf(25);
        let pendingValidators = await validatorSetHbbft.getPendingValidators();

        await callReward(blockRewardHbbft, false);

        expect(
            _.isEqual(_.sortBy(pendingValidators), _.sortBy(await validatorSetHbbft.getPendingValidators()))
        ).to.be.true;
    });

    it("upscaling: set is scaled to 25", async () => {
        await mine();

        expect(await validatorSetHbbft.getValidators()).to.be.lengthOf(25);
        expect(await validatorSetHbbft.getPendingValidators()).to.be.empty;

        await network.provider.send("evm_setIntervalMining", [0]);
    });
});
