# RandomHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/RandomHbbft.sol)

**Inherits:**
Initializable, OwnableUpgradeable, [IRandomHbbft](/contracts/interfaces/IRandomHbbft.sol/interface.IRandomHbbft.md)

Stores and uppdates a random seed that is used to form a new validator set by the
`ValidatorSetHbbft.newValidatorSet` function.


## State Variables
### deprecated1
deprecated slot, was used for randomSeed


```solidity
uint256 private deprecated1
```


### randomHistory
The mapping of random seeds accumulated during RANDAO or another process
(depending on implementation).
blocknumber => random seed


```solidity
mapping(uint256 => uint256) private randomHistory
```


### unhealthiness

```solidity
BitMaps.BitMap private unhealthiness
```


### validatorSetContract
The address of the `ValidatorSet` contract.


```solidity
IValidatorSetHbbft public validatorSetContract
```


## Functions
### onlySystem

Ensures the caller is the SYSTEM_ADDRESS. See https://wiki.parity.io/Validator-Set.html


```solidity
modifier onlySystem() virtual;
```

### constructor

**Note:**
oz-upgrades-unsafe-allow: constructor


```solidity
constructor() ;
```

### initialize


```solidity
function initialize(address _contractOwner, address _validatorSet) external initializer;
```

### setCurrentSeed

The cooperative consens mechanism in HBBFT achieves to
generate a seed, that cannot be predicted by the nodes,
but can get used within smart contracts without having to wait for
an additional block.
this is one of the biggest benefits of HBBFT.
When the nodes are able to decrypt the transaction,
they know the seed, that can be used as random base for smart contract interactions.
setCurrentSeed is always the first transaction within a block,
and currentSeed is a public available value that can get used by all smart contracts.


```solidity
function setCurrentSeed(uint256 _currentSeed) external onlySystem;
```

### currentSeed

returns current random seed


```solidity
function currentSeed() external view returns (uint256);
```

### getSeedsHistoric

returns an array of seeds from requested blocknumbers


```solidity
function getSeedsHistoric(uint256[] calldata _blocknumbers)
    external
    view
    returns (uint256[] memory);
```

### getSeedHistoric

returns an seed from requested blocknumber


```solidity
function getSeedHistoric(uint256 _blocknumber) external view returns (uint256);
```

### isFullHealth


```solidity
function isFullHealth() external view returns (bool);
```

### isFullHealthHistoric


```solidity
function isFullHealthHistoric(uint256 _blocknumber) external view returns (bool);
```

### isFullHealthsHistoric


```solidity
function isFullHealthsHistoric(uint256[] calldata _blocknumbers)
    external
    view
    returns (bool[] memory);
```

## Events
### SetCurrentSeed
Emitted by `setCurrentSeed` function when `seed` value was set
for specified `blockNum`.


```solidity
event SetCurrentSeed(uint256 indexed blockNum, uint256 indexed seed, bool indexed healthy);
```

**Parameters**

|Name|Type|Description|
|----|----|-----------|
|`blockNum`|`uint256`|Block number|
|`seed`|`uint256`|Corresponding seed value|
|`healthy`|`bool`|Network healthiness state|

