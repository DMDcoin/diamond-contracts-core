# TxPermissionHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/TxPermissionHbbft.sol)

**Inherits:**
Initializable, OwnableUpgradeable, [ITxPermission](/contracts/interfaces/ITxPermission.sol/interface.ITxPermission.md), [ValueGuards](/contracts/lib/ValueGuards.sol/abstract.ValueGuards.md)

Controls the use of zero gas price by validators in service transactions,
protecting the network against "transaction spamming" by malicious validators.
The protection logic is declared in the `allowedTxTypes` function.


## Constants
### NONE

```solidity
uint32 internal constant NONE = 0
```


### ALL

```solidity
uint32 internal constant ALL = 0xffffffff
```


### BASIC

```solidity
uint32 internal constant BASIC = 0x01
```


### CALL

```solidity
uint32 internal constant CALL = 0x02
```


### CREATE

```solidity
uint32 internal constant CREATE = 0x04
```


### PRIVATE

```solidity
uint32 internal constant PRIVATE = 0x08
```


### WRITE_PART_SIGNATURE

```solidity
bytes4 public constant WRITE_PART_SIGNATURE = 0x2d4de124
```


### WRITE_ACKS_SIGNATURE

```solidity
bytes4 public constant WRITE_ACKS_SIGNATURE = 0x5623208e
```


### SET_VALIDATOR_IP

```solidity
bytes4 public constant SET_VALIDATOR_IP = 0xa42bdee9
```


### ANNOUNCE_AVAILABILITY_SIGNATURE

```solidity
bytes4 public constant ANNOUNCE_AVAILABILITY_SIGNATURE = 0x43bcce9f
```


### REPORT_MISSING_CONNECTIVITY_SELECTOR

```solidity
bytes4 public constant REPORT_MISSING_CONNECTIVITY_SELECTOR = 0x911cee74
```


### REPORT_RECONNECT_SELECTOR

```solidity
bytes4 public constant REPORT_RECONNECT_SELECTOR = 0xb2a68421
```


## State Variables
### _allowedSenders

```solidity
address[] internal _allowedSenders
```


### certifierContract
The address of the `Certifier` contract.


```solidity
ICertifier public certifierContract
```


### keyGenHistoryContract


```solidity
IKeyGenHistory public keyGenHistoryContract
```


### isSenderAllowed
A boolean flag indicating whether the specified address is allowed
to initiate transactions of any type. Used by the `allowedTxTypes` getter.
See also the `addAllowedSender` and `removeAllowedSender` functions.


```solidity
mapping(address => bool) public isSenderAllowed
```


### validatorSetContract
The address of the `ValidatorSetHbbft` contract.


```solidity
IValidatorSetHbbft public validatorSetContract
```


### minimumGasPrice
this is a constant for testing purposes to not cause upgrade issues with an existing network
because of storage modifictions.


```solidity
uint256 public minimumGasPrice
```


### blockGasLimit
defines the block gas limit, respected by the hbbft validators.


```solidity
uint256 public blockGasLimit
```


### connectivityTracker
The address of the `ConnectivityTrackerHbbft` contract.


```solidity
IConnectivityTrackerHbbft public connectivityTracker
```


## Functions
### constructor

**Note:**
oz-upgrades-unsafe-allow: constructor


```solidity
constructor() ;
```

### initialize

Initializes the contract at network startup.
Can only be called by the constructor of the `Initializer` contract or owner.
Current initialized version = 2.


```solidity
function initialize(
    address[] calldata _allowed,
    address _certifier,
    address _validatorSet,
    address _keyGenHistoryContract,
    address _connectivityTracker,
    address _contractOwner
) external initializer;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_allowed`|`address[]`|The addresses for which transactions of any type must be allowed. See the `allowedTxTypes` getter.|
|`_certifier`|`address`|The address of the `Certifier` contract. It is used by `allowedTxTypes` function to know whether some address is explicitly allowed to use zero gas price.|
|`_validatorSet`|`address`|The address of the `ValidatorSetHbbft` contract.|
|`_keyGenHistoryContract`|`address`|The address of the `KeyGenHistory` contract.|
|`_connectivityTracker`|`address`||
|`_contractOwner`|`address`|The address of the contract owner.|


### initializeV2

Increases the range of possible parameters for minimumGasPrice value.
Set current minimumGasPrice = 50 gwei.


```solidity
function initializeV2() external reinitializer(2);
```

### addAllowedSender

Adds the address for which transactions of any type must be allowed.
Can only be called by the `owner`. See also the `allowedTxTypes` getter.


```solidity
function addAllowedSender(address _sender) external onlyOwner;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_sender`|`address`|The address for which transactions of any type must be allowed.|


### removeAllowedSender

Removes the specified address from the array of addresses allowed
to initiate transactions of any type. Can only be called by the `owner`.
See also the `addAllowedSender` function and `allowedSenders` getter.


```solidity
function removeAllowedSender(address _sender) external onlyOwner;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_sender`|`address`|The removed address.|


### setMinimumGasPrice

