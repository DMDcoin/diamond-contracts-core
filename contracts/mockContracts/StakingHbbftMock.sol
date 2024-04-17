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
        // delegatorStakeSnapshot[_poolStakingAddress][_delegator][
        //     _stakingEpoch
        // ] = 0;
    }

    function setStakeAmountTotal(address _poolStakingAddress, uint256 _amount)
        public
    {
        stakeAmountTotal[_poolStakingAddress] = _amount;
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
}
