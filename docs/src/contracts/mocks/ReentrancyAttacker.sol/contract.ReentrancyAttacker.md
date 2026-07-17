# ReentrancyAttacker
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/mocks/ReentrancyAttacker.sol)


## State Variables
### bonusScoreSystem

```solidity
IBonusScoreSystem public bonusScoreSystem
```


### timeArgValue

```solidity
uint256 public timeArgValue
```


### funcId

```solidity
bytes4 public funcId
```


## Functions
### setFuncId


```solidity
function setFuncId(bytes4 id) external;
```

### setBonusScoreContract


```solidity
function setBonusScoreContract(address _bonusScoreSystem) external;
```

### attack


```solidity
function attack(address mining, uint256 time) public;
```

### stakingFixedEpochDuration


```solidity
function stakingFixedEpochDuration() external pure returns (uint256);
```

### updatePoolLikelihood


```solidity
function updatePoolLikelihood(address mining, uint256) external;
```

