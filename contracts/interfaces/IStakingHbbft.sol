pragma solidity =0.8.17;

interface IStakingHbbft {
    struct StakingParams {
        address _validatorSetContract;
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

    function isPoolActive(address) external view returns (bool);

    function MAX_CANDIDATES() external pure returns (uint256); // solhint-disable-line func-name-mixedcase

    function orderedWithdrawAmount(address, address)
        external
        view
        returns (uint256);

    function poolDelegators(address) external view returns (address[] memory);

    function rewardWasTaken(
        address,
        address,
        uint256
    ) external view returns (bool);

    function setValidatorInternetAddress(
        address,
        bytes16,
        bytes2
    ) external;

    function stakeAmount(address, address) external view returns (uint256);

    function stakeAmountTotal(address) external view returns (uint256);

    function stakeFirstEpoch(address, address) external view returns (uint256);

    function stakeLastEpoch(address, address) external view returns (uint256);

    function stakingWithdrawDisallowPeriod() external view returns (uint256);

    function stakingEpoch() external view returns (uint256);

    function stakingFixedEpochDuration() external view returns (uint256);

    function startTimeOfNextPhaseTransition() external view returns (uint256);

    function stakingFixedEpochEndTime() external view returns (uint256);

    function stakingEpochStartTime() external view returns (uint256);
}
