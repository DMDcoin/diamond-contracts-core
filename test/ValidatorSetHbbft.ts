import { ethers, network, upgrades } from "hardhat";

import {
    BlockRewardHbbftCoinsMock,
    AdminUpgradeabilityProxy,
    RandomHbbftMock,
    ValidatorSetHbbftMock,
    StakingHbbftCoinsMock,
    KeyGenHistory,
    IStakingHbbft
} from "../src/types";

import fp from 'lodash/fp';
import { BigNumber} from "ethers";
import { TransactionResponse } from '@ethersproject/providers'
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Permission } from "./testhelpers/Permission";

require('chai')
    .use(require('chai-as-promised'))
    .use(require('chai-bn')(BigNumber))
    .should();

// delegatecall are a problem for truffle debugger
// therefore it makes sense to use a proxy for automated testing to have the proxy testet.
// and to not use it if specific transactions needs to get debugged,
// like truffle `debug 0xabc`.
const useUpgradeProxy = !(process.env.CONTRACTS_NO_UPGRADE_PROXY == 'true');
console.log('useUpgradeProxy:', useUpgradeProxy);

//smart contracts
let blockRewardHbbft: BlockRewardHbbftCoinsMock;
let adminUpgradeabilityProxy: AdminUpgradeabilityProxy;
let validatorSetHbbft: ValidatorSetHbbftMock;
let vaidatorSetPermission: Permission<ValidatorSetHbbftMock>
let stakingHbbft: StakingHbbftCoinsMock;
let keyGenHistory: KeyGenHistory;

//addresses
let owner: SignerWithAddress;
let accounts: SignerWithAddress[];
let initialValidatorsPubKeys: string[];
let initialValidatorsIpAddresses: string[];

//consts
// one epoch in 1 day.
const stakingFixedEpochDuration = BigNumber.from(86400);
// the transition time window is 1 hour.
const stakingTransitionTimeframeLength = BigNumber.from(3600);
const stakingWithdrawDisallowPeriod = BigNumber.from(1);

