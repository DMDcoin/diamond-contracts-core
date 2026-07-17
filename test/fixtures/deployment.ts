import hre from "hardhat";
import { Account, parseEther } from "viem";

import { getNValidatorsPartNAcks } from "./data.js";
import { splitPublicKeys } from "./utils.js";
import { deployProxy } from "./proxy.js";
import { deployDao } from "./dao.js";
import { Validator, ZeroIpAddress } from "./validator.js";
import { createRandomWallet } from "./wallet.js";

import type {
    BlockRewardHbbftMock,
    ValidatorSetHbbftMock,
    StakingHbbftMock,
    ConnectivityTrackerHbbftMock,
    TxPermissionHbbft,
    RandomHbbft,
    KeyGenHistory,
    CertifierHbbft,
    BonusScoreSystemMock,
    DaoMock,
} from "./types.js";

// one epoch in 1 day.
export const STAKING_FIXED_EPOCH_DURATION = 86400n;

// the transition time window is 1 hour.
export const STAKING_TRANSITION_WINDOW_LENGTH = 3600n;

export const STAKE_WITHDRAW_DISALLOW_PERIOD = 2n; // one less than EPOCH DURATION, therefore it meets the conditions.
export const MIN_STAKE = parseEther("1");
export const DELEGATOR_MIN_STAKE = parseEther("100");
export const MAX_STAKE = parseEther("100000");
export const VALIDATOR_INACTIVITY_THRESHOLD = 365n * 86400n; // 1 year

export interface DeploymentParams {
    initialValidatorsCount?: number;
    delegatorMinStake?: bigint;
    candidateMinStake?: bigint;
    maxStake?: bigint;
    stakingFixedEpochDuration?: bigint;
    stakingTransitionTimeframeLength?: bigint;
    stakingWithdrawDisallowPeriod?: bigint;
    validatorInactivityThreshold?: bigint;
}

const DefaultDeploymentParams: Required<DeploymentParams> = {
    initialValidatorsCount: 3,
    delegatorMinStake: DELEGATOR_MIN_STAKE,
    candidateMinStake: MIN_STAKE,
    maxStake: MAX_STAKE,
    stakingFixedEpochDuration: STAKING_FIXED_EPOCH_DURATION,
    stakingTransitionTimeframeLength: STAKING_TRANSITION_WINDOW_LENGTH,
    stakingWithdrawDisallowPeriod: STAKE_WITHDRAW_DISALLOW_PERIOD,
    validatorInactivityThreshold: VALIDATOR_INACTIVITY_THRESHOLD,
};

export interface DeployedContracts {
    params: Required<DeploymentParams>;
    initialValidators: Validator[];
    blockReward: BlockRewardHbbftMock;
    validatorSet: ValidatorSetHbbftMock;
    staking: StakingHbbftMock;
    connectivityTracker: ConnectivityTrackerHbbftMock;
    txPermission: TxPermissionHbbft;
    randomHbbft: RandomHbbft;
    keyGenHistory: KeyGenHistory;
    certifier: CertifierHbbft;
    bonusScoreSystem: BonusScoreSystemMock;
    dao: DaoMock;
}

export type DeploymentFixture = () => Promise<DeployedContracts>;

const deploymentFixtures = new Map<string, DeploymentFixture>();

export function createDeploymentFixture(owner: Account, params: DeploymentParams = {}): DeploymentFixture {
    const withDefaults: Required<DeploymentParams> = { ...DefaultDeploymentParams, ...params };

    const key = JSON.stringify(withDefaults, (_, value) => (typeof value === "bigint" ? `${value}n` : value));

    let fixture = deploymentFixtures.get(key);
    if (fixture === undefined) {
        fixture = async function contractsDeploymentFixture() {
            return deployCoreContracts(owner, withDefaults);
        };

        deploymentFixtures.set(key, fixture);
    }

    return fixture;
}

