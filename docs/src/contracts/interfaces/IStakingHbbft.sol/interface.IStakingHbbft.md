# IStakingHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/interfaces/IStakingHbbft.sol)


## Functions
### incrementStakingEpoch


```solidity
function incrementStakingEpoch() external;
```

### removePool


```solidity
function removePool(address) external;
```

### removePools


```solidity
function removePools() external;
```

### setStakingEpochStartTime


```solidity
function setStakingEpochStartTime(uint256) external;
```

### notifyKeyGenFailed


```solidity
function notifyKeyGenFailed() external;
```

### notifyAvailability


```solidity
function notifyAvailability(address _stakingAddress) external;
```

### notifyNetworkOfftimeDetected


```solidity
function notifyNetworkOfftimeDetected(uint256) external;
```

### notifyEarlyEpochEnd


```solidity
function notifyEarlyEpochEnd(uint256 timestamp) external;
```

### updatePoolLikelihood


```solidity
function updatePoolLikelihood(address mining, uint256 validatorScore) external;
```

### restake


```solidity
function restake(address _poolStakingAddress, uint256 validatorReward) external payable;
```

### snapshotPoolStakeAmounts


```solidity
function snapshotPoolStakeAmounts(uint256 _epoch, address _stakingPool) external;
```

### getPoolValidatorStakeAmount


```solidity
function getPoolValidatorStakeAmount(
    uint256 _epoch,
    address _stakingPool
) external view returns (uint256);
```

### setValidatorInternetAddress


```solidity
function setValidatorInternetAddress(address, bytes16, bytes2) external;
```

### getPoolPublicKey


```solidity
function getPoolPublicKey(address _poolAddress) external view returns (bytes memory);
```

### getPoolsLikelihood


```solidity
function getPoolsLikelihood() external view returns (uint256[] memory, uint256);
```

### getPoolsToBeElected


```solidity
function getPoolsToBeElected() external view returns (address[] memory);
```

### getPoolsToBeRemoved


```solidity
function getPoolsToBeRemoved() external view returns (address[] memory);
```

### getPoolsInactive


```solidity
function getPoolsInactive() external view returns (address[] memory);
```

### isPoolActive


```solidity
function isPoolActive(address) external view returns (bool);
```

### isPoolValid


```solidity
function isPoolValid(address) external view returns (bool);
```

### MAX_CANDIDATES


```solidity
function MAX_CANDIDATES() external pure returns (uint256);
```

### orderedWithdrawAmount


```solidity
function orderedWithdrawAmount(address, address) external view returns (uint256);
```

### poolDelegators


```solidity
function poolDelegators(address) external view returns (address[] memory);
```

### stakeAmount


```solidity
function stakeAmount(address, address) external view returns (uint256);
```

### stakeAmountTotal


```solidity
function stakeAmountTotal(address) external view returns (uint256);
```

### totalStakedAmount


```solidity
function totalStakedAmount() external view returns (uint256);
```

### stakingWithdrawDisallowPeriod


```solidity
function stakingWithdrawDisallowPeriod() external view returns (uint256);
```

### stakingEpoch


```solidity
function stakingEpoch() external view returns (uint256);
```

### stakingFixedEpochDuration


```solidity
function stakingFixedEpochDuration() external view returns (uint256);
```

### startTimeOfNextPhaseTransition


```solidity
function startTimeOfNextPhaseTransition() external view returns (uint256);
```

### stakingFixedEpochEndTime


```solidity
function stakingFixedEpochEndTime() external view returns (uint256);
```

### stakingEpochStartTime


```solidity
function stakingEpochStartTime() external view returns (uint256);
```

### stakingEpochStartBlock


```solidity
function stakingEpochStartBlock() external view returns (uint256);
```

### actualEpochEndTime


```solidity
function actualEpochEndTime() external view returns (uint256);
```

## Structs
### PoolRewardShares

```solidity
struct PoolRewardShares {
    uint256 validatorShare;
    uint256 nodeOperatorShare;
    uint256 delegatorsShare;
}
```

### StakingParams

```solidity
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
```

