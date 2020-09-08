pragma solidity ^0.5.16;

interface IStakingHbbft {
    function incrementStakingEpoch() external;
    function initialize(
        address,
        address[] calldata,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        bytes32[] calldata,
        bytes16[] calldata
    ) external;
    function removePool(address) external;
    function removePools() external;
    function setStakingEpochStartTime(uint256) external;
    function getPoolsLikelihood() external view returns(uint256[] memory, uint256);
    function getPoolsToBeElected() external view returns(address[] memory);
    function getPoolsToBeRemoved() external view returns(address[] memory);
    function isPoolActive(address) external view returns(bool);
    function MAX_CANDIDATES() external pure returns(uint256); // solhint-disable-line func-name-mixedcase
    function orderedWithdrawAmount(address, address) external view returns(uint256);
    function poolDelegators(address) external view returns(address[] memory);
    function rewardWasTaken(address, address, uint256) external view returns(bool);
    function stakeAmount(address, address) external view returns(uint256);
    function stakeAmountTotal(address) external view returns(uint256);
    function stakeFirstEpoch(address, address) external view returns(uint256);
    function stakeLastEpoch(address, address) external view returns(uint256);
    function stakingWithdrawDisallowPeriod() external view returns(uint256);
    function stakingEpoch() external view returns(uint256);
    function stakingFixedEpochDuration() external view returns(uint256);
    function stakingFixedEpochEndTime() external view returns(uint256);
    function stakingEpochStartTime() external view returns(uint256);
}
