pragma solidity =0.8.17;

import "./interfaces/IBlockRewardHbbft.sol";
import "./interfaces/IKeyGenHistory.sol";
import "./interfaces/IRandomHbbft.sol";
import "./interfaces/IStakingHbbft.sol";
import "./interfaces/IValidatorSetHbbft.sol";
import "./upgradeability/UpgradeableOwned.sol";

/// @dev Stores the current validator set and contains the logic for choosing new validators
/// before each staking epoch. The logic uses a random seed generated and stored by the `RandomHbbft` contract.
contract ValidatorSetHbbft is UpgradeableOwned, IValidatorSetHbbft {
    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables and do not change their types!
    address[] internal _currentValidators;
    address[] internal _pendingValidators;
    address[] internal _previousValidators;

    /// @dev Stores the validators that have reported the specific validator as malicious for the specified epoch.
    mapping(address => mapping(uint256 => address[]))
        internal _maliceReportedForBlock;

    /// @dev How many times a given mining address was banned.
    mapping(address => uint256) public banCounter;

    /// @dev Returns the time when the ban will be lifted for the specified mining address.
    mapping(address => uint256) public bannedUntil;

    /// @dev Returns the timestamp after which the ban will be lifted for delegators
    /// of the specified pool (mining address).
    mapping(address => uint256) public bannedDelegatorsUntil;

    /// @dev The reason for the latest ban of the specified mining address. See the `_removeMaliciousValidator`
    /// internal function description for the list of possible reasons.
    mapping(address => bytes32) public banReason;

    /// @dev The address of the `BlockRewardHbbft` contract.
    address public blockRewardContract;

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

    /// @dev How many times the given mining address has become a validator.
    mapping(address => uint256) public validatorCounter;

    /// @dev holds timestamps of last changes in `validatorAvailableSince`
    mapping(address => uint256) public validatorAvailableSinceLastWrite;

    /// @dev holds Availability information for each specific mining address
    /// unavailability happens if a validator gets voted to become a pending validator,
    /// but misses out the sending of the ACK or PART within the given timeframe.
    /// validators are required to declare availability,
    /// in order to become available for voting again.
    /// the value is of type timestamp
    mapping(address => uint256) public validatorAvailableSince;

    /// @dev The max number of validators.
    uint256 public maxValidators;

    /// @dev duration of ban in epochs
    uint256 public banDuration;

    /// @dev time in seconds after which the inactive validator is considered abandoned
    uint256 public validatorInactivityThreshold;

    // ================================================ Events ========================================================

    /// @dev Emitted by the `reportMalicious` function to signal that a specified validator reported
    /// misbehavior by a specified malicious validator at a specified block number.
    /// @param reportingValidator The mining address of the reporting validator.
    /// @param maliciousValidator The mining address of the malicious validator.
    /// @param blockNumber The block number at which the `maliciousValidator` misbehaved.
    event ReportedMalicious(
        address reportingValidator,
        address maliciousValidator,
        uint256 blockNumber
    );

    event ValidatorAvailable(address validator, uint256 timestamp);

    /// @dev Emitted by the `handleFailedKeyGeneration` function to signal that a specific validator was
    /// marked as unavailable since he dit not contribute to the required key shares.
    event ValidatorUnavailable(address validator, uint256 timestamp);

    // ============================================== Modifiers =======================================================

    /// @dev Ensures the `initialize` function was called before.
    modifier onlyInitialized() {
        require(isInitialized(), "ValidatorSet: not initialized");
        _;
    }

    /// @dev Ensures the caller is the BlockRewardHbbft contract address.
    modifier onlyBlockRewardContract() {
        require(msg.sender == blockRewardContract, "Only BlockReward contract");
        _;
    }

    /// @dev Ensures the caller is the RandomHbbft contract address.
    modifier onlyRandomContract() {
        require(msg.sender == randomContract, "Only Random Contract");
        _;
    }

    /// @dev Ensures the caller is the StakingHbbft contract address.
    modifier onlyStakingContract() {
        require(
            msg.sender == address(stakingContract),
            "Only Staking Contract"
        );
        _;
    }

    /// @dev Ensures the caller is the SYSTEM_ADDRESS. See https://wiki.parity.io/Validator-Set.html
    modifier onlySystem() virtual {
        require(
            msg.sender == 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE,
            "Only System"
        );
        _;
    }

    function getStakingContract() external view returns (address) {
        return address(stakingContract);
    }

    function isFullHealth() external view returns (bool) {
        // return maxValidators == _currentValidators.length;
        // for testing purposes we are hardcoding this to true.
        // https://github.com/DMDcoin/hbbft-posdao-contracts/issues/162
        return true;
    }

    // function getInfo()
    // public
    // view
    // returns (address sender, address admin) {
    //     return (msg.sender, _admin());
    // }

    // =============================================== Setters ========================================================

    /// @dev Initializes the network parameters. Used by the
    /// constructor of the `InitializerHbbft` contract.
    /// @param _blockRewardContract The address of the `BlockRewardHbbft` contract.
    /// @param _randomContract The address of the `RandomHbbft` contract.
    /// @param _stakingContract The address of the `StakingHbbft` contract.
    /// @param _keyGenHistoryContract The address of the `KeyGenHistory` contract.
    /// @param _validatorInactivityThreshold The time of inactivity in seconds to consider validator abandoned
    /// @param _initialMiningAddresses The array of initial validators' mining addresses.
    /// @param _initialStakingAddresses The array of initial validators' staking addresses.
    function initialize(
        address _blockRewardContract,
        address _randomContract,
        address _stakingContract,
        address _keyGenHistoryContract,
        uint256 _validatorInactivityThreshold,
        address[] calldata _initialMiningAddresses,
        address[] calldata _initialStakingAddresses
    ) external {
        require(
            msg.sender == _admin() ||
                tx.origin == _admin() ||
                address(0) == _admin() ||
                block.number == 0,
            "ValidatorSet: Initialization only on genesis block or by admin"
        );
        require(
            !isInitialized(),
            "ValidatorSet contract is already initialized"
        );
        require(
            _blockRewardContract != address(0),
            "BlockReward contract address can't be 0x0"
        );
        require(
            _randomContract != address(0),
            "Random contract address can't be 0x0"
        );
        require(
            _stakingContract != address(0),
            "Staking contract address can't be 0x0"
        );
        require(
            _keyGenHistoryContract != address(0),
            "KeyGenHistory contract address can't be 0x0"
        );
        require(
            _initialMiningAddresses.length > 0,
            "Must provide initial mining addresses"
        );
        require(
            _initialMiningAddresses.length == _initialStakingAddresses.length,
            "Must provide the same amount of mining/staking addresses"
        );

        blockRewardContract = _blockRewardContract;
        randomContract = _randomContract;
        stakingContract = IStakingHbbft(_stakingContract);
        keyGenHistoryContract = IKeyGenHistory(_keyGenHistoryContract);
        validatorInactivityThreshold = _validatorInactivityThreshold;

        // Add initial validators to the `_currentValidators` array
        for (uint256 i = 0; i < _initialMiningAddresses.length; i++) {
            address miningAddress = _initialMiningAddresses[i];
            _currentValidators.push(miningAddress);
            // _pendingValidators.push(miningAddress);
            isValidator[miningAddress] = true;
            validatorCounter[miningAddress]++;
            _setStakingAddress(miningAddress, _initialStakingAddresses[i]);
        }

        maxValidators = 25;
        banDuration = 12;
    }

    /// @dev Called by the system when a pending validator set is ready to be activated.
    /// Only valid when msg.sender == SUPER_USER (EIP96, 2**160 - 2).
    /// After this function is called, the `getValidators` getter returns the new validator set.
    /// If this function finalizes a new validator set formed by the `newValidatorSet` function,
    /// an old validator set is also stored and can be read by the `getPreviousValidators` getter.
    function finalizeChange() external onlyBlockRewardContract {
        if (_pendingValidators.length != 0) {
            // Apply a new validator set formed by the `newValidatorSet` function
            _savePreviousValidators();
            _finalizeNewValidators();
        }

        // new epoch starts
        stakingContract.incrementStakingEpoch();
        keyGenHistoryContract.notifyNewEpoch();
        delete _pendingValidators;
        stakingContract.setStakingEpochStartTime(block.timestamp);
    }

    /// @dev Implements the logic which forms a new validator set. If the number of active pools
    /// is greater than maxValidators, the logic chooses the validators randomly using a random seed generated and
    /// stored by the `RandomHbbft` contract.
    /// Automatically called by the `BlockRewardHbbft.reward` function at the latest block of the staking epoch.
    function newValidatorSet() external onlyBlockRewardContract {
        _newValidatorSet(new address[](0));
    }

    /// @dev Removes malicious validators.
    /// Called by the the Hbbft engine when a validator has been inactive for a long period.
    /// @param _miningAddresses The mining addresses of the malicious validators.
    function removeMaliciousValidators(address[] calldata _miningAddresses)
        external
        onlySystem
    {
        _removeMaliciousValidators(_miningAddresses, "inactive");
    }

    /// @dev called by validators when a validator comes online after
    /// getting marked as unavailable caused by a failed key generation.
    function announceAvailability(uint256 _blockNumber, bytes32 _blockhash)
        external
    {
        require(
            canCallAnnounceAvailability(msg.sender),
            "Announcing availability not possible."
        );
        require(
            _blockNumber < block.number,
            "_blockNumber argument must be in the past."
        );
        // 255 is a technical limitation of EVM ability to look into the past.
        // however, we query just for 16 blocks here.
        // this provides a time window big enough for valid nodes.
        require(
            _blockNumber + 16 > block.number,
            "_blockNumber argument must be in the past within the last 255 blocks."
        );
        // we have ensured now that we technicaly able to query the blockhash for that block
        require(
            blockhash(_blockNumber) == _blockhash,
            "provided blockhash must match blockchains blockhash"
        );

        uint256 timestamp = block.timestamp;
        _writeValidatorAvailableSince(msg.sender, timestamp);

        emit ValidatorAvailable(msg.sender, timestamp);
        // as long the mining node is not banned as well,
        // it can be picked up as regular active node again.
        if (!isValidatorBanned(msg.sender)) {
            stakingContract.notifyAvailability(
                stakingByMiningAddress[msg.sender]
            );
        }
    }

    /// @dev called by blockreward contract when a the reward when the block reward contract
    /// came to the conclusion that the validators could not manage to create a new shared key together.
    /// this starts the process to find replacements for the failing candites,
    /// as well as marking them unavailable.
    function handleFailedKeyGeneration() external onlyBlockRewardContract {
        // we should only kick out nodes if the nodes have been really to late.

        require(block.timestamp >= stakingContract.stakingFixedEpochEndTime(),
            "failed key generation can only be processed after the staking epoch is over."
        );

        if (stakingContract.getPoolsToBeElected().length == 0) {
            // if there is currently noone able to be elected, we just wait.
            // probably this happens, until there is someone manages to make
            // his pool available for staking again.
            return;
        }

        if (_pendingValidators.length == 0) {
            // if there are no "pending validators" that
            // should write their keys, then there is
            // nothing to do here.
            return;
        }

        // check if the current epoch should have been ended already
        // but some of the validators failed to write his PARTS / ACKS.

        // there are 2 scenarious:
        // 1.) missing Part: one or more validator was chosen, but never wrote his PART (most likely)
        // 2.) missing ACK: all validators were able to write their parts, but one or more failed to write
        // it's part.
        //
        // ad missing Part:
        // in this case we can just replace the validator with another one,
        // or if there is no other one available, continue with a smaller set.

        // ad missing ACK:
        // this case is more complex, since nodes did already write their acks for the parts
        // of a node that now drops out.
        // this should be a very rare case, and to make it simple,
        // we can just start over with the random selection of validators again.

        // temporary array to keep track of the good validators.
        // not all storage slots might be used.
        // we asume that there is at minimum 1 bad validator.
        address[] memory goodValidators = new address[](
            _pendingValidators.length - 1
        );
        uint256 goodValidatorsCount = 0;

        (
            uint128 numberOfPartsWritten,
            uint128 numberOfAcksWritten
        ) = keyGenHistoryContract.getNumberOfKeyFragmentsWritten();

        //address[] memory badValidators = new address[];

        for (uint256 i = 0; i < _pendingValidators.length; i++) {
            // get mining address for this pool.
            // if the mining address did his job (writing PART or ACKS).
            // add it to the good pool.
            address miningAddress = _pendingValidators[i]; //miningByStakingAddress[];

            // if a validator is good or bad, depends if he managed
            // the write the information required for the current state.
            bool isGood = false;

            if (_pendingValidators.length > numberOfPartsWritten) {
                // case 1: missing part scenario.
                // pending validator that missed out writing their part ?
                // maybe make a more precise length check in the future here ?
                isGood =
                    keyGenHistoryContract.getPart(miningAddress).length > 0;
            } else if (_pendingValidators.length > numberOfAcksWritten) {
                // case 2: parts were written, but did this validator also write it's ACKS ??
                // Note: we do not really need to check if the validator has written his part,
                // since all validators managed to write it's part.
                isGood = keyGenHistoryContract.getAcksLength(miningAddress) > 0;
            }

            if (isGood) {
                // we track all good validators,
                // so we can later pass the good validators
                // to the _newValidatorSet function.
                goodValidators[goodValidatorsCount] = _pendingValidators[i];
                goodValidatorsCount++;
            } else {
                // this Pool is not available anymore.
                // the pool does not get a Ban,
                // but is treated as "inactive" as long it does not `announceAvailability()`

                stakingContract.removePool(
                    stakingByMiningAddress[miningAddress]
                );

                // mark the Node address as not available.
                _writeValidatorAvailableSince(miningAddress, 0);

                emit ValidatorUnavailable(miningAddress, block.timestamp);
            }
        }

        keyGenHistoryContract.clearPrevKeyGenState(_pendingValidators);
        keyGenHistoryContract.notifyKeyGenFailed();

        // we might only set a subset to the newValidatorSet function,
        // since the last indexes of the array are holding unused slots.
        address[] memory forcedPools = new address[](goodValidatorsCount);
        for (uint256 i = 0; i < goodValidatorsCount; i++) {
            forcedPools[i] = goodValidators[i];
        }

        // this tells the staking contract that the key generation failed
        // so the staking conract is able to prolong this staking period.
        stakingContract.notifyKeyGenFailed();

        // is there anyone left that can get elected ??
        // if not, we just continue with the validator set we have now,
        // for another round,
        // hopefully that on or the other node operators get his pool fixed.
        // the Deadline just stays a full time window.
        // therefore the Node Operators might get a chance that
        // many manage to fix the problem,
        // and we can get a big takeover.
        if (stakingContract.getPoolsToBeElected().length > 0) {
            _newValidatorSet(forcedPools);
        }
    }

    /// @dev Notifies hbbft validator set contract that a validator
    /// asociated with the given `_stakingAddress` became
    /// unavailable and must be flagged as unavailable.
    /// @param _stakingAddress The address of the validator which became unavailable.
    function notifyUnavailability(address _stakingAddress)
        external
        onlyStakingContract
    {
        _writeValidatorAvailableSince(miningByStakingAddress[_stakingAddress], 0);
    }

    /// @dev Reports that the malicious validator misbehaved at the specified block.
    /// Called by the node of each honest validator after the specified validator misbehaved.
    /// See https://openethereum.github.io/Validator-Set.html#reporting-contract
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
                // Reporting validator has been reporting too often, so
                // treat them as a malicious as well (spam)
                address[] memory miningAddresses = new address[](1);
                miningAddresses[0] = reportingMiningAddress;
                _removeMaliciousValidators(miningAddresses, "spam");
            }
            return;
        }

        address[] storage reportedValidators = _maliceReportedForBlock[
            _maliciousMiningAddress
        ][_blockNumber];

        reportedValidators.push(reportingMiningAddress);

        emit ReportedMalicious(
            reportingMiningAddress,
            _maliciousMiningAddress,
            _blockNumber
        );

        uint256 validatorsLength = _currentValidators.length;
        bool remove;

        if (validatorsLength > 3) {
            // If more than 2/3 of validators reported about malicious validator
            // for the same `blockNumber`
            remove = reportedValidators.length * 3 > validatorsLength * 2;
        } else {
            // If more than 1/2 of validators reported about malicious validator
            // for the same `blockNumber`
            remove = reportedValidators.length * 2 > validatorsLength;
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
    function setStakingAddress(address _miningAddress, address _stakingAddress)
        external
        onlyStakingContract
    {
        _setStakingAddress(_miningAddress, _stakingAddress);
    }

    function setMaxValidators(uint256 _maxValidators) external onlyOwner {
        maxValidators = _maxValidators;
    }

    function setBanDuration(uint256 _banDuration) external onlyOwner {
        banDuration = _banDuration;
    }

    /// @dev set's the validators ip address.
    /// this function can only be called by validators.
    /// @param _ip IPV4 address of a running Node Software or Proxy.
    /// @param _port port for IPv4 address of a running Node Software or Proxy.
    function setValidatorInternetAddress(bytes16 _ip, bytes2 _port) external {
        // get stacking address of sender. (required)
        address validatorAddress = stakingByMiningAddress[msg.sender];
        require(
            validatorAddress != address(0),
            "No Pool defined for this validator."
        );
        // optional: we could verify public key to signer (public key) integrity, but it is costly.
        stakingContract.setValidatorInternetAddress(
            validatorAddress,
            _ip,
            _port
        );
    }

    // =============================================== Getters ========================================================

    /// @dev Returns a boolean flag indicating whether delegators of the specified pool are currently banned.
    /// A validator pool can be banned when they misbehave (see the `_removeMaliciousValidator` function).
    /// @param _miningAddress The mining address of the pool.
    function areDelegatorsBanned(address _miningAddress)
        public
        view
        returns (bool)
    {
        return block.timestamp <= bannedDelegatorsUntil[_miningAddress];
    }

    /// @dev Returns the previous validator set (validators' mining addresses array).
    /// The array is stored by the `finalizeChange` function
    /// when a new staking epoch's validator set is finalized.
    function getPreviousValidators() public view returns (address[] memory) {
        return _previousValidators;
    }

    /// @dev Returns the current array of pending validators i.e. waiting to be activated in the new epoch
    /// The pending array is changed when a validator is removed as malicious
    /// or the validator set is updated by the `newValidatorSet` function.
    function getPendingValidators() public view returns (address[] memory) {
        return _pendingValidators;
    }

    /// @dev Returns the current validator set (an array of mining addresses)
    /// which always matches the validator set kept in validator's node.
    function getValidators() public view returns (address[] memory) {
        return _currentValidators;
    }

    /// @dev Returns a boolean flag indicating if the `initialize` function has been called.
    function isInitialized() public view returns (bool) {
        return blockRewardContract != address(0);
    }

    /// @dev Returns a boolean flag indicating whether the specified validator (mining address)
    /// is able to call the `reportMalicious` function or whether the specified validator (mining address)
    /// can be reported as malicious. This function also allows a validator to call the `reportMalicious`
    /// function several blocks after ceasing to be a validator. This is possible if a
    /// validator did not have the opportunity to call the `reportMalicious` function prior to the
    /// engine calling the `finalizeChange` function.
    /// @param _miningAddress The validator's mining address.
    function isReportValidatorValid(address _miningAddress)
        public
        view
        returns (bool)
    {
        bool isValid = isValidator[_miningAddress] &&
            !isValidatorBanned(_miningAddress);
        if (stakingContract.stakingEpoch() == 0) {
            return isValid;
        }
        // TO DO: arbitrarily chosen period stakingFixedEpochDuration/5.
        if (
            block.timestamp - stakingContract.stakingEpochStartTime() <=
            stakingContract.stakingFixedEpochDuration() / 5
        ) {
            // The current validator set was finalized by the engine,
            // but we should let the previous validators finish
            // reporting malicious validator within a few blocks
            bool previousValidator = isValidatorPrevious[_miningAddress];
            return isValid || previousValidator;
        }
        return isValid;
    }

    function getPendingValidatorKeyGenerationMode(address _miningAddress)
        public
        view
        returns (KeyGenMode)
    {
        // enum KeyGenMode { NotAPendingValidator, WritePart, WaitForOtherParts,
        // WriteAck, WaitForOtherAcks, AllKeysDone }

        if (!isPendingValidator(_miningAddress)) {
            return KeyGenMode.NotAPendingValidator;
        }

        // since we got a part, maybe to validator is about to write his ack ?
        // he is allowed to write his ack, if all nodes have written their part.

        (
            uint128 numberOfPartsWritten,
            uint128 numberOfAcksWritten
        ) = keyGenHistoryContract.getNumberOfKeyFragmentsWritten();

        if (numberOfPartsWritten < _pendingValidators.length) {
            bytes memory part = keyGenHistoryContract.getPart(_miningAddress);
            if (part.length == 0) {
                // we know here that the validator is pending,
                // but dit not have written the part yet.
                // so he is allowed to write it's part.
                return KeyGenMode.WritePart;
            } else {
                // this mining address has written their part.
                return KeyGenMode.WaitForOtherParts;
            }
        } else if (numberOfAcksWritten < _pendingValidators.length) {
            // not all Acks Written, so the key is not complete.
            // we know know that all Nodes have written their PART.
            // but not all have written their ACK.
            // are we the one who has written his ACK.

            if (keyGenHistoryContract.getAcksLength(_miningAddress) == 0) {
                return KeyGenMode.WriteAck;
            } else {
                return KeyGenMode.WaitForOtherAcks;
            }
        } else {
            return KeyGenMode.AllKeysDone;
        }
    }

    /// @dev Returns a boolean flag indicating whether the specified mining address is currently banned.
    /// A validator can be banned when they misbehave (see the `_removeMaliciousValidator` internal function).
    /// @param _miningAddress The mining address.
    function isValidatorBanned(address _miningAddress)
        public
        view
        returns (bool)
    {
        return block.timestamp <= bannedUntil[_miningAddress];
    }

    /// @dev Returns a boolean flag indicating whether the specified mining address is a validator
    /// or is in the `_pendingValidators`.
    /// Used by the `StakingHbbft.maxWithdrawAllowed` and `StakingHbbft.maxWithdrawOrderAllowed` getters.
    /// @param _miningAddress The mining address.
    function isValidatorOrPending(address _miningAddress)
        public
        view
        returns (bool)
    {
        if (isValidator[_miningAddress]) {
            return true;
        }

        return isPendingValidator(_miningAddress);
    }

    /// @dev Returns a boolean flag indicating whether the specified mining address is a pending validator.
    /// Used by the `isValidatorOrPending` and `KeyGenHistory.writeAck/Part` functions.
    /// @param _miningAddress The mining address.
    function isPendingValidator(address _miningAddress)
        public
        view
        returns (bool)
    {
        for (uint256 i = 0; i < _pendingValidators.length; i++) {
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
    function maliceReportedForBlock(
        address _miningAddress,
        uint256 _blockNumber
    ) public view returns (address[] memory) {
        return _maliceReportedForBlock[_miningAddress][_blockNumber];
    }

    /// @dev Returns if the specified _miningAddress is able to announce availability.
    /// @param _miningAddress mining address that is allowed/disallowed.
    function canCallAnnounceAvailability(address _miningAddress)
        public
        view
        returns (bool)
    {
        if (stakingByMiningAddress[_miningAddress] == address(0)) {
            // not a validator node.
            return false;
        }

        if (validatorAvailableSince[_miningAddress] != 0) {
            // "Validator was not marked as unavailable."
            return false;
        }

        return true;
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
    /// @return callable `bool callable` - The boolean flag indicating whether the `reportMalicious` function
    /// can be called at the moment.
    /// @return removeReportingValidator `bool removeReportingValidator` - The boolean flag indicating whether
    /// the reporting validator should be removed as malicious due to excessive reporting. This flag is only used
    /// by the `reportMalicious` function.
    function reportMaliciousCallable(
        address _reportingMiningAddress,
        address _maliciousMiningAddress,
        uint256 _blockNumber
    ) public view returns (bool callable, bool removeReportingValidator) {
        if (!isReportValidatorValid(_reportingMiningAddress))
            return (false, false);
        if (!isReportValidatorValid(_maliciousMiningAddress))
            return (false, false);

        uint256 validatorsNumber = _currentValidators.length;

        if (validatorsNumber > 1) {
            uint256 currentStakingEpoch = stakingContract.stakingEpoch();
            uint256 reportsNumber = reportingCounter[_reportingMiningAddress][
                currentStakingEpoch
            ];
            uint256 reportsTotalNumber = reportingCounterTotal[
                currentStakingEpoch
            ];
            uint256 averageReportsNumberX10 = 0;

            if (reportsTotalNumber >= reportsNumber) {
                averageReportsNumberX10 =
                    ((reportsTotalNumber - reportsNumber) * 10) /
                    (validatorsNumber - 1);
            }

            if (
                reportsNumber > validatorsNumber * 50 &&
                reportsNumber > averageReportsNumberX10
            ) {
                return (false, true);
            }
        }

        uint256 currentBlock = block.number; // TODO: _getCurrentBlockNumber(); Make it time based here ?

        if (_blockNumber > currentBlock) return (false, false); // avoid reporting about future blocks

        uint256 ancientBlocksLimit = 100; //TODO: needs to be afjusted for HBBFT specifications i.e. time
        if (
            currentBlock > ancientBlocksLimit &&
            _blockNumber < currentBlock - ancientBlocksLimit
        ) {
            return (false, false); // avoid reporting about ancient blocks
        }

        address[] storage reportedValidators = _maliceReportedForBlock[
            _maliciousMiningAddress
        ][_blockNumber];

        // Don't allow reporting validator to report about the same misbehavior more than once
        uint256 length = reportedValidators.length;
        for (uint256 m = 0; m < length; m++) {
            if (reportedValidators[m] == _reportingMiningAddress) {
                return (false, false);
            }
        }

        return (true, false);
    }

    /// @dev Returns the public key for the given stakingAddress
    /// @param _stakingAddress staking address of the wanted public key.
    /// @return public key of the _stakingAddress
    function publicKeyByStakingAddress(address _stakingAddress)
        external
        view
        returns (bytes memory)
    {
        return stakingContract.getPoolPublicKey(_stakingAddress);
    }

    /// @dev Returns a boolean flag indicating whether the specified validator unavailable
    /// for `validatorInactivityThreshold` seconds
    /// @param _stakingAddress staking pool address.
    function isValidatorAbandoned(address _stakingAddress)
        external
        view
        returns (bool)
    {
        address validator = miningByStakingAddress[_stakingAddress];

        if (validatorAvailableSince[validator] != 0) {
            return false;
        }

        uint256 inactiveSeconds = block.timestamp - validatorAvailableSinceLastWrite[validator];

        return inactiveSeconds >= validatorInactivityThreshold;
    }

    /// @dev Returns the public key for the given miningAddress
    /// @param _miningAddress mining address of the wanted public key.
    /// @return public key of the _miningAddress
    function getPublicKey(address _miningAddress)
        external
        view
        returns (bytes memory)
    {
        return
            stakingContract.getPoolPublicKey(
                stakingByMiningAddress[_miningAddress]
            );
    }

    /// @dev in Hbbft there are sweet spots for the choice of validator counts
    /// those are FLOOR((n - 1)/3) * 3 + 1
    /// values: 1 - 4 - 7 - 10 - 13 - 16 - 19 - 22 - 25
    /// more about: https://github.com/DMDcoin/hbbft-posdao-contracts/issues/84
    /// @return a sweet spot n for a given number n
    function getValidatorCountSweetSpot(uint256 _possibleValidatorCount)
        public
        view
        returns (uint256)
    {
        require(
            _possibleValidatorCount > 0,
            "_possibleValidatorCount must not be 0"
        );
        if (_possibleValidatorCount < 4) {
            return _possibleValidatorCount;
        }
        return ((_possibleValidatorCount - 1) / 3) * 3 + 1;
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

    function _newValidatorSet(address[] memory _forcedPools) internal {
        address[] memory poolsToBeElected = stakingContract
            .getPoolsToBeElected();

        uint256 numOfValidatorsToBeElected = poolsToBeElected.length >=
            maxValidators ||
            poolsToBeElected.length == 0
            ? maxValidators
            : getValidatorCountSweetSpot(poolsToBeElected.length);

        // Choose new validators > )
        if (poolsToBeElected.length > numOfValidatorsToBeElected) {
            uint256 poolsToBeElectedLength = poolsToBeElected.length;
            (
                uint256[] memory likelihood,
                uint256 likelihoodSum
            ) = stakingContract.getPoolsLikelihood();
            address[] memory newValidators = new address[](
                numOfValidatorsToBeElected
            );

            uint256 indexNewValidator = 0;
            for (
                uint256 iForced = 0;
                iForced < _forcedPools.length;
                iForced++
            ) {
                for (
                    uint256 iPoolToBeElected = 0;
                    iPoolToBeElected < poolsToBeElectedLength;
                    iPoolToBeElected++
                ) {
                    if (
                        poolsToBeElected[iPoolToBeElected] ==
                        _forcedPools[iForced]
                    ) {
                        newValidators[indexNewValidator] = _forcedPools[
                            iForced
                        ];
                        indexNewValidator++;
                        likelihoodSum -= likelihood[iPoolToBeElected];
                        // kicking out this pools from the "to be elected" list,
                        // by replacing it with the last element,
                        // and virtually reducing it's size.
                        poolsToBeElectedLength--;
                        poolsToBeElected[iPoolToBeElected] = poolsToBeElected[
                            poolsToBeElectedLength
                        ];
                        likelihood[iPoolToBeElected] = likelihood[
                            poolsToBeElectedLength
                        ];
                        break;
                    }
                }
            }

            uint256 randomNumber = IRandomHbbft(randomContract).currentSeed();

            if (likelihood.length > 0 && likelihoodSum > 0) {
                for (uint256 i = 0; i < newValidators.length; i++) {
                    randomNumber = uint256(
                        keccak256(abi.encode(randomNumber ^ block.timestamp))
                    );
                    uint256 randomPoolIndex = _getRandomIndex(
                        likelihood,
                        likelihoodSum,
                        randomNumber
                    );
                    newValidators[i] = poolsToBeElected[randomPoolIndex];
                    likelihoodSum -= likelihood[randomPoolIndex];
                    poolsToBeElectedLength--;
                    poolsToBeElected[randomPoolIndex] = poolsToBeElected[
                        poolsToBeElectedLength
                    ];
                    likelihood[randomPoolIndex] = likelihood[
                        poolsToBeElectedLength
                    ];
                }

                _setPendingValidators(newValidators);
            }
        } else {
            //note: it is assumed here that _forcedPools is always a subset of poolsToBeElected.
            // a forcedPool can never get picked up if it is not part of the poolsToBeElected.
            // the logic needs to be that consistent.
            _setPendingValidators(poolsToBeElected);
        }

        // clear previousValidator KeyGenHistory state
        keyGenHistoryContract.clearPrevKeyGenState(_currentValidators);

        if (poolsToBeElected.length != 0) {
            // Remove pools marked as `to be removed`
            stakingContract.removePools();
        }

        // a new validator set can get choosen already outside the timeframe for phase 2.
        // this can happen if the network got stuck and get's repaired.
        // and the repair takes longer than a single epoch.
        // we detect this case here and grant an extra time window
        // so the selected nodes also get their chance to write their keys.
        // more about: https://github.com/DMDcoin/hbbft-posdao-contracts/issues/96

        // timescale:
        // epoch start time ..... phase 2 transition .... current end of phase 2 ..... now ..... new end of phase 2.

        // new extra window size has to cover the difference between phase2 transition and now.
        // to reach the new end of phase 2.

        // current end of phase 2 : stakingContract.stakingFixedEpochEndTime()

        // now: block.timestamp

        if (block.timestamp > stakingContract.stakingFixedEpochEndTime()) {
            stakingContract.notifyNetworkOfftimeDetected(
                block.timestamp - stakingContract.stakingFixedEpochEndTime()
            );
        }
    }

    /// @dev Sets a new validator set stored in `_pendingValidators` array.
    /// Called by the `finalizeChange` function.
    function _finalizeNewValidators() internal {
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
            validatorCounter[miningAddress]++;
        }
    }

    /// @dev Increments the reporting counter for the specified validator and the current staking epoch.
    /// See the `reportingCounter` and `reportingCounterTotal` public mappings. Called by the `reportMalicious`
    /// function when the validator reports a misbehavior.
    /// @param _reportingMiningAddress The mining address of reporting validator.
    function _incrementReportingCounter(address _reportingMiningAddress)
        internal
    {
        if (!isReportValidatorValid(_reportingMiningAddress)) return;
        uint256 currentStakingEpoch = stakingContract.stakingEpoch();
        reportingCounter[_reportingMiningAddress][currentStakingEpoch]++;
        reportingCounterTotal[currentStakingEpoch]++;
    }

    /// @dev Removes the specified validator as malicious. Used by the `_removeMaliciousValidators` internal function.
    /// @param _miningAddress The removed validator mining address.
    /// @param _reason A short string of the reason why the mining address is treated as malicious:
    /// "inactive" - the validator has not been contributing to block creation for sigificant period of time.
    /// "spam" - the validator made a lot of `reportMalicious` callings compared with other validators.
    /// "malicious" - the validator was reported as malicious by other validators with the `reportMalicious` function.
    /// @return Returns `true` if the specified validator has been removed from the pending validator set.
    /// Otherwise returns `false` (if the specified validator has already been removed or cannot be removed).
    function _removeMaliciousValidator(address _miningAddress, bytes32 _reason)
        internal
        returns (bool)
    {
        bool isBanned = isValidatorBanned(_miningAddress);
        // Ban the malicious validator for at least the next 12 staking epochs
        uint256 banUntil = _banUntil();

        banCounter[_miningAddress]++;
        bannedUntil[_miningAddress] = banUntil;
        banReason[_miningAddress] = _reason;

        if (isBanned) {
            // The validator is already banned
            return false;
        } else {
            bannedDelegatorsUntil[_miningAddress] = banUntil;
        }

        // Remove malicious validator from the `pools`
        address stakingAddress = stakingByMiningAddress[_miningAddress];
        stakingContract.removePool(stakingAddress);

        // If the validator set has only one validator, don't remove it.
        uint256 length = _currentValidators.length;
        if (length == 1) {
            return false;
        }

        for (uint256 i = 0; i < length; i++) {
            if (_currentValidators[i] == _miningAddress) {
                // Remove the malicious validator from `_pendingValidators`
                _currentValidators[i] = _currentValidators[length - 1];
                _currentValidators.pop();
                return true;
            }
        }

        return false;
    }

    /// @dev Removes the specified validators as malicious from the pending validator set. Does nothing if
    /// the specified validators are already banned or don't exist in the pending validator set.
    /// @param _miningAddresses The mining addresses of the malicious validators.
    /// @param _reason A short string of the reason why the mining addresses are treated as malicious,
    /// see the `_removeMaliciousValidator` internal function description for possible values.
    function _removeMaliciousValidators(
        address[] memory _miningAddresses,
        bytes32 _reason
    ) internal {
        for (uint256 i = 0; i < _miningAddresses.length; i++) {
            if (_removeMaliciousValidator(_miningAddresses[i], _reason)) {
                // From this moment `getPendingValidators()` returns the new validator set
                _clearReportingCounter(_miningAddresses[i]);
            }
        }
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
    function _setPendingValidators(address[] memory _stakingAddresses)
        internal
    {
        // clear  the pending validators list first
        delete _pendingValidators;

        if (_stakingAddresses.length == 0) {
            // If there are no `poolsToBeElected`, we remove the
            // validators which want to exit from the validator set
            for (uint256 i = 0; i < _currentValidators.length; i++) {
                address pvMiningAddress = _currentValidators[i];
                address pvStakingAddress = stakingByMiningAddress[
                    pvMiningAddress
                ];
                if (
                    stakingContract.isPoolActive(pvStakingAddress) &&
                    stakingContract.orderedWithdrawAmount(
                        pvStakingAddress,
                        pvStakingAddress
                    ) ==
                    0
                ) {
                    // The validator has an active pool and is not going to withdraw their
                    // entire stake, so this validator doesn't want to exit from the validator set
                    _pendingValidators.push(pvMiningAddress);
                }
            }
            if (_pendingValidators.length == 0) {
                _pendingValidators.push(_currentValidators[0]); // add at least on validator
            }
        } else {
            for (uint256 i = 0; i < _stakingAddresses.length; i++) {
                _pendingValidators.push(
                    miningByStakingAddress[_stakingAddresses[i]]
                );
            }
        }
    }

    /// @dev Binds a mining address to the specified staking address. Used by the `setStakingAddress` function.
    /// See also the `miningByStakingAddress` and `stakingByMiningAddress` public mappings.
    /// @param _miningAddress The mining address of the newly created pool. Cannot be equal to the `_stakingAddress`
    /// and should never be used as a pool before.
    /// @param _stakingAddress The staking address of the newly created pool. Cannot be equal to the `_miningAddress`
    /// and should never be used as a pool before.
    function _setStakingAddress(address _miningAddress, address _stakingAddress)
        internal
    {
        require(_miningAddress != address(0), "Mining address can't be 0");
        require(_stakingAddress != address(0), "Staking address can't be 0");
        require(
            _miningAddress != _stakingAddress,
            "Mining address cannot be the same as the staking one"
        );
        require(
            miningByStakingAddress[_stakingAddress] == address(0),
            "Staking address already used as a staking one"
        );
        require(
            miningByStakingAddress[_miningAddress] == address(0),
            "Mining address already used as a staking one"
        );
        require(
            stakingByMiningAddress[_stakingAddress] == address(0),
            "Staking address already used as a mining one"
        );
        require(
            stakingByMiningAddress[_miningAddress] == address(0),
            "Mining address already used as a mining one"
        );
        miningByStakingAddress[_stakingAddress] = _miningAddress;
        stakingByMiningAddress[_miningAddress] = _stakingAddress;
    }

    /// @dev Writes `validatorAvaialableSince` and saves timestamp of last change.
    /// @param _validator validator address
    /// @param _availableSince timestamp when the validator became available, 0 if unavailable
    function _writeValidatorAvailableSince(address _validator, uint256 _availableSince) internal {
        validatorAvailableSince[_validator] = _availableSince;
        validatorAvailableSinceLastWrite[_validator] = block.timestamp;
    }

    /// @dev Returns the future timestamp until which a validator is banned.
    /// Used by the `_removeMaliciousValidator` internal function.
    function _banUntil() internal view returns (uint256) {
        uint256 currentTimestamp = block.timestamp;
        uint256 ticksUntilEnd = stakingContract.stakingFixedEpochEndTime() -
            currentTimestamp;
        // Ban for at least 12 full staking epochs:
        // currentTimestampt + stakingFixedEpochDuration + remainingEpochDuration.
        return
            currentTimestamp +
            (banDuration * stakingContract.stakingFixedEpochDuration()) +
            (ticksUntilEnd);
    }

    /// @dev Returns an index of a pool in the `poolsToBeElected` array
    /// (see the `StakingHbbft.getPoolsToBeElected` public getter)
    /// by a random number and the corresponding probability coefficients.
    /// Used by the `newValidatorSet` function.
    /// @param _likelihood An array of probability coefficients.
    /// @param _likelihoodSum A sum of probability coefficients.
    /// @param _randomNumber A random number.
    function _getRandomIndex(
        uint256[] memory _likelihood,
        uint256 _likelihoodSum,
        uint256 _randomNumber
    ) internal pure returns (uint256) {
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
