pragma solidity 0.5.10;

import "./interfaces/IBlockRewardHbbft.sol";
import "./interfaces/IRandomHbbft.sol";
import "./interfaces/IStakingHbbft.sol";
import "./interfaces/IValidatorSetHbbft.sol";
import "./upgradeability/UpgradeabilityAdmin.sol";
import "./libs/SafeMath.sol";


/// @dev Stores the current validator set and contains the logic for choosing new validators
/// before each staking epoch. The logic uses a random seed stored by the `RandomHbbft` contract.
contract ValidatorSetHbbft is UpgradeabilityAdmin, IValidatorSetHbbft {
    using SafeMath for uint256;

    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables and do not change their types!

    address[] internal _currentValidators;
    address[] internal _pendingValidators;
    address[] internal _previousValidators;
    struct ValidatorsList {
        bool forNewEpoch;
        address[] list;
    }
    ValidatorsList internal _finalizeValidators;

    bool internal _pendingValidatorsChanged;
    bool internal _pendingValidatorsChangedForNewEpoch;

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

    /// @dev The `StakingHbbft` contract address.
    IStakingHbbft public stakingContract;

    /// @dev A staking address bound to a specified mining address.
    /// See the `_setStakingAddress` internal function.
    mapping(address => address) public stakingByMiningAddress;

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

    /// @dev Emitted by the `emitInitiateChange` function when a new validator set
    /// needs to be applied by validator nodes. See https://wiki.parity.io/Validator-Set.html
    /// @param parentHash Should be the parent block hash, otherwise the signal won't be recognized.
    /// @param newSet An array of new validators (their mining addresses).
    event InitiateChange(bytes32 indexed parentHash, address[] newSet);

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

    /// @dev Emits the `InitiateChange` event to pass a new validator set to the validator nodes.
    /// Called automatically by one of the current validator's nodes when the `emitInitiateChangeCallable` getter
    /// returns `true` (when some validator needs to be removed as malicious or the validator set needs to be
    /// updated at the beginning of a new staking epoch). The new validator set is passed to the validator nodes
    /// through the `InitiateChange` event and saved for later use by the `finalizeChange` function.
    /// See https://wiki.parity.io/Validator-Set.html for more info about the `InitiateChange` event.
    function emitInitiateChange() external onlyInitialized {
        require(emitInitiateChangeCallable());
        bool forNewEpoch = _unsetPendingValidatorsChanged();
        if (_pendingValidators.length > 0) {
            emit InitiateChange(blockhash(_getCurrentBlockNumber() - 1), _pendingValidators);
            _finalizeValidators.list = _pendingValidators;
            _finalizeValidators.forNewEpoch = forNewEpoch;
        }
    }

    /// @dev Called by the system when an initiated validator set change reaches finality and is activated.
    /// This function is called at the beginning of a block (before all the block transactions).
    /// Only valid when msg.sender == SUPER_USER (EIP96, 2**160 - 2). Stores a new validator set saved
    /// before by the `emitInitiateChange` function and passed through the `InitiateChange` event.
    /// After this function is called, the `getValidators` getter returns the new validator set.
    /// If this function finalizes a new validator set formed by the `newValidatorSet` function,
    /// an old validator set is also stored and can be read by the `getPreviousValidators` getter.
    /// The `finalizeChange` is only called once for each `InitiateChange` event emitted. The next `InitiateChange`
    /// event is not emitted until the previous one is not yet finalized by the `finalizeChange`
    /// (see the code of `emitInitiateChangeCallable` getter).
    function finalizeChange() external onlySystem {
        if (_finalizeValidators.forNewEpoch) {
            // Apply a new validator set formed by the `newValidatorSet` function
            _savePreviousValidators();
            _finalizeNewValidators(true);
            IBlockRewardHbbft(blockRewardContract).clearBlocksCreated();
            validatorSetApplyBlock = _getCurrentBlockNumber();
        } else if (_finalizeValidators.list.length != 0) {
            // Apply the changed validator set after malicious validator is removed
            _finalizeNewValidators(false);
        } else {
            // This is the very first call of the `finalizeChange` (block #1 when starting from genesis)
            validatorSetApplyBlock = _getCurrentBlockNumber();
        }
        delete _finalizeValidators; // since this moment the `emitInitiateChange` is allowed
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
        address[] calldata _initialMiningAddresses,
        address[] calldata _initialStakingAddresses,
        bool _firstValidatorIsUnremovable
    ) external {
        require(_getCurrentBlockNumber() == 0 || msg.sender == _admin());
        require(!isInitialized()); // initialization can only be done once
        require(_blockRewardContract != address(0));
        require(_randomContract != address(0));
        require(_stakingContract != address(0));
        require(_initialMiningAddresses.length > 0);
        require(_initialMiningAddresses.length == _initialStakingAddresses.length);

        blockRewardContract = _blockRewardContract;
        randomContract = _randomContract;
        stakingContract = IStakingHbbft(_stakingContract);

        // Add initial validators to the `_currentValidators` array
        for (uint256 i = 0; i < _initialMiningAddresses.length; i++) {
            address miningAddress = _initialMiningAddresses[i];
            _currentValidators.push(miningAddress);
            _pendingValidators.push(miningAddress);
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
    function newValidatorSet() external onlyBlockRewardContract {
        address[] memory poolsToBeElected = stakingContract.getPoolsToBeElected();

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

        // From this moment the `getPendingValidators()` returns the new validator set.
        // Let the `emitInitiateChange` function know that the validator set is changed and needs
        // to be passed to the `InitiateChange` event.
        _setPendingValidatorsChanged(true);

        if (poolsToBeElected.length != 0) {
            // Remove pools marked as `to be removed`
            stakingContract.removePools();
        }
        stakingContract.incrementStakingEpoch();
        stakingContract.setStakingEpochStartBlock(_getCurrentBlockNumber() + 1);
        validatorSetApplyBlock = 0;
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

    /// @dev Returns a boolean flag indicating whether the `emitInitiateChange` function can be called
    /// at the moment. Used by a validator's node and `TxPermission` contract (to deny dummy calling).
    function emitInitiateChangeCallable() public view returns(bool) {
        return initiateChangeAllowed() && _pendingValidatorsChanged;
    }

    /// @dev Returns the previous validator set (validators' mining addresses array).
    /// The array is stored by the `finalizeChange` function
    /// when a new staking epoch's validator set is finalized.
    function getPreviousValidators() public view returns(address[] memory) {
        return _previousValidators;
    }

    /// @dev Returns the current array of validators which should be passed to the `InitiateChange` event.
    /// The pending array is changed when a validator is removed as malicious
    /// or the validator set is updated by the `newValidatorSet` function.
    /// Every time the pending array is changed, it is marked by the `_setPendingValidatorsChanged` and then
    /// used by the `emitInitiateChange` function which emits the `InitiateChange` event to all
    /// validator nodes.
    function getPendingValidators() public view returns(address[] memory) {
        return _pendingValidators;
    }

    /// @dev Returns the current validator set (an array of mining addresses)
    /// which always matches the validator set kept in validator's node.
    function getValidators() public view returns(address[] memory) {
        return _currentValidators;
    }

    /// @dev A boolean flag indicating whether the `emitInitiateChange` can be called at the moment.
    /// Used by the `emitInitiateChangeCallable` getter. This flag is set to `false` by the `emitInitiateChange`
    /// and set to `true` by the `finalizeChange` function. When the `InitiateChange` event is emitted by
    /// `emitInitiateChange`, the next `emitInitiateChange` call is not possible until the validator set from
    /// the previous call is finalized by the `finalizeChange` function.
    function initiateChangeAllowed() public view returns(bool) {
        return _finalizeValidators.list.length == 0;
    }

    /// @dev Returns a boolean flag indicating if the `initialize` function has been called.
    function isInitialized() public view returns(bool) {
        return blockRewardContract != address(0);
    }

    /// @dev Returns a boolean flag indicating whether the specified mining address is a validator
    /// or is in the `_pendingValidators` or `_finalizeValidators` array.
    /// Used by the `StakingHbbft.maxWithdrawAllowed` and `StakingHbbft.maxWithdrawOrderAllowed` getters.
    /// @param _miningAddress The mining address.
    function isValidatorOrPending(address _miningAddress) public view returns(bool) {
        if (isValidator[_miningAddress]) {
            return true;
        }

        uint256 i;
        uint256 length;

        length = _finalizeValidators.list.length;
        for (i = 0; i < length; i++) {
            if (_miningAddress == _finalizeValidators.list[i]) {
                // This validator waits to be finalized,
                // so we treat them as `pending`
                return true;
            }
        }

        length = _pendingValidators.length;
        for (i = 0; i < length; i++) {
            if (_miningAddress == _pendingValidators[i]) {
                return true;
            }
        }

        return false;
    }

    /// @dev Returns a validator set about to be finalized by the `finalizeChange` function.
    /// @param miningAddresses An array set by the `emitInitiateChange` function.
    /// @param forNewEpoch A boolean flag indicating whether the `miningAddresses` array was formed by the
    /// `newValidatorSet` function. The `finalizeChange` function logic depends on this flag.
    function validatorsToBeFinalized() public view returns(address[] memory miningAddresses, bool forNewEpoch) {
        return (_finalizeValidators.list, _finalizeValidators.forNewEpoch);
    }

    // ============================================== Internal ========================================================

    /// @dev Sets a new validator set stored in `_finalizeValidators.list` array.
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

        _currentValidators = _finalizeValidators.list;

        validators = _currentValidators;
        for (i = 0; i < validators.length; i++) {
            address miningAddress = validators[i];
            isValidator[miningAddress] = true;
            if (_newStakingEpoch) {
                validatorCounter[miningAddress]++;
            }
        }
    }

    /// @dev Marks the pending validator set as changed to be used later by the `emitInitiateChange` function.
    /// @param _newStakingEpoch A boolean flag defining whether the pending validator set was formed by the
    /// `newValidatorSet` function. The `finalizeChange` function logic depends on this flag.
    function _setPendingValidatorsChanged(bool _newStakingEpoch) internal {
        _pendingValidatorsChanged = true;
        if (_newStakingEpoch && _pendingValidators.length != 0) {
            _pendingValidatorsChangedForNewEpoch = true;
        }
        changeRequestCount++;
    }

    /// @dev Marks the pending validator set as unchanged before passing it to the `InitiateChange` event
    /// (and then to the `finalizeChange` function). Called by the `emitInitiateChange` function.
    function _unsetPendingValidatorsChanged() internal returns(bool) {
        bool forNewEpoch = _pendingValidatorsChangedForNewEpoch;
        _pendingValidatorsChanged = false;
        _pendingValidatorsChangedForNewEpoch = false;
        return forNewEpoch;
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

    /// @dev Sets a new validator set as a pending (which is not yet passed to the `InitiateChange` event).
    /// Called by the `newValidatorSet` function.
    /// @param _stakingAddresses The array of the new validators' staking addresses.
    function _setPendingValidators(
        address[] memory _stakingAddresses
    ) internal {
        if (_stakingAddresses.length == 0 && unremovableValidator == address(0)) return;

        delete _pendingValidators;

        if (unremovableValidator != address(0)) {
            _pendingValidators.push(miningByStakingAddress[unremovableValidator]);
        }

        for (uint256 i = 0; i < _stakingAddresses.length; i++) {
            _pendingValidators.push(miningByStakingAddress[_stakingAddresses[i]]);
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
