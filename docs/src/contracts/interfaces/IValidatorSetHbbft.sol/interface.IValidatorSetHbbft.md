# IValidatorSetHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/interfaces/IValidatorSetHbbft.sol)


## Functions
### announceAvailability


```solidity
function announceAvailability(uint256, bytes32) external;
```

### finalizeChange


```solidity
function finalizeChange() external;
```

### newValidatorSet


```solidity
function newValidatorSet() external;
```

### setStakingAddress


```solidity
function setStakingAddress(address, address) external;
```

### handleFailedKeyGeneration


```solidity
function handleFailedKeyGeneration() external;
```

### isFullHealth


```solidity
function isFullHealth() external view returns (bool);
```

### blockRewardContract


```solidity
function blockRewardContract() external view returns (address);
```

### canCallAnnounceAvailability


```solidity
function canCallAnnounceAvailability(address _miningAddress) external view returns (bool);
```

### getPendingValidators


```solidity
function getPendingValidators() external view returns (address[] memory);
```

### getPreviousValidators


```solidity
function getPreviousValidators() external view returns (address[] memory);
```

### getValidators


```solidity
function getValidators() external view returns (address[] memory);
```

### isValidator


```solidity
function isValidator(address) external view returns (bool);
```

### isValidatorOrPending


```solidity
function isValidatorOrPending(address) external view returns (bool);
```

### isPendingValidator


```solidity
function isPendingValidator(address) external view returns (bool);
```

### getPendingValidatorKeyGenerationMode


```solidity
function getPendingValidatorKeyGenerationMode(address) external view returns (KeyGenMode);
```

### maxValidators


```solidity
function maxValidators() external view returns (uint256);
```

### miningByStakingAddress


```solidity
function miningByStakingAddress(address) external view returns (address);
```

### randomContract


```solidity
function randomContract() external view returns (address);
```

### notifyUnavailability


```solidity
function notifyUnavailability(address) external;
```

### stakingByMiningAddress


```solidity
function stakingByMiningAddress(address) external view returns (address);
```

### publicKeyByStakingAddress


```solidity
function publicKeyByStakingAddress(address) external view returns (bytes memory);
```

### getPublicKey


```solidity
function getPublicKey(address) external view returns (bytes memory);
```

### getStakingContract


```solidity
function getStakingContract() external view returns (address);
```

### validatorAvailableSince


```solidity
function validatorAvailableSince(address) external view returns (uint256);
```

### isValidatorAbandoned


```solidity
function isValidatorAbandoned(address) external view returns (bool);
```

### getValidatorCountSweetSpot


```solidity
function getValidatorCountSweetSpot(uint256) external view returns (uint256);
```

### getCurrentValidatorsCount


```solidity
function getCurrentValidatorsCount() external view returns (uint256);
```

## Structs
### ValidatorSetParams

```solidity
struct ValidatorSetParams {
    address blockRewardContract;
    address randomContract;
    address stakingContract;
    address keyGenHistoryContract;
    address bonusScoreContract;
    address connectivityTrackerContract;
    uint256 validatorInactivityThreshold;
}
```

## Enums
### KeyGenMode

```solidity
enum KeyGenMode {
    NotAPendingValidator,
    WritePart,
    WaitForOtherParts,
    WriteAck,
    WaitForOtherAcks,
    AllKeysDone
}
```

