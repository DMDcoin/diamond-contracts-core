# BonusScoreSystemMock
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/mocks/BonusScoreSystemMock.sol)

**Inherits:**
[IBonusScoreSystem](/contracts/interfaces/IBonusScoreSystem.sol/interface.IBonusScoreSystem.md)


## Constants
### DEFAULT_STAND_BY_FACTOR

```solidity
uint256 public constant DEFAULT_STAND_BY_FACTOR = 15
```


### DEFAULT_NO_STAND_BY_FACTOR

```solidity
uint256 public constant DEFAULT_NO_STAND_BY_FACTOR = 15
```


### DEFAULT_NO_KEY_WRITE_FACTOR

```solidity
uint256 public constant DEFAULT_NO_KEY_WRITE_FACTOR = 100
```


### DEFAULT_BAD_PERF_FACTOR

```solidity
uint256 public constant DEFAULT_BAD_PERF_FACTOR = 100
```


### MIN_SCORE

```solidity
uint256 public constant MIN_SCORE = 1
```


### MAX_SCORE

```solidity
uint256 public constant MAX_SCORE = 1000
```


## State Variables
### validatorScore

```solidity
mapping(address => uint256) public validatorScore
```


## Functions
### receive


```solidity
receive() external payable;
```

### rewardStandBy


```solidity
function rewardStandBy(address mining, uint256) external;
```

### penaliseNoStandBy


```solidity
function penaliseNoStandBy(address mining, uint256) external;
```

### penaliseNoKeyWrite


```solidity
function penaliseNoKeyWrite(address mining) external;
```

### penaliseBadPerformance


```solidity
function penaliseBadPerformance(address mining, uint256) external;
```

### setValidatorScore


```solidity
function setValidatorScore(address mining, uint256 value) external;
```

### getValidatorScore


```solidity
function getValidatorScore(address mining) external view returns (uint256);
```

