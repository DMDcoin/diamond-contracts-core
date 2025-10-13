// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import { ScoringFactor, IBonusScoreSystem } from "./interfaces/IBonusScoreSystem.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";
import { Unauthorized, ZeroAddress } from "./lib/Errors.sol";
import { ValueGuards } from "./lib/ValueGuards.sol";

/// @dev Stores validators bonus score based on their behavior.
/// Validator with a higher bonus score has a higher likelihood to be elected.
contract BonusScoreSystem is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, ValueGuards, IBonusScoreSystem {
    uint256 public standByFactor;
    uint256 public constant DEFAULT_NO_STAND_BY_FACTOR = 20;
    uint256 public constant DEFAULT_NO_KEY_WRITE_FACTOR = 100;
    uint256 public constant DEFAULT_BAD_PERF_FACTOR = 100;

    uint256 public constant MIN_SCORE = 1;
    uint256 public constant MAX_SCORE = 1000;

    IStakingHbbft public stakingHbbft;
    address public validatorSetHbbft;
    address public connectivityTracker;

    /// @dev Current bonus score factors bonus/penalty value
    mapping(ScoringFactor => uint256) private _factors;

    /// @dev Validators mining address to current bonus score mapping
    mapping(address => uint256) private _validatorScore;

    /// @dev Timestamp of validator stand by reward/penalty
    mapping(address => uint256) private _standByScoreChangeTimestamp;

    /// @dev Emitted by the `_updateValidatorScore` function when validator's score changes for one
    /// of the {ScoringFactor} reasons described in `factor`
    /// @param miningAddress Validator's mining address.
    /// @param factor Scoring factor type.
    /// @param newScore New validator's bonus score value.
    event ValidatorScoreChanged(address indexed miningAddress, ScoringFactor indexed factor, uint256 newScore);

    /// @dev Emitted by the `updateScoringFactor` function when bonus/penalty for specified
    /// scoring factor changed by contract owner (DAO contract).
    /// @param factor Scoring factor type.
    /// @param value New scoring factor bonus/penalty value.
    event UpdateScoringFactor(ScoringFactor indexed factor, uint256 value);

    /// @dev Emitted by the `setStandByFactor` function when standby factor is changed.
    /// @param standByFactor New standby factor value.
    event SetStandByFactor(uint256 standByFactor);

    error InvalidIntervalStartTimestamp();

    modifier onlyValidatorSet() {
        if (msg.sender != validatorSetHbbft) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyConnectivityTracker() {
        if (msg.sender != connectivityTracker) {
            revert Unauthorized();
        }
        _;
    }

    /// @dev Contract initializer.
    /// @param _owner Contract owner address.
    /// @param _validatorSetHbbft ValidatorSetHbbft contract address.
    /// @param _connectivityTracker ConnectivityTrackerHbbft contract address.
    /// @param _stakingHbbft StakingHbbft contract address.
    function initialize(
        address _owner,
        address _validatorSetHbbft,
        address _connectivityTracker,
        address _stakingHbbft
    ) external initializer {
        if (
            _owner == address(0) ||
            _validatorSetHbbft == address(0) ||
            _connectivityTracker == address(0) ||
            _stakingHbbft == address(0)
        ) {
            revert ZeroAddress();
        }

        __Ownable_init(_owner);
        __ReentrancyGuard_init();

        // Initialize ValueGuards for standByFactor
        uint256[] memory standByFactorAllowedParams = new uint256[](9);
        for (uint256 i = 0; i < standByFactorAllowedParams.length; ++i) {
            standByFactorAllowedParams[i] = 10 + i * 5;
        }

        __initAllowedChangeableParameter(
            this.setStandByFactor.selector,
            this.standByFactor.selector,
            standByFactorAllowedParams
        );

        standByFactor = 20;

        validatorSetHbbft = _validatorSetHbbft;
        connectivityTracker = _connectivityTracker;
        stakingHbbft = IStakingHbbft(_stakingHbbft);

        _setInitialScoringFactors();
    }

    /// @dev Sets the standby factor value.
    /// @param _standByFactor The new standby factor value.
    function setStandByFactor(uint256 _standByFactor) external onlyOwner withinAllowedRange(_standByFactor) {
        standByFactor = _standByFactor;
        _factors[ScoringFactor.StandByBonus] = _standByFactor;

        emit SetStandByFactor(_standByFactor);
    }

    /// @dev Reward a validator who could not get into the current set, but was available.
    /// @param mining Validator mining address
    /// @param availableSince Timestamp from which the validator is available.
    function rewardStandBy(address mining, uint256 availableSince) external onlyValidatorSet nonReentrant {
        _updateScoreStandBy(mining, ScoringFactor.StandByBonus, availableSince);
    }

    /// @dev Penalise validator marked as unavailable.
    /// @param mining Validator mining address
    /// @param unavailableSince Timestamp from which the validator is unavailable.
    function penaliseNoStandBy(address mining, uint256 unavailableSince) external onlyValidatorSet nonReentrant {
        _updateScoreStandBy(mining, ScoringFactor.NoStandByPenalty, unavailableSince);
    }

    /// @dev Penalise validator for missed Part/ACK.
    /// @param mining Validator mining address
    function penaliseNoKeyWrite(address mining) external onlyValidatorSet nonReentrant {
        // timeInterval argument in _updateValidatorScore function call here is irrelevant,
        // because penalty score amount does not depend on time.
        _updateValidatorScore(mining, ScoringFactor.NoKeyWritePenalty, 0);
    }

    /// @dev Penalise validator for bad performance (lost connectivity).
    /// Zero `time` value means full score decrease value (= DEFAULT_BAD_PERF_FACTOR)
    /// @param mining Validator mining address
    /// @param time Time interval from the moment when the validator was marked as faulty until full reconnect.
    function penaliseBadPerformance(address mining, uint256 time) external onlyConnectivityTracker nonReentrant {
        _updateValidatorScore(mining, ScoringFactor.BadPerformancePenalty, time);
    }

    /// @dev Returns current bonus/penalty value for specified scoring factor `factor`
    /// @param factor Type of scoring factor.
    /// @return value Scoring factor value.
    function getScoringFactorValue(ScoringFactor factor) public view returns (uint256) {
        return _factors[factor];
    }

    /// @dev Returns time in seconds needed to accumulate single score point depending on scoring `factor`
    /// @param factor Type of scroing factor.
    /// @return value time interval in seconds.
    function getTimePerScorePoint(ScoringFactor factor) public view returns (uint256) {
        uint256 fixedEpochDuration = stakingHbbft.stakingFixedEpochDuration();

        return fixedEpochDuration / getScoringFactorValue(factor);
    }

    /// @dev Get current validator score.
    /// @param mining Validator mining address.
    /// @return value current validator score.
    function getValidatorScore(address mining) public view returns (uint256) {
        // will return current validator score or MIN_SCORE if score has not been recorded before.
        return Math.max(_validatorScore[mining], MIN_SCORE);
    }

    /// @dev Initialize default scoring factors bonus/penalty values.
    function _setInitialScoringFactors() private {
        _factors[ScoringFactor.StandByBonus] = standByFactor;
        _factors[ScoringFactor.NoStandByPenalty] = DEFAULT_NO_STAND_BY_FACTOR;
        _factors[ScoringFactor.NoKeyWritePenalty] = DEFAULT_NO_KEY_WRITE_FACTOR;
        _factors[ScoringFactor.BadPerformancePenalty] = DEFAULT_BAD_PERF_FACTOR;
    }

    function _updateScoreStandBy(address mining, ScoringFactor factor, uint256 availabilityTimestamp) private {
        // Take the latest point in time, to calculate stand by interval.
        // If _standByScoreChangeTimestamp > availabilityTimestamp means we have already given
        // stand by bonus/penalty previously.
        uint256 intervalStart = Math.max(_standByScoreChangeTimestamp[mining], availabilityTimestamp);

        if (intervalStart >= block.timestamp) {
            revert InvalidIntervalStartTimestamp();
        }

        _updateValidatorScore(mining, factor, block.timestamp - intervalStart);

        _standByScoreChangeTimestamp[mining] = block.timestamp;
    }

    /// @dev Update current validator score
    /// @param mining Validator mining address
    /// @param factor Type of scoring factor - reason to change validator score
    /// @param timeInterval Interval of time used to calculate score change
    /// Emits {ValidatorScoreChanged} event
    function _updateValidatorScore(address mining, ScoringFactor factor, uint256 timeInterval) private {
        bool isScoreIncrease = _isScoreIncrease(factor);

        uint256 scorePoints = _getAccumulatedScorePoints(factor, timeInterval);
        uint256 currentScore = getValidatorScore(mining);

        uint256 newScore;

        if (isScoreIncrease) {
            newScore = Math.min(MAX_SCORE, currentScore + scorePoints);
        } else {
            newScore = currentScore - Math.min(currentScore, scorePoints);

            // slither-disable-next-line incorrect-equality
            if (newScore == 0) {
                newScore = MIN_SCORE;
            }
        }

        _validatorScore[mining] = newScore;

        stakingHbbft.updatePoolLikelihood(mining, newScore);

        emit ValidatorScoreChanged(mining, factor, newScore);
    }

    function _getAccumulatedScorePoints(ScoringFactor factor, uint256 timeInterval) private view returns (uint256) {
        uint256 scoringFactorValue = getScoringFactorValue(factor);

        // slither-disable-start incorrect-equality
        if (factor == ScoringFactor.NoKeyWritePenalty) {
            return scoringFactorValue;
        } else if (factor == ScoringFactor.BadPerformancePenalty && timeInterval == 0) {
            return scoringFactorValue;
        } else {
            // Eliminate a risk to get more points than defined MAX for given `factor`
            return Math.min(timeInterval / getTimePerScorePoint(factor), scoringFactorValue);
        }
        // slither-disable-end incorrect-equality
    }

    function _isScoreIncrease(ScoringFactor factor) private pure returns (bool) {
        return factor == ScoringFactor.StandByBonus;
    }
}
