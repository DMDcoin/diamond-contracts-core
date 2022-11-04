pragma solidity =0.8.17;

import "./StakingHbbftBaseMock.sol";
import "../../contracts/base/StakingHbbftCoins.sol";

contract StakingHbbftCoinsMock is StakingHbbftCoins, StakingHbbftBaseMock {
    modifier onlyValidatorSetContract()
        virtual
        override(StakingHbbftBase, StakingHbbftBaseMock) {
        require(
            msg.sender == address(validatorSetContract) ||
                msg.sender == address(validatorSetContractMock),
            "Only ValidatorSet"
        );
        _;
    }

    function _getMaxCandidates()
        internal
        pure
        virtual
        override(StakingHbbftBase, StakingHbbftBaseMock)
        returns (uint256)
    {
        return 100;
    }

    function _sendWithdrawnStakeAmount(address payable _to, uint256 _amount)
        internal
        virtual
        override(StakingHbbftBase, StakingHbbftCoins)
    {
        if (!_to.send(_amount)) {
            // We use the `Sacrifice` trick to be sure the coins can be 100% sent to the receiver.
            // Otherwise, if the receiver is a contract which has a revert in its fallback function,
            // the sending will fail.
            (new Sacrifice2){value: _amount}(_to);
        }
    }
}
