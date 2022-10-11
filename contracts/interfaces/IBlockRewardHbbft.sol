pragma solidity ^0.5.16;

interface IBlockRewardHbbft {
    function initialize(address) external;

    function epochsPoolGotRewardFor(address)
        external
        view
        returns (uint256[] memory);
}
