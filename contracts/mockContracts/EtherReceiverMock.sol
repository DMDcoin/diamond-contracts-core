// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.17;

contract EtherReceiverMock {
    bool public allowReceive;

    error ReceiveDisabled();

    constructor() {
        allowReceive = true;
    }

    receive() external payable {
        if (!allowReceive) {
            revert ReceiveDisabled();
        }
    }

    function toggleReceive(bool allow) external {
        allowReceive = allow;
    }
}
