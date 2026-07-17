# ConnectivityTrackerHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/ConnectivityTrackerHbbft.sol)

**Inherits:**
Initializable, OwnableUpgradeable, [IConnectivityTrackerHbbft](/contracts/interfaces/IConnectivityTrackerHbbft.sol/interface.IConnectivityTrackerHbbft.md), [ValueGuards](/contracts/lib/ValueGuards.sol/abstract.ValueGuards.md)


## State Variables
### validatorSetContract
The address of the {ValidatorSetHbbft} contract.


```solidity
IValidatorSetHbbft public validatorSetContract
```


### stakingContract
The address of the {StakingHbbft} contract.


```solidity
IStakingHbbft public stakingContract
```


### blockRewardContract
The address of the {BlockRewardHbbft} contract.


```solidity
IBlockRewardHbbft public blockRewardContract
```


### reportDisallowPeriod
Time since the beginning of the epoch during which reports are not accepted.

**Note:**
oz-renamed-from: minReportAgeBlocks


```solidity
uint256 public reportDisallowPeriod
```


### earlyEpochEndToleranceLevel
Parameter that binds Hbbft Fault tolerance with


```solidity
uint256 public earlyEpochEndToleranceLevel
```


### isEarlyEpochEnd
Early epoch end historical data.


```solidity
mapping(uint256 => bool) public isEarlyEpochEnd
```


### _flaggedValidators
Mapping the epoch number to the list of validators that have disconnected in it.


```solidity
mapping(uint256 => EnumerableSet.AddressSet) private _flaggedValidators
```


### _reporters
Mapping of reported validators and their reporters by epoch number.


```solidity
mapping(uint256 => mapping(address => EnumerableSet.AddressSet)) private _reporters
```


### _epochPenaltiesSent
Indicats wheter validators were penalised for bad performance in specific epoch.


```solidity
mapping(uint256 => bool) private _epochPenaltiesSent
```


### bonusScoreContract
The address of the {BonusScoreSystem} contract.


```solidity
IBonusScoreSystem public bonusScoreContract
```


### _disconnectTimestamp
Timestamp when the validator was marked as faulty in a specific epoch.


```solidity
mapping(uint256 => mapping(address => uint256)) private _disconnectTimestamp
```


## Functions
### constructor

**Note:**
oz-upgrades-unsafe-allow: constructor


```solidity
constructor() ;
```

### onlyBlockRewardContract

Check that the caller is {BlockRewardHbbft} contract.
Reverts with an {Unauthorized} error.


```solidity
modifier onlyBlockRewardContract() ;
```

### initialize


```solidity
function initialize(
    address _contractOwner,
    address _validatorSetContract,
    address _stakingContract,
    address _blockRewardContract,
    address _bonusScoreContract,
    uint256 _reportDisallowPeriodSeconds
) external initializer;
```

### setReportDisallowPeriod

This function sets the period of time during which reports are not accepted.
Can only be called by contract owner.


