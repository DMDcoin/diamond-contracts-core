# ValidatorSetHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/ValidatorSetHbbft.sol)

**Inherits:**
Initializable, OwnableUpgradeable, [IValidatorSetHbbft](/contracts/interfaces/IValidatorSetHbbft.sol/interface.IValidatorSetHbbft.md)

Stores the current validator set and contains the logic for choosing new validators
before each staking epoch. The logic uses a random seed generated and stored by the `RandomHbbft` contract.


## State Variables
### _currentValidators

```solidity
address[] internal _currentValidators
```


### _pendingValidators

```solidity
address[] internal _pendingValidators
```


### _previousValidators

```solidity
address[] internal _previousValidators
```


### blockRewardContract
The address of the `BlockRewardHbbft` contract.


```solidity
address public blockRewardContract
```


### isValidator
A boolean flag indicating whether the specified mining address is in the current validator set.
See the `getValidators` getter.


```solidity
mapping(address => bool) public isValidator
```


### isValidatorPrevious
A boolean flag indicating whether the specified mining address was a validator in the previous set.
See the `getPreviousValidators` getter.


```solidity
mapping(address => bool) public isValidatorPrevious
```


### miningByStakingAddress
A mining address bound to a specified staking address.
See the `_setStakingAddress` internal function.


```solidity
mapping(address => address) public miningByStakingAddress
```


### randomContract
The `RandomHbbft` contract address.


```solidity
address public randomContract
```


### stakingByMiningAddress
A staking address bound to a specified mining address.
See the `_setStakingAddress` internal function.


```solidity
mapping(address => address) public stakingByMiningAddress
```


### stakingContract
The `StakingHbbft` contract address.


```solidity
IStakingHbbft public stakingContract
```


### keyGenHistoryContract
The `KeyGenHistory` contract address.


```solidity
IKeyGenHistory public keyGenHistoryContract
```


### validatorCounter
How many times the given mining address has become a validator.


```solidity
mapping(address => uint256) public validatorCounter
```


### validatorAvailableSinceLastWrite
holds timestamps of last changes in `validatorAvailableSince`


```solidity
mapping(address => uint256) public validatorAvailableSinceLastWrite
```


### validatorAvailableSince
holds Availability information for each specific mining address
unavailability happens if a validator gets voted to become a pending validator,
but misses out the sending of the ACK or PART within the given timeframe.
validators are required to declare availability,
in order to become available for voting again.
the value is of type timestamp


```solidity
mapping(address => uint256) public validatorAvailableSince
```


### maxValidators
The max number of validators.


```solidity
uint256 public maxValidators
```


### validatorInactivityThreshold
time in seconds after which the inactive validator is considered abandoned


```solidity
uint256 public validatorInactivityThreshold
```


### bonusScoreSystem

```solidity
IBonusScoreSystem public bonusScoreSystem
```


### connectivityTracker

```solidity
address public connectivityTracker
```


## Functions
### onlyBlockRewardContract

Ensures the caller is the BlockRewardHbbft contract address.


```solidity
modifier onlyBlockRewardContract() ;
```

### onlyStakingContract

Ensures the caller is the StakingHbbft contract address.


```solidity
modifier onlyStakingContract() ;
```

### onlyConnectivityTracker


```solidity
modifier onlyConnectivityTracker() ;
```

### constructor

**Note:**
oz-upgrades-unsafe-allow: constructor


```solidity
constructor() ;
```

### initialize

Initializes the network parameters. Used by the
constructor of the `InitializerHbbft` contract.


```solidity
function initialize(
    address _contractOwner,
    ValidatorSetParams calldata _params,
    address[] calldata _initialMiningAddresses,
    address[] calldata _initialStakingAddresses
) external initializer;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_contractOwner`|`address`|The address of the contract owner.|
|`_params`|`ValidatorSetParams`|ValidatorSetHbbft contract parameeters (introduced to avoid stack too deep issue): blockRewardContract The address of the `BlockRewardHbbft` contract. randomContract The address of the `RandomHbbft` contract. stakingContract The address of the `StakingHbbft` contract. keyGenHistoryContract The address of the `KeyGenHistory` contract. bonusScoreContract The address of the `BonusScoreSystem` contract. validatorInactivityThreshold The time of inactivity in seconds to consider validator abandoned|
|`_initialMiningAddresses`|`address[]`|The array of initial validators' mining addresses.|
|`_initialStakingAddresses`|`address[]`|The array of initial validators' staking addresses.|


### finalizeChange

Called by the system when a pending validator set is ready to be activated.
After this function is called, the `getValidators` getter returns the new validator set.
If this function finalizes, a new validator set is created by the `newValidatorSet` function.
an old validator set is also stored and can be read by the `getPreviousValidators` getter.


```solidity
function finalizeChange() external onlyBlockRewardContract;
```

### newValidatorSet

