pragma solidity ^0.5.16;

import "../interfaces/IBlockRewardHbbft.sol";
import "../interfaces/IRandomHbbft.sol";
import "../interfaces/IStakingHbbft.sol";
import "../interfaces/IValidatorSetHbbft.sol";
import "../upgradeability/UpgradeableOwned.sol";
import "../libs/SafeMath.sol";


contract Sacrifice {
    constructor(address payable _recipient) public payable {
        selfdestruct(_recipient);
    }
}


/// @dev Generates and distributes rewards according to the logic and formulas described in the POSDAO white paper.
contract BlockRewardHbbftBase is UpgradeableOwned, IBlockRewardHbbft {
    using SafeMath for uint256;

    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables and do not change their types!

    mapping(address => uint256[]) internal _epochsPoolGotRewardFor;

    /// @dev The reward amount to be distributed in native coins among participants (the validator and their
    /// delegators) of the specified pool (mining address) for the specified staking epoch.
    mapping(uint256 => mapping(address => uint256)) public epochPoolNativeReward;

    /// @dev The total reward amount in native coins which is not yet distributed among pools.
    uint256 public nativeRewardUndistributed;

    /// @dev The total amount staked into the specified pool (mining address)
    /// before the specified staking epoch. Filled by the `_snapshotPoolStakeAmounts` function.
    mapping(uint256 => mapping(address => uint256)) public snapshotPoolTotalStakeAmount;

    /// @dev The validator's amount staked into the specified pool (mining address)
    /// before the specified staking epoch. Filled by the `_snapshotPoolStakeAmounts` function.
    mapping(uint256 => mapping(address => uint256)) public snapshotPoolValidatorStakeAmount;

    /// @dev The validator's min reward percent which was actual at the specified staking epoch.
    /// This percent is taken from the VALIDATOR_MIN_REWARD_PERCENT constant and saved for every staking epoch
    /// by the `reward` function. Used by the `delegatorShare` and `validatorShare` public getters.
    /// This is needed to have an ability to change validator's min reward percent in the VALIDATOR_MIN_REWARD_PERCENT
    /// constant by upgrading the contract.
    mapping(uint256 => uint256) public validatorMinRewardPercent;

    /// @dev the Delta Pool holds all coins that never got emitted, since the maximum supply is 4,380,000
    uint256 public deltaPot;

    /// @dev each epoch reward, one Fraction of the delta pool gets payed out.
    /// the number is the divisor of the fraction. 60 means 1/60 of the delta pool gets payed out.
    uint256 public deltaPotPayoutFraction = 60;


    /// @dev the reinsertPot holds all coins that are designed for getting reinserted into the coin circulation.
    /// sources are:
    /// 
    uint256 public reinsertPot;

    /// @dev each epoch reward, one Fraction of the reinsert pool gets payed out.
    /// the number is the divisor of the fraction. 60 means 1/60 of the reinsert pool gets payed out.
    uint256 public reinsertPotPayoutFraction;

    /// @dev The address of the `ValidatorSet` contract.
    IValidatorSetHbbft public validatorSetContract;

    /// @dev parts of the epoch reward get forwarded to a governance fund
    /// just a dummy function for now.
    address payable public governancePotAddress;

    uint256 public governancePotShareNominator;
    uint256 public governancePotShareDenominator;

    uint256 public constant VALIDATOR_MIN_REWARD_PERCENT = 30; // 30%
    uint256 public constant REWARD_PERCENT_MULTIPLIER = 1000000;


    // ================================================ Events ========================================================

    /// @dev Emitted by the `reward` function.
    /// @param rewards The amount minted and distributed among the validators.
    event CoinsRewarded(uint256 rewards);

    // ============================================== Modifiers =======================================================

    /// @dev Ensures the `initialize` function was called before.
    modifier onlyInitialized {
        require(isInitialized());
        _;
    }

    /// @dev Ensures the caller is the SYSTEM_ADDRESS. See https://wiki.parity.io/Block-Reward-Contract.html
    modifier onlySystem {
        require(msg.sender == 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE);
        _;
    }

    /// @dev Ensures the caller is the StakingHbbft contract address.
    modifier onlyStakingContract() {
        require(msg.sender == address(validatorSetContract.stakingContract()));
        _;
    }

    /// @dev Ensures the caller is the ValidatorSetHbbft contract address.
    modifier onlyValidatorSetContract() {
        require(msg.sender == address(validatorSetContract));
        _;
    }

    // =============================================== Setters ========================================================

    /// @dev Fallback function. Prevents direct sending native coins to this contract.
    function () payable external {
        reinsertPot += msg.value;
    }

    /// @dev Initializes the contract at network startup.
    /// Can only be called by the constructor of the `InitializerHbbft` contract or owner.
    /// @param _validatorSet The address of the `ValidatorSetHbbft` contract.
    function initialize(address _validatorSet) external {
        require(msg.sender == _admin() || tx.origin ==  _admin() || address(0) ==  _admin() || block.number == 0,
            "Initialization only on genesis block or by admin");
        require(!isInitialized(), "initialization can only be done once");
        require(_validatorSet != address(0), "ValidatorSet must not be 0");
        validatorSetContract = IValidatorSetHbbft(_validatorSet);
        validatorMinRewardPercent[0] = VALIDATOR_MIN_REWARD_PERCENT;

        deltaPotPayoutFraction = 6000;
        reinsertPotPayoutFraction = 6000;
        governancePotAddress = 0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0;
        governancePotShareNominator = 1;
        governancePotShareDenominator = 10;
    }

    /// @dev adds the transfered value to the delta pot.
    /// everyone is allowed to pile up the delta pot.
    /// however, circulating coins should be added to the reinsert pot,
    /// that is designed for circulating coins
    function addToDeltaPot()
    external
    payable {
        deltaPot += msg.value;
    }

    /// @dev adds the transfered value to the reinsert pot.
    /// everyone is allowed to pile up the resinsert pot.
    /// the reinsert pot is designed to 
    function addToReinsertPot()
    external
    payable {
        reinsertPot += msg.value;
    }

    function setdeltaPotPayoutFraction(uint256 _value)
    external 
    onlyOwner {
        require(_value != 0, "Payout fraction must not be 0");
        deltaPotPayoutFraction = _value;
    }

    function setReinsertPotPayoutFraction(uint256 _value)
    external     
    onlyOwner {
        require(_value != 0, "Payout fraction must not be 0");
        reinsertPotPayoutFraction = _value;
    }

    /// @dev Called by the engine when producing and closing a block,
    /// see https://wiki.parity.io/Block-Reward-Contract.html.
    /// This function performs all of the automatic operations needed for accumulating block producing statistics,
    /// starting a new staking epoch, snapshotting staking amounts for the upcoming staking epoch,
    /// and rewards distributing at the end of a staking epoch.
    /// @param _isEpochEndBlock Indicates if this is the last block of the current epoch i.e.
    /// just before the pending validators are fiinalized.
    function reward(bool _isEpochEndBlock)
    external
    onlySystem
    returns(uint256 rewardsNative)
    {
        IStakingHbbft stakingContract = IStakingHbbft(validatorSetContract.stakingContract());
        // If this is the last block of the epoch i.e. master key has been generated.

        if (_isEpochEndBlock) {

            
            uint256 stakingEpoch = stakingContract.stakingEpoch();

            uint256 nativeTotalRewardAmount;
            // Distribute rewards among validator pools
            if (stakingEpoch != 0) {
                nativeTotalRewardAmount = _distributeRewards(stakingEpoch);
            }

            // Snapshot total amounts staked into the pools
            uint256 i;
            uint256 nextStakingEpoch = stakingEpoch + 1;
            address[] memory miningAddresses;
            
            // We need to remember the total staked amounts for the pending addresses
            // for when these pending addresses are finalized by `ValidatorSetHbbft.finalizeChange()`.
            miningAddresses = validatorSetContract.getPendingValidators();
            for (i = 0; i < miningAddresses.length; i++) {
                _snapshotPoolStakeAmounts(stakingContract, nextStakingEpoch, miningAddresses[i]);
            }

            // We need to remember the total staked amounts for the current validators
            // for the possible case when these validators continue to be validators
            // throughout the upcoming staking epoch (if the new validator set is not finalized
            // for some reason)
            miningAddresses = validatorSetContract.getValidators();
            for (i = 0; i < miningAddresses.length; i++) {
                _snapshotPoolStakeAmounts(stakingContract, nextStakingEpoch, miningAddresses[i]);
            }
            // Remember validator's min reward percent for the upcoming staking epoch
            validatorMinRewardPercent[nextStakingEpoch] = VALIDATOR_MIN_REWARD_PERCENT;

            // the rewards got distributed, 
            // we now can finalize the epoch and start with a new one.
            validatorSetContract.finalizeChange();

            emit CoinsRewarded(nativeTotalRewardAmount);
            return 0;

        } else {

            uint256 phaseTransitionTime = stakingContract.startTimeOfNextPhaseTransition();
            uint256 currentTimestamp = validatorSetContract.getCurrentTimestamp();

            
            //we are in a transition to phase 2 if the time for it arrived,
            // and we do not have pendingValidators yet.
            bool isPhaseTransition = 
                currentTimestamp >= phaseTransitionTime 
                && validatorSetContract.getPendingValidators().length == 0;

            if (isPhaseTransition) {
                // Choose new validators
                validatorSetContract.newValidatorSet();
            } else if (currentTimestamp >= stakingContract.stakingFixedEpochEndTime() ) {
                validatorSetContract.handleFailedKeyGeneration();
            }
        }
    }

    // =============================================== Getters ========================================================
    /// @dev Returns an array of epoch numbers for which the specified pool (mining address)
    /// got a non-zero reward.
    function epochsPoolGotRewardFor(address _miningAddress)
    public
    view
    returns(uint256[] memory) {
        return _epochsPoolGotRewardFor[_miningAddress];
    }

    /// @dev Returns a boolean flag indicating if the `initialize` function has been called.
    function isInitialized()
    public
    view
    returns(bool) {
        return validatorSetContract != IValidatorSetHbbft(0);
    }

    /// @dev Returns an array of epoch numbers for which the specified staker
    /// can claim a reward from the specified pool by the `StakingHbbft.claimReward` function.
    /// @param _poolStakingAddress The pool staking address.
    /// @param _staker The staker's address (delegator or candidate/validator).
    function epochsToClaimRewardFrom(
        address _poolStakingAddress,
        address _staker
    )
    public
    view
    returns(uint256[] memory epochsToClaimFrom) {
        address miningAddress = validatorSetContract.miningByStakingAddress(_poolStakingAddress);
        IStakingHbbft stakingContract = IStakingHbbft(validatorSetContract.stakingContract());
        bool isDelegator = _poolStakingAddress != _staker;
        uint256 firstEpoch;
        uint256 lastEpoch;

        if (isDelegator) {
            firstEpoch = stakingContract.stakeFirstEpoch(_poolStakingAddress, _staker);
            if (firstEpoch == 0) {
                return (new uint256[](0));
            }
            lastEpoch = stakingContract.stakeLastEpoch(_poolStakingAddress, _staker);
        }

        uint256[] storage epochs = _epochsPoolGotRewardFor[miningAddress];
        uint256 length = epochs.length;

        uint256[] memory tmp = new uint256[](length);
        uint256 tmpLength = 0;
        uint256 i;

        for (i = 0; i < length; i++) {
            uint256 epoch = epochs[i];
            if (isDelegator) {
                if (epoch < firstEpoch) {
                    // If the delegator staked for the first time before
                    // the `epoch`, skip this staking epoch
                    continue;
                }
                if (lastEpoch <= epoch && lastEpoch != 0) {
                    // If the delegator withdrew all their stake before the `epoch`,
                    // don't check this and following epochs since it makes no sense
                    break;
                }
            }
            if (!stakingContract.rewardWasTaken(_poolStakingAddress, _staker, epoch)) {
                tmp[tmpLength++] = epoch;
            }
        }

        epochsToClaimFrom = new uint256[](tmpLength);
        for (i = 0; i < tmpLength; i++) {
            epochsToClaimFrom[i] = tmp[i];
        }
    }

    /// @dev Returns the reward coefficient for the specified validator. The given value should be divided by 10000
    /// to get the value of the reward percent (since EVM doesn't support floating values). If the specified staking
    /// address is an address of a candidate that is not about to be a validator in the upcoming staking epoch
    /// the potentially possible reward coefficient is returned.
    /// @param _stakingAddress The staking address of the validator/candidate
    /// pool for which the getter must return the coefficient.
    function validatorRewardPercent(address _stakingAddress)
    public
    view
    returns(uint256) {
        IStakingHbbft stakingContract = IStakingHbbft(validatorSetContract.stakingContract());
        uint256 stakingEpoch = stakingContract.stakingEpoch();

        if (stakingEpoch == 0) {
            // No one gets a reward for the initial staking epoch, so we return zero.
            return 0;
        }

        address miningAddress = validatorSetContract.miningByStakingAddress(_stakingAddress);

        if (validatorSetContract.isValidatorOrPending(miningAddress)) {
            // For the validator or  the candidate that is about to be a validator in the upcoming epoch...
            // ...we return the coefficient based on snapshotted total amounts.
            return validatorShare(
                stakingEpoch,
                snapshotPoolValidatorStakeAmount[stakingEpoch][miningAddress],
                snapshotPoolTotalStakeAmount[stakingEpoch][miningAddress],
                REWARD_PERCENT_MULTIPLIER
            );
        }

        // For a pool that is neither a validator not a pending one,
        // we return the potentially possible reward coefficient
        return validatorShare(
            stakingEpoch,
            stakingContract.stakeAmount(_stakingAddress, _stakingAddress),
            stakingContract.stakeAmountTotal(_stakingAddress),
            REWARD_PERCENT_MULTIPLIER
        );
    }

    /// @dev Calculates delegator's share for the given pool reward amount and the specified staking epoch.
    /// Used by the `StakingHbbft.claimReward` function.
    /// @param _stakingEpoch The number of staking epoch.
    /// @param _delegatorStaked The amount staked by a delegator.
    /// @param _validatorStaked The amount staked by a validator.
    /// @param _totalStaked The total amount staked by a validator and their delegators.
    /// @param _poolReward The value of pool reward.
    function delegatorShare(
        uint256 _stakingEpoch,
        uint256 _delegatorStaked,
        uint256 _validatorStaked,
        uint256 _totalStaked,
        uint256 _poolReward
    )
    public
    view
    returns(uint256) {
        if (_delegatorStaked == 0 || _validatorStaked == 0 || _totalStaked == 0) {
            return 0;
        }
        uint256 share = 0;
        uint256 delegatorsStaked = _totalStaked >= _validatorStaked ? _totalStaked - _validatorStaked : 0;
        uint256 validatorMinPercent = validatorMinRewardPercent[_stakingEpoch];
        if (_validatorStaked * (100 - validatorMinPercent) > delegatorsStaked * validatorMinPercent) {
            // Validator has more than validatorMinPercent %
            share = _poolReward * _delegatorStaked / _totalStaked;
        } else {
            // Validator has validatorMinPercent %
            share = _poolReward * _delegatorStaked * (100 - validatorMinPercent) / (delegatorsStaked * 100);
        }
        return share;
    }

    /// @dev Calculates validator's share for the given pool reward amount and the specified staking epoch.
    /// Used by the `validatorRewardPercent` and `StakingHbbft.claimReward` functions.
    /// @param _stakingEpoch The number of staking epoch.
    /// @param _validatorStaked The amount staked by a validator.
    /// @param _totalStaked The total amount staked by a validator and their delegators.
    /// @param _poolReward The value of pool reward.
    function validatorShare(
        uint256 _stakingEpoch,
        uint256 _validatorStaked,
        uint256 _totalStaked,
        uint256 _poolReward
    )
    public
    view
    returns(uint256) {
        if (_validatorStaked == 0 || _totalStaked == 0) {
            return 0;
        }
        uint256 share = 0;
        uint256 delegatorsStaked = _totalStaked >= _validatorStaked ? _totalStaked - _validatorStaked : 0;
        uint256 validatorMinPercent = validatorMinRewardPercent[_stakingEpoch];
        if (_validatorStaked * (100 - validatorMinPercent) > delegatorsStaked * validatorMinPercent) {
            // Validator has more than validatorMinPercent %
            share = _poolReward * _validatorStaked / _totalStaked;
        } else {
            // Validator has validatorMinPercent %
            share = _poolReward * validatorMinPercent / 100;
        }
        return share;
    }

    // ============================================== Internal ========================================================


    /// @dev Distributes rewards among pools at the latest block of a staking epoch.
    /// This function is called by the `reward` function.
    /// @param _stakingEpoch The number of the current staking epoch.
    /// @return Returns the reward amount in native coins needed to be minted
    /// and accrued to the balance of this contract.
    function _distributeRewards(uint256 _stakingEpoch)
    internal
    returns(uint256) {
        
        address[] memory validators = validatorSetContract.getValidators();

        uint256 numValidators = validators.length;
        require(numValidators != 0, "Empty Validator list");

        uint256 deltaPotShare = deltaPot / deltaPotPayoutFraction;
        deltaPot -= deltaPotShare;

        // we could reuse the deltaPotShare variable here, to combat the "stack to deep" problem.
        uint256 reinsertPotShare = reinsertPot / reinsertPotPayoutFraction;
        reinsertPot -= reinsertPotShare;

        uint256 totalReward = deltaPotShare + reinsertPotShare + nativeRewardUndistributed;

        if (totalReward == 0) {
            return 0;
        }
        
        // we calculate the governance share here, and store it in the distributeAmount variable.
        // the distributedAmount variable is later resused to track all distributed shares 
        // in order to handle division results in a correct way.
        // we can not write clean code here, because of EVMs restriction to use only 16 local variables.
        uint256 distributedAmount = totalReward * governancePotShareNominator / governancePotShareDenominator;
    
        governancePotAddress.transfer(distributedAmount);

        uint256 rewardToDistribute = totalReward - distributedAmount;

        // Indicates whether the validator is entitled to share the rewartds or not.
        bool[] memory isRewardedValidator = new bool[](numValidators);
        // Number of validators that are being rewarded.
        uint256 numRewardedValidators;

        for (uint256 i = 0; i < validators.length; i++) {
            if (
                !validatorSetContract.isValidatorBanned(validators[i]) &&
                snapshotPoolValidatorStakeAmount[_stakingEpoch][validators[i]] != 0
            ) {
                isRewardedValidator[i] = true;
                numRewardedValidators++;
            }
        }

        // No rewards distributed in this epoch
        if (numRewardedValidators == 0){
            return 0;
        }

        // Share the reward equally among the validators.
        uint256 poolReward = rewardToDistribute / numRewardedValidators;

        if (poolReward != 0) {
            for (uint256 i = 0; i < numValidators; i++) {
                if (isRewardedValidator[i]){
                    //DEBUG: this require has been added for debug reasons.
                    require(epochPoolNativeReward[_stakingEpoch][validators[i]] == 0, 
                        'cant distribute rewards: there is already a pool reward defined for this epoch and validator');
                    epochPoolNativeReward[_stakingEpoch][validators[i]] = poolReward;
                    
                    distributedAmount += poolReward;

                    _epochsPoolGotRewardFor[validators[i]].push(_stakingEpoch);
                }
            }
        }

        nativeRewardUndistributed = totalReward - distributedAmount;

        return distributedAmount;
        
    }

    /// @dev Makes snapshots of total amount staked into the specified pool
    /// before the specified staking epoch. Used by the `reward` function.
    /// @param _stakingContract The address of the `StakingHbbft` contract.
    /// @param _stakingEpoch The number of upcoming staking epoch.
    /// @param _miningAddress The mining address of the pool.
    function _snapshotPoolStakeAmounts(
        IStakingHbbft _stakingContract,
        uint256 _stakingEpoch,
        address _miningAddress
    )
    internal {
        if (snapshotPoolTotalStakeAmount[_stakingEpoch][_miningAddress] != 0) {
            return;
        }
        address stakingAddress = validatorSetContract.stakingByMiningAddress(_miningAddress);
        uint256 totalAmount = _stakingContract.stakeAmountTotal(stakingAddress);
        if (totalAmount == 0) {
            return;
        }
        snapshotPoolTotalStakeAmount[_stakingEpoch][_miningAddress] = totalAmount;
        snapshotPoolValidatorStakeAmount[_stakingEpoch][_miningAddress] =
            _stakingContract.stakeAmount(stakingAddress, stakingAddress);
    }

    /// @dev Called by the `transferReward` of a child contract to transfer native coins
    /// from the balance of the `BlockRewardHbbft` contract to the specified address as a reward.
    /// @param _amount The amount of native coins to transfer as a reward.
    /// @param _to The target address to transfer the amounts to.
    function _transferNativeReward(uint256 _amount, address payable _to)
    internal {
        if (_amount != 0 && !_to.send(_amount)) {
            // We use the `Sacrifice` trick to be sure the coins can be 100% sent to the receiver.
            // Otherwise, if the receiver is a contract which has a revert in its fallback function,
            // the sending will fail.
            (new Sacrifice).value(_amount)(_to);
        }
    }
}
