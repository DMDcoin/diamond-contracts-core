pragma solidity ^0.5.16;

import './BlockRewardHbbftBaseMock.sol';
import '../../contracts/base/BlockRewardHbbftCoins.sol';


contract BlockRewardHbbftCoinsMock is BlockRewardHbbftCoins, BlockRewardHbbftBaseMock {
    function setEpochPoolReward(
        uint256 _stakingEpoch,
        address _poolMiningAddress,
        uint256 _reward
    ) public {
        require(_stakingEpoch != 0);
        require(_poolMiningAddress != address(0));
        require(_reward != 0);
        require(epochPoolNativeReward[_stakingEpoch][_poolMiningAddress] == 0);
        epochPoolNativeReward[_stakingEpoch][_poolMiningAddress] = _reward;
        _epochsPoolGotRewardFor[_poolMiningAddress].push(_stakingEpoch);
    }
}
