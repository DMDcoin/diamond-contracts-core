// SPDX-License-Identifier: MIT
pragma solidity =0.8.17;

import { DateTime } from "../libs/DateTime.sol";

contract DateTimeMock {
    function isLeapYear(uint256 timestamp) public pure returns (bool leapYear) {
        return DateTime.isLeapYear(timestamp);
    }

    function getDaysInMonth(uint256 timestamp) public pure returns (uint256 daysInMonth) {
        return DateTime.getDaysInMonth(timestamp);
    }

    function addYears(uint256 timestamp, uint256 _years) public pure returns (uint256 newTimestamp) {
        return DateTime.addYears(timestamp, _years);
    }

    function diffYears(uint256 fromTimestamp, uint256 toTimestamp) public pure returns (uint256 _years) {
        return DateTime.diffYears(fromTimestamp, toTimestamp);
    }
}
