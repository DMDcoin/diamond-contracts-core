pragma solidity =0.8.17;

interface IBlockRewardHbbft {
    function addToReinsertPot() external payable;

    function epochsPoolGotRewardFor(address)
        external
        view
        returns (uint256[] memory);

    function governancePotAddress() external view returns (address payable);
}
