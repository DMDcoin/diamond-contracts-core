pragma solidity ^0.5.16;


interface IRandomHbbft {
    function currentSeed() external view returns(uint256);
}
