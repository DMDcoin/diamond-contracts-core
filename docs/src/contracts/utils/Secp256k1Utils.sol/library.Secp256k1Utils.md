# Secp256k1Utils
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/utils/Secp256k1Utils.sol)


## Constants
### P

```solidity
uint256 internal constant P =
    0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
```


### KEY_LENGTH

```solidity
uint256 internal constant KEY_LENGTH = 64
```


## Functions
### computeAddress


```solidity
function computeAddress(bytes memory publicKey) internal pure returns (address);
```

### isValidPublicKey


```solidity
function isValidPublicKey(bytes memory publicKey) internal pure returns (bool result);
```

### _extractPoints


```solidity
function _extractPoints(bytes memory publicKey) private pure returns (bytes32 x, bytes32 y);
```

## Errors
### InvalidPublicKeyLength

```solidity
error InvalidPublicKeyLength();
```

### InvalidPointsValue

```solidity
error InvalidPointsValue();
```

