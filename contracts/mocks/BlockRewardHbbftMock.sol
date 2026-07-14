// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { IConnectivityTrackerHbbft } from "../interfaces/IConnectivityTrackerHbbft.sol";
import { BlockRewardHbbft } from "../BlockRewardHbbft.sol";

contract BlockRewardHbbftMock is BlockRewardHbbft {
    // =============================================== Setters ========================================================

    function sendCoins() external payable {
        return;
    }

    function setConnectivityTracker(address _connectivityTracker) external {
        connectivityTracker = IConnectivityTrackerHbbft(_connectivityTracker);
    }

    function setGovernanceAddress(address _address) external {
        governancePotAddress = payable(_address);
    }

    function resetEarlyEpochEnd() external {
        earlyEpochEnd = false;
    }

    function getPotsShares(uint256 numValidators) external view returns (PotsShares memory) {
        return _getPotsShares(numValidators);
    }
}
