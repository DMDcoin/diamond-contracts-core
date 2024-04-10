// SPDX-License-Identifier: MIT
pragma solidity =0.8.17;

import "./base/StakingHbbftBase.sol";
import "./interfaces/IBlockRewardHbbftCoins.sol";

contract Sacrifice2 {
    constructor(address payable _recipient) payable {
        selfdestruct(_recipient);
    }
}

/// @dev Implements staking and withdrawal logic.
contract StakingHbbft is StakingHbbftBase {
    // =============================================== Storage ========================================================

    /**
     * @dev Represents a parameter range for a specific getter function.
     * @param getter The getter function signature.
     * @param range The range of values for the parameter.
     */
    struct ParameterRange {
        bytes4 getter;
        uint256[] range;
    }

    /**
     * @dev A mapping that stores the allowed parameter ranges for each function signature.
     */
    mapping(bytes4 => ParameterRange) public allowedParameterRange;

    // ================================================ Events ========================================================

    /// @dev Emitted by the `claimReward` function to signal the staker withdrew the specified
    /// amount of native coins from the specified pool for the specified staking epoch.
    /// @param fromPoolStakingAddress The pool from which the `staker` withdrew the amount.
    /// @param staker The address of the staker that withdrew the amount.
    /// @param stakingEpoch The serial number of the staking epoch for which the claim was made.
    /// @param nativeCoinsAmount The withdrawal amount of native coins.
    event ClaimedReward(
        address indexed fromPoolStakingAddress,
        address indexed staker,
        uint256 indexed stakingEpoch,
        uint256 nativeCoinsAmount
    );

    /**
     * @dev Emitted when the minimum stake for a delegator is updated.
     * @param minStake The new minimum stake value.
     */
    event SetDelegatorMinStake(uint256 minStake);

    /**
     * @dev Event emitted when changeable parameters are set.
     * @param setter The address of the setter.
     * @param getter The address of the getter.
     * @param params An array of uint256 values representing the parameters.
     */
    event SetChangeAbleParameter(
        string setter,
        string getter,
        uint256[] params
    );

    /**
     * @dev Emitted when changeable parameters are removed.
     * @param funcSelector The function selector of the removed changeable parameters.
     */
    event RemoveChangeAbleParameter(string funcSelector);

    // ============================================== Modifiers =======================================================

    /**
     * @dev Modifier to check if a new value is within the allowed range.
     * @param newVal The new value to be checked.
     * @notice This modifier is used to ensure that the new value is within the allowed range.
     * If the new value is not within the allowed range, the function using this modifier
     * will revert with an error message.
     */
    modifier withinAllowedRange(uint256 newVal) {
        require(isWithinAllowedRange(msg.sig, newVal), "new value not within allowed range");
        _;
    }

    // =============================================== Setters ========================================================

    /// @dev Withdraws a reward from the specified pool for the specified staking epochs
    /// to the staker address (msg.sender).
    /// @param _stakingEpochs The list of staking epochs in ascending order.
    /// If the list is empty, it is taken with `BlockRewardHbbft.epochsPoolGotRewardFor` getter.
    /// @param _poolStakingAddress The staking address of the pool from which the reward needs to be withdrawn.
    function claimReward(
        uint256[] memory _stakingEpochs,
        address _poolStakingAddress
    ) public gasPriceIsValid {
        address payable staker = payable(msg.sender);
        uint256 firstEpoch = 0;
        uint256 lastEpoch = 0;

        if (_poolStakingAddress != staker) {
            // this is a delegator
            firstEpoch = stakeFirstEpoch[_poolStakingAddress][staker];
            require(firstEpoch != 0, "Claim: first epoch can't be 0");
            lastEpoch = stakeLastEpoch[_poolStakingAddress][staker];
        }

        IBlockRewardHbbftCoins blockRewardContract = IBlockRewardHbbftCoins(
            validatorSetContract.blockRewardContract()
        );
        address miningAddress = validatorSetContract.miningByStakingAddress(
            _poolStakingAddress
        );
        uint256 rewardSum = 0;
        uint256 delegatorStake = 0;

        if (_stakingEpochs.length == 0) {
            _stakingEpochs = IBlockRewardHbbft(address(blockRewardContract))
                .epochsPoolGotRewardFor(miningAddress);
        }

        for (uint256 i = 0; i < _stakingEpochs.length; i++) {
            uint256 epoch = _stakingEpochs[i];

            require(
                i == 0 || epoch > _stakingEpochs[i - 1],
                "Claim: need strictly increasing order"
            );
            require(epoch < stakingEpoch, "Claim: only before current epoch");

            if (rewardWasTaken[_poolStakingAddress][staker][epoch]) continue;

            uint256 reward;

            if (_poolStakingAddress != staker) {
                // this is a delegator
                if (epoch < firstEpoch) {
                    // If the delegator staked for the first time after
                    // the `epoch`, skip this staking epoch
                    continue;
                }

                if (lastEpoch <= epoch && lastEpoch != 0) {
                    // If the delegator withdrew all their stake before the `epoch`,
                    // don't check this and following epochs since it makes no sense
                    break;
                }

                delegatorStake = _getDelegatorStake(
                    epoch,
                    firstEpoch,
                    delegatorStake,
                    _poolStakingAddress,
                    staker
                );
                firstEpoch = epoch + 1;

                reward = blockRewardContract.getDelegatorReward(
                    delegatorStake,
                    epoch,
                    miningAddress
                );
            } else {
                // this is a validator
                reward = blockRewardContract.getValidatorReward(
                    epoch,
                    miningAddress
                );
            }

            rewardSum = rewardSum + reward;

            rewardWasTaken[_poolStakingAddress][staker][epoch] = true;

            emit ClaimedReward(_poolStakingAddress, staker, epoch, reward);
        }

        blockRewardContract.transferReward(rewardSum, staker);
    }

    /**
     * @dev Sets the minimum stake required for delegators.
     * @param _minStake The new minimum stake amount.
     * Requirements:
     * - Only the contract owner can call this function.
     * - The stake amount must be within the allowed range.
     */
    function setDelegatorMinStake(uint256 _minStake)
        override
        external
        onlyOwner
        withinAllowedRange(_minStake)
    {
        delegatorMinStake = _minStake;
        emit SetDelegatorMinStake(_minStake);
    }

    /**
     * @dev Sets the allowed changeable parameter for a specific setter function.
     * @param setter The name of the setter function.
     * @param getter The name of the getter function.
     * @param params The array of allowed parameter values.
     * Requirements:
     * - Only the contract owner can call this function.
     */
    function setAllowedChangeableParameter(
        string memory setter,
        string memory getter,
        uint256[] memory params
    ) external onlyOwner {
        allowedParameterRange[bytes4(keccak256(bytes(setter)))] = ParameterRange(
            bytes4(keccak256(bytes(getter))),
            params
        );
        emit SetChangeAbleParameter(setter, getter, params);
    }

    /**
     * @dev Removes the allowed changeable parameter for a given function selector.
     * @param funcSelector The function selector for which the allowed changeable parameter should be removed.
     * Requirements:
     * - Only the contract owner can call this function.
     */
    function removeAllowedChangeableParameter(string memory funcSelector) external onlyOwner {
        delete allowedParameterRange[bytes4(keccak256(bytes(funcSelector)))];
        emit RemoveChangeAbleParameter(funcSelector);
    }

    // =============================================== Getters ========================================================

    /// @dev Returns reward amount in native coins for the specified pool, the specified staking epochs,
    /// and the specified staker address (delegator or validator).
    /// @param _stakingEpochs The list of staking epochs in ascending order.
    /// If the list is empty, it is taken with `BlockRewardHbbft.epochsPoolGotRewardFor` getter.
    /// @param _poolStakingAddress The staking address of the pool for which the amounts need to be returned.
    /// @param _staker The staker address (validator's staking address or delegator's address).
    function getRewardAmount(
        uint256[] memory _stakingEpochs,
        address _poolStakingAddress,
        address _staker
    ) public view returns (uint256) {
        uint256 firstEpoch = 0;
        uint256 lastEpoch = 0;

        if (_poolStakingAddress != _staker) {
            // this is a delegator
            firstEpoch = stakeFirstEpoch[_poolStakingAddress][_staker];
            require(
                firstEpoch != 0,
                "Unable to get reward amount if no first epoch."
            );
            lastEpoch = stakeLastEpoch[_poolStakingAddress][_staker];
        }

        IBlockRewardHbbftCoins blockRewardContract = IBlockRewardHbbftCoins(
            validatorSetContract.blockRewardContract()
        );
        address miningAddress = validatorSetContract.miningByStakingAddress(
            _poolStakingAddress
        );
        uint256 delegatorStake = 0;
        uint256 rewardSum = 0;

        if (_stakingEpochs.length == 0) {
            _stakingEpochs = IBlockRewardHbbft(address(blockRewardContract))
                .epochsPoolGotRewardFor(miningAddress);
        }

        for (uint256 i = 0; i < _stakingEpochs.length; i++) {
            uint256 epoch = _stakingEpochs[i];

            require(
                i == 0 || epoch > _stakingEpochs[i - 1],
                "internal Error: Staking Epochs required to be ordered."
            );
            require(
                epoch < stakingEpoch,
                "internal Error: epoch must not be lesser than current epoch."
            );

            if (rewardWasTaken[_poolStakingAddress][_staker][epoch]) continue;

            uint256 reward;

            if (_poolStakingAddress != _staker) {
                // this is a delegator
                if (epoch < firstEpoch) continue;
                if (lastEpoch <= epoch && lastEpoch != 0) break;

                delegatorStake = _getDelegatorStake(
                    epoch,
                    firstEpoch,
                    delegatorStake,
                    _poolStakingAddress,
                    _staker
                );
                firstEpoch = epoch + 1;

                reward = blockRewardContract.getDelegatorReward(
                    delegatorStake,
                    epoch,
                    miningAddress
                );
            } else {
                // this is a validator
                reward = blockRewardContract.getValidatorReward(
                    epoch,
                    miningAddress
                );
            }

            rewardSum += reward;
        }

        return rewardSum;
    }

    /**
     * @dev Checks if the given `newVal` is within the allowed range for the specified function selector.
     * @param funcSelector The function selector.
     * @param newVal The new value to be checked.
     * @return A boolean indicating whether the `newVal` is within the allowed range.
     */
    function isWithinAllowedRange(bytes4 funcSelector, uint256 newVal) public view returns(bool) {
        ParameterRange memory allowedRange = allowedParameterRange[funcSelector];
        if(allowedRange.range.length == 0) return false;
        uint256[] memory range = allowedRange.range;
        uint256 currVal = _getValueWithSelector(allowedRange.getter);
        bool currValFound;

        for (uint256 i = 0; i < range.length; i++) {
            if (range[i] == currVal) {
                currValFound = true;
                uint256 leftVal = (i > 0) ? range[i - 1] : range[0];
                uint256 rightVal = (i < range.length - 1) ? range[i + 1] : range[range.length - 1];
                if (newVal != leftVal && newVal != rightVal) return false;
                break;
            }
        }
        return currValFound;
    }

    // ============================================== Internal ========================================================

    /// @dev Sends coins from this contract to the specified address.
    /// @param _to The target address to send amount to.
    /// @param _amount The amount to send.
    function _sendWithdrawnStakeAmount(address payable _to, uint256 _amount)
        internal
        virtual
        override
    {
        // slither-disable-next-line arbitrary-send-eth
        if (!_to.send(_amount)) {
            // We use the `Sacrifice` trick to be sure the coins can be 100% sent to the receiver.
            // Otherwise, if the receiver is a contract which has a revert in its fallback function,
            // the sending will fail.
            (new Sacrifice2){value: _amount}(_to);
        }
    }

    /**
     * @dev Internal function to get the value of a contract state variable using a getter function.
     * @param getterSelector The selector of the getter function.
     * @return The value of the contract state variable.
     */
    function _getValueWithSelector(bytes4 getterSelector) private view returns (uint256) {
        bytes memory payload = abi.encodeWithSelector(getterSelector);
        (bool success, bytes memory result) = address(this).staticcall(payload);
        require(success, "Getter call failed");
        return abi.decode(result, (uint256));
    }
}
