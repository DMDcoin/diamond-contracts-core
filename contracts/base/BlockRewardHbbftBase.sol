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

    /// @dev A number of blocks produced by the specified validator during the specified staking epoch
    /// (beginning from the block when the `finalizeChange` function is called until the latest block
    /// of the staking epoch. The results are used by the `_distributeRewards` function to track
    /// each validator's downtime (when a validator's node is not running and doesn't produce blocks).
    /// While the validator is banned, the block producing statistics is not accumulated for them.
    mapping(uint256 => mapping(address => uint256)) public blocksCreated;

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

    /// @dev The address of the `ValidatorSet` contract.
    IValidatorSetHbbft public validatorSetContract;

    // ================================================ Events ========================================================


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
        revert();
    }

    /// @dev Called by the `ValidatorSetHbbft.finalizeChange` to clear the values in
    /// the `blocksCreated` mapping for the current staking epoch and a new validator set.
    function clearBlocksCreated() external onlyValidatorSetContract {
        IStakingHbbft stakingContract = IStakingHbbft(validatorSetContract.stakingContract());
        uint256 stakingEpoch = stakingContract.stakingEpoch();
        address[] memory validators = validatorSetContract.getValidators();
        for (uint256 i = 0; i < validators.length; i++) {
            blocksCreated[stakingEpoch][validators[i]] = 0;
        }
    }

    /// @dev Initializes the contract at network startup.
    /// Can only be called by the constructor of the `InitializerHbbft` contract or owner.
    /// @param _validatorSet The address of the `ValidatorSetHbbft` contract.
    function initialize(address _validatorSet) external {
        require(_getCurrentBlockNumber() == 0 || msg.sender == _admin());
        require(!isInitialized());
        require(_validatorSet != address(0));
        validatorSetContract = IValidatorSetHbbft(_validatorSet);
        validatorMinRewardPercent[0] = VALIDATOR_MIN_REWARD_PERCENT;
    }

    /// @dev Called by the validator's node when producing and closing a block,
    /// see https://wiki.parity.io/Block-Reward-Contract.html.
    /// This function performs all of the automatic operations needed for accumulating block producing statistics,
    /// starting a new staking epoch, snapshotting staking amounts for the upcoming staking epoch,
    /// and rewards distributing at the end of a staking epoch.
    function reward(address[] calldata benefactors, uint16[] calldata kind)
        external
        onlySystem
        returns(address[] memory receiversNative, uint256[] memory rewardsNative)
    {
        if (benefactors.length != kind.length || benefactors.length != 1 || kind[0] != 0) {
            return (new address[](0), new uint256[](0));
        }

        // Check if the validator exists
        if (!validatorSetContract.isValidator(benefactors[0])) {
            return (new address[](0), new uint256[](0));
        }

        IStakingHbbft stakingContract = IStakingHbbft(validatorSetContract.stakingContract());
        uint256 stakingEpoch = stakingContract.stakingEpoch();
        uint256 stakingFixedEpochEndBlock = stakingContract.stakingFixedEpochEndBlock();
        uint256 nativeTotalRewardAmount = 0;

        if (validatorSetContract.validatorSetApplyBlock() != 0) {
            if (stakingEpoch != 0 && !validatorSetContract.isValidatorBanned(benefactors[0])) {
                // Accumulate blocks producing statistics for each of the
                // active validators during the current staking epoch. This
                // statistics is used by the `_distributeRewards` function
                blocksCreated[stakingEpoch][benefactors[0]]++;
            }
        }

        if (_getCurrentBlockNumber() == stakingFixedEpochEndBlock) {
            // Distribute rewards among validator pools
            if (stakingEpoch != 0) {
                nativeTotalRewardAmount = _distributeRewards(
                    stakingContract,
                    stakingEpoch,
                    stakingFixedEpochEndBlock
                );
            }


             // Snapshot total amounts staked into the pools
            uint256 i;
            uint256 nextStakingEpoch = stakingEpoch + 1;
            address[] memory miningAddresses;
            
            // Choose new validators
            validatorSetContract.newValidatorSet();
            
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

        }

    }

    // =============================================== Getters ========================================================

    /// @dev Returns an array of epoch numbers for which the specified pool (mining address)
    /// got a non-zero reward.
    function epochsPoolGotRewardFor(address _miningAddress) public view returns(uint256[] memory) {
        return _epochsPoolGotRewardFor[_miningAddress];
    }

    /// @dev Returns a boolean flag indicating if the `initialize` function has been called.
    function isInitialized() public view returns(bool) {
        return validatorSetContract != IValidatorSetHbbft(0);
    }

    /// @dev Returns an array of epoch numbers for which the specified staker
    /// can claim a reward from the specified pool by the `StakingHbbft.claimReward` function.
    /// @param _poolStakingAddress The pool staking address.
    /// @param _staker The staker's address (delegator or candidate/validator).
    function epochsToClaimRewardFrom(
        address _poolStakingAddress,
        address _staker
    ) public view returns(uint256[] memory epochsToClaimFrom) {
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
    /// to get the value of the reward percent (since EVM doesn't support float values). If the specified staking
    /// address is an address of a candidate that is not about to be a validator on the current staking epoch
    /// the potentially possible reward coefficient is returned.
    /// @param _stakingAddress The staking address of the validator/candidate
    /// pool for which the getter must return the coefficient.
    function validatorRewardPercent(address _stakingAddress) public view returns(uint256) {
        IStakingHbbft stakingContract = IStakingHbbft(validatorSetContract.stakingContract());
        uint256 stakingEpoch = stakingContract.stakingEpoch();

        if (stakingEpoch == 0) {
            // No one gets a reward for the initial staking epoch, so we return zero
            return 0;
        }

        address miningAddress = validatorSetContract.miningByStakingAddress(_stakingAddress);

        if (validatorSetContract.isValidator(miningAddress)) {
            // For the validator we return the coefficient based on
            // snapshotted total amounts
            return validatorShare(
                stakingEpoch,
                snapshotPoolValidatorStakeAmount[stakingEpoch][miningAddress],
                snapshotPoolTotalStakeAmount[stakingEpoch][miningAddress],
                REWARD_PERCENT_MULTIPLIER
            );
        }

        if (validatorSetContract.validatorSetApplyBlock() == 0) {
            // For the candidate that is about to be a validator on the current
            // staking epoch we return the coefficient based on snapshotted total amounts

            address[] memory miningAddresses;
            uint256 i;

            miningAddresses = validatorSetContract.getPendingValidators();
            for (i = 0; i < miningAddresses.length; i++) {
                if (miningAddress == miningAddresses[i]) {
                    return validatorShare(
                        stakingEpoch,
                        snapshotPoolValidatorStakeAmount[stakingEpoch][miningAddress],
                        snapshotPoolTotalStakeAmount[stakingEpoch][miningAddress],
                        REWARD_PERCENT_MULTIPLIER
                    );
                }
            }

            miningAddresses = validatorSetContract.getPendingValidators();
            for (i = 0; i < miningAddresses.length; i++) {
                if (miningAddress == miningAddresses[i]) {
                    return validatorShare(
                        stakingEpoch,
                        snapshotPoolValidatorStakeAmount[stakingEpoch][miningAddress],
                        snapshotPoolTotalStakeAmount[stakingEpoch][miningAddress],
                        REWARD_PERCENT_MULTIPLIER
                    );
                }
            }
        }

        // For the candidate that is not about to be a validator on the current staking epoch,
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
    ) public view returns(uint256) {
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
    ) public view returns(uint256) {
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

    uint256 internal constant VALIDATOR_MIN_REWARD_PERCENT = 30; // 30%
    uint256 internal constant REWARD_PERCENT_MULTIPLIER = 1000000;

    /// @dev Distributes rewards in native coins among pools at the latest block of a staking epoch.
    /// This function is called by the `_distributeRewards` function.
    /// @param _stakingEpoch The number of the current staking epoch.
    /// @param _totalRewardShareNum Numerator of the total reward share.
    /// @param _totalRewardShareDenom Denominator of the total reward share.
    /// @param _validators The array of the current validators (their mining addresses).
    /// @param _blocksCreatedShareNum Numerators of blockCreated share for each of the validators.
    /// @param _blocksCreatedShareDenom Denominator of blockCreated share.
    /// @return Returns the amount of native coins which need to be minted.
    function _distributeNativeRewards(
        uint256 _stakingEpoch,
        uint256 _totalRewardShareNum,
        uint256 _totalRewardShareDenom,
        address[] memory _validators,
        uint256[] memory _blocksCreatedShareNum,
        uint256 _blocksCreatedShareDenom
    ) internal returns(uint256) {
        uint256 totalReward = nativeRewardUndistributed;

        if (totalReward == 0) {
            return 0;
        }

        uint256 rewardToDistribute = 0;
        uint256 distributedAmount = 0;

        if (_blocksCreatedShareDenom != 0 && _totalRewardShareDenom != 0) {
            rewardToDistribute = totalReward * _totalRewardShareNum / _totalRewardShareDenom;

            if (rewardToDistribute != 0) {
                for (uint256 i = 0; i < _validators.length; i++) {
                    uint256 poolReward =
                        rewardToDistribute * _blocksCreatedShareNum[i] / _blocksCreatedShareDenom;
                    epochPoolNativeReward[_stakingEpoch][_validators[i]] = poolReward;
                    distributedAmount += poolReward;
                    if (poolReward != 0) {
                        _epochsPoolGotRewardFor[_validators[i]].push(_stakingEpoch);
                    }
                }
            }
        }

        nativeRewardUndistributed = totalReward - distributedAmount;

        return distributedAmount;
    }

    /// @dev Distributes rewards among pools at the latest block of a staking epoch.
    /// This function is called by the `reward` function.
    /// @param _stakingContract The address of the StakingHbbft contract.
    /// @param _stakingEpoch The number of the current staking epoch.
    /// @param _stakingFixedEpochEndBlock The number of the latest block before key generation begins.
    /// @return Returns the reward amount in native coins needed to be minted
    /// and accrued to the balance of this contract.
    function _distributeRewards(
        IStakingHbbft _stakingContract,
        uint256 _stakingEpoch,
        uint256 _stakingFixedEpochEndBlock
    ) internal returns(uint256 nativeTotalRewardAmount) {
        address[] memory validators = validatorSetContract.getValidators();

        // Determine shares
        uint256 totalRewardShareNum = 0;
        uint256 totalRewardShareDenom = 1;
        uint256 realFinalizeBlock = validatorSetContract.validatorSetApplyBlock();
        if (realFinalizeBlock != 0) {
            uint256 idealFinalizeBlock =
                _stakingContract.stakingEpochStartBlock() + validatorSetContract.MAX_VALIDATORS()*2/3 + 1;

            if (realFinalizeBlock < idealFinalizeBlock) {
                realFinalizeBlock = idealFinalizeBlock;
            }

            totalRewardShareNum = _stakingFixedEpochEndBlock - realFinalizeBlock + 1;
            totalRewardShareDenom = _stakingFixedEpochEndBlock - idealFinalizeBlock + 1;
        }

        uint256[] memory blocksCreatedShareNum = new uint256[](validators.length);
        uint256 blocksCreatedShareDenom = 0;
        if (totalRewardShareNum != 0) {
            for (uint256 i = 0; i < validators.length; i++) {
                if (
                    !validatorSetContract.isValidatorBanned(validators[i]) &&
                    snapshotPoolValidatorStakeAmount[_stakingEpoch][validators[i]] != 0
                ) {
                    blocksCreatedShareNum[i] = blocksCreated[_stakingEpoch][validators[i]];
                } else {
                    blocksCreatedShareNum[i] = 0;
                }
                blocksCreatedShareDenom += blocksCreatedShareNum[i];
            }
        }

        // Distribute native coins among pools
        nativeTotalRewardAmount = _distributeNativeRewards(
            _stakingEpoch,
            totalRewardShareNum,
            totalRewardShareDenom,
            validators,
            blocksCreatedShareNum,
            blocksCreatedShareDenom
        );
        
    }

    /// @dev Returns the current block number. Needed mostly for unit tests.
    function _getCurrentBlockNumber() internal view returns(uint256) {
        return block.number;
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
    ) internal {
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
    function _transferNativeReward(uint256 _amount, address payable _to) internal {
        if (_amount != 0 && !_to.send(_amount)) {
            // We use the `Sacrifice` trick to be sure the coins can be 100% sent to the receiver.
            // Otherwise, if the receiver is a contract which has a revert in its fallback function,
            // the sending will fail.
            (new Sacrifice).value(_amount)(_to);
        }
    }
}
