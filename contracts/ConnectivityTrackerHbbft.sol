// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.17;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {EnumerableSetUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

import {IConnectivityTrackerHbbft} from "./interfaces/IConnectivityTrackerHbbft.sol";
import {IValidatorSetHbbft} from "./interfaces/IValidatorSetHbbft.sol";
import {IStakingHbbft} from "./interfaces/IStakingHbbft.sol";
import {IBlockRewardHbbft} from "./interfaces/IBlockRewardHbbft.sol";

contract ConnectivityTrackerHbbft is
    Initializable,
    OwnableUpgradeable,
    IConnectivityTrackerHbbft
{
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.AddressSet;

    IValidatorSetHbbft public validatorSetContract;
    IStakingHbbft public stakingContract;
    IBlockRewardHbbft public blockRewardContract;

    uint256 public minReportAgeBlocks;
    uint256 public earlyEpochEndToleranceLevel;

    mapping(uint256 => bool) public isEarlyEpochEnd;
    mapping(uint256 => mapping(address => uint256)) public validatorConnectivityScore;

    mapping(uint256 => EnumerableSetUpgradeable.AddressSet) private _flaggedValidators;
    mapping(uint256 => mapping(address => EnumerableSetUpgradeable.AddressSet)) private _reporters;

    event SetMinReportAgeBlocks(uint256 _minReportAge);
    event SetEarlyEpochEndToleranceLevel(uint256 _level);
    event ReportMissingConnectivity(
        address indexed reporter,
        address indexed validator,
        uint256 indexed blockNumber
    );

    event ReportReconnect(
        address indexed reporter,
        address indexed validator,
        uint256 indexed blockNumber
    );

    error AlreadyReported(address reporter, address validator);
    error CannotReportByFlaggedValidator(address reporter);
    error InvalidAddress();
    error InvalidBlock();
    error OnlyValidator();
    error ReportTooEarly();
    error UnknownReconnectReporter(address reporter, address validator);

    modifier onlyValidator() {
        if (!validatorSetContract.isValidator(msg.sender)) {
            revert OnlyValidator();
        }
        _;
    }

    modifier onlyValidBlock(uint256 blockNumber, bytes32 blockHash) {
        if (blockNumber > block.number || blockhash(blockNumber) != blockHash) {
            revert InvalidBlock();
        }

        uint256 epochStartBlock = stakingContract.stakingEpochStartBlock();
        if (block.number < epochStartBlock + minReportAgeBlocks) {
            revert ReportTooEarly();
        }
        _;
    }

    modifier nonFlagged() {
        uint256 epoch = currentEpoch();

        if (_flaggedValidators[epoch].contains(msg.sender)) {
            revert CannotReportByFlaggedValidator(msg.sender);
        }
        _;
    }

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

        __Ownable_init();
        _transferOwnership(_contractOwner);

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

    function reportMissingConnectivity(
        address validator,
        uint256 blockNumber,
        bytes32 blockHash
    ) external onlyValidator nonFlagged onlyValidBlock(blockNumber, blockHash) {
        uint256 epoch = currentEpoch();

        if (_reporters[epoch][validator].contains(msg.sender)) {
            revert AlreadyReported(msg.sender, validator);
        }

        uint256 currentScore = validatorConnectivityScore[epoch][validator];
        if (currentScore == 0) {
            // slither-disable-next-line unused-return
            _flaggedValidators[epoch].add(validator);
        }

        validatorConnectivityScore[epoch][validator] = currentScore + 1;

        // slither-disable-next-line unused-return
        _reporters[epoch][validator].add(msg.sender);

        _decideEarlyEpochEndNeeded(epoch);

        emit ReportMissingConnectivity(msg.sender, validator, blockNumber);
    }

    function reportReconnect(
        address validator,
        uint256 blockNumber,
        bytes32 blockHash
    ) external onlyValidator nonFlagged onlyValidBlock(blockNumber, blockHash) {
        uint256 epoch = currentEpoch();

        // Only "missing connectivity" reporter can also report reconnect
        if (!_reporters[epoch][validator].contains(msg.sender)) {
            revert UnknownReconnectReporter(msg.sender, validator);
        }

        uint256 currentScore = validatorConnectivityScore[epoch][validator];
        if (currentScore != 0) {
            validatorConnectivityScore[epoch][validator] = currentScore - 1;

            if (validatorConnectivityScore[epoch][validator] == 0) {
                // slither-disable-next-line unused-return
                _flaggedValidators[epoch].remove(validator);
            }

            // slither-disable-next-line unused-return
            _reporters[epoch][validator].remove(msg.sender);
        }

        _decideEarlyEpochEndNeeded(epoch);

        emit ReportReconnect(msg.sender, validator, blockNumber);
    }

    function getCurrentConnectionStatus(
        address validator
    ) external view returns (bool) {
        return
            validatorConnectivityScore[currentEpoch()][validator] <
            earlyEpochEndThreshold();
    }

    function getFlaggedValidators() public view returns (address[] memory) {
        return _flaggedValidators[currentEpoch()].values();
    }

    function currentEpoch() public view returns (uint256) {
        return IStakingHbbft(stakingContract).stakingEpoch();
    }

    function earlyEpochEndThreshold() public view returns (uint256) {
        uint256 networkSize = IValidatorSetHbbft(validatorSetContract)
            .getCurrentValidatorsCount();
        uint256 hbbftFaultTolerance = networkSize / 3;

        if (hbbftFaultTolerance <= earlyEpochEndToleranceLevel) {
            return 0;
        } else {
            return hbbftFaultTolerance - earlyEpochEndToleranceLevel;
        }
    }

    function _countFaultyValidators(
        uint256 epoch
    ) private view returns (uint256) {
        address[] memory flaggedValidators = getFlaggedValidators();

        uint256 unflaggedValidatorsCount = validatorSetContract
            .getCurrentValidatorsCount() - flaggedValidators.length;

        uint256 reportersThreshold = (unflaggedValidatorsCount * 2) / 3 + 1;
        uint256 result = 0;

        for (uint256 i = 0; i < flaggedValidators.length; ++i) {
            address validator = flaggedValidators[i];

            if (validatorConnectivityScore[epoch][validator] >= reportersThreshold) {
                ++result;
            }
        }

        return result;
    }

    function _decideEarlyEpochEndNeeded(uint256 epoch) private {
        uint256 threshold = earlyEpochEndThreshold();
        uint256 faultyValidatorsCount = _countFaultyValidators(epoch);

        if (faultyValidatorsCount < threshold) {
            return;
        }

        isEarlyEpochEnd[epoch] = true;
        blockRewardContract.notifyEarlyEpochEnd();
    }
}
