pragma solidity =0.8.17;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import { IBlockRewardHbbft } from "./interfaces/IBlockRewardHbbft.sol";
import { IStakingHbbft } from "./interfaces/IStakingHbbft.sol";
import { IValidatorSetHbbft } from "./interfaces/IValidatorSetHbbft.sol";
import { TransferUtils } from "./utils/TransferUtils.sol";

/// @dev Generates and distributes rewards according to the logic and formulas described in the POSDAO white paper.
contract BlockRewardHbbft is Initializable, OwnableUpgradeable, ReentrancyGuardUpgradeable, IBlockRewardHbbft {
    struct PotsShares {
        uint256 deltaPotAmount;
        uint256 reinsertPotAmount;
        uint256 governancePotAmount;
        uint256 totalRewards;
    }

    // =============================================== Storage ========================================================
    mapping(address => uint256[]) internal _epochsPoolGotRewardFor;

    /// @dev The reward amount to be distributed in native coins among participants (the validator and their
    /// delegators) of the specified pool (mining address) for the specified staking epoch.
    mapping(uint256 => mapping(address => uint256)) public epochPoolNativeReward;

    /// @dev The total reward amount in native coins which is not yet distributed among pools.
    uint256 public nativeRewardUndistributed;

    /// @dev The validator's min reward percent which was actual at the specified staking epoch.
    /// This percent is taken from the VALIDATOR_MIN_REWARD_PERCENT constant and saved for every staking epoch
    /// by the `reward` function.
    /// This is needed to have an ability to change validator's min reward percent in the VALIDATOR_MIN_REWARD_PERCENT
    /// constant by upgrading the contract.
    mapping(uint256 => uint256) public validatorMinRewardPercent;

    /// @dev the Delta Pool holds all coins that never got emitted, since the maximum supply is 4,380,000
    uint256 public deltaPot;

    /// @dev each epoch reward, one Fraction of the delta pool gets payed out.
    /// the number is the divisor of the fraction. 60 means 1/60 of the delta pool gets payed out.
    uint256 public deltaPotPayoutFraction;

    /// @dev the reinsertPot holds all coins that are designed for getting reinserted into the coin circulation.
    uint256 public reinsertPot;

    /// @dev each epoch reward, one Fraction of the reinsert pool gets payed out.
    /// the number is the divisor of the fraction. 60 means 1/60 of the reinsert pool gets payed out.
    uint256 public reinsertPotPayoutFraction;

    /// @dev The address of the `ValidatorSet` contract.
    IValidatorSetHbbft public validatorSetContract;

    /// @dev parts of the epoch reward get forwarded to a governance fund.
    address payable public governancePotAddress;

    /// @dev nominator of the epoch reward that get's forwarded to the
    /// `governancePotAddress`. See also `governancePotShareDenominator`
    uint256 public governancePotShareNominator;

    /// @dev denominator of the epoch reward that get's forwarded to the
    /// `governancePotAddress`. See also `governancePotShareNominator`
    uint256 public governancePotShareDenominator;

    /// @dev the address of the `ConnectivityTrackerHbbft` contract.
    address public connectivityTracker;

    /// @dev flag indicating whether it is needed to end current epoch earlier.
    bool public earlyEpochEnd;

    uint256 public constant VALIDATOR_MIN_REWARD_PERCENT = 30; // 30%
    uint256 public constant REWARD_PERCENT_MULTIPLIER = 1000000;

    // ================================================ Events ========================================================

    /// @dev Emitted by the `reward` function.
    /// @param rewards The amount minted and distributed among the validators.
    event CoinsRewarded(uint256 rewards);

    /// @dev Emitted by the `setConnectivityTracker` function.
    /// @param _connectivityTracker New ConnectivityTracker contract address.
    event SetConnectivityTracker(address _connectivityTracker);

    /// @dev Emitted by the `setdeltaPotPayoutFraction` function.
    /// @param _fraction New delta pot payout fraction value.
    event SetDeltaPotPayoutFraction(uint256 _fraction);

    /// @dev Emitted by the `setReinsertPotPayoutFraction` function.
    /// @param _fraction New reinsert pot payout fraction value.
    event SetReinsertPotPayoutFraction(uint256 _fraction);

    // ============================================== Modifiers =======================================================

    /// @dev Ensures the caller is the SYSTEM_ADDRESS. See https://wiki.parity.io/Block-Reward-Contract.html
    modifier onlySystem() virtual {
        require(msg.sender == 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE);
        _;
    }

    /// @dev Ensures the caller is the ConnectivityTracker contract address.
    modifier onlyConnectivityTracker() {
        require(msg.sender == connectivityTracker);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    // =============================================== Setters ========================================================

    /// @dev Receive function. Prevents direct sending native coins to this contract.
    receive() external payable {
        reinsertPot += msg.value;
    }

    /// @dev Initializes the contract at network startup.
    /// Can only be called by the constructor of the `InitializerHbbft` contract or owner.
    /// @param _contractOwner The address of the contract owner
    /// @param _validatorSet The address of the `ValidatorSetHbbft` contract.
    function initialize(
        address _contractOwner,
        address _validatorSet,
        address _connectivityTracker
    ) external initializer {
        require(_contractOwner != address(0), "Owner address must not be 0");
        require(_validatorSet != address(0), "ValidatorSet must not be 0");
        require(_connectivityTracker != address(0), "ConnectivityTracker must not be 0");

        __Ownable_init();
        __ReentrancyGuard_init();
        _transferOwnership(_contractOwner);

        validatorSetContract = IValidatorSetHbbft(_validatorSet);
        connectivityTracker = _connectivityTracker;

        validatorMinRewardPercent[0] = VALIDATOR_MIN_REWARD_PERCENT;

        deltaPotPayoutFraction = 6000;
        reinsertPotPayoutFraction = 6000;
        governancePotAddress = payable(0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0);
        governancePotShareNominator = 1;
        governancePotShareDenominator = 10;
    }

    /// @dev adds the transfered value to the delta pot.
    /// everyone is allowed to pile up the delta pot.
    /// however, circulating coins should be added to the reinsert pot,
    /// since the reinsert pot is designed for circulating coins.
    function addToDeltaPot() external payable {
        deltaPot += msg.value;
    }

    /// @dev adds the transfered value to the reinsert pot.
    /// everyone is allowed to pile up the resinsert pot,
    /// the reinsert pot reinserts coins back into the payout cycle.
    /// this is used by smart contracts of the ecosystem,
    /// DAO decisions to fund the reinsert pot from the DAO Pool
    /// and manual by hand.
    /// There is no permission check,
    /// everyone is welcomed to pile up the reinsert pot.
    function addToReinsertPot() external payable {
        reinsertPot += msg.value;
    }

    /// @dev set the delta pot payout fraction.
    /// every epoch,
    /// a fraction of the delta pot is payed out.
    /// Only theOwner, the DAO is allowed to set the delta pot payout fraction.
    function setdeltaPotPayoutFraction(uint256 _value) external onlyOwner {
        require(_value != 0, "Payout fraction must not be 0");
        deltaPotPayoutFraction = _value;

        emit SetDeltaPotPayoutFraction(_value);
    }

    /// @dev set the reinsert pot payout fraction.
    /// every epoch,
    /// a fraction of the reinsert pot is payed out.
    /// (same logic than in the reinsert pot.)
    /// Only theOwner, the DAO is allowed to set the reinsert pot payout fraction.
    function setReinsertPotPayoutFraction(uint256 _value) external onlyOwner {
        require(_value != 0, "Payout fraction must not be 0");
        reinsertPotPayoutFraction = _value;

        emit SetReinsertPotPayoutFraction(_value);
    }

    function setConnectivityTracker(address _connectivityTracker) external onlyOwner {
        require(_connectivityTracker != address(0), "ConnectivityTracker must not be 0");
        connectivityTracker = _connectivityTracker;

        emit SetConnectivityTracker(_connectivityTracker);
    }

    /// @dev Notify block reward contract, that current epoch must be closed earlier.
    ///
    /// https://github.com/DMDcoin/diamond-contracts-core/issues/92
    function notifyEarlyEpochEnd() external onlyConnectivityTracker {
        earlyEpochEnd = true;
    }

    /// @dev Called by the engine when producing and closing a block,
    /// see https://wiki.parity.io/Block-Reward-Contract.html.
    /// This function performs all of the automatic operations needed for accumulating block producing statistics,
    /// starting a new staking epoch, snapshotting staking amounts for the upcoming staking epoch,
    /// and rewards distributing at the end of a staking epoch.
    /// @param _isEpochEndBlock Indicates if this is the last block of the current epoch i.e.
    /// just before the pending validators are finalized.
    function reward(bool _isEpochEndBlock) external onlySystem nonReentrant returns (uint256 rewardsNative) {
        // slither-disable-start reentrancy-eth
        IStakingHbbft stakingContract = IStakingHbbft(validatorSetContract.getStakingContract());

        // If this is the last block of the epoch i.e. master key has been generated.
        if (_isEpochEndBlock || earlyEpochEnd) {
            rewardsNative = _closeEpoch(stakingContract);

            earlyEpochEnd = false;

            emit CoinsRewarded(rewardsNative);
        } else {
            _closeBlock(stakingContract);
        }

        // slither-disable-end reentrancy-eth
    }

    // =============================================== Getters ========================================================
    function getGovernanceAddress() external view returns (address) {
        return governancePotAddress;
    }

    /// @dev Returns an array of epoch numbers for which the specified pool (mining address)
    /// got a non-zero reward.
    function epochsPoolGotRewardFor(address _miningAddress) external view returns (uint256[] memory) {
        return _epochsPoolGotRewardFor[_miningAddress];
    }

    ///@dev Calculates and returns the percentage of the current epoch.
    /// 100% MAX
    function epochPercentage() public view returns (uint256) {
        IStakingHbbft stakingContract = IStakingHbbft(validatorSetContract.getStakingContract());
        uint256 expectedEpochDuration = stakingContract.stakingFixedEpochEndTime() -
            stakingContract.stakingEpochStartTime();
        return
            block.timestamp > stakingContract.stakingFixedEpochEndTime()
                ? 100
                : ((block.timestamp - stakingContract.stakingEpochStartTime()) * 100) / expectedEpochDuration;
    }

    // ============================================== Private ========================================================

    /// @dev Distributes rewards among pools at the latest block of a staking epoch.
    /// This function is called by the `reward` function.
    /// @param _stakingEpoch The number of the current staking epoch.
    /// @return Returns the reward amount in native coins needed to be minted
    /// and accrued to the balance of this contract.
    function _distributeRewards(uint256 _stakingEpoch, IStakingHbbft stakingContract) private returns (uint256) {
        // slither-disable-start reentrancy-eth
        address[] memory validators = validatorSetContract.getValidators();

        uint256 numValidators = validators.length;
        require(numValidators != 0, "Empty Validator list");

        PotsShares memory shares = _getPotsShares(numValidators);

        deltaPot -= shares.deltaPotAmount;
        reinsertPot -= shares.reinsertPotAmount;

        if (shares.totalRewards == 0) {
            return 0;
        }

        TransferUtils.transferNative(governancePotAddress, shares.governancePotAmount);

        uint256 distributedAmount = shares.governancePotAmount;
        uint256 rewardToDistribute = shares.totalRewards - distributedAmount;

        (uint256 numRewardedValidators, bool[] memory isRewardedValidator) = _markRewardedValidators(
            stakingContract,
            _stakingEpoch,
            validators
        );

        // No rewards distributed in this epoch
        if (numRewardedValidators == 0) {
            return 0;
        }

        // Share the reward equally among the validators.
        uint256 poolReward = rewardToDistribute / numRewardedValidators;
        uint256 minValidatorRewardPercent = validatorMinRewardPercent[_stakingEpoch];

        if (poolReward != 0) {
            for (uint256 i = 0; i < numValidators; ++i) {
                if (!isRewardedValidator[i]) {
                    continue;
                }

                address miningAddress = validators[i];
                address poolStakingAddress = validatorSetContract.stakingByMiningAddress(miningAddress);

                _savePoolRewardStats(_stakingEpoch, miningAddress, poolReward);

                stakingContract.restake{ value: poolReward }(poolStakingAddress, minValidatorRewardPercent);

                distributedAmount += poolReward;
            }
        }

        nativeRewardUndistributed = shares.totalRewards - distributedAmount;

        // slither-disable-end reentrancy-eth

        return distributedAmount;
    }

    /// @dev Makes snapshots of total amount staked into the specified pool
    /// before the specified staking epoch. Used by the `reward` function.
    /// @param stakingContract The address of the `StakingHbbft` contract.
    /// @param stakingEpoch The number of upcoming staking epoch.
    /// @param miningAddresses The mining address of the pool.
    function _snapshotPoolStakeAmounts(
        IStakingHbbft stakingContract,
        uint256 stakingEpoch,
        address[] memory miningAddresses
    ) private {
        for (uint256 i = 0; i < miningAddresses.length; ++i) {
            address stakingAddress = validatorSetContract.stakingByMiningAddress(miningAddresses[i]);

            stakingContract.snapshotPoolStakeAmounts(stakingEpoch, stakingAddress);
        }
    }

    function _savePoolRewardStats(uint256 stakingEpoch, address miningAddress, uint256 poolReward) private {
        _epochsPoolGotRewardFor[miningAddress].push(stakingEpoch);
        epochPoolNativeReward[stakingEpoch][miningAddress] = poolReward;
    }

    function _closeEpoch(IStakingHbbft stakingContract) private returns (uint256) {
        uint256 stakingEpoch = stakingContract.stakingEpoch();

        uint256 nativeTotalRewardAmount = 0;
        // Distribute rewards among validator pools
        if (stakingEpoch != 0) {
            nativeTotalRewardAmount = _distributeRewards(stakingEpoch, stakingContract);
        }

        // Snapshot total amounts staked into the pools
        uint256 nextStakingEpoch = stakingEpoch + 1;
        address[] memory miningAddresses;

        // We need to remember the total staked amounts for the pending addresses
        // for when these pending addresses are finalized by `ValidatorSetHbbft.finalizeChange()`.
        miningAddresses = validatorSetContract.getPendingValidators();
        _snapshotPoolStakeAmounts(stakingContract, nextStakingEpoch, miningAddresses);

        // We need to remember the total staked amounts for the current validators
        // for the possible case when these validators continue to be validators
        // throughout the upcoming staking epoch (if the new validator set is not finalized
        // for some reason)
        miningAddresses = validatorSetContract.getValidators();
        _snapshotPoolStakeAmounts(stakingContract, nextStakingEpoch, miningAddresses);

        // Remember validator's min reward percent for the upcoming staking epoch
        validatorMinRewardPercent[nextStakingEpoch] = VALIDATOR_MIN_REWARD_PERCENT;

        // the rewards got distributed,
        // we now can finalize the epoch and start with a new one.
        validatorSetContract.finalizeChange();

        return nativeTotalRewardAmount;
    }

    function _closeBlock(IStakingHbbft stakingContract) private {
        uint256 phaseTransitionTime = stakingContract.startTimeOfNextPhaseTransition();

        address[] memory miningAddresses = validatorSetContract.getValidators();

        // TODO: Problem occurs here if there are not regular blocks:
        // https://github.com/DMDcoin/hbbft-posdao-contracts/issues/96

        //we are in a transition to phase 2 if the time for it arrived,
        // and we do not have pendingValidators yet.
        bool isPhaseTransition = block.timestamp >= phaseTransitionTime;
        bool toBeUpscaled = false;
        if (miningAddresses.length * 3 <= (validatorSetContract.maxValidators() * 2)) {
            uint256 amountToBeElected = stakingContract.getPoolsToBeElected().length;
            if (
                (amountToBeElected > 0) &&
                validatorSetContract.getValidatorCountSweetSpot(amountToBeElected) > miningAddresses.length
            ) {
                toBeUpscaled = true;
            }
        }

        if ((isPhaseTransition || toBeUpscaled) && validatorSetContract.getPendingValidators().length == 0) {
            // Choose new validators
            validatorSetContract.newValidatorSet();
        } else if (block.timestamp >= stakingContract.stakingFixedEpochEndTime()) {
            validatorSetContract.handleFailedKeyGeneration();
        }
    }

    function _markRewardedValidators(
        IStakingHbbft stakingContract,
        uint256 stakingEpoch,
        address[] memory validators
    ) private view returns (uint256, bool[] memory) {
        // Indicates whether the validator is entitled to share the rewartds or not.
        bool[] memory isRewardedValidator = new bool[](validators.length);

        // Number of validators that are being rewarded.
        uint256 numRewardedValidators = 0;

        for (uint256 i = 0; i < validators.length; ++i) {
            if (validatorSetContract.isValidatorBanned(validators[i])) {
                continue;
            }

            uint256 validatorStakeAmount = stakingContract.getPoolValidatorStakeAmount(
                stakingEpoch,
                validatorSetContract.stakingByMiningAddress(validators[i])
            );

            if (validatorStakeAmount == 0) {
                continue;
            }

            isRewardedValidator[i] = true;
            ++numRewardedValidators;
        }

        return (numRewardedValidators, isRewardedValidator);
    }

    function _getPotsShares(uint256 numValidators) internal view returns (PotsShares memory) {
        uint256 maxValidators = validatorSetContract.maxValidators();
        uint256 epochPercent = epochPercentage();

        PotsShares memory shares = PotsShares(0, 0, 0, 0);

        shares.deltaPotAmount =
            (deltaPot * numValidators * epochPercent) /
            deltaPotPayoutFraction /
            maxValidators /
            100;

        shares.reinsertPotAmount =
            (reinsertPot * numValidators * epochPercent) /
            reinsertPotPayoutFraction /
            maxValidators /
            100;

        shares.totalRewards = nativeRewardUndistributed + shares.deltaPotAmount + shares.reinsertPotAmount;

        shares.governancePotAmount =
            (shares.totalRewards * governancePotShareNominator) /
            governancePotShareDenominator;

        return shares;
    }
}
