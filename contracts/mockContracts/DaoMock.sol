// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;


import { IGovernancePot } from "../interfaces/IGovernancePot.sol";  

contract DaoMock is IGovernancePot {

    uint256 public phaseCounter;
    
    error SwitchPhaseReverted();

    function switchPhase() external {
        phaseCounter += 1;

        // in order to also test the scenario that the DAO switchPhase() reverts,
        // and the blocks are still able to get closed,
        // we revert here.
        if (phaseCounter > 4) {
            revert SwitchPhaseReverted();
        }
    }

    receive() external payable {

    }
}
