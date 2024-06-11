// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IConnectivityTrackerHbbft } from "./interfaces/IConnectivityTrackerHbbft.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";
import { IBlockRewardHbbft } from "./interfaces/IBlockRewardHbbft.sol";

contract ConnectivityTrackerHbbft is Initializable, OwnableUpgradeable, IConnectivityTrackerHbbft {
    using EnumerableSet for EnumerableSet.AddressSet;

    IValidatorSetHbbft public validatorSetContract;
    IStakingHbbft public stakingContract;
    IBlockRewardHbbft public blockRewardContract;

    uint256 public minReportAgeBlocks;
    uint256 public earlyEpochEndToleranceLevel;

    mapping(uint256 => bool) public isEarlyEpochEnd;

    mapping(uint256 => EnumerableSet.AddressSet) private _flaggedValidators;
    mapping(uint256 => mapping(address => EnumerableSet.AddressSet)) private _reporters;

    event SetMinReportAgeBlocks(uint256 _minReportAge);
    event SetEarlyEpochEndToleranceLevel(uint256 _level);
    event ReportMissingConnectivity(address indexed reporter, address indexed validator, uint256 indexed blockNumber);

    event ReportReconnect(address indexed reporter, address indexed validator, uint256 indexed blockNumber);
    event NotifyEarlyEpochEnd(uint256 indexed epoch, uint256 indexed blockNumber);

    error AlreadyReported(address reporter, address validator);
    error CannotReportByFlaggedValidator(address reporter);
    error InvalidAddress();
    error InvalidBlock();
    error OnlyValidator();
    error ReportTooEarly();
    error UnknownReconnectReporter(address reporter, address validator);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    function initialize(
        address _contractOwner,
        address _validatorSetContract,
        address _stakingContract,
        address _blockRewardContract,
        uint256 _minReportAgeBlocks
    ) external initializer {
        if (
            _contractOwner == address(0) ||
            _validatorSetContract == address(0) ||
            _stakingContract == address(0) ||
            _blockRewardContract == address(0)
        ) {
            revert InvalidAddress();
        }

        __Ownable_init(_contractOwner);

        validatorSetContract = IValidatorSetHbbft(_validatorSetContract);
        stakingContract = IStakingHbbft(_stakingContract);
        blockRewardContract = IBlockRewardHbbft(_blockRewardContract);

        minReportAgeBlocks = _minReportAgeBlocks;
        earlyEpochEndToleranceLevel = 2;
    }

    function setMinReportAge(uint256 _minReportAge) external onlyOwner {
        minReportAgeBlocks = _minReportAge;

        emit SetMinReportAgeBlocks(_minReportAge);
    }

    function setEarlyEpochEndToleranceLevel(uint256 _level) external onlyOwner {
        earlyEpochEndToleranceLevel = _level;

        _decideEarlyEpochEndNeeded(currentEpoch());

        emit SetEarlyEpochEndToleranceLevel(_level);
    }

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

        _decideEarlyEpochEndNeeded(epoch);

        emit ReportMissingConnectivity(msg.sender, validator, blockNumber);
    }

    function reportReconnect(address validator, uint256 blockNumber, bytes32 blockHash) external {
        checkReportReconnectCallable(msg.sender, validator, blockNumber, blockHash);

        uint256 epoch = currentEpoch();
        uint256 currentScore = getValidatorConnectivityScore(epoch, validator);

        if (currentScore != 0) {
            // slither-disable-next-line unused-return
            _reporters[epoch][validator].remove(msg.sender);

            if (currentScore == 1) {
                // slither-disable-next-line unused-return
                _flaggedValidators[epoch].remove(validator);
            }
        }

        _decideEarlyEpochEndNeeded(epoch);

        emit ReportReconnect(msg.sender, validator, blockNumber);
    }

    function getValidatorConnectivityScore(uint256 epoch, address validator) public view returns (uint256) {
        return _reporters[epoch][validator].length();
    }

    /// @dev Returns true if the specified validator was reported by the specified reporter at the given epoch.
    function isReported(uint256, address validator, address reporter) external view returns (bool) {
        return _reporters[currentEpoch()][validator].contains(reporter);
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

    function getFlaggedValidators() public view returns (address[] memory) {
        return _flaggedValidators[currentEpoch()].values();
    }

    function currentEpoch() public view returns (uint256) {
        return IStakingHbbft(stakingContract).stakingEpoch();
    }

    function earlyEpochEndThreshold() public view returns (uint256) {
        uint256 networkSize = IValidatorSetHbbft(validatorSetContract).getCurrentValidatorsCount();
        uint256 hbbftFaultTolerance = networkSize / 3;

        if (hbbftFaultTolerance <= earlyEpochEndToleranceLevel) {
            return 0;
        } else {
            return hbbftFaultTolerance - earlyEpochEndToleranceLevel;
        }
    }

    function countFaultyValidators(uint256 epoch) public view returns (uint256) {
        return _countFaultyValidators(epoch);
    }

    function _countFaultyValidators(uint256 epoch) private view returns (uint256) {
        address[] memory flaggedValidators = getFlaggedValidators();

        uint256 unflaggedValidatorsCount = validatorSetContract.getCurrentValidatorsCount() - flaggedValidators.length; // 16 - 4 = 12

        uint256 reportersThreshold = (2 * unflaggedValidatorsCount) / 3 + 1; // 24 / 3  + 1 = 9
        uint256 result = 0;

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

        uint256 epochStartBlock = stakingContract.stakingEpochStartBlock();
        if (block.number < epochStartBlock + minReportAgeBlocks) {
            revert ReportTooEarly();
        }
    }

    function _decideEarlyEpochEndNeeded(uint256 epoch) private {
        uint256 threshold = earlyEpochEndThreshold();
        uint256 faultyValidatorsCount = _countFaultyValidators(epoch);

        if (faultyValidatorsCount < threshold) {
            return;
        }

        isEarlyEpochEnd[epoch] = true;
        blockRewardContract.notifyEarlyEpochEnd();

        emit NotifyEarlyEpochEnd(epoch, block.number);
    }
}
