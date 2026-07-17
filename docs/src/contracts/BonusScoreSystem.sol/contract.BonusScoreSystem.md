# BonusScoreSystem
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/BonusScoreSystem.sol)

**Inherits:**
Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, [ValueGuards](/contracts/lib/ValueGuards.sol/abstract.ValueGuards.md), [IBonusScoreSystem](/contracts/interfaces/IBonusScoreSystem.sol/interface.IBonusScoreSystem.md)

Stores validators bonus score based on their behavior.
Validator with a higher bonus score has a higher likelihood to be elected.


## Constants
### DEFAULT_NO_STAND_BY_FACTOR

```solidity
uint256 public constant DEFAULT_NO_STAND_BY_FACTOR = 20
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
### standByFactor

```solidity
uint256 public standByFactor
```


### stakingHbbft

```solidity
IStakingHbbft public stakingHbbft
```


### validatorSetHbbft

```solidity
address public validatorSetHbbft
```


### connectivityTracker

```solidity
address public connectivityTracker
```


### _factors
Current bonus score factors bonus/penalty value


```solidity
mapping(ScoringFactor => uint256) private _factors
```


### _validatorScore
Validators mining address to current bonus score mapping


```solidity
mapping(address => uint256) private _validatorScore
```


### _standByScoreChangeTimestamp
Timestamp of validator stand by reward/penalty


```solidity
mapping(address => uint256) private _standByScoreChangeTimestamp
```


## Functions
### onlyValidatorSet


```solidity
modifier onlyValidatorSet() ;
```

### onlyConnectivityTracker


```solidity
modifier onlyConnectivityTracker() ;
```

### initialize

Contract initializer.


```solidity
function initialize(
    address _owner,
    address _validatorSetHbbft,
    address _connectivityTracker,
    address _stakingHbbft
) external initializer;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_owner`|`address`|Contract owner address.|
|`_validatorSetHbbft`|`address`|ValidatorSetHbbft contract address.|
|`_connectivityTracker`|`address`|ConnectivityTrackerHbbft contract address.|
|`_stakingHbbft`|`address`|StakingHbbft contract address.|


### setStandByFactor

Sets the standby factor value.


```solidity
function setStandByFactor(uint256 _standByFactor)
    external
    onlyOwner
    withinAllowedRange(_standByFactor);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_standByFactor`|`uint256`|The new standby factor value.|


### rewardStandBy

Reward a validator who could not get into the current set, but was available.


```solidity
function rewardStandBy(
    address mining,
    uint256 availableSince
) external onlyValidatorSet nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`mining`|`address`|Validator mining address|
|`availableSince`|`uint256`|Timestamp from which the validator is available.|


### penaliseNoStandBy

Penalise validator marked as unavailable.


```solidity
function penaliseNoStandBy(
    address mining,
    uint256 unavailableSince
) external onlyValidatorSet nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`mining`|`address`|Validator mining address|
|`unavailableSince`|`uint256`|Timestamp from which the validator is unavailable.|


### penaliseNoKeyWrite

Penalise validator for missed Part/ACK.


```solidity
function penaliseNoKeyWrite(address mining) external onlyValidatorSet nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`mining`|`address`|Validator mining address|


### penaliseBadPerformance

Penalise validator for bad performance (lost connectivity).
Zero `time` value means full score decrease value (= DEFAULT_BAD_PERF_FACTOR)


```solidity
function penaliseBadPerformance(
    address mining,
    uint256 time
) external onlyConnectivityTracker nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`mining`|`address`|Validator mining address|
|`time`|`uint256`|Time interval from the moment when the validator was marked as faulty until full reconnect.|


### getScoringFactorValue

Returns current bonus/penalty value for specified scoring factor `factor`


```solidity
function getScoringFactorValue(ScoringFactor factor) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`factor`|`ScoringFactor`|Type of scoring factor.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|value Scoring factor value.|


### getTimePerScorePoint

Returns time in seconds needed to accumulate single score point depending on scoring `factor`


```solidity
function getTimePerScorePoint(ScoringFactor factor) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`factor`|`ScoringFactor`|Type of scroing factor.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|value time interval in seconds.|


### getValidatorScore

Get current validator score.


```solidity
function getValidatorScore(address mining) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`mining`|`address`|Validator mining address.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|value current validator score.|


### _setInitialScoringFactors

Initialize default scoring factors bonus/penalty values.


```solidity
function _setInitialScoringFactors() private;
```

### _updateScoreStandBy


```solidity
function _updateScoreStandBy(
    address mining,
    ScoringFactor factor,
    uint256 availabilityTimestamp
) private;
```

### _updateValidatorScore

Update current validator score


```solidity
function _updateValidatorScore(
    address mining,
    ScoringFactor factor,
    uint256 timeInterval
) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`mining`|`address`|Validator mining address|
|`factor`|`ScoringFactor`|Type of scoring factor - reason to change validator score|
|`timeInterval`|`uint256`|Interval of time used to calculate score change Emits [ValidatorScoreChanged](/contracts/BonusScoreSystem.sol/contract.BonusScoreSystem.md#validatorscorechanged) event|


### _getAccumulatedScorePoints


```solidity
function _getAccumulatedScorePoints(
    ScoringFactor factor,
    uint256 timeInterval
) private view returns (uint256);
```

### _isScoreIncrease


```solidity
function _isScoreIncrease(ScoringFactor factor) private pure returns (bool);
```

## Events
### ValidatorScoreChanged
Emitted by the `_updateValidatorScore` function when validator's score changes for one
of the {ScoringFactor} reasons described in `factor`


```solidity
event ValidatorScoreChanged(
    address indexed miningAddress,
    ScoringFactor indexed factor,
    uint256 newScore
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`miningAddress`|`address`|Validator's mining address.|
|`factor`|`ScoringFactor`|Scoring factor type.|
|`newScore`|`uint256`|New validator's bonus score value.|

### UpdateScoringFactor
Emitted by the `updateScoringFactor` function when bonus/penalty for specified
scoring factor changed by contract owner (DAO contract).


```solidity
event UpdateScoringFactor(ScoringFactor indexed factor, uint256 value);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`factor`|`ScoringFactor`|Scoring factor type.|
|`value`|`uint256`|New scoring factor bonus/penalty value.|

### SetStandByFactor
Emitted by the `setStandByFactor` function when standby factor is changed.


```solidity
event SetStandByFactor(uint256 standByFactor);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`standByFactor`|`uint256`|New standby factor value.|

## Errors
### InvalidIntervalStartTimestamp

```solidity
error InvalidIntervalStartTimestamp();
```

