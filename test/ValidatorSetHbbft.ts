import { ethers, network, upgrades } from "hardhat";
import { TransactionResponse } from "ethers";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import fp from "lodash/fp";

import {
    BlockRewardHbbftMock,
    RandomHbbft,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    KeyGenHistory,
    CertifierHbbft,
    TxPermissionHbbft,
} from "../src/types";

import { Permission } from "./testhelpers/Permission";
import { random } from "./utils/utils";
import { getNValidatorsPartNAcks } from "./testhelpers/data";

// one epoch in 1 day.
const stakingFixedEpochDuration = 86400n;

// the transition time window is 1 hour.
const stakingTransitionTimeframeLength = 3600n;
const stakingWithdrawDisallowPeriod = 1n;
const MIN_STAKE = ethers.parseEther('1');
const MAX_STAKE = ethers.parseEther('100000');

const validatorInactivityThreshold = BigInt(365 * 86400) // 1 year

const SystemAccountAddress = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";

describe('ValidatorSetHbbft', () => {
    let owner: HardhatEthersSigner;
    let accounts: HardhatEthersSigner[];

    let initialValidatorsPubKeys: string[];
    let initialValidatorsPubKeysSplit: string[];
    let initialValidatorsIpAddresses: string[];

    let initialValidators: string[];
    let initialStakingAddresses: string[];

    let accountAddresses: string[];

    let stubAddress: string;

    let getValidatorSetParams = () => {
        return {
            blockRewardContract: ethers.Wallet.createRandom().address,
            randomContract: ethers.Wallet.createRandom().address,
            stakingContract: ethers.Wallet.createRandom().address,
            keyGenHistoryContract: ethers.Wallet.createRandom().address,
            bonusScoreContract: ethers.Wallet.createRandom().address,
            connectivityTrackerContract: ethers.Wallet.createRandom().address,
            validatorInactivityThreshold: validatorInactivityThreshold,
        }
    }

    async function deployContractsFixture() {
        const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

        const bonusScoreContractMockFactory = await ethers.getContractFactory("BonusScoreSystemMock");
        const bonusScoreContractMock = await bonusScoreContractMockFactory.deploy();
        await bonusScoreContractMock.waitForDeployment();

        const ConnectivityTrackerFactory = await ethers.getContractFactory("ConnectivityTrackerHbbftMock");
        const connectivityTracker = await ConnectivityTrackerFactory.deploy();
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

        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        const validatorSetHbbft = await upgrades.deployProxy(
            ValidatorSetFactory,
            [
                owner.address,
                validatorSetParams,      // _params
                initialValidators,       // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as ValidatorSetHbbftMock;

        await validatorSetHbbft.waitForDeployment();

        const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbft");
        const randomHbbft = await upgrades.deployProxy(
            RandomHbbftFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress()
            ],
            { initializer: 'initialize' },
        ) as unknown as RandomHbbft;

        await randomHbbft.waitForDeployment();

        const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
        const keyGenHistory = await upgrades.deployProxy(
            KeyGenFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(),
                initialValidators,
                parts,
                acks
            ],
            { initializer: 'initialize' }
        ) as unknown as KeyGenHistory;

        await keyGenHistory.waitForDeployment();

        const CertifierFactory = await ethers.getContractFactory("CertifierHbbft");
        const certifier = await upgrades.deployProxy(
            CertifierFactory,
            [
                [owner.address],
                await validatorSetHbbft.getAddress(),
                owner.address
            ],
            { initializer: 'initialize' }
        ) as unknown as CertifierHbbft;

        await certifier.waitForDeployment();

        const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");
        const txPermission = await upgrades.deployProxy(
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

        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
        const blockRewardHbbft = await upgrades.deployProxy(
            BlockRewardHbbftFactory,
            [
                owner.address,
                await validatorSetHbbft.getAddress(),
                await connectivityTracker.getAddress(),
            ],
            { initializer: 'initialize' }
        ) as unknown as BlockRewardHbbftMock;

        await blockRewardHbbft.waitForDeployment();

        let stakingParams = {
            _validatorSetContract: await validatorSetHbbft.getAddress(),
            _bonusScoreContract: await bonusScoreContractMock.getAddress(),
            _initialStakingAddresses: initialStakingAddresses,
            _delegatorMinStake: ethers.parseEther('1'),
            _candidateMinStake: ethers.parseEther('1'),
            _maxStake: MAX_STAKE,
            _stakingFixedEpochDuration: stakingFixedEpochDuration,
            _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
            _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
        };

        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
        const stakingHbbft = await upgrades.deployProxy(
            StakingHbbftFactory,
            [
                owner.address,
                stakingParams, // initializer structure
                initialValidatorsPubKeysSplit, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ],
            { initializer: 'initialize' }
        ) as unknown as StakingHbbftMock;

        await stakingHbbft.waitForDeployment();

        await validatorSetHbbft.setBlockRewardContract(await blockRewardHbbft.getAddress());
        await validatorSetHbbft.setRandomContract(await randomHbbft.getAddress());
        await validatorSetHbbft.setStakingContract(await stakingHbbft.getAddress());
        await validatorSetHbbft.setKeyGenHistoryContract(await keyGenHistory.getAddress());

        return {
            validatorSetHbbft,
            blockRewardHbbft,
            stakingHbbft,
            randomHbbft,
            keyGenHistory,
            certifier,
            txPermission,
            connectivityTracker
        };
    }

    async function impersonateAcc(address: string) {
        await helpers.impersonateAccount(address);

        await owner.sendTransaction({
            to: address,
            value: ethers.parseEther('10'),
        });

        return await ethers.getSigner(address);
    }

    beforeEach(async () => {
        [owner, ...accounts] = await ethers.getSigners();
        accountAddresses = accounts.map(item => item.address);

        stubAddress = accountAddresses[1];

        initialValidators = accountAddresses.slice(1, 3 + 1); // accounts[1...3]
        initialStakingAddresses = accountAddresses.slice(4, 6 + 1); // accounts[4...6]

        // The following private keys belong to the accounts 1-3, fixed by using the "--mnemonic" option when starting ganache.
        // const initialValidatorsPrivKeys = ["0x272b8400a202c08e23641b53368d603e5fec5c13ea2f438bce291f7be63a02a7", "0xa8ea110ffc8fe68a069c8a460ad6b9698b09e21ad5503285f633b3ad79076cf7", "0x5da461ff1378256f69cb9a9d0a8b370c97c460acbe88f5d897cb17209f891ffc"];
        // Public keys corresponding to the three private keys above.

        initialValidatorsPubKeys = [
            '0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
            '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
            '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56'
        ];

        initialValidatorsPubKeysSplit = fp.flatMap((x: string) => [
            x.substring(0, 66), '0x' + x.substring(66, 130)
        ])(initialValidatorsPubKeys);

        // The IP addresses are irrelevant for these unit test, just initialize them to 0.
        initialValidatorsIpAddresses = Array(3).fill(ethers.zeroPadBytes("0x00", 16));
    });

    describe('initialize', async () => {
        let ZeroInitializerTestCases = [
            {
                caseName: "BlockRewardHbbft",
                params: {
                    ...getValidatorSetParams(),
                    blockRewardContract: ethers.ZeroAddress,
                }
            },
            {
                caseName: "RandomHbbft",
                params: {
                    ...getValidatorSetParams(),
                    randomContract: ethers.ZeroAddress,
                }
            },
            {
                caseName: "StakingHbbft",
                params: {
                    ...getValidatorSetParams(),
                    stakingContract: ethers.ZeroAddress,
                }
            },
            {
                caseName: "KeyGenHistory",
                params: {
                    ...getValidatorSetParams(),
                    keyGenHistoryContract: ethers.ZeroAddress,
                }
            },
            {
                caseName: "BonusScoreSystem",
                params: {
                    ...getValidatorSetParams(),
                    bonusScoreContract: ethers.ZeroAddress,
                }
            },
        ]

        beforeEach(async () => {
            expect(initialValidators.length).to.be.equal(3);
            expect(initialValidators[0]).to.not.be.equal(ethers.ZeroAddress);
            expect(initialValidators[1]).to.not.be.equal(ethers.ZeroAddress);
            expect(initialValidators[2]).to.not.be.equal(ethers.ZeroAddress);
        });

        ZeroInitializerTestCases.forEach((args) => {
            it(`should revert initialization with ${args.caseName} contract address`, async function () {
                const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
                await expect(upgrades.deployProxy(
                    ValidatorSetFactory,
                    [
                        owner.address,
                        args.params,
                        initialValidators,
                        initialStakingAddresses,
                    ],
                    { initializer: 'initialize' }
                )).to.be.revertedWithCustomError(ValidatorSetFactory, "ZeroAddress");
            });
        });

        it('should initialize successfully', async () => {
            const params = getValidatorSetParams();

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            const validatorSetHbbft = await upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    params,
                    initialValidators,
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            );

            expect(await validatorSetHbbft.waitForDeployment());

            expect(await validatorSetHbbft.blockRewardContract()).to.equal(params.blockRewardContract);
            expect(await validatorSetHbbft.randomContract()).to.equal(params.randomContract);
            expect(await validatorSetHbbft.getStakingContract()).to.equal(params.stakingContract);
            expect(await validatorSetHbbft.keyGenHistoryContract()).to.equal(params.keyGenHistoryContract);
            expect(await validatorSetHbbft.bonusScoreSystem()).to.equal(params.bonusScoreContract);

            expect(await validatorSetHbbft.getValidators()).to.be.deep.equal(initialValidators);
            expect((await validatorSetHbbft.getPendingValidators()).length).to.be.equal(0);

            for (let i = 0; i < initialValidators.length; ++i) {
                expect(await validatorSetHbbft.isValidator(initialValidators[i])).to.be.true;
                expect(await validatorSetHbbft.miningByStakingAddress(initialStakingAddresses[i])).to.be.equal(initialValidators[i]);
                expect(await validatorSetHbbft.stakingByMiningAddress(initialValidators[i])).to.be.equal(initialStakingAddresses[i]);
            }

            expect(await validatorSetHbbft.isValidator(ethers.ZeroAddress)).to.be.false;
            expect(await validatorSetHbbft.validatorInactivityThreshold()).to.be.equal(validatorInactivityThreshold);
        });

        it('should fail if owner address is zero', async () => {
            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    ethers.ZeroAddress,
                    getValidatorSetParams(),
                    initialValidators,
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "ZeroAddress");
        });

        it('should fail if initial mining addresses are empty', async () => {
            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    [],
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "ValidatorsListEmpty");
        });

        it('should fail if already initialized', async () => {
            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            const validatorSetHbbft = await upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    initialValidators,
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            );

            await expect(validatorSetHbbft.initialize(
                owner.address,
                getValidatorSetParams(),
                initialValidators,
                initialStakingAddresses,
            )).to.be.revertedWithCustomError(validatorSetHbbft, "InvalidInitialization");
        });

        it('should fail if the number of mining addresses is not the same as the number of staking ones', async () => {
            const initialStakingAddressesShort = accountAddresses.slice(4, 5 + 1); // accounts[4...5]

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    initialValidators,
                    initialStakingAddressesShort,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "InitialAddressesLengthMismatch");
        });

        it('should fail if the mining addresses are the same as the staking ones', async () => {
            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    initialValidators,
                    initialValidators,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "InvalidAddressPair");
        });

        it('should fail if some mining address is 0', async () => {
            initialValidators[0] = ethers.ZeroAddress;

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    initialValidators,
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "ZeroAddress");
        });

        it('should fail if some staking address is 0', async () => {
            initialStakingAddresses[0] = ethers.ZeroAddress;

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    initialValidators,
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "ZeroAddress");
        });

        it('should fail if a staking address was already used', async () => {
            initialStakingAddresses[1] = initialStakingAddresses[0];

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    initialValidators,
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "StakingAddressAlreadyUsed")
                .withArgs(initialStakingAddresses[1]);
        });

        it('should fail if a mining address is currently being used as a staking one', async () => {
            initialValidators[1] = initialStakingAddresses[0];

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    initialValidators,
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "MiningAddressAlreadyUsed")
                .withArgs(initialValidators[1]);
        });

        it('should fail if a staking address is currently being used as a mining one', async () => {
            initialStakingAddresses[1] = initialValidators[0];

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    initialValidators,
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "StakingAddressAlreadyUsed")
                .withArgs(initialStakingAddresses[1]);
        });

        it('should fail if a mining address was already used', async () => {
            initialValidators[1] = initialValidators[0];

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            await expect(upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    getValidatorSetParams(),
                    initialValidators,
                    initialStakingAddresses,
                ],
                { initializer: 'initialize' }
            )).to.be.revertedWithCustomError(ValidatorSetFactory, "MiningAddressAlreadyUsed")
                .withArgs(initialValidators[1]);
        });
    });

    describe('setValidatorInactivityThreshold', async () => {
        it('fail to set threshold less than a week', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const value = 60 * 60 * 24 * 7 - 1;

            await expect(validatorSetHbbft.setValidatorInactivityThreshold(value))
                .to.be.revertedWithCustomError(validatorSetHbbft, "InvalidInactivityThreshold");
        });

        it('correct value is set', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            let value30Days = 2592000;
            await validatorSetHbbft.setValidatorInactivityThreshold(value30Days);
            expect(await validatorSetHbbft.validatorInactivityThreshold()).to.be.equal(value30Days);
        });

        it('only owner should be able to change value', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);
            let nobody = (await ethers.getSigners())[42];
            let value30Days = 2592000;

            await expect(validatorSetHbbft.connect(nobody).setValidatorInactivityThreshold(value30Days))
                .to.be.revertedWithCustomError(validatorSetHbbft, "OwnableUnauthorizedAccount")
                .withArgs(nobody.address);
        });
    });

    describe('setValidatorInternetAddress', async () => {
        let validatorSetPermission: Permission<ValidatorSetHbbftMock>

        it('Validator Candidates can write and read their IP Address', async () => {
            let validators = accounts.slice(1, 5);
            let pools = accounts.slice(5, 9);

            let initialMiningAddr = [validators[0].address];
            let initialStakingAddr = [pools[0].address];

            const stubAddress = owner.address;

            const validatorSetParams = getValidatorSetParams();

            const bonusScoreContractMockFactory = await ethers.getContractFactory("BonusScoreSystemMock");
            const bonusScoreContractMock = await bonusScoreContractMockFactory.deploy();
            await bonusScoreContractMock.waitForDeployment();

            const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
            const validatorSetHbbft = await upgrades.deployProxy(
                ValidatorSetFactory,
                [
                    owner.address,
                    validatorSetParams,
                    initialMiningAddr,                            // _initialMiningAddresses
                    initialStakingAddr,                           // _initialStakingAddresses
                ],
                { initializer: 'initialize' }
            ) as unknown as ValidatorSetHbbftMock;

            await validatorSetHbbft.waitForDeployment();

            const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftMock");
            const blockRewardHbbft = await upgrades.deployProxy(
                BlockRewardHbbftFactory,
                [
                    owner.address,
                    await validatorSetHbbft.getAddress(),
                    stubAddress
                ],
                { initializer: 'initialize' }
            ) as unknown as BlockRewardHbbftMock;

            await blockRewardHbbft.waitForDeployment();

            const CertifierFactory = await ethers.getContractFactory("CertifierHbbft");
            const certifier = await upgrades.deployProxy(
                CertifierFactory,
                [
                    [owner.address],
                    await validatorSetHbbft.getAddress(),
                    owner.address
                ],
                { initializer: 'initialize' }
            ) as unknown as CertifierHbbft;

            await certifier.waitForDeployment();

            const keyGenHistoryFake = "0x8000000000000000000000000000000000000001";

            const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");
            const txPermission = await upgrades.deployProxy(
                TxPermissionFactory,
                [
                    [owner.address],
                    await certifier.getAddress(),
                    await validatorSetHbbft.getAddress(),
                    keyGenHistoryFake,
                    stubAddress,
                    owner.address
                ],
                { initializer: 'initialize' }
            ) as unknown as TxPermissionHbbft;

            await txPermission.waitForDeployment();


            let stakingParams = {
                _candidateMinStake: 1000,
                _delegatorMinStake: 100,
                _initialStakingAddresses: initialStakingAddr,
                _stakingFixedEpochDuration: 60,
                _maxStake: 5000,
                _stakingTransitionTimeframeLength: 10,
                _stakingWithdrawDisallowPeriod: 10,
                _validatorSetContract: await validatorSetHbbft.getAddress(),
                _bonusScoreContract: await bonusScoreContractMock.getAddress(),
            };

            const fakePK = "0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae";
            const fakeIP = "0x00000000000000000000000000000001"

            const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftMock");
            const stakingHbbft = await upgrades.deployProxy(
                StakingHbbftFactory,
                [
                    owner.address,
                    stakingParams, // initializer structure
                    [fakePK, fakePK], // _publicKeys
                    [fakeIP] // _internetAddresses
                ],
                { initializer: 'initialize' }
            ) as unknown as StakingHbbftMock;

            await stakingHbbft.waitForDeployment();

            validatorSetPermission = new Permission(txPermission, validatorSetHbbft, false);

            await validatorSetHbbft.setBlockRewardContract(await blockRewardHbbft.getAddress());
            await validatorSetHbbft.setStakingContract(await stakingHbbft.getAddress());

            expect(await validatorSetHbbft.blockRewardContract()).to.equal(await blockRewardHbbft.getAddress());
            expect(await validatorSetHbbft.getStakingContract()).to.equal(await stakingHbbft.getAddress());
            expect(await validatorSetHbbft.randomContract()).to.equal(validatorSetParams.randomContract);
            expect(await validatorSetHbbft.keyGenHistoryContract()).to.equal(validatorSetParams.keyGenHistoryContract)

            expect(await stakingHbbft.getPools()).to.be.not.empty;

            let ipLast = 1;
            for (let pool of pools) {
                if (await stakingHbbft.isPoolActive(pool.address)) {
                    const validatorAddress = await validatorSetHbbft.miningByStakingAddress(pool.address);
                    const ipAddress = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 192, 168, 0, ipLast]);
                    const port = 30303;

                    await setValidatorInternetAddress(validatorSetPermission, validatorAddress, ipAddress, port);
                    const writtenIP = await getValidatorInternetAddress(stakingHbbft, pool.address);

                    expect(writtenIP).to.deep.equal({ ipAddress: ipAddress, port: BigInt(port) });
                }
                ipLast++;
            }
        });
    });

    describe('setBonusScoreSystemAddress', async () => {
        it('should restrict calling to contract owner', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[10];

            await expect(validatorSetHbbft.connect(caller).setBonusScoreSystemAddress(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(validatorSetHbbft, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should revert set zero address', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(validatorSetHbbft.setBonusScoreSystemAddress(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(validatorSetHbbft, "ZeroAddress");
        });

        it('should set new address and emit event', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const newAddress = accounts[11].address;

            expect(await validatorSetHbbft.setBonusScoreSystemAddress(newAddress))
                .to.emit(validatorSetHbbft, "SetBonusScoreContract")
                .withArgs(newAddress);

            expect(await validatorSetHbbft.bonusScoreSystem()).to.equal(newAddress);
        });
    });

    describe('setConnectivityTracker', async () => {
        it('should restrict calling to contract owner', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[10];

            await expect(validatorSetHbbft.connect(caller).setConnectivityTracker(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(validatorSetHbbft, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it('should revert set zero address', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(validatorSetHbbft.setConnectivityTracker(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(validatorSetHbbft, "ZeroAddress");
        });

        it('should set new address and emit event', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const newAddress = accounts[11].address;

            expect(await validatorSetHbbft.setConnectivityTracker(newAddress))
                .to.emit(validatorSetHbbft, "SetConnectivityTrackerContract")
                .withArgs(newAddress);

            expect(await validatorSetHbbft.connectivityTracker()).to.equal(newAddress);
        });
    });

    describe('setStakingAddress', async () => {
        it("should restrict calling to staking contract", async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];

            await expect(validatorSetHbbft.connect(caller).setStakingAddress(ethers.ZeroAddress, ethers.ZeroAddress))
                .to.be.revertedWithCustomError(validatorSetHbbft, "Unauthorized");
        });

        it("should set stakingAddress", async () => {
            const { validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await stakingHbbft.addBalance({ value: ethers.parseEther('1') });
            const stakingSigner = await ethers.getImpersonatedSigner(await stakingHbbft.getAddress());

            const poolMining = ethers.Wallet.createRandom().address;
            const poolStaking = ethers.Wallet.createRandom().address;

            expect(await validatorSetHbbft.connect(stakingSigner).setStakingAddress(poolMining, poolStaking));
            expect(await validatorSetHbbft.stakingByMiningAddress(poolMining)).to.equal(poolStaking);
        });
    });

    describe('newValidatorSet', async () => {
        it('can only be called by BlockReward contract', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(validatorSetHbbft.connect(owner).newValidatorSet())
                .to.be.revertedWithCustomError(validatorSetHbbft, "Unauthorized");
            await validatorSetHbbft.setBlockRewardContract(accounts[4].address);
            await validatorSetHbbft.connect(accounts[4]).newValidatorSet();
        });

        it('should enqueue all initial validators (active pools) if there is no staking', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            // Check the returned value of the pending validators; it should be an empty list
            expect(await validatorSetHbbft.getPendingValidators()).to.be.empty;

            // Emulate calling `newValidatorSet()` at the last block of the fixed epoch duration
            await validatorSetHbbft.setBlockRewardContract(accounts[4].address);
            await validatorSetHbbft.connect(accounts[4]).newValidatorSet();

            // Check the returned value of the pending validators; it should be an empty list
            expect(await validatorSetHbbft.getPendingValidators()).to.have.lengthOf(3);
            expect(await validatorSetHbbft.getPendingValidators()).to.deep.equal(initialValidators);
        });

        it('should enqueue only one validator which has non-empty pool', async () => {
            const { validatorSetHbbft, stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            // Emulate staking: the first validator stakes into their own pool
            const stakeAmount = ethers.parseEther('1');
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).stake(initialStakingAddresses[0], { value: stakeAmount });
            expect(await stakingHbbft.stakeAmount(initialStakingAddresses[0], initialStakingAddresses[0])).to.equal(stakeAmount);

            // Emulate calling `newValidatorSet()` at the last block of the fixed epoch duration
            await validatorSetHbbft.setBlockRewardContract(accounts[4].address);
            await validatorSetHbbft.connect(accounts[4]).newValidatorSet();

            // Check the returned value of `getPendingValidators()`
            expect(await validatorSetHbbft.getPendingValidators()).to.deep.equal([initialValidators[0]]);
        });

        it('should choose validators randomly', async () => {
            const { validatorSetHbbft, stakingHbbft, randomHbbft } = await helpers.loadFixture(deployContractsFixture);

            const stakingAddresses = accountAddresses.slice(7, 29 + 3); // accounts[7...31]
            let miningAddresses = [];

            for (let i = 0; i < stakingAddresses.length; i++) {
                // Generate new candidate mining address
                let candidateMiningAddress = '0x';
                for (let i = 0; i < 20; i++) {
                    let randomByte = random(0, 255).toString(16);
                    if (randomByte.length % 2) {
                        randomByte = '0' + randomByte;
                    }
                    candidateMiningAddress += randomByte;
                }
                miningAddresses.push(candidateMiningAddress.toLowerCase());
            }

            const stakeUnit = ethers.parseEther('1');

            // Emulate staking by the candidates into their own pool
            for (let i = 0; i < stakingAddresses.length; i++) {
                const stakeAmount = stakeUnit * BigInt(i + 1);
                await stakingHbbft.connect(await ethers.getSigner(stakingAddresses[i])).addPool(
                    miningAddresses[i],
                    ethers.zeroPadBytes("0x00", 64),
                    ethers.zeroPadBytes("0x00", 16),
                    { value: stakeAmount }
                );
                expect(await stakingHbbft.stakeAmount(stakingAddresses[i], stakingAddresses[i])).to.equal(stakeAmount);
            }

            // Check pools of the new candidates
            expect(await stakingHbbft.getPoolsToBeElected()).to.be.deep.equal(stakingAddresses);
            const poolsLikelihood = await stakingHbbft.getPoolsLikelihood();

            let likelihoodSum = 0n;
            for (let i = 0; i < stakingAddresses.length; i++) {
                const poolLikelihood = stakeUnit * BigInt(i + 1);

                expect(poolsLikelihood[0][i]).to.be.equal(poolLikelihood);
                likelihoodSum = likelihoodSum + poolLikelihood;
            }

            expect(poolsLikelihood[1]).to.be.equal(likelihoodSum);
            expect(await randomHbbft.currentSeed()).to.be.equal(0n);

            const seed = random(1000000, 2000000);
            const systemSigner = await impersonateAcc(SystemAccountAddress);

            await randomHbbft.connect(systemSigner).setCurrentSeed(seed);
            expect(await randomHbbft.currentSeed()).to.be.equal(seed);

            await helpers.stopImpersonatingAccount(SystemAccountAddress);

            // Emulate calling `newValidatorSet()` at the last block of the staking epoch
            await validatorSetHbbft.setBlockRewardContract(accounts[4].address);
            await validatorSetHbbft.connect(accounts[4]).newValidatorSet();

            const newValidators = await validatorSetHbbft.getPendingValidators();

            expect(await validatorSetHbbft.maxValidators()).to.be.equal(newValidators.length)

            for (let i = 0; i < newValidators.length; i++) {
                expect(miningAddresses.indexOf(newValidators[i].toLowerCase())).to.be.gte(0n);
            }
        });
    });

    describe('announceAvailability', async () => {
        it('should revert for non-validator caller', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[20];
            const announceBlock = await ethers.provider.getBlock('latest');

            await expect(validatorSetHbbft.connect(caller).announceAvailability(
                announceBlock!.number,
                announceBlock!.hash!,
            )).to.be.revertedWithCustomError(validatorSetHbbft, "CantAnnounceAvailability");
        });

        it('should revert if validator is already announced availability', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = await ethers.getSigner(initialValidators[0]);
            const announceBlock = await ethers.provider.getBlock('latest');

            expect(await validatorSetHbbft.connect(validator).announceAvailability(
                announceBlock!.number,
                announceBlock!.hash!,
            ));

            await helpers.mine(5);
            const reannounceBlock = await ethers.provider.getBlock('latest');

            await expect(validatorSetHbbft.connect(validator).announceAvailability(
                reannounceBlock!.number,
                reannounceBlock!.hash!,
            )).to.be.revertedWithCustomError(validatorSetHbbft, "CantAnnounceAvailability");
        });

        it('should revert for future block', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = await ethers.getSigner(initialValidators[0]);
            const announceBlock = await ethers.provider.getBlock('latest');

            await expect(validatorSetHbbft.connect(validator).announceAvailability(
                announceBlock!.number + 1,
                announceBlock!.hash!,
            )).to.be.revertedWithCustomError(validatorSetHbbft, "InvalidAnnounceBlockNumber");
        });

        it('should revert if provided block hash is wrong', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = await ethers.getSigner(initialValidators[0]);
            const announceBlock = await ethers.provider.getBlock('latest');

            await helpers.mine(1);
            const anotheBlockHash = (await ethers.provider.getBlock('latest'))!.hash!;

            await expect(validatorSetHbbft.connect(validator).announceAvailability(
                announceBlock!.number,
                anotheBlockHash,
            )).to.be.revertedWithCustomError(validatorSetHbbft, "InvalidAnnounceBlockHash");
        });

        it('should revert if announce block too old', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const maxBlockAge = 16;

            const validator = await ethers.getSigner(initialValidators[0]);
            const announceBlock = await ethers.provider.getBlock('latest');

            await helpers.mine(maxBlockAge + 1);

            await expect(validatorSetHbbft.connect(validator).announceAvailability(
                announceBlock!.number,
                announceBlock!.hash!,
            )).to.be.revertedWithCustomError(validatorSetHbbft, "AnnounceBlockNumberTooOld");
        });

        it('should announce availability and emit event', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = await ethers.getSigner(initialValidators[0]);
            expect(await validatorSetHbbft.validatorAvailableSince(validator.address)).to.equal(0n);

            const announceBlock = await ethers.provider.getBlock('latest');

            const tx = await validatorSetHbbft.connect(validator).announceAvailability(
                announceBlock!.number,
                announceBlock!.hash!,
            );

            await expect(tx).to.emit(validatorSetHbbft, "ValidatorAvailable")
                .withArgs(validator.address, await helpers.time.latest());
        });
    });

    describe('notifyUnavailability', async () => {
        it('should restrict calling to staking contract', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(validatorSetHbbft.connect(owner).notifyUnavailability(initialStakingAddresses[1]))
                .to.be.revertedWithCustomError(validatorSetHbbft, "Unauthorized");
        });

        it('should notfiy unavailable by connectivity tracker contract', async () => {
            const { validatorSetHbbft, connectivityTracker } = await helpers.loadFixture(deployContractsFixture);

            await owner.sendTransaction({
                value: ethers.parseEther('1'),
                to: await connectivityTracker.getAddress(),
            });

            const caller = await ethers.getImpersonatedSigner(await connectivityTracker.getAddress());

            const poolMining = await ethers.getSigner(initialValidators[2]);

            const announceBlock = await ethers.provider.getBlock('latest');
            const announceTx = await validatorSetHbbft.connect(poolMining).announceAvailability(
                announceBlock!.number,
                announceBlock!.hash!
            );
            await announceTx.wait();
            const announceTimestamp = (await announceTx.getBlock())!.timestamp;

            expect(await validatorSetHbbft.validatorAvailableSince(poolMining.address)).to.equal(announceTimestamp);

            const tx = await validatorSetHbbft.connect(caller).notifyUnavailability(poolMining);
            const txTimestamp = (await tx.getBlock())!.timestamp;

            await expect(tx).to.emit(validatorSetHbbft, "ValidatorUnavailable")
                .withArgs(poolMining.address, txTimestamp);

            expect(await validatorSetHbbft.validatorAvailableSince(poolMining)).to.eq(0n);
            expect(await validatorSetHbbft.validatorAvailableSinceLastWrite(poolMining)).to.equal(txTimestamp);
        });

        it('should remove pool from active and to be elected', async () => {
            const { validatorSetHbbft, connectivityTracker, stakingHbbft } = await helpers.loadFixture(deployContractsFixture);

            await owner.sendTransaction({
                value: ethers.parseEther('1'),
                to: await connectivityTracker.getAddress(),
            });

            const caller = await ethers.getImpersonatedSigner(await connectivityTracker.getAddress());

            const poolStaking = await ethers.getSigner(initialStakingAddresses[2]);
            const poolMining = await ethers.getSigner(initialValidators[2]);

            await stakingHbbft.connect(poolStaking).stake(
                poolStaking.address,
                { value: await stakingHbbft.candidateMinStake() },
            );

            const announceBlock = await ethers.provider.getBlock('latest');
            await validatorSetHbbft.connect(poolMining).announceAvailability(
                announceBlock!.number,
                announceBlock!.hash!
            );

            expect(await stakingHbbft.getPools()).to.include(poolStaking.address);
            expect(await stakingHbbft.getPoolsToBeElected()).to.include(poolStaking.address);
            expect(await stakingHbbft.getPoolsInactive()).to.not.include(poolStaking.address);

            await validatorSetHbbft.connect(caller).notifyUnavailability(poolMining.address);

            expect(await stakingHbbft.getPools()).to.not.include(poolStaking.address);
            expect(await stakingHbbft.getPoolsToBeElected()).to.not.include(poolStaking.address);
            expect(await stakingHbbft.getPoolsInactive()).to.include(poolStaking.address);
        });
    });

    describe('validator availability tests', async () => {
        it('should set validatorAvailableSince=timestamp and update last write timestamp', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];

            const availableSince = await helpers.time.latest() + 3600;
            await validatorSetHbbft.setValidatorAvailableSince(validator, availableSince);

            const expectedLastWriteTimestamp = await helpers.time.latest();

            expect(await validatorSetHbbft.validatorAvailableSince(validator)).to.be.equal(availableSince);
            expect(await validatorSetHbbft.validatorAvailableSinceLastWrite(validator)).to.be.equal(expectedLastWriteTimestamp);
        });

        it('should set validatorAvailableSince=0 and update last write timestamp', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[0];

            await validatorSetHbbft.setValidatorAvailableSince(validator, 0);

            const expectedLastWriteTimestamp = await helpers.time.latest();

            expect(await validatorSetHbbft.validatorAvailableSince(validator)).to.be.equal(0n);
            expect(await validatorSetHbbft.validatorAvailableSinceLastWrite(validator)).to.be.equal(expectedLastWriteTimestamp);
        });

        it('should return false from isValidatorAbandoned for active validator', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[1];
            const staking = await validatorSetHbbft.stakingByMiningAddress(validator);

            const currentTimestamp = await helpers.time.latest();
            const availableSince = currentTimestamp;

            await validatorSetHbbft.setValidatorAvailableSince(validator, availableSince);
            expect(await validatorSetHbbft.isValidatorAbandoned(staking)).to.be.false;

            await helpers.time.increase(validatorInactivityThreshold + 3600n);
            expect(await validatorSetHbbft.isValidatorAbandoned(staking)).to.be.false;
        });

        it('should return true from isValidatorAbandoned for abandoned validator', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const validator = initialValidators[1];
            const staking = await validatorSetHbbft.stakingByMiningAddress(validator);

            await validatorSetHbbft.setValidatorAvailableSince(validator, 0);
            expect(await validatorSetHbbft.isValidatorAbandoned(staking)).to.be.false;

            await helpers.time.increase(validatorInactivityThreshold - 1n);
            expect(await validatorSetHbbft.isValidatorAbandoned(staking)).to.be.false;

            await helpers.time.increase(1);
            expect(await validatorSetHbbft.isValidatorAbandoned(staking)).to.be.true;
        });
    });

    describe('finalizeChange', async () => {
        it('should restrict calling to block reward contract', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            await expect(validatorSetHbbft.connect(owner).finalizeChange())
                .to.be.revertedWithCustomError(validatorSetHbbft, "Unauthorized");
        });

        it('should call by block reward address', async () => {
            const { validatorSetHbbft, blockRewardHbbft } = await helpers.loadFixture(deployContractsFixture);

            const blockRewardSigner = await impersonateAcc(await blockRewardHbbft.getAddress());
            await expect(validatorSetHbbft.connect(blockRewardSigner).finalizeChange()).to.be.fulfilled;

            await helpers.stopImpersonatingAccount(blockRewardSigner.address);
        });
    });

    describe('setMaxValidators', async () => {
        it("should restrict calling to contract owner", async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const caller = accounts[5];

            await expect(validatorSetHbbft.connect(caller).setMaxValidators(0n))
                .to.be.revertedWithCustomError(validatorSetHbbft, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it("should set max validators", async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);
            const newValue = 50n;

            await expect(validatorSetHbbft.connect(owner).setMaxValidators(newValue))
                .to.emit(validatorSetHbbft, "SetMaxValidators")
                .withArgs(newValue);

            expect(await validatorSetHbbft.maxValidators()).to.equal(newValue);
        });
    });

    describe('getPublicKey', async () => {
        it("should get public key by mining address", async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);
            const idx = 2;

            expect(await validatorSetHbbft.getPublicKey(initialValidators[idx]))
                .to.equal(initialValidatorsPubKeys[idx]);
        });

        it("should get public key by staking address", async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);
            const idx = 2;

            expect(await validatorSetHbbft.publicKeyByStakingAddress(initialStakingAddresses[idx]))
                .to.equal(initialValidatorsPubKeys[idx]);
        });
    });

    describe('_getRandomIndex', async () => {
        it('should return an adjusted index for defined inputs', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const likelihood = [100n, 200n, 300n, 400n, 500n, 600n, 700n];
            const likelihoodSum = likelihood.reduce(
                (accumulator, currentValue) => accumulator + currentValue,
                0n
            );

            const randomNumbers = [
                '102295698372522486450340395642197401505767984240419462599162533279732332782651',
                '88025212233336166694158733213902358522896299602970367772879732461395027846748',
                '3523742620359620556816465264713466573401040793358132246666974190393877305106',
                '114287137201841041676259866712650409340573048931079410295991941812580890362241',
                '56538372295469756217105752313834104791610579310176881601739166767736723828094',
                '68894736484717464620468052267132544577303666765971723802696502263332160676293',
                '2687897135972768982863977619384943065126168850144103674632415860805119241205',
                '24156724137176021809787734003047081984697808114992466341401603861146655392651',
                '25832498784249909278064625550198896956883678749506959657822549797979716953904',
                '83427681337508775305223983109488324606217343189389013271254642438269351755393',
                '89240493523877502173991078619437290376114395569336992401719662797476983687349',
                '32853052436845401068458327441561229850088309385635363390209017592145381901382',
                '92757373761302092632106569748694156597982600321652929951701742642022538783264',
                '67100691778885672569176318615234924603932468421815258024949536088416049543990',
                '39719159917163831412538990465342603972769478329347733852265531421865718849185',
                '11999966582708588347446743916419096256885726657832588083780562629766444127924',
                '3010033826674280221348240369209662207451628800231593904185251036266265501228',
                '104413946901985991618369747356151891708096310010480784960228664399399331870677',
                '46702964557713889464151228598162726133335720586871289696077799307058716500554',
                '33559859380160476336881942583444222658690349088979267802639562440185523997062',
                '88164666426323367273712257076795707964138351637743196085165838265474516578736',
                '65103249564951811056118667152373579848051986877071782497698315108889906670108',
                '72821055933320812937250747090735048382600804178995301517010109398983401788049',
                '99208478519263809245343193866271416846250644213811563487317845411846195381743',
                '43244103797891865076724512787658122057625989128787310921522570707520428148373',
                '52593213271200799069017680398601742889781965771702477275560701649706236275690',
                '108328978994570005091822140894920607469753367145808907051759972778893235527605',
                '106243412807859477512275680165822018408062239633748780895951018757528890023894',
                '100523913914531030393977247260355055750370476166866773273692522317156719075854',
                '77022898496333694502068353640750783584648231690398908206984568236564244491382',
                '41979375344302562213493428021758696472517069655026004024762400804791650208434',
                '43628854778068621724043940318620457362856035361685143045720331752230463022095',
                '82285705897178482139228255154026207979788495615016066666460634531254361700322',
                '103033773949537101659963963063505003708388612890360333986921649759562312839480',
                '90770865318369187790230484859485855456585867208388117002983261502339419006204',
                '26815346888796872071397186407189158071870764013785636988299203117345299034401',
                '109773710075222485244630344395494360152079130725134468924787713882051145672746',
                '39403951878453528586564883635284384469843277424612617097230872271502436953145',
                '39389791094920594224321489203186955206743847893381281919090308687926471241472',
                '93046390131440905160726040276266392159114510166775585212343442741436904797202',
                '54170062802343058895719474837092940503100946361183675631561437940603180035660',
                '47885497876255822026761249333701662294944183779830405146054765546172721805412',
                '85784108075793984715971258928372040611210416723184976507035355612383079708374',
                '975231504725199172058136797192737545453371688771241516140759234478419802859',
                '11221695937635509523634019528204860046172097301950632766664824992008610905586',
                '107436738580825641164015325500403818249158286517547805162070908854567423888257',
                '95131259382133028521920698684605162235171126887687165345810768990116888018363',
                '32093301002413573589394148587673090493082958864884746627245068789892859808298',
                '88877363243051860109462313934196367092545400665058685614791669873785662729846',
                '93303263974274844888269460050007671790319652816365815159843581987373074921653',
                '2838589525588108250288537685649588904049605284200358625857231445075798244256',
                '103440835631677484504289133413857661716343392137124352829588867199056428014608',
                '14834897586325978641677634740309984613791219233942292334268919899179999089427',
                '90592739484283286958273216485369225962659619600146792320515852466657598765134',
                '90009074497738073685802439049113289828004402439066889514902444182938602209126',
                '85446725415529547155742409866805383130577708568559028346751611699611011965692',
                '65338189934805816499720020632343445443773750636821931638972192112064593536084',
                '68894736484717464620468052267132544577303666765971723802696502263332160676293',
                '97038415570065070631636413689846636057583460394114803408406438433553572855219',
                '37174481483698717274508692458943206319646761313668452904666599193190263829226',
                '83293654371769887530231273428029838254071141275752836966434884009154334272471',
                '61550675608757547480427728231220369062183692943133553616606393063245090570238',
                '106310422063868805710005503758389364559077338757562463680315994157927102319153',
                '92316372422720713132834387635796571697148072536922335291921606080588893618074',
                '38851776122105484438816516456270700216579032737823857667223570744638236996564',
                '91931610975789749530771289631457740460089882038525235577892199819123862300768',
                '12584022001269166953738601736475241704543867143251821698991913500991013184565',
                '93838766957989869741843637162267026686800430761690851182846725406625910762822',
                '37527235859951512630084295239070248050772227070293275276310077413880965859648',
                '10029852584219766552202521629257119585310608286735288902896374319246007520547',
                '100531592418921996440959660218081004075084077325762235445092461282455443776592',
                '70360301780279317294526696738122950206853248320606760459000212639207738599755',
                '42615335097200622363427787014986340987435795544127844838513465698022325549070',
                '97179166642841831901710211011434773821974291088367923187565757087014715556023',
                '35700707592987123768295375654492959504360595047325542190366022889869127210877',
                '61466192968763487567230878115575886253903086088440811010550926385451886494782',
                '21081112160100882571933565571444206767966165752831043953100274757688624040309',
                '43600512080977603081232319401589971747578355235034101951568657558733599985311',
                '93046390131440905160726040276266392159114510166775585212343442741436904797202',
                '78166256786997532299895132208906760280082009588209678686600716400062852428405',
                '13222897386810906888619556934369590110383618401108006840064914837471049962790',
                '1578602856830276566247637536764056525646602601434018088262687436606906368471',
                '71251492413200829753765707207416712328940017555460320629775672005788805406038',
                '49473946423701235119114128891150684565057594399210078568622426111576160796776',
                '2795241924893775962338639421462660396880272895841450532860602370352763967428',
                '1368176909817681289535734912268540340083367565311628960255594700153503166951',
                '102261823055652808807641282805776330377598366626091044675628029769297795448573',
                '98333942429624994334088114537313280633768758375747170937650280702106049631163',
                '101084934713827664963652249459825932313523258148511708462071053005419555774093',
                '100436038107430274336090680869036994691021844216896199595301884506738559689882',
                '21029750837416702025158549833474322060763342167147939813379699113300579329884',
                '41747798356210327951828864606739475704670278732672411923226952550562810994269',
                '48797956882581040238328998452706637312526017192747728857965049344578930185689',
                '84075528317472161332110783338824603002333331699958015220146204384887016317460',
                '109137764198542875397010922573213806461038404637611535658969502477953977062158',
                '80035044963460208738839148866504952156311667250384896327472835098317653499856',
                '17617865953480899987668249746368539050669466120508322054265245207241748794585',
                '85801402425178001324027499648440415057772242639989974198794870373495420146359',
                '54552824519765246569647140014258846853726582476686673581485232345599309803850',
                '50071681440615794591592854304870967989140492470769568917917087979516067576429'
            ];

            const sampleIndexes = [
                3, 6, 6, 2, 2, 6, 1, 4, 5, 3, 3, 6, 2, 6, 0, 2, 6, 3, 6, 0, 2, 3, 5, 6, 5,
                4, 4, 5, 4, 6, 6, 4, 6, 2, 5, 4, 3, 3, 3, 5, 5, 4, 3, 0, 6, 2, 3, 6, 6, 2,
                4, 2, 6, 6, 0, 5, 6, 6, 6, 6, 6, 4, 6, 4, 5, 2, 6, 5, 3, 5, 3, 6, 3, 6, 2,
                1, 5, 4, 5, 5, 5, 1, 4, 6, 6, 6, 3, 4, 1, 3, 5, 4, 4, 4, 6, 4, 4, 2, 5, 6
            ];

            let results = new Array<bigint>();
            for (let i = 0; i < randomNumbers.length; i++) {
                const index = await validatorSetHbbft.getRandomIndex(
                    likelihood,
                    likelihoodSum,
                    randomNumbers[i]
                );
                results.push(index);
            }

            expect(results).to.deep.equal(sampleIndexes);
        });

        it('should always return an index within the input array size', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            for (let i = 0; i < 100; i++) {
                const size = random(19, 100);

                let likelihood = new Array<bigint>();
                let likelihoodSum = 0n;
                for (let j = 0; j < size; j++) {
                    const randomLikelihood = random(100, 1000);
                    likelihood.push(randomLikelihood);
                    likelihoodSum += randomLikelihood;
                }

                let currentSize = size;
                let randomNumber = random(0, Number.MAX_SAFE_INTEGER);

                for (let j = 0; j < size; j++) {
                    const index = (await validatorSetHbbft.getRandomIndex(
                        likelihood,
                        likelihoodSum,
                        randomNumber
                    ));

                    expect(index).to.be.lt(currentSize);

                    likelihoodSum -= likelihood[Number(index)];
                    likelihood[Number(index)] = likelihood[Number(currentSize - 1n)];
                    currentSize--;

                    randomNumber = BigInt(ethers.solidityPackedSha256(["uint256"], [randomNumber]))
                }
            }
        });
        /*
        it('should return indexes according to given likelihood', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const repeats = 2000;
            const maxFluctuation = 2; // percents, +/-

            const stakeAmounts = [
                170000, // 17%
                130000, // 13%
                10000,  // 1%
                210000, // 21%
                90000,  // 9%
                60000,  // 6%
                0,      // 0%
                100000, // 10%
                40000,  // 4%
                140000, // 14%
                30000,  // 3%
                0,      // 0%
                20000   // 2%
            ];

            const stakeAmountsTotal = stakeAmounts.reduce((accumulator, value) => accumulator + value);
            const stakeAmountsExpectedShares = stakeAmounts.map((value) =>
                BigNumber.from(value).mul(100).div(stakeAmountsTotal)
            );

            let indexesStats = stakeAmounts.map(() => 0);

            for (let i = 0; i < repeats; i++) {
                const index = await validatorSetHbbft.getRandomIndex(
                    stakeAmounts,
                    stakeAmountsTotal,
                    random(0, Number.MAX_SAFE_INTEGER)
                );
                indexesStats[index.toNumber()]++;
            }

            // const stakeAmountsRandomShares = indexesStats.map((value) => Math.round(value / repeats * 100));
            const stakeAmountsRandomShares = indexesStats.map((value) => BigNumber.from(value).mul(100).div(repeats));

            //console.log(stakeAmountsExpectedShares);
            //console.log(stakeAmountsRandomShares);

            stakeAmountsRandomShares.forEach((value, index) => {
                if (stakeAmountsExpectedShares[index].eq(0)) {
                    value.should.be.equal(0);
                } else {
                    stakeAmountsExpectedShares[index].sub(value).abs().should.be.most(maxFluctuation);
                }
            });
        });
        */

        it('should return indexes according to given likelihood', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const repeats = 2000;
            const maxFluctuation = 2; // percents, +/-

            const stakeAmounts = [
                170000n, // 17%
                130000n, // 13%
                10000n,  // 1%
                210000n, // 21%
                90000n,  // 9%
                60000n,  // 6%
                0n,      // 0%
                100000n, // 10%
                40000n,  // 4%
                140000n, // 14%
                30000n,  // 3%
                0n,      // 0%
                20000n   // 2%
            ];

            const stakeAmountsTotal = stakeAmounts.reduce((accumulator, value) => accumulator + value);
            const stakeAmountsExpectedShares = stakeAmounts.map((value) => Math.round(Number(value * 100n) / Number(stakeAmountsTotal)));
            let indexesStats = stakeAmounts.map(() => 0);

            for (let i = 0; i < repeats; i++) {
                const index = await validatorSetHbbft.getRandomIndex(
                    stakeAmounts,
                    stakeAmountsTotal,
                    random(0, Number.MAX_SAFE_INTEGER)
                );
                indexesStats[Number(index)]++;
            }

            const stakeAmountsRandomShares = indexesStats.map((value) => Math.round(value / repeats * 100));

            stakeAmountsRandomShares.forEach((value, index) => {
                if (stakeAmountsExpectedShares[index] == 0) {
                    expect(value).to.equal(0);
                } else {
                    expect(Math.abs(stakeAmountsExpectedShares[index] - value)).to.be.at.most(maxFluctuation);
                }
            });
        });
    });

    describe('getValidatorCountSweetSpot', async () => {
        it('hbbft sweet spots are calculated correct. getValidatorCountSweetSpot', async () => {
            const { validatorSetHbbft } = await helpers.loadFixture(deployContractsFixture);

            const expectedResults =
                [
                    1n, 2n, 3n,
                    4n, 4n, 4n,
                    7n, 7n, 7n,
                    10n, 10n, 10n,
                    13n, 13n, 13n,
                    16n, 16n, 16n,
                    19n, 19n, 19n,
                    22n, 22n, 22n,
                    25n
                ];

            for (let i = 0; i < expectedResults.length; i++) {
                const expected = expectedResults[i];
                const result = await validatorSetHbbft.getValidatorCountSweetSpot(i + 1);
                expect(result).to.equal(expected);
            }
        });
    });
});

