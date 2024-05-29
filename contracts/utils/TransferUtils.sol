pragma solidity =0.8.25;

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
}
