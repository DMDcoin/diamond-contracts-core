import fs from 'fs';
import fp from 'lodash/fp';
import { ethers } from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

import { getInitializerData } from '@openzeppelin/hardhat-upgrades/dist/utils';

export class StakingParams {
    public _initialStakingAddresses?: string[];
    public _delegatorMinStake?: bigint;
    public _candidateMinStake?: bigint;
    public _maxStake?: bigint;
    public _stakingFixedEpochDuration?: bigint;
    public _stakingTransitionTimeframeLength?: bigint;
    public _stakingWithdrawDisallowPeriod?: bigint;

    constructor(init: Partial<StakingParams>) {
        Object.assign(this, init);
    }
}

export class NetworkConfiguration {
    public networkName?: string;
    public networkId?: string;
    public owner?: string;
    public publicKeys?: string[];
    public internetAddresses?: string[];
    public stakingParams?: StakingParams;

    public initialMiningAddresses?: string[];
    public initialStakingAddresses?: string[];
    public permittedAddresses?: string[];

    public parts?: Array<Buffer>;
    public acks: any;

    public minimumBlockTime?: number;
    public maximumBlockTime?: number;
    public validatorInactivityThreshold?: number;
    public minReportAgeBlocks?: number;

    static create(fileName: string): NetworkConfiguration {
        const instance = new NetworkConfiguration();

        const rawData = fs.readFileSync(fileName);
        const initData = JSON.parse(rawData.toString());

        if (!process.env.NETWORK_NAME) {
            throw new Error("Please set your NETWORK_NAME in a .env file");
        }

        if (!process.env.NETWORK_ID) {
            throw new Error("Please set your NETWORK_ID in a .env file");
        }

        if (!process.env.OWNER) {
            throw new Error("Please set your OWNER in a .env file");
        }

        instance.minimumBlockTime = Number.parseInt(process.env.MINIMUM_BLOCK_TIME ? process.env.MINIMUM_BLOCK_TIME : "0");
        instance.maximumBlockTime = Number.parseInt(process.env.MAXIMUM_BLOCK_TIME ? process.env.MAXIMUM_BLOCK_TIME : "0");
        instance.minReportAgeBlocks = Number.parseInt(process.env.MIN_REPORT_AGE_BLOCKS ? process.env.MIN_REPORT_AGE_BLOCKS : "10");

        instance.networkName = process.env.NETWORK_NAME;
        instance.networkId = process.env.NETWORK_ID;
        instance.owner = process.env.OWNER.trim();

        let initialValidators = initData.validators;
        for (let i = 0; i < initialValidators.length; i++) {
            initialValidators[i] = initialValidators[i].trim();
        }

        let stakingAddresses = initData.staking_addresses;
        for (let i = 0; i < stakingAddresses.length; i++) {
            stakingAddresses[i] = stakingAddresses[i].trim();
        }

        let internetAddresses = initData.ip_addresses;
        for (let i = 0; i < internetAddresses.length; i++) {
            internetAddresses[i] = internetAddresses[i].trim();
        }

        let publicKeys = initData.public_keys;
        for (let i = 0; i < publicKeys.length; i++) {
            publicKeys[i] = publicKeys[i].trim();
        }

        const newParts: Buffer[] = [];
        initData.parts.forEach((x: string) => {
            newParts.push(Buffer.from(x));
        });

        instance.publicKeys = fp.flatMap((x: string) => [x.substring(0, 66), '0x' + x.substring(66, 130)])(publicKeys);
        instance.initialMiningAddresses = initialValidators;
        instance.initialStakingAddresses = stakingAddresses;
        instance.internetAddresses = internetAddresses;
        instance.permittedAddresses = [instance.owner];

        instance.parts = newParts;
        instance.acks = initData.acks;

        const stakingEpochDuration = process.env.STAKING_EPOCH_DURATION;
        const stakeWithdrawDisallowPeriod = process.env.STAKE_WITHDRAW_DISALLOW_PERIOD;
        const stakingTransitionWindowLength = process.env.STAKING_TRANSITION_WINDOW_LENGTH;
        const stakingMinStakeForValidatorString = process.env.STAKING_MIN_STAKE_FOR_VALIDATOR;
        const stakingMinStakeForDelegatorString = process.env.STAKING_MIN_STAKE_FOR_DELEGATOR;
        const validatorInactivityThresholdString = process.env.VALIDATOR_INACTIVITY_THRESHOLD;

        let stakingMinStakeForValidator = ethers.parseEther('1');
        if (stakingMinStakeForValidatorString) {
            stakingMinStakeForValidator = ethers.parseEther(stakingMinStakeForValidatorString);
        }

        let stakingMinStakeForDelegator = ethers.parseEther('1');
        if (stakingMinStakeForDelegatorString) {
            stakingMinStakeForDelegator = ethers.parseEther(stakingMinStakeForDelegatorString);
        }

        instance.validatorInactivityThreshold = 365 * 86400 // 1year
        if (validatorInactivityThresholdString) {
            instance.validatorInactivityThreshold = parseInt(validatorInactivityThresholdString);
        }

        let stakingMaxStakeForValidator = ethers.parseEther('50000');

        instance.stakingParams = new StakingParams({
            _initialStakingAddresses: instance.initialStakingAddresses,
            _delegatorMinStake: stakingMinStakeForDelegator,
            _candidateMinStake: stakingMinStakeForValidator,
            _maxStake: stakingMaxStakeForValidator,
            _stakingFixedEpochDuration: BigInt(stakingEpochDuration!),
            _stakingTransitionTimeframeLength: BigInt(stakingTransitionWindowLength!),
            _stakingWithdrawDisallowPeriod: BigInt(stakeWithdrawDisallowPeriod!),
        });

        return instance;
    }
}