set's the minimum gas price that is allowed by non-service transactions.
IN HBBFT, there must be consens about the validator nodes about wich transaction is legal,
and wich is not.
therefore the contract (could be the DAO) has to check the minimum gas price.
HBBFT Node implementations can also check if a transaction surpases the minimumGasPrice,
before submitting it as contribution.
The limit can be changed by the owner (typical the DAO)


```solidity
function setMinimumGasPrice(uint256 _value) public onlyOwner withinAllowedRange(_value);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_value`|`uint256`|The new minimum gas price. Emits a {GasPriceChanged} event.|


### setBlockGasLimit

set's the block gas limit.
IN HBBFT, there must be consens about the block gas limit.
Emits a {BlockGasLimitChanged} event.


```solidity
function setBlockGasLimit(uint256 _value) public onlyOwner withinAllowedRange(_value);
```

### contractName

Returns the contract's name recognizable by node's engine.


```solidity
function contractName() public pure returns (string memory);
```

### contractNameHash

Returns the contract name hash needed for node's engine.


```solidity
function contractNameHash() external pure returns (bytes32);
```

### contractVersion

Returns the contract's version number needed for node's engine.


```solidity
function contractVersion() external pure returns (uint256);
```

### allowedSenders

Returns the list of addresses allowed to initiate transactions of any type.
For these addresses the `allowedTxTypes` getter always returns the `ALL` bit mask
(see https://wiki.parity.io/Permissioning.html#how-it-works-1).


```solidity
function allowedSenders() external view returns (address[] memory);
```

### allowedTxTypes

Defines the allowed transaction types which may be initiated by the specified sender with
the specified gas price and data. Used by node's engine each time a transaction is about to be
included into a block. See https://wiki.parity.io/Permissioning.html#how-it-works-1


```solidity
function allowedTxTypes(
    address _sender,
    address _to,
    uint256,
    /*_value */
    uint256 _gasPrice,
    bytes memory _data
) external view returns (uint32 typesMask, bool cache);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_sender`|`address`|Transaction sender address.|
|`_to`|`address`|Transaction recipient address. If creating a contract, the `_to` address is zero.|
|`<none>`|`uint256`||
|`_gasPrice`|`uint256`|Gas price in wei for the transaction.|
|`_data`|`bytes`|Transaction data.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`typesMask`|`uint32`|`uint32 typesMask` - Set of allowed transactions for `_sender` depending on tx `_to` address, `_gasPrice`, and `_data`. The result is represented as a set of flags: 0x01 - basic transaction (e.g. ether transferring to user wallet); 0x02 - contract call; 0x04 - contract creation; 0x08 - private transaction.|
|`cache`|`bool`|`bool cache` - If `true` is returned, the same permissions will be applied from the same `_sender` without calling this contract again.|


### _addAllowedSender

An internal function used by the `addAllowedSender` and `initialize` functions.


```solidity
function _addAllowedSender(address _sender) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_sender`|`address`|The address for which transactions of any type must be allowed.|


### _getSliceUInt256

retrieves a UInt256 slice of a bytes array on a specific location


```solidity
function _getSliceUInt256(uint256 _begin, bytes memory _data) internal pure returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_begin`|`uint256`|offset to start reading the 32 bytes.|
|`_data`|`bytes`|byte[] to read the data from.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|uint256 value found on offset _begin in _data.|


### _memcpy


```solidity
function _memcpy(
    bytes memory src,
    uint256 len,
    uint256 offset
) internal pure returns (bytes memory);
```

### _handleCallToConnectivityTracker


```solidity
function _handleCallToConnectivityTracker(
    address sender,
    bytes4 selector,
    bytes memory _calldata
) internal view returns (AllowanceCheckResult memory);
```

### _blockGasLimitAllowedParams


```solidity
function _blockGasLimitAllowedParams() private pure returns (uint256[] memory);
```

### _minGasPriceAllowedParams


```solidity
function _minGasPriceAllowedParams() private pure returns (uint256[] memory);
```

## Events
### SetMinimumGasPrice
Emitted when the minimum gas price is updated.


```solidity
event SetMinimumGasPrice(uint256 _minGasPrice);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_minGasPrice`|`uint256`|The new minimum gas price.|

### SetBlockGasLimit
Emitted when the block gas limit is updated.


```solidity
event SetBlockGasLimit(uint256 _blockGasLimit);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_blockGasLimit`|`uint256`|The new block gas limit.|

### AddAllowedSender

```solidity
event AddAllowedSender(address indexed _sender);
```

### RemoveAllowedSender

```solidity
event RemoveAllowedSender(address indexed _sender);
```

## Errors
### InvalidMinGasPrice

```solidity
error InvalidMinGasPrice();
```

### InvalidBlockGasLimit

```solidity
error InvalidBlockGasLimit();
```

### SenderNotAllowed

```solidity
error SenderNotAllowed();
```

### AlreadyExist

```solidity
error AlreadyExist(address _value);
```

### NotExist

```solidity
error NotExist(address _value);
```

### ReadOutOfBounds

```solidity
error ReadOutOfBounds();
```

## Structs
### AllowanceCheckResult

```solidity
struct AllowanceCheckResult {
    uint32 mask;
    bool knownFunc;
    bool cache;
}
```

