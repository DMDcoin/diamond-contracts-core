# StakingHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/StakingHbbft.sol)

**Inherits:**
Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, [IStakingHbbft](/contracts/interfaces/IStakingHbbft.sol/interface.IStakingHbbft.md), [ValueGuards](/contracts/lib/ValueGuards.sol/abstract.ValueGuards.md)

Implements staking and withdrawal logic.


## Constants
### MAX_CANDIDATES
The max number of candidates (including validators). This limit was determined through stress testing.


```solidity
uint256 public constant MAX_CANDIDATES = 3000
```


### MAX_NODE_OPERATOR_SHARE_PERCENT

```solidity
uint256 public constant MAX_NODE_OPERATOR_SHARE_PERCENT = 2000
```


### PERCENT_DENOMINATOR

```solidity
uint256 public constant PERCENT_DENOMINATOR = 10_000
```


## State Variables
### _pools

```solidity
EnumerableSet.AddressSet private _pools
```


### _poolsInactive

```solidity
EnumerableSet.AddressSet private _poolsInactive
```


### _poolsToBeRemoved

```solidity
EnumerableSet.AddressSet private _poolsToBeRemoved
```


### _poolsToBeElected

```solidity
address[] private _poolsToBeElected
```


### _poolsLikelihood

```solidity
uint256[] private _poolsLikelihood
```


### _poolsLikelihoodSum

```solidity
uint256 private _poolsLikelihoodSum
```


### _poolDelegators

```solidity
mapping(address => EnumerableSet.AddressSet) private _poolDelegators
```


### _poolDelegatorsInactive

```solidity
mapping(address => EnumerableSet.AddressSet) private _poolDelegatorsInactive
```


### _stakeAmountByEpoch

```solidity
mapping(address => mapping(address => mapping(uint256 => uint256))) private _stakeAmountByEpoch
```


### candidateMinStake
The limit of the minimum candidate stake (CANDIDATE_MIN_STAKE).


```solidity
uint256 public candidateMinStake
```


### delegatorMinStake
The limit of the minimum delegator stake (DELEGATOR_MIN_STAKE).


```solidity
uint256 public delegatorMinStake
```


### maxStakeAmount
current limit of how many funds can
be staked on a single validator.


```solidity
uint256 public maxStakeAmount
```


### orderedWithdrawAmount
The current amount of staking coins ordered for withdrawal from the specified
pool by the specified staker. Used by the `orderWithdraw`, `claimOrderedWithdraw` and other functions.
The first parameter is the pool staking address, the second one is the staker address.


```solidity
mapping(address => mapping(address => uint256)) public orderedWithdrawAmount
```


### orderedWithdrawAmountTotal
The current total amount of staking coins ordered for withdrawal from
the specified pool by all of its stakers. Pool staking address is accepted as a parameter.


```solidity
mapping(address => uint256) public orderedWithdrawAmountTotal
```


### orderWithdrawEpoch
The number of the staking epoch during which the specified staker ordered
the latest withdraw from the specified pool. Used by the `claimOrderedWithdraw` function
to allow the ordered amount to be claimed only in future staking epochs. The first parameter
is the pool staking address, the second one is the staker address.


```solidity
mapping(address => mapping(address => uint256)) public orderWithdrawEpoch
```


### poolToBeElectedIndex
The pool's index in the array returned by the `getPoolsToBeElected` getter.
Used by the `_deletePoolToBeElected` and `_isPoolToBeElected` internal functions.
The pool staking address is accepted as a parameter.
If the value is zero, it may mean the array doesn't contain the address.
Check the address is in the array using the `getPoolsToBeElected` getter.


```solidity
mapping(address => uint256) public poolToBeElectedIndex
```


### stakeAmount
The amount of coins currently staked into the specified pool by the specified
staker. Doesn't include the amount ordered for withdrawal.
The first parameter is the pool staking address, the second one is the staker address.


```solidity
mapping(address => mapping(address => uint256)) public stakeAmount
```


### stakingWithdrawDisallowPeriod
deprecated


```solidity
uint256 public stakingWithdrawDisallowPeriod
```


### stakingEpoch
The serial number of the current staking epoch.


```solidity
uint256 public stakingEpoch
```


### stakingFixedEpochDuration
The fixed duration of each staking epoch before KeyGen starts i.e.
before the upcoming ("pending") validators are selected.


```solidity
uint256 public stakingFixedEpochDuration
```


### stakingTransitionTimeframeLength
Length of the timeframe in seconds for the transition to the new validator set.


```solidity
uint256 public stakingTransitionTimeframeLength
```


### stakingEpochStartTime
The timestamp of the last block of the the previous epoch.
The timestamp of the current epoch must be '>=' than this.


```solidity
uint256 public stakingEpochStartTime
```


### stakingEpochStartBlock
the blocknumber of the first block in this epoch.
this is mainly used for a historic lookup in the key gen history to read out the
ACKS and PARTS so a client is able to verify an epoch, even in the case that
the transition to the next epoch has already started,
and the information of the old keys is not available anymore.


```solidity
uint256 public stakingEpochStartBlock
```


### currentKeyGenExtraTimeWindow
the extra time window pending validators have to write
to write their honey badger key shares.
this value is increased in response to a failed key generation event,
if one or more validators miss out writing their key shares.


