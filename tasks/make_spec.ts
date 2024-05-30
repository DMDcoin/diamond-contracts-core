import fs from 'fs';
import path from 'path';
import { task } from "hardhat/config";

import { InitialContractsConfiguration, NetworkConfiguration } from './types';

const ProxyContractName = "TransparentUpgradeableProxy";

task("make_spec_hbbft", "used to make a spec file")
    .addParam("initContracts", "Initial contracts configuration file")
    .addOptionalParam("initialFundAddress", "Initial address that holds all funds")
    .addFlag("useUpgradeProxy", "Upgradeable proxy support")
    .addPositionalParam("initDataFile", "Initial spec configuration file")
    .setAction(async (taskArgs, hre) => {
        console.log("Using upgrade proxy: ", taskArgs.useUpgradeProxy)
        console.log("Using initial data file: ", taskArgs.initDataFile);
        console.log("initial funding address: ", taskArgs.initialFundAddress);
        console.log("Using initial contracts file: ", taskArgs.initContracts);

        const initialContracts = InitialContractsConfiguration.fromFile(taskArgs.initContracts);
        const networkConfig = NetworkConfiguration.create(taskArgs.initDataFile);

        let spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'templates', 'spec_hbbft.json'), 'utf-8'));

        spec.name = networkConfig.networkName;
        spec.params.networkID = networkConfig.networkId;

        if (networkConfig.minimumBlockTime! > 0) {
            spec.engine.hbbft.params.minimumBlockTime = networkConfig.minimumBlockTime;
        }

        if (networkConfig.maximumBlockTime! > 0) {
            spec.engine.hbbft.params.maximumBlockTime = networkConfig.maximumBlockTime;
        }

        //todo: sanitizing initialFundAddress
        if (taskArgs.initialFundAddress) {
            spec.accounts[taskArgs.initialFundAddress] =
            {
                balance: "4380000000000000000000000"
            };
        }

        for (let i = 0; i < initialContracts.core.length; ++i) {
            const contractName = initialContracts.core[i].name!;

            console.log("Preparing contract: ", contractName);

            const initializerArgs = initialContracts.getContractInitializerArgs(contractName, networkConfig);

            await initialContracts.core[i].compileContract(hre);
            await initialContracts.core[i].compileProxy(
                hre,
                ProxyContractName,
                initialContracts.core[i].implementationAddress!, // address _logic,
                networkConfig.owner!,                            // contract initial owner
                initializerArgs                                  // bytes _data
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


        await initialContracts.registry!.compileContract(
            hre,
            [
                initialContracts.getAddress("CertifierHbbft"),
                networkConfig.owner
            ]
        );

        spec.accounts = {
            ...spec.accounts,
            ...initialContracts.registry?.toSpecAccount(0)
        };

        console.log('Using the following initial validators: ' + networkConfig.initialMiningAddresses);
        console.log('Saving spec_hbbft.json file ...');

        fs.writeFileSync(path.join(__dirname, '..', 'spec_hbbft.json'), JSON.stringify(spec, null, '  '), 'utf-8');

        console.log('Done');
    });

// NETWORK_NAME=DPoSChain NETWORK_ID=101 OWNER=0x1092a1E3A3F2FB2024830Dd12064a4B33fF8EbAe INITIAL_VALIDATORS=0xeE385a1df869A468883107B0C06fA8791b28A04f,0x71385ae87c4b93db96f02f952be1f7a63f6057a6,0x190ec582090ae24284989af812f6b2c93f768ecd STAKING_ADDRESSES=0xe5aa2949ac94896bb2c5c75d9d5a88eb9f7c6b59,0x63a9344ae66c1f26d400b3ea4750a709c3aa6cfa,0xa5f6858d6254329a67cddab2dc04d795c5257709 STAKING_EPOCH_DURATION=120954 STAKE_WITHDRAW_DISALLOW_PERIOD=4320 PUBLIC_KEYS=0x52be8f332b0404dff35dd0b2ba44993a9d3dc8e770b9ce19a849dff948f1e14c57e7c8219d522c1a4cce775adbee5330f222520f0afdabfdb4a4501ceeb8dcee,0x99edf3f524a6f73e7f5d561d0030fc6bcc3e4bd33971715617de7791e12d9bdf6258fa65b74e7161bbbf7ab36161260f56f68336a6f65599dc37e7f2e397f845,0xa255fd7ad199f0ee814ee00cce44ef2b1fa1b52eead5d8013ed85eade03034ae4c246658946c2e1d7ded96394a1247fb4d093c32474317ae388e8d25692a0f56 IP_ADDRESSES=0x11111111111111111111111111111111,0x22222222222222222222222222222222,0x33333333333333333333333333333333 node scripts/make_spec_hbbft.js
