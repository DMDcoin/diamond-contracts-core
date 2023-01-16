pragma solidity =0.8.17;

interface IRandomHbbft {
    function initialize(address) external;

    function currentSeed() external view returns (uint256);

    function getSeedHistoric(uint256 _blocknumber)
        external
        view
        returns (uint256);

    function getSeedsHistoric(uint256[] calldata)
        external
        view
        returns (uint256[] memory);

    function isFullHealth() external view returns (bool);

    function isFullHealthHistoric(uint256[] calldata)
        external
        view
        returns (bool[] memory);
}
