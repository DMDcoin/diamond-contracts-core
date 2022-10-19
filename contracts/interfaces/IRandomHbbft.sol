pragma solidity =0.8.17;

interface IRandomHbbft {
    function currentSeed() external view returns (uint256);
}
