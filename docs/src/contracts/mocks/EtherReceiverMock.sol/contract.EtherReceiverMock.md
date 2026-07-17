# EtherReceiverMock
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/mocks/EtherReceiverMock.sol)


## State Variables
### allowReceive

```solidity
bool public allowReceive
```


## Functions
### constructor


```solidity
constructor() ;
```

### receive


```solidity
receive() external payable;
```

### toggleReceive


```solidity
function toggleReceive(bool allow) external;
```

## Errors
### ReceiveDisabled

```solidity
error ReceiveDisabled();
```

