pragma solidity =0.8.17;

import "../BlockRewardHbbft.sol";

contract BlockRewardHbbftMock is BlockRewardHbbft {
    address internal _systemAddress;

    // ============================================== Modifiers =======================================================

    modifier onlySystem() virtual override {
        require(msg.sender == _getSystemAddress());
        _;
    }

    // =============================================== Setters ========================================================

    function sendCoins() public payable {}

    function setSystemAddress(address _address) public {
        _systemAddress = _address;
    }

    function setGovernanceAddress(address _address) public {
        governancePotAddress = payable(_address);
    }

    function setValidatorMinRewardPercent(
        uint256 _stakingEpoch,
        uint256 _percent
    ) public {
        validatorMinRewardPercent[_stakingEpoch] = _percent;
    }

    function snapshotPoolStakeAmounts(
        IStakingHbbft _stakingContract,
        uint256 _stakingEpoch,
        address _miningAddress
    ) public {
        _snapshotPoolStakeAmounts(
            _stakingContract,
            _stakingEpoch,
            _miningAddress
        );
    }

    function setSnapshotPoolValidatorStakeAmount(
        uint256 _stakingEpoch,
        address _poolMiningAddress,
        uint256 _amount
    ) public {
        snapshotPoolValidatorStakeAmount[_stakingEpoch][
            _poolMiningAddress
        ] = _amount;
    }

    function setEpochPoolReward(
        uint256 _stakingEpoch,
        address _poolMiningAddress
    ) public payable {
        require(_stakingEpoch != 0, "SetEpochPoolReward: epoch can't be 0");
        require(
            _poolMiningAddress != address(0),
            "SetEpochPoolReward: epoch can't be 0"
        );
        require(msg.value != 0, "SetEpochPoolReward: reward can't be 0");
        require(
            epochPoolNativeReward[_stakingEpoch][_poolMiningAddress] == 0,
            "SetEpochPoolReward: epochPoolNativeReward already set"
        );
        epochPoolNativeReward[_stakingEpoch][_poolMiningAddress] = msg.value;

        uint256[] memory thisPoolsRewards = _epochsPoolGotRewardFor[
            _poolMiningAddress
        ];
        for (uint256 i = 0; i < thisPoolsRewards.length; i++) {
            require(
                thisPoolsRewards[i] != _stakingEpoch,
                "There is already a Reward pending for this mining address!"
            );
        }

        _epochsPoolGotRewardFor[_poolMiningAddress].push(_stakingEpoch);
    }

    // =============================================== Private ========================================================

    function _getSystemAddress() internal view returns (address) {
        return _systemAddress;
    }
}
