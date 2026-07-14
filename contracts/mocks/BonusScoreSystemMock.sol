// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { IBonusScoreSystem } from "../interfaces/IBonusScoreSystem.sol";

contract BonusScoreSystemMock is IBonusScoreSystem {
    uint256 public constant DEFAULT_STAND_BY_FACTOR = 15;
    uint256 public constant DEFAULT_NO_STAND_BY_FACTOR = 15;
    uint256 public constant DEFAULT_NO_KEY_WRITE_FACTOR = 100;
    uint256 public constant DEFAULT_BAD_PERF_FACTOR = 100;

    uint256 public constant MIN_SCORE = 1;
    uint256 public constant MAX_SCORE = 1000;

    mapping(address => uint256) public validatorScore;

    receive() external payable {}

    function rewardStandBy(address mining, uint256) external {
        uint256 currentScore = validatorScore[mining];

        validatorScore[mining] = Math.min(currentScore + DEFAULT_STAND_BY_FACTOR, MAX_SCORE);
    }

    function penaliseNoStandBy(address mining, uint256) external {
        uint256 currentScore = validatorScore[mining];

        if (currentScore <= DEFAULT_NO_STAND_BY_FACTOR) {
            validatorScore[mining] = MIN_SCORE;
        } else {
            validatorScore[mining] = currentScore - DEFAULT_NO_STAND_BY_FACTOR;
        }
    }

    function penaliseNoKeyWrite(address mining) external {
        uint256 currentScore = validatorScore[mining];

        if (currentScore <= DEFAULT_NO_KEY_WRITE_FACTOR) {
            validatorScore[mining] = MIN_SCORE;
        } else {
            validatorScore[mining] = currentScore - DEFAULT_NO_KEY_WRITE_FACTOR;
        }
    }

    function penaliseBadPerformance(address mining, uint256) external {
        uint256 currentScore = validatorScore[mining];

        if (currentScore <= DEFAULT_BAD_PERF_FACTOR) {
            validatorScore[mining] = MIN_SCORE;
        } else {
            validatorScore[mining] = currentScore - DEFAULT_BAD_PERF_FACTOR;
        }
    }

    function setValidatorScore(address mining, uint256 value) external {
        validatorScore[mining] = value;
    }

    function getValidatorScore(address mining) external view returns (uint256) {
        return Math.max(validatorScore[mining], MIN_SCORE);
    }
}
