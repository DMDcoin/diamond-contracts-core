# IConnectivityTrackerHbbft
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/interfaces/IConnectivityTrackerHbbft.sol)


## Functions
### reportMissingConnectivity


```solidity
function reportMissingConnectivity(
    address validator,
    uint256 blockNum,
    bytes32 blockHash
) external;
```

### reportReconnect


```solidity
function reportReconnect(address validator, uint256 blockNumber, bytes32 blockHash) external;
```

### checkReportMissingConnectivityCallable


```solidity
function checkReportMissingConnectivityCallable(
    address caller,
    address validator,
    uint256 blockNumber,
    bytes32 blockHash
) external view;
```

### checkReportReconnectCallable


```solidity
function checkReportReconnectCallable(
    address caller,
    address validator,
    uint256 blockNumber,
    bytes32 blockHash
) external view;
```

### isEarlyEpochEnd


```solidity
function isEarlyEpochEnd(uint256 epoch) external view returns (bool);
```

### penaliseFaultyValidators


```solidity
function penaliseFaultyValidators(uint256 epoch) external;
```

