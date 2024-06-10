// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.25;

import { TransferUtils } from "../utils/TransferUtils.sol";

contract TransferUtilsMock {
    using TransferUtils for address;

    receive() external payable {}

    function transferNative(address recipient, uint256 amount) external payable {
        recipient.transferNative(amount);
    }
}
