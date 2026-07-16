# CertifierHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/CertifierHbbft.sol)

**Inherits:**
Initializable, OwnableUpgradeable, [ICertifier](/contracts/interfaces/ICertifier.sol/interface.ICertifier.md)

Allows validators to use a zero gas price for their service transactions
(see https://wiki.parity.io/Permissioning.html#gas-price for more info).


## State Variables
### _certified

```solidity
mapping(address => bool) internal _certified
```


### validatorSetContract
The address of the `ValidatorSetHbbft` contract.


```solidity
IValidatorSetHbbft public validatorSetContract
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
Can only be called by the constructor of the `InitializerHbbft` contract or owner.


```solidity
function initialize(
    address[] calldata _certifiedAddresses,
    address _validatorSet,
    address _owner
) external initializer;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_certifiedAddresses`|`address[]`|The addresses for which a zero gas price must be allowed.|
|`_validatorSet`|`address`|The address of the `ValidatorSetHbbft` contract.|
|`_owner`|`address`||


### certify

Allows the specified address to use a zero gas price for its transactions.
Can only be called by the `owner`.


```solidity
function certify(address _who) external onlyOwner;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_who`|`address`|The address for which zero gas price transactions must be allowed.|


### revoke

Denies the specified address usage of a zero gas price for its transactions.
Can only be called by the `owner`.


```solidity
function revoke(address _who) external onlyOwner;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_who`|`address`|The address for which transactions with a zero gas price must be denied.|


### certified

Returns a boolean flag indicating whether the specified address is allowed to use zero gas price
transactions. Returns `true` if either the address is certified using the `_certify` function or if
`ValidatorSet.isReportValidatorValid` returns `true` for the specified address,
or the address is a pending validator who has to write it's key shares (ACK and PART).


```solidity
function certified(address _who) external view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_who`|`address`|The address for which the boolean flag must be determined.|


### certifiedExplicitly

Returns a boolean flag indicating whether the specified address is allowed to use zero gas price
transactions. Returns `true` if the address is certified using the `_certify` function.
This function differs from the `certified`: it doesn't take into account the returned value of
`ValidatorSetHbbft.isReportValidatorValid` function.


```solidity
function certifiedExplicitly(address _who) external view returns (bool);
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_who`|`address`|The address for which the boolean flag must be determined.|


### _certify

An internal function for the `certify` and `initialize` functions.


```solidity
function _certify(address _who) internal;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_who`|`address`|The address for which transactions with a zero gas price must be allowed.|


## Events
### Confirmed
Emitted by the `certify` function when the specified address is allowed to use a zero gas price
for its transactions.


```solidity
event Confirmed(address indexed who);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`who`|`address`|Specified address allowed to make zero gas price transactions.|

### Revoked
Emitted by the `revoke` function when the specified address is denied using a zero gas price
for its transactions.


```solidity
event Revoked(address indexed who);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`who`|`address`|Specified address for which zero gas price transactions are denied.|

