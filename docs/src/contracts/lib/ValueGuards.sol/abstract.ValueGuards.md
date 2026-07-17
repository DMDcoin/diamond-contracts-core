# ValueGuards
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/lib/ValueGuards.sol)

**Inherits:**
OwnableUpgradeable


## Constants
### VALUEGUARDS_STORAGE_NAMESPACE

```solidity
bytes32 private constant VALUEGUARDS_STORAGE_NAMESPACE = keccak256(
    abi.encode(uint256(keccak256("valueguards.storage")) - 1)
) & ~bytes32(uint256(0xff))
```


## Functions
### _getValueGuardsStorage


```solidity
function _getValueGuardsStorage() private pure returns (ValueGuardsStorage storage $);
```

### withinAllowedRange

This modifier is used to ensure that the new value is within the allowed range.
If the new value is not within the allowed range, the function using this modifier
will revert with an error message.

Modifier to check if a new value is within the allowed range.


```solidity
modifier withinAllowedRange(uint256 newVal) ;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`newVal`|`uint256`|The new value to be checked.|


### __initAllowedChangeableParameter

Inits the allowed changeable parameter for a specific setter function.


```solidity
function __initAllowedChangeableParameter(
    bytes4 setter,
    bytes4 getter,
    uint256[] memory params
) internal onlyInitializing;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`setter`|`bytes4`|Setter function selector.|
|`getter`|`bytes4`|Getter function selector.|
|`params`|`uint256[]`|The array of allowed parameter values.|


### setAllowedChangeableParameter

Sets the allowed changeable parameter for a specific setter function.


```solidity
function setAllowedChangeableParameter(
    bytes4 setter,
    bytes4 getter,
    uint256[] calldata params
) public onlyOwner;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`setter`|`bytes4`|Setter function selector.|
|`getter`|`bytes4`|Getter function selector.|
|`params`|`uint256[]`|The array of allowed parameter values.|


### removeAllowedChangeableParameter

Removes the allowed changeable parameter for a given function selector.


```solidity
function removeAllowedChangeableParameter(bytes4 funcSelector) public onlyOwner;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`funcSelector`|`bytes4`|The function selector for which the allowed changeable parameter should be removed.|


### isWithinAllowedRange

Checks if the given `newVal` is within the allowed range for the specified function selector.


```solidity
function isWithinAllowedRange(bytes4 funcSelector, uint256 newVal) public view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`funcSelector`|`bytes4`|The function selector.|
|`newVal`|`uint256`|The new value to be checked.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`bool`|A boolean indicating whether the `newVal` is within the allowed range.|


### getAllowedParamsRange


```solidity
function getAllowedParamsRange(string memory _selector)
    external
    view
    returns (ParameterRange memory);
```

### getAllowedParamsRangeWithSelector


```solidity
function getAllowedParamsRangeWithSelector(bytes4 _selector)
    external
    view
    returns (ParameterRange memory);
```

### _getValueWithSelector

Internal function to get the value of a contract state variable using a getter function.


```solidity
function _getValueWithSelector(bytes4 getterSelector) private view returns (uint256);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`getterSelector`|`bytes4`|The selector of the getter function.|

**Returns**

|Name|Type|Description|
|----|----|-----------|
|`<none>`|`uint256`|The value of the contract state variable.|


## Events
### SetChangeableParameter
Event emitted when changeable parameters are set.


```solidity
event SetChangeableParameter(bytes4 setter, bytes4 getter, uint256[] params);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`setter`|`bytes4`|Setter function signature.|
|`getter`|`bytes4`|Getter function signature.|
|`params`|`uint256[]`|An array of uint256 values representing the parameters.|

### RemoveChangeableParameter
Emitted when changeable parameters are removed.


```solidity
event RemoveChangeableParameter(bytes4 funcSelector);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`funcSelector`|`bytes4`|The function selector of the removed changeable parameters.|

## Errors
### NewValueOutOfRange

```solidity
error NewValueOutOfRange(uint256 _newVal);
```

### GetterCallFailed

```solidity
error GetterCallFailed();
```

## Structs
### ParameterRange
Represents a parameter range for a specific getter function.


```solidity
struct ParameterRange {
    bytes4 getter;
    uint256[] range;
}
```

**Properties**

|Name|Type|Description|
|----|----|-----------|
|`getter`|`bytes4`|The getter function signature.|
|`range`|`uint256[]`|The range of values for the parameter.|

### ValueGuardsStorage

```solidity
struct ValueGuardsStorage {
    /// @dev A mapping that stores the allowed parameter ranges for each function signature.
    mapping(bytes4 => ParameterRange) allowedParameterRange;
}
```

