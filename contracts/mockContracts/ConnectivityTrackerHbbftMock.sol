// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

contract ConnectivityTrackerHbbftMock {
    mapping(uint256 => bool) public earlyEpochEnd;

    receive() external payable {}

    function setEarlyEpochEnd(uint256 epoch, bool set) external {
        earlyEpochEnd[epoch] = set;
    }

    function isEarlyEpochEnd(uint256 epoch) external view returns (bool) {
        return earlyEpochEnd[epoch];
    }
}