```solidity
function setReportDisallowPeriod(uint256 _reportDisallowPeriodSeconds)
    external
    onlyOwner
    withinAllowedRange(_reportDisallowPeriodSeconds);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_reportDisallowPeriodSeconds`|`uint256`|Time period in seconds. Emits a [SetReportDisallowPeriod](/contracts/ConnectivityTrackerHbbft.sol/contract.ConnectivityTrackerHbbft.md#setreportdisallowperiod) event.|


### reportMissingConnectivity

Report that the connection to the specified validator was lost at block `blockNumber`.
Callable only by active validators.


```solidity
function reportMissingConnectivity(
    address validator,
    uint256 blockNumber,
    bytes32 blockHash
) external;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`validator`|`address`|Validator address with which the connection was lost.|
|`blockNumber`|`uint256`|Block number where the connection was lost.|
|`blockHash`|`bytes32`|Hash of this block. Emits a [ReportMissingConnectivity](/contracts/ConnectivityTrackerHbbft.sol/contract.ConnectivityTrackerHbbft.md#reportmissingconnectivity) event.|


### reportReconnect

Report that the connection to the specified validator was restored at block `blockNumber`.
Callable only by active validators.


```solidity
function reportReconnect(address validator, uint256 blockNumber, bytes32 blockHash) external;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`validator`|`address`|Validator address with which the connection was restored.|
|`blockNumber`|`uint256`|Block number where the connection was restored.|
|`blockHash`|`bytes32`|Hash of this block. Emits a [ReportReconnect](/contracts/ConnectivityTrackerHbbft.sol/contract.ConnectivityTrackerHbbft.md#reportreconnect) event.|


### penaliseFaultyValidators

Send bad performance bonus score penalties to validators
that have not yet reconnected at the end of the epoch.
Can only be called by {BlockRewardHbbft} contract.


```solidity
function penaliseFaultyValidators(uint256 epoch) external onlyBlockRewardContract;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`epoch`|`uint256`|Staking epoch number. Reverts with [EpochPenaltiesAlreadySent](/contracts/ConnectivityTrackerHbbft.sol/contract.ConnectivityTrackerHbbft.md#epochpenaltiesalreadysent) if penalties for specified `epoch` already sent.|


### isReported

Returns true if the validator `validator` was reported
by the specified `reporter`at the current epoch.


```solidity
function isReported(uint256, address validator, address reporter) external view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`||
|`validator`|`address`|Valdiator address.|
|`reporter`|`address`|Reporting validator address.|


### getValidatorConnectivityScore


```solidity
function getValidatorConnectivityScore(
    uint256 epoch,
    address validator
) public view returns (uint256);
```

### isFaultyValidator

Returns true if the validator `validator` was marked as faulty
(majority of other validators reported missing connectivity) in the specified `epoch`.


```solidity
function isFaultyValidator(uint256 epoch, address validator) public view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`epoch`|`uint256`|Staking epoch number.|
|`validator`|`address`|Validator address|


### checkReportMissingConnectivityCallable


```solidity
function checkReportMissingConnectivityCallable(
    address caller,
    address validator,
    uint256 blockNumber,
    bytes32 blockHash
) public view;
```

### checkReportReconnectCallable


```solidity
function checkReportReconnectCallable(
    address caller,
    address validator,
    uint256 blockNumber,
    bytes32 blockHash
) public view;
```

### getFlaggedValidatorsByEpoch

Get list of validators flagged for missing connectivity in the specified `epoch`.


```solidity
function getFlaggedValidatorsByEpoch(uint256 epoch) public view returns (address[] memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`epoch`|`uint256`|Staking epoch number.|


### getFlaggedValidators

Get list of validators flagged for missing connectivity in the current epoch.
See [getFlaggedValidatorsByEpoch](/contracts/ConnectivityTrackerHbbft.sol/contract.ConnectivityTrackerHbbft.md#getflaggedvalidatorsbyepoch).


```solidity
function getFlaggedValidators() public view returns (address[] memory);
```

### getFlaggedValidatorsCount

Get list of validators flagged for missing connectivity in the specified staking epoch `epoch`.


```solidity
function getFlaggedValidatorsCount(uint256 epoch) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`epoch`|`uint256`|Staking epoch number.|


### currentEpoch

Get current staking epoch number.
See {StakingHbbft-stakingEpoch}


```solidity
function currentEpoch() public view returns (uint256);
```

### earlyEpochEndThreshold

Returns the number of validators that, if exceeded,
will trigger an early end of the current staking epoch.


```solidity
function earlyEpochEndThreshold() public view returns (uint256);
```

### countFaultyValidators

Returns faulty validators count in given epoch `epoch`.


```solidity
function countFaultyValidators(uint256 epoch) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`epoch`|`uint256`|Staking epoch number.|


### _decideEarlyEpochEndNeeded


```solidity
function _decideEarlyEpochEndNeeded(uint256 epoch) private;
```

### _markValidatorFaulty


```solidity
function _markValidatorFaulty(uint256 epoch, address validator) private;
```

### _getReportersThreshold


```solidity
function _getReportersThreshold(uint256 epoch) private view returns (uint256);
```

### _countFaultyValidators


```solidity
function _countFaultyValidators(uint256 epoch) private view returns (uint256);
```

### _validateParams


```solidity
function _validateParams(
    uint256 epoch,
    address caller,
    uint256 blockNumber,
    bytes32 blockHash
) private view;
```

## Events
### SetReportDisallowPeriod
Emitted by the [setReportDisallowPeriod](/contracts/ConnectivityTrackerHbbft.sol/contract.ConnectivityTrackerHbbft.md#setreportdisallowperiod) function.


```solidity
event SetReportDisallowPeriod(uint256 _reportDisallowPeriodSeconds);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_reportDisallowPeriodSeconds`|`uint256`|New report disallow period value in seconds.|

### ReportMissingConnectivity
Emitted when `validator` was reported by `reporter` for lost connection at block `blockNumber`.


```solidity
event ReportMissingConnectivity(
    address indexed reporter,
    address indexed validator,
    uint256 indexed blockNumber
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`reporter`|`address`|Reporting validator address.|
|`validator`|`address`|Address of the validator with which the connection was lost.|
|`blockNumber`|`uint256`|Block number when connection was lost.|

### ReportReconnect
Emitted when `validator` was reported by `reporter` as reconnected at block `blockNumber`.


```solidity
event ReportReconnect(
    address indexed reporter,
    address indexed validator,
    uint256 indexed blockNumber
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`reporter`|`address`|Reporting validator address.|
|`validator`|`address`|Address of the reconnected validator.|
|`blockNumber`|`uint256`|Block number when reported validator reconnected.|

### NotifyEarlyEpochEnd
Emitted to signal that the count of disconnected validators exceeded
the threshold and current epoch `epoch` will end earlier.


```solidity
event NotifyEarlyEpochEnd(uint256 indexed epoch, uint256 indexed blockNumber);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`epoch`|`uint256`|Staking epoch number.|
|`blockNumber`|`uint256`|Block number in which the decision was made.|

## Errors
### AlreadyReported

```solidity
error AlreadyReported(address reporter, address validator);
```

### CannotReportByFlaggedValidator

```solidity
error CannotReportByFlaggedValidator(address reporter);
```

### InvalidBlock

```solidity
error InvalidBlock();
```

### OnlyValidator

```solidity
error OnlyValidator();
```

### ReportTooEarly

```solidity
error ReportTooEarly();
```

### UnknownReconnectReporter

```solidity
error UnknownReconnectReporter(address reporter, address validator);
```

### EpochPenaltiesAlreadySent

```solidity
error EpochPenaltiesAlreadySent(uint256 epoch);
```