describe('ValidatorSetHbbft', () => {

    beforeEach(async () => {
        [owner, ...accounts] = await ethers.getSigners();

        const AdminUpgradeabilityProxyFactory = await ethers.getContractFactory("AdminUpgradeabilityProxy")

        // Deploy ValidatorSet contract
        const ValidatorSetFactory = await ethers.getContractFactory("ValidatorSetHbbftMock");
        validatorSetHbbft = await ValidatorSetFactory.deploy() as ValidatorSetHbbftMock;
        if (useUpgradeProxy) {
            adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(validatorSetHbbft.address, owner.address, []);
            validatorSetHbbft = await ethers.getContractAt("ValidatorSetHbbftMock", adminUpgradeabilityProxy.address);
        }

        // Deploy TxPermission contract
        const TxPermissionFactory = await ethers.getContractFactory("TxPermissionHbbft");
        let txPermission = await TxPermissionFactory.deploy();
        if (useUpgradeProxy) {
            adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(txPermission.address, owner.address, []);
            txPermission = await ethers.getContractAt("TxPermissionHbbft", adminUpgradeabilityProxy.address);
        }

        vaidatorSetPermission = new Permission(txPermission, validatorSetHbbft);

        // Deploy BlockRewardHbbft contract
        const BlockRewardHbbftFactory = await ethers.getContractFactory("BlockRewardHbbftCoinsMock");
        blockRewardHbbft = await BlockRewardHbbftFactory.deploy() as BlockRewardHbbftCoinsMock;
        if (useUpgradeProxy) {
            adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(blockRewardHbbft.address, owner.address, []);
            blockRewardHbbft = await ethers.getContractAt("BlockRewardHbbftCoinsMock", adminUpgradeabilityProxy.address);
        }

        // Deploy BlockRewardHbbft contract
        const StakingHbbftFactory = await ethers.getContractFactory("StakingHbbftCoinsMock");
        stakingHbbft = await StakingHbbftFactory.deploy() as StakingHbbftCoinsMock;
        if (useUpgradeProxy) {
            adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(stakingHbbft.address, owner.address, []);
            stakingHbbft = await ethers.getContractAt("StakingHbbftCoinsMock", adminUpgradeabilityProxy.address);
        }

        await increaseTime(1);

        // The following private keys belong to the accounts 1-3, fixed by using the "--mnemonic" option when starting ganache.
        // const initialValidatorsPrivKeys = ["0x272b8400a202c08e23641b53368d603e5fec5c13ea2f438bce291f7be63a02a7", "0xa8ea110ffc8fe68a069c8a460ad6b9698b09e21ad5503285f633b3ad79076cf7", "0x5da461ff1378256f69cb9a9d0a8b370c97c460acbe88f5d897cb17209f891ffc"];
        // Public keys corresponding to the three private keys above.
        initialValidatorsPubKeys = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])
            (['0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee',
                '0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845',
                '0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56']);
        // The IP addresses are irrelevant for these unit test, just initialize them to 0.
        initialValidatorsIpAddresses = ['0x00000000000000000000000000000000', '0x00000000000000000000000000000000', '0x00000000000000000000000000000000'];
    });

    describe('initialize()', async () => {
        let initialValidators: string[];
        let initialStakingAddresses: string[];
        const accountAddresses = accounts.map(item => item.address);

        beforeEach(async () => {
            initialValidators = accountAddresses.slice(1, 3 + 1); // accounts[1...3]
            initialStakingAddresses = accountAddresses.slice(4, 6 + 1); // accounts[4...6]
            initialValidators.length.should.be.equal(3);
            initialValidators[0].should.not.be.equal('0x0000000000000000000000000000000000000000');
            initialValidators[1].should.not.be.equal('0x0000000000000000000000000000000000000000');
            initialValidators[2].should.not.be.equal('0x0000000000000000000000000000000000000000');
        });
        it('should initialize successfully', async () => {
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.fulfilled;
            blockRewardHbbft.address.should.be.equal(
                await validatorSetHbbft.blockRewardContract()
            );
            '0x3000000000000000000000000000000000000001'.should.be.equal(
                await validatorSetHbbft.randomContract()
            );
            stakingHbbft.address.should.be.equal(
                await validatorSetHbbft.getStakingContract()
            );
            '0x8000000000000000000000000000000000000001'.should.be.equal(
                await validatorSetHbbft.keyGenHistoryContract()
            );
            (await validatorSetHbbft.getValidators()).should.be.deep.equal(initialValidators);
            (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(0);
            for (let i = 0; i < initialValidators.length; i++) {
                true.should.be.equal(
                    await validatorSetHbbft.isValidator(initialValidators[i])
                );
                (await validatorSetHbbft.miningByStakingAddress(initialStakingAddresses[i])).should.be.equal(initialValidators[i]);
                (await validatorSetHbbft.stakingByMiningAddress(initialValidators[i])).should.be.equal(initialStakingAddresses[i]);
            }
            false.should.be.equal(
                await validatorSetHbbft.isValidator('0x0000000000000000000000000000000000000000')
            );
        });

        it('should fail if initialization is not done on the genesis block and sender is not admin', async () => {
            if (useUpgradeProxy) { //this test only works if using the upgrade proxy.
                await validatorSetHbbft.connect(accounts[1]).initialize(
                    blockRewardHbbft.address, // _blockRewardContract
                    '0x3000000000000000000000000000000000000001', // _randomContract
                    stakingHbbft.address, // _stakingContract
                    '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                    initialValidators, // _initialMiningAddresses
                    initialStakingAddresses // _initialStakingAddresses
                ).should.be.rejectedWith("Initialization only on genesis block or by admin");
            }
        });

        it('should initialize successfully if not done on genesis block but sender is admin', async () => {
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.fulfilled;
        });
        it('should fail if BlockRewardHbbft contract address is zero', async () => {
            await validatorSetHbbft.initialize(
                '0x0000000000000000000000000000000000000000', // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("BlockReward contract address can't be 0");
        });
        it('should fail if RandomHbbft contract address is zero', async () => {
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x0000000000000000000000000000000000000000', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("Random contract address can't be 0");
        });
        it('should fail if StakingHbbft contract address is zero', async () => {
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                '0x0000000000000000000000000000000000000000', // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses

            ).should.be.rejectedWith("Staking contract address can't be 0");
        });
        it('should fail if KeyGenHistory contract address is zero', async () => {
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                '0x0000000000000000000000000000000000000001', // _stakingContract
                '0x0000000000000000000000000000000000000000', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("KeyGenHistory contract address can't be 0");
        });
        it('should fail if initial mining addresses are empty', async () => {
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                [], // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("Must provide initial mining addresses");
        });
        it('should fail if already initialized', async () => {
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.fulfilled;
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("ValidatorSet contract is already initialized");
        });
        it('should fail if the number of mining addresses is not the same as the number of staking ones', async () => {
            const initialStakingAddressesShort = accountAddresses.slice(4, 5 + 1); // accounts[4...5]
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddressesShort, // _initialStakingAddresses
            ).should.be.rejectedWith("Must provide the same amount of mining/staking addresses");
        });
        it('should fail if the mining addresses are the same as the staking ones', async () => {
            const initialStakingAddressesShort = accounts.slice(4, 5 + 1); // accounts[4...5]
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialValidators, // _initialStakingAddresses
            ).should.be.rejectedWith("Mining address cannot be the same as the staking one");
        });
        it('should fail if some mining address is 0', async () => {
            initialValidators[0] = '0x0000000000000000000000000000000000000000';
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("Mining address can't be 0");
        });
        it('should fail if some staking address is 0', async () => {
            initialStakingAddresses[0] = '0x0000000000000000000000000000000000000000';
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("Staking address can't be 0");
        });
        it('should fail if a staking address is currently being used as a staking one', async () => {
            initialStakingAddresses[1] = initialStakingAddresses[0];
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("Staking address already used as a staking one");
        });
        it('should fail if a mining address is currently being used as a staking one', async () => {
            initialValidators[1] = initialStakingAddresses[0];
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("Mining address already used as a staking one");
        });
        it('should fail if a staking address is currently being used as a mining one', async () => {
            initialStakingAddresses[1] = initialValidators[0];
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("Staking address already used as a mining one");
        });
        it('should fail if a mining address is currently being used as a mining one', async () => {
            initialValidators[1] = initialValidators[0];
            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                '0x3000000000000000000000000000000000000001', // _randomContract
                stakingHbbft.address, // _stakingContract
                '0x8000000000000000000000000000000000000001', //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.rejectedWith("Mining address already used as a mining one");
        });
    });

    describe('newValidatorSet()', async () => {
        let initialValidators: string[];
        let initialStakingAddresses: string[];
        let randomHbbft: RandomHbbftMock;
        const accountAddresses = accounts.map(item => item.address);



        beforeEach(async () => {
            initialValidators = accountAddresses.slice(1, 3 + 1); // accounts[1...3]
            initialStakingAddresses = accountAddresses.slice(4, 6 + 1); // accounts[4...6]

            const AdminUpgradeabilityProxyFactory = await ethers.getContractFactory("AdminUpgradeabilityProxy")

            const RandomHbbftFactory = await ethers.getContractFactory("RandomHbbftMock");
            randomHbbft = await RandomHbbftFactory.deploy() as RandomHbbftMock;
            if (useUpgradeProxy) {
                adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(randomHbbft.address, owner.address, []);
                randomHbbft = await ethers.getContractAt("RandomHbbftMock", adminUpgradeabilityProxy.address);
            }

            const KeyGenFactory = await ethers.getContractFactory("KeyGenHistory");
            keyGenHistory = await KeyGenFactory.deploy() as KeyGenHistory;
            if (useUpgradeProxy) {
                adminUpgradeabilityProxy = await AdminUpgradeabilityProxyFactory.deploy(keyGenHistory.address, owner.address, []);
                keyGenHistory = await ethers.getContractAt("KeyGenHistory", adminUpgradeabilityProxy.address);
            }

            await validatorSetHbbft.initialize(
                blockRewardHbbft.address, // _blockRewardContract
                randomHbbft.address, // _randomContract
                stakingHbbft.address, // _stakingContract
                keyGenHistory.address, //_keyGenHistoryContract
                initialValidators, // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ).should.be.fulfilled;

            let structure: IStakingHbbft.StakingParamsStruct = {
                _validatorSetContract: validatorSetHbbft.address,
                _initialStakingAddresses: initialStakingAddresses,
                _delegatorMinStake: ethers.utils.parseEther('1'),
                _candidateMinStake: ethers.utils.parseEther('1'),
                _maxStake: ethers.utils.parseEther('100000'),
                _stakingFixedEpochDuration: stakingFixedEpochDuration,
                _stakingTransitionTimeframeLength: stakingTransitionTimeframeLength,
                _stakingWithdrawDisallowPeriod: stakingWithdrawDisallowPeriod
            };

            await stakingHbbft.initialize(
                structure,
                initialValidatorsPubKeys, // _publicKeys
                initialValidatorsIpAddresses // _internetAddresses
            ).should.be.fulfilled;
            await keyGenHistory.initialize(validatorSetHbbft.address, initialValidators, [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 181, 129, 31, 84, 186, 242, 5, 151, 59, 35, 196, 140, 106, 29, 40, 112, 142, 156, 132, 158, 47, 223, 253, 185, 227, 249, 190, 96, 5, 99, 239, 213, 127, 29, 136, 115, 71, 164, 202, 44, 6, 171, 131, 251, 147, 159, 54, 49, 1, 0, 0, 0, 0, 0, 0, 0, 153, 0, 0, 0, 0, 0, 0, 0, 4, 177, 133, 61, 18, 58, 222, 74, 65, 5, 126, 253, 181, 113, 165, 43, 141, 56, 226, 132, 208, 218, 197, 119, 179, 128, 30, 162, 251, 23, 33, 73, 38, 120, 246, 223, 233, 11, 104, 60, 154, 241, 182, 147, 219, 81, 45, 134, 239, 69, 169, 198, 188, 152, 95, 254, 170, 108, 60, 166, 107, 254, 204, 195, 170, 234, 154, 134, 26, 91, 9, 139, 174, 178, 248, 60, 65, 196, 218, 46, 163, 218, 72, 1, 98, 12, 109, 186, 152, 148, 159, 121, 254, 34, 112, 51, 70, 121, 51, 167, 35, 240, 5, 134, 197, 125, 252, 3, 213, 84, 70, 176, 160, 36, 73, 140, 104, 92, 117, 184, 80, 26, 240, 106, 230, 241, 26, 79, 46, 241, 195, 20, 106, 12, 186, 49, 254, 168, 233, 25, 179, 96, 62, 104, 118, 153, 95, 53, 127, 160, 237, 246, 41], [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 181, 129, 31, 84, 186, 242, 5, 151, 59, 35, 196, 140, 106, 29, 40, 112, 142, 156, 132, 158, 47, 223, 253, 185, 227, 249, 190, 96, 5, 99, 239, 213, 127, 29, 136, 115, 71, 164, 202, 44, 6, 171, 131, 251, 147, 159, 54, 49, 1, 0, 0, 0, 0, 0, 0, 0, 153, 0, 0, 0, 0, 0, 0, 0, 4, 177, 133, 61, 18, 58, 222, 74, 65, 5, 126, 253, 181, 113, 165, 43, 141, 56, 226, 132, 208, 218, 197, 119, 179, 128, 30, 162, 251, 23, 33, 73, 38, 120, 246, 223, 233, 11, 104, 60, 154, 241, 182, 147, 219, 81, 45, 134, 239, 69, 169, 198, 188, 152, 95, 254, 170, 108, 60, 166, 107, 254, 204, 195, 170, 234, 154, 134, 26, 91, 9, 139, 174, 178, 248, 60, 65, 196, 218, 46, 163, 218, 72, 1, 98, 12, 109, 186, 152, 148, 159, 121, 254, 34, 112, 51, 70, 121, 51, 167, 35, 240, 5, 134, 197, 125, 252, 3, 213, 84, 70, 176, 160, 36, 73, 140, 104, 92, 117, 184, 80, 26, 240, 106, 230, 241, 26, 79, 46, 241, 195, 20, 106, 12, 186, 49, 254, 168, 233, 25, 179, 96, 62, 104, 118, 153, 95, 53, 127, 160, 237, 246, 41], [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 181, 129, 31, 84, 186, 242, 5, 151, 59, 35, 196, 140, 106, 29, 40, 112, 142, 156, 132, 158, 47, 223, 253, 185, 227, 249, 190, 96, 5, 99, 239, 213, 127, 29, 136, 115, 71, 164, 202, 44, 6, 171, 131, 251, 147, 159, 54, 49, 1, 0, 0, 0, 0, 0, 0, 0, 153, 0, 0, 0, 0, 0, 0, 0, 4, 177, 133, 61, 18, 58, 222, 74, 65, 5, 126, 253, 181, 113, 165, 43, 141, 56, 226, 132, 208, 218, 197, 119, 179, 128, 30, 162, 251, 23, 33, 73, 38, 120, 246, 223, 233, 11, 104, 60, 154, 241, 182, 147, 219, 81, 45, 134, 239, 69, 169, 198, 188, 152, 95, 254, 170, 108, 60, 166, 107, 254, 204, 195, 170, 234, 154, 134, 26, 91, 9, 139, 174, 178, 248, 60, 65, 196, 218, 46, 163, 218, 72, 1, 98, 12, 109, 186, 152, 148, 159, 121, 254, 34, 112, 51, 70, 121, 51, 167, 35, 240, 5, 134, 197, 125, 252, 3, 213, 84, 70, 176, 160, 36, 73, 140, 104, 92, 117, 184, 80, 26, 240, 106, 230, 241, 26, 79, 46, 241, 195, 20, 106, 12, 186, 49, 254, 168, 233, 25, 179, 96, 62, 104, 118, 153, 95, 53, 127, 160, 237, 246, 41]],
                [[[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 4, 239, 1, 112, 13, 13, 251, 103, 186, 212, 78, 44, 47, 250, 221, 84, 118, 88, 7, 64, 206, 186, 11, 2, 8, 204, 140, 106, 179, 52, 251, 237, 19, 53, 74, 187, 217, 134, 94, 66, 68, 89, 42, 85, 207, 155, 220, 101, 223, 51, 199, 37, 38, 203, 132, 13, 77, 78, 114, 53, 219, 114, 93, 21, 25, 164, 12, 43, 252, 160, 16, 23, 111, 79, 230, 121, 95, 223, 174, 211, 172, 231, 0, 52, 25, 49, 152, 79, 128, 39, 117, 216, 85, 201, 237, 242, 151, 219, 149, 214, 77, 233, 145, 47, 10, 184, 175, 162, 174, 237, 177, 131, 45, 126, 231, 32, 147, 227, 170, 125, 133, 36, 123, 164, 232, 129, 135, 196, 136, 186, 45, 73, 226, 179, 169, 147, 42, 41, 140, 202, 191, 12, 73, 146, 2]], [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 4, 239, 1, 112, 13, 13, 251, 103, 186, 212, 78, 44, 47, 250, 221, 84, 118, 88, 7, 64, 206, 186, 11, 2, 8, 204, 140, 106, 179, 52, 251, 237, 19, 53, 74, 187, 217, 134, 94, 66, 68, 89, 42, 85, 207, 155, 220, 101, 223, 51, 199, 37, 38, 203, 132, 13, 77, 78, 114, 53, 219, 114, 93, 21, 25, 164, 12, 43, 252, 160, 16, 23, 111, 79, 230, 121, 95, 223, 174, 211, 172, 231, 0, 52, 25, 49, 152, 79, 128, 39, 117, 216, 85, 201, 237, 242, 151, 219, 149, 214, 77, 233, 145, 47, 10, 184, 175, 162, 174, 237, 177, 131, 45, 126, 231, 32, 147, 227, 170, 125, 133, 36, 123, 164, 232, 129, 135, 196, 136, 186, 45, 73, 226, 179, 169, 147, 42, 41, 140, 202, 191, 12, 73, 146, 2]], [[0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 145, 0, 0, 0, 0, 0, 0, 0, 4, 239, 1, 112, 13, 13, 251, 103, 186, 212, 78, 44, 47, 250, 221, 84, 118, 88, 7, 64, 206, 186, 11, 2, 8, 204, 140, 106, 179, 52, 251, 237, 19, 53, 74, 187, 217, 134, 94, 66, 68, 89, 42, 85, 207, 155, 220, 101, 223, 51, 199, 37, 38, 203, 132, 13, 77, 78, 114, 53, 219, 114, 93, 21, 25, 164, 12, 43, 252, 160, 16, 23, 111, 79, 230, 121, 95, 223, 174, 211, 172, 231, 0, 52, 25, 49, 152, 79, 128, 39, 117, 216, 85, 201, 237, 242, 151, 219, 149, 214, 77, 233, 145, 47, 10, 184, 175, 162, 174, 237, 177, 131, 45, 126, 231, 32, 147, 227, 170, 125, 133, 36, 123, 164, 232, 129, 135, 196, 136, 186, 45, 73, 226, 179, 169, 147, 42, 41, 140, 202, 191, 12, 73, 146, 2]]]
            ).should.be.fulfilled;
        });
        it('can only be called by BlockReward contract', async () => {
            await validatorSetHbbft.connect(owner).newValidatorSet().should.be.rejectedWith("Only BlockReward contract");
            await validatorSetHbbft.setBlockRewardContract(accounts[4].address).should.be.fulfilled;
            await validatorSetHbbft.connect(accounts[4]).newValidatorSet().should.be.fulfilled;
        });
        it('should enqueue all initial validators (active pools) if there is no staking', async () => {

            // Check the returned value of the pending validators; it should be an empty list
            (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(0);

            // Emulate calling `newValidatorSet()` at the last block of the fixed epoch duration
            await validatorSetHbbft.setBlockRewardContract(accounts[4].address).should.be.fulfilled;
            await validatorSetHbbft.connect(accounts[4]).newValidatorSet().should.be.fulfilled;

            // Check the returned value of the pending validators; it should be an empty list
            (await validatorSetHbbft.getPendingValidators()).length.should.be.equal(3);
            (await validatorSetHbbft.getPendingValidators()).should.be.deep.equal(initialValidators);
        });
        it('should enqueue only one validator which has non-empty pool', async () => {

            // Emulate staking: the first validator stakes into their own pool
            const stakeAmount = BigNumber.from(ethers.utils.parseEther('1'));
            await stakingHbbft.connect(await ethers.getSigner(initialStakingAddresses[0])).stake(initialStakingAddresses[0], { value: stakeAmount }).should.be.fulfilled;
            stakeAmount.should.be.equal(await stakingHbbft.stakeAmount(initialStakingAddresses[0], initialStakingAddresses[0]));

            // Emulate calling `newValidatorSet()` at the last block of the fixed epoch duration
            await validatorSetHbbft.setBlockRewardContract(accounts[4].address).should.be.fulfilled;
            await validatorSetHbbft.connect(accounts[4]).newValidatorSet().should.be.fulfilled;

            // Check the returned value of `getPendingValidators()`
            (await validatorSetHbbft.getPendingValidators()).should.be.deep.equal([initialValidators[0]]);
        });
        it('should choose validators randomly', async () => {
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

            const stakeUnit = BigNumber.from(ethers.utils.parseEther('1'));

            // Emulate staking by the candidates into their own pool
            for (let i = 0; i < stakingAddresses.length; i++) {
                const stakeAmount = stakeUnit.mul(BigNumber.from(i + 1));
                await stakingHbbft.connect(await ethers.getSigner(stakingAddresses[i])).addPool(
                    miningAddresses[i],
                    '0x00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
                    '0x00000000000000000000000000000000',
                    { value: stakeAmount }
                ).should.be.fulfilled;
                stakeAmount.should.be.equal(await stakingHbbft.stakeAmount(stakingAddresses[i], stakingAddresses[i]));
            }

            // Check pools of the new candidates
            (await stakingHbbft.getPoolsToBeElected()).should.be.deep.equal(stakingAddresses);
            const poolsLikelihood = await stakingHbbft.getPoolsLikelihood();
            let likelihoodSum = BigNumber.from(0);
            for (let i = 0; i < stakingAddresses.length; i++) {
                const poolLikelihood = stakeUnit.mul(BigNumber.from(i + 1));
                poolsLikelihood[0][i].should.be.equal(BigNumber.from(poolLikelihood));
                likelihoodSum = likelihoodSum.add(poolLikelihood);
            }
            poolsLikelihood[1].should.be.equal(BigNumber.from(likelihoodSum));

            // Generate a random seed
            (await randomHbbft.currentSeed()).should.be.equal(BigNumber.from(0));

            const seed = random(1000000, 2000000);
            await randomHbbft.setSystemAddress(owner.address).should.be.fulfilled;
            await randomHbbft.connect(owner).setCurrentSeed(BigNumber.from(seed)).should.be.fulfilled;
            await randomHbbft.setSystemAddress('0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE').should.be.fulfilled;
            (await randomHbbft.currentSeed()).should.be.equal(BigNumber.from(seed));

            // Emulate calling `newValidatorSet()` at the last block of the staking epoch
            await validatorSetHbbft.setBlockRewardContract(accounts[4].address).should.be.fulfilled;
            await validatorSetHbbft.connect(accounts[4]).newValidatorSet().should.be.fulfilled;

            const newValidators = await validatorSetHbbft.getPendingValidators();

            newValidators.length.should.be.equal((await validatorSetHbbft.maxValidators()).toNumber());

            for (let i = 0; i < newValidators.length; i++) {
                miningAddresses.indexOf(newValidators[i].toLowerCase()).should.be.gte(0);
            }
        });
    });

    describe('_getRandomIndex()', async () => {
        it('should return an adjusted index for defined inputs', async () => {
            const likelihood = [100, 200, 300, 400, 500, 600, 700];
            const likelihoodSum = 2800;

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

            let results = [];
            for (let i = 0; i < randomNumbers.length; i++) {
                const index = await validatorSetHbbft.getRandomIndex(
                    likelihood,
                    likelihoodSum,
                    randomNumbers[i]
                );
                results.push(index.toNumber());
            }

            results.should.be.deep.equal(sampleIndexes);
        });

        it('should always return an index within the input array size', async () => {
            for (let i = 0; i < 100; i++) {
                const size = random(19, 100);

                let likelihood = [];
                let likelihoodSum = 0;
                for (let j = 0; j < size; j++) {
                    const randomLikelihood = random(100, 1000);
                    likelihood.push(randomLikelihood);
                    likelihoodSum += randomLikelihood;
                }

                let currentSize = size;
                let randomNumber = BigNumber.from(random(0, Number.MAX_SAFE_INTEGER));
                for (let j = 0; j < size; j++) {
                    const index: BigNumber = (await validatorSetHbbft.getRandomIndex(
                        likelihood,
                        likelihoodSum,
                        randomNumber
                    ));
                    (index.lt(currentSize)).should.be.equal(true);
                    likelihoodSum -= likelihood[index.toNumber()];
                    likelihood[index.toNumber()] = likelihood[currentSize - 1];
                    currentSize--;
                    randomNumber = BigNumber.from(ethers.utils.soliditySha256(["uint256"], [randomNumber]))
                }
            }
        });

        it('should return indexes according to given likelihood', async () => {
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
            const stakeAmountsExpectedShares = stakeAmounts.map((value) => (value / stakeAmountsTotal * 100));
            let indexesStats = stakeAmounts.map(() => 0);

            for (let i = 0; i < repeats; i++) {
                const index = await validatorSetHbbft.getRandomIndex(
                    stakeAmounts,
                    stakeAmountsTotal,
                    random(0, Number.MAX_SAFE_INTEGER)
                );
                indexesStats[index.toNumber()]++;
            }

            const stakeAmountsRandomShares = indexesStats.map((value) => Math.round(value / repeats * 100));

            //console.log(stakeAmountsExpectedShares);
            //console.log(stakeAmountsRandomShares);

            stakeAmountsRandomShares.forEach((value, index) => {
                if (stakeAmountsExpectedShares[index] == 0) {
                    value.should.be.equal(0);
                } else {
                    Math.abs(stakeAmountsExpectedShares[index] - value).should.be.most(maxFluctuation);
                }
            });
        });
    });

    describe('getValidatorCountSweetSpot()', async() => {
        it('hbbft sweet spots are calculated correct. getValidatorCountSweetSpot', async () => {

            const expectedResults =
                [1, 2, 3,
                    4, 4, 4,
                    7, 7, 7,
                    10, 10, 10,
                    13, 13, 13,
                    16, 16, 16,
                    19, 19, 19,
                    22, 22, 22,
                    25
                ];

            for (let i = 0; i < expectedResults.length; i++) {
                const expected = expectedResults[i];
                const result = await validatorSetHbbft.getValidatorCountSweetSpot(i + 1);
                // console.log(`i: ${i}, expected: ${expected}, result: ${result}`);
                BigNumber.from(result).should.be.equal(BigNumber.from(expected));
            }

        });

    });

    describe('setValidatorInternetAddress()', async() => { 

        it('Validator Candidates can write and read their IP Address', async () => {


            
            // 4 test pools
            let initialValidators = accounts.slice(1,5);
            let initialPoolAddresses = accounts.slice(5,9);

            stakingHbbft.connect(initialPoolAddresses[0].address);
            await stakingHbbft.addPool(initialValidators[0].address, [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1], [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]);

            // stakingHbbft.addPool()

            const pools = await stakingHbbft.getPools();
            pools.length.should.be.not.equal(0);
            let ip_last = 1;
            //const activePools = [];
            for (let pool of pools) {
                
                if (await stakingHbbft.isPoolActive(pool)) {
                    
                    const address = [192, 168, 0, ip_last];
                    const port =  30303;
                    console.log(`Setting IP address for pool ${pool} to ${address}`);
                    await setValidatorInternetAddress(pool, address, port);

                    const writtenIP = await getValidatorInternetAddress(pool);

                    writtenIP.ipAddress.should.be.deep.equal(address);
                    writtenIP.port.should.be.equal(port);
                }
                ip_last++;
            }
        });
    });

    function convertToLittleEndian(number: number): number[] {
        const byte1 = number & 0xFF;
        const byte2 = (number >> 8) & 0xFF;
        return [byte1, byte2];
    }
    
    interface InternetAddress {
        ipAddress: number[];
        port: number;
    }

    async function getValidatorInternetAddress(pool: string) : Promise<InternetAddress> {

        const call_result = await stakingHbbft.getPoolInternetAddress(pool);
        const portBN = BigNumber.from(call_result[1]);
        const ipArray = parseHexString(call_result[0]);

        return {
            ipAddress: [ipArray[12], ipArray[13], ipArray[14], ipArray[15]],
            port: portBN.toNumber()
        }
    }

    function parseHexString(str: string) : number[] { 
        var result = [];
        while (str.length >= 2) { 
            result.push(parseInt(str.substring(0, 2), 16));
            str = str.substring(2, str.length);
        }
    
        return result;
    }

    async function setValidatorInternetAddress(pool: string, ipAddress: number[], port: number) : Promise<TransactionResponse> {

        if (port > 65535) {
            throw new Error('Port number is too big');
        }

        // transform the Port number into a 2 bytes little endian number Array.
        let portArray = convertToLittleEndian(port);
        return vaidatorSetPermission.callFunction("setValidatorInternetAddress", pool, [ipAddress, portArray]);
    }

    async function increaseTime(time: number) {

        const currentTimestamp = await validatorSetHbbft.getCurrentTimestamp();
        const futureTimestamp = currentTimestamp.add(BigNumber.from(time));
        await validatorSetHbbft.setCurrentTimestamp(futureTimestamp);
        const currentTimestampAfter = await validatorSetHbbft.getCurrentTimestamp();
        futureTimestamp.should.be.equal(currentTimestampAfter);
    }
});

function random(low: number, high: number) {
    return Math.floor((Math.random() * (high - low) + low));
}
