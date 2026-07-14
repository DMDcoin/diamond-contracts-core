// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.8.25;

import { IBonusScoreSystem } from "../interfaces/IBonusScoreSystem.sol";

contract ReentrancyAttacker {
    IBonusScoreSystem public bonusScoreSystem;
    uint256 public timeArgValue;
    bytes4 public funcId;

    function setFuncId(bytes4 id) external {
        funcId = id;
    }

    function setBonusScoreContract(address _bonusScoreSystem) external {
        bonusScoreSystem = IBonusScoreSystem(_bonusScoreSystem);
    }

    function attack(address mining, uint256 time) public {
        timeArgValue = time;

        if (funcId == IBonusScoreSystem.rewardStandBy.selector) {
            bonusScoreSystem.rewardStandBy(mining, timeArgValue);
        } else if (funcId == IBonusScoreSystem.penaliseNoStandBy.selector) {
            bonusScoreSystem.penaliseNoStandBy(mining, timeArgValue);
        } else if (funcId == IBonusScoreSystem.penaliseBadPerformance.selector){
            bonusScoreSystem.penaliseBadPerformance(mining, timeArgValue);
        } else {
            bonusScoreSystem.penaliseNoKeyWrite(mining);
        }
    }

    function stakingFixedEpochDuration() external pure returns (uint256) {
        return 43200;
    }

    function updatePoolLikelihood(address mining, uint256) external {
        if (funcId == IBonusScoreSystem.rewardStandBy.selector) {
            bonusScoreSystem.rewardStandBy(mining, timeArgValue);
        } else if (funcId == IBonusScoreSystem.penaliseNoStandBy.selector) {
            bonusScoreSystem.penaliseNoStandBy(mining, timeArgValue);
        } else if (funcId == IBonusScoreSystem.penaliseBadPerformance.selector){
            bonusScoreSystem.penaliseBadPerformance(mining, timeArgValue);
        } else {
            bonusScoreSystem.penaliseNoKeyWrite(mining);
        }
    }
}