async function deployCoreContracts(owner: Account, params: Required<DeploymentParams>): Promise<DeployedContracts> {
    const { viem } = await hre.network.getOrCreate();

    const initialValidators = new Array<Validator>();
    for (let i = 0; i < params.initialValidatorsCount; ++i) {
        const validator = await Validator.create();
        initialValidators.push(validator);
    }

    const initialMiningAddresses = initialValidators.map((validator) => validator.miningAddress());
    const initialStakingAddresses = initialValidators.map((validator) => validator.stakingAddress());

    const stubAddress = createRandomWallet().address;

    const { parts, acks } = getNValidatorsPartNAcks(initialValidators.length);

    const dao = await deployDao();
    const bonusScoreSystem = await viem.deployContract("BonusScoreSystemMock");
    const connectivityTracker = await viem.deployContract("ConnectivityTrackerHbbftMock");

    const validatorSetParams = {
        blockRewardContract: stubAddress,
        randomContract: stubAddress,
        stakingContract: stubAddress,
        keyGenHistoryContract: stubAddress,
        bonusScoreContract: bonusScoreSystem.address,
        connectivityTrackerContract: connectivityTracker.address,
        validatorInactivityThreshold: params.validatorInactivityThreshold,
    };

    const validatorSet = await deployProxy(viem, "ValidatorSetHbbftMock", {
        initArgs: [
            owner.address,
            validatorSetParams, // _params
            initialMiningAddresses, // _initialMiningAddresses
            initialStakingAddresses, // _initialStakingAddresses
        ],
        initializer: "initialize",
    });

    const randomHbbft = await deployProxy(viem, "RandomHbbft", {
        initArgs: [owner.address, validatorSet.address],
        initializer: "initialize",
    });

    const keyGenHistory = await deployProxy(viem, "KeyGenHistory", {
        initArgs: [owner.address, validatorSet.address, initialMiningAddresses, parts, acks],
        initializer: "initialize",
    });

    const certifier = await deployProxy(viem, "CertifierHbbft", {
        initArgs: [[owner.address], validatorSet.address, owner.address],
        initializer: "initialize",
    });

    const txPermission = await deployProxy(viem, "TxPermissionHbbft", {
        initArgs: [
            [owner.address],
            certifier.address,
            validatorSet.address,
            keyGenHistory.address,
            connectivityTracker.address,
            owner.address,
        ],
        initializer: "initialize",
    });

    const blockReward = await deployProxy(viem, "BlockRewardHbbftMock", {
        initArgs: [owner.address, validatorSet.address, connectivityTracker.address],
        initializer: "initialize",
    });

    const initialValidatorsPubKeys = splitPublicKeys(
        initialValidators.map((validator) => validator.publicKey()),
    );

    // The IP addresses are irrelevant for these unit tests, just initialize them to 0.
    const initialValidatorsIpAddresses = Array(initialValidators.length).fill(ZeroIpAddress);

    const stakingParams = {
        _validatorSetContract: validatorSet.address,
        _bonusScoreContract: bonusScoreSystem.address,
        _initialStakingAddresses: initialStakingAddresses,
        _delegatorMinStake: params.delegatorMinStake,
        _candidateMinStake: params.candidateMinStake,
        _maxStake: params.maxStake,
        _stakingFixedEpochDuration: params.stakingFixedEpochDuration,
        _stakingTransitionTimeframeLength: params.stakingTransitionTimeframeLength,
        _stakingWithdrawDisallowPeriod: params.stakingWithdrawDisallowPeriod,
    };

    const staking = await deployProxy(viem, "StakingHbbftMock", {
        initArgs: [
            owner.address,
            stakingParams, // initializer structure
            initialValidatorsPubKeys, // _publicKeys
            initialValidatorsIpAddresses, // _internetAddresses
        ],
        initializer: "initialize",
    });

    await validatorSet.write.setBlockRewardContract([blockReward.address]);
    await validatorSet.write.setRandomContract([randomHbbft.address]);
    await validatorSet.write.setStakingContract([staking.address]);
    await validatorSet.write.setKeyGenHistoryContract([keyGenHistory.address]);

    return {
        params,
        initialValidators,
        blockReward,
        validatorSet,
        staking,
        connectivityTracker,
        txPermission,
        randomHbbft,
        keyGenHistory,
        certifier,
        bonusScoreSystem,
        dao,
    };
}
