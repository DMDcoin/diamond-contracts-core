pragma solidity ^0.5.16;

import '../../contracts/base/BlockRewardHbbftBase.sol';


contract BlockRewardHbbftBaseMock is BlockRewardHbbftBase {

    address internal _systemAddress;

    // ============================================== Modifiers =======================================================

    modifier onlySystem() {
        require(msg.sender == _getSystemAddress());
        _;
    }

    // =============================================== Setters ========================================================

    function sendCoins()
    public
    payable {
    }

    function setSystemAddress(address _address)
    public {
        _systemAddress = _address;
    }

    function setValidatorMinRewardPercent(uint256 _stakingEpoch, uint256 _percent)
    public {
        validatorMinRewardPercent[_stakingEpoch] = _percent;
    }

    function snapshotPoolStakeAmounts(
        IStakingHbbft _stakingContract,
        uint256 _stakingEpoch,
        address _miningAddress
    ) public {
        _snapshotPoolStakeAmounts(_stakingContract, _stakingEpoch, _miningAddress);
    }

    function setSnapshotPoolValidatorStakeAmount(uint256 _stakingEpoch, address _poolMiningAddress, uint256 _amount)
    public {
        snapshotPoolValidatorStakeAmount[_stakingEpoch][_poolMiningAddress] = _amount;
    }

    // =============================================== Private ========================================================

    function _getSystemAddress()
    internal
    view
    returns(address) {
        return _systemAddress;
    }

}
