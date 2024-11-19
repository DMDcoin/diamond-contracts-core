// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IConnectivityTrackerHbbft } from "./interfaces/IConnectivityTrackerHbbft.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";
import { IBlockRewardHbbft } from "./interfaces/IBlockRewardHbbft.sol";
import { IBonusScoreSystem } from "./interfaces/IBonusScoreSystem.sol";

import { Unauthorized, ZeroAddress } from "./lib/Errors.sol";
import { ValueGuards } from "./lib/ValueGuards.sol";

contract ConnectivityTrackerHbbft is Initializable, OwnableUpgradeable, IConnectivityTrackerHbbft, ValueGuards {
    using EnumerableSet for EnumerableSet.AddressSet;

    /**
     * @dev The address of the {ValidatorSetHbbft} contract.
     */
    IValidatorSetHbbft public validatorSetContract;

    /**
     * @dev The address of the {StakingHbbft} contract.
     */
    IStakingHbbft public stakingContract;

    /**
     * @dev The address of the {BlockRewardHbbft} contract.
     */
    IBlockRewardHbbft public blockRewardContract;

    /**
     * @dev Time since the beginning of the epoch during which reports are not accepted.
     * @custom:oz-renamed-from minReportAgeBlocks
     */
    uint256 public reportDisallowPeriod;

    /**
     * @dev Parameter that binds Hbbft Fault tolerance with
     */
    uint256 public earlyEpochEndToleranceLevel;

    /**
     * @dev Early epoch end historical data.
     */
    mapping(uint256 => bool) public isEarlyEpochEnd;

    /**
     * @dev Mapping the epoch number to the list of validators that have disconnected in it.
     */
    mapping(uint256 => EnumerableSet.AddressSet) private _flaggedValidators;

    /**
     * @dev Mapping of reported validators and their reporters by epoch number.
     */
    mapping(uint256 => mapping(address => EnumerableSet.AddressSet)) private _reporters;

    /**
     * @dev Indicats wheter validators were penalised for bad performance in specific epoch.
     */
    mapping(uint256 => bool) private _epochPenaltiesSent;

    /**
     * @dev The address of the {BonusScoreSystem} contract.
     */
    IBonusScoreSystem public bonusScoreContract;

    /**
     * @dev Timestamp when the validator was marked as faulty in a specific epoch.
     */
    mapping(uint256 => mapping(address => uint256)) private _disconnectTimestamp;

    /**
     * @dev Emitted by the {setReportDisallowPeriod} function.
     * @param _reportDisallowPeriodSeconds New report disallow period value in seconds.
     */
    event SetReportDisallowPeriod(uint256 _reportDisallowPeriodSeconds);

    /**
     * @dev Emitted by the {setEarlyEpochEndToleranceLevel} function.
     * @param _level New early epoch end tolerance level.
     */
    event SetEarlyEpochEndToleranceLevel(uint256 _level);

    /**
     * @dev Emitted when `validator` was reported by `reporter` for lost connection at block `blockNumber`.
     * @param reporter Reporting validator address.
     * @param validator Address of the validator with which the connection was lost.
     * @param blockNumber Block number when connection was lost.
     */
    event ReportMissingConnectivity(address indexed reporter, address indexed validator, uint256 indexed blockNumber);

    /**
     * @dev Emitted when `validator` was reported by `reporter` as reconnected at block `blockNumber`.
     * @param reporter Reporting validator address.
     * @param validator Address of the reconnected validator.
     * @param blockNumber Block number when reported validator reconnected.
     */
    event ReportReconnect(address indexed reporter, address indexed validator, uint256 indexed blockNumber);

    /**
     * @dev Emitted to signal that the count of disconnected validators exceeded
     * the threshold and current epoch `epoch` will end earlier.
     * @param epoch Staking epoch number.
     * @param blockNumber Block number in which the decision was made.
     */
    event NotifyEarlyEpochEnd(uint256 indexed epoch, uint256 indexed blockNumber);

    error AlreadyReported(address reporter, address validator);
    error CannotReportByFlaggedValidator(address reporter);
    error InvalidBlock();
    error OnlyValidator();
    error ReportTooEarly();
    error UnknownReconnectReporter(address reporter, address validator);
    error EpochPenaltiesAlreadySent(uint256 epoch);

    /**
     * @custom:oz-upgrades-unsafe-allow constructor
     */
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    /**
     * @dev Check that the caller is {BlockRewardHbbft} contract.
     *
     * Reverts with an {Unauthorized} error.
     */
    modifier onlyBlockRewardContract() {
        if (msg.sender != address(blockRewardContract)) {
            revert Unauthorized();
        }
        _;
    }

    function initialize(
        address _contractOwner,
        address _validatorSetContract,
        address _stakingContract,
        address _blockRewardContract,
        address _bonusScoreContract,
        uint256 _reportDisallowPeriodSeconds
    ) external initializer {
        if (
            _contractOwner == address(0) ||
            _validatorSetContract == address(0) ||
            _stakingContract == address(0) ||
            _blockRewardContract == address(0) ||
            _bonusScoreContract == address(0)
        ) {
            revert ZeroAddress();
        }

        __Ownable_init(_contractOwner);

        validatorSetContract = IValidatorSetHbbft(_validatorSetContract);
        stakingContract = IStakingHbbft(_stakingContract);
        blockRewardContract = IBlockRewardHbbft(_blockRewardContract);
        bonusScoreContract = IBonusScoreSystem(_bonusScoreContract);

        reportDisallowPeriod = _reportDisallowPeriodSeconds;
        earlyEpochEndToleranceLevel = 2;

        uint256 step = 3 minutes;
        uint256[] memory reportDisallowPeriodAllowedParams = new uint256[](10);

        for (uint256 i = 0; i < 10; i++) {
            reportDisallowPeriodAllowedParams[i] = step + (i * step);
        }

        __initAllowedChangeableParameter(
            this.setReportDisallowPeriod.selector,
            this.reportDisallowPeriod.selector,
            reportDisallowPeriodAllowedParams
        );
    }

    /**
     * @dev This function sets the period of time during which reports are not accepted.
     * Can only be called by contract owner.
     * @param _reportDisallowPeriodSeconds Time period in seconds.
     *
     * Emits a {SetReportDisallowPeriod} event.
     */
    function setReportDisallowPeriod(uint256 _reportDisallowPeriodSeconds) external onlyOwner withinAllowedRange(_reportDisallowPeriodSeconds) {
        reportDisallowPeriod = _reportDisallowPeriodSeconds;

        emit SetReportDisallowPeriod(_reportDisallowPeriodSeconds);
    }

    /**
     * @dev This function sets the early epoch end tolerance level.
     * Can only be called by contract owner.
     * @param _level New early epoch end tolerance level.
     *
     * Emits a {SetEarlyEpochEndToleranceLevel} event.
     */
    function setEarlyEpochEndToleranceLevel(uint256 _level) external onlyOwner {
        earlyEpochEndToleranceLevel = _level;

        _decideEarlyEpochEndNeeded(currentEpoch());

        emit SetEarlyEpochEndToleranceLevel(_level);
    }

    /**
     * @dev Report that the connection to the specified validator was lost at block `blockNumber`.
     * Callable only by active validators.
     *
     * @param validator Validator address with which the connection was lost.
     * @param blockNumber Block number where the connection was lost.
     * @param blockHash Hash of this block.
     *
     * Emits a {ReportMissingConnectivity} event.
     */
    function reportMissingConnectivity(address validator, uint256 blockNumber, bytes32 blockHash) external {
        checkReportMissingConnectivityCallable(msg.sender, validator, blockNumber, blockHash);

        uint256 epoch = currentEpoch();
        uint256 currentScore = getValidatorConnectivityScore(epoch, validator);
        if (currentScore == 0) {
            // slither-disable-next-line unused-return
            _flaggedValidators[epoch].add(validator);
        }

        // slither-disable-next-line unused-return
        _reporters[epoch][validator].add(msg.sender);

        if (isFaultyValidator(epoch, validator)) {
            _markValidatorFaulty(epoch, validator);
        }

        _decideEarlyEpochEndNeeded(epoch);

        emit ReportMissingConnectivity(msg.sender, validator, blockNumber);
    }

    /**
     * @dev Report that the connection to the specified validator was restored at block `blockNumber`.
     * Callable only by active validators.
     *
     * @param validator Validator address with which the connection was restored.
     * @param blockNumber Block number where the connection was restored.
     * @param blockHash Hash of this block.
     *
     * Emits a {ReportReconnect} event.
     */
    function reportReconnect(address validator, uint256 blockNumber, bytes32 blockHash) external {
        checkReportReconnectCallable(msg.sender, validator, blockNumber, blockHash);

        uint256 epoch = currentEpoch();
        uint256 currentScore = getValidatorConnectivityScore(epoch, validator);

        // slither-disable-next-line unused-return
        _reporters[epoch][validator].remove(msg.sender);

        if (currentScore == 1) {
            // slither-disable-next-line unused-return
            _flaggedValidators[epoch].remove(validator);

            // All reporters confirmed that this validator reconnected,
            // decrease validator bonus score for bad performance based on disconnect time interval.
            uint256 disconnectTimestamp = _disconnectTimestamp[epoch][validator];
            if (disconnectTimestamp != 0) {
                uint256 disconnectPeriod = block.timestamp - disconnectTimestamp;

                bonusScoreContract.penaliseBadPerformance(validator, disconnectPeriod);

                delete _disconnectTimestamp[epoch][validator];
            }
        }

        _decideEarlyEpochEndNeeded(epoch);

        emit ReportReconnect(msg.sender, validator, blockNumber);
    }

    /**
     * @dev Send bad performance bonus score penalties to validators
     * that have not yet reconnected at the end of the epoch.
     * Can only be called by {BlockRewardHbbft} contract.
     *
     * @param epoch Staking epoch number.
     *
     * Reverts with {EpochPenaltiesAlreadySent} if penalties for specified `epoch` already sent.
     */
    function penaliseFaultyValidators(uint256 epoch) external onlyBlockRewardContract {
        if (_epochPenaltiesSent[epoch]) {
            revert EpochPenaltiesAlreadySent(epoch);
        }

        _epochPenaltiesSent[epoch] = true;

        address[] memory flaggedValidators = getFlaggedValidatorsByEpoch(epoch);

        for (uint256 i = 0; i < flaggedValidators.length; ++i) {
            if (!isFaultyValidator(epoch, flaggedValidators[i])) {
                continue;
            }

            bonusScoreContract.penaliseBadPerformance(flaggedValidators[i], 0);
        }
    }

    /**
     * @dev Returns true if the validator `validator` was reported
     * by the specified `reporter`at the current epoch.
     * @param validator Valdiator address.
     * @param reporter Reporting validator address.
     */
    function isReported(uint256, address validator, address reporter) external view returns (bool) {
        return _reporters[currentEpoch()][validator].contains(reporter);
    }

    function getValidatorConnectivityScore(uint256 epoch, address validator) public view returns (uint256) {
        return _reporters[epoch][validator].length();
    }

    /**
     * @dev Returns true if the validator `validator` was marked as faulty
     * (majority of other validators reported missing connectivity) in the specified `epoch`.
     * @param epoch Staking epoch number.
     * @param validator Validator address
     */
    function isFaultyValidator(uint256 epoch, address validator) public view returns (bool) {
        return getValidatorConnectivityScore(epoch, validator) >= _getReportersThreshold(epoch);
    }

    function checkReportMissingConnectivityCallable(
        address caller,
        address validator,
        uint256 blockNumber,
        bytes32 blockHash
    ) public view {
        uint256 epoch = currentEpoch();

        _validateParams(epoch, caller, blockNumber, blockHash);

        if (_reporters[epoch][validator].contains(caller)) {
            revert AlreadyReported(caller, validator);
        }
    }

    function checkReportReconnectCallable(
        address caller,
        address validator,
        uint256 blockNumber,
        bytes32 blockHash
    ) public view {
        uint256 epoch = currentEpoch();

        _validateParams(epoch, caller, blockNumber, blockHash);

        // Only "missing connectivity" reporter can also report reconnect
        if (!_reporters[epoch][validator].contains(caller)) {
            revert UnknownReconnectReporter(caller, validator);
        }
    }

    /**
     * @dev Get list of validators flagged for missing connectivity in the specified `epoch`.
     * @param epoch Staking epoch number.
     */
    function getFlaggedValidatorsByEpoch(uint256 epoch) public view returns (address[] memory) {
        return _flaggedValidators[epoch].values();
    }

    /**
     * @dev Get list of validators flagged for missing connectivity in the current epoch.
     * See {getFlaggedValidatorsByEpoch}.
     */
    function getFlaggedValidators() public view returns (address[] memory) {
        return getFlaggedValidatorsByEpoch(currentEpoch());
    }

    /**
     * @dev Get list of validators flagged for missing connectivity in the specified staking epoch `epoch`.
     * @param epoch Staking epoch number.
     */
    function getFlaggedValidatorsCount(uint256 epoch) public view returns (uint256) {
        return _flaggedValidators[epoch].length();
    }

    /**
     * @dev Get current staking epoch number.
     * See {StakingHbbft-stakingEpoch}
     */
    function currentEpoch() public view returns (uint256) {
        return IStakingHbbft(stakingContract).stakingEpoch();
    }

    /**
     * @dev Returns the number of validators that, if exceeded,
     * will trigger an early end of the current staking epoch.
     */
    function earlyEpochEndThreshold() public view returns (uint256) {
        uint256 networkSize = IValidatorSetHbbft(validatorSetContract).getCurrentValidatorsCount();
        uint256 hbbftFaultTolerance = networkSize / 3;

        if (hbbftFaultTolerance <= earlyEpochEndToleranceLevel) {
            return 0;
        } else {
            return hbbftFaultTolerance - earlyEpochEndToleranceLevel;
        }
    }

    /**
     * @dev Returns faulty validators count in given epoch `epoch`.
     * @param epoch Staking epoch number.
     */
    function countFaultyValidators(uint256 epoch) public view returns (uint256) {
        return _countFaultyValidators(epoch);
    }

    function _decideEarlyEpochEndNeeded(uint256 epoch) private {
        // skip checks since notification has already been sent
        if (isEarlyEpochEnd[epoch]) {
            return;
        }

        uint256 threshold = earlyEpochEndThreshold();
        uint256 faultyValidatorsCount = _countFaultyValidators(epoch);

        // threshold has not been passed
        if (faultyValidatorsCount < threshold) {
            return;
        }

        isEarlyEpochEnd[epoch] = true;
        blockRewardContract.notifyEarlyEpochEnd();

        emit NotifyEarlyEpochEnd(epoch, block.number);
    }

    function _markValidatorFaulty(uint256 epoch, address validator) private {
        if (_disconnectTimestamp[epoch][validator] != 0) {
            // validator already marked as faulty
            return;
        }

        _disconnectTimestamp[epoch][validator] = block.timestamp;

        validatorSetContract.notifyUnavailability(validator);
    }

    function _getReportersThreshold(uint256 epoch) private view returns (uint256) {
        uint256 unflaggedValidatorsCount = validatorSetContract.getCurrentValidatorsCount() -
            getFlaggedValidatorsCount(epoch);

        return (2 * unflaggedValidatorsCount) / 3 + 1;
    }

    function _countFaultyValidators(uint256 epoch) private view returns (uint256) {
        uint256 reportersThreshold = _getReportersThreshold(epoch);
        uint256 result = 0;

        address[] memory flaggedValidators = getFlaggedValidatorsByEpoch(epoch);

        for (uint256 i = 0; i < flaggedValidators.length; ++i) {
            address validator = flaggedValidators[i];

            if (getValidatorConnectivityScore(epoch, validator) >= reportersThreshold) {
                ++result;
            }
        }

        return result;
    }

    function _validateParams(uint256 epoch, address caller, uint256 blockNumber, bytes32 blockHash) private view {
        if (!validatorSetContract.isValidator(caller)) {
            revert OnlyValidator();
        }

        if (blockNumber > block.number || blockhash(blockNumber) != blockHash) {
            revert InvalidBlock();
        }

        if (_flaggedValidators[epoch].contains(caller)) {
            revert CannotReportByFlaggedValidator(caller);
        }

        uint256 epochStartTimestamp = stakingContract.stakingEpochStartTime();
        if (block.timestamp < epochStartTimestamp + reportDisallowPeriod) {
            revert ReportTooEarly();
        }
    }
}
