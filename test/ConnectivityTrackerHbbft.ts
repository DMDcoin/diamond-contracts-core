import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import {
    ConnectivityTrackerHbbft,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    BlockRewardHbbftMock,
} from "../src/types";
import { keccak256 } from "ethers/lib/utils";

describe('ConnectivityTrackerHbbft', () => {
    const validatorInactivityThreshold = 86400 // 1 day
    const minReportAgeBlocks = 10;

    let accounts: SignerWithAddress[];
    let owner: SignerWithAddress;
    let addresses: string[]
    let initialValidators: SignerWithAddress[];
    let initialStakingAccounts: SignerWithAddress[];

    let nonValidators: SignerWithAddress[];

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

        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbft = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                stubAddress,                  // _blockRewardContract
                stubAddress,                  // _randomContract
                stubAddress,                  // _stakingContract
                stubAddress,                  // _keyGenHistoryContract
                validatorInactivityThreshold, // _validatorInactivityThreshold
                validatorAddresses,           // _initialMiningAddresses
                stakingAddresses,             // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as ValidatorSetHbbftMock;

        await validatorSetHbbft.deployed();

        let stakingParams = {
            _validatorSetContract: validatorSetHbbft.address,
            _initialStakingAddresses: stakingAddresses,
            _delegatorMinStake: ethers.utils.parseEther('1'),
            _candidateMinStake: ethers.utils.parseEther('10'),
            _maxStake: ethers.utils.parseEther('100'),
            _stakingFixedEpochDuration: BigNumber.from(86400),
            _stakingTransitionTimeframeLength: BigNumber.from(3600),
            _stakingWithdrawDisallowPeriod: BigNumber.from(1)
        };

        let initialValidatorsPubKeys: string[] = [];
        let initialValidatorsIpAddresses: string[] = [];

        for (let i = 0; i < stakingAddresses.length; i++) {
            initialValidatorsPubKeys.push(ethers.Wallet.createRandom().publicKey);
            initialValidatorsIpAddresses.push('0x00000000000000000000000000000000');
        }

        let initialValidatorsPubKeysSplit = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            (initialValidatorsPubKeys);

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingHbbft = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                stakingParams,
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses   // _internetAddresses

            ],
            { initializer: 'initialize' }
        ) as StakingHbbftMock;

        await stakingHbbft.deployed();

        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        const blockRewardHbbft = await upgrades.deployProxy(
            BlockRewardHbbftFactory,
            [
                owner.address,
                validatorSetHbbft.address,
                stubAddress
            ],
            { initializer: 'initialize' }
        ) as BlockRewardHbbftMock;

        await blockRewardHbbft.deployed();

        const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
        const connectivityTracker = await upgrades.deployProxy(
            ConnectivityTrackerFactory,
            [
                owner.address,
                validatorSetHbbft.address,
                stakingHbbft.address,
                blockRewardHbbft.address,
                minReportAgeBlocks,
            ],
            { initializer: 'initialize' }
        ) as ConnectivityTrackerHbbft;

        await connectivityTracker.deployed();
        await blockRewardHbbft.setConnectivityTracker(connectivityTracker.address);

        return { connectivityTracker, validatorSetHbbft, stakingHbbft, blockRewardHbbft };
    }

    async function setStakingEpochStartTime(caller: string, stakingHbbft: StakingHbbftMock) {
        await helpers.impersonateAccount(caller);

        await owner.sendTransaction({
            to: caller,
            value: ethers.utils.parseEther('10'),
        });

        const latest = await helpers.time.latest();
        const signer = await ethers.getSigner(caller);

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
                    ethers.constants.AddressZero,
                    stubAddress,
                    stubAddress,
                    stubAddress,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ConnectivityTrackerFactory, "InvalidAddress");
        });

        it("should revert if validator set contract = address(0)", async () => {
            const stubAddress = addresses[1];

            const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
            await expect(upgrades.deployProxy(
                ConnectivityTrackerFactory,
                [
                    owner.address,
                    ethers.constants.AddressZero,
                    stubAddress,
                    stubAddress,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ConnectivityTrackerFactory, "InvalidAddress");
        });

        it("should revert if staking contract = address(0)", async () => {
            const stubAddress = addresses[1];

            const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbft");
            await expect(upgrades.deployProxy(
                ConnectivityTrackerFactory,
                [
                    owner.address,
                    stubAddress,
                    ethers.constants.AddressZero,
                    stubAddress,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ConnectivityTrackerFactory, "InvalidAddress");
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
                    ethers.constants.AddressZero,
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ConnectivityTrackerFactory, "InvalidAddress");
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
                    minReportAgeBlocks
                ],
                { initializer: 'initialize' }
            );

            expect(await contract.deployed());

            await expect(contract.initialize(
                owner.address,
                stubAddress,
                stubAddress,
                stubAddress,
                minReportAgeBlocks
            )).to.be.revertedWith('Initializable: contract is already initialized');
        });
    });

    describe('setMinReportArge', async () => {
        it("should revert calling function by unauthorized account", async function () {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const caller = accounts[4];

            await expect(
                connectivityTracker.connect(caller).setMinReportAge(100)
            ).to.be.revertedWith("Ownable: caller is not the owner");
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
            ).to.be.revertedWith("Ownable: caller is not the owner");
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
                    latestBlock.number,
                    latestBlock.hash
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "OnlyValidator");
        });

        it("should revert calling for future block", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                    initialValidators[1].address,
                    latestBlock.number + 5,
                    latestBlock.hash
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "InvalidBlock");
        });

        it("should revert calling with invalid block hash", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                    initialValidators[1].address,
                    latestBlock.number,
                    keccak256(ethers.utils.toUtf8Bytes(latestBlock.hash))
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "InvalidBlock");
        });

        it("should revert too early report", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                    initialValidators[1].address,
                    latestBlock.number,
                    latestBlock.hash
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "ReportTooEarly");
        });

        it("should revert duplicate report by same validator", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);
            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            await helpers.mine(minReportAgeBlocks + 1);

            const latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.connect(reporter).reportMissingConnectivity(
                validator.address,
                latestBlock.number,
                latestBlock.hash
            ));

            await expect(connectivityTracker.connect(reporter).reportMissingConnectivity(
                validator.address,
                latestBlock.number,
                latestBlock.hash
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
                latestBlock.number,
                latestBlock.hash
            ));

            await expect(connectivityTracker.connect(validator).reportMissingConnectivity(
                reporter.address,
                latestBlock.number,
                latestBlock.hash
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
                    latestBlock.number,
                    latestBlock.hash
                )
            ).to.emit(connectivityTracker, "ReportMissingConnectivity")
                .withArgs(
                    reporter.address,
                    validator.address,
                    latestBlock.number
                );
        });

        it("should report missing connectivity and flag validator", async () => {
            const { connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");

            const currentEpoch = await stakingHbbft.stakingEpoch();
            const validator = initialValidators[1];

            const previousScore = await connectivityTracker.validatorConnectivityScore(
                currentEpoch,
                validator.address
            );
            expect(await connectivityTracker.getFlaggedValidators()).to.not.include(validator.address);

            expect(await connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                validator.address,
                latestBlock.number,
                latestBlock.hash
            ));

            expect(await connectivityTracker.getFlaggedValidators()).to.include(validator.address);
            expect(await connectivityTracker.validatorConnectivityScore(currentEpoch, validator.address))
                .to.equal(previousScore.add(1));
        });

        it("should increase validator score with each report", async () => {
            const { connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0];

            const epoch = await stakingHbbft.stakingEpoch();
            const initialScore = await connectivityTracker.validatorConnectivityScore(epoch, validator.address);
            const latestBlock = await ethers.provider.getBlock("latest");

            for (let i = 1; i < initialValidators.length; ++i) {
                expect(await connectivityTracker.connect(initialValidators[i]).reportMissingConnectivity(
                    validator.address,
                    latestBlock.number,
                    latestBlock.hash
                ));

                expect(
                    await connectivityTracker.validatorConnectivityScore(epoch, validator.address)
                ).to.equal(initialScore.add(i))
            }

            expect(await connectivityTracker.validatorConnectivityScore(epoch, validator.address))
                .to.equal(initialValidators.length - 1);
        });

        it("should early epoch end = true with sufficient reports", async () => {
            const { connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const goodValidatorsCount = Math.floor(initialValidators.length * 2 / 3 + 1);

            const goodValidators = initialValidators.slice(0, goodValidatorsCount);
            const badValidators = initialValidators.slice(goodValidatorsCount);

            const epoch = await stakingHbbft.stakingEpoch();
            const latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.isEarlyEpochEnd(epoch)).to.equal(false);

            for (let i = 0; i < goodValidators.length; ++i) {
                for (let j = 0; j < badValidators.length; ++j) {
                    expect(await connectivityTracker.connect(goodValidators[i]).reportMissingConnectivity(
                        badValidators[j].address,
                        latestBlock.number,
                        latestBlock.hash
                    ));
                }
            }

            expect(await connectivityTracker.isEarlyEpochEnd(epoch)).to.equal(true);
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
                    latestBlock.number,
                    latestBlock.hash
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "OnlyValidator");
        });

        it("should revert calling for future block", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);

            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportReconnect(
                    initialValidators[1].address,
                    latestBlock.number + 5,
                    latestBlock.hash
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "InvalidBlock");
        });

        it("should revert calling with invalid block hash", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);

            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportReconnect(
                    initialValidators[1].address,
                    latestBlock.number,
                    keccak256(ethers.utils.toUtf8Bytes(latestBlock.hash))
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "InvalidBlock");
        });

        it("should revert too early report", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            const latestBlock = await ethers.provider.getBlock("latest");

            await expect(
                connectivityTracker.connect(initialValidators[0]).reportReconnect(
                    initialValidators[1].address,
                    latestBlock.number,
                    latestBlock.hash
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
                    latestBlock.number,
                    latestBlock.hash
                )
            ).to.be.revertedWithCustomError(connectivityTracker, "UnknownReconnectReporter")
                .withArgs(reporter.address, validator.address);

        });

        it("should revert report reconnect by flagged validator", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);

            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            await helpers.mine(minReportAgeBlocks + 1);

            let latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.connect(reporter).reportMissingConnectivity(
                validator.address,
                latestBlock.number,
                latestBlock.hash
            ));

            await expect(connectivityTracker.connect(validator).reportReconnect(
                validator.address,
                latestBlock.number,
                latestBlock.hash
            )).to.be.revertedWithCustomError(connectivityTracker, "CannotReportByFlaggedValidator")
                .withArgs(validator.address);
        });

        it("should report validator reconnected and emit event", async () => {
            const { connectivityTracker, validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContracts);
            const reporter = initialValidators[0];
            const validator = initialValidators[1];

            await setStakingEpochStartTime(validatorSetHbbft.address, stakingHbbft);
            await helpers.mine(minReportAgeBlocks + 1);

            let latestBlock = await ethers.provider.getBlock("latest");

            expect(await connectivityTracker.connect(reporter).reportMissingConnectivity(
                validator.address,
                latestBlock.number,
                latestBlock.hash
            ));

            latestBlock = await ethers.provider.getBlock("latest");
            await expect(
                connectivityTracker.connect(reporter).reportReconnect(
                    validator.address,
                    latestBlock.number,
                    latestBlock.hash
                )
            ).to.be.emit(connectivityTracker, "ReportReconnect")
                .withArgs(
                    reporter.address,
                    validator.address,
                    latestBlock.number
                );
        });

        it("should report validator reconnected and unflag it", async () => {
            const { connectivityTracker } = await helpers.loadFixture(deployContracts);
            const latestBlock = await ethers.provider.getBlock("latest");
            const caller = initialValidators[0];
            const validator = initialValidators[1];

            expect(await connectivityTracker.connect(initialValidators[0]).reportMissingConnectivity(
                validator.address,
                latestBlock.number,
                latestBlock.hash
            ));

            expect(await connectivityTracker.getFlaggedValidators()).to.include(validator.address);
            await helpers.mine(1);

            expect(await connectivityTracker.connect(caller).reportReconnect(
                validator.address,
                latestBlock.number,
                latestBlock.hash
            ));

            expect(await connectivityTracker.getFlaggedValidators()).to.not.include(validator.address);
        });
    });

    describe('getFlaggedValidators', async () => {
    });
});
