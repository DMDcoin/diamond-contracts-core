// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

enum ScoringFactor {
    StandByBonus,
    NoStandByPenalty,
    NoKeyWritePenalty,
    BadPerformancePenalty
}

interface IBonusScoreSystem {
    function getValidatorScore(address mining) external view returns (uint256);

    function rewardStandBy(address mining, uint256 time) external;

    function penaliseNoStandBy(address mining, uint256 time) external;

    function penaliseNoKeyWrite(address mining) external;

    function penaliseBadPerformance(address mining, uint256 time) external;
}
