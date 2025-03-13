// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IKeyGenHistory } from "./interfaces/IKeyGenHistory.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";
import { Unauthorized, ValidatorsListEmpty, ZeroAddress } from "./lib/Errors.sol";

contract KeyGenHistory is Initializable, OwnableUpgradeable, IKeyGenHistory {
    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables and do not change their types!
    address[] public validatorSet;

    mapping(address => bytes) public parts;
    mapping(address => bytes[]) public acks;

    /// @dev number of parts written in this key generation round.
    uint128 public numberOfPartsWritten;

    /// @dev number of full ack sets written in this key generation round.
    uint128 public numberOfAcksWritten;

    /// @dev The address of the `ValidatorSetHbbft` contract.
    IValidatorSetHbbft public validatorSetContract;

    /// @dev round counter for key generation rounds.
    /// in an ideal world, every key generation only requires one try,
    /// and all validators manage to write their acks and parts,
    /// so it is possible to achieve this goal in round 0.
    /// in the real world, there are failures,
    /// this mechanics helps covering that,
    /// by revoking transactions, that were targeted for an earlier key gen round.
    /// more infos: https://github.com/DMDcoin/hbbft-posdao-contracts/issues/106
    uint256 public currentKeyGenRound;

    error AcksAlreadySubmitted();
    error IncorrectEpoch();
    error IncorrectRound(uint256 expected, uint256 submited);
    error NotPendingValidator(address validator);
    error PartsAlreadySubmitted();
    error WrongEpoch();
    error WrongAcksNumber();
    error WrongPartsNumber();

    /// @dev Ensures the caller is ValidatorSet contract.
    modifier onlyValidatorSet() {
        if (msg.sender != address(validatorSetContract)) {
            revert Unauthorized();
        }
        _;
    }

    /// @dev ensures that Key Generation functions are called with wrong _epoch
    /// parameter to prevent old and wrong transactions get picked up.
    modifier onlyUpcomingEpoch(uint256 _epoch) {
        if (IStakingHbbft(validatorSetContract.getStakingContract()).stakingEpoch() + 1 != _epoch) {
            revert IncorrectEpoch();
        }
        _;
    }

    /// @dev ensures that Key Generation functions are called with wrong _epoch
    /// parameter to prevent old and wrong transactions get picked up.
    modifier onlyCorrectRound(uint256 _roundCounter) {
        if (currentKeyGenRound != _roundCounter) {
            revert IncorrectRound(currentKeyGenRound, _roundCounter);
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
        address[] memory _validators,
        bytes[] memory _parts,
        bytes[][] memory _acks
    ) external initializer {
        if (_contractOwner == address(0) || _validatorSetContract == address(0)) {
            revert ZeroAddress();
        }

        if (_validators.length == 0) {
            revert ValidatorsListEmpty();
        }

        if (_validators.length != _parts.length) {
            revert WrongPartsNumber();
        }

        if (_validators.length != _acks.length) {
            revert WrongAcksNumber();
        }

        __Ownable_init(_contractOwner);

        validatorSetContract = IValidatorSetHbbft(_validatorSetContract);

        for (uint256 i = 0; i < _validators.length; i++) {
            parts[_validators[i]] = _parts[i];
            acks[_validators[i]] = _acks[i];
        }

        currentKeyGenRound = 1;
        numberOfPartsWritten = uint128(_validators.length);
        numberOfAcksWritten = uint128(_validators.length);
    }

    /// @dev Clears the state (acks and parts of previous validators.
    /// @param _prevValidators The list of previous validators.
    function clearPrevKeyGenState(address[] calldata _prevValidators) external onlyValidatorSet {
        for (uint256 i = 0; i < _prevValidators.length; ++i) {
            delete parts[_prevValidators[i]];
            delete acks[_prevValidators[i]];
        }

        numberOfPartsWritten = 0;
        numberOfAcksWritten = 0;
    }

    function notifyKeyGenFailed() external onlyValidatorSet {
        currentKeyGenRound = currentKeyGenRound + 1;
    }

    function notifyNewEpoch() external onlyValidatorSet {
        currentKeyGenRound = 1;
    }

    function writePart(
        uint256 _upcomingEpoch,
        uint256 _roundCounter,
        bytes memory _part
    ) external onlyUpcomingEpoch(_upcomingEpoch) onlyCorrectRound(_roundCounter) {
        // It can only be called by a new validator which is elected but not yet finalized...
        // ...or by a validator which is already in the validator set.
        if (!validatorSetContract.isPendingValidator(msg.sender)) {
            revert NotPendingValidator(msg.sender);
        }

        if (parts[msg.sender].length != 0) {
            revert PartsAlreadySubmitted();
        }

        parts[msg.sender] = _part;
        numberOfPartsWritten++;
    }

    function writeAcks(
        uint256 _upcomingEpoch,
        uint256 _roundCounter,
        bytes[] memory _acks
    ) external onlyUpcomingEpoch(_upcomingEpoch) onlyCorrectRound(_roundCounter) {
        // It can only be called by a new validator which is elected but not yet finalized...
        // ...or by a validator which is already in the validator set.
        if (!validatorSetContract.isPendingValidator(msg.sender)) {
            revert NotPendingValidator(msg.sender);
        }

        if (acks[msg.sender].length != 0) {
            revert AcksAlreadySubmitted();
        }

        acks[msg.sender] = _acks;
        numberOfAcksWritten++;
    }

    function getPart(address _val) external view returns (bytes memory) {
        return parts[_val];
    }

    function getAcksLength(address val) external view returns (uint256) {
        return acks[val].length;
    }

    function getCurrentKeyGenRound() external view returns (uint256) {
        return currentKeyGenRound;
    }

    function getNumberOfKeyFragmentsWritten() external view returns (uint128, uint128) {
        return (numberOfPartsWritten, numberOfAcksWritten);
    }
}
