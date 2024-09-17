import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import {
    ConnectivityTrackerHbbft,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    BlockRewardHbbftMock,
    KeyGenHistory,
} from "../src/types";

import { getNValidatorsPartNAcks } from "./testhelpers/data";

describe('ConnectivityTrackerHbbft', () => {
    const validatorInactivityThreshold = 86400; // 1 day
    const minReportAgeBlocks = 10;

    let accounts: HardhatEthersSigner[];
    let owner: HardhatEthersSigner;
    let addresses: string[];
    let initialValidators: HardhatEthersSigner[];
    let initialStakingAccounts: HardhatEthersSigner[];

    let nonValidators: HardhatEthersSigner[];

    before(async () => {
        accounts = await ethers.getSigners();
        addresses = accounts.map(x => x.address);
        owner = accounts[0];

        initialValidators = accounts.slice(1, 26); // accounts[1...25]
        initialStakingAccounts = accounts.slice(26, 51); // accounts[26...50]
        nonValidators = accounts.slice(51);
    });

    async function deployContracts() {
        const stubAddress = addresses[1];

        const validatorAddresses = initialValidators.map(x => x.address);
        const stakingAddresses = initialStakingAccounts.map(x => x.address);

        const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

        const bonusScoreContractMockFactory = await ethers.getContractFactory("BonusScoreSystemMock");
        const bonusScoreContractMock = await bonusScoreContractMockFactory.deploy();
        await bonusScoreContractMock.waitForDeployment();

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: await bonusScoreContractMock.getAddress(),
            connectivityTrackerContract: stubAddress,
            validatorInactivityThreshold: validatorInactivityThreshold,
        };

        const validatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbft = await upgrades.deployProxy(
            validatorSetFactory,
            [
                owner.address,
                validatorSetParams,           // _params
                validatorAddresses,           // _initialMiningAddresses
                stakingAddresses,             // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as ValidatorSetHbbftMock;

        await validatorSetHbbft.waitForDeployment();

        const keyGenFactoryFactory = await ethers.getContractFactory("KeyGenHistory");
        const keyGenHistory = await upgrades.deployProxy(
            keyGenFactoryFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(),
                validatorAddresses,
                parts,
                acks
            ],
            { initializer: 'initialize' }
        ) as unknown as KeyGenHistory;

        let stakingParams = {
            _validatorSetContract: await validatorSetHbbft.getAddress(),
            _bonusScoreContract: await bonusScoreContractMock.getAddress(),
            _initialStakingAddresses: stakingAddresses,
            _delegatorMinStake: ethers.parseEther('1'),
            _candidateMinStake: ethers.parseEther('10'),
            _maxStake: ethers.parseEther('100'),
            _stakingFixedEpochDuration: 86400n,
            _stakingTransitionTimeframeLength: 3600n,
            _stakingWithdrawDisallowPeriod: 1n
        };

        let initialValidatorsPubKeys: string[] = [];
        let initialValidatorsIpAddresses: string[] = [];

        for (let i = 0; i < stakingAddresses.length; i++) {
            initialValidatorsPubKeys.push(ethers.Wallet.createRandom().signingKey.publicKey);
            initialValidatorsIpAddresses.push(ethers.zeroPadBytes("0x00", 16));
        }

        let initialValidatorsPubKeysSplit = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            (initialValidatorsPubKeys);

        const stakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingHbbft = await upgrades.deployProxy(
            stakingHbbftFactory,
            [
                owner.address,
                stakingParams,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses   // _internetAddresses

            ],
            { initializer: 'initialize' }
        ) as unknown as StakingHbbftMock;

        await stakingHbbft.waitForDeployment();

        const blockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        const blockRewardHbbft = await upgrades.deployProxy(
            blockRewardHbbftFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(),
                stubAddress
            ],
            { initializer: 'initialize' }
        ) as unknown as BlockRewardHbbftMock;

        await blockRewardHbbft.waitForDeployment();

        const connectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
        const connectivityTracker = await upgrades.deployProxy(
            connectivityTrackerFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(),
                await stakingHbbft.getAddress(),
                await blockRewardHbbft.getAddress(),
                await bonusScoreContractMock.getAddress(),
                minReportAgeBlocks,
            ],
            { initializer: 'initialize' }
        ) as unknown as ConnectivityTrackerHbbft;

        await connectivityTracker.waitForDeployment();

        await blockRewardHbbft.setConnectivityTracker(await connectivityTracker.getAddress());
        await validatorSetHbbft.setStakingContract(await stakingHbbft.getAddress());
        await validatorSetHbbft.setBlockRewardContract(await blockRewardHbbft.getAddress());
        await validatorSetHbbft.setKeyGenHistoryContract(await keyGenHistory.getAddress());
        await validatorSetHbbft.setConnectivityTracker(await connectivityTracker.getAddress());

        return { connectivityTracker, validatorSetHbbft, stakingHbbft, blockRewardHbbft, bonusScoreContractMock };
    }

    async function impersonateAcc(accAddress: string) {
        await helpers.impersonateAccount(accAddress);

        await owner.sendTransaction({
            to: accAddress,
            value: ethers.parseEther('10'),
        });

        return await ethers.getSigner(accAddress);
    }

    async function setStakingEpochStartTime(caller: string, stakingHbbft: StakingHbbftMock) {
        const signer = await impersonateAcc(caller);

        const latest = await helpers.time.latest();
        expect(await stakingHbbft.connect(signer).setStakingEpochStartTime(latest));

        await helpers.stopImpersonatingAccount(caller);
    }

    describe('Initializer', async () => {
        it("should revert if owner = address(0)", async () => {
            const stubAddress = addresses[1];

            const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
            await expect(upgrades.deployProxy(
                ConnectivityTrackerFactory,
                [
                    ethers.ZeroAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ConnectivityTrackerFactory, "ZeroAddress");
        });

        it("should revert if validator set contract = address(0)", async () => {
            const stubAddress = addresses[1];

            const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
            await expect(upgrades.deployProxy(
                ConnectivityTrackerFactory,
                [
                    owner.address,
                    ethers.ZeroAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ConnectivityTrackerFactory, "ZeroAddress");
        });

        it("should revert if staking contract = address(0)", async () => {
            const stubAddress = addresses[1];

            const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
            await expect(upgrades.deployProxy(
                ConnectivityTrackerFactory,
                [
                    owner.address,
                    stubAddress,
                    ethers.ZeroAddress,
                    stubAddress,
                    stubAddress,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ConnectivityTrackerFactory, "ZeroAddress");
        });

        it("should revert if block reward contract = address(0)", async () => {
            const stubAddress = addresses[1];

            const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
            await expect(upgrades.deployProxy(
                ConnectivityTrackerFactory,
                [
                    owner.address,
                    stubAddress,
                    stubAddress,
                    ethers.ZeroAddress,
                    stubAddress,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ConnectivityTrackerFactory, "ZeroAddress");
        });

        it("should revert if block bonus score contract = address(0)", async () => {
            const stubAddress = addresses[1];

            const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
            await expect(upgrades.deployProxy(
                ConnectivityTrackerFactory,
                [
                    owner.address,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    ethers.ZeroAddress,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ConnectivityTrackerFactory, "ZeroAddress");
        });

        it("should revert double initialization", async () => {
            const stubAddress = addresses[1];

            const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
            const contract = await upgrades.deployProxy(
                ConnectivityTrackerFactory,
                [
                    owner.address,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            );

            expect(await contract.waitForDeployment());

            await expect(contract.initialize(
                owner.address,
                stubAddress,
                stubAddress,
                stubAddress,
                stubAddress,
                minReportAgeBlocks
            )).to.be.revertedWithCustomError(contract, "InvalidInitialization");
        });
    });

    describe('setMinReportArge', async () => {
        it("should revert calling function by unauthorized account", async function () {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const caller = accounts[4];

            await expect(
                connectivityTracker.connect(caller).setMinReportAge(100)
            ).to.be.revertedWithCustomError(connectivityTracker, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it("should set min report age and emit event", async function () {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const newValue = 100;

            await expect(
                connectivityTracker.connect(owner).setMinReportAge(newValue)
            ).to.emit(connectivityTracker, "SetMinReportAgeBlocks")
                .withArgs(newValue);

            expect(await connectivityTracker.minReportAgeBlocks()).to.equal(newValue);
        });
    });

    describe('setEarlyEpochEndToleranceLevel', async () => {
        it("should revert calling function by unauthorized account", async function () {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const caller = accounts[4];

            await expect(
                connectivityTracker.connect(caller).setEarlyEpochEndToleranceLevel(5)
            ).to.be.revertedWithCustomError(connectivityTracker, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it("should set early epoch end tolerance level and emit event", async function () {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const newValue = 5;

            await expect(
                connectivityTracker.connect(owner).setEarlyEpochEndToleranceLevel(newValue)
            ).to.emit(connectivityTracker, "SetEarlyEpochEndToleranceLevel")
                .withArgs(newValue);

            expect(await connectivityTracker.earlyEpochEndToleranceLevel()).to.equal(newValue);
        });
    });

    describe('reportMissingConnectivity', async () => {
        it("should restrict calling function only to validators", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");
            const caller = nonValidators[0];

            await expect(
                connectivityTracker.connect(caller).reportMissingConnectivity(
                    initialValidators[0].address,
                    latestBlock!.number,
                    latestBlock!.hash!
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "OnlyValidator");
        });

        it("should revert calling for future block", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                    initialValidators[1].address,
                    latestBlock!.number + 5,
                    latestBlock!.hash!
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "InvalidBlock");
        });

        it("should revert calling with invalid block hash", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                    initialValidators[1].address,
                    latestBlock!.number,
                    ethers.keccak256(ethers.toUtf8Bytes(latestBlock!.hash!))
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "InvalidBlock");
        });

        it("should revert too early report", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);

            await setStakingEpochStartTime(await validatorSetHbbft.getAddress(), stakingHbbft);
            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                    initialValidators[1].address,
                    latestBlock!.number,
                    latestBlock!.hash!
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "ReportTooEarly");
        });

        it("should revert duplicate report by same validator", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);
            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await setStakingEpochStartTime(await validatorSetHbbft.getAddress(), stakingHbbft);
            await helpers.mine(minReportAgeBlocks + 1);

            const latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.connect(reporter).reportMissingConnectivity(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            ));

            await expect(connectivityTracker.connect(reporter).reportMissingConnectivity(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            )).to.be.revertedWithCustomError(connectivityTracker, "AlreadyReported")
                .withArgs(reporter.address, validator.address);
        });

        it("should revert report by flagged validator", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);

            const reporter = initialValidators[0];
            const validator = initialValidators[1];
            const latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.connect(reporter).reportMissingConnectivity(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            ));

            await expect(connectivityTracker.connect(validator).reportMissingConnectivity(
                reporter.address,
                latestBlock!.number,
                latestBlock!.hash!
            )).to.be.revertedWithCustomError(connectivityTracker, "CannotReportByFlaggedValidator")
                .withArgs(validator.address);
        });

        it("should report missing connectivity and emit event", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);

            const reporter = initialValidators[0];
            const validator = initialValidators[1];
            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(reporter).reportMissingConnectivity(
                    validator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                )
            ).to.emit(connectivityTracker, "ReportMissingConnectivity")
                .withArgs(
                    reporter.address,
                    validator.address,
                    latestBlock!.number
                );
        });

        it("should report missing connectivity and flag validator", async () => {
            const { connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");

            const currentEpoch = await stakingHbbft.stakingEpoch();
            const validator = initialValidators[1];

            const previousScore = await connectivityTracker.getValidatorConnectivityScore(
                currentEpoch,
                validator.address
            );
            expect(await connectivityTracker.getFlaggedValidators()).to.not.include(validator.address);

            expect(await connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            ));

            expect(await connectivityTracker.getFlaggedValidators()).to.include(validator.address);
            expect(await connectivityTracker.getValidatorConnectivityScore(currentEpoch, validator.address))
                .to.equal(previousScore + 1n);
        });

        it("should increase validator connectivity score with each report", async () => {
            const { connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const epoch = await stakingHbbft.stakingEpoch();
            const initialScore = await connectivityTracker.getValidatorConnectivityScore(epoch, validator.address);
            const latestBlock = await ethers.provider.getBlock("latest");

            for (let i = 1; i < initialValidators.length; ++i) {
                expect(await connectivityTracker.connect(initialValidators[i]).reportMissingConnectivity(
                    validator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                ));

                expect(
                    await connectivityTracker.getValidatorConnectivityScore(epoch, validator.address)
                ).to.equal(initialScore + BigInt(i))
            }

            expect(await connectivityTracker.getValidatorConnectivityScore(epoch, validator.address))
                .to.equal(initialValidators.length - 1);
        });

        it("should set faulty validator as unavailable", async () => {
            const { connectivityTracker, stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const badValidator = initialValidators[0];
            const goodValidators = initialValidators.slice(1);

            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const announceBlock = await ethers.provider.getBlock("latest");
            await helpers.mine(1);

            await validatorSetHbbft.connect(badValidator).announceAvailability(
                announceBlock!.number,
                announceBlock!.hash!
            );

            const availableSinceTimestamp = await helpers.time.latest();

            expect(await validatorSetHbbft.validatorAvailableSince(badValidator.address)).to.equal(availableSinceTimestamp)
            await helpers.mine(5);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            const latestBlock = await ethers.provider.getBlock("latest");

            for (let j = 0; j < reportsThreshold; ++j) {
                await connectivityTracker.connect(goodValidators[j]).reportMissingConnectivity(
                    badValidator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                );
            }

            expect(await validatorSetHbbft.validatorAvailableSince(badValidator.address)).to.equal(0n);
        });

        it("should not mark validator faulty if it's already marked", async () => {
            const { connectivityTracker, stakingHbbft, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

            const badValidator = initialValidators[0];
            const goodValidators = initialValidators.slice(1);

            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const announceBlock = await ethers.provider.getBlock("latest");
            await helpers.mine(1);

            await validatorSetHbbft.connect(badValidator).announceAvailability(
                announceBlock!.number,
                announceBlock!.hash!
            );

            const availableSinceTimestamp = await helpers.time.latest();

            expect(await validatorSetHbbft.validatorAvailableSince(badValidator.address)).to.equal(availableSinceTimestamp)
            await helpers.mine(5);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            let latestBlock = await ethers.provider.getBlock("latest");

            for (let i = 0; i < reportsThreshold; ++i) {
                await connectivityTracker.connect(goodValidators[i]).reportMissingConnectivity(
                    badValidator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                );
            }

            const unavailableWriteTimestamp = await helpers.time.latest();

            expect(await validatorSetHbbft.validatorAvailableSince(badValidator.address)).to.equal(0n);
            expect(await validatorSetHbbft.validatorAvailableSinceLastWrite(badValidator.address)).to.equal(unavailableWriteTimestamp);

            await helpers.mine(10);

            latestBlock = await ethers.provider.getBlock("latest");
            let nextReporter = goodValidators[reportsThreshold];

            await expect(connectivityTracker.connect(nextReporter).reportMissingConnectivity(
                badValidator.address,
                latestBlock!.number,
                latestBlock!.hash!
            )).to.not.emit(validatorSetHbbft, "ValidatorUnavailable");

            expect(await validatorSetHbbft.validatorAvailableSince(badValidator.address)).to.equal(0n);
            expect(await validatorSetHbbft.validatorAvailableSinceLastWrite(badValidator.address)).to.equal(unavailableWriteTimestamp);
        });
    });

    describe('reportReconnect', async () => {
        it("should restrict calling function only to validators", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");
            const caller = nonValidators[0];

            await expect(
                connectivityTracker.connect(caller).reportReconnect(
                    initialValidators[0].address,
                    latestBlock!.number,
                    latestBlock!.hash!
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "OnlyValidator");
        });

        it("should revert calling for future block", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);

            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportReconnect(
                    initialValidators[1].address,
                    latestBlock!.number + 5,
                    latestBlock!.hash!
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "InvalidBlock");
        });

        it("should revert calling with invalid block hash", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);

            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportReconnect(
                    initialValidators[1].address,
                    latestBlock!.number,
                    ethers.keccak256(ethers.toUtf8Bytes(latestBlock!.hash!))
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "InvalidBlock");
        });

        it("should revert too early report", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);

            await setStakingEpochStartTime(await validatorSetHbbft.getAddress(), stakingHbbft);
            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportReconnect(
                    initialValidators[1].address,
                    latestBlock!.number,
                    latestBlock!.hash!
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "ReportTooEarly");
        });

        it("should revert report reconnect without disconnect report", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");
            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await expect(
                connectivityTracker.connect(reporter).reportReconnect(
                    validator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "UnknownReconnectReporter")
                .withArgs(reporter.address, validator.address);

        });

        it("should revert report reconnect by flagged validator", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await setStakingEpochStartTime(await validatorSetHbbft.getAddress(), stakingHbbft);
            await helpers.mine(minReportAgeBlocks + 1);

            let latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.connect(reporter).reportMissingConnectivity(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            ));

            await expect(connectivityTracker.connect(validator).reportReconnect(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            )).to.be.revertedWithCustomError(connectivityTracker, "CannotReportByFlaggedValidator")
                .withArgs(validator.address);
        });

        it("should report validator reconnected and emit event", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);
            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await setStakingEpochStartTime(await validatorSetHbbft.getAddress(), stakingHbbft);
            await helpers.mine(minReportAgeBlocks + 1);

            let latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.connect(reporter).reportMissingConnectivity(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            ));

            latestBlock = await ethers.provider.getBlock("latest");
            await expect(
                connectivityTracker.connect(reporter).reportReconnect(
                    validator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                )
            ).to.be.emit(connectivityTracker, "ReportReconnect")
                .withArgs(
                    reporter.address,
                    validator.address,
                    latestBlock!.number
                );
        });

        it("should report validator reconnected and unflag it", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");
            const caller = initialValidators[0];
            const validator = initialValidators[1];

            expect(await connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            ));

            expect(await connectivityTracker.getFlaggedValidators()).to.include(validator.address);
            await helpers.mine(1);

            expect(await connectivityTracker.connect(caller).reportReconnect(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            ));

            expect(await connectivityTracker.getFlaggedValidators()).to.not.include(validator.address);
        });

        it("should decrease validator connectivity score if reported reconnect", async () => {
            const { connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");
            const validator = initialValidators[2];

            for (const reporter of [initialValidators[0], initialValidators[1]]) {
                expect(await connectivityTracker.connect(reporter).reportMissingConnectivity(
                    validator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                ));
            }

            const epoch = await stakingHbbft.stakingEpoch();
            const previousScore = await connectivityTracker.getValidatorConnectivityScore(epoch, validator.address);
            await helpers.mine(1);

            expect(await connectivityTracker.connect(initialValidators[0]).reportReconnect(
                validator.address,
                latestBlock!.number,
                latestBlock!.hash!
            ));

            const currentScore = await connectivityTracker.getValidatorConnectivityScore(epoch, validator.address);

            expect(currentScore).to.equal(previousScore - 1n);
        });

        it("should send bad performance penalty after faulty validator full reconnect", async () => {
            const { connectivityTracker, stakingHbbft, bonusScoreContractMock } = await helpers.loadFixture(deployContracts);

            const [badValidator, ...goodValidators] = initialValidators;
            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            let latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.isFaultyValidator(epoch, badValidator.address)).to.be.false;

            for (let i = 0; i < reportsThreshold; ++i) {
                await connectivityTracker.connect(goodValidators[i]).reportMissingConnectivity(
                    badValidator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                );
            }

            expect(await connectivityTracker.isFaultyValidator(epoch, badValidator.address)).to.be.true;

            const initialScore = 250n;
            await bonusScoreContractMock.setValidatorScore(badValidator.address, initialScore);

            const expectedScore = initialScore - await bonusScoreContractMock.DEFAULT_BAD_PERF_FACTOR();

            latestBlock = await ethers.provider.getBlock("latest");

            for (let i = 0; i < reportsThreshold; ++i) {
                await connectivityTracker.connect(goodValidators[i]).reportReconnect(
                    badValidator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                );
            }

            expect(await connectivityTracker.isFaultyValidator(epoch, badValidator.address)).to.be.false;
            expect(await connectivityTracker.getValidatorConnectivityScore(epoch, badValidator.address)).to.equal(0n);
            expect(await bonusScoreContractMock.getValidatorScore(badValidator.address)).to.equal(expectedScore);
        });
    });

    describe('penaliseFaultyValidators', async () => {
        it("should restrict calling to BlockReward contract", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);

            const caller = accounts[0];

            await expect(
                connectivityTracker.connect(caller).penaliseFaultyValidators(0)
            ).to.be.revertedWithCustomError(connectivityTracker, "Unauthorized");
        });

        it("should not send penalties twice for same epoch", async () => {
            const { connectivityTracker, stakingHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContracts);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);

            const signer = await impersonateAcc(await blockRewardHbbft.getAddress());

            expect(await connectivityTracker.connect(signer).penaliseFaultyValidators(epoch));

            await expect(connectivityTracker.connect(signer).penaliseFaultyValidators(epoch))
                .to.be.revertedWithCustomError(connectivityTracker, "EpochPenaltiesAlreadySent")
                .withArgs(epoch);

            await helpers.stopImpersonatingAccount(signer.address);
        });

        it("should penalise faulty validators", async () => {
            const {
                connectivityTracker,
                stakingHbbft,
                blockRewardHbbft,
                bonusScoreContractMock
            } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            const latestBlock = await ethers.provider.getBlock("latest");

            for (const badValidator of badValidators) {
                for (let j = 0; j < reportsThreshold; ++j) {
                    await connectivityTracker.connect(goodValidators[j]).reportMissingConnectivity(
                        badValidator.address,
                        latestBlock!.number,
                        latestBlock!.hash!
                    );
                }
            }

            const initialScore = 205n;
            const scoreAfter = initialScore - 100n;

            for (const badValidator of badValidators) {
                await bonusScoreContractMock.setValidatorScore(badValidator.address, initialScore);
            }

            const signer = await impersonateAcc(await blockRewardHbbft.getAddress());

            expect(await connectivityTracker.connect(signer).penaliseFaultyValidators(epoch));

            for (const badValidator of badValidators) {
                expect(await bonusScoreContractMock.getValidatorScore(badValidator.address))
                    .to.equal(scoreAfter);
            }

            await helpers.stopImpersonatingAccount(signer.address);
        });

        it("should not penalise flagged but non faulty validators", async () => {
            const {
                connectivityTracker,
                stakingHbbft,
                blockRewardHbbft,
                bonusScoreContractMock
            } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            const latestBlock = await ethers.provider.getBlock("latest");

            for (const badValidator of badValidators) {
                for (let j = 0; j < reportsThreshold - 2; ++j) {
                    await connectivityTracker.connect(goodValidators[j]).reportMissingConnectivity(
                        badValidator.address,
                        latestBlock!.number,
                        latestBlock!.hash!
                    );
                }
            }

            const initialScore = 205n;

            for (const badValidator of badValidators) {
                await bonusScoreContractMock.setValidatorScore(badValidator.address, initialScore);
            }

            const signer = await impersonateAcc(await blockRewardHbbft.getAddress());
            expect(await connectivityTracker.connect(signer).penaliseFaultyValidators(epoch));

            for (const badValidator of badValidators) {
                expect(await bonusScoreContractMock.getValidatorScore(badValidator.address))
                    .to.equal(initialScore);
            }

            await helpers.stopImpersonatingAccount(signer.address);
        });
    });

    describe('countFaultyValidators', async () => {
        it("should count faulty validators", async function () {
            const { connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            const latestBlock = await ethers.provider.getBlock("latest");

            for (const badValidator of badValidators) {
                for (let j = 0; j < reportsThreshold; ++j) {
                    await connectivityTracker.connect(goodValidators[j]).reportMissingConnectivity(
                        badValidator.address,
                        latestBlock!.number,
                        latestBlock!.hash!
                    );
                }
            }

            expect(await connectivityTracker.countFaultyValidators(epoch)).to.equal(badValidatorsCount);
        });

        it("should return 0 if validators reported but not faulty", async function () {
            const { connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            const latestBlock = await ethers.provider.getBlock("latest");

            for (const badValidator of badValidators) {
                for (let j = 0; j < reportsThreshold - 1; ++j) {
                    await connectivityTracker.connect(goodValidators[j]).reportMissingConnectivity(
                        badValidator.address,
                        latestBlock!.number,
                        latestBlock!.hash!
                    );
                }
            }

            expect(await connectivityTracker.countFaultyValidators(epoch)).to.equal(0n);
        });
    });

    describe('isReported', async () => {
        it("should check if validator reported", async function () {
            const { connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const [badValidator, ...goodValidators] = initialValidators;
            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            let latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.isFaultyValidator(epoch, badValidator.address)).to.be.false;

            for (let i = 0; i < reportsThreshold - 1; ++i) {
                await connectivityTracker.connect(goodValidators[i]).reportMissingConnectivity(
                    badValidator.address,
                    latestBlock!.number,
                    latestBlock!.hash!
                );

                expect(
                    await connectivityTracker.isReported(epoch, badValidator.address, goodValidators[i].address)
                ).to.be.true;
            }
        });
    });

    describe('earlyEpochEndThreshold', async () => {
        let EpochEndTriggers = [
            { hbbftFaultTolerance: 0, networkSize: 1, threshold: 0 },
            { hbbftFaultTolerance: 0, networkSize: 2, threshold: 0 },
            { hbbftFaultTolerance: 0, networkSize: 3, threshold: 0 },
            { hbbftFaultTolerance: 1, networkSize: 4, threshold: 0 },
            { hbbftFaultTolerance: 2, networkSize: 7, threshold: 0 },
            { hbbftFaultTolerance: 3, networkSize: 10, threshold: 1 },
            { hbbftFaultTolerance: 4, networkSize: 13, threshold: 2 },
            { hbbftFaultTolerance: 5, networkSize: 16, threshold: 3 },
            { hbbftFaultTolerance: 6, networkSize: 19, threshold: 4 },
            { hbbftFaultTolerance: 7, networkSize: 22, threshold: 5 },
            { hbbftFaultTolerance: 8, networkSize: 25, threshold: 6 },
        ];

        EpochEndTriggers.forEach((args) => {
            it(`should get epoch end threshold for hbbft fault tolerance: ${args.hbbftFaultTolerance}, network size: ${args.networkSize}`, async () => {
                const { connectivityTracker, validatorSetHbbft } = await helpers.loadFixture(deployContracts);

                await validatorSetHbbft.setValidatorsNum(args.networkSize);
                expect(await validatorSetHbbft.getCurrentValidatorsCount()).to.equal(args.networkSize);

                expect(await connectivityTracker.earlyEpochEndThreshold()).to.equal(args.threshold);
            });
        });
    });

    describe('early epoch end', async () => {
        it("should set early epoch end = true with sufficient reports", async () => {
            const { connectivityTracker, stakingHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            const latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.isEarlyEpochEnd(epoch)).to.equal(false);

            for (let i = 0; i < badValidators.length; ++i) {
                for (let j = 0; j < reportsThreshold; ++j) {
                    if (i == badValidators.length - 1 && j == reportsThreshold - 1) {
                        break;
                    }

                    await connectivityTracker.connect(goodValidators[j]).reportMissingConnectivity(
                        badValidators[i].address,
                        latestBlock!.number,
                        latestBlock!.hash!
                    );
                }
            }

            const lastBlock = await helpers.time.latestBlock();

            const lastReporter = goodValidators[reportsThreshold - 1];
            await expect(connectivityTracker.connect(lastReporter).reportMissingConnectivity(
                badValidators[badValidators.length - 1].address,
                latestBlock!.number,
                latestBlock!.hash!
            )).to.emit(connectivityTracker, "NotifyEarlyEpochEnd")
                .withArgs(epoch, lastBlock + 1);

            expect(await connectivityTracker.isEarlyEpochEnd(epoch)).to.equal(true);
            expect(await blockRewardHbbft.earlyEpochEnd()).to.equal(true);
        });

        it("should skip check for current epoch if early end already set", async () => {
            const { connectivityTracker, stakingHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContracts);

            const badValidatorsCount = Math.floor(initialValidators.length / 4);

            const badValidators = initialValidators.slice(0, badValidatorsCount);
            const goodValidators = initialValidators.slice(badValidatorsCount);

            const reportsThreshold = Math.floor(goodValidators.length * 2 / 3 + 1);

            const epoch = 5;
            await stakingHbbft.setStakingEpoch(epoch);
            const latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.isEarlyEpochEnd(epoch)).to.equal(false);

            for (let i = 0; i < badValidators.length; ++i) {
                for (let j = 0; j < reportsThreshold; ++j) {
                    if (i == badValidators.length - 1 && j == reportsThreshold - 1) {
                        break;
                    }

                    await connectivityTracker.connect(goodValidators[j]).reportMissingConnectivity(
                        badValidators[i].address,
                        latestBlock!.number,
                        latestBlock!.hash!
                    );
                }
            }

            const lastBlock = await helpers.time.latestBlock();

            let reporter = goodValidators[reportsThreshold - 1];
            await expect(connectivityTracker.connect(reporter).reportMissingConnectivity(
                badValidators[badValidators.length - 1].address,
                latestBlock!.number,
                latestBlock!.hash!
            )).to.emit(connectivityTracker, "NotifyEarlyEpochEnd")
                .withArgs(epoch, lastBlock + 1);

            expect(await connectivityTracker.isEarlyEpochEnd(epoch)).to.equal(true);
            expect(await blockRewardHbbft.earlyEpochEnd()).to.equal(true);

            reporter = goodValidators[reportsThreshold];
            await expect(connectivityTracker.connect(reporter).reportMissingConnectivity(
                badValidators[badValidators.length - 1].address,
                latestBlock!.number,
                latestBlock!.hash!
            )).to.not.emit(connectivityTracker, "NotifyEarlyEpochEnd");
        });
    });
});
