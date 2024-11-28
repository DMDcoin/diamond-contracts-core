// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import { IBlockRewardHbbft } from "./interfaces/IBlockRewardHbbft.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { IBonusScoreSystem } from "./interfaces/IBonusScoreSystem.sol";

import { Unauthorized, ZeroAddress, ZeroGasPrice } from "./lib/Errors.sol";
import { TransferUtils } from "./utils/TransferUtils.sol";
import { ValueGuards } from "./lib/ValueGuards.sol";

/// @dev Implements staking and withdrawal logic.
// slither-disable-start unused-return
contract StakingHbbft is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, IStakingHbbft, ValueGuards {
    using EnumerableSet for EnumerableSet.AddressSet;

    EnumerableSet.AddressSet private _pools;
    EnumerableSet.AddressSet private _poolsInactive;
    EnumerableSet.AddressSet private _poolsToBeRemoved;

    address[] private _poolsToBeElected;
    uint256[] private _poolsLikelihood;
    uint256 private _poolsLikelihoodSum;

    mapping(address => EnumerableSet.AddressSet) private _poolDelegators;
    mapping(address => EnumerableSet.AddressSet) private _poolDelegatorsInactive;

    mapping(address => mapping(address => mapping(uint256 => uint256))) private _stakeAmountByEpoch;

    /// @dev The limit of the minimum candidate stake (CANDIDATE_MIN_STAKE).
    uint256 public candidateMinStake;

    /// @dev The limit of the minimum delegator stake (DELEGATOR_MIN_STAKE).
    uint256 public delegatorMinStake;

    /// @dev current limit of how many funds can
    /// be staked on a single validator.
    uint256 public maxStakeAmount;

    /// @dev The current amount of staking coins ordered for withdrawal from the specified
    /// pool by the specified staker. Used by the `orderWithdraw`, `claimOrderedWithdraw` and other functions.
    /// The first parameter is the pool staking address, the second one is the staker address.
    mapping(address => mapping(address => uint256)) public orderedWithdrawAmount;

    /// @dev The current total amount of staking coins ordered for withdrawal from
    /// the specified pool by all of its stakers. Pool staking address is accepted as a parameter.
    mapping(address => uint256) public orderedWithdrawAmountTotal;

    /// @dev The number of the staking epoch during which the specified staker ordered
    /// the latest withdraw from the specified pool. Used by the `claimOrderedWithdraw` function
    /// to allow the ordered amount to be claimed only in future staking epochs. The first parameter
    /// is the pool staking address, the second one is the staker address.
    mapping(address => mapping(address => uint256)) public orderWithdrawEpoch;

    /// @dev The pool's index in the array returned by the `getPoolsToBeElected` getter.
    /// Used by the `_deletePoolToBeElected` and `_isPoolToBeElected` internal functions.
    /// The pool staking address is accepted as a parameter.
    /// If the value is zero, it may mean the array doesn't contain the address.
    /// Check the address is in the array using the `getPoolsToBeElected` getter.
    mapping(address => uint256) public poolToBeElectedIndex;

    /// @dev The amount of coins currently staked into the specified pool by the specified
    /// staker. Doesn't include the amount ordered for withdrawal.
    /// The first parameter is the pool staking address, the second one is the staker address.
    mapping(address => mapping(address => uint256)) public stakeAmount;

    /// @dev The duration period (in blocks) at the end of staking epoch during which
    /// participants are not allowed to stake/withdraw/order/claim their staking coins.
    uint256 public stakingWithdrawDisallowPeriod;

    /// @dev The serial number of the current staking epoch.
    uint256 public stakingEpoch;

    /// @dev The fixed duration of each staking epoch before KeyGen starts i.e.
    /// before the upcoming ("pending") validators are selected.
    uint256 public stakingFixedEpochDuration;

    /// @dev Length of the timeframe in seconds for the transition to the new validator set.
    uint256 public stakingTransitionTimeframeLength;

    /// @dev The timestamp of the last block of the the previous epoch.
    /// The timestamp of the current epoch must be '>=' than this.
    uint256 public stakingEpochStartTime;

    /// @dev the blocknumber of the first block in this epoch.
    /// this is mainly used for a historic lookup in the key gen history to read out the
    /// ACKS and PARTS so a client is able to verify an epoch, even in the case that
    /// the transition to the next epoch has already started,
    /// and the information of the old keys is not available anymore.
    uint256 public stakingEpochStartBlock;

    /// @dev the extra time window pending validators have to write
    /// to write their honey badger key shares.
    /// this value is increased in response to a failed key generation event,
    /// if one or more validators miss out writing their key shares.
    uint256 public currentKeyGenExtraTimeWindow;

    /// @dev Returns the total amount of staking coins currently staked into the specified pool.
    /// Doesn't include the amount ordered for withdrawal.
    /// The pool staking address is accepted as a parameter.
    mapping(address => uint256) public stakeAmountTotal;

    /// @dev Returns the total amount of staking coins currently staked on all pools.
    /// Doesn't include the amount ordered for withdrawal.
    uint256 public totalStakedAmount;

    /// @dev The address of the `ValidatorSetHbbft` contract.
    IValidatorSetHbbft public validatorSetContract;

    struct PoolInfo {
        bytes publicKey;
        bytes16 internetAddress;
        bytes2 port;
    }

    mapping(address => PoolInfo) public poolInfo;

    mapping(address => bool) public abandonedAndRemoved;

    /// @dev The total amount staked into the specified pool (staking address)
    /// before the specified staking epoch. Filled by the `_snapshotPoolStakeAmounts` function.
    mapping(uint256 => mapping(address => uint256)) public snapshotPoolTotalStakeAmount;

    /// @dev The validator's amount staked into the specified pool (staking address)
    /// before the specified staking epoch. Filled by the `_snapshotPoolStakeAmounts` function.
    mapping(uint256 => mapping(address => uint256)) public snapshotPoolValidatorStakeAmount;

    /// @dev The delegator's staked amount snapshot for specified epoch
    /// pool => delegator => epoch => stake amount
    mapping(address => mapping(address => mapping(uint256 => uint256))) internal _delegatorStakeSnapshot;

    /// @dev Number of last epoch when stake snapshot was taken. pool => delegator => epoch
    mapping(address => mapping(address => uint256)) internal _stakeSnapshotLastEpoch;

    IBonusScoreSystem public bonusScoreContract;

    /// @dev Address of node operator for specified pool.
    mapping(address => address) public poolNodeOperator;

    /// @dev Node operator share percent of total pool rewards.
    mapping(address => uint256) public poolNodeOperatorShare;

    /// @dev The epoch number in which the operator's address can be changed.
    mapping(address => uint256) public poolNodeOperatorLastChangeEpoch;

    // ============================================== Constants =======================================================

    /// @dev The max number of candidates (including validators). This limit was determined through stress testing.
    uint256 public constant MAX_CANDIDATES = 3000;

    uint256 public constant MAX_NODE_OPERATOR_SHARE_PERCENT = 2000;
    uint256 public constant PERCENT_DENOMINATOR = 10000;

    // ================================================ Events ========================================================

    /// @dev Emitted by the `claimOrderedWithdraw` function to signal the staker withdrew the specified
    /// amount of requested coins from the specified pool during the specified staking epoch.
    /// @param fromPoolStakingAddress The pool from which the `staker` withdrew the `amount`.
    /// @param staker The address of the staker that withdrew the `amount`.
    /// @param stakingEpoch The serial number of the staking epoch during which the claim was made.
    /// @param amount The withdrawal amount.
    event ClaimedOrderedWithdrawal(
        address indexed fromPoolStakingAddress,
        address indexed staker,
        uint256 indexed stakingEpoch,
        uint256 amount
    );

    /// @dev Emitted by the `moveStake` function to signal the staker moved the specified
    /// amount of stake from one pool to another during the specified staking epoch.
    /// @param fromPoolStakingAddress The pool from which the `staker` moved the stake.
    /// @param toPoolStakingAddress The destination pool where the `staker` moved the stake.
    /// @param staker The address of the staker who moved the `amount`.
    /// @param stakingEpoch The serial number of the staking epoch during which the `amount` was moved.
    /// @param amount The stake amount which was moved.
    event MovedStake(
        address fromPoolStakingAddress,
        address indexed toPoolStakingAddress,
        address indexed staker,
        uint256 indexed stakingEpoch,
        uint256 amount
    );

    /// @dev Emitted by the `orderWithdraw` function to signal the staker ordered the withdrawal of the
    /// specified amount of their stake from the specified pool during the specified staking epoch.
    /// @param fromPoolStakingAddress The pool from which the `staker` ordered a withdrawal of the `amount`.
    /// @param staker The address of the staker that ordered the withdrawal of the `amount`.
    /// @param stakingEpoch The serial number of the staking epoch during which the order was made.
    /// @param amount The ordered withdrawal amount. Can be either positive or negative.
    /// See the `orderWithdraw` function.
    event OrderedWithdrawal(
        address indexed fromPoolStakingAddress,
        address indexed staker,
        uint256 indexed stakingEpoch,
        int256 amount
    );

    /// @dev Emitted by the `stake` function to signal the staker placed a stake of the specified
    /// amount for the specified pool during the specified staking epoch.
    /// @param toPoolStakingAddress The pool in which the `staker` placed the stake.
    /// @param staker The address of the staker that placed the stake.
    /// @param stakingEpoch The serial number of the staking epoch during which the stake was made.
    /// @param amount The stake amount.
    event PlacedStake(
        address indexed toPoolStakingAddress,
        address indexed staker,
        uint256 indexed stakingEpoch,
        uint256 amount
    );

    /// @dev Emitted by the `withdraw` function to signal the staker withdrew the specified
    /// amount of a stake from the specified pool during the specified staking epoch.
    /// @param fromPoolStakingAddress The pool from which the `staker` withdrew the `amount`.
    /// @param staker The address of staker that withdrew the `amount`.
    /// @param stakingEpoch The serial number of the staking epoch during which the withdrawal was made.
    /// @param amount The withdrawal amount.
    event WithdrewStake(
        address indexed fromPoolStakingAddress,
        address indexed staker,
        uint256 indexed stakingEpoch,
        uint256 amount
    );

    event GatherAbandonedStakes(address indexed caller, address indexed stakingAddress, uint256 gatheredFunds);

    event RecoverAbandonedStakes(address indexed caller, uint256 reinsertShare, uint256 governanceShare);

    /// @dev Emitted by the `restake` function to signal the epoch reward was restaked to the pool.
    /// @param poolStakingAddress The pool for which the restake will be performed.
    /// @param stakingEpoch The serial number of the staking epoch during which the restake was made.
    /// @param validatorReward The amount of tokens restaked for the validator.
    /// @param delegatorsReward The total amount of tokens restaked for the `poolStakingAddress` delegators.
    event RestakeReward(
        address indexed poolStakingAddress,
        uint256 indexed stakingEpoch,
        uint256 validatorReward,
        uint256 delegatorsReward
    );

    /// @dev Emitted by the `_setNodeOperator` function.
    /// @param poolStakingAddress The pool for which node operator was configured.
    /// @param nodeOperatorAddress Address of node operator address related to `poolStakingAddress`.
    /// @param operatorShare Node operator share percent.
    event SetNodeOperator(
        address indexed poolStakingAddress,
        address indexed nodeOperatorAddress,
        uint256 operatorShare
    );

    /**
     * @dev Emitted when the minimum stake for a delegator is updated.
     * @param minStake The new minimum stake value.
     */
    event SetDelegatorMinStake(uint256 minStake);

    /**
     * @dev Emitted when the BonusScoreSystem contract address is changed.
     * @param _address BonusScoreSystem contract address.
     */
    event SetBonusScoreContract(address _address);

    // ============================================== Errors =======================================================
    error CannotClaimWithdrawOrderYet(address pool, address staker);
    error OnlyOncePerEpoch(uint256 _epoch);
    error MaxPoolsCountExceeded();
    error MaxAllowedWithdrawExceeded(uint256 allowed, uint256 desired);
    error NoStakesToRecover();
    error NotPayable();
    error PoolAbandoned(address pool);
    error PoolCannotBeRemoved(address pool);
    error PoolEmpty(address pool);
    error PoolNotExist(address pool);
    error PoolStakeLimitExceeded(address pool, address delegator);
    error InitialStakingPoolsListEmpty();
    error InsufficientStakeAmount(address pool, address delegator);
    error InvalidFixedEpochDuration();
    error InvalidInitialStakeAmount(uint256 candidateStake, uint256 delegatorStake);
    error InvalidIpAddressesCount();
    error InvalidMaxStakeAmount();
    error InvalidMoveStakePoolsAddress();
    error InvalidOrderWithdrawAmount(address pool, address delegator, int256 amount);
    error InvalidPublicKeysCount();
    error InvalidStakingTransitionTimeframe();
    error InvalidStakingFixedEpochDuration();
    error InvalidTransitionTimeFrame();
    error InvalidWithdrawAmount(address pool, address delegator, uint256 amount);
    error InvalidNodeOperatorConfiguration(address _operator, uint256 _share);
    error InvalidNodeOperatorShare(uint256 _share);
    error WithdrawNotAllowed();
    error ZeroWidthrawAmount();
    error ZeroWidthrawDisallowPeriod();

    // ============================================== Modifiers =======================================================

    /// @dev Ensures the transaction gas price is not zero.
    modifier gasPriceIsValid() {
        if (tx.gasprice == 0) {
            revert ZeroGasPrice();
        }
        _;
    }

    /// @dev Ensures the caller is the ValidatorSetHbbft contract address.
    modifier onlyValidatorSetContract() virtual {
        if (msg.sender != address(validatorSetContract)) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyBlockRewardContract() {
        if (msg.sender != validatorSetContract.blockRewardContract()) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyBonusScoreContract() {
        if (msg.sender != address(bonusScoreContract)) {
            revert Unauthorized();
        }
        _;
    }

    // =============================================== Setters ========================================================

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    /// @dev Fallback function. Prevents direct sending native coins to this contract.
    receive() external payable {
        revert NotPayable();
    }

    /// @dev Initializes the network parameters.
    /// Can only be called by the constructor of the `InitializerHbbft` contract or owner.
    /// @param _contractOwner The address of the contract owner
    /// @param stakingParams stores other parameters due to stack too deep issue
    ///  _validatorSetContract The address of the `ValidatorSetHbbft` contract.
    ///  _initialStakingAddresses The array of initial validators' staking addresses.
    ///  _delegatorMinStake The minimum allowed amount of delegator stake in Wei.
    ///  _candidateMinStake The minimum allowed amount of candidate/validator stake in Wei.
    ///  _stakingFixedEpochDuration The fixed duration of each epoch before keyGen starts.
    ///  _stakingTransitionTimeframeLength Length of the timeframe in seconds for the transition
    /// to the new validator set.
    ///  _stakingWithdrawDisallowPeriod The duration period at the end of a staking epoch
    /// during which participants cannot stake/withdraw/order/claim their staking coins
    function initialize(
        address _contractOwner,
        StakingParams calldata stakingParams,
        bytes32[] calldata _publicKeys,
        bytes16[] calldata _internetAddresses
    ) external initializer {
        if (_contractOwner == address(0)) {
            revert ZeroAddress();
        }

        _validateStakingParams(stakingParams);

        if (stakingParams._initialStakingAddresses.length * 2 != _publicKeys.length) {
            revert InvalidPublicKeysCount();
        }

        if (stakingParams._initialStakingAddresses.length != _internetAddresses.length) {
            revert InvalidIpAddressesCount();
        }

        __Ownable_init(_contractOwner);
        __ReentrancyGuard_init();

        validatorSetContract = IValidatorSetHbbft(stakingParams._validatorSetContract);
        bonusScoreContract = IBonusScoreSystem(stakingParams._bonusScoreContract);

        address[] calldata initStakingAddresses = stakingParams._initialStakingAddresses;

        for (uint256 i = 0; i < initStakingAddresses.length; ++i) {
            if (initStakingAddresses[i] == address(0)) {
                revert ZeroAddress();
            }

            _addPoolActive(initStakingAddresses[i], false);
            _addPoolToBeRemoved(initStakingAddresses[i]);

            poolInfo[initStakingAddresses[i]].publicKey = abi.encodePacked(_publicKeys[i * 2], _publicKeys[i * 2 + 1]);
            poolInfo[initStakingAddresses[i]].internetAddress = _internetAddresses[i];
        }

        uint256[] memory delegatorMinStakeAllowedParams = new uint256[](5);
        delegatorMinStakeAllowedParams[0] = 50 ether;
        delegatorMinStakeAllowedParams[1] = 100 ether;
        delegatorMinStakeAllowedParams[2] = 150 ether;
        delegatorMinStakeAllowedParams[3] = 200 ether;
        delegatorMinStakeAllowedParams[4] = 250 ether;

        __initAllowedChangeableParameter(
            this.setDelegatorMinStake.selector,
            this.delegatorMinStake.selector,
            delegatorMinStakeAllowedParams
        );

        delegatorMinStake = stakingParams._delegatorMinStake;
        candidateMinStake = stakingParams._candidateMinStake;

        maxStakeAmount = stakingParams._maxStake;

        stakingFixedEpochDuration = stakingParams._stakingFixedEpochDuration;
        stakingWithdrawDisallowPeriod = stakingParams._stakingWithdrawDisallowPeriod;

        // note: this might be still 0 when created in the genesis block.
        stakingEpochStartTime = block.timestamp;
        stakingTransitionTimeframeLength = stakingParams._stakingTransitionTimeframeLength;
    }

    function setStakingTransitionTimeframeLength(uint256 _value) external onlyOwner {
        if (_value <= 10 || _value >= stakingFixedEpochDuration) {
            revert InvalidStakingTransitionTimeframe();
        }

        stakingTransitionTimeframeLength = _value;
    }

    function setStakingFixedEpochDuration(uint256 _value) external onlyOwner {
        if (_value <= stakingTransitionTimeframeLength) {
            revert InvalidStakingFixedEpochDuration();
        }

        stakingFixedEpochDuration = _value;
    }

    /**
     * @dev Sets the minimum stake required for delegators.
     * @param _minStake The new minimum stake amount.
     * Requirements:
     * - Only the contract owner can call this function.
     * - The stake amount must be within the allowed range.
     *
     * Emits a {SetDelegatorMinStake} event.
     */
    function setDelegatorMinStake(uint256 _minStake) external onlyOwner withinAllowedRange(_minStake) {
        delegatorMinStake = _minStake;

        emit SetDelegatorMinStake(_minStake);
    }

    /// @dev Sets the timetamp of the current epoch's last block as the start time of the upcoming staking epoch.
    /// Called by the `ValidatorSetHbbft.newValidatorSet` function at the last block of a staking epoch.
    /// @param _timestamp The starting time of the very first block in the upcoming staking epoch.
    function setStakingEpochStartTime(uint256 _timestamp) external onlyValidatorSetContract {
        stakingEpochStartTime = _timestamp;
        stakingEpochStartBlock = block.number;
    }

    /// @dev set's the validators ip address.
    /// this function can only be called by the validator Set contract.
    /// @param _validatorAddress address if the validator. (mining address)
    /// @param _ip IPV4 address of a running Node Software or Proxy.
    function setValidatorInternetAddress(
        address _validatorAddress,
        bytes16 _ip,
        bytes2 _port
    ) external onlyValidatorSetContract {
        poolInfo[_validatorAddress].internetAddress = _ip;
        poolInfo[_validatorAddress].port = _port;
    }

    function setBonusScoreContract(address _bonusScoreContract) external onlyOwner {
        if (_bonusScoreContract == address(0)) {
            revert ZeroAddress();
        }

        bonusScoreContract = IBonusScoreSystem(_bonusScoreContract);

        emit SetBonusScoreContract(_bonusScoreContract);
    }

    /// @dev Increments the serial number of the current staking epoch.
    /// Called by the `ValidatorSetHbbft.newValidatorSet` at the last block of the finished staking epoch.
    function incrementStakingEpoch() external onlyValidatorSetContract {
        stakingEpoch++;
        currentKeyGenExtraTimeWindow = 0;
    }

    /// @dev Notifies hbbft staking contract that the
    /// key generation has failed, and a new round
    /// of keygeneration starts.
    function notifyKeyGenFailed() public onlyValidatorSetContract {
        // we allow a extra time window for the current key generation
        // equal in the size of the usual transition timeframe.
        currentKeyGenExtraTimeWindow += stakingTransitionTimeframeLength;
    }

    /// @dev Notifies hbbft staking contract about a detected
    /// network offline time.
    /// if there is no handling for this,
    /// validators got chosen outside the transition timewindow
    /// and get banned immediatly, since they never got their chance
    /// to write their keys.
    /// more about: https://github.com/DMDcoin/hbbft-posdao-contracts/issues/96
    function notifyNetworkOfftimeDetected(uint256 detectedOfflineTime) public onlyValidatorSetContract {
        currentKeyGenExtraTimeWindow =
            currentKeyGenExtraTimeWindow +
            detectedOfflineTime +
            stakingTransitionTimeframeLength;
    }

    /// @dev Notifies hbbft staking contract that a validator
    /// asociated with the given `_stakingAddress` became
    /// available again and can be put on to the list
    /// of available nodes again.
    function notifyAvailability(address _stakingAddress) public onlyValidatorSetContract {
        if (stakeAmount[_stakingAddress][_stakingAddress] >= candidateMinStake) {
            _addPoolActive(_stakingAddress, true);
            _setLikelihood(_stakingAddress);
        }
    }

    /// @dev Adds a new candidate's pool to the list of active pools (see the `getPools` getter) and
    /// moves the specified amount of staking coins from the candidate's staking address
    /// to the candidate's pool. A participant calls this function using their staking address when
    /// they want to create a pool. This is a wrapper for the `stake` function.
    /// @param _miningAddress The mining address of the candidate. The mining address is bound to the staking address
    /// (msg.sender). This address cannot be equal to `msg.sender`.
    /// @param _nodeOperatorAddress Address of node operator, will receive `_operatorShare` of epoch rewards.
    /// @param _operatorShare Percent of epoch rewards to send to `_nodeOperatorAddress`.
    /// Integer value with 2 decimal places, e.g. 1% = 100, 10.25% = 1025.
    function addPool(
        address _miningAddress,
        address _nodeOperatorAddress,
        uint256 _operatorShare,
        bytes calldata _publicKey,
        bytes16 _ip
    ) external payable gasPriceIsValid {
        address stakingAddress = msg.sender;
        uint256 amount = msg.value;
        validatorSetContract.setStakingAddress(_miningAddress, stakingAddress);
        // The staking address and the staker are the same.
        poolInfo[stakingAddress].publicKey = _publicKey;
        poolInfo[stakingAddress].internetAddress = _ip;

        _setNodeOperator(stakingAddress, _nodeOperatorAddress, _operatorShare);

        _stake(stakingAddress, stakingAddress, amount);

        emit PlacedStake(stakingAddress, stakingAddress, stakingEpoch, amount);
    }

    /// @dev Removes the candidate's or validator's pool from the `pools` array (a list of active pools which
    /// can be retrieved by the `getPools` getter). When a candidate or validator wants to remove their pool,
    /// they should call this function from their staking address.
    function removeMyPool() external gasPriceIsValid {
        address stakingAddress = msg.sender;
        address miningAddress = validatorSetContract.miningByStakingAddress(stakingAddress);

        // initial validator cannot remove their pool during the initial staking epoch
        if (stakingEpoch == 0 && validatorSetContract.isValidator(miningAddress)) {
            revert PoolCannotBeRemoved(stakingAddress);
        }

        _removePool(stakingAddress);
    }

    /// @dev set's the pool info for a specific ethereum address.
    /// @param _publicKey public key of the (future) signing address.
    /// @param _ip (optional) IPV4 address of a running Node Software or Proxy.
    /// @param _port (optional) port of IPv4 address of a running Node Software or Proxy.
    /// Stores the supplied data for a staking (pool) address.
    /// This function is external available without security checks,
    /// since no array operations are used in the implementation,
    /// this allows the flexibility to set the pool information before
    /// adding the stake to the pool.
    function setPoolInfo(bytes calldata _publicKey, bytes16 _ip, bytes2 _port) external {
        poolInfo[msg.sender].publicKey = _publicKey;
        poolInfo[msg.sender].internetAddress = _ip;
        poolInfo[msg.sender].port = _port;
    }

    /// @dev Set's the pool node operator configuration for a specific ethereum address.
    /// @param _operatorAddress Node operator address.
    /// @param _operatorShare Node operator reward share percent.
    function setNodeOperator(address _operatorAddress, uint256 _operatorShare) external {
        if (validatorSetContract.miningByStakingAddress(msg.sender) == address(0)) {
            revert PoolNotExist(msg.sender);
        }

        _setNodeOperator(msg.sender, _operatorAddress, _operatorShare);
    }

    /// @dev Removes a specified pool from the `pools` array (a list of active pools which can be retrieved by the
    /// `getPools` getter). Called by the `ValidatorSetHbbft._removeMaliciousValidator` internal function,
    /// and the `ValidatorSetHbbft.handleFailedKeyGeneration` function
    /// when a pool must be removed by the algorithm.
    /// @param _stakingAddress The staking address of the pool to be removed.
    function removePool(address _stakingAddress) external onlyValidatorSetContract {
        _removePool(_stakingAddress);
    }

    /// @dev Removes pools which are in the `_poolsToBeRemoved` internal array from the `pools` array.
    /// Called by the `ValidatorSetHbbft.newValidatorSet` function when a pool must be removed by the algorithm.
    function removePools() external onlyValidatorSetContract {
        address[] memory poolsToRemove = _poolsToBeRemoved.values();
        for (uint256 i = 0; i < poolsToRemove.length; i++) {
            _removePool(poolsToRemove[i]);
        }
    }

    /// @dev Moves the specified amount of staking coins from the staker's address to the staking address of
    /// the specified pool. Actually, the amount is stored in a balance of this StakingHbbft contract.
    /// A staker calls this function when they want to make a stake into a pool.
    /// @param _toPoolStakingAddress The staking address of the pool where the coins should be staked.
    function stake(address _toPoolStakingAddress) external payable gasPriceIsValid {
        address staker = msg.sender;
        uint256 amount = msg.value;
        _stake(_toPoolStakingAddress, staker, amount);

        emit PlacedStake(_toPoolStakingAddress, staker, stakingEpoch, amount);
    }

    /// @dev Moves the specified amount of staking coins from the staking address of
    /// the specified pool to the staker's address. A staker calls this function when they want to withdraw
    /// their coins.
    /// @param _fromPoolStakingAddress The staking address of the pool from which the coins should be withdrawn.
    /// @param _amount The amount of coins to be withdrawn. The amount cannot exceed the value returned
    /// by the `maxWithdrawAllowed` getter.
    function withdraw(address _fromPoolStakingAddress, uint256 _amount) external gasPriceIsValid nonReentrant {
        address payable staker = payable(msg.sender);
        _withdraw(_fromPoolStakingAddress, staker, _amount);
        TransferUtils.transferNative(staker, _amount);
        emit WithdrewStake(_fromPoolStakingAddress, staker, stakingEpoch, _amount);
    }

    /// @dev Moves staking coins from one pool to another. A staker calls this function when they want
    /// to move their coins from one pool to another without withdrawing their coins.
    /// @param _fromPoolStakingAddress The staking address of the source pool.
    /// @param _toPoolStakingAddress The staking address of the target pool.
    /// @param _amount The amount of staking coins to be moved. The amount cannot exceed the value returned
    /// by the `maxWithdrawAllowed` getter.
    function moveStake(
        address _fromPoolStakingAddress,
        address _toPoolStakingAddress,
        uint256 _amount
    ) external gasPriceIsValid {
        if (_fromPoolStakingAddress == _toPoolStakingAddress) {
            revert InvalidMoveStakePoolsAddress();
        }

        address staker = msg.sender;
        _withdraw(_fromPoolStakingAddress, staker, _amount);
        _stake(_toPoolStakingAddress, staker, _amount);

        emit MovedStake(_fromPoolStakingAddress, _toPoolStakingAddress, staker, stakingEpoch, _amount);
    }

    function restake(
        address _poolStakingAddress,
        uint256 _validatorMinRewardPercent
    ) external payable onlyBlockRewardContract {
        // msg.value is a pool reward
        if (msg.value == 0) {
            return;
        }

        uint256 poolReward = msg.value;
        uint256 totalStake = snapshotPoolTotalStakeAmount[stakingEpoch][_poolStakingAddress];

        PoolRewardShares memory shares = _splitPoolReward(_poolStakingAddress, poolReward, _validatorMinRewardPercent);

        address[] memory delegators = poolDelegators(_poolStakingAddress);
        for (uint256 i = 0; i < delegators.length; ++i) {
            uint256 delegatorReward = (shares.delegatorsShare *
                _getDelegatorStake(stakingEpoch, _poolStakingAddress, delegators[i])) / totalStake;

            stakeAmount[_poolStakingAddress][delegators[i]] += delegatorReward;
            _stakeAmountByEpoch[_poolStakingAddress][delegators[i]][stakingEpoch] += delegatorReward;
        }

        if (shares.nodeOperatorShare != 0) {
            _rewardNodeOperator(_poolStakingAddress, shares.nodeOperatorShare);
        }

        stakeAmount[_poolStakingAddress][_poolStakingAddress] += shares.validatorShare;

        stakeAmountTotal[_poolStakingAddress] += poolReward;
        totalStakedAmount += poolReward;

        _setLikelihood(_poolStakingAddress);

        emit RestakeReward(
            _poolStakingAddress,
            stakingEpoch,
            shares.validatorShare,
            poolReward - shares.validatorShare
        );
    }

    /// @dev Orders coins withdrawal from the staking address of the specified pool to the
    /// staker's address. The requested coins can be claimed after the current staking epoch is complete using
    /// the `claimOrderedWithdraw` function.
    /// @param _poolStakingAddress The staking address of the pool from which the amount will be withdrawn.
    /// @param _amount The amount to be withdrawn. A positive value means the staker wants to either set or
    /// increase their withdrawal amount. A negative value means the staker wants to decrease a
    /// withdrawal amount that was previously set. The amount cannot exceed the value returned by the
    /// `maxWithdrawOrderAllowed` getter.
    function orderWithdraw(address _poolStakingAddress, int256 _amount) external gasPriceIsValid {
        if (_poolStakingAddress == address(0)) {
            revert ZeroAddress();
        }

        if (_amount == 0) {
            revert ZeroWidthrawAmount();
        }

        address staker = msg.sender;

        if (!areStakeAndWithdrawAllowed()) {
            revert WithdrawNotAllowed();
        }

        uint256 newOrderedAmount = orderedWithdrawAmount[_poolStakingAddress][staker];
        uint256 newOrderedAmountTotal = orderedWithdrawAmountTotal[_poolStakingAddress];
        uint256 newStakeAmount = stakeAmount[_poolStakingAddress][staker];
        uint256 newStakeAmountTotal = stakeAmountTotal[_poolStakingAddress];
        if (_amount > 0) {
            uint256 amount = uint256(_amount);

            // How much can `staker` order for withdrawal from `_poolStakingAddress` at the moment?
            uint256 allowedWithdraw = maxWithdrawOrderAllowed(_poolStakingAddress, staker);
            if (amount > allowedWithdraw) {
                revert MaxAllowedWithdrawExceeded(allowedWithdraw, amount);
            }

            newOrderedAmount = newOrderedAmount + amount;
            newOrderedAmountTotal = newOrderedAmountTotal + amount;
            newStakeAmount = newStakeAmount - amount;
            newStakeAmountTotal = newStakeAmountTotal - amount;
            totalStakedAmount -= amount;
            orderWithdrawEpoch[_poolStakingAddress][staker] = stakingEpoch;
        } else {
            uint256 amount = uint256(-_amount);
            newOrderedAmount = newOrderedAmount - amount;
            newOrderedAmountTotal = newOrderedAmountTotal - amount;
            newStakeAmount = newStakeAmount + amount;
            newStakeAmountTotal = newStakeAmountTotal + amount;
            totalStakedAmount += amount;
        }
        orderedWithdrawAmount[_poolStakingAddress][staker] = newOrderedAmount;
        orderedWithdrawAmountTotal[_poolStakingAddress] = newOrderedAmountTotal;
        stakeAmount[_poolStakingAddress][staker] = newStakeAmount;
        stakeAmountTotal[_poolStakingAddress] = newStakeAmountTotal;

        if (staker == _poolStakingAddress) {
            // The amount to be withdrawn must be the whole staked amount or
            // must not exceed the diff between the entire amount and `candidateMinStake`
            if (newStakeAmount != 0 && newStakeAmount < candidateMinStake) {
                revert InvalidOrderWithdrawAmount(_poolStakingAddress, staker, _amount);
            }

            if (_amount > 0) {
                // if the validator orders the `_amount` for withdrawal
                if (newStakeAmount == 0) {
                    // If the validator orders their entire stake,
                    // mark their pool as `to be removed`
                    _addPoolToBeRemoved(_poolStakingAddress);
                }
            } else {
                // If the validator wants to reduce withdrawal value,
                // add their pool as `active` if it hasn't been already done.
                _addPoolActive(_poolStakingAddress, true);
            }
        } else {
            // The amount to be withdrawn must be the whole staked amount or
            // must not exceed the diff between the entire amount and `delegatorMinStake`
            if (newStakeAmount != 0 && newStakeAmount < delegatorMinStake) {
                revert InvalidOrderWithdrawAmount(_poolStakingAddress, staker, _amount);
            }

            if (_amount > 0) {
                // if the delegator orders the `_amount` for withdrawal
                if (newStakeAmount == 0) {
                    // If the delegator orders their entire stake,
                    // remove the delegator from delegator list of the pool
                    _removePoolDelegator(_poolStakingAddress, staker);
                }
            } else {
                // If the delegator wants to reduce withdrawal value,
                // add them to delegator list of the pool if it hasn't already done
                _addPoolDelegator(_poolStakingAddress, staker);
            }

            // Remember stake movement to use it later in the `claimReward` function
            // _snapshotDelegatorStake(_poolStakingAddress, staker);
        }

        _setLikelihood(_poolStakingAddress);

        emit OrderedWithdrawal(_poolStakingAddress, staker, stakingEpoch, _amount);
    }

    /// @dev Withdraws the staking coins from the specified pool ordered during the previous staking epochs with
    /// the `orderWithdraw` function. The ordered amount can be retrieved by the `orderedWithdrawAmount` getter.
    /// @param _poolStakingAddress The staking address of the pool from which the ordered coins are withdrawn.
    function claimOrderedWithdraw(address _poolStakingAddress) external gasPriceIsValid nonReentrant {
        address payable staker = payable(msg.sender);

        if (stakingEpoch <= orderWithdrawEpoch[_poolStakingAddress][staker]) {
            revert CannotClaimWithdrawOrderYet(_poolStakingAddress, staker);
        }

        if (!areStakeAndWithdrawAllowed()) {
            revert WithdrawNotAllowed();
        }

        uint256 claimAmount = orderedWithdrawAmount[_poolStakingAddress][staker];
        if (claimAmount == 0) {
            revert ZeroWidthrawAmount();
        }

        orderedWithdrawAmount[_poolStakingAddress][staker] = 0;
        orderedWithdrawAmountTotal[_poolStakingAddress] = orderedWithdrawAmountTotal[_poolStakingAddress] - claimAmount;

        if (stakeAmount[_poolStakingAddress][staker] == 0) {
            _withdrawCheckPool(_poolStakingAddress, staker);
        }

        TransferUtils.transferNative(staker, claimAmount);

        emit ClaimedOrderedWithdrawal(_poolStakingAddress, staker, stakingEpoch, claimAmount);
    }

    /// @dev Distribute abandoned stakes among Reinsert and Governance pots.
    /// 50% goes to reinsert and 50% to governance pot.
    /// Coins are considered abandoned if they were staked on a validator inactive for 10 years.
    function recoverAbandonedStakes() external gasPriceIsValid {
        uint256 totalAbandonedAmount = 0;

        address[] memory inactivePools = _poolsInactive.values();
        if (inactivePools.length == 0) {
            revert NoStakesToRecover();
        }

        for (uint256 i = 0; i < inactivePools.length; ++i) {
            address stakingAddress = inactivePools[i];

            if (_isPoolEmpty(stakingAddress) || !validatorSetContract.isValidatorAbandoned(stakingAddress)) {
                continue;
            }

            _poolsInactive.remove(stakingAddress);
            abandonedAndRemoved[stakingAddress] = true;

            uint256 gatheredPerStakingAddress = stakeAmountTotal[stakingAddress];
            stakeAmountTotal[stakingAddress] = 0;
            totalStakedAmount -= gatheredPerStakingAddress;

            address[] memory delegators = poolDelegators(stakingAddress);
            for (uint256 j = 0; j < delegators.length; ++j) {
                address delegator = delegators[j];

                stakeAmount[stakingAddress][delegator] = 0;
                _removePoolDelegator(stakingAddress, delegator);
            }

            totalAbandonedAmount += gatheredPerStakingAddress;

            emit GatherAbandonedStakes(msg.sender, stakingAddress, gatheredPerStakingAddress);
        }

        if (totalAbandonedAmount == 0) {
            revert NoStakesToRecover();
        }

        uint256 governanceShare = totalAbandonedAmount / 2;
        uint256 reinsertShare = totalAbandonedAmount - governanceShare;

        IBlockRewardHbbft blockRewardHbbft = IBlockRewardHbbft(validatorSetContract.blockRewardContract());
        address governanceAddress = blockRewardHbbft.getGovernanceAddress();

        // slither-disable-next-line arbitrary-send-eth
        blockRewardHbbft.addToReinsertPot{ value: reinsertShare }();
        TransferUtils.transferNative(governanceAddress, governanceShare);

        emit RecoverAbandonedStakes(msg.sender, reinsertShare, governanceShare);
    }

    /// @dev Makes snapshots of total amount staked into the specified pool
    /// before the specified staking epoch. Used by the `reward` function.
    /// @param _epoch The number of upcoming staking epoch.
    /// @param _stakingPool The staking address of the pool.
    function snapshotPoolStakeAmounts(uint256 _epoch, address _stakingPool) external onlyBlockRewardContract {
        if (snapshotPoolTotalStakeAmount[_epoch][_stakingPool] != 0) {
            return;
        }

        uint256 totalAmount = stakeAmountTotal[_stakingPool];
        if (totalAmount == 0) {
            return;
        }

        snapshotPoolTotalStakeAmount[_epoch][_stakingPool] = totalAmount;
        snapshotPoolValidatorStakeAmount[_epoch][_stakingPool] = stakeAmount[_stakingPool][_stakingPool];
    }

    function updatePoolLikelihood(address mining, uint256 validatorScore) external onlyBonusScoreContract {
        address stakingAddress = validatorSetContract.stakingByMiningAddress(mining);

        _updateLikelihood(stakingAddress, validatorScore);
    }

    // =============================================== Getters ========================================================

    /// @dev Returns an array of the current active pools (the staking addresses of candidates and validators).
    /// The size of the array cannot exceed MAX_CANDIDATES. A pool can be added to this array with the `_addPoolActive`
    /// internal function which is called by the `stake` or `orderWithdraw` function. A pool is considered active
    /// if its address has at least the minimum stake and this stake is not ordered to be withdrawn.
    function getPools() external view returns (address[] memory) {
        return _pools.values();
    }

    /// @dev Return the Public Key used by a Node to send targeted HBBFT Consensus Messages.
    /// @param _poolAddress The Pool Address to query the public key for.
    /// @return the public key for the given pool address.
    /// Note that the public key does not convert to the ethereum address of the pool address.
    /// The pool address is used for stacking, and not for signing HBBFT messages.
    function getPoolPublicKey(address _poolAddress) external view returns (bytes memory) {
        return poolInfo[_poolAddress].publicKey;
    }

    /// @dev Returns the registered IPv4 Address for the node.
    /// @param _poolAddress The Pool Address to query the IPv4Address for.
    /// @return IPv4 Address for the given pool address.
    function getPoolInternetAddress(address _poolAddress) external view returns (bytes16, bytes2) {
        return (poolInfo[_poolAddress].internetAddress, poolInfo[_poolAddress].port);
    }

    /// @dev Returns an array of the current inactive pools (the staking addresses of former candidates).
    /// A pool can be added to this array with the `_addPoolInactive` internal function which is called
    /// by `_removePool`. A pool is considered inactive if it is banned for some reason, if its address
    /// has zero stake, or if its entire stake is ordered to be withdrawn.
    function getPoolsInactive() external view returns (address[] memory) {
        return _poolsInactive.values();
    }

    /// @dev Returns the array of stake amounts for each corresponding
    /// address in the `poolsToBeElected` array (see the `getPoolsToBeElected` getter) and a sum of these amounts.
    /// Used by the `ValidatorSetHbbft.newValidatorSet` function when randomly selecting new validators at the last
    /// block of a staking epoch. An array value is updated every time any staked amount is changed in this pool
    /// (see the `_setLikelihood` internal function).
    /// @return likelihoods `uint256[] likelihoods` - The array of the coefficients. The array length is always equal
    /// to the length of the `poolsToBeElected` array.
    /// `uint256 sum` - The total sum of the amounts.
    function getPoolsLikelihood() external view returns (uint256[] memory likelihoods, uint256 sum) {
        return (_poolsLikelihood, _poolsLikelihoodSum);
    }

    /// @dev Returns the list of pools (their staking addresses) which will participate in a new validator set
    /// selection process in the `ValidatorSetHbbft.newValidatorSet` function. This is an array of pools
    /// which will be considered as candidates when forming a new validator set (at the last block of a staking epoch).
    /// This array is kept updated by the `_addPoolToBeElected` and `_deletePoolToBeElected` internal functions.
    function getPoolsToBeElected() external view returns (address[] memory) {
        return _poolsToBeElected;
    }

    /// @dev Returns the list of pools (their staking addresses) which will be removed by the
    /// `ValidatorSetHbbft.newValidatorSet` function from the active `pools` array (at the last block
    /// of a staking epoch). This array is kept updated by the `_addPoolToBeRemoved`
    /// and `_deletePoolToBeRemoved` internal functions. A pool is added to this array when the pool's
    /// address withdraws (or orders) all of its own staking coins from the pool, inactivating the pool.
    function getPoolsToBeRemoved() external view returns (address[] memory) {
        return _poolsToBeRemoved.values();
    }

    function getPoolValidatorStakeAmount(uint256 _epoch, address _stakingPool) external view returns (uint256) {
        return snapshotPoolValidatorStakeAmount[_epoch][_stakingPool];
    }

    /// @dev Determines whether staking/withdrawal operations are allowed at the moment.
    /// Used by all staking/withdrawal functions.
    function areStakeAndWithdrawAllowed() public pure returns (bool) {
        //experimental change to always allow to stake withdraw.
        //see https://github.com/DMDcoin/hbbft-posdao-contracts/issues/14 for discussion.
        return true;

        // used for testing
        // if (stakingFixedEpochDuration == 0){
        //     return true;
        // }
        // uint256 currentTimestamp = block.timestamp;
        // uint256 allowedDuration = stakingFixedEpochDuration - stakingWithdrawDisallowPeriod;
        // return currentTimestamp - stakingEpochStartTime > allowedDuration; //TODO: should be < not <=?
    }

    /// @dev Returns a flag indicating whether a specified address is in the `pools` array.
    /// See the `getPools` getter.
    /// @param _stakingAddress The staking address of the pool.
    function isPoolActive(address _stakingAddress) public view returns (bool) {
        return _pools.contains(_stakingAddress);
    }

    /// @dev Returns a flag indicating whether a specified address is in the `_pools` or `poolsInactive` array.
    /// @param _stakingAddress The staking address of the pool.
    function isPoolValid(address _stakingAddress) public view returns (bool) {
        return _pools.contains(_stakingAddress) || _poolsInactive.contains(_stakingAddress);
    }

    /// @dev Returns the maximum amount which can be withdrawn from the specified pool by the specified staker
    /// at the moment. Used by the `withdraw` and `moveStake` functions.
    /// @param _poolStakingAddress The pool staking address from which the withdrawal will be made.
    /// @param _staker The staker address that is going to withdraw.
    function maxWithdrawAllowed(address _poolStakingAddress, address _staker) public view returns (uint256) {
        address miningAddress = validatorSetContract.miningByStakingAddress(_poolStakingAddress);

        if (!areStakeAndWithdrawAllowed() || abandonedAndRemoved[_poolStakingAddress]) {
            return 0;
        }

        uint256 canWithdraw = stakeAmount[_poolStakingAddress][_staker];

        if (!validatorSetContract.isValidatorOrPending(miningAddress)) {
            // The pool is not a validator and is not going to become one,
            // so the staker can only withdraw staked amount minus already
            // ordered amount
            return canWithdraw;
        }

        // The pool is a validator (active or pending), so the staker can only
        // withdraw staked amount minus already ordered amount but
        // no more than the amount staked during the current staking epoch
        uint256 stakedDuringEpoch = stakeAmountByCurrentEpoch(_poolStakingAddress, _staker);

        if (canWithdraw > stakedDuringEpoch) {
            canWithdraw = stakedDuringEpoch;
        }

        return canWithdraw;
    }

    /// @dev Returns the maximum amount which can be ordered to be withdrawn from the specified pool by the
    /// specified staker at the moment. Used by the `orderWithdraw` function.
    /// @param _poolStakingAddress The pool staking address from which the withdrawal will be ordered.
    /// @param _staker The staker address that is going to order the withdrawal.
    function maxWithdrawOrderAllowed(address _poolStakingAddress, address _staker) public view returns (uint256) {
        address miningAddress = validatorSetContract.miningByStakingAddress(_poolStakingAddress);

        if (!areStakeAndWithdrawAllowed()) {
            return 0;
        }

        if (!validatorSetContract.isValidatorOrPending(miningAddress)) {
            // If the pool is a candidate (not an active validator and not pending one),
            // no one can order withdrawal from the `_poolStakingAddress`, but
            // anyone can withdraw immediately (see the `maxWithdrawAllowed` getter)
            return 0;
        }

        // If the pool is an active or pending validator, the staker can order withdrawal
        // up to their total staking amount minus an already ordered amount
        // minus an amount staked during the current staking epoch
        return stakeAmount[_poolStakingAddress][_staker] - stakeAmountByCurrentEpoch(_poolStakingAddress, _staker);
    }

    /// @dev Returns an array of the current active delegators of the specified pool.
    /// A delegator is considered active if they have staked into the specified
    /// pool and their stake is not ordered to be withdrawn.
    /// @param _poolStakingAddress The pool staking address.
    function poolDelegators(address _poolStakingAddress) public view returns (address[] memory) {
        return _poolDelegators[_poolStakingAddress].values();
    }

    /// @dev Returns an array of the current inactive delegators of the specified pool.
    /// A delegator is considered inactive if their entire stake is ordered to be withdrawn
    /// but not yet claimed.
    /// @param _poolStakingAddress The pool staking address.
    function poolDelegatorsInactive(address _poolStakingAddress) external view returns (address[] memory) {
        return _poolDelegatorsInactive[_poolStakingAddress].values();
    }

    /// @dev Returns the amount of staking coins staked into the specified pool by the specified staker
    /// during the current staking epoch (see the `stakingEpoch` getter).
    /// Used by the `stake`, `withdraw`, and `orderWithdraw` functions.
    /// @param _poolStakingAddress The pool staking address.
    /// @param _staker The staker's address.
    function stakeAmountByCurrentEpoch(address _poolStakingAddress, address _staker) public view returns (uint256) {
        return _stakeAmountByEpoch[_poolStakingAddress][_staker][stakingEpoch];
    }

    /// @dev indicates the time when the new validatorset for the next epoch gets chosen.
    /// this is the start of a timeframe before the end of the epoch,
    /// that is long enough for the validators
    /// to create a new shared key.
    function startTimeOfNextPhaseTransition() public view returns (uint256) {
        return stakingEpochStartTime + stakingFixedEpochDuration - stakingTransitionTimeframeLength;
    }

    /// @dev Returns an indicative time of the last block of the current staking epoch before key generation starts.
    function stakingFixedEpochEndTime() public view returns (uint256) {
        uint256 startTime = stakingEpochStartTime;
        return
            startTime +
            stakingFixedEpochDuration +
            currentKeyGenExtraTimeWindow -
            (stakingFixedEpochDuration == 0 ? 0 : 1);
    }

    /// @dev Adds the specified staking address to the array of active pools returned by
    /// the `getPools` getter. Used by the `stake`, `addPool`, and `orderWithdraw` functions.
    /// @param _stakingAddress The pool added to the array of active pools.
    /// @param _toBeElected The boolean flag which defines whether the specified address should be
    /// added simultaneously to the `poolsToBeElected` array. See the `getPoolsToBeElected` getter.
    function _addPoolActive(address _stakingAddress, bool _toBeElected) internal {
        if (!isPoolActive(_stakingAddress)) {
            _pools.add(_stakingAddress);

            if (_pools.length() > _getMaxCandidates()) {
                revert MaxPoolsCountExceeded();
            }
        }

        _poolsInactive.remove(_stakingAddress);

        if (_toBeElected) {
            _addPoolToBeElected(_stakingAddress);
        }
    }

    /// @dev Adds the specified staking address to the array of inactive pools returned by
    /// the `getPoolsInactive` getter. Used by the `_removePool` internal function.
    /// @param _stakingAddress The pool added to the array of inactive pools.
    function _addPoolInactive(address _stakingAddress) internal {
        // This function performs internal checks if value already exists
        _poolsInactive.add(_stakingAddress);
    }

    /// @dev Adds the specified staking address to the array of pools returned by the `getPoolsToBeElected`
    /// getter. Used by the `_addPoolActive` internal function. See the `getPoolsToBeElected` getter.
    /// @param _stakingAddress The pool added to the `poolsToBeElected` array.
    function _addPoolToBeElected(address _stakingAddress) private {
        uint256 index = poolToBeElectedIndex[_stakingAddress];
        uint256 length = _poolsToBeElected.length;
        if (index >= length || _poolsToBeElected[index] != _stakingAddress) {
            poolToBeElectedIndex[_stakingAddress] = length;
            _poolsToBeElected.push(_stakingAddress);
            _poolsLikelihood.push(0); // assumes the likelihood is set with `_setLikelihood` function hereinafter
        }
        _deletePoolToBeRemoved(_stakingAddress);
    }

    /// @dev Adds the specified staking address to the array of pools returned by the `getPoolsToBeRemoved`
    /// getter. Used by withdrawal functions. See the `getPoolsToBeRemoved` getter.
    /// @param _stakingAddress The pool added to the `poolsToBeRemoved` array.
    function _addPoolToBeRemoved(address _stakingAddress) private {
        _poolsToBeRemoved.add(_stakingAddress);

        _deletePoolToBeElected(_stakingAddress);
    }

    /// @dev Deletes the specified staking address from the array of pools returned by the
    /// `getPoolsToBeElected` getter. Used by the `_addPoolToBeRemoved` and `_removePool` internal functions.
    /// See the `getPoolsToBeElected` getter.
    /// @param _stakingAddress The pool deleted from the `poolsToBeElected` array.
    function _deletePoolToBeElected(address _stakingAddress) private {
        if (_poolsToBeElected.length != _poolsLikelihood.length) return;

        uint256 indexToDelete = poolToBeElectedIndex[_stakingAddress];
        if (_poolsToBeElected.length > indexToDelete && _poolsToBeElected[indexToDelete] == _stakingAddress) {
            if (_poolsLikelihoodSum >= _poolsLikelihood[indexToDelete]) {
                _poolsLikelihoodSum -= _poolsLikelihood[indexToDelete];
            } else {
                _poolsLikelihoodSum = 0;
            }

            uint256 lastPoolIndex = _poolsToBeElected.length - 1;
            address lastPool = _poolsToBeElected[lastPoolIndex];

            _poolsToBeElected[indexToDelete] = lastPool;
            _poolsLikelihood[indexToDelete] = _poolsLikelihood[lastPoolIndex];

            poolToBeElectedIndex[lastPool] = indexToDelete;
            poolToBeElectedIndex[_stakingAddress] = 0;

            _poolsToBeElected.pop();
            _poolsLikelihood.pop();
        }
    }

    /// @dev Deletes the specified staking address from the array of pools returned by the
    /// `getPoolsToBeRemoved` getter. Used by the `_addPoolToBeElected` and `_removePool` internal functions.
    /// See the `getPoolsToBeRemoved` getter.
    /// @param _stakingAddress The pool deleted from the `poolsToBeRemoved` array.
    function _deletePoolToBeRemoved(address _stakingAddress) private {
        _poolsToBeRemoved.remove(_stakingAddress);
    }

    /// @dev Removes the specified staking address from the array of active pools returned by
    /// the `getPools` getter. Used by the `removePool`, `removeMyPool`, and withdrawal functions.
    /// @param _stakingAddress The pool removed from the array of active pools.
    function _removePool(address _stakingAddress) private {
        // This function performs existence check internally
        _pools.remove(_stakingAddress);

        if (_isPoolEmpty(_stakingAddress)) {
            _poolsInactive.remove(_stakingAddress);
        } else {
            _addPoolInactive(_stakingAddress);
        }

        _deletePoolToBeElected(_stakingAddress);
        _deletePoolToBeRemoved(_stakingAddress);
    }

    function _validateStakingParams(StakingParams calldata params) private pure {
        if (
            params._stakingFixedEpochDuration == 0 ||
            params._stakingFixedEpochDuration <= params._stakingWithdrawDisallowPeriod
        ) {
            revert InvalidFixedEpochDuration();
        }

        if (params._stakingWithdrawDisallowPeriod == 0) {
            revert ZeroWidthrawDisallowPeriod();
        }

        if (
            params._stakingTransitionTimeframeLength == 0 ||
            params._stakingTransitionTimeframeLength >= params._stakingFixedEpochDuration
        ) {
            revert InvalidTransitionTimeFrame();
        }

        if (params._validatorSetContract == address(0)) {
            revert ZeroAddress();
        }

        if (params._initialStakingAddresses.length == 0) {
            revert InitialStakingPoolsListEmpty();
        }

        if (params._delegatorMinStake == 0 || params._candidateMinStake == 0) {
            revert InvalidInitialStakeAmount(params._candidateMinStake, params._delegatorMinStake);
        }

        if (params._maxStake <= params._candidateMinStake) {
            revert InvalidMaxStakeAmount();
        }
    }

    /// @dev Returns the max number of candidates (including validators). See the MAX_CANDIDATES constant.
    /// Needed mostly for unit tests.
    function _getMaxCandidates() internal pure virtual returns (uint256) {
        return MAX_CANDIDATES;
    }

    /// @dev Adds the specified address to the array of the current active delegators of the specified pool.
    /// Used by the `stake` and `orderWithdraw` functions. See the `poolDelegators` getter.
    /// @param _poolStakingAddress The pool staking address.
    /// @param _delegator The delegator's address.
    function _addPoolDelegator(address _poolStakingAddress, address _delegator) private {
        _poolDelegators[_poolStakingAddress].add(_delegator);

        _removePoolDelegatorInactive(_poolStakingAddress, _delegator);
    }

    /// @dev Adds the specified address to the array of the current inactive delegators of the specified pool.
    /// Used by the `_removePoolDelegator` internal function.
    /// @param _poolStakingAddress The pool staking address.
    /// @param _delegator The delegator's address.
    function _addPoolDelegatorInactive(address _poolStakingAddress, address _delegator) private {
        _poolDelegatorsInactive[_poolStakingAddress].add(_delegator);
    }

    /// @dev Removes the specified address from the array of the current active delegators of the specified pool.
    /// Used by the withdrawal functions. See the `poolDelegators` getter.
    /// @param _poolStakingAddress The pool staking address.
    /// @param _delegator The delegator's address.
    function _removePoolDelegator(address _poolStakingAddress, address _delegator) private {
        _poolDelegators[_poolStakingAddress].remove(_delegator);

        if (orderedWithdrawAmount[_poolStakingAddress][_delegator] != 0) {
            _addPoolDelegatorInactive(_poolStakingAddress, _delegator);
        } else {
            _removePoolDelegatorInactive(_poolStakingAddress, _delegator);
        }
    }

    /// @dev Removes the specified address from the array of the inactive delegators of the specified pool.
    /// Used by the `_addPoolDelegator` and `_removePoolDelegator` internal functions.
    /// @param _poolStakingAddress The pool staking address.
    /// @param _delegator The delegator's address.
    function _removePoolDelegatorInactive(address _poolStakingAddress, address _delegator) private {
        _poolDelegatorsInactive[_poolStakingAddress].remove(_delegator);
    }

    /// @dev Calculates (updates) the probability of being selected as a validator for the specified pool
    /// and updates the total sum of probability coefficients. Actually, the probability is equal to the
    /// amount totally staked into the pool multiplied by validator bonus score. See the `getPoolsLikelihood` getter.
    /// Used by the staking and withdrawal functions.
    /// @param _poolStakingAddress The address of the pool for which the probability coefficient must be updated.
    function _setLikelihood(address _poolStakingAddress) private {
        address miningAddress = validatorSetContract.miningByStakingAddress(_poolStakingAddress);
        uint256 validatorBonusScore = bonusScoreContract.getValidatorScore(miningAddress);

        _updateLikelihood(_poolStakingAddress, validatorBonusScore);
    }

    function _updateLikelihood(address _poolStakingAddress, uint256 validatorBonusScore) private {
        (bool isToBeElected, uint256 index) = _isPoolToBeElected(_poolStakingAddress);

        if (!isToBeElected) return;

        uint256 oldValue = _poolsLikelihood[index];
        uint256 newValue = stakeAmountTotal[_poolStakingAddress] * validatorBonusScore;

        _poolsLikelihood[index] = newValue;
        _poolsLikelihoodSum = _poolsLikelihoodSum - oldValue + newValue;
    }

    /// @dev The internal function used by the `_stake` and `moveStake` functions.
    /// See the `stake` public function for more details.
    /// @param _poolStakingAddress The staking address of the pool where the coins should be staked.
    /// @param _staker The staker's address.
    /// @param _amount The amount of coins to be staked.
    function _stake(address _poolStakingAddress, address _staker, uint256 _amount) private {
        if (_poolStakingAddress == address(0)) {
            revert ZeroAddress();
        }

        address poolMiningAddress = validatorSetContract.miningByStakingAddress(_poolStakingAddress);
        if (poolMiningAddress == address(0)) {
            revert PoolNotExist(_poolStakingAddress);
        }

        if (_amount == 0) {
            revert InsufficientStakeAmount(_poolStakingAddress, _staker);
        }

        if (abandonedAndRemoved[_poolStakingAddress]) {
            revert PoolAbandoned(_poolStakingAddress);
        }

        //require(areStakeAndWithdrawAllowed(), "Stake: disallowed period");

        bool selfStake = _staker == _poolStakingAddress;
        uint256 newStakeAmount = stakeAmount[_poolStakingAddress][_staker] + _amount;

        uint256 requiredStakeAmount;

        if (selfStake) {
            requiredStakeAmount = candidateMinStake;
        } else {
            requiredStakeAmount = delegatorMinStake;

            // The delegator cannot stake into the pool of the candidate which hasn't self-staked.
            // Also, that candidate shouldn't want to withdraw all their funds.
            if (stakeAmount[_poolStakingAddress][_poolStakingAddress] == 0) {
                revert PoolEmpty(_poolStakingAddress);
            }
        }

        if (newStakeAmount < requiredStakeAmount) {
            revert InsufficientStakeAmount(_poolStakingAddress, _staker);
        }

        if (stakeAmountTotal[_poolStakingAddress] + _amount > maxStakeAmount) {
            revert PoolStakeLimitExceeded(_poolStakingAddress, _staker);
        }

        _stakeAmountByEpoch[_poolStakingAddress][_staker][stakingEpoch] += _amount;
        stakeAmountTotal[_poolStakingAddress] += _amount;
        totalStakedAmount += _amount;

        if (selfStake) {
            // `staker` places a stake for himself and becomes a candidate
            // Add `_poolStakingAddress` to the array of pools
            _addPoolActive(_poolStakingAddress, true);
        } else {
            // Add `_staker` to the array of pool's delegators
            _addPoolDelegator(_poolStakingAddress, _staker);

            // Save amount value staked by the delegator
            _snapshotDelegatorStake(_poolStakingAddress, poolMiningAddress, _staker);
        }

        stakeAmount[_poolStakingAddress][_staker] = newStakeAmount;

        _setLikelihood(_poolStakingAddress);
    }

    /// @dev The internal function used by the `withdraw` and `moveStake` functions.
    /// See the `withdraw` public function for more details.
    /// @param _poolStakingAddress The staking address of the pool from which the coins should be withdrawn.
    /// @param _staker The staker's address.
    /// @param _amount The amount of coins to be withdrawn.
    function _withdraw(address _poolStakingAddress, address _staker, uint256 _amount) private {
        if (_poolStakingAddress == address(0)) {
            revert ZeroAddress();
        }

        if (_amount == 0) {
            revert ZeroWidthrawAmount();
        }

        // How much can `staker` withdraw from `_poolStakingAddress` at the moment?
        uint256 allowedMaxWithdraw = maxWithdrawAllowed(_poolStakingAddress, _staker);
        if (_amount > allowedMaxWithdraw) {
            revert MaxAllowedWithdrawExceeded(allowedMaxWithdraw, _amount);
        }

        uint256 newStakeAmount = stakeAmount[_poolStakingAddress][_staker] - _amount;

        // The amount to be withdrawn must be the whole staked amount or
        // must not exceed the diff between the entire amount and MIN_STAKE
        uint256 minAllowedStake = (_poolStakingAddress == _staker) ? candidateMinStake : delegatorMinStake;
        if (newStakeAmount != 0 && newStakeAmount < minAllowedStake) {
            revert InvalidWithdrawAmount(_poolStakingAddress, _staker, _amount);
        }

        if (_staker != _poolStakingAddress) {
            address miningAddress = validatorSetContract.miningByStakingAddress(_poolStakingAddress);
            _snapshotDelegatorStake(_poolStakingAddress, miningAddress, _staker);
        }

        stakeAmount[_poolStakingAddress][_staker] = newStakeAmount;
        uint256 amountByEpoch = stakeAmountByCurrentEpoch(_poolStakingAddress, _staker);
        _stakeAmountByEpoch[_poolStakingAddress][_staker][stakingEpoch] = amountByEpoch >= _amount
            ? amountByEpoch - _amount
            : 0;
        stakeAmountTotal[_poolStakingAddress] -= _amount;
        totalStakedAmount -= _amount;

        if (newStakeAmount == 0) {
            _withdrawCheckPool(_poolStakingAddress, _staker);
        }

        _setLikelihood(_poolStakingAddress);
    }

    /// @dev The internal function used by the `_withdraw` and `claimOrderedWithdraw` functions.
    /// Contains a common logic for these functions.
    /// @param _poolStakingAddress The staking address of the pool from which the coins are withdrawn.
    /// @param _staker The staker's address.
    function _withdrawCheckPool(address _poolStakingAddress, address _staker) private {
        if (_staker == _poolStakingAddress) {
            address miningAddress = validatorSetContract.miningByStakingAddress(_poolStakingAddress);
            if (validatorSetContract.isValidator(miningAddress)) {
                _addPoolToBeRemoved(_poolStakingAddress);
            } else {
                _removePool(_poolStakingAddress);
            }
        } else {
            _removePoolDelegator(_poolStakingAddress, _staker);

            if (_isPoolEmpty(_poolStakingAddress)) {
                _poolsInactive.remove(_poolStakingAddress);
            }
        }
    }

    function _snapshotDelegatorStake(address _stakingAddress, address _miningAddress, address _delegator) private {
        if (!validatorSetContract.isValidatorOrPending(_miningAddress) || stakingEpoch == 0) {
            return;
        }

        uint256 lastSnapshotEpochNumber = _stakeSnapshotLastEpoch[_stakingAddress][_delegator];

        if (lastSnapshotEpochNumber < stakingEpoch) {
            _delegatorStakeSnapshot[_stakingAddress][_delegator][stakingEpoch] = stakeAmount[_stakingAddress][
                _delegator
            ];
            _stakeSnapshotLastEpoch[_stakingAddress][_delegator] = stakingEpoch;
        }
    }

    function _setNodeOperator(
        address _stakingAddress,
        address _operatorAddress,
        uint256 _operatorSharePercent
    ) private {
        if (_operatorSharePercent > MAX_NODE_OPERATOR_SHARE_PERCENT) {
            revert InvalidNodeOperatorShare(_operatorSharePercent);
        }

        if (_operatorAddress == address(0) && _operatorSharePercent != 0) {
            revert InvalidNodeOperatorConfiguration(_operatorAddress, _operatorSharePercent);
        }

        uint256 lastChangeEpoch = poolNodeOperatorLastChangeEpoch[_stakingAddress];
        if (lastChangeEpoch != 0 && lastChangeEpoch == stakingEpoch) {
            revert OnlyOncePerEpoch(stakingEpoch);
        }

        poolNodeOperator[_stakingAddress] = _operatorAddress;
        poolNodeOperatorShare[_stakingAddress] = _operatorSharePercent;

        poolNodeOperatorLastChangeEpoch[_stakingAddress] = stakingEpoch;

        emit SetNodeOperator(_stakingAddress, _operatorAddress, _operatorSharePercent);
    }

    function _rewardNodeOperator(address _stakingAddress, uint256 _operatorShare) private {
        address nodeOperator = poolNodeOperator[_stakingAddress];

        if (!_poolDelegators[_stakingAddress].contains(nodeOperator)) {
            _addPoolDelegator(_stakingAddress, nodeOperator);
        }

        stakeAmount[_stakingAddress][nodeOperator] += _operatorShare;
        _stakeAmountByEpoch[_stakingAddress][nodeOperator][stakingEpoch] += _operatorShare;
    }

    function _getDelegatorStake(
        uint256 _stakingEpoch,
        address _stakingAddress,
        address _delegator
    ) private view returns (uint256) {
        if (_stakingEpoch == 0) {
            return 0;
        }

        if (_stakeSnapshotLastEpoch[_stakingAddress][_delegator] == _stakingEpoch) {
            return _delegatorStakeSnapshot[_stakingAddress][_delegator][_stakingEpoch];
        } else {
            return stakeAmount[_stakingAddress][_delegator];
        }
    }

    /// @dev Returns a boolean flag indicating whether the specified pool is fully empty
    /// (all stakes are withdrawn including ordered withdrawals).
    /// @param _poolStakingAddress The staking address of the pool
    function _isPoolEmpty(address _poolStakingAddress) private view returns (bool) {
        return stakeAmountTotal[_poolStakingAddress] == 0 && orderedWithdrawAmountTotal[_poolStakingAddress] == 0;
    }

    /// @dev Determines if the specified pool is in the `poolsToBeElected` array. See the `getPoolsToBeElected` getter.
    /// Used by the `_setLikelihood` internal function.
    /// @param _stakingAddress The staking address of the pool.
    /// @return toBeElected `bool toBeElected` - The boolean flag indicating whether the `_stakingAddress` is in the
    /// `poolsToBeElected` array.
    /// `uint256 index` - The position of the item in the `poolsToBeElected` array if `toBeElected` is `true`.
    function _isPoolToBeElected(address _stakingAddress) private view returns (bool toBeElected, uint256 index) {
        index = poolToBeElectedIndex[_stakingAddress];
        if (_poolsToBeElected.length > index && _poolsToBeElected[index] == _stakingAddress) {
            return (true, index);
        }
        return (false, 0);
    }

    function _splitPoolReward(
        address _poolAddress,
        uint256 _poolReward,
        uint256 _validatorMinRewardPercent
    ) private view returns (PoolRewardShares memory shares) {
        uint256 totalStake = snapshotPoolTotalStakeAmount[stakingEpoch][_poolAddress];
        uint256 validatorStake = snapshotPoolValidatorStakeAmount[stakingEpoch][_poolAddress];

        uint256 validatorFixedReward = (_poolReward * _validatorMinRewardPercent) / 100;

        shares.delegatorsShare = _poolReward - validatorFixedReward;

        uint256 operatorSharePercent = poolNodeOperatorShare[_poolAddress];
        if (poolNodeOperator[_poolAddress] != address(0) && operatorSharePercent != 0) {
            shares.nodeOperatorShare = (_poolReward * operatorSharePercent) / PERCENT_DENOMINATOR;
        }

        shares.validatorShare =
            validatorFixedReward -
            shares.nodeOperatorShare +
            (shares.delegatorsShare * validatorStake) /
            totalStake;
    }
}

// slither-disable-end unused-return