```solidity
uint256 public currentKeyGenExtraTimeWindow
```


### stakeAmountTotal
Returns the total amount of staking coins currently staked into the specified pool.
Doesn't include the amount ordered for withdrawal.
The pool staking address is accepted as a parameter.


```solidity
mapping(address => uint256) public stakeAmountTotal
```


### totalStakedAmount
Returns the total amount of staking coins currently staked on all pools.
Doesn't include the amount ordered for withdrawal.


```solidity
uint256 public totalStakedAmount
```


### validatorSetContract
The address of the `ValidatorSetHbbft` contract.


```solidity
IValidatorSetHbbft public validatorSetContract
```


### poolInfo

```solidity
mapping(address => PoolInfo) public poolInfo
```


### abandonedAndRemoved

```solidity
mapping(address => bool) public abandonedAndRemoved
```


### snapshotPoolTotalStakeAmount
The total amount staked into the specified pool (staking address)
before the specified staking epoch. Filled by the `_snapshotPoolStakeAmounts` function.


```solidity
mapping(uint256 => mapping(address => uint256)) public snapshotPoolTotalStakeAmount
```


### snapshotPoolValidatorStakeAmount
The validator's amount staked into the specified pool (staking address)
before the specified staking epoch. Filled by the `_snapshotPoolStakeAmounts` function.


```solidity
mapping(uint256 => mapping(address => uint256)) public snapshotPoolValidatorStakeAmount
```


### _delegatorStakeSnapshot
The delegator's staked amount snapshot for specified epoch
pool => delegator => epoch => stake amount


```solidity
mapping(address => mapping(address => mapping(uint256 => uint256))) internal
    _delegatorStakeSnapshot
```


### _stakeSnapshotLastEpoch
Number of last epoch when stake snapshot was taken. pool => delegator => epoch


```solidity
mapping(address => mapping(address => uint256)) internal _stakeSnapshotLastEpoch
```


### bonusScoreContract

```solidity
IBonusScoreSystem public bonusScoreContract
```


### poolNodeOperator
Address of node operator for specified pool.


```solidity
mapping(address => address) public poolNodeOperator
```


### poolNodeOperatorShare
Node operator share percent of total pool rewards.


```solidity
mapping(address => uint256) public poolNodeOperatorShare
```


### poolNodeOperatorLastChangeEpoch
The epoch number in which the operator's address can be changed.


```solidity
mapping(address => uint256) public poolNodeOperatorLastChangeEpoch
```


### earlyEpochEndTriggerTime
The timestamp of the block when early epoch end mechanism was triggered
due to validator set upscaling or faulty validators.


```solidity
uint256 public earlyEpochEndTriggerTime
```


## Functions
### gasPriceIsValid

Ensures the transaction gas price is not zero.


```solidity
modifier gasPriceIsValid() ;
```

### onlyValidatorSetContract

Ensures the caller is the ValidatorSetHbbft contract address.


```solidity
modifier onlyValidatorSetContract() virtual;
```

### onlyBlockRewardContract


```solidity
modifier onlyBlockRewardContract() ;
```

### onlyBonusScoreContract


```solidity
modifier onlyBonusScoreContract() ;
```

### constructor

**Note:**
oz-upgrades-unsafe-allow: constructor


```solidity
constructor() ;
```

### receive

Receive function. Prevents direct sending native coins to this contract.


```solidity
receive() external payable;
```

### initialize

Initializes the network parameters.
Can only be called by the constructor of the `InitializerHbbft` contract or owner.


```solidity
function initialize(
    address _contractOwner,
    StakingParams calldata stakingParams,
    bytes32[] calldata _publicKeys,
    bytes16[] calldata _internetAddresses
) external initializer;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_contractOwner`|`address`|The address of the contract owner|
|`stakingParams`|`StakingParams`|stores other parameters due to stack too deep issue _validatorSetContract The address of the `ValidatorSetHbbft` contract. _initialStakingAddresses The array of initial validators' staking addresses. _delegatorMinStake The minimum allowed amount of delegator stake in Wei. _candidateMinStake The minimum allowed amount of candidate/validator stake in Wei. _stakingFixedEpochDuration The fixed duration of each epoch before keyGen starts. _stakingTransitionTimeframeLength Length of the timeframe in seconds for the transition to the new validator set. _stakingWithdrawDisallowPeriod Deprecated. Left to not break compatibility. during which participants cannot stake/withdraw/order/claim their staking coins|
|`_publicKeys`|`bytes32[]`||
|`_internetAddresses`|`bytes16[]`||


### initializeV3


```solidity
function initializeV3() external reinitializer(3);
```

### setDelegatorMinStake

Sets the minimum stake required for delegators.


