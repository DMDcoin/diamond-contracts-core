# KeyGenHistory
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/KeyGenHistory.sol)

**Inherits:**
Initializable, OwnableUpgradeable, [IKeyGenHistory](/contracts/interfaces/IKeyGenHistory.sol/interface.IKeyGenHistory.md)


## State Variables
### validatorSet

```solidity
address[] public validatorSet
```


### parts

```solidity
mapping(address => bytes) public parts
```


### acks

```solidity
mapping(address => bytes[]) public acks
```


### numberOfPartsWritten
number of parts written in this key generation round.


```solidity
uint128 public numberOfPartsWritten
```


### numberOfAcksWritten
number of full ack sets written in this key generation round.


```solidity
uint128 public numberOfAcksWritten
```


### validatorSetContract
The address of the `ValidatorSetHbbft` contract.


```solidity
IValidatorSetHbbft public validatorSetContract
```


### currentKeyGenRound
round counter for key generation rounds.
in an ideal world, every key generation only requires one try,
and all validators manage to write their acks and parts,
so it is possible to achieve this goal in round 0.
in the real world, there are failures,
this mechanics helps covering that,
by revoking transactions, that were targeted for an earlier key gen round.
more infos: https://github.com/DMDcoin/hbbft-posdao-contracts/issues/106


```solidity
uint256 public currentKeyGenRound
```


## Functions
### onlyValidatorSet

Ensures the caller is ValidatorSet contract.


```solidity
modifier onlyValidatorSet() ;
```

### onlyUpcomingEpoch

ensures that Key Generation functions are called with wrong _epoch
parameter to prevent old and wrong transactions get picked up.


```solidity
modifier onlyUpcomingEpoch(uint256 _epoch) ;
```

### onlyCorrectRound

ensures that Key Generation functions are called with wrong _epoch
parameter to prevent old and wrong transactions get picked up.


```solidity
modifier onlyCorrectRound(uint256 _roundCounter) ;
```

### constructor

**Note:**
oz-upgrades-unsafe-allow: constructor


```solidity
constructor() ;
```

### initialize


```solidity
function initialize(
    address _contractOwner,
    address _validatorSetContract,
    address[] memory _validators,
    bytes[] memory _parts,
    bytes[][] memory _acks
) external initializer;
```

### clearPrevKeyGenState

Clears the state (acks and parts of previous validators.


```solidity
function clearPrevKeyGenState(address[] calldata _prevValidators) external onlyValidatorSet;
```
**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`_prevValidators`|`address[]`|The list of previous validators.|


### notifyKeyGenFailed


```solidity
function notifyKeyGenFailed() external onlyValidatorSet;
```

### notifyNewEpoch


```solidity
function notifyNewEpoch() external onlyValidatorSet;
```

### writePart


```solidity
function writePart(
    uint256 _upcomingEpoch,
    uint256 _roundCounter,
    bytes memory _part
) external onlyUpcomingEpoch(_upcomingEpoch) onlyCorrectRound(_roundCounter);
```

### writeAcks


```solidity
function writeAcks(
    uint256 _upcomingEpoch,
    uint256 _roundCounter,
    bytes[] memory _acks
) external onlyUpcomingEpoch(_upcomingEpoch) onlyCorrectRound(_roundCounter);
```

### getPart


```solidity
function getPart(address _val) external view returns (bytes memory);
```

### getAcksLength


```solidity
function getAcksLength(address val) external view returns (uint256);
```

### getCurrentKeyGenRound


```solidity
function getCurrentKeyGenRound() external view returns (uint256);
```

### getNumberOfKeyFragmentsWritten


```solidity
function getNumberOfKeyFragmentsWritten() external view returns (uint128, uint128);
```

## Errors
### AcksAlreadySubmitted

```solidity
error AcksAlreadySubmitted();
```

### IncorrectEpoch

```solidity
error IncorrectEpoch();
```

### IncorrectRound

```solidity
error IncorrectRound(uint256 expected, uint256 submited);
```

### NotPendingValidator

```solidity
error NotPendingValidator(address validator);
```

### PartsAlreadySubmitted

```solidity
error PartsAlreadySubmitted();
```

### WrongEpoch

```solidity
error WrongEpoch();
```

### WrongAcksNumber

```solidity
error WrongAcksNumber();
```

### WrongPartsNumber

```solidity
error WrongPartsNumber();
```

