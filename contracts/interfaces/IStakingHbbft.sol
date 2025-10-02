// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

interface IStakingHbbft {
    struct PoolRewardShares {
        uint256 validatorShare;
        uint256 nodeOperatorShare;
        uint256 delegatorsShare;
    }

    struct StakingParams {
        address _validatorSetContract;
        address _bonusScoreContract;
        address[] _initialStakingAddresses;
        uint256 _delegatorMinStake;
        uint256 _candidateMinStake;
        uint256 _maxStake;
        uint256 _stakingFixedEpochDuration;
        uint256 _stakingTransitionTimeframeLength;
        uint256 _stakingWithdrawDisallowPeriod;
    }

    function incrementStakingEpoch() external;

    function removePool(address) external;

    function removePools() external;

    function setStakingEpochStartTime(uint256) external;

    function notifyKeyGenFailed() external;

    function notifyAvailability(address _stakingAddress) external;

    function notifyNetworkOfftimeDetected(uint256) external;

    function notifyEarlyEpochEnd(uint256 timestamp) external;

    function updatePoolLikelihood(address mining, uint256 validatorScore) external;

    function restake(
        address _poolStakingAddress,
        uint256 validatorReward
    ) external payable;

    function snapshotPoolStakeAmounts(
        uint256 _epoch,
        address _stakingPool
    ) external;

    function getPoolValidatorStakeAmount(
        uint256 _epoch,
        address _stakingPool
    ) external view returns (uint256);

    function setValidatorInternetAddress(
        address,
        bytes16,
        bytes2
    ) external;

    function getPoolPublicKey(address _poolAddress)
        external
        view
        returns (bytes memory);

    function getPoolsLikelihood()
        external
        view
        returns (uint256[] memory, uint256);

    function getPoolsToBeElected() external view returns (address[] memory);

    function getPoolsToBeRemoved() external view returns (address[] memory);

    function getPoolsInactive() external view returns (address[] memory);

    function isPoolActive(address) external view returns (bool);

    function isPoolValid(address) external view returns (bool);

    function MAX_CANDIDATES() external pure returns (uint256); // solhint-disable-line func-name-mixedcase

    function orderedWithdrawAmount(address, address)
        external
        view
        returns (uint256);

    function poolDelegators(address) external view returns (address[] memory);

    function stakeAmount(address, address) external view returns (uint256);

    function stakeAmountTotal(address) external view returns (uint256);

    function totalStakedAmount() external view returns (uint256);

    function stakingWithdrawDisallowPeriod() external view returns (uint256);

    function stakingEpoch() external view returns (uint256);

    function stakingFixedEpochDuration() external view returns (uint256);

    function startTimeOfNextPhaseTransition() external view returns (uint256);

    function stakingFixedEpochEndTime() external view returns (uint256);

    function stakingEpochStartTime() external view returns (uint256);

    function stakingEpochStartBlock() external view returns (uint256);

    function actualEpochEndTime() external view returns (uint256);
}
