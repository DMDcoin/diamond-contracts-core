# BlockRewardHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/BlockRewardHbbft.sol)

**Inherits:**
Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, [ValueGuards](/contracts/lib/ValueGuards.sol/abstract.ValueGuards.md), [IBlockRewardHbbft](/contracts/interfaces/IBlockRewardHbbft.sol/interface.IBlockRewardHbbft.md)

Generates and distributes rewards according to the logic and formulas described in the POSDAO white paper.


## Constants
### VALIDATOR_FIXED_REWARD_PERCENT

```solidity
uint256 public constant VALIDATOR_FIXED_REWARD_PERCENT = 20
```


## State Variables
### _epochsPoolGotRewardFor

```solidity
mapping(address => uint256[]) internal _epochsPoolGotRewardFor
```


### epochPoolNativeReward
The reward amount to be distributed in native coins among participants (the validator and their
delegators) of the specified pool (mining address) for the specified staking epoch.


```solidity
mapping(uint256 => mapping(address => uint256)) public epochPoolNativeReward
```


### nativeRewardUndistributed
The total reward amount in native coins which is not yet distributed among pools.


```solidity
uint256 public nativeRewardUndistributed
```


### validatorMinRewardPercent
The validator's min reward percent which was actual at the specified staking epoch.
This percent is taken from the VALIDATOR_FIXED_REWARD_PERCENT constant and saved for every staking epoch
by the `reward` function.
This is needed to have an ability to change validator's min reward percent in the VALIDATOR_FIXED_REWARD_PERCENT
constant by upgrading the contract.


```solidity
mapping(uint256 => uint256) public validatorMinRewardPercent
```


### deltaPot
the Delta Pool holds all coins that never got emitted, since the maximum supply is 4,380,000


```solidity
uint256 public deltaPot
```


### deltaPotPayoutFraction
each epoch reward, one Fraction of the delta pool gets payed out.
the number is the divisor of the fraction. 60 means 1/60 of the delta pool gets payed out.


```solidity
uint256 public deltaPotPayoutFraction
```


### reinsertPotPayoutFraction
each epoch reward, one Fraction of the reinsert pool gets payed out.
the number is the divisor of the fraction. 60 means 1/60 of the reinsert pool gets payed out.


```solidity
uint256 public reinsertPotPayoutFraction
```


### validatorSetContract
The address of the `ValidatorSet` contract.


```solidity
IValidatorSetHbbft public validatorSetContract
```


### governancePotAddress
parts of the epoch reward get forwarded to a governance fund.


```solidity
address payable public governancePotAddress
```


### governancePotShareNominator
nominator of the epoch reward that get's forwarded to the
`governancePotAddress`. See also `governancePotShareDenominator`


```solidity
uint256 public governancePotShareNominator
```


### governancePotShareDenominator
denominator of the epoch reward that get's forwarded to the
`governancePotAddress`. See also `governancePotShareNominator`


```solidity
uint256 public governancePotShareDenominator
```


### connectivityTracker
the address of the `ConnectivityTrackerHbbft` contract.


```solidity
IConnectivityTrackerHbbft public connectivityTracker
```


### earlyEpochEnd
flag indicating whether it is needed to end current epoch earlier.


```solidity
bool public earlyEpochEnd
```


## Functions
### onlySystem

Ensures the caller is the SYSTEM_ADDRESS. See https://wiki.parity.io/Block-Reward-Contract.html


```solidity
modifier onlySystem() virtual;
```

### onlyConnectivityTracker

Ensures the caller is the ConnectivityTracker contract address.


```solidity
modifier onlyConnectivityTracker() ;
```

### constructor

**Note:**
oz-upgrades-unsafe-allow: constructor


```solidity
constructor() ;
```

### receive

Receive function.


```solidity
receive() external payable;
```

### initialize

Initializes the contract at network startup.
Can only be called by the constructor of the `InitializerHbbft` contract or owner.


```solidity
function initialize(
    address _contractOwner,
    address _validatorSet,
    address _connectivityTracker
) external initializer;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_contractOwner`|`address`|The address of the contract owner|
|`_validatorSet`|`address`|The address of the `ValidatorSetHbbft` contract.|
|`_connectivityTracker`|`address`||


### addToDeltaPot

adds the transfered value to the delta pot.
everyone is allowed to pile up the delta pot.
however, circulating coins should be added to the reinsert pot,
since the reinsert pot is designed for circulating coins.


```solidity
function addToDeltaPot() external payable;
```

### notifyEarlyEpochEnd

