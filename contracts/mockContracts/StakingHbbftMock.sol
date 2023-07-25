pragma solidity =0.8.17;

import "../StakingHbbft.sol";

contract StakingHbbftMock is StakingHbbft {
    IValidatorSetHbbft validatorSetContractMock;

    modifier onlyValidatorSetContract()
        virtual
        override {
        require(
            msg.sender == address(validatorSetContract) ||
                msg.sender == address(validatorSetContractMock),
            "Only ValidatorSet"
        );
        _;
    }
    // =============================================== Setters ========================================================

    function addPoolActiveMock(address _stakingAddress) public {
        _addPoolActive(_stakingAddress, true);
    }

    function addPoolInactiveMock(address _stakingAddress) public {
        _addPoolInactive(_stakingAddress);
    }

    function clearDelegatorStakeSnapshot(
        address _poolStakingAddress,
        address _delegator,
        uint256 _stakingEpoch
    ) public {
        delegatorStakeSnapshot[_poolStakingAddress][_delegator][
            _stakingEpoch
        ] = 0;
    }

    function clearRewardWasTaken(
        address _poolStakingAddress,
        address _staker,
        uint256 _epoch
    ) public {
        rewardWasTaken[_poolStakingAddress][_staker][_epoch] = false;
    }

    function setStakeAmountTotal(address _poolStakingAddress, uint256 _amount)
        public
    {
        stakeAmountTotal[_poolStakingAddress] = _amount;
    }

    function setStakeFirstEpoch(
        address _poolStakingAddress,
        address _delegator,
        uint256 _value
    ) public {
        stakeFirstEpoch[_poolStakingAddress][_delegator] = _value;
    }

    function setStakeLastEpoch(
        address _poolStakingAddress,
        address _delegator,
        uint256 _value
    ) public {
        stakeLastEpoch[_poolStakingAddress][_delegator] = _value;
    }

    function setStakingEpoch(uint256 _stakingEpoch) public {
        stakingEpoch = _stakingEpoch;
    }

    function setValidatorMockSetAddress(IValidatorSetHbbft _validatorSetAddress)
        public
    {
        validatorSetContractMock = _validatorSetAddress;
    }

    function setValidatorSetAddress(IValidatorSetHbbft _validatorSetAddress)
        public
    {
        validatorSetContract = _validatorSetAddress;
    }

    // =============================================== Getters ========================================

    // =============================================== Private ========================================================

    function _getMaxCandidates()
        internal
        pure
        virtual
        override
        returns (uint256)
    {
        return 100;
    }

    function _sendWithdrawnStakeAmount(address payable _to, uint256 _amount)
        internal
        virtual
        override
    {
        if (!_to.send(_amount)) {
            // We use the `Sacrifice` trick to be sure the coins can be 100% sent to the receiver.
            // Otherwise, if the receiver is a contract which has a revert in its fallback function,
            // the sending will fail.
            (new Sacrifice2){value: _amount}(_to);
        }
    }
}
