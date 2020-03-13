pragma solidity ^0.5.16;

import "./interfaces/IBlockRewardHbbft.sol";
import "./interfaces/IKeyGenHistory.sol";
import "./interfaces/IRandomHbbft.sol";
import "./interfaces/IStakingHbbft.sol";
import "./interfaces/IValidatorSetHbbft.sol";
import "./upgradeability/UpgradeabilityAdmin.sol";
import "./libs/SafeMath.sol";


/// @dev Stores the current validator set and contains the logic for choosing new validators
/// before each staking epoch. The logic uses a random seed generated and stored by the `RandomHbbft` contract.
contract ValidatorSetHbbft is UpgradeabilityAdmin, IValidatorSetHbbft {
    using SafeMath for uint256;

    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables and do not change their types!

    address[] internal _currentValidators;
    address[] internal _pendingValidators;
    address[] internal _previousValidators;

    bool internal _forNewEpoch;

    mapping(address => mapping(uint256 => address[])) internal _maliceReportedForBlock;

    /// @dev How many times a given mining address was banned.
    mapping(address => uint256) public banCounter;

    /// @dev Returns the block number when the ban will be lifted for the specified mining address.
    mapping(address => uint256) public bannedUntil;

    /// @dev Returns the block number when the ban will be lifted for delegators
    /// of the specified pool (mining address).
    mapping(address => uint256) public bannedDelegatorsUntil;

    /// @dev The reason for the latest ban of the specified mining address. See the `_removeMaliciousValidator`
    /// internal function description for the list of possible reasons.
    mapping(address => bytes32) public banReason;

    /// @dev The address of the `BlockRewardHbbft` contract.
    address public blockRewardContract;

    /// @dev The serial number of a validator set change request. The counter is incremented
    /// every time a validator set needs to be changed.
    uint256 public changeRequestCount;

    /// @dev A boolean flag indicating whether the specified mining address is in the current validator set.
    /// See the `getValidators` getter.
    mapping(address => bool) public isValidator;

    /// @dev A boolean flag indicating whether the specified mining address was a validator in the previous set.
    /// See the `getPreviousValidators` getter.
    mapping(address => bool) public isValidatorPrevious;

    /// @dev A mining address bound to a specified staking address.
    /// See the `_setStakingAddress` internal function.
    mapping(address => address) public miningByStakingAddress;

    /// @dev The `RandomHbbft` contract address.
    address public randomContract;

    /// @dev The number of times the specified validator (mining address) reported misbehaviors during the specified
    /// staking epoch. Used by the `reportMaliciousCallable` getter and `reportMalicious` function to determine
    /// whether a validator reported too often.
    mapping(address => mapping(uint256 => uint256)) public reportingCounter;

    /// @dev How many times all validators reported misbehaviors during the specified staking epoch.
    /// Used by the `reportMaliciousCallable` getter and `reportMalicious` function to determine
    /// whether a validator reported too often.
    mapping(uint256 => uint256) public reportingCounterTotal;

    /// @dev A staking address bound to a specified mining address.
    /// See the `_setStakingAddress` internal function.
    mapping(address => address) public stakingByMiningAddress;

    /// @dev The `StakingHbbft` contract address.
    IStakingHbbft public stakingContract;

    /// @dev The `KeyGenHistory` contract address.
    IKeyGenHistory public keyGenHistoryContract;

    /// @dev The staking address of the non-removable validator.
    /// Returns zero if a non-removable validator is not defined.
    address public unremovableValidator;

    /// @dev How many times the given mining address has become a validator.
    mapping(address => uint256) public validatorCounter;

    /// @dev The block number when the `finalizeChange` function was called to apply
    /// the current validator set formed by the `newValidatorSet` function. If it is zero,
    /// it means the `newValidatorSet` function has already been called (a new staking epoch has been started),
    /// but the new staking epoch's validator set hasn't yet been finalized by the `finalizeChange` function.
    uint256 public validatorSetApplyBlock;

    // ============================================== Constants =======================================================

    /// @dev The max number of validators.
    uint256 public constant MAX_VALIDATORS = 19;

    // ================================================ Events ========================================================

    /// @dev Emitted by the `reportMalicious` function to signal that a specified validator reported
    /// misbehavior by a specified malicious validator at a specified block number.
    /// @param reportingValidator The mining address of the reporting validator.
    /// @param maliciousValidator The mining address of the malicious validator.
    /// @param blockNumber The block number at which the `maliciousValidator` misbehaved.
    event ReportedMalicious(address reportingValidator, address maliciousValidator, uint256 blockNumber);

    // ============================================== Modifiers =======================================================

    /// @dev Ensures the `initialize` function was called before.
    modifier onlyInitialized {
        require(isInitialized());
        _;
    }

    /// @dev Ensures the caller is the BlockRewardHbbft contract address.
    modifier onlyBlockRewardContract() {
        require(msg.sender == blockRewardContract);
        _;
    }

    /// @dev Ensures the caller is the RandomHbbft contract address.
    modifier onlyRandomContract() {
        require(msg.sender == randomContract);
        _;
    }

    /// @dev Ensures the caller is the StakingHbbft contract address.
    modifier onlyStakingContract() {
        require(msg.sender == address(stakingContract));
        _;
    }

    /// @dev Ensures the caller is the SYSTEM_ADDRESS. See https://wiki.parity.io/Validator-Set.html
    modifier onlySystem() {
        require(msg.sender == 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE);
        _;
    }

    // =============================================== Setters ========================================================

    /// @dev Makes the non-removable validator removable. Can only be called by the staking address of the
    /// non-removable validator or by the `owner`.
    function clearUnremovableValidator() external onlyInitialized {
        address unremovableStakingAddress = unremovableValidator;
        require(msg.sender == unremovableStakingAddress || msg.sender == _admin());
        unremovableValidator = address(0);
        stakingContract.clearUnremovableValidator(unremovableStakingAddress);
    }

    /// @dev Called by the system when a pending validator set is ready to be activated.
    /// This function is called at the beginning of a block (before all the block transactions).
    /// Only valid when msg.sender == SUPER_USER (EIP96, 2**160 - 2).
    /// After this function is called, the `getValidators` getter returns the new validator set.
    /// If this function finalizes a new validator set formed by the `newValidatorSet` function,
    /// an old validator set is also stored and can be read by the `getPreviousValidators` getter.
    function finalizeChange() external onlySystem {
        if (_forNewEpoch) {
            // Apply a new validator set formed by the `newValidatorSet` function
            _savePreviousValidators();
            _finalizeNewValidators(true);
            IBlockRewardHbbft(blockRewardContract).clearBlocksCreated();
            validatorSetApplyBlock = _getCurrentBlockNumber();
        } else if (_pendingValidators.length != 0) {
            // Apply the changed validator set after malicious validator is removed
            _finalizeNewValidators(false);
        } else {
            // This is the very first call of the `finalizeChange` (block #1 when starting from genesis)
            validatorSetApplyBlock = _getCurrentBlockNumber();
        }
        delete _pendingValidators;
        _forNewEpoch = false;
    }

    /// @dev Initializes the network parameters. Used by the
    /// constructor of the `InitializerHbbft` contract.
    /// @param _blockRewardContract The address of the `BlockRewardHbbft` contract.
    /// @param _randomContract The address of the `RandomHbbft` contract.
    /// @param _stakingContract The address of the `StakingHbbft` contract.
    /// @param _initialMiningAddresses The array of initial validators' mining addresses.
    /// @param _initialStakingAddresses The array of initial validators' staking addresses.
    /// @param _firstValidatorIsUnremovable The boolean flag defining whether the first validator in the
    /// `_initialMiningAddresses/_initialStakingAddresses` array is non-removable.
    /// Should be `false` for a production network.
    function initialize(
        address _blockRewardContract,
        address _randomContract,
        address _stakingContract,
        address _keyGenHistoryContract,
        address[] calldata _initialMiningAddresses,
        address[] calldata _initialStakingAddresses,
        bool _firstValidatorIsUnremovable
    ) external {
        require(_getCurrentBlockNumber() == 0 || msg.sender == _admin());
        require(!isInitialized()); // initialization can only be done once
        require(_blockRewardContract != address(0));
        require(_randomContract != address(0));
        require(_stakingContract != address(0));
        require(_keyGenHistoryContract != address(0));
        require(_initialMiningAddresses.length > 0);
        require(_initialMiningAddresses.length == _initialStakingAddresses.length);

        blockRewardContract = _blockRewardContract;
        randomContract = _randomContract;
        stakingContract = IStakingHbbft(_stakingContract);
        keyGenHistoryContract = IKeyGenHistory(_keyGenHistoryContract);

        // Add initial validators to the `_currentValidators` array
        for (uint256 i = 0; i < _initialMiningAddresses.length; i++) {
            address miningAddress = _initialMiningAddresses[i];
            _currentValidators.push(miningAddress);
            /* _pendingValidators.push(miningAddress); */
            isValidator[miningAddress] = true;
            validatorCounter[miningAddress]++;
            _setStakingAddress(miningAddress, _initialStakingAddresses[i]);
        }

        if (_firstValidatorIsUnremovable) {
            unremovableValidator = _initialStakingAddresses[0];
        }
    }

    /// @dev Implements the logic which forms a new validator set. If the number of active pools
    /// is greater than MAX_VALIDATORS, the logic chooses the validators randomly using a random seed generated and
    /// stored by the `RandomHbbft` contract.
    /// Automatically called by the `BlockRewardHbbft.reward` function at the latest block of the staking epoch.
    function newValidatorSet() external onlyBlockRewardContract {
        address[] memory poolsToBeElected = stakingContract.getPoolsToBeElected();
        require(poolsToBeElected.length != 0, "No active pools!");

        // Choose new validators
        if (
            poolsToBeElected.length >= MAX_VALIDATORS &&
            (poolsToBeElected.length != MAX_VALIDATORS || unremovableValidator != address(0))
        ) {
            uint256 randomNumber = IRandomHbbft(randomContract).currentSeed();

            (uint256[] memory likelihood, uint256 likelihoodSum) = stakingContract.getPoolsLikelihood();

            if (likelihood.length > 0 && likelihoodSum > 0) {
                address[] memory newValidators = new address[](
                    unremovableValidator == address(0) ? MAX_VALIDATORS : MAX_VALIDATORS - 1
                );

                uint256 poolsToBeElectedLength = poolsToBeElected.length;
                for (uint256 i = 0; i < newValidators.length; i++) {
                    randomNumber = uint256(keccak256(abi.encode(randomNumber)));
                    uint256 randomPoolIndex = _getRandomIndex(likelihood, likelihoodSum, randomNumber);
                    newValidators[i] = poolsToBeElected[randomPoolIndex];
                    likelihoodSum -= likelihood[randomPoolIndex];
                    poolsToBeElectedLength--;
                    poolsToBeElected[randomPoolIndex] = poolsToBeElected[poolsToBeElectedLength];
                    likelihood[randomPoolIndex] = likelihood[poolsToBeElectedLength];
                }

                _setPendingValidators(newValidators);
            }
        } else {
            _setPendingValidators(poolsToBeElected);
        }

        // clear previousValidator KetGenHistory state
        keyGenHistoryContract.clearPrevKeyGenState(_currentValidators);

        // From this moment the `getPendingValidators()` returns the new validator set.
         /* _setPendingValidatorsChanged(true);  //TO DO: decide how to handle it */

        if (poolsToBeElected.length != 0) {
            // Remove pools marked as `to be removed`
            stakingContract.removePools();
        }
    }

    /// @dev Removes malicious validators. Called by the `RandomHbbft.onFinishCollectRound` function.
    /// @param _miningAddresses The mining addresses of the malicious validators.
    function removeMaliciousValidators(address[] calldata _miningAddresses) external onlyRandomContract {
        _removeMaliciousValidators(_miningAddresses, "unrevealed");
    }

    /// @dev Reports that the malicious validator misbehaved at the specified block.
    /// Called by the node of each honest validator after the specified validator misbehaved.
    /// See https://wiki.parity.io/Validator-Set.html#reporting-contract
    /// Can only be called when the `reportMaliciousCallable` getter returns `true`.
    /// @param _maliciousMiningAddress The mining address of the malicious validator.
    /// @param _blockNumber The block number where the misbehavior was observed.
    function reportMalicious(
        address _maliciousMiningAddress,
        uint256 _blockNumber,
        bytes calldata
    ) external onlyInitialized {
        address reportingMiningAddress = msg.sender;

        _incrementReportingCounter(reportingMiningAddress);

        (
            bool callable,
            bool removeReportingValidator
        ) = reportMaliciousCallable(
            reportingMiningAddress,
            _maliciousMiningAddress,
            _blockNumber
        );

        if (!callable) {
            if (removeReportingValidator) {
                // Reporting validator reported too often, so
                // treat them as a malicious as well
                address[] memory miningAddresses = new address[](1);
                miningAddresses[0] = reportingMiningAddress;
                _removeMaliciousValidators(miningAddresses, "spam");
            }
            return;
        }

        address[] storage reportedValidators = _maliceReportedForBlock[_maliciousMiningAddress][_blockNumber];

        reportedValidators.push(reportingMiningAddress);

        emit ReportedMalicious(reportingMiningAddress, _maliciousMiningAddress, _blockNumber);

        uint256 validatorsLength = _currentValidators.length;
        bool remove;

        if (validatorsLength > 3) {
            // If more than 2/3 of validators reported about malicious validator
            // for the same `blockNumber`
            remove = reportedValidators.length.mul(3) > validatorsLength.mul(2);
        } else {
            // If more than 1/2 of validators reported about malicious validator
            // for the same `blockNumber`
            remove = reportedValidators.length.mul(2) > validatorsLength;
        }

        if (remove) {
            address[] memory miningAddresses = new address[](1);
            miningAddresses[0] = _maliciousMiningAddress;
            _removeMaliciousValidators(miningAddresses, "malicious");
        }
    }

    /// @dev Binds a mining address to the specified staking address. Called by the `StakingHbbft.addPool` function
    /// when a user wants to become a candidate and creates a pool.
    /// See also the `miningByStakingAddress` and `stakingByMiningAddress` public mappings.
    /// @param _miningAddress The mining address of the newly created pool. Cannot be equal to the `_stakingAddress`
    /// and should never be used as a pool before.
    /// @param _stakingAddress The staking address of the newly created pool. Cannot be equal to the `_miningAddress`
    /// and should never be used as a pool before.
    function setStakingAddress(address _miningAddress, address _stakingAddress) external onlyStakingContract {
        _setStakingAddress(_miningAddress, _stakingAddress);
    }

    // =============================================== Getters ========================================================

    /// @dev Returns a boolean flag indicating whether delegators of the specified pool are currently banned.
    /// A validator pool can be banned when they misbehave (see the `_removeMaliciousValidator` function).
    /// @param _miningAddress The mining address of the pool.
    function areDelegatorsBanned(address _miningAddress) public view returns(bool) {
        return _getCurrentBlockNumber() <= bannedDelegatorsUntil[_miningAddress];
    }

    /// @dev Returns a boolean flag indicating the change is due to a new staking epoch
    function isForNewEpoch() public view returns(bool) {
        return _forNewEpoch;
    }

    /// @dev Returns the previous validator set (validators' mining addresses array).
    /// The array is stored by the `finalizeChange` function
    /// when a new staking epoch's validator set is finalized.
    function getPreviousValidators() public view returns(address[] memory) {
        return _previousValidators;
    }

    /// @dev Returns the current array of pending validators i.e. waiting to be activated in the new epoch
    /// The pending array is changed when a validator is removed as malicious
    /// or the validator set is updated by the `newValidatorSet` function.
    function getPendingValidators() public view returns(address[] memory) {
        return _pendingValidators;
    }

    /// @dev Returns the current validator set (an array of mining addresses)
    /// which always matches the validator set kept in validator's node.
    function getValidators() public view returns(address[] memory) {
        return _currentValidators;
    }

    /// @dev Returns a boolean flag indicating if the `initialize` function has been called.
    function isInitialized() public view returns(bool) {
        return blockRewardContract != address(0);
    }

    /// @dev Returns a boolean flag indicating whether the specified validator (mining address)
    /// is able to call the `reportMalicious` function or whether the specified validator (mining address)
    /// can be reported as malicious. This function also allows a validator to call the `reportMalicious`
    /// function several blocks after ceasing to be a validator. This is possible if a
    /// validator did not have the opportunity to call the `reportMalicious` function prior to the
    /// engine calling the `finalizeChange` function.
    /// @param _miningAddress The validator's mining address.
    function isReportValidatorValid(address _miningAddress) public view returns(bool) {
        bool isValid = isValidator[_miningAddress] && !isValidatorBanned(_miningAddress);
        if (stakingContract.stakingEpoch() == 0 || validatorSetApplyBlock == 0) {
            return isValid;
        }
        if (_getCurrentBlockNumber() - validatorSetApplyBlock <= MAX_VALIDATORS) {
            // The current validator set was finalized by the engine,
            // but we should let the previous validators finish
            // reporting malicious validator within a few blocks
            bool previousValidator = isValidatorPrevious[_miningAddress] && !isValidatorBanned(_miningAddress);
            return isValid || previousValidator;
        }
        return isValid;
    }

    /// @dev Returns a boolean flag indicating whether the specified mining address is currently banned.
    /// A validator can be banned when they misbehave (see the `_removeMaliciousValidator` internal function).
    /// @param _miningAddress The mining address.
    function isValidatorBanned(address _miningAddress) public view returns(bool) {
        return _getCurrentBlockNumber() <= bannedUntil[_miningAddress];
    }

    /// @dev Returns a boolean flag indicating whether the specified mining address is a validator
    /// or is in the `_pendingValidators`.
    /// Used by the `StakingHbbft.maxWithdrawAllowed` and `StakingHbbft.maxWithdrawOrderAllowed` getters.
    /// @param _miningAddress The mining address.
    function isValidatorOrPending(address _miningAddress) public view returns(bool) {
        if (isValidator[_miningAddress]) {
            return true;
        }

        return isPending(_miningAddress);
    }

    /// @dev Returns a boolean flag indicating whether the specified mining address is a pending validator.
    /// Used by the `isValidatorOrPending` and `KeyGenHistory.writeAck/Part` functions.
    /// @param _miningAddress The mining address.
    function isPending(address _miningAddress) public view returns(bool) {

        uint256 i;
        uint256 length;

        for (i = 0; i < _pendingValidators.length; i++) {
            if (_miningAddress == _pendingValidators[i]) {
                return true;
            }
        }

        return false;
    }

    /// @dev Returns an array of the validators (their mining addresses) which reported that the specified malicious
    /// validator misbehaved at the specified block.
    /// @param _miningAddress The mining address of malicious validator.
    /// @param _blockNumber The block number.
    function maliceReportedForBlock(address _miningAddress, uint256 _blockNumber) public view returns(address[] memory) {
        return _maliceReportedForBlock[_miningAddress][_blockNumber];
    }

    /// @dev Returns whether the `reportMalicious` function can be called by the specified validator with the
    /// given parameters. Used by the `reportMalicious` function and `TxPermission` contract. Also, returns
    /// a boolean flag indicating whether the reporting validator should be removed as malicious due to
    /// excessive reporting during the current staking epoch.
    /// @param _reportingMiningAddress The mining address of the reporting validator which is calling
    /// the `reportMalicious` function.
    /// @param _maliciousMiningAddress The mining address of the malicious validator which is passed to
    /// the `reportMalicious` function.
    /// @param _blockNumber The block number which is passed to the `reportMalicious` function.
    /// @return `bool callable` - The boolean flag indicating whether the `reportMalicious` function can be called at
    /// the moment. `bool removeReportingValidator` - The boolean flag indicating whether the reporting validator
    /// should be removed as malicious due to excessive reporting. This flag is only used by the `reportMalicious`
    /// function.
    function reportMaliciousCallable(
        address _reportingMiningAddress,
        address _maliciousMiningAddress,
        uint256 _blockNumber
    ) public view returns(bool callable, bool removeReportingValidator) {
        if (!isReportValidatorValid(_reportingMiningAddress)) return (false, false);
        if (!isReportValidatorValid(_maliciousMiningAddress)) return (false, false);

        uint256 validatorsNumber = _currentValidators.length;

        if (validatorsNumber > 1) {
            uint256 currentStakingEpoch = stakingContract.stakingEpoch();
            uint256 reportsNumber = reportingCounter[_reportingMiningAddress][currentStakingEpoch];
            uint256 reportsTotalNumber = reportingCounterTotal[currentStakingEpoch];
            uint256 averageReportsNumber = 0;

            if (reportsTotalNumber >= reportsNumber) {
                averageReportsNumber = (reportsTotalNumber - reportsNumber) / (validatorsNumber - 1);
            }

            if (reportsNumber > validatorsNumber * 50 && reportsNumber > averageReportsNumber * 10) {
                return (false, true);
            }
        }

        uint256 currentBlock = _getCurrentBlockNumber();

        if (_blockNumber > currentBlock) return (false, false); // avoid reporting about future blocks

        uint256 ancientBlocksLimit = 100;
        if (currentBlock > ancientBlocksLimit && _blockNumber < currentBlock - ancientBlocksLimit) {
            return (false, false); // avoid reporting about ancient blocks
        }

        address[] storage reportedValidators = _maliceReportedForBlock[_maliciousMiningAddress][_blockNumber];

        // Don't allow reporting validator to report about the same misbehavior more than once
        uint256 length = reportedValidators.length;
        for (uint256 m = 0; m < length; m++) {
            if (reportedValidators[m] == _reportingMiningAddress) {
                return (false, false);
            }
        }

        return (true, false);
    }

    // ============================================== Internal ========================================================

    /// @dev Updates the total reporting counter (see the `reportingCounterTotal` public mapping) for the current
    /// staking epoch after the specified validator is removed as malicious. The `reportMaliciousCallable` getter
    /// uses this counter for reporting checks so it must be up-to-date. Called by the `_removeMaliciousValidators`
    /// internal function.
    /// @param _miningAddress The mining address of the removed malicious validator.
    function _clearReportingCounter(address _miningAddress) internal {
        uint256 currentStakingEpoch = stakingContract.stakingEpoch();
        uint256 total = reportingCounterTotal[currentStakingEpoch];
        uint256 counter = reportingCounter[_miningAddress][currentStakingEpoch];

        reportingCounter[_miningAddress][currentStakingEpoch] = 0;

        if (total >= counter) {
            reportingCounterTotal[currentStakingEpoch] -= counter;
        } else {
            reportingCounterTotal[currentStakingEpoch] = 0;
        }
    }

    /// @dev Sets a new validator set stored in `_pendingValidators` array.
    /// Called by the `finalizeChange` function.
    /// @param _newStakingEpoch A boolean flag defining whether the validator set was formed by the
    /// `newValidatorSet` function.
    function _finalizeNewValidators(bool _newStakingEpoch) internal {
        address[] memory validators;
        uint256 i;

        validators = _currentValidators;
        for (i = 0; i < validators.length; i++) {
            isValidator[validators[i]] = false;
        }

        _currentValidators = _pendingValidators;

        validators = _currentValidators;
        for (i = 0; i < validators.length; i++) {
            address miningAddress = validators[i];
            isValidator[miningAddress] = true;
            if (_newStakingEpoch) {
                validatorCounter[miningAddress]++;
            }
        }
        stakingContract.incrementStakingEpoch();
        stakingContract.setStakingEpochStartBlock(_getCurrentBlockNumber() + 1);
        validatorSetApplyBlock = 0;
    }

    /// @dev Increments the reporting counter for the specified validator and the current staking epoch.
    /// See the `reportingCounter` and `reportingCounterTotal` public mappings. Called by the `reportMalicious`
    /// function when the validator reports a misbehavior.
    /// @param _reportingMiningAddress The mining address of reporting validator.
    function _incrementReportingCounter(address _reportingMiningAddress) internal {
        if (!isReportValidatorValid(_reportingMiningAddress)) return;
        uint256 currentStakingEpoch = stakingContract.stakingEpoch();
        reportingCounter[_reportingMiningAddress][currentStakingEpoch]++;
        reportingCounterTotal[currentStakingEpoch]++;
    }

    /// @dev Removes the specified validator as malicious. Used by the `_removeMaliciousValidators` internal function.
    /// @param _miningAddress The removed validator mining address.
    /// @param _reason A short string of the reason why the mining address is treated as malicious:
    /// "unrevealed" - the validator didn't reveal their secret at the end of staking epoch or skipped
    /// too many reveals during the staking epoch;
    /// "spam" - the validator made a lot of `reportMalicious` callings compared with other validators;
    /// "malicious" - the validator was reported as malicious by other validators with the `reportMalicious` function.
    /// @return Returns `true` if the specified validator has been removed from the pending validator set.
    /// Otherwise returns `false` (if the specified validator has already been removed or cannot be removed).
    function _removeMaliciousValidator(address _miningAddress, bytes32 _reason) internal returns(bool) {
        address stakingAddress = stakingByMiningAddress[_miningAddress];

        if (stakingAddress == unremovableValidator) {
            return false;
        }

        bool isBanned = isValidatorBanned(_miningAddress);

        // Ban the malicious validator for the next 3 months
        banCounter[_miningAddress]++;
        bannedUntil[_miningAddress] = _banUntil();
        banReason[_miningAddress] = _reason;

        if (isBanned) {
            // The validator is already banned
            return false;
        } else {
            bannedDelegatorsUntil[_miningAddress] = _banUntil();
        }

        // Remove malicious validator from the `pools`
        stakingContract.removePool(stakingAddress);

        uint256 length = _pendingValidators.length;

        if (length == 1) {
            // If the removed validator is one and only in the validator set, don't let remove them
            return false;
        }

        for (uint256 i = 0; i < length; i++) {
            if (_pendingValidators[i] == _miningAddress) {
                // Remove the malicious validator from `_pendingValidators`
                _pendingValidators[i] = _pendingValidators[length - 1];
                _pendingValidators.length--;
                return true;
            }
        }

        return false;
    }

    /// @dev Removes the specified validators as malicious from the pending validator set. Does nothing if
    /// the specified validators are already banned, non-removable, or don't exist in the pending validator set.
    /// @param _miningAddresses The mining addresses of the malicious validators.
    /// @param _reason A short string of the reason why the mining addresses are treated as malicious,
    /// see the `_removeMaliciousValidator` internal function description for possible values.
    function _removeMaliciousValidators(address[] memory _miningAddresses, bytes32 _reason) internal {
        bool removed = false;

        for (uint256 i = 0; i < _miningAddresses.length; i++) {
            if (_removeMaliciousValidator(_miningAddresses[i], _reason)) {
                // From this moment `getPendingValidators()` returns the new validator set
                _clearReportingCounter(_miningAddresses[i]);
                removed = true;
            }
        }

        // TODO: decide how to handle it
        /* if (removed) {
            _setPendingValidatorsChanged(false);
        } */
    }

    /// @dev Stores previous validators. Used by the `finalizeChange` function.
    function _savePreviousValidators() internal {
        uint256 length;
        uint256 i;

        // Save the previous validator set
        length = _previousValidators.length;
        for (i = 0; i < length; i++) {
            isValidatorPrevious[_previousValidators[i]] = false;
        }
        length = _currentValidators.length;
        for (i = 0; i < length; i++) {
            isValidatorPrevious[_currentValidators[i]] = true;
        }
        _previousValidators = _currentValidators;
    }

    /// @dev Sets a new validator set as a pending.
    /// Called by the `newValidatorSet` function.
    /// @param _stakingAddresses The array of the new validators' staking addresses.
    function _setPendingValidators(
        address[] memory _stakingAddresses
    ) internal {
        address unremovableMiningAddress = miningByStakingAddress[unremovableValidator];

        if (_stakingAddresses.length == 0) {
            // If there are no `poolsToBeElected`, we remove the
            // validators which want to exit from the validator set
            for (uint256 i = 0; i < _pendingValidators.length; i++) {
                address pvMiningAddress = _pendingValidators[i];
                if (pvMiningAddress == unremovableMiningAddress) {
                    continue; // don't touch unremovable validator
                }
                address pvStakingAddress = stakingByMiningAddress[pvMiningAddress];
                if (
                    stakingContract.isPoolActive(pvStakingAddress) &&
                    stakingContract.orderedWithdrawAmount(pvStakingAddress, pvStakingAddress) == 0
                ) {
                    // The validator has an active pool and is not going to withdraw their
                    // entire stake, so this validator doesn't want to exit from the validator set
                    continue;
                }
                if (_pendingValidators.length == 1) {
                    break; // don't remove one and only validator
                }
                // Remove the validator
                _pendingValidators[i] = _pendingValidators[_pendingValidators.length - 1];
                _pendingValidators.length--;
                i--;
            }
        } else {
            // If there are some `poolsToBeElected`, we remove all
            // validators which are not in the `poolsToBeElected` or
            // not selected by randomness
            delete _pendingValidators;

            if (unremovableMiningAddress != address(0)) {
                // Keep unremovable validator
                _pendingValidators.push(unremovableMiningAddress);
            }

            for (uint256 i = 0; i < _stakingAddresses.length; i++) {
                _pendingValidators.push(miningByStakingAddress[_stakingAddresses[i]]);
            }
        }
    }

    /// @dev Binds a mining address to the specified staking address. Used by the `setStakingAddress` function.
    /// See also the `miningByStakingAddress` and `stakingByMiningAddress` public mappings.
    /// @param _miningAddress The mining address of the newly created pool. Cannot be equal to the `_stakingAddress`
    /// and should never be used as a pool before.
    /// @param _stakingAddress The staking address of the newly created pool. Cannot be equal to the `_miningAddress`
    /// and should never be used as a pool before.
    function _setStakingAddress(address _miningAddress, address _stakingAddress) internal {
        require(_miningAddress != address(0));
        require(_stakingAddress != address(0));
        require(_miningAddress != _stakingAddress);
        require(miningByStakingAddress[_stakingAddress] == address(0));
        require(miningByStakingAddress[_miningAddress] == address(0));
        require(stakingByMiningAddress[_stakingAddress] == address(0));
        require(stakingByMiningAddress[_miningAddress] == address(0));
        miningByStakingAddress[_stakingAddress] = _miningAddress;
        stakingByMiningAddress[_miningAddress] = _stakingAddress;
    }

    /// @dev Returns the future block number until which a validator is banned.
    /// Used by the `_removeMaliciousValidator` internal function.
    function _banUntil() internal view returns(uint256) {
        uint256 blocksUntilEnd = stakingContract.stakingEpochEndBlock() - _getCurrentBlockNumber();
        // ~90 days, at least 12 full staking epochs (for 5 seconds block)
        return _getCurrentBlockNumber() + 12 * stakingContract.stakingEpochDuration() + blocksUntilEnd;
    }

    /// @dev Returns the current block number. Needed mostly for unit tests.
    function _getCurrentBlockNumber() internal view returns(uint256) {
        return block.number;
    }

    /// @dev Returns an index of a pool in the `poolsToBeElected` array
    /// (see the `StakingHbbft.getPoolsToBeElected` public getter)
    /// by a random number and the corresponding probability coefficients.
    /// Used by the `newValidatorSet` function.
    /// @param _likelihood An array of probability coefficients.
    /// @param _likelihoodSum A sum of probability coefficients.
    /// @param _randomNumber A random number.
    function _getRandomIndex(uint256[] memory _likelihood, uint256 _likelihoodSum, uint256 _randomNumber)
        internal
        pure
        returns(uint256)
    {
        uint256 random = _randomNumber % _likelihoodSum;
        uint256 sum = 0;
        uint256 index = 0;
        while (sum <= random) {
            sum += _likelihood[index];
            index++;
        }
        return index - 1;
    }
}
