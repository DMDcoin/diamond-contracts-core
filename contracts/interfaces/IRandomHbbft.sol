// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

interface IRandomHbbft {
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

    function isFullHealthHistoric(uint256)
        external
        view
        returns (bool);

    function isFullHealthsHistoric(uint256[] calldata)
        external
        view
        returns (bool[] memory);
}