```solidity
function setDelegatorMinStake(uint256 _minStake)
    external
    onlyOwner
    withinAllowedRange(_minStake);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_minStake`|`uint256`|The new minimum stake amount. Requirements: - Only the contract owner can call this function. - The stake amount must be within the allowed range. Emits a [SetDelegatorMinStake](/contracts/StakingHbbft.sol/contract.StakingHbbft.md#setdelegatorminstake) event.|


### setStakingEpochStartTime

Sets the timetamp of the current epoch's last block as the start time of the upcoming staking epoch.
Called by the `ValidatorSetHbbft.newValidatorSet` function at the last block of a staking epoch.


```solidity
function setStakingEpochStartTime(uint256 _timestamp) external onlyValidatorSetContract;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_timestamp`|`uint256`|The starting time of the very first block in the upcoming staking epoch.|


### setValidatorInternetAddress

set's the validators ip address.
this function can only be called by the validator Set contract.


```solidity
function setValidatorInternetAddress(
    address _validatorAddress,
    bytes16 _ip,
    bytes2 _port
) external onlyValidatorSetContract;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_validatorAddress`|`address`|address if the validator. (mining address)|
|`_ip`|`bytes16`|IPV4 address of a running Node Software or Proxy.|
|`_port`|`bytes2`||


### incrementStakingEpoch

Increments the serial number of the current staking epoch.
Called by the `ValidatorSetHbbft.newValidatorSet` at the last block of the finished staking epoch.


```solidity
function incrementStakingEpoch() external onlyValidatorSetContract;
```

### notifyKeyGenFailed

Notifies hbbft staking contract that the
key generation has failed, and a new round
of keygeneration starts.


```solidity
function notifyKeyGenFailed() public onlyValidatorSetContract;
```

### notifyNetworkOfftimeDetected

Notifies hbbft staking contract about a detected
network offline time.
if there is no handling for this,
validators got chosen outside the transition timewindow
and get banned immediatly, since they never got their chance
to write their keys.
more about: https://github.com/DMDcoin/hbbft-posdao-contracts/issues/96


```solidity
function notifyNetworkOfftimeDetected(uint256 detectedOfflineTime)
    public
    onlyValidatorSetContract;
```

### notifyAvailability

Notifies hbbft staking contract that a validator
asociated with the given `_stakingAddress` became
available again and can be put on to the list
of available nodes again.


```solidity
function notifyAvailability(address _stakingAddress) public onlyValidatorSetContract;
```

### notifyEarlyEpochEnd


```solidity
function notifyEarlyEpochEnd(uint256 timestamp) external onlyBlockRewardContract;
```

### addPool

Adds a new candidate's pool to the list of active pools (see the `getPools` getter) and
moves the specified amount of staking coins from the candidate's staking address
to the candidate's pool. A participant calls this function using their staking address when
they want to create a pool. This is a wrapper for the `stake` function.


```solidity
function addPool(
    address _miningAddress,
    address _nodeOperatorAddress,
    uint256 _operatorShare,
    bytes calldata _publicKey,
    bytes16 _ip
) external payable gasPriceIsValid;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_miningAddress`|`address`|The mining address of the candidate. The mining address is bound to the staking address (msg.sender). This address cannot be equal to `msg.sender`.|
|`_nodeOperatorAddress`|`address`|Address of node operator, will receive `_operatorShare` of epoch rewards.|
|`_operatorShare`|`uint256`|Percent of epoch rewards to send to `_nodeOperatorAddress`. Integer value with 2 decimal places, e.g. 1% = 100, 10.25% = 1025.|
|`_publicKey`|`bytes`||
|`_ip`|`bytes16`||


### removeMyPool

Removes the candidate's or validator's pool from the `pools` array (a list of active pools which
can be retrieved by the `getPools` getter). When a candidate or validator wants to remove their pool,
they should call this function from their staking address.


```solidity
function removeMyPool() external gasPriceIsValid;
```

### setPoolInfo

set's the pool info for a specific ethereum address.


```solidity
function setPoolInfo(bytes calldata _publicKey, bytes16 _ip, bytes2 _port) external;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_publicKey`|`bytes`|public key of the (future) signing address.|
|`_ip`|`bytes16`|(optional) IPV4 address of a running Node Software or Proxy.|
|`_port`|`bytes2`|(optional) port of IPv4 address of a running Node Software or Proxy. Stores the supplied data for a staking (pool) address. This function is external available without security checks, since no array operations are used in the implementation, this allows the flexibility to set the pool information before adding the stake to the pool.|


### setNodeOperator

Set's the pool node operator configuration for a specific ethereum address.


```solidity
function setNodeOperator(address _operatorAddress, uint256 _operatorShare) external;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_operatorAddress`|`address`|Node operator address.|
|`_operatorShare`|`uint256`|Node operator reward share percent.|


### removePool

Removes a specified pool from the `pools` array (a list of active pools which can be retrieved by the
`getPools` getter). Called by the `ValidatorSetHbbft._removeMaliciousValidator` internal function,
and the `ValidatorSetHbbft.handleFailedKeyGeneration` function
when a pool must be removed by the algorithm.


```solidity
function removePool(address _stakingAddress) external onlyValidatorSetContract;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The staking address of the pool to be removed.|


### removePools

Removes pools which are in the `_poolsToBeRemoved` internal array from the `pools` array.
Called by the `ValidatorSetHbbft.newValidatorSet` function when a pool must be removed by the algorithm.


```solidity
function removePools() external onlyValidatorSetContract;
```

### stake

Moves the specified amount of staking coins from the staker's address to the staking address of
the specified pool. Actually, the amount is stored in a balance of this StakingHbbft contract.
A staker calls this function when they want to make a stake into a pool.


```solidity
function stake(address _toPoolStakingAddress) external payable gasPriceIsValid;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_toPoolStakingAddress`|`address`|The staking address of the pool where the coins should be staked.|


### withdraw

Moves the specified amount of staking coins from the staking address of
the specified pool to the staker's address. A staker calls this function when they want to withdraw
their coins.


```solidity
function withdraw(
    address _fromPoolStakingAddress,
    uint256 _amount
) external gasPriceIsValid nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_fromPoolStakingAddress`|`address`|The staking address of the pool from which the coins should be withdrawn.|
|`_amount`|`uint256`|The amount of coins to be withdrawn. The amount cannot exceed the value returned by the `maxWithdrawAllowed` getter.|


### moveStake

Moves staking coins from one pool to another. A staker calls this function when they want
to move their coins from one pool to another without withdrawing their coins.


```solidity
function moveStake(
    address _fromPoolStakingAddress,
    address _toPoolStakingAddress,
    uint256 _amount
) external gasPriceIsValid;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_fromPoolStakingAddress`|`address`|The staking address of the source pool.|
|`_toPoolStakingAddress`|`address`|The staking address of the target pool.|
|`_amount`|`uint256`|The amount of staking coins to be moved. The amount cannot exceed the value returned by the `maxWithdrawAllowed` getter.|


### restake


```solidity
function restake(
    address _poolStakingAddress,
    uint256 _validatorMinRewardPercent
) external payable onlyBlockRewardContract;
```

### orderWithdraw

Orders coins withdrawal from the staking address of the specified pool to the
staker's address. The requested coins can be claimed after the current staking epoch is complete using
the `claimOrderedWithdraw` function.


```solidity
function orderWithdraw(address _poolStakingAddress, int256 _amount) external gasPriceIsValid;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The staking address of the pool from which the amount will be withdrawn.|
|`_amount`|`int256`|The amount to be withdrawn. A positive value means the staker wants to either set or increase their withdrawal amount. A negative value means the staker wants to decrease a withdrawal amount that was previously set. The amount cannot exceed the value returned by the `maxWithdrawOrderAllowed` getter.|


### claimOrderedWithdraw

Withdraws the staking coins from the specified pool ordered during the previous staking epochs with
the `orderWithdraw` function. The ordered amount can be retrieved by the `orderedWithdrawAmount` getter.


```solidity
function claimOrderedWithdraw(address _poolStakingAddress)
    external
    gasPriceIsValid
    nonReentrant;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The staking address of the pool from which the ordered coins are withdrawn.|


### recoverAbandonedStakes

Distribute abandoned stakes among Reinsert and Governance pots.
50% goes to reinsert and 50% to governance pot.
Coins are considered abandoned if they were staked on a validator inactive for 10 years.


```solidity
function recoverAbandonedStakes() external gasPriceIsValid;
```

### snapshotPoolStakeAmounts

Makes snapshots of total amount staked into the specified pool
before the specified staking epoch. Used by the `reward` function.


```solidity
function snapshotPoolStakeAmounts(
    uint256 _epoch,
    address _stakingPool
) external onlyBlockRewardContract;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_epoch`|`uint256`|The number of upcoming staking epoch.|
|`_stakingPool`|`address`|The staking address of the pool.|


### updatePoolLikelihood


```solidity
function updatePoolLikelihood(
    address mining,
    uint256 validatorScore
) external onlyBonusScoreContract;
```

### getPools

Returns an array of the current active pools (the staking addresses of candidates and validators).
The size of the array cannot exceed MAX_CANDIDATES. A pool can be added to this array with the `_addPoolActive`
internal function which is called by the `stake` or `orderWithdraw` function. A pool is considered active
if its address has at least the minimum stake and this stake is not ordered to be withdrawn.


```solidity
function getPools() external view returns (address[] memory);
```

### getPoolPublicKey

Return the Public Key used by a Node to send targeted HBBFT Consensus Messages.


```solidity
function getPoolPublicKey(address _poolAddress) external view returns (bytes memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolAddress`|`address`|The Pool Address to query the public key for.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes`|the public key for the given pool address. Note that the public key does not convert to the ethereum address of the pool address. The pool address is used for stacking, and not for signing HBBFT messages.|


### getPoolInternetAddress

Returns the registered IPv4 Address for the node.


```solidity
function getPoolInternetAddress(address _poolAddress) external view returns (bytes16, bytes2);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolAddress`|`address`|The Pool Address to query the IPv4Address for.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bytes16`|IPv4 Address for the given pool address.|
|`<none>`|`bytes2`||


### getPoolsInactive

Returns an array of the current inactive pools (the staking addresses of former candidates).
A pool can be added to this array with the `_addPoolInactive` internal function which is called
by `_removePool`. A pool is considered inactive if it is banned for some reason, if its address
has zero stake, or if its entire stake is ordered to be withdrawn.


```solidity
function getPoolsInactive() external view returns (address[] memory);
```

### getPoolsLikelihood

Returns the array of stake amounts for each corresponding
address in the `poolsToBeElected` array (see the `getPoolsToBeElected` getter) and a sum of these amounts.
Used by the `ValidatorSetHbbft.newValidatorSet` function when randomly selecting new validators at the last
block of a staking epoch. An array value is updated every time any staked amount is changed in this pool
(see the `_setLikelihood` internal function).


```solidity
function getPoolsLikelihood()
    external
    view
    returns (uint256[] memory likelihoods, uint256 sum);
```
**Returns**

|Name|Type|Description|
|----|----|-----------|
|`likelihoods`|`uint256[]`|`uint256[] likelihoods` - The array of the coefficients. The array length is always equal to the length of the `poolsToBeElected` array. `uint256 sum` - The total sum of the amounts.|
|`sum`|`uint256`||


### getPoolsToBeElected

Returns the list of pools (their staking addresses) which will participate in a new validator set
selection process in the `ValidatorSetHbbft.newValidatorSet` function. This is an array of pools
which will be considered as candidates when forming a new validator set (at the last block of a staking epoch).
This array is kept updated by the `_addPoolToBeElected` and `_deletePoolToBeElected` internal functions.


```solidity
function getPoolsToBeElected() external view returns (address[] memory);
```

### getPoolsToBeRemoved

Returns the list of pools (their staking addresses) which will be removed by the
`ValidatorSetHbbft.newValidatorSet` function from the active `pools` array (at the last block
of a staking epoch). This array is kept updated by the `_addPoolToBeRemoved`
and `_deletePoolToBeRemoved` internal functions. A pool is added to this array when the pool's
address withdraws (or orders) all of its own staking coins from the pool, inactivating the pool.


```solidity
function getPoolsToBeRemoved() external view returns (address[] memory);
```

### getPoolValidatorStakeAmount


```solidity
function getPoolValidatorStakeAmount(
    uint256 _epoch,
    address _stakingPool
) external view returns (uint256);
```

### isPoolActive

Returns a flag indicating whether a specified address is in the `pools` array.
See the `getPools` getter.


```solidity
function isPoolActive(address _stakingAddress) public view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The staking address of the pool.|


### isPoolValid

Returns a flag indicating whether a specified address is in the `_pools` or `poolsInactive` array.


```solidity
function isPoolValid(address _stakingAddress) public view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The staking address of the pool.|


### maxWithdrawAllowed

Returns the maximum amount which can be withdrawn from the specified pool by the specified staker
at the moment. Used by the `withdraw` and `moveStake` functions.


```solidity
function maxWithdrawAllowed(
    address _poolStakingAddress,
    address _staker
) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address from which the withdrawal will be made.|
|`_staker`|`address`|The staker address that is going to withdraw.|


### maxWithdrawOrderAllowed

Returns the maximum amount which can be ordered to be withdrawn from the specified pool by the
specified staker at the moment. Used by the `orderWithdraw` function.


```solidity
function maxWithdrawOrderAllowed(
    address _poolStakingAddress,
    address _staker
) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address from which the withdrawal will be ordered.|
|`_staker`|`address`|The staker address that is going to order the withdrawal.|


### poolDelegators

Returns an array of the current active delegators of the specified pool.
A delegator is considered active if they have staked into the specified
pool and their stake is not ordered to be withdrawn.


```solidity
function poolDelegators(address _poolStakingAddress) public view returns (address[] memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address.|


### poolDelegatorsInactive

Returns an array of the current inactive delegators of the specified pool.
A delegator is considered inactive if their entire stake is ordered to be withdrawn
but not yet claimed.


```solidity
function poolDelegatorsInactive(address _poolStakingAddress)
    public
    view
    returns (address[] memory);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address.|


### stakeAmountByCurrentEpoch

Returns the amount of staking coins staked into the specified pool by the specified staker
during the current staking epoch (see the `stakingEpoch` getter).
Used by the `stake`, `withdraw`, and `orderWithdraw` functions.


```solidity
function stakeAmountByCurrentEpoch(
    address _poolStakingAddress,
    address _staker
) public view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address.|
|`_staker`|`address`|The staker's address.|


### startTimeOfNextPhaseTransition

indicates the time when the new validatorset for the next epoch gets chosen.
this is the start of a timeframe before the end of the epoch,
that is long enough for the validators
to create a new shared key.


```solidity
function startTimeOfNextPhaseTransition() public view returns (uint256);
```

### stakingFixedEpochEndTime

Returns an indicative time of the last block of the current staking epoch before key generation starts.


```solidity
function stakingFixedEpochEndTime() public view returns (uint256);
```

### earlyEpochEndTime


```solidity
function earlyEpochEndTime() public view returns (uint256);
```

### actualEpochEndTime


```solidity
function actualEpochEndTime() public view returns (uint256);
```

### _addPoolActive

Adds the specified staking address to the array of active pools returned by
the `getPools` getter. Used by the `stake`, `addPool`, and `orderWithdraw` functions.


```solidity
function _addPoolActive(address _stakingAddress, bool _toBeElected) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The pool added to the array of active pools.|
|`_toBeElected`|`bool`|The boolean flag which defines whether the specified address should be added simultaneously to the `poolsToBeElected` array. See the `getPoolsToBeElected` getter.|


### _addPoolInactive

Adds the specified staking address to the array of inactive pools returned by
the `getPoolsInactive` getter. Used by the `_removePool` internal function.


```solidity
function _addPoolInactive(address _stakingAddress) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The pool added to the array of inactive pools.|


### _addPoolToBeElected

Adds the specified staking address to the array of pools returned by the `getPoolsToBeElected`
getter. Used by the `_addPoolActive` internal function. See the `getPoolsToBeElected` getter.


```solidity
function _addPoolToBeElected(address _stakingAddress) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The pool added to the `poolsToBeElected` array.|


### _addPoolToBeRemoved

Adds the specified staking address to the array of pools returned by the `getPoolsToBeRemoved`
getter. Used by withdrawal functions. See the `getPoolsToBeRemoved` getter.


```solidity
function _addPoolToBeRemoved(address _stakingAddress) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The pool added to the `poolsToBeRemoved` array.|


### _deletePoolToBeElected

Deletes the specified staking address from the array of pools returned by the
`getPoolsToBeElected` getter. Used by the `_addPoolToBeRemoved` and `_removePool` internal functions.
See the `getPoolsToBeElected` getter.


```solidity
function _deletePoolToBeElected(address _stakingAddress) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The pool deleted from the `poolsToBeElected` array.|


### _deletePoolToBeRemoved

Deletes the specified staking address from the array of pools returned by the
`getPoolsToBeRemoved` getter. Used by the `_addPoolToBeElected` and `_removePool` internal functions.
See the `getPoolsToBeRemoved` getter.


```solidity
function _deletePoolToBeRemoved(address _stakingAddress) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The pool deleted from the `poolsToBeRemoved` array.|


### _removePool

Removes the specified staking address from the array of active pools returned by
the `getPools` getter. Used by the `removePool`, `removeMyPool`, and withdrawal functions.


```solidity
function _removePool(address _stakingAddress) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The pool removed from the array of active pools.|


### _validateStakingParams


```solidity
function _validateStakingParams(StakingParams calldata params) private pure;
```

### _getMaxCandidates

Returns the max number of candidates (including validators). See the MAX_CANDIDATES constant.
Needed mostly for unit tests.


```solidity
function _getMaxCandidates() internal pure virtual returns (uint256);
```

### _addPoolDelegator

Adds the specified address to the array of the current active delegators of the specified pool.
Used by the `stake` and `orderWithdraw` functions. See the `poolDelegators` getter.


```solidity
function _addPoolDelegator(address _poolStakingAddress, address _delegator) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address.|
|`_delegator`|`address`|The delegator's address.|


### _addPoolDelegatorInactive

Adds the specified address to the array of the current inactive delegators of the specified pool.
Used by the `_removePoolDelegator` internal function.


```solidity
function _addPoolDelegatorInactive(address _poolStakingAddress, address _delegator) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address.|
|`_delegator`|`address`|The delegator's address.|


### _removePoolDelegator

Removes the specified address from the array of the current active delegators of the specified pool.
Used by the withdrawal functions. See the `poolDelegators` getter.


```solidity
function _removePoolDelegator(address _poolStakingAddress, address _delegator) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address.|
|`_delegator`|`address`|The delegator's address.|


### _removePoolDelegatorInactive

Removes the specified address from the array of the inactive delegators of the specified pool.
Used by the `_addPoolDelegator` and `_removePoolDelegator` internal functions.


```solidity
function _removePoolDelegatorInactive(address _poolStakingAddress, address _delegator) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address.|
|`_delegator`|`address`|The delegator's address.|


### _setLikelihood

Calculates (updates) the probability of being selected as a validator for the specified pool
and updates the total sum of probability coefficients. Actually, the probability is equal to the
amount totally staked into the pool multiplied by validator bonus score. See the `getPoolsLikelihood` getter.
Used by the staking and withdrawal functions.


```solidity
function _setLikelihood(address _poolStakingAddress) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The address of the pool for which the probability coefficient must be updated.|


### _updateLikelihood


```solidity
function _updateLikelihood(address _poolStakingAddress, uint256 validatorBonusScore) private;
```

### _stake

The internal function used by the `_stake` and `moveStake` functions.
See the `stake` public function for more details.


```solidity
function _stake(address _poolStakingAddress, address _staker, uint256 _amount) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The staking address of the pool where the coins should be staked.|
|`_staker`|`address`|The staker's address.|
|`_amount`|`uint256`|The amount of coins to be staked.|


### _withdraw

The internal function used by the `withdraw` and `moveStake` functions.
See the `withdraw` public function for more details.


```solidity
function _withdraw(address _poolStakingAddress, address _staker, uint256 _amount) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The staking address of the pool from which the coins should be withdrawn.|
|`_staker`|`address`|The staker's address.|
|`_amount`|`uint256`|The amount of coins to be withdrawn.|


### _withdrawCheckPool

The internal function used by the `_withdraw` and `claimOrderedWithdraw` functions.
Contains a common logic for these functions.


```solidity
function _withdrawCheckPool(address _poolStakingAddress, address _staker) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The staking address of the pool from which the coins are withdrawn.|
|`_staker`|`address`|The staker's address.|


### _snapshotDelegatorStake


```solidity
function _snapshotDelegatorStake(address _stakingAddress, address _delegator) private;
```

### _setNodeOperator


```solidity
function _setNodeOperator(
    address _stakingAddress,
    address _operatorAddress,
    uint256 _operatorSharePercent
) private;
```

### _rewardNodeOperator


```solidity
function _rewardNodeOperator(address _stakingAddress, uint256 _operatorShare) private;
```

### _getDelegatorStake


```solidity
function _getDelegatorStake(
    uint256 _stakingEpoch,
    address _stakingAddress,
    address _delegator
) private view returns (uint256);
```

### _isPoolEmpty

Returns a boolean flag indicating whether the specified pool is fully empty
(all stakes are withdrawn including ordered withdrawals).


```solidity
function _isPoolEmpty(address _poolStakingAddress) private view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The staking address of the pool|


### _isPoolToBeElected

Determines if the specified pool is in the `poolsToBeElected` array. See the `getPoolsToBeElected` getter.
Used by the `_setLikelihood` internal function.


```solidity
function _isPoolToBeElected(address _stakingAddress)
    private
    view
    returns (bool toBeElected, uint256 index);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingAddress`|`address`|The staking address of the pool.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`toBeElected`|`bool`|`bool toBeElected` - The boolean flag indicating whether the `_stakingAddress` is in the `poolsToBeElected` array. `uint256 index` - The position of the item in the `poolsToBeElected` array if `toBeElected` is `true`.|
|`index`|`uint256`||


### _splitPoolReward


```solidity
function _splitPoolReward(
    address _poolAddress,
    uint256 _poolReward,
    uint256 _validatorMinRewardPercent
) private view returns (PoolRewardShares memory shares);
```

### _distributeDelegatorReward

Distributes reward to a delegator based on their stake snapshot.


```solidity
function _distributeDelegatorReward(
    address _poolStakingAddress,
    address _delegator,
    uint256 _delegatorsShare,
    uint256 _totalStake
) private returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_poolStakingAddress`|`address`|The pool staking address.|
|`_delegator`|`address`|The pool delegator address.|
|`_delegatorsShare`|`uint256`|The total share to distribute among all delegators.|
|`_totalStake`|`uint256`|The total pool stake at epoch start.|


### updateStakingTransitionTimeframeLength

For deployment, the length of stakingTransitionTimeframeLength was chosen not long enough, leading to bonus score losses.
see https://github.com/DMDcoin/Beta1/issues/6 for more infos.


```solidity
function updateStakingTransitionTimeframeLength() external;
```

## Events
### ClaimedOrderedWithdrawal
Emitted by the `claimOrderedWithdraw` function to signal the staker withdrew the specified
amount of requested coins from the specified pool during the specified staking epoch.


```solidity
event ClaimedOrderedWithdrawal(
    address indexed fromPoolStakingAddress,
    address indexed staker,
    uint256 indexed stakingEpoch,
    uint256 amount
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`fromPoolStakingAddress`|`address`|The pool from which the `staker` withdrew the `amount`.|
|`staker`|`address`|The address of the staker that withdrew the `amount`.|
|`stakingEpoch`|`uint256`|The serial number of the staking epoch during which the claim was made.|
|`amount`|`uint256`|The withdrawal amount.|

### MovedStake
Emitted by the `moveStake` function to signal the staker moved the specified
amount of stake from one pool to another during the specified staking epoch.


```solidity
event MovedStake(
    address fromPoolStakingAddress,
    address indexed toPoolStakingAddress,
    address indexed staker,
    uint256 indexed stakingEpoch,
    uint256 amount
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`fromPoolStakingAddress`|`address`|The pool from which the `staker` moved the stake.|
|`toPoolStakingAddress`|`address`|The destination pool where the `staker` moved the stake.|
|`staker`|`address`|The address of the staker who moved the `amount`.|
|`stakingEpoch`|`uint256`|The serial number of the staking epoch during which the `amount` was moved.|
|`amount`|`uint256`|The stake amount which was moved.|

### OrderedWithdrawal
Emitted by the `orderWithdraw` function to signal the staker ordered the withdrawal of the
specified amount of their stake from the specified pool during the specified staking epoch.


```solidity
event OrderedWithdrawal(
    address indexed fromPoolStakingAddress,
    address indexed staker,
    uint256 indexed stakingEpoch,
    int256 amount
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`fromPoolStakingAddress`|`address`|The pool from which the `staker` ordered a withdrawal of the `amount`.|
|`staker`|`address`|The address of the staker that ordered the withdrawal of the `amount`.|
|`stakingEpoch`|`uint256`|The serial number of the staking epoch during which the order was made.|
|`amount`|`int256`|The ordered withdrawal amount. Can be either positive or negative. See the `orderWithdraw` function.|

### PlacedStake
Emitted by the `stake` function to signal the staker placed a stake of the specified
amount for the specified pool during the specified staking epoch.


```solidity
event PlacedStake(
    address indexed toPoolStakingAddress,
    address indexed staker,
    uint256 indexed stakingEpoch,
    uint256 amount
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`toPoolStakingAddress`|`address`|The pool in which the `staker` placed the stake.|
|`staker`|`address`|The address of the staker that placed the stake.|
|`stakingEpoch`|`uint256`|The serial number of the staking epoch during which the stake was made.|
|`amount`|`uint256`|The stake amount.|

### WithdrewStake
Emitted by the `withdraw` function to signal the staker withdrew the specified
amount of a stake from the specified pool during the specified staking epoch.


```solidity
event WithdrewStake(
    address indexed fromPoolStakingAddress,
    address indexed staker,
    uint256 indexed stakingEpoch,
    uint256 amount
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`fromPoolStakingAddress`|`address`|The pool from which the `staker` withdrew the `amount`.|
|`staker`|`address`|The address of staker that withdrew the `amount`.|
|`stakingEpoch`|`uint256`|The serial number of the staking epoch during which the withdrawal was made.|
|`amount`|`uint256`|The withdrawal amount.|

### GatherAbandonedStakes

```solidity
event GatherAbandonedStakes(
    address indexed caller,
    address indexed stakingAddress,
    uint256 gatheredFunds
);
```

### RecoverAbandonedStakes

```solidity
event RecoverAbandonedStakes(
    address indexed caller,
    uint256 reinsertShare,
    uint256 governanceShare
);
```

### RestakeReward
Emitted by the `restake` function to signal the epoch reward was restaked to the pool.


```solidity
event RestakeReward(
    address indexed poolStakingAddress,
    uint256 indexed stakingEpoch,
    uint256 validatorReward,
    uint256 delegatorsReward
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`poolStakingAddress`|`address`|The pool for which the restake will be performed.|
|`stakingEpoch`|`uint256`|The serial number of the staking epoch during which the restake was made.|
|`validatorReward`|`uint256`|The amount of tokens restaked for the validator.|
|`delegatorsReward`|`uint256`|The total amount of tokens restaked for the `poolStakingAddress` delegators.|

### SetNodeOperator
Emitted by the `_setNodeOperator` function.


```solidity
event SetNodeOperator(
    address indexed poolStakingAddress,
    address indexed nodeOperatorAddress,
    uint256 operatorShare
);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`poolStakingAddress`|`address`|The pool for which node operator was configured.|
|`nodeOperatorAddress`|`address`|Address of node operator address related to `poolStakingAddress`.|
|`operatorShare`|`uint256`|Node operator share percent.|

### SetDelegatorMinStake
Emitted when the minimum stake for a delegator is updated.


```solidity
event SetDelegatorMinStake(uint256 minStake);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`minStake`|`uint256`|The new minimum stake value.|

## Errors
### CannotClaimWithdrawOrderYet

```solidity
error CannotClaimWithdrawOrderYet(address pool, address staker);
```

### OnlyOncePerEpoch

```solidity
error OnlyOncePerEpoch(uint256 _epoch);
```

### MaxPoolsCountExceeded

```solidity
error MaxPoolsCountExceeded();
```

### MaxAllowedWithdrawExceeded

```solidity
error MaxAllowedWithdrawExceeded(uint256 allowed, uint256 desired);
```

### NoStakesToRecover

```solidity
error NoStakesToRecover();
```

### NotPayable

```solidity
error NotPayable();
```

### PoolAbandoned

```solidity
error PoolAbandoned(address pool);
```

### PoolCannotBeRemoved

```solidity
error PoolCannotBeRemoved(address pool);
```

### PoolEmpty

```solidity
error PoolEmpty(address pool);
```

### PoolNotExist

```solidity
error PoolNotExist(address pool);
```

### PoolStakeLimitExceeded

```solidity
error PoolStakeLimitExceeded(address pool, address delegator);
```

### InitialStakingPoolsListEmpty

```solidity
error InitialStakingPoolsListEmpty();
```

### InsufficientStakeAmount

```solidity
error InsufficientStakeAmount(address pool, address delegator);
```

### InvalidFixedEpochDuration

```solidity
error InvalidFixedEpochDuration();
```

### InvalidInitialStakeAmount

```solidity
error InvalidInitialStakeAmount(uint256 candidateStake, uint256 delegatorStake);
```

### InvalidIpAddressesCount

```solidity
error InvalidIpAddressesCount();
```

### InvalidMaxStakeAmount

```solidity
error InvalidMaxStakeAmount();
```

### InvalidMoveStakePoolsAddress

```solidity
error InvalidMoveStakePoolsAddress();
```

### InvalidOrderWithdrawAmount

```solidity
error InvalidOrderWithdrawAmount(address pool, address delegator, int256 amount);
```

### InvalidPublicKeysCount

```solidity
error InvalidPublicKeysCount();
```

### InvalidTransitionTimeFrame

```solidity
error InvalidTransitionTimeFrame();
```

### InvalidWithdrawAmount

```solidity
error InvalidWithdrawAmount(address pool, address delegator, uint256 amount);
```

### InvalidNodeOperatorConfiguration

```solidity
error InvalidNodeOperatorConfiguration(address _operator, uint256 _share);
```

### InvalidNodeOperatorShare

```solidity
error InvalidNodeOperatorShare(uint256 _share);
```

### InvalidNodeOperatorAddress

```solidity
error InvalidNodeOperatorAddress(address _operator);
```

### InvalidPublicKey

```solidity
error InvalidPublicKey();
```

### ZeroWidthrawAmount

```solidity
error ZeroWidthrawAmount();
```

### MiningAddressPublicKeyMismatch

```solidity
error MiningAddressPublicKeyMismatch();
```

## Structs
### PoolInfo

```solidity
struct PoolInfo {
    bytes publicKey;
    bytes16 internetAddress;
    bytes2 port;
}
```

