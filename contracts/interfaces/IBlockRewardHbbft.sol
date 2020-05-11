pragma solidity ^0.5.16;


interface IBlockRewardHbbft {
    function clearBlocksCreated() external;
    function initialize(address, uint256) external;
    function epochsPoolGotRewardFor(address) external view returns(uint256[] memory);
}