function convertToBigEndian(number: number): Uint8Array {
    const byte1 = number & 0xFF;
    const byte2 = (number >> 8) & 0xFF;
    return new Uint8Array([byte2, byte1]);
}

interface InternetAddress {
    ipAddress: Uint8Array;
    port: bigint;
}

async function getValidatorInternetAddress(stakingHbbft: StakingHbbftMock, pool: string): Promise<InternetAddress> {

    const call_result = await stakingHbbft.getPoolInternetAddress(pool);
    const port = call_result[1];
    const ipArray = parseHexString(call_result[0]);

    return {
        ipAddress: ipArray,
        port: BigInt(port)
    }
}

function parseHexString(str: string): Uint8Array {
    // remove leading 0x if present.
    if (str.substring(0, 2) == "0x") {
        str = str.substring(2, str.length);
    }

    var result = [];
    while (str.length >= 2) {
        result.push(parseInt(str.substring(0, 2), 16));
        str = str.substring(2, str.length);
    }

    return new Uint8Array(result);
}

async function setValidatorInternetAddress(
    validatorSetPermission: Permission<ValidatorSetHbbftMock>,
    miner: string,
    ipAddress: Uint8Array,
    port: number
): Promise<TransactionResponse> {
    if (port > 65535) {
        throw new Error('Port number is too big');
    }

    // transform the Port number into a 2 bytes little endian number Array.
    let portArray = convertToBigEndian(port);
    return validatorSetPermission.callFunction("setValidatorInternetAddress", miner, [ipAddress, portArray]);
}
