# IBonusScoreSystem
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/interfaces/IBonusScoreSystem.sol)


## Functions
### getValidatorScore


```solidity
function getValidatorScore(address mining) external view returns (uint256);
```

### rewardStandBy


```solidity
function rewardStandBy(address mining, uint256 time) external;
```

### penaliseNoStandBy


```solidity
function penaliseNoStandBy(address mining, uint256 time) external;
```

### penaliseNoKeyWrite


```solidity
function penaliseNoKeyWrite(address mining) external;
```

### penaliseBadPerformance


```solidity
function penaliseBadPerformance(address mining, uint256 time) external;
```

