// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

interface IReverseRegistry {
    event ReverseConfirmed(string name, address indexed reverse);
    event ReverseRemoved(string name, address indexed reverse);

    function hasReverse(bytes32 _name) external view returns (bool);

    function getReverse(bytes32 _name) external view returns (address);

    function canReverse(address _data) external view returns (bool);

    function reverse(address _data) external view returns (string memory);
}
