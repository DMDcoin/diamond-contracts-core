# ITxPermission
[Git Source](https://github.com/DMDcoin/diamond-contracts-core/blob/6621f310b8eedbe8dd87a1320a2538eda3a8c55d/contracts/interfaces/ITxPermission.sol)


## Functions
### allowedTxTypes


```solidity
function allowedTxTypes(
    address _sender,
    address _to,
    uint256,
    /*_value */
    uint256 _gasPrice,
    bytes memory _data
) external view returns (uint32 typesMask, bool cache);
```

