# BlockRewardHbbftMock
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/mocks/BlockRewardHbbftMock.sol)

**Inherits:**
[BlockRewardHbbft](/contracts/BlockRewardHbbft.sol/contract.BlockRewardHbbft.md)


## Functions
### sendCoins


```solidity
function sendCoins() external payable;
```

### setConnectivityTracker


```solidity
function setConnectivityTracker(address _connectivityTracker) external;
```

### setGovernanceAddress


```solidity
function setGovernanceAddress(address _address) external;
```

### resetEarlyEpochEnd


```solidity
function resetEarlyEpochEnd() external;
```

### getPotsShares


```solidity
function getPotsShares(uint256 numValidators) external view returns (PotsShares memory);
```

