import fs from 'fs';
import path from 'path';
import fp from 'lodash/fp';
import "@nomiclabs/hardhat-ethers";
import { task } from "hardhat/config";

import { InitialContractsConfiguration } from './types';

const ProxyContractName = "TransparentUpgradeableProxy";

function getInitialContracts(fileName: string) {
    const rawData = fs.readFileSync(fileName);
    const jsonData = JSON.parse(rawData.toString());

    return InitialContractsConfiguration.from(jsonData);
}

task("make_spec_hbbft", "used to make a spec file")
    .addParam("initContracts", "Initial contracts configuration file")
    .addFlag("useUpgradeProxy", "Upgradeable proxy support")
    .addPositionalParam("initDataFile", "Initial spec configuration file")
    .setAction(async (taskArgs, hre) => {
        console.log("Using upgrade proxy: ", taskArgs.useUpgradeProxy)
        console.log("Using initial data file: ", taskArgs.initDataFile);
        console.log("Using initial contracts file: ", taskArgs.initContracts);

        const rawdata = fs.readFileSync(taskArgs.initDataFile);
        const init_data = JSON.parse(rawdata.toString());

        const initialContracts = getInitialContracts(taskArgs.initContracts);

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

        let stakingParams = [
            stakingMinStakeForDelegator,
            stakingMinStakeForValidator,
            stakingMaxStakeForValidator,
            stakingEpochDuration,
            stakingTransitionWindowLength,
            stakeWithdrawDisallowPeriod
        ];

        let publicKeys = init_data.public_keys;
        for (let i = 0; i < publicKeys.length; i++) {
            publicKeys[i] = publicKeys[i].trim();
        }
        let publicKeysSplit = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])(publicKeys);

        let internetAddresses = init_data.ip_addresses;
        for (let i = 0; i < internetAddresses.length; i++) {
            internetAddresses[i] = internetAddresses[i].trim();
        }

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

        for (let i = 0; i < initialContracts.core.length; ++i) {
            console.log("Preparing contract: ", initialContracts.core[i].name);

            await initialContracts.core[i].compileContract(hre);
            await initialContracts.core[i].compileProxy(
                ProxyContractName,
                hre,
                [
                    initialContracts.core[i].implementationAddress, // address _logic
                    initialContracts.admin!.address,                // address _admin
                    []                                              // bytes _data
                ]
            );

            const contractSpec = initialContracts.core[i].toSpecAccount(taskArgs.useUpgradeProxy, 0);

            spec.accounts = {
                ...spec.accounts,
                ...contractSpec
            };
        }

        //spec.engine.hbbft.params.randomnessContractAddress = RANDOM_CONTRACT;
        spec.engine.hbbft.params.blockRewardContractAddress = initialContracts.getAddress("BlockRewardHbbft");
        spec.params.transactionPermissionContract = initialContracts.getAddress("TxPermissionHbbft");
        spec.params.transactionPermissionContractTransition = '0x0';
        spec.params.registrar = initialContracts.registry?.address;

        // fixing parts.
        // there is a bug in web3-eth-abi handling byte arrays,
        // but buffer work fine.
        const newParts: Buffer[] = [];
        init_data.parts.forEach((x: string) => {
            newParts.push(Buffer.from(x));
        });

        init_data.parts = newParts;

        await initialContracts.admin!.compileContract(hre, [owner]);
        await initialContracts.registry!.compileContract(hre, [
            initialContracts.getAddress("CertifierHbbft"),
            owner
        ]);
        await initialContracts.initializer!.compileContract(hre, [
            [ // _contracts
                initialContracts.getAddress("ValidatorSetHbbft"),
                initialContracts.getAddress("BlockRewardHbbft"),
                initialContracts.getAddress("RandomHbbft"),
                initialContracts.getAddress("StakingHbbft"),
                initialContracts.getAddress("TxPermissionHbbft"),
                initialContracts.getAddress("CertifierHbbft"),
                initialContracts.getAddress("KeyGenHistory")
            ],
            owner, // _owner
            initialValidators, // _miningAddresses
            stakingAddresses, // _stakingAddresses
            stakingParams,
            publicKeysSplit,
            internetAddresses,
            init_data.parts,
            init_data.acks
        ]);

        spec.accounts = {
            ...spec.accounts,
            ...initialContracts.admin?.toSpecAccount(0),
            ...initialContracts.registry?.toSpecAccount(0),
            ...initialContracts.initializer?.toSpecAccount(0)
        };

        console.log('Using the following initial validators: ' + initialValidators);
        console.log('Saving spec_hbbft.json file ...');

        fs.writeFileSync(path.join(__dirname, '..', 'spec_hbbft.json'), JSON.stringify(spec, null, '  '), 'utf-8');

        console.log('Done');
    });

// NETWORK_NAME=DPoSChain NETWORK_ID=101 OWNER=0x1092a1E3A3F2FB2024830Dd12064a4B33fF8EbAe INITIAL_VALIDATORS=0xeE385a1df869A468883107B0C06fA8791b28A04f,0x71385ae87c4b93db96f02f952be1f7a63f6057a6,0x190ec582090ae24284989af812f6b2c93f768ecd STAKING_ADDRESSES=0xe5aa2949ac94896bb2c5c75d9d5a88eb9f7c6b59,0x63a9344ae66c1f26d400b3ea4750a709c3aa6cfa,0xa5f6858d6254329a67cddab2dc04d795c5257709 STAKING_EPOCH_DURATION=120954 STAKE_WITHDRAW_DISALLOW_PERIOD=4320 PUBLIC_KEYS=0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee,0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845,0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56 IP_ADDRESSES=0x11111111111111111111111111111111,0x22222222222222222222222222222222,0x33333333333333333333333333333333 node scripts/make_spec_hbbft.js
