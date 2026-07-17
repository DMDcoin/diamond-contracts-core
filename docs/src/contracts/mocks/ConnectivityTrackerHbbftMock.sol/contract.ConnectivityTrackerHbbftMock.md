# ConnectivityTrackerHbbftMock
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/mocks/ConnectivityTrackerHbbftMock.sol)


## State Variables
### earlyEpochEnd

```solidity
mapping(uint256 => bool) public earlyEpochEnd
```


### epochPenaltiesSent

```solidity
mapping(uint256 => bool) public epochPenaltiesSent
```


## Functions
### receive


```solidity
receive() external payable;
```

### setEarlyEpochEnd


```solidity
function setEarlyEpochEnd(uint256 epoch, bool set) external;
```

### penaliseFaultyValidators


```solidity
function penaliseFaultyValidators(uint256 epoch) external;
```

### isEarlyEpochEnd


```solidity
function isEarlyEpochEnd(uint256 epoch) external view returns (bool);
```

### isEpochPenaltiesSent


```solidity
function isEpochPenaltiesSent(uint256 epoch) external view returns (bool);
```

