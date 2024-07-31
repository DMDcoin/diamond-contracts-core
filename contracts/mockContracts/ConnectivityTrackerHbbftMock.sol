// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

contract ConnectivityTrackerHbbftMock {
    mapping(uint256 => bool) public earlyEpochEnd;
    mapping(uint256 => bool) public epochPenaltiesSent;

    receive() external payable {}

    function setEarlyEpochEnd(uint256 epoch, bool set) external {
        earlyEpochEnd[epoch] = set;
    }

    function penaliseFaultyValidators(uint256 epoch) external {
        epochPenaltiesSent[epoch] = true;
    }

    function isEarlyEpochEnd(uint256 epoch) external view returns (bool) {
        return earlyEpochEnd[epoch];
    }

    function isEpochPenaltiesSent(uint256 epoch) external view returns (bool) {
        return epochPenaltiesSent[epoch];
    }
}