Notify block reward contract, that current epoch must be closed earlier.
https://github.com/DMDcoin/diamond-contracts-core/issues/92


```solidity
function notifyEarlyEpochEnd() external onlyConnectivityTracker;
```

### reward

Called by the engine when producing and closing a block,
see https://wiki.parity.io/Block-Reward-Contract.html.
This function performs all of the automatic operations needed for accumulating block producing statistics,
starting a new staking epoch, snapshotting staking amounts for the upcoming staking epoch,
and rewards distributing at the end of a staking epoch.


```solidity
function reward(bool _isEpochEndBlock)
    external
    onlySystem
    nonReentrant
    returns (uint256 rewardsNative);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_isEpochEndBlock`|`bool`|Indicates if this is the last block of the current epoch i.e. just before the pending validators are finalized.|


### setGovernancePotShareNominator

Sets the value of the governancePotShareNominator variable.


```solidity
function setGovernancePotShareNominator(uint256 _shareNominator)
    external
    onlyOwner
    withinAllowedRange(_shareNominator);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_shareNominator`|`uint256`|The new value for the governancePotShareNominator. Requirements: - Only the contract owner can call this function. - The _shareNominator value must be within the allowed range. Emits a [SetGovernancePotShareNominator](/contracts/BlockRewardHbbft.sol/contract.BlockRewardHbbft.md#setgovernancepotsharenominator) event.|


### getGovernanceAddress


```solidity
function getGovernanceAddress() external view returns (address);
```

### epochsPoolGotRewardFor

Returns an array of epoch numbers for which the specified pool (mining address)
got a non-zero reward.


```solidity
function epochsPoolGotRewardFor(address _miningAddress)
    external
    view
    returns (uint256[] memory);
```

### reinsertPot

Returns the current balance of the Reinsert pot.
Funds, that are not exclusively defined as delta pot funds,
belong to the reinsert pot.


```solidity
function reinsertPot() external view returns (uint256);
```

### epochPercentage

Calculates and returns the percentage of the current epoch.
100% MAX


```solidity
function epochPercentage() public view returns (uint256);
```

### _distributeRewards

Distributes rewards among pools at the latest block of a staking epoch.
This function is called by the `reward` function.


```solidity
function _distributeRewards(
    uint256 _stakingEpoch,
    IStakingHbbft stakingContract
) private returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_stakingEpoch`|`uint256`|The number of the current staking epoch.|
|`stakingContract`|`IStakingHbbft`||

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|Returns the reward amount in native coins needed to be minted and accrued to the balance of this contract.|


### _snapshotPoolStakeAmounts

Makes snapshots of total amount staked into the specified pool
before the specified staking epoch. Used by the `reward` function.


```solidity
function _snapshotPoolStakeAmounts(
    IStakingHbbft stakingContract,
    uint256 stakingEpoch,
    address[] memory miningAddresses
) private;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`stakingContract`|`IStakingHbbft`|The address of the `StakingHbbft` contract.|
|`stakingEpoch`|`uint256`|The number of upcoming staking epoch.|
|`miningAddresses`|`address[]`|The mining address of the pool.|


### _savePoolRewardStats


```solidity
function _savePoolRewardStats(
    uint256 stakingEpoch,
    address miningAddress,
    uint256 poolReward
) private;
```

### _closeEpoch


```solidity
function _closeEpoch(IStakingHbbft stakingContract) private returns (uint256);
```

### _closeBlock


```solidity
function _closeBlock(IStakingHbbft stakingContract) private;
```

### _markRewardedValidators


```solidity
function _markRewardedValidators(
    IStakingHbbft stakingContract,
    uint256 stakingEpoch,
    address[] memory validators
) private view returns (uint256, bool[] memory);
```

### _getPotsShares


```solidity
function _getPotsShares(uint256 numValidators) internal view returns (PotsShares memory);
```

## Events
### CoinsRewarded
Emitted by the `reward` function.


```solidity
event CoinsRewarded(uint256 rewards);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`rewards`|`uint256`|The amount minted and distributed among the validators.|

### EarlyEpochEndNotificationReceived

```solidity
event EarlyEpochEndNotificationReceived();
```

### SetGovernancePotShareNominator

```solidity
event SetGovernancePotShareNominator(uint256 value);
```

## Structs
### PotsShares

```solidity
struct PotsShares {
    uint256 deltaPotAmount;
    uint256 reinsertPotAmount;
    uint256 governancePotAmount;
    uint256 totalRewards;
}
```