export class SpecialContract {
    public name?: string;
    public address?: string;
    public bytecode?: string;

    public constructor(
        name?: string,
        address?: string,
        bytecode?: string
    ) {
        this.name = name;
        this.address = address;
        this.bytecode = bytecode;
    }

    async compileContract(hre: HardhatRuntimeEnvironment, args: any[]) {
        const factory = await hre.ethers.getContractFactory(this.name!);
        const tx = await factory.getDeployTransaction(...args);

        this.bytecode = tx.data;
    }

    toSpecAccount(balance: number) {
        return {
            [this.address!]: {
                balance: balance.toString(),
                constructor: this.bytecode!
            }
        };
    }
}

export class CoreContract {
    public name?: string;
    public proxyAddress?: string;
    public proxyBytecode?: string;
    public implementationAddress?: string;
    public implementationBytecode?: string;

    public constructor(
        name?: string,
        proxyAddress?: string,
        implementationAddress?: string,
        proxyBytecode?: string,
        implementationBytecode?: string
    ) {
        this.name = name;
        this.proxyAddress = proxyAddress;
        this.proxyBytecode = proxyBytecode;
        this.implementationAddress = implementationAddress;
        this.implementationBytecode = implementationBytecode;
    }

    isProxy(): boolean {
        return this.proxyAddress !== '';
    }

    async compileProxy(
        hre: HardhatRuntimeEnvironment,
        proxyContractName: string,
        logicAddress: string,
        args: any[]
    ) {
        const proxyFactory = await hre.ethers.getContractFactory(proxyContractName);
        const contractFactory = await hre.ethers.getContractFactory(this.name!);

        const initializerData = getInitializerData(contractFactory.interface, args, 'initialize')
        const tx = proxyFactory.getDeployTransaction(logicAddress, initializerData);

        this.proxyBytecode = tx.data!.toString();
    }

    async compileContract(hre: HardhatRuntimeEnvironment) {
        const factory = await hre.ethers.getContractFactory(this.name!);

        this.implementationBytecode = factory.bytecode;
    }

    toSpecAccount(useUpgradeProxy: boolean, initialBalance: number) {
        let spec = {};

        if (useUpgradeProxy) {
            spec[this.implementationAddress!] = {
                balance: '0',
                constructor: this.implementationBytecode
            };

            spec[this.proxyAddress!] = {
                balance: initialBalance.toString(),
                constructor: this.proxyBytecode
            };
        } else {
            spec[this.proxyAddress!] = {
                balance: initialBalance.toString(),
                constructor: this.implementationBytecode
            }
        }

        return spec;
    }
}

export class InitialContractsConfiguration {
    public core: CoreContract[];
    public registry?: SpecialContract;

    static fromJSON(json: any): InitialContractsConfiguration {
        const instance = new InitialContractsConfiguration();

        for (const [key, value] of Object.entries(json)) {
            if (key == 'core') {
                instance[key] = (value as Array<any>).map(x => new CoreContract(...(Object.values(x as any) as [])));
            }
        }

        return instance;
    }

    static fromFile(fileName: string): InitialContractsConfiguration {
        const rawData = fs.readFileSync(fileName);
        const jsonData = JSON.parse(rawData.toString());

        return InitialContractsConfiguration.fromJSON(jsonData);
    }

    getAddress(name: string): string | undefined {
        const found = this.core.find(obj => obj.name === name);

        return found ? found.proxyAddress : ethers.ZeroAddress;
    }

    getContractInitializerArgs(
        contractName: string,
        config: NetworkConfiguration,
    ) {
        switch (contractName) {
            case 'ValidatorSetHbbft':
                return [
                    config.owner,
                    this.getAddress('BlockRewardHbbft'),
                    this.getAddress('RandomHbbft'),
                    this.getAddress('StakingHbbft'),
                    this.getAddress('KeyGenHistory'),
                    config.validatorInactivityThreshold,
                    config.initialMiningAddresses,
                    config.initialStakingAddresses
                ];
            case 'BlockRewardHbbft':
                return [
                    config.owner,
                    this.getAddress('ValidatorSetHbbft'),
                    this.getAddress('ConnectivityTrackerHbbft')
                ];
            case 'RandomHbbft':
                return [
                    config.owner,
                    this.getAddress('ValidatorSetHbbft'),
                ];
            case 'TxPermissionHbbft':
                return [
                    config.permittedAddresses,
                    this.getAddress('CertifierHbbft'),
                    this.getAddress('ValidatorSetHbbft'),
                    this.getAddress('KeyGenHistory'),
                    this.getAddress('ConnectivityTrackerHbbft'),
                    config.owner
                ];
            case 'CertifierHbbft':
                return [
                    config.permittedAddresses,
                    this.getAddress('ValidatorSetHbbft'),
                    config.owner
                ];
            case 'KeyGenHistory':
                return [
                    config.owner,
                    this.getAddress('ValidatorSetHbbft'),
                    config.initialMiningAddresses,
                    config.parts,
                    config.acks
                ];
            case 'StakingHbbft':
                return [
                    config.owner,
                    {
                        _validatorSetContract: this.getAddress('ValidatorSetHbbft'),
                        ...config.stakingParams
                    },
                    config.publicKeys,
                    config.internetAddresses
                ];
            case 'ConnectivityTrackerHbbft':
                return [
                    config.owner,
                    this.getAddress('ValidatorSetHbbft'),
                    this.getAddress('StakingHbbft'),
                    this.getAddress('BlockRewardHbbft'),
                    config.minReportAgeBlocks
                ];
            case 'Registry':
                return [
                    this.getAddress('CertifierHbbft'),
                    config.owner
                ];
            default:
                return [];
        }
    }
}
