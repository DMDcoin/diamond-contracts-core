pragma solidity =0.8.25;

interface ICertifier {
    function certifiedExplicitly(address) external view returns (bool);
}
