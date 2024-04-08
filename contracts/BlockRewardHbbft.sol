pragma solidity =0.8.17;

import "./base/BlockRewardHbbftBase.sol";
import "./interfaces/IBlockRewardHbbftCoins.sol";

contract BlockRewardHbbft is BlockRewardHbbftBase, IBlockRewardHbbftCoins {
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

    /// @dev Called by the `StakingHbbft.claimReward` function to transfer native coins
    /// from the balance of the `BlockRewardHbbft` contract to the specified address as a reward.
    /// @param _nativeCoins The amount of native coins to transfer as a reward.
    /// @param _to The target address to transfer the amounts to.
    function transferReward(uint256 _nativeCoins, address payable _to)
        external
        onlyStakingContract
    {
        _transferNativeReward(_nativeCoins, _to);
    }

    /**
     * @dev Sets the value of the governancePotShareNominator variable.
     * @param _shareNominator The new value for the governancePotShareNominator.
     * Requirements:
     * - Only the contract owner can call this function.
     * - The _shareNominator value must be within the allowed range.
     */
    function setGovernancePotShareNominator(
        uint256 _shareNominator
    ) public onlyOwner withinAllowedRange(_shareNominator) {
        governancePotShareNominator = _shareNominator;
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
    }

    /**
     * @dev Removes the allowed changeable parameter for a given function selector.
     * @param funcSelector The function selector for which the allowed changeable parameter should be removed.
     * Requirements:
     * - Only the contract owner can call this function.
     */
    function removeAllowedChangeableParameter(string memory funcSelector) external onlyOwner {
        delete allowedParameterRange[bytes4(keccak256(bytes(funcSelector)))];
    }

    // =============================================== Getters ========================================================

    /// @dev Returns the reward amount in native coins for
    /// some delegator with the specified stake amount placed into the specified
    /// pool before the specified staking epoch. Used by the `StakingHbbft.claimReward` function.
    /// @param _delegatorStake The stake amount placed by some delegator into the `_poolMiningAddress` pool.
    /// @param _stakingEpoch The serial number of staking epoch.
    /// @param _poolMiningAddress The pool mining address.
    /// @return nativeReward `uint256 nativeReward` - the reward amount in native coins.
    function getDelegatorReward(
        uint256 _delegatorStake,
        uint256 _stakingEpoch,
        address _poolMiningAddress
    ) external view returns (uint256 nativeReward) {
        uint256 validatorStake = snapshotPoolValidatorStakeAmount[
            _stakingEpoch
        ][_poolMiningAddress];
        uint256 totalStake = snapshotPoolTotalStakeAmount[_stakingEpoch][
            _poolMiningAddress
        ];

        nativeReward = delegatorShare(
            _stakingEpoch,
            _delegatorStake,
            validatorStake,
            totalStake,
            epochPoolNativeReward[_stakingEpoch][_poolMiningAddress]
        );
    }

    /// @dev Returns the reward amount in native coins for
    /// the specified validator and for the specified staking epoch.
    /// Used by the `StakingHbbft.claimReward` function.
    /// @param _stakingEpoch The serial number of staking epoch.
    /// @param _poolMiningAddress The pool mining address.
    /// @return nativeReward `uint256 nativeReward` - the reward amount in native coins.
    function getValidatorReward(
        uint256 _stakingEpoch,
        address _poolMiningAddress
    ) external view returns (uint256 nativeReward) {
        uint256 validatorStake = snapshotPoolValidatorStakeAmount[
            _stakingEpoch
        ][_poolMiningAddress];
        uint256 totalStake = snapshotPoolTotalStakeAmount[_stakingEpoch][
            _poolMiningAddress
        ];

        nativeReward = validatorShare(
            _stakingEpoch,
            validatorStake,
            totalStake,
            epochPoolNativeReward[_stakingEpoch][_poolMiningAddress]
        );
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