Implements the logic which forms a new validator set. If the number of active pools
is greater than maxValidators, the logic chooses the validators randomly using a random seed generated and
stored by the `RandomHbbft` contract.
Automatically called by the `BlockRewardHbbft.reward` function at the latest block of the staking epoch.


```solidity
function newValidatorSet() external onlyBlockRewardContract;
```

### announceAvailability

called by validators when a validator comes online after
getting marked as unavailable caused by a failed key generation.


```solidity
function announceAvailability(uint256 _blockNumber, bytes32 _blockhash) external;
```

### handleFailedKeyGeneration

called by blockreward contract when a the reward when the block reward contract
came to the conclusion that the validators could not manage to create a new shared key together.
this starts the process to find replacements for the failing candites,
as well as marking them unavailable.


```solidity
function handleFailedKeyGeneration() external onlyBlockRewardContract;
```

### notifyUnavailability

Notifies hbbft validator set contract that a validator
asociated with the given `_stakingAddress` became
unavailable and must be flagged as unavailable.


```solidity
function notifyUnavailability(address _miningAddress) external onlyConnectivityTracker;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_miningAddress`|`address`|The address of the validator which became unavailable.|


### setStakingAddress

Binds a mining address to the specified staking address. Called by the `StakingHbbft.addPool` function
when a user wants to become a candidate and creates a pool.
See also the `miningByStakingAddress` and `stakingByMiningAddress` public mappings.


```solidity
function setStakingAddress(
    address _miningAddress,
    address _stakingAddress
) external onlyStakingContract;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_miningAddress`|`address`|The mining address of the newly created pool. Cannot be equal to the `_stakingAddress` and should never be used as a pool before.|
|`_stakingAddress`|`address`|The staking address of the newly created pool. Cannot be equal to the `_miningAddress` and should never be used as a pool before.|


### setValidatorInternetAddress

set's the validators ip address.
this function can only be called by validators.


```solidity
function setValidatorInternetAddress(bytes16 _ip, bytes2 _port) external;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_ip`|`bytes16`|IPV4 address of a running Node Software or Proxy.|
|`_port`|`bytes2`|port for IPv4 address of a running Node Software or Proxy.|


### getStakingContract


```solidity
function getStakingContract() external view returns (address);
```

### isFullHealth

only a network with the maximum number of validators is considered to be at full health.
this is especially true for the use of the generated random numbers.


```solidity
function isFullHealth() external view virtual returns (bool);
```

### getCurrentValidatorsCount


```solidity
function getCurrentValidatorsCount() external view returns (uint256);
```

### getPreviousValidators

