pragma solidity =0.8.17;

interface ICertifier {
    function certifiedExplicitly(address) external view returns (bool);

    function initialize(address[] calldata, address) external;
}
