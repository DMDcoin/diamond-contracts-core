import { ethers, upgrades } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import {
    BlockRewardHbbftMock,
    CertifierHbbft,
    ConnectivityTrackerHbbft,
    KeyGenHistory,
    RandomHbbft,
    StakingHbbftMock,
    TxPermissionHbbftMock,
    ValidatorSetHbbftMock,
} from "../src/types";

import { getNValidatorsPartNAcks } from "./testhelpers/data";
import { deployDao } from "./testhelpers/daoDeployment";
import { Validator } from "./testhelpers/types";
import { expect } from "chai";

const stakingTransitionWindowLength = 3600n;
const stakeWithdrawDisallowPeriod = 2n; // one less than EPOCH DURATION, therefore it meets the conditions.
const stakingFixedEpochDuration = 86400n;
const validatorInactivityThreshold = 365 * 86400 // 1 year

const reportDisallowPeriod = 15 * 60;

const candidateMinStake = ethers.parseEther('1');
const delegatorMinStake = ethers.parseEther('100');

const SystemAccountAddress = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";

describe('Early Epoch End', async function () {
    let owner: HardhatEthersSigner;
    let stubAccount: HardhatEthersSigner;
    let accounts: HardhatEthersSigner[];

    let initialValidators: Array<Validator>;
    let pendingValidators: Array<Validator>;

    before(async () => {
        [owner, stubAccount, ...accounts] = await ethers.getSigners();

        initialValidators = new Array<Validator>();
        pendingValidators = new Array<Validator>();

        for (let i = 0; i < 3; ++i) {
            const validator = await Validator.create();
            initialValidators.push(validator);
        }

        for (let i = 0; i < 3; ++i) {
            const validator = await Validator.create();
            pendingValidators.push(validator);
        }
    });

    async function announceAvailability(validator: Validator, validatorSet: ValidatorSetHbbftMock) {
        const latestBlock = await ethers.provider.getBlock('latest');

        await validatorSet.connect(validator.mining).announceAvailability(
            latestBlock!.number,
            latestBlock!.hash!
        );
    };

    async function deployContractsFixture() {
        const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

        const initStakingAddresses = initialValidators.map(x => x.stakingAddress());
        const initMiningAddresses = initialValidators.map(x => x.miningAddress());
        const initIpAddresses = initialValidators.map(x => x.ipAddress);
        const initPublicKeys = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])(initialValidators.map(x => x.publicKey()));

        const bonusScoreContractMockFactory = await ethers.getContractFactory("BonusScoreSystemMock");
        const bonusScoreContractMock = await bonusScoreContractMockFactory.deploy();
        await bonusScoreContractMock.waitForDeployment();

        await deployDao();

        const validatorSetParams = {
            blockRewardContract: stubAccount.address,
            randomContract: stubAccount.address,
            stakingContract: stubAccount.address,
            keyGenHistoryContract: stubAccount.address,
            bonusScoreContract: await bonusScoreContractMock.getAddress(),
            connectivityTrackerContract: stubAccount.address,
            validatorInactivityThreshold: validatorInactivityThreshold,
        }

        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetContract = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                validatorSetParams,   // _params
                initMiningAddresses,  // _initialMiningAddresses
                initStakingAddresses, // _initialStakingAddresses
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
                initMiningAddresses,
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

        const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbftMock");
        const txPermissionContract = await upgrades.deployProxy(
            TxPermissionFactory,
            [
                [owner.address],
                await certifierContract.getAddress(),
                await validatorSetContract.getAddress(),
                await keyGenHistoryContract.getAddress(),
                stubAccount.address,
                owner.address
            ],
            { initializer: 'initialize' }
        ) as unknown as TxPermissionHbbftMock;

        await txPermissionContract.waitForDeployment();

        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        const blockRewardContract = await upgrades.deployProxy(
            BlockRewardHbbftFactory,
            [
                owner.address,
                await validatorSetContract.getAddress(),
                stubAccount.address,
            ],
            { initializer: 'initialize' }
        ) as unknown as BlockRewardHbbftMock;

        await blockRewardContract.waitForDeployment();

        let structure = {
            _validatorSetContract: await validatorSetContract.getAddress(),
            _bonusScoreContract: await bonusScoreContractMock.getAddress(),
            _initialStakingAddresses: initStakingAddresses,
            _delegatorMinStake: delegatorMinStake,
            _candidateMinStake: candidateMinStake,
            _maxStake: ethers.parseEther('100000'),
            _stakingFixedEpochDuration: stakingFixedEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionWindowLength,
            _stakingWithdrawDisallowPeriod: stakeWithdrawDisallowPeriod
        };

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingContract = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                structure,      // initializer structure
                initPublicKeys, // _publicKeys
                initIpAddresses // _internetAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as StakingHbbftMock;

        await stakingContract.waitForDeployment();

        const connectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
        const connectivityTracker = await upgrades.deployProxy(
            connectivityTrackerFactory,
            [
                owner.address,
                await validatorSetContract.getAddress(),
                await stakingContract.getAddress(),
                await blockRewardContract.getAddress(),
                await bonusScoreContractMock.getAddress(),
                reportDisallowPeriod,
            ],
            { initializer: 'initialize' }
        ) as unknown as ConnectivityTrackerHbbft;

        await connectivityTracker.waitForDeployment();

        await blockRewardContract.setConnectivityTracker(await connectivityTracker.getAddress());
        await txPermissionContract.setConnectivityTracker(await connectivityTracker.getAddress());
        await validatorSetContract.setConnectivityTracker(await connectivityTracker.getAddress());
        await validatorSetContract.setBlockRewardContract(await blockRewardContract.getAddress());
        await validatorSetContract.setRandomContract(await randomHbbftContract.getAddress());
        await validatorSetContract.setStakingContract(await stakingContract.getAddress());
        await validatorSetContract.setKeyGenHistoryContract(await keyGenHistoryContract.getAddress());

        for (const validator of initialValidators) {
            await stakingContract.connect(validator.staking).stake(
                validator.stakingAddress(),
                { value: candidateMinStake },
            );

            await announceAvailability(validator, validatorSetContract);
        }

        return { blockRewardContract, validatorSetContract, stakingContract, connectivityTracker, keyGenHistoryContract };
    }

    describe('Early epoch end cases', async function () {
        async function impersonateAcc(address: string) {
            await helpers.impersonateAccount(address);

            await owner.sendTransaction({
                to: address,
                value: ethers.parseEther('10'),
            });

            return await ethers.getSigner(address);
        }

        async function callReward(_blockReward: BlockRewardHbbftMock, isEpochEndBlock: boolean) {
            const systemSigner = await impersonateAcc(SystemAccountAddress);

            await _blockReward.connect(systemSigner).reward(isEpochEndBlock);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);
        }

        async function writePart(
            currentEpoch: bigint,
            validator: Validator,
            keyGenContract: KeyGenHistory,
        ) {
            const { parts } = getNValidatorsPartNAcks(1);
            const currentRound = await keyGenContract.currentKeyGenRound();

            await keyGenContract.connect(validator.mining).writePart(
                currentEpoch + 1n,
                currentRound,
                parts[0]
            );
        }

        async function writeAck(
            currentEpoch: bigint,
            validator: Validator,
            keyGenContract: KeyGenHistory,
        ) {
            const { acks } = getNValidatorsPartNAcks(1);
            const currentRound = await keyGenContract.currentKeyGenRound();

            await keyGenContract.connect(validator.mining).writeAcks(
                currentEpoch + 1n,
                currentRound,
                acks[0]
            );
        }

        it('should end epoch earlier and select new validators', async function () {
            const {
                validatorSetContract,
                blockRewardContract,
                stakingContract,
                connectivityTracker,
                keyGenHistoryContract,
            } = await helpers.loadFixture(deployContractsFixture);

            const additionalValidator = pendingValidators[0];

            // There are 3 initial validators, adding one more
            await stakingContract.connect(additionalValidator.staking).addPool(
                additionalValidator.miningAddress(),
                ethers.ZeroAddress,
                0n,
                additionalValidator.publicKey(),
                additionalValidator.ipAddress,
                { value: candidateMinStake }
            );

            await announceAvailability(additionalValidator, validatorSetContract);

            // Configure staking epoch
            const validatorSetSigner = await impersonateAcc(await validatorSetContract.getAddress());
            await stakingContract.connect(validatorSetSigner).incrementStakingEpoch()
            let latestBlock = await ethers.provider.getBlock("latest");
            await stakingContract.connect(validatorSetSigner).setStakingEpochStartTime(latestBlock!.timestamp);
            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            // Report one active validator after disallow period
            const validatorToReport = initialValidators.at(-1)!;
            await helpers.time.increase(await connectivityTracker.reportDisallowPeriod());

            for (const validator of initialValidators) {
                if (validator.miningAddress() != validatorToReport.miningAddress()) {
                    const latestBlock = await ethers.provider.getBlock("latest");

                    await connectivityTracker.connect(validator.mining).reportMissingConnectivity(
                        validatorToReport.miningAddress(),
                        latestBlock!.number,
                        latestBlock!.hash!,
                    );
                }
            }

            expect(
                await stakingContract.earlyEpochEndTriggerTime(),
                "early epoch end trigger time should not be set"
            ).to.eq(0n);
            expect(
                await stakingContract.earlyEpochEndTime(),
                "early epoch end time should not be set"
            ).to.eq(0n);

            let currentEpoch = await stakingContract.stakingEpoch();
            expect(await connectivityTracker.isEarlyEpochEnd(currentEpoch)).to.be.true;
            expect(await blockRewardContract.earlyEpochEnd()).to.be.true;
            expect(await validatorSetContract.getPendingValidators()).length.eq(0n);

            // Emulate block generation
            await callReward(blockRewardContract, false);

            // BlockReward contract should write EarlyEpochEnd trigger time, reset own flag
            // and initiate key generation
            latestBlock = await ethers.provider.getBlock("latest");
            expect(await blockRewardContract.earlyEpochEnd()).to.be.false;
            expect(await stakingContract.earlyEpochEndTriggerTime()).to.eq(latestBlock?.timestamp);

            const selectedPendingValidators = await validatorSetContract.getPendingValidators();
            expect(selectedPendingValidators).length.not.eq(0n);

            const expectedEarlyEpochEndTime = BigInt(latestBlock!.timestamp)
                + stakingTransitionWindowLength
                + await stakingContract.currentKeyGenExtraTimeWindow();

            expect(await stakingContract.earlyEpochEndTime()).to.eq(expectedEarlyEpochEndTime);

            // Write pending validators parts and acks
            for (const validator of [...initialValidators, ...pendingValidators]) {
                if (!selectedPendingValidators.includes(validator.miningAddress())) {
                    continue;
                }

                await writePart(currentEpoch, validator, keyGenHistoryContract);
            }

            for (const validator of [...initialValidators, ...pendingValidators]) {
                if (!selectedPendingValidators.includes(validator.miningAddress())) {
                    continue;
                }

                await writeAck(currentEpoch, validator, keyGenHistoryContract);
            }

            // Emulate block generation
            await callReward(blockRewardContract, true);

            expect(await validatorSetContract.getValidators()).to.deep.eq(selectedPendingValidators);
            expect(await stakingContract.stakingEpoch()).to.eq(currentEpoch + 1n);
            expect(await stakingContract.earlyEpochEndTriggerTime()).to.eq(0n);
            expect(await stakingContract.earlyEpochEndTime()).to.eq(0n);
        });

        it('should handle failed key generation during early epoch end', async function () {
            const {
                validatorSetContract,
                blockRewardContract,
                stakingContract,
                connectivityTracker,
                keyGenHistoryContract,
            } = await helpers.loadFixture(deployContractsFixture);

            const additionalValidator = pendingValidators[0];

            // There are 3 initial validators, adding one more
            await stakingContract.connect(additionalValidator.staking).addPool(
                additionalValidator.miningAddress(),
                ethers.ZeroAddress,
                0n,
                additionalValidator.publicKey(),
                additionalValidator.ipAddress,
                { value: candidateMinStake }
            );

            await announceAvailability(additionalValidator, validatorSetContract);

            // Configure staking epoch
            const validatorSetSigner = await impersonateAcc(await validatorSetContract.getAddress());
            await stakingContract.connect(validatorSetSigner).incrementStakingEpoch()
            let latestBlock = await ethers.provider.getBlock("latest");
            await stakingContract.connect(validatorSetSigner).setStakingEpochStartTime(latestBlock!.timestamp);
            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            // Report one active validator after disallow period
            const validatorToReport = initialValidators.at(-1)!;
            await helpers.time.increase(await connectivityTracker.reportDisallowPeriod());

            for (const validator of initialValidators) {
                if (validator.miningAddress() != validatorToReport.miningAddress()) {
                    const latestBlock = await ethers.provider.getBlock("latest");

                    await connectivityTracker.connect(validator.mining).reportMissingConnectivity(
                        validatorToReport.miningAddress(),
                        latestBlock!.number,
                        latestBlock!.hash!,
                    );
                }
            }

            expect(
                await stakingContract.earlyEpochEndTriggerTime(),
                "early epoch end trigger time should not be set"
            ).to.eq(0n);
            expect(
                await stakingContract.earlyEpochEndTime(),
                "early epoch end time should not be set"
            ).to.eq(0n);

            let currentEpoch = await stakingContract.stakingEpoch();
            expect(await connectivityTracker.isEarlyEpochEnd(currentEpoch)).to.be.true;
            expect(await blockRewardContract.earlyEpochEnd()).to.be.true;
            expect(await validatorSetContract.getPendingValidators()).length.eq(0n);

            // Emulate block generation
            await callReward(blockRewardContract, false);

            // BlockReward contract should write EarlyEpochEnd trigger time, reset own flag
            // and initiate key generation
            latestBlock = await ethers.provider.getBlock("latest");
            expect(await blockRewardContract.earlyEpochEnd()).to.be.false;
            expect(await stakingContract.earlyEpochEndTriggerTime()).to.eq(latestBlock?.timestamp);

            let expectedEarlyEpochEndTime = BigInt(latestBlock!.timestamp)
                + stakingTransitionWindowLength
                + await stakingContract.currentKeyGenExtraTimeWindow();

            expect(await stakingContract.earlyEpochEndTime()).to.eq(expectedEarlyEpochEndTime);

            const selectedPendingValidators = await validatorSetContract.getPendingValidators();
            expect(selectedPendingValidators).length.not.eq(0n);

            const validatorsToWriteParts = selectedPendingValidators.slice(0, 2)

            // Emulate failed key generation, 2 of 3 pending validators writtern their parts
            for (const validator of [...initialValidators, ...pendingValidators]) {
                if (!validatorsToWriteParts.includes(validator.miningAddress())) {
                    continue;
                }

                await writePart(currentEpoch, validator, keyGenHistoryContract);
            }

            const keyGenRoundPreviousValue = await keyGenHistoryContract.getCurrentKeyGenRound();

            const earlyEpochEndTime = await stakingContract.earlyEpochEndTime();
            await helpers.time.increaseTo(earlyEpochEndTime + 1n);
            await callReward(blockRewardContract, false);

            expectedEarlyEpochEndTime += stakingTransitionWindowLength;
            expect(await keyGenHistoryContract.getCurrentKeyGenRound()).to.eq(keyGenRoundPreviousValue + 1n);
            expect(
                await stakingContract.earlyEpochEndTime(),
                "keygen extra time windown should have increased"
            ).to.eq(expectedEarlyEpochEndTime);

            // Emulate block generation
            await callReward(blockRewardContract, true);

            expect(await validatorSetContract.getValidators()).to.deep.eq(validatorsToWriteParts);
            expect(await stakingContract.stakingEpoch()).to.eq(currentEpoch + 1n);
            expect(await stakingContract.earlyEpochEndTriggerTime()).to.eq(0n);
            expect(await stakingContract.earlyEpochEndTime()).to.eq(0n);
            expect(await keyGenHistoryContract.currentKeyGenRound()).to.eq(1n);
        });

        it('should handle failed key generation during upscaling', async function () {
            const {
                validatorSetContract,
                blockRewardContract,
                stakingContract,
                connectivityTracker,
                keyGenHistoryContract,
            } = await helpers.loadFixture(deployContractsFixture);

            // Configure staking epoch
            const validatorSetSigner = await impersonateAcc(await validatorSetContract.getAddress());
            await stakingContract.connect(validatorSetSigner).incrementStakingEpoch()
            let latestBlock = await ethers.provider.getBlock("latest");
            await stakingContract.connect(validatorSetSigner).setStakingEpochStartTime(latestBlock!.timestamp);
            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            // There are 3 initial validators, adding 3 more to trigger upscaling
            for (const validator of pendingValidators) {
                await stakingContract.connect(validator.staking).addPool(
                    validator.miningAddress(),
                    ethers.ZeroAddress,
                    0n,
                    validator.publicKey(),
                    validator.ipAddress,
                    { value: candidateMinStake }
                );

                await announceAvailability(validator, validatorSetContract);
            }

            expect(
                await stakingContract.earlyEpochEndTriggerTime(),
                "early epoch end trigger time should not be set"
            ).to.eq(0n);
            expect(
                await stakingContract.earlyEpochEndTime(),
                "early epoch end time should not be set"
            ).to.eq(0n);

            let currentEpoch = await stakingContract.stakingEpoch();
            expect(await connectivityTracker.isEarlyEpochEnd(currentEpoch)).to.be.false;
            expect(await blockRewardContract.earlyEpochEnd()).to.be.false;
            expect(await validatorSetContract.getPendingValidators()).length.eq(0n);

            const poolsToBeElected = await stakingContract.getPoolsToBeElected();
            const currentValidatorsCount = await validatorSetContract.getCurrentValidatorsCount();
            expect(poolsToBeElected).to.be.lengthOf(pendingValidators.length + initialValidators.length);

            expect(
                await validatorSetContract.getValidatorCountSweetSpot(poolsToBeElected.length),
                "precondition not met: must trigger upscaling"
            ).to.be.gt(currentValidatorsCount);

            // Emulate block generation
            await callReward(blockRewardContract, false);

            // BlockReward contract should write EarlyEpochEnd trigger time, and initiate key generation
            latestBlock = await ethers.provider.getBlock("latest");
            expect(await validatorSetContract.getPendingValidators()).to.not.be.lengthOf(0n);            
            expect(await blockRewardContract.earlyEpochEnd()).to.be.false;
            expect(await stakingContract.earlyEpochEndTriggerTime()).to.eq(latestBlock?.timestamp);

            let expectedEarlyEpochEndTime = BigInt(latestBlock!.timestamp)
                + stakingTransitionWindowLength
                + await stakingContract.currentKeyGenExtraTimeWindow();

            expect(await stakingContract.earlyEpochEndTime()).to.eq(expectedEarlyEpochEndTime);

            const expectedPendingValidators = await validatorSetContract.getValidatorCountSweetSpot(poolsToBeElected.length);
            const currentPendingValidators = await validatorSetContract.getPendingValidators();
            expect(currentPendingValidators).to.be.lengthOf(expectedPendingValidators);

            const missedValidators = currentPendingValidators.slice(0, 2);
            const validatorsToWriteParts = currentPendingValidators.slice(2);

            // Emulate failed key generation, 3 of pending validators did not write his part
            for (const validator of [...initialValidators, ...pendingValidators]) {
                if (!validatorsToWriteParts.includes(validator.miningAddress())) {
                    continue;
                }

                await writePart(currentEpoch, validator, keyGenHistoryContract);
            }

            const keyGenRoundPreviousValue = await keyGenHistoryContract.getCurrentKeyGenRound();

            const earlyEpochEndTime = await stakingContract.earlyEpochEndTime();
            await helpers.time.increaseTo(earlyEpochEndTime + 1n);
            await callReward(blockRewardContract, false);

            expectedEarlyEpochEndTime += stakingTransitionWindowLength;
            expect(await keyGenHistoryContract.getCurrentKeyGenRound()).to.eq(keyGenRoundPreviousValue + 1n);
            expect(
                await stakingContract.earlyEpochEndTime(),
                "keygen extra time windown should have increased"
            ).to.eq(expectedEarlyEpochEndTime);

            // Emulate block generation
            await callReward(blockRewardContract, true);

            expect(await validatorSetContract.getValidators()).to.include.members(validatorsToWriteParts);
            expect(await validatorSetContract.getValidators()).to.not.include.members(missedValidators);
            expect(await stakingContract.stakingEpoch()).to.eq(currentEpoch + 1n);
            expect(await stakingContract.earlyEpochEndTriggerTime()).to.eq(0n);
            expect(await stakingContract.earlyEpochEndTime()).to.eq(0n);
            expect(await keyGenHistoryContract.currentKeyGenRound()).to.eq(1n);
        });
    });
});
