pragma solidity ^0.5.16;

import './BlockRewardHbbftBaseMock.sol';
import '../../contracts/base/BlockRewardHbbftCoins.sol';


contract BlockRewardHbbftCoinsMock is BlockRewardHbbftCoins, BlockRewardHbbftBaseMock {
    function setEpochPoolReward(
        uint256 _stakingEpoch,
        address _poolMiningAddress
    ) public payable {
        require(_stakingEpoch != 0, "SetEpochPoolReward: epoch can't be 0");
        require(_poolMiningAddress != address(0), "SetEpochPoolReward: epoch can't be 0");
        require(msg.value != 0, "SetEpochPoolReward: reward can't be 0");
        require(epochPoolNativeReward[_stakingEpoch][_poolMiningAddress] == 0,
            "SetEpochPoolReward: epochPoolNativeReward already set");
        epochPoolNativeReward[_stakingEpoch][_poolMiningAddress] = msg.value;

        uint256[] memory thisPoolsRewards = _epochsPoolGotRewardFor[_poolMiningAddress];
        for(uint i = 0; i < thisPoolsRewards.length; i++) {
            require(thisPoolsRewards[i] != _stakingEpoch, 
                "There is already a Reward pending for this mining address!");
        }

        _epochsPoolGotRewardFor[_poolMiningAddress].push(_stakingEpoch);
    }
}
