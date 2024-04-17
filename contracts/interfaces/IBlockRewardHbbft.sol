pragma solidity =0.8.17;

interface IBlockRewardHbbft {
    function addToReinsertPot() external payable;

    function notifyEarlyEpochEnd() external;

    // function transferReward(uint256, address payable) external;

    // function epochsPoolGotRewardFor(
    //     address
    // ) external view returns (uint256[] memory);

    function getGovernanceAddress() external view returns (address);

    // function getDelegatorReward(
    //     uint256,
    //     uint256,
    //     address
    // ) external view returns (uint256);


    // function getValidatorReward(
    //     uint256,
    //     address
    // ) external view returns (uint256);
}
