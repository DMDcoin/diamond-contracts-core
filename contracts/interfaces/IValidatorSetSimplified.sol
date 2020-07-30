pragma solidity ^0.5.16;

interface IValidatorSetSimplified {
    function initialize(
        address[] calldata,
        bytes32[] calldata
    ) external;
}
