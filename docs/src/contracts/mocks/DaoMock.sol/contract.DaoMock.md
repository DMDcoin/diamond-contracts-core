# DaoMock
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/mocks/DaoMock.sol)

**Inherits:**
[IGovernancePot](/contracts/interfaces/IGovernancePot.sol/interface.IGovernancePot.md)


## State Variables
### phaseCounter

```solidity
uint256 public phaseCounter
```


## Functions
### switchPhase


```solidity
function switchPhase() external;
```

### receive


```solidity
receive() external payable;
```

## Errors
### SwitchPhaseReverted

```solidity
error SwitchPhaseReverted();
```

