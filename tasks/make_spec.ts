import utils from '../scripts/utils/utils';
import fs from 'fs';
// import dotenv from 'dotenv';
import path from 'path';
import assert from 'assert';

import { task } from "hardhat/config";

import { Contract } from "ethers";
import fp from 'lodash/fp';

const VALIDATOR_SET_CONTRACT = '0x1000000000000000000000000000000000000001';
const BLOCK_REWARD_CONTRACT = '0x2000000000000000000000000000000000000001';
const RANDOM_CONTRACT = '0x3000000000000000000000000000000000000001';
const STAKING_CONTRACT = '0x1100000000000000000000000000000000000001';
const PERMISSION_CONTRACT = '0x4000000000000000000000000000000000000001';
const CERTIFIER_CONTRACT = '0x5000000000000000000000000000000000000001';
const KEY_GEN_HISTORY_CONTRACT = '0x7000000000000000000000000000000000000001';



task("make_spec_hbbft", "used to make a spec file").addPositionalParam("initDataFile").addOptionalParam("useUpgradeProxy").setAction(async (taskArgs, hre) => {
    let useUpgradeProxy = true;
    const init_data_file = taskArgs.initDataFile;
    assert(init_data_file, "Path to contract initialization file required as first argument!");
    console.log(`Using init_data_file: ${init_data_file}`);

    if (taskArgs.useUpgradeProxy !== undefined) {
        useUpgradeProxy = taskArgs.useUpgradeProxy == 'true';
        console.log(`parsed ${taskArgs.useUpgradeProxy} as ${useUpgradeProxy}`);
    }

    const rawdata = fs.readFileSync(init_data_file);
    const init_data = JSON.parse(rawdata.toString());
    if (!process.env.NETWORK_NAME) {
        throw new Error("Please set your NETWORK_NAME in a .env file");
    }
    const networkName = process.env.NETWORK_NAME;
    if (!process.env.NETWORK_ID) {
        throw new Error("Please set your NETWORK_ID in a .env file");
    }
    const networkID = process.env.NETWORK_ID;
    if (!process.env.OWNER) {
        throw new Error("Please set your OWNER in a .env file");
    }
    const owner = process.env.OWNER.trim();
    let initialValidators = init_data.validators;
    for (let i = 0; i < initialValidators.length; i++) {
        initialValidators[i] = initialValidators[i].trim();
    }
    let stakingAddresses = init_data.staking_addresses;
    for (let i = 0; i < stakingAddresses.length; i++) {
        stakingAddresses[i] = stakingAddresses[i].trim();
    }
    const stakingEpochDuration = process.env.STAKING_EPOCH_DURATION;
    const stakeWithdrawDisallowPeriod = process.env.STAKE_WITHDRAW_DISALLOW_PERIOD;
    const stakingTransitionWindowLength = process.env.STAKING_TRANSITION_WINDOW_LENGTH;
    const stakingMinStakeForValidatorString = process.env.STAKING_MIN_STAKE_FOR_VALIDATOR;
    const stakingMinStakeForDelegatorString = process.env.STAKING_MIN_STAKE_FOR_DELEGATOR;

    let stakingMinStakeForValidator = hre.ethers.utils.parseEther('1');
    if (stakingMinStakeForValidatorString) {
        stakingMinStakeForValidator = hre.ethers.utils.parseEther(stakingMinStakeForValidatorString);
    }

    let stakingMinStakeForDelegator = hre.ethers.utils.parseEther('1');
    if (stakingMinStakeForDelegatorString) {
        stakingMinStakeForDelegator = hre.ethers.utils.parseEther(stakingMinStakeForDelegatorString);
    }

    let stakingMaxStakeForValidator = hre.ethers.utils.parseEther('50000');

    let stakingParams = [stakingMinStakeForDelegator, stakingMinStakeForValidator, stakingMaxStakeForValidator, stakingEpochDuration, stakingTransitionWindowLength, stakeWithdrawDisallowPeriod];

    let publicKeys = init_data.public_keys;
    for (let i = 0; i < publicKeys.length; i++) {
        publicKeys[i] = publicKeys[i].trim();
    }
    let publicKeysSplit = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])(publicKeys);

    let internetAddresses = init_data.ip_addresses;
    for (let i = 0; i < internetAddresses.length; i++) {
        internetAddresses[i] = internetAddresses[i].trim();
    }

    const contracts = [
        'AdminUpgradeabilityProxy',
        'BlockRewardHbbft',
        'CertifierHbbft',
        'InitializerHbbft',
        'KeyGenHistory',
        'RandomHbbft',
        'Registry',
        'StakingHbbft',
        'TxPermissionHbbft',
        'ValidatorSetHbbft'
    ];

    let spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'spec_hbbft.json'), 'utf-8'));

    spec.name = networkName;
    spec.params.networkID = networkID;
    const minimumBlockTime = Number.parseInt(process.env.MINIMUM_BLOCK_TIME ? process.env.MINIMUM_BLOCK_TIME : "0");
    if (minimumBlockTime > 0) {
        spec.engine.hbbft.params.minimumBlockTime = minimumBlockTime;
    }
    const maximumBlockTime = Number.parseInt(process.env.MAXIMUM_BLOCK_TIME ? process.env.MAXIMUM_BLOCK_TIME : "0");
    if (maximumBlockTime > 0) {
        spec.engine.hbbft.params.maximumBlockTime = maximumBlockTime;
    }

    let contractsCompiled: any = {};
    for (let i = 0; i < contracts.length; i++) {
        const contractName = contracts[i];
        let realContractName = contractName;
        let dir = 'contracts/';

        if (contractName == 'AdminUpgradeabilityProxy') {
            dir = 'contracts/upgradeability/';
        }
        // else if (contractName == 'StakingHbbft' && erc20Restricted) {
        //   realContractName = 'StakingHbbftCoins';
        //   dir = 'contracts/base/';
        // } else if (contractName == 'BlockRewardHbbft' && erc20Restricted) {
        //   realContractName = 'BlockRewardHbbftCoins';
        //   dir = 'contracts/base/';
        // }

        console.log(`Compiling ${contractName}...`);
        // const compiled = await compile(
        //     path.join(__dirname, '..', dir),
        //     realContractName
        // );
        const compiled = await hre.ethers.getContractFactory(contractName);
        contractsCompiled[contractName] = compiled;
    }

    const storageProxyCompiled = contractsCompiled['AdminUpgradeabilityProxy'];
    let contract = await hre.ethers.getContractFactory('AdminUpgradeabilityProxy');

    if (useUpgradeProxy) {

        // Build ValidatorSetHbbft contract
        spec.accounts[VALIDATOR_SET_CONTRACT] = {
            balance: '0',
            constructor: contract.interface.encodeDeploy(['0x1000000000000000000000000000000000000000', // implementation address
                owner,
                []])
        };

        spec.accounts['0x1000000000000000000000000000000000000000'] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['ValidatorSetHbbft'].bytecode
        };

        // Build StakingHbbft contract
        spec.accounts[STAKING_CONTRACT] = {
            balance: '0',
            constructor: contract.interface.encodeDeploy(['0x1100000000000000000000000000000000000000', // implementation address
                owner,
                []])
        };
        spec.accounts['0x1100000000000000000000000000000000000000'] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['StakingHbbft'].bytecode
        };

        // Build BlockRewardHbbft contract
        spec.accounts[BLOCK_REWARD_CONTRACT] = {
            balance: '0',
            constructor: contract.interface.encodeDeploy(['0x2000000000000000000000000000000000000000', // implementation address
                owner,
                []])
        };

        spec.engine.hbbft.params.blockRewardContractAddress = BLOCK_REWARD_CONTRACT;

        // spec.engine.hbbft.params.blockRewardContractTransition = 0;
        spec.accounts['0x2000000000000000000000000000000000000000'] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['BlockRewardHbbft'].bytecode
        };

        // Build RandomHbbft contract
        spec.accounts[RANDOM_CONTRACT] = {
            balance: '0',
            constructor: contract.interface.encodeDeploy(['0x3000000000000000000000000000000000000000', // implementation address
                owner,
                []])
        };
        spec.accounts['0x3000000000000000000000000000000000000000'] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['RandomHbbft'].bytecode
        };
        //spec.engine.hbbft.params.randomnessContractAddress = RANDOM_CONTRACT;

        // Build TxPermission contract
        spec.accounts[PERMISSION_CONTRACT] = {
            balance: '0',
            constructor: contract.interface.encodeDeploy(['0x4000000000000000000000000000000000000000', // implementation address
                owner,
                []])
        };
        spec.params.transactionPermissionContract = PERMISSION_CONTRACT;
        spec.params.transactionPermissionContractTransition = '0x0';

        spec.accounts['0x4000000000000000000000000000000000000000'] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['TxPermissionHbbft'].bytecode
        };

        // Build Certifier contract
        spec.accounts[CERTIFIER_CONTRACT] = {
            balance: '0',
            constructor: contract.interface.encodeDeploy(['0x5000000000000000000000000000000000000000', // implementation address
                owner,
                []])
        };
        spec.accounts['0x5000000000000000000000000000000000000000'] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['CertifierHbbft'].bytecode
        };

        // Build KeyGenHistory contract
        spec.accounts[KEY_GEN_HISTORY_CONTRACT] = {
            balance: '0',
            constructor: contract.interface.encodeDeploy(['0x7000000000000000000000000000000000000000', // implementation address
                owner,
                []])
        };


        spec.accounts['0x7000000000000000000000000000000000000000'] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['KeyGenHistory'].bytecode
        };

        // Build Registry contract
        contract = await hre.ethers.getContractFactory('Registry');
        spec.accounts['0x6000000000000000000000000000000000000000'] = {
            balance: '0',
            constructor: contract.interface.encodeDeploy([CERTIFIER_CONTRACT,
                owner])
        };
        spec.params.registrar = '0x6000000000000000000000000000000000000000';


    }
    else { // not useUpgradeProxy

        spec.accounts[VALIDATOR_SET_CONTRACT] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['ValidatorSetHbbft'].bytecode
        };

        spec.accounts[STAKING_CONTRACT] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['StakingHbbft'].bytecode
        };

        spec.accounts[BLOCK_REWARD_CONTRACT] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['BlockRewardHbbft'].bytecode
        };

        spec.engine.hbbft.params.blockRewardContractAddress = BLOCK_REWARD_CONTRACT;

        spec.accounts[RANDOM_CONTRACT] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['RandomHbbft'].bytecode
        };

        spec.accounts[PERMISSION_CONTRACT] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['TxPermissionHbbft'].bytecode
        };

        spec.params.transactionPermissionContract = PERMISSION_CONTRACT;
        spec.params.transactionPermissionContractTransition = '0x0';

        spec.accounts[CERTIFIER_CONTRACT] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['CertifierHbbft'].bytecode
        };

        // Build Registry contract
        contract = await hre.ethers.getContractFactory('Registry');

        spec.accounts['0x6000000000000000000000000000000000000000'] = {
            balance: '0',
            constructor: contract.interface.encodeDeploy([CERTIFIER_CONTRACT,
                owner])
        };
        spec.params.registrar = '0x6000000000000000000000000000000000000000';

        spec.accounts[KEY_GEN_HISTORY_CONTRACT] = {
            balance: '0',
            constructor: '0x' + contractsCompiled['KeyGenHistory'].bytecode
        };
    }


    // console.log(`InitializerHbbft constructor arguments:
    // contracts ${[ // _contracts
    //   VALIDATOR_SET_CONTRACT,
    //   BLOCK_REWARD_CONTRACT,
    //   RANDOM_CONTRACT,
    //   STAKING_CONTRACT,
    //   PERMISSION_CONTRACT,
    //   CERTIFIER_CONTRACT,
    //   KEY_GEN_HISTORY_CONTRACT
    // ]},
    // owner ${owner},
    // initialValidators ${initialValidators},
    // stakingAddresses ${stakingAddresses},
    // stakingParams ${stakingParams},
    // publicKeysSplit ${publicKeysSplit},
    // internetAddresses ${internetAddresses},
    // init_data.parts ${init_data.parts},
    // init_data.acks ${init_data.acks},
    // ethToWei ${ethToWei}`
    // );


    //console.log('const partsRaw = ', JSON.stringify(init_data.parts));
    //console.log('const acks = ', JSON.stringify(init_data.acks));

    //fixing parts.
    //there is a bug in web3-eth-abi handling byte arrays,
    //but buffer work fine.
    const newParts: Buffer[] = [];
    init_data.parts.forEach((x: string) => {
        newParts.push(Buffer.from(x));
    });

    init_data.parts = newParts;

    // Build InitializerHbbft contract
    contract = await hre.ethers.getContractFactory('InitializerHbbft');
    spec.accounts['0xFF00000000000000000000000000000000000000'] = {
        balance: '0',
        constructor: contract.interface.encodeDeploy([[ // _contracts
            VALIDATOR_SET_CONTRACT,
            BLOCK_REWARD_CONTRACT,
            RANDOM_CONTRACT,
            STAKING_CONTRACT,
            PERMISSION_CONTRACT,
            CERTIFIER_CONTRACT,
            KEY_GEN_HISTORY_CONTRACT
        ],
            owner, // _owner
            initialValidators, // _miningAddresses
            stakingAddresses, // _stakingAddresses
            stakingParams,
            publicKeysSplit,
            internetAddresses,
        init_data.parts,
        init_data.acks])
    };

    console.log('Using the following initial validators: ' + initialValidators);

    console.log('Saving spec_hbbft.json file ...');
    fs.writeFileSync(path.join(__dirname, '..', 'spec_hbbft.json'), JSON.stringify(spec, null, '  '), 'utf-8');
    console.log('Done');
}


)
// NETWORK_NAME=DPoSChain NETWORK_ID=101 OWNER=0x1092a1E3A3F2FB2024830Dd12064a4B33fF8EbAe INITIAL_VALIDATORS=0xeE385a1df869A468883107B0C06fA8791b28A04f,0x71385ae87c4b93db96f02f952be1f7a63f6057a6,0x190ec582090ae24284989af812f6b2c93f768ecd STAKING_ADDRESSES=0xe5aa2949ac94896bb2c5c75d9d5a88eb9f7c6b59,0x63a9344ae66c1f26d400b3ea4750a709c3aa6cfa,0xa5f6858d6254329a67cddab2dc04d795c5257709 STAKING_EPOCH_DURATION=120954 STAKE_WITHDRAW_DISALLOW_PERIOD=4320 PUBLIC_KEYS=0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee,0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845,0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56 IP_ADDRESSES=0x11111111111111111111111111111111,0x22222222222222222222222222222222,0x33333333333333333333333333333333 node scripts/make_spec_hbbft.js
