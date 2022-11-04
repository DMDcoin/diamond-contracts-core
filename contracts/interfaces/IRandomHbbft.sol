pragma solidity =0.8.17;

interface IRandomHbbft {
    function currentSeed() external view returns (uint256);

    function randomHistory(uint256) external view returns (uint256);

    function getHistoricalSeeds(uint256[] calldata)
        external
        view
        returns (uint256[] memory);
}
