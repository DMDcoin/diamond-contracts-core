import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import { BonusScoreSystem, StakingHbbft } from "../src/types";

// one epoch in 12 hours.
const STAKING_FIXED_EPOCH_DURATION = 43200n;

// the transition time window is 30 minutes.
const STAKING_TRANSITION_WINDOW_LENGTH = 1800n;

enum ScoringFactor {
    StandByBonus,
    NoStandByPenalty,
    NoKeyWritePenalty,
    BadPerformancePenalty
}

describe("BonusScoreSystem", function () {
    let users: HardhatEthersSigner[];
    let owner: HardhatEthersSigner;
    let initialValidators: string[];
    let initialStakingAddresses: string[];
    let initialValidatorsPubKeys;
    let initialValidatorsIpAddresses;

    let randomWallet = () => ethers.Wallet.createRandom().address;

    before(async function () {
        users = await ethers.getSigners();
        owner = users[0];
    });

    async function deployContracts() {
        const stubAddress = users[5].address;

        initialValidators = users.slice(10, 12 + 1).map(x => x.address); // accounts[10...12]
        initialStakingAddresses = users.slice(13, 15 + 1).map(x => x.address); // accounts[10...12]

        initialValidatorsPubKeys = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            ([
                '0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
                '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
                '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56'
            ]);

        // The IP addresses are irrelevant for these unit test, just initialize them to 0.
        initialValidatorsIpAddresses = Array(initialValidators.length).fill(ethers.zeroPadBytes("0x00", 16));

        let structure = {
            _validatorSetContract: stubAddress,
            _bonusScoreContract: stubAddress,
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: ethers.parseEther('100'),
            _candidateMinStake: ethers.parseEther('1'),
            _maxStake: ethers.parseEther('100000'),
            _stakingFixedEpochDuration: STAKING_FIXED_EPOCH_DURATION,
            _stakingTransitionTimeframeLength: STAKING_TRANSITION_WINDOW_LENGTH,
            _stakingWithdrawDisallowPeriod: 2n
        };

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingHbbft = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                structure, // initializer structure
                initialValidatorsPubKeys, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as StakingHbbft;

        await stakingHbbft.waitForDeployment();

        const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");

        const bonusScoreSystem = await upgrades.deployProxy(
            bonusScoreSystemFactory,
            [
                owner.address,
                randomWallet(),                  // _validatorSetHbbft
                randomWallet(),                  // _connectivityTracker
                await stakingHbbft.getAddress(), // _stakingContract
            ],
            { initializer: 'initialize' }
        ) as unknown as BonusScoreSystem;

        await bonusScoreSystem.waitForDeployment();

        await stakingHbbft.setBonusScoreContract(await bonusScoreSystem.getAddress());

        return { bonusScoreSystem, stakingHbbft };
    }

    describe('Initializer', async () => {
        let InitializeCases = [
            [ethers.ZeroAddress, randomWallet(), randomWallet(), randomWallet()],
            [randomWallet(), ethers.ZeroAddress, randomWallet(), randomWallet()],
            [randomWallet(), randomWallet(), ethers.ZeroAddress, randomWallet()],
            [randomWallet(), randomWallet(), randomWallet(), ethers.ZeroAddress],
        ];

        let InitialScoringFactors = [
            { factor: ScoringFactor.StandByBonus, initValue: 15 },
            { factor: ScoringFactor.NoStandByPenalty, initValue: 15 },
            { factor: ScoringFactor.NoKeyWritePenalty, initValue: 100 },
            { factor: ScoringFactor.BadPerformancePenalty, initValue: 100 },
        ]

        InitializeCases.forEach((args, index) => {
            it(`should revert initialization with zero address argument, test #${index + 1}`, async function () {
                const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");

                await expect(upgrades.deployProxy(
                    bonusScoreSystemFactory,
                    args,
                    { initializer: 'initialize' }
                )).to.be.revertedWithCustomError(bonusScoreSystemFactory, "ZeroAddress");
            });
        });

        it("should not allow re-initialization", async () => {
            const args = [randomWallet(), randomWallet(), randomWallet(), randomWallet()];

            const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");
            const bonusScoreSystem = await upgrades.deployProxy(
                bonusScoreSystemFactory,
                args,
                { initializer: 'initialize' }
            );

            await bonusScoreSystem.waitForDeployment();

            await expect(
                bonusScoreSystem.initialize(...args)
            ).to.be.revertedWithCustomError(bonusScoreSystem, "InvalidInitialization");
        });

        InitialScoringFactors.forEach((args) => {
            it(`should set initial scoring factor ${ScoringFactor[args.factor]}`, async () => {
                const bonusScoreSystemFactory = await ethers.getContractFactory("BonusScoreSystem");
                const bonusScoreSystem = await upgrades.deployProxy(
                    bonusScoreSystemFactory,
                    [randomWallet(), randomWallet(), randomWallet(), randomWallet()],
                    { initializer: 'initialize' }
                );

                await bonusScoreSystem.waitForDeployment();

                expect(await bonusScoreSystem.getScoringFactorValue(args.factor)).to.equal(args.initValue);
            });
        });
    });

    describe('updateScoringFactor', async () => {
        const TestCases = [
            { factor: ScoringFactor.StandByBonus, value: 20 },
            { factor: ScoringFactor.NoStandByPenalty, value: 50 },
            { factor: ScoringFactor.NoKeyWritePenalty, value: 200 },
            { factor: ScoringFactor.BadPerformancePenalty, value: 199 },
        ];

        it('should restrict calling to contract owner', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[2];

            await expect(bonusScoreSystem.connect(caller).updateScoringFactor(ScoringFactor.StandByBonus, 1))
                .to.be.revertedWithCustomError(bonusScoreSystem, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        TestCases.forEach((args) => {
            it(`should set scoring factor ${ScoringFactor[args.factor]} and emit event`, async function () {
                const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

                await expect(
                    bonusScoreSystem.updateScoringFactor(args.factor, args.value)
                ).to.emit(bonusScoreSystem, "UpdateScoringFactor")
                    .withArgs(args.factor, args.value);

                expect(await bonusScoreSystem.getScoringFactorValue(args.factor)).to.equal(args.value);
            });
        });
    });

    describe('setStakingContract', async () => {
        it('should restrict calling to contract owner', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[2];

            await expect(bonusScoreSystem.connect(caller).setStakingContract(randomWallet()))
                .to.be.revertedWithCustomError(bonusScoreSystem, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should not set zero contract address', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(
                bonusScoreSystem.setStakingContract(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(bonusScoreSystem, "ZeroAddress");
        });

        it('should set Staking contract address and emit event', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const _staking = randomWallet();

            await expect(
                bonusScoreSystem.setStakingContract(_staking)
            ).to.emit(bonusScoreSystem, "SetStakingContract").withArgs(_staking);

            expect(await bonusScoreSystem.stakingHbbft()).to.equal(_staking);
        });
    });

    describe('setValidatorSetContract', async () => {
        it('should restrict calling to contract owner', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[2];

            await expect(bonusScoreSystem.connect(caller).setValidatorSetContract(randomWallet()))
                .to.be.revertedWithCustomError(bonusScoreSystem, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should not set zero contract address', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(
                bonusScoreSystem.setValidatorSetContract(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(bonusScoreSystem, "ZeroAddress");
        });

        it('should set ValidatorSet contract address and emit event', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const _validatorSet = randomWallet();

            await expect(
                bonusScoreSystem.setValidatorSetContract(_validatorSet)
            ).to.emit(bonusScoreSystem, "SetValidatorSetContract").withArgs(_validatorSet);

            expect(await bonusScoreSystem.validatorSetHbbft()).to.equal(_validatorSet);
        });
    });

    describe('setConnectivityTrackerContract', async () => {
        it('should restrict calling to contract owner', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[2];

            await expect(bonusScoreSystem.connect(caller).setConnectivityTrackerContract(randomWallet()))
                .to.be.revertedWithCustomError(bonusScoreSystem, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should not set zero contract address', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            await expect(
                bonusScoreSystem.setConnectivityTrackerContract(ethers.ZeroAddress)
            ).to.be.revertedWithCustomError(bonusScoreSystem, "ZeroAddress");
        });

        it('should set ConnectivityTracker contract address and emit event', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const _connectivityTracker = randomWallet();

            await expect(
                bonusScoreSystem.setConnectivityTrackerContract(_connectivityTracker)
            ).to.emit(bonusScoreSystem, "SetConnectivityTrackerContract").withArgs(_connectivityTracker);

            expect(await bonusScoreSystem.connectivityTracker()).to.equal(_connectivityTracker);
        });
    });

    describe('getScoringFactorValue', async () => {
        it('should revert for unknown scoring factor', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);

            const unknownFactor = ScoringFactor.BadPerformancePenalty + 1;

            await expect(
                bonusScoreSystem.getScoringFactorValue(unknownFactor)
            ).to.be.reverted;
        });

        it('should get scoring factor value', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const _connectivityTracker = randomWallet();

            expect(await bonusScoreSystem.getScoringFactorValue(ScoringFactor.BadPerformancePenalty))
                .to.equal(await bonusScoreSystem.DEFAULT_BAD_PERF_FACTOR());
        });
    });

    describe('rewardStandBy', async () => {
        it('should restrict calling to ValidatorSet contract', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[2];

            await expect(bonusScoreSystem.connect(caller).rewardStandBy(randomWallet(), 100))
                .to.be.revertedWithCustomError(bonusScoreSystem, "Unauthorized");
        });
    });

    describe('penaliseNoStandBy', async () => {
        it('should restrict calling to ValidatorSet contract', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[3];

            await expect(bonusScoreSystem.connect(caller).penaliseNoStandBy(randomWallet(), 100))
                .to.be.revertedWithCustomError(bonusScoreSystem, "Unauthorized");
        });
    });

    describe('penaliseNoKeyWrite', async () => {
        it('should restrict calling to ValidatorSet contract', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[4];

            await expect(bonusScoreSystem.connect(caller).penaliseNoKeyWrite(randomWallet()))
                .to.be.revertedWithCustomError(bonusScoreSystem, "Unauthorized");
        });
    });

    describe('penaliseBadPerformance', async () => {
        it('should restrict calling to ConnectivityTracker contract', async function () {
            const { bonusScoreSystem } = await helpers.loadFixture(deployContracts);
            const caller = users[5];

            await expect(bonusScoreSystem.connect(caller).penaliseBadPerformance(randomWallet(), 100))
                .to.be.revertedWithCustomError(bonusScoreSystem, "Unauthorized");
        });
    });
});
