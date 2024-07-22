// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;


import { IGovernancePot } from "../interfaces/IGovernancePot.sol";  

contract DaoMock is IGovernancePot {

    uint256 phaseCounter;

    function switchPhase() external {
        phaseCounter += 1;
    }

    receive() external payable {

    }
}
