pragma solidity ^0.5.16;

import './BlockRewardHbbftBaseMock.sol';
import '../../contracts/base/BlockRewardHbbftCoins.sol';


contract BlockRewardHbbftCoinsMock is BlockRewardHbbftCoins, BlockRewardHbbftBaseMock {
    function setEpochPoolReward(
        uint256 _stakingEpoch,
        address _poolMiningAddress
    ) public payable {
        require(_stakingEpoch != 0);
        require(_poolMiningAddress != address(0));
        require(msg.value != 0);
        require(epochPoolNativeReward[_stakingEpoch][_poolMiningAddress] == 0);
        epochPoolNativeReward[_stakingEpoch][_poolMiningAddress] = msg.value;
        _epochsPoolGotRewardFor[_poolMiningAddress].push(_stakingEpoch);
    }
}
