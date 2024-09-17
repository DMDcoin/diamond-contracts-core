// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { IKeyGenHistory } from "./interfaces/IKeyGenHistory.sol";
import { IRandomHbbft } from "./interfaces/IRandomHbbft.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { IBonusScoreSystem } from "./interfaces/IBonusScoreSystem.sol";
import { Unauthorized, ValidatorsListEmpty, ZeroAddress } from "./lib/Errors.sol";

/// @dev Stores the current validator set and contains the logic for choosing new validators
/// before each staking epoch. The logic uses a random seed generated and stored by the `RandomHbbft` contract.
contract ValidatorSetHbbft is Initializable, OwnableUpgradeable, IValidatorSetHbbft {
    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables and do not change their types!
    address[] internal _currentValidators;
    address[] internal _pendingValidators;
    address[] internal _previousValidators;

    /// @custom:oz-renamed-from _maliceReportedForBlock
    mapping(address => mapping(uint256 => address[])) internal _unused1;

    /// @custom:oz-renamed-from banCounter
    mapping(address => uint256) public _unused2;

    /// @custom:oz-renamed-from bannedUntil
    mapping(address => uint256) public _unused3;

    /// @custom:oz-renamed-from bannedDelegatorsUntil
    mapping(address => uint256) public _unused4;

    /// @custom:oz-renamed-from banReason
    mapping(address => bytes32) public _unused5;

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

    /// @custom:oz-renamed-from reportingCounter
    mapping(address => mapping(uint256 => uint256)) public _unused6;

    /// @custom:oz-renamed-from reportingCounterTotal
    mapping(uint256 => uint256) public _unused7;

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

    /// @custom:oz-renamed-from banDuration
    uint256 public _unused8;

    /// @dev time in seconds after which the inactive validator is considered abandoned
    uint256 public validatorInactivityThreshold;

    IBonusScoreSystem public bonusScoreSystem;

    address public connectivityTracker;

    // ================================================ Events ========================================================

    event ValidatorAvailable(address validator, uint256 timestamp);

    /// @dev Emitted by the `handleFailedKeyGeneration` and `notifyUnavailability` functions to signal that a specific
    /// validator was marked as unavailable since he dit not contribute to the required key shares or 2/3 of other
    /// validators reporter him as disconnected.
    event ValidatorUnavailable(address validator, uint256 timestamp);

    event SetMaxValidators(uint256 _count);
    event SetValidatorInactivityThreshold(uint256 _value);
    event SetBonusScoreContract(address _address);
    event SetConnectivityTrackerContract(address _address);

    error AnnounceBlockNumberTooOld();
    error CantAnnounceAvailability();
    error EpochNotYetzFinished();
    error InitialAddressesLengthMismatch();
    error InitialValidatorsEmpty();
    error InvalidAddressPair();
    error InvalidAnnounceBlockNumber();
    error InvalidAnnounceBlockHash();
    error InvalidInactivityThreshold();
    error InvalidPossibleValidatorCount();
    error MiningAddressAlreadyUsed(address _value);
    error StakingAddressAlreadyUsed(address _value);
    error StakingPoolNotExist(address _mining);

    // ============================================== Modifiers =======================================================

    /// @dev Ensures the caller is the BlockRewardHbbft contract address.
    modifier onlyBlockRewardContract() {
        if (msg.sender != blockRewardContract) {
            revert Unauthorized();
        }
        _;
    }

    /// @dev Ensures the caller is the StakingHbbft contract address.
    modifier onlyStakingContract() {
        if (msg.sender != address(stakingContract)) {
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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
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
    /// @param _contractOwner The address of the contract owner.
    /// @param _params ValidatorSetHbbft contract parameeters (introduced to avoid stack too deep issue):
    ///  blockRewardContract The address of the `BlockRewardHbbft` contract.
    ///  randomContract The address of the `RandomHbbft` contract.
    ///  stakingContract The address of the `StakingHbbft` contract.
    ///  keyGenHistoryContract The address of the `KeyGenHistory` contract.
    ///  bonusScoreContract The address of the `BonusScoreSystem` contract.
    ///  validatorInactivityThreshold The time of inactivity in seconds to consider validator abandoned
    /// @param _initialMiningAddresses The array of initial validators' mining addresses.
    /// @param _initialStakingAddresses The array of initial validators' staking addresses.
    function initialize(
        address _contractOwner,
        ValidatorSetParams calldata _params,
        address[] calldata _initialMiningAddresses,
        address[] calldata _initialStakingAddresses
    ) external initializer {
        _validateParams(_params);

        if (_contractOwner == address(0)) {
            revert ZeroAddress();
        }

        if (_initialMiningAddresses.length == 0) {
            revert ValidatorsListEmpty();
        }

        if (_initialMiningAddresses.length != _initialStakingAddresses.length) {
            revert InitialAddressesLengthMismatch();
        }

        __Ownable_init(_contractOwner);

        blockRewardContract = _params.blockRewardContract;
        randomContract = _params.randomContract;
        stakingContract = IStakingHbbft(_params.stakingContract);
        keyGenHistoryContract = IKeyGenHistory(_params.keyGenHistoryContract);
        bonusScoreSystem = IBonusScoreSystem(_params.bonusScoreContract);
        connectivityTracker = _params.connectivityTrackerContract;
        validatorInactivityThreshold = _params.validatorInactivityThreshold;

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
    }

    /// @dev Called by the system when a pending validator set is ready to be activated.
    /// After this function is called, the `getValidators` getter returns the new validator set.
    /// If this function finalizes, a new validator set is created by the `newValidatorSet` function.
    /// an old validator set is also stored and can be read by the `getPreviousValidators` getter.
    function finalizeChange() external onlyBlockRewardContract {
        if (_pendingValidators.length != 0) {
            // Apply a new validator set formed by the `newValidatorSet` function
            _savePreviousValidators();
            _finalizeNewValidators();
        }

        _rewardValidatorsStandBy();
        _penaliseValidatorsNoStandBy();

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

    /// @dev Inactive validators and their stakers loose there stake after a certain period of time.
    /// This function defines the lenght of this time window. 
    /// @param _seconds new value in seconds. 
    function setValidatorInactivityThreshold(uint256 _seconds) external onlyOwner {
        
        // chosen abritary minimum value of a week.
        // if you want smaller values for tests,
        // the contract can be deployed with a smaller value
        // (no restriction there)
        if (_seconds < 1 weeks) {
            revert InvalidInactivityThreshold();
        }

        validatorInactivityThreshold = _seconds;

        emit SetValidatorInactivityThreshold(_seconds);
    }

    function setBonusScoreSystemAddress(address _address) external onlyOwner {
        if (_address == address(0)) {
            revert ZeroAddress();
        }

        bonusScoreSystem = IBonusScoreSystem(_address);

        emit SetBonusScoreContract(_address);
    }

    function setConnectivityTracker(address _address) external onlyOwner {
        if (_address == address(0)) {
            revert ZeroAddress();
        }

        connectivityTracker = _address;

        emit SetConnectivityTrackerContract(_address);
    }

    /// @dev called by validators when a validator comes online after
    /// getting marked as unavailable caused by a failed key generation.
    function announceAvailability(uint256 _blockNumber, bytes32 _blockhash) external {
        if (!canCallAnnounceAvailability(msg.sender)) {
            revert CantAnnounceAvailability();
        }

        if (_blockNumber >= block.number) {
            revert InvalidAnnounceBlockNumber();
        }

        // 255 is a technical limitation of EVM ability to look into the past.
        // however, we query just for 16 blocks here.
        // this provides a time window big enough for valid nodes.
        if (_blockNumber + 16 <= block.number) {
            revert AnnounceBlockNumberTooOld();
        }

        // we have ensured now that we technicaly able to query the blockhash for that block
        if (blockhash(_blockNumber) != _blockhash) {
            revert InvalidAnnounceBlockHash();
        }

        uint256 timestamp = block.timestamp;
        _writeValidatorAvailableSince(msg.sender, timestamp);

        stakingContract.notifyAvailability(stakingByMiningAddress[msg.sender]);

        emit ValidatorAvailable(msg.sender, timestamp);
    }

    /// @dev called by blockreward contract when a the reward when the block reward contract
    /// came to the conclusion that the validators could not manage to create a new shared key together.
    /// this starts the process to find replacements for the failing candites,
    /// as well as marking them unavailable.
    function handleFailedKeyGeneration() external onlyBlockRewardContract {
        // we should only kick out nodes if the nodes have been really to late.
        if (block.timestamp < stakingContract.stakingFixedEpochEndTime()) {
            revert EpochNotYetzFinished();
        }

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
        address[] memory goodValidators = new address[](_pendingValidators.length - 1);
        uint256 goodValidatorsCount = 0;

        (uint128 numberOfPartsWritten, uint128 numberOfAcksWritten) = keyGenHistoryContract
            .getNumberOfKeyFragmentsWritten();

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
                isGood = keyGenHistoryContract.getPart(miningAddress).length > 0;
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

                // Decrease validator bonus score because of missed Part/ACK
                // Should be called before `removePool` as it's changes pool likelihood
                bonusScoreSystem.penaliseNoKeyWrite(miningAddress);

                stakingContract.removePool(stakingByMiningAddress[miningAddress]);

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
    /// @param _miningAddress The address of the validator which became unavailable.
    function notifyUnavailability(address _miningAddress) external onlyConnectivityTracker {
        stakingContract.removePool(stakingByMiningAddress[_miningAddress]);

        _writeValidatorAvailableSince(_miningAddress, 0);

        emit ValidatorUnavailable(_miningAddress, block.timestamp);
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

    function setMaxValidators(uint256 _maxValidators) external onlyOwner {
        maxValidators = _maxValidators;

        emit SetMaxValidators(_maxValidators);
    }

    /// @dev set's the validators ip address.
    /// this function can only be called by validators.
    /// @param _ip IPV4 address of a running Node Software or Proxy.
    /// @param _port port for IPv4 address of a running Node Software or Proxy.
    function setValidatorInternetAddress(bytes16 _ip, bytes2 _port) external {
        // get stacking address of sender. (required)
        address validatorAddress = stakingByMiningAddress[msg.sender];
        if (validatorAddress == address(0)) {
            revert StakingPoolNotExist(msg.sender);
        }

        // optional: we could verify public key to signer (public key) integrity, but it is costly.
        stakingContract.setValidatorInternetAddress(validatorAddress, _ip, _port);
    }

    // =============================================== Getters ========================================================

    function getStakingContract() external view returns (address) {
        return address(stakingContract);
    }

    function isFullHealth() external view virtual returns (bool) {
        // return maxValidators == _currentValidators.length;
        // for testing purposes we are hardcoding this to true.
        // https://github.com/DMDcoin/hbbft-posdao-contracts/issues/162
        return true;
    }

    function getCurrentValidatorsCount() external view returns (uint256) {
        return _currentValidators.length;
    }

    /// @dev Returns the previous validator set (validators' mining addresses array).
    /// The array is stored by the `finalizeChange` function
    /// when a new staking epoch's validator set is finalized.
    function getPreviousValidators() external view returns (address[] memory) {
        return _previousValidators;
    }

    /// @dev Returns the current array of pending validators i.e. waiting to be activated in the new epoch
    /// The pending array is changed when a validator is removed as malicious
    /// or the validator set is updated by the `newValidatorSet` function.
    function getPendingValidators() external view returns (address[] memory) {
        return _pendingValidators;
    }

    /// @dev Returns the current validator set (an array of mining addresses)
    /// which always matches the validator set kept in validator's node.
    function getValidators() external view returns (address[] memory) {
        return _currentValidators;
    }

    function getPendingValidatorKeyGenerationMode(address _miningAddress) external view returns (KeyGenMode) {
        // enum KeyGenMode { NotAPendingValidator, WritePart, WaitForOtherParts,
        // WriteAck, WaitForOtherAcks, AllKeysDone }

        if (!isPendingValidator(_miningAddress)) {
            return KeyGenMode.NotAPendingValidator;
        }

        // since we got a part, maybe to validator is about to write his ack ?
        // he is allowed to write his ack, if all nodes have written their part.

        (uint128 numberOfPartsWritten, uint128 numberOfAcksWritten) = keyGenHistoryContract
            .getNumberOfKeyFragmentsWritten();

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

    /// @dev Returns a boolean flag indicating whether the specified mining address is a validator
    /// or is in the `_pendingValidators`.
    /// Used by the `StakingHbbft.maxWithdrawAllowed` and `StakingHbbft.maxWithdrawOrderAllowed` getters.
    /// @param _miningAddress The mining address.
    function isValidatorOrPending(address _miningAddress) external view returns (bool) {
        return isValidator[_miningAddress] || isPendingValidator(_miningAddress);
    }

    /// @dev Returns a boolean flag indicating whether the specified mining address is a pending validator.
    /// Used by the `isValidatorOrPending` and `KeyGenHistory.writeAck/Part` functions.
    /// @param _miningAddress The mining address.
    function isPendingValidator(address _miningAddress) public view returns (bool) {
        uint256 length = _pendingValidators.length;
        for (uint256 i = 0; i < length; ++i) {
            if (_miningAddress == _pendingValidators[i]) {
                return true;
            }
        }

        return false;
    }

    /// @dev Returns if the specified _miningAddress is able to announce availability.
    /// @param _miningAddress mining address that is allowed/disallowed.
    function canCallAnnounceAvailability(address _miningAddress) public view returns (bool) {
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

    /// @dev Returns the public key for the given stakingAddress
    /// @param _stakingAddress staking address of the wanted public key.
    /// @return public key of the _stakingAddress
    function publicKeyByStakingAddress(address _stakingAddress) external view returns (bytes memory) {
        return stakingContract.getPoolPublicKey(_stakingAddress);
    }

    /// @dev Returns a boolean flag indicating whether the specified validator unavailable
    /// for `validatorInactivityThreshold` seconds
    /// @param _stakingAddress staking pool address.
    function isValidatorAbandoned(address _stakingAddress) external view returns (bool) {
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
    function getPublicKey(address _miningAddress) external view returns (bytes memory) {
        return stakingContract.getPoolPublicKey(stakingByMiningAddress[_miningAddress]);
    }

    /// @dev in Hbbft there are sweet spots for the choice of validator counts
    /// those are FLOOR((n - 1)/3) * 3 + 1
    /// values: 1 - 4 - 7 - 10 - 13 - 16 - 19 - 22 - 25
    /// more about: https://github.com/DMDcoin/hbbft-posdao-contracts/issues/84
    /// @return a sweet spot n for a given number n
    function getValidatorCountSweetSpot(uint256 _possibleValidatorCount) public pure returns (uint256) {
        if (_possibleValidatorCount == 0) {
            revert InvalidPossibleValidatorCount();
        }

        if (_possibleValidatorCount < 4) {
            return _possibleValidatorCount;
        }

        return ((_possibleValidatorCount - 1) / 3) * 3 + 1;
    }

    // ============================================== Internal ========================================================

    function _newValidatorSet(address[] memory _forcedPools) internal {
        address[] memory poolsToBeElected = stakingContract.getPoolsToBeElected();

        uint256 numOfValidatorsToBeElected = poolsToBeElected.length >= maxValidators || poolsToBeElected.length == 0
            ? maxValidators
            : getValidatorCountSweetSpot(poolsToBeElected.length);

        // Choose new validators > )
        if (poolsToBeElected.length > numOfValidatorsToBeElected) {
            uint256 poolsToBeElectedLength = poolsToBeElected.length;
            (uint256[] memory likelihood, uint256 likelihoodSum) = stakingContract.getPoolsLikelihood();
            address[] memory newValidators = new address[](numOfValidatorsToBeElected);

            uint256 indexNewValidator = 0;
            for (uint256 iForced = 0; iForced < _forcedPools.length; iForced++) {
                for (uint256 iPoolToBeElected = 0; iPoolToBeElected < poolsToBeElectedLength; iPoolToBeElected++) {
                    if (poolsToBeElected[iPoolToBeElected] == _forcedPools[iForced]) {
                        newValidators[indexNewValidator] = _forcedPools[iForced];
                        indexNewValidator++;
                        likelihoodSum -= likelihood[iPoolToBeElected];
                        // kicking out this pools from the "to be elected" list,
                        // by replacing it with the last element,
                        // and virtually reducing it's size.
                        poolsToBeElectedLength--;
                        poolsToBeElected[iPoolToBeElected] = poolsToBeElected[poolsToBeElectedLength];
                        likelihood[iPoolToBeElected] = likelihood[poolsToBeElectedLength];
                        break;
                    }
                }
            }

            uint256 randomNumber = IRandomHbbft(randomContract).currentSeed();

            if (likelihood.length > 0 && likelihoodSum > 0) {
                for (uint256 i = 0; i < newValidators.length; i++) {
                    randomNumber = uint256(keccak256(abi.encode(randomNumber ^ block.timestamp)));
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
            stakingContract.notifyNetworkOfftimeDetected(block.timestamp - stakingContract.stakingFixedEpochEndTime());
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
    function _setPendingValidators(address[] memory _stakingAddresses) internal {
        // clear  the pending validators list first
        delete _pendingValidators;

        if (_stakingAddresses.length == 0) {
            // If there are no `poolsToBeElected`, we remove the
            // validators which want to exit from the validator set
            uint256 curValidatorsLength = _currentValidators.length;
            for (uint256 i = 0; i < curValidatorsLength; ++i) {
                address pvMiningAddress = _currentValidators[i];
                address pvStakingAddress = stakingByMiningAddress[pvMiningAddress];
                if (
                    stakingContract.isPoolActive(pvStakingAddress) &&
                    stakingContract.orderedWithdrawAmount(pvStakingAddress, pvStakingAddress) == 0
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
            uint256 stakingAddresseLength = _stakingAddresses.length;
            for (uint256 i = 0; i < stakingAddresseLength; ++i) {
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
        if (_miningAddress == address(0)) {
            revert ZeroAddress();
        }

        if (_stakingAddress == address(0)) {
            revert ZeroAddress();
        }

        if (_miningAddress == _stakingAddress) {
            revert InvalidAddressPair();
        }

        if (
            miningByStakingAddress[_stakingAddress] != address(0) ||
            stakingByMiningAddress[_stakingAddress] != address(0)
        ) {
            revert StakingAddressAlreadyUsed(_stakingAddress);
        }

        if (
            miningByStakingAddress[_miningAddress] != address(0) || stakingByMiningAddress[_miningAddress] != address(0)
        ) {
            revert MiningAddressAlreadyUsed(_miningAddress);
        }

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

    function _rewardValidatorsStandBy() internal {
        address[] memory poolsToBeElected = stakingContract.getPoolsToBeElected();
        uint256 poolsLength = poolsToBeElected.length;

        for (uint256 i = 0; i < poolsLength; ++i) {
            address mining = miningByStakingAddress[poolsToBeElected[i]];

            // slither-disable-next-line incorrect-equality
            if (isValidator[mining] || validatorAvailableSince[mining] == 0) {
                continue;
            }

            bonusScoreSystem.rewardStandBy(mining, validatorAvailableSince[mining]);
        }
    }

    function _penaliseValidatorsNoStandBy() internal {
        address[] memory poolsInactive = stakingContract.getPoolsInactive();
        uint256 poolsLength = poolsInactive.length;

        for (uint256 i = 0; i < poolsLength; ++i) {
            address mining = miningByStakingAddress[poolsInactive[i]];

            if (validatorAvailableSince[mining] != 0) {
                continue;
            }

            bonusScoreSystem.penaliseNoStandBy(mining, validatorAvailableSinceLastWrite[mining]);
        }
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
        // slither-disable-next-line weak-prng
        uint256 random = _randomNumber % _likelihoodSum;
        uint256 sum = 0;
        uint256 index = 0;
        while (sum <= random) {
            sum += _likelihood[index];
            index++;
        }
        return index - 1;
    }

    function _validateParams(ValidatorSetParams calldata _params) private pure {
        if (
            _params.blockRewardContract == address(0) ||
            _params.randomContract == address(0) ||
            _params.stakingContract == address(0) ||
            _params.keyGenHistoryContract == address(0) ||
            _params.bonusScoreContract == address(0)
        ) {
            revert ZeroAddress();
        }
    }
}
