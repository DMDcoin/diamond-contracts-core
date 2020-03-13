pragma solidity ^0.5.16;


interface IBlockRewardHbbft {
    function clearBlocksCreated() external;
    function initialize(address) external;
    function epochsPoolGotRewardFor(address) external view returns(uint256[] memory);
    function mintedTotally() external view returns(uint256);
    function mintedTotallyByBridge(address) external view returns(uint256);
}