Returns the previous validator set (validators' mining addresses array).
The array is stored by the `finalizeChange` function
when a new staking epoch's validator set is finalized.


```solidity
function getPreviousValidators() external view returns (address[] memory);
```

### getPendingValidators

Returns the current array of pending validators i.e. waiting to be activated in the new epoch
The pending array is changed when a validator is removed as malicious
or the validator set is updated by the `newValidatorSet` function.


```solidity
function getPendingValidators() external view returns (address[] memory);
```

### getValidators

Returns the current validator set (an array of mining addresses)
which always matches the validator set kept in validator's node.


```solidity
function getValidators() external view returns (address[] memory);
```

### getPendingValidatorKeyGenerationMode


```solidity
function getPendingValidatorKeyGenerationMode(address _miningAddress)
    external
    view
    returns (KeyGenMode);
```

### isValidatorOrPending

Returns a boolean flag indicating whether the specified mining address is a validator
or is in the `_pendingValidators`.
Used by the `StakingHbbft.maxWithdrawAllowed` and `StakingHbbft.maxWithdrawOrderAllowed` getters.


```solidity
function isValidatorOrPending(address _miningAddress) external view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_miningAddress`|`address`|The mining address.|


### isPendingValidator

Returns a boolean flag indicating whether the specified mining address is a pending validator.
Used by the `isValidatorOrPending` and `KeyGenHistory.writeAck/Part` functions.


```solidity
function isPendingValidator(address _miningAddress) public view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_miningAddress`|`address`|The mining address.|


### canCallAnnounceAvailability

Returns if the specified _miningAddress is able to announce availability.


```solidity
function canCallAnnounceAvailability(address _miningAddress) public view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_miningAddress`|`address`|mining address that is allowed/disallowed.|


### publicKeyByStakingAddress

Returns the public key for the given stakingAddress


```solidity
function publicKeyByStakingAddress(address _stakingAddress)
    external
    view
    returns (bytes memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|staking address of the wanted public key.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes`|public key of the _stakingAddress|


### isValidatorAbandoned

Returns a boolean flag indicating whether the specified validator unavailable
for `validatorInactivityThreshold` seconds


```solidity
function isValidatorAbandoned(address _stakingAddress) external view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|staking pool address.|


### getPublicKey

Returns the public key for the given miningAddress


```solidity
function getPublicKey(address _miningAddress) external view returns (bytes memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_miningAddress`|`address`|mining address of the wanted public key.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes`|public key of the _miningAddress|


### getValidatorCountSweetSpot

in Hbbft there are sweet spots for the choice of validator counts
those are FLOOR((n - 1)/3) * 3 + 1
values: 1 - 4 - 7 - 10 - 13 - 16 - 19 - 22 - 25
more about: https://github.com/DMDcoin/hbbft-posdao-contracts/issues/84


```solidity
function getValidatorCountSweetSpot(uint256 _possibleValidatorCount)
    public
    pure
    returns (uint256);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|a sweet spot n for a given number n|


### _newValidatorSet


```solidity
function _newValidatorSet(address[] memory _forcedPools) internal;
```

### _finalizeNewValidators

Sets a new validator set stored in `_pendingValidators` array.
Called by the `finalizeChange` function.


```solidity
function _finalizeNewValidators() internal;
```

### _savePreviousValidators

Stores previous validators. Used by the `finalizeChange` function.


```solidity
function _savePreviousValidators() internal;
```

### _setPendingValidators

Sets a new validator set as a pending.
Called by the `newValidatorSet` function.


```solidity
function _setPendingValidators(address[] memory _stakingAddresses) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddresses`|`address[]`|The array of the new validators' staking addresses.|


### _setStakingAddress

Binds a mining address to the specified staking address. Used by the `setStakingAddress` function.
See also the `miningByStakingAddress` and `stakingByMiningAddress` public mappings.


```solidity
function _setStakingAddress(address _miningAddress, address _stakingAddress) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_miningAddress`|`address`|The mining address of the newly created pool. Cannot be equal to the `_stakingAddress` and should never be used as a pool before.|
|`_stakingAddress`|`address`|The staking address of the newly created pool. Cannot be equal to the `_miningAddress` and should never be used as a pool before.|


### _writeValidatorAvailableSince

Writes `validatorAvaialableSince` and saves timestamp of last change.


```solidity
function _writeValidatorAvailableSince(address _validator, uint256 _availableSince) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_validator`|`address`|validator address|
|`_availableSince`|`uint256`|timestamp when the validator became available, 0 if unavailable|


### _rewardValidatorsStandBy


```solidity
function _rewardValidatorsStandBy() internal;
```

### _penaliseValidatorsNoStandBy


```solidity
function _penaliseValidatorsNoStandBy() internal;
```

### _getRandomIndex

Returns an index of a pool in the `poolsToBeElected` array
(see the `StakingHbbft.getPoolsToBeElected` public getter)
by a random number and the corresponding probability coefficients.
Used by the `newValidatorSet` function.


```solidity
function _getRandomIndex(
    uint256[] memory _likelihood,
    uint256 _likelihoodSum,
    uint256 _randomNumber
) internal pure returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_likelihood`|`uint256[]`|An array of probability coefficients.|
|`_likelihoodSum`|`uint256`|A sum of probability coefficients.|
|`_randomNumber`|`uint256`|A random number.|


### _validateParams


```solidity
function _validateParams(ValidatorSetParams calldata _params) private pure;
```

## Events
### ValidatorAvailable

```solidity
event ValidatorAvailable(address validator, uint256 timestamp);
```

### ValidatorUnavailable
Emitted by the `handleFailedKeyGeneration` and `notifyUnavailability` functions to signal that a specific
validator was marked as unavailable since he dit not contribute to the required key shares or 2/3 of other
validators reporter him as disconnected.


```solidity
event ValidatorUnavailable(address validator, uint256 timestamp);
```

## Errors
### AnnounceBlockNumberTooOld

```solidity
error AnnounceBlockNumberTooOld();
```

### CantAnnounceAvailability

```solidity
error CantAnnounceAvailability();
```

### EpochNotYetFinished

```solidity
error EpochNotYetFinished();
```

### InitialAddressesLengthMismatch

```solidity
error InitialAddressesLengthMismatch();
```

### InitialValidatorsEmpty

```solidity
error InitialValidatorsEmpty();
```

### InvalidAddressPair

```solidity
error InvalidAddressPair();
```

### InvalidAnnounceBlockNumber

```solidity
error InvalidAnnounceBlockNumber();
```

### InvalidAnnounceBlockHash

```solidity
error InvalidAnnounceBlockHash();
```

### InvalidInactivityThreshold

```solidity
error InvalidInactivityThreshold();
```

### InvalidPossibleValidatorCount

```solidity
error InvalidPossibleValidatorCount();
```

### MiningAddressAlreadyUsed

```solidity
error MiningAddressAlreadyUsed(address _value);
```

### StakingAddressAlreadyUsed

```solidity
error StakingAddressAlreadyUsed(address _value);
```

### StakingPoolNotExist

```solidity
error StakingPoolNotExist(address _mining);
```

