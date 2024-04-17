pragma solidity =0.8.17;

import { Sacrifice } from "./Sacrifice.sol";

library TransferUtils {
    error InsufficientBalance();
    error TransferFailed(address recipient, uint256 amount);

    function transferNative(address recipient, uint256 amount) internal {
        if (address(this).balance < amount) {
            revert InsufficientBalance();
        }

        // solhint-disable-next-line avoid-low-level-calls
        (bool success, ) = recipient.call{ value: amount }("");
        if (!success) {
            revert TransferFailed(recipient, amount);
        }
    }

    /// @dev Sends coins from this contract to the specified address.
    /// @param _to The target address to send amount to.
    /// @param _amount The amount to send.
    function transferNativeEnsure(
        address payable _to,
        uint256 _amount
    ) internal {
        // slither-disable-next-line arbitrary-send-eth
        if (_amount != 0 && !_to.send(_amount)) {
            // We use the `Sacrifice` trick to be sure the coins can be 100% sent to the receiver.
            // Otherwise, if the receiver is a contract which has a revert in its fallback function,
            // the sending will fail.
            (new Sacrifice){value: _amount}(_to);
        }
    }
}
