// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import "forge-std/Test.sol";

import {SYSTEM_ADDRESS} from "../contracts/lib/Constants.sol";
import {BlockRewardHbbft} from "../contracts/BlockRewardHbbft.sol";
import {StakingHbbft} from "../contracts/StakingHbbft.sol";

contract TestRewardCall is Test {
    BlockRewardHbbft public blockReward;
    StakingHbbft public staking;

    function setUp() public {
        blockReward = BlockRewardHbbft(payable(0x2000000000000000000000000000000000000001));
        staking = StakingHbbft(payable(0x1100000000000000000000000000000000000001));

        vm.deal(SYSTEM_ADDRESS, 10 ether);
    }

    function test_RewardCall() public {
        // run next call as impersonated address
        vm.startPrank(SYSTEM_ADDRESS);

        address buggedPool = 0x47359A3E61B715A718AECfB33e1F2396E50842d2;

        address[] memory delegators = staking.poolDelegators(buggedPool);
        for (uint256 i = 0; i < delegators.length; ++i) {
            uint256 delegatorStake = staking.stakeAmount(buggedPool, delegators[i]);
        }

        staking.initializeV2();

        blockReward.reward(true);

        for (uint256 i = 0; i < 10; ++i) {
            blockReward.reward(false);
        }

        vm.stopPrank();
    }
}
