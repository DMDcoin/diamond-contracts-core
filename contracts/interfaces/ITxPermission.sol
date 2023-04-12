pragma solidity =0.8.17;

interface ITxPermission {
    function initialize(
        address[] calldata,
        address,
        address,
        address
    ) external;
}
