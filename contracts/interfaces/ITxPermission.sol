pragma solidity =0.8.25;

interface ITxPermission {
    function allowedTxTypes(
        address _sender,
        address _to,
        uint256 /*_value */,
        uint256 _gasPrice,
        bytes memory _data
    ) external view returns (uint32 typesMask, bool cache);
}
