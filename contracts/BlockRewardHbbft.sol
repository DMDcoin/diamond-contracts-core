pragma solidity =0.8.17;

import "./base/BlockRewardHbbftBase.sol";
import { ValueGuards } from "./ValueGuards.sol";
import "./interfaces/IBlockRewardHbbftCoins.sol";

contract BlockRewardHbbft is BlockRewardHbbftBase, IBlockRewardHbbftCoins, ValueGuards {
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
    ) public override onlyOwner {
        super.setAllowedChangeableParameter(setter, getter, params);
    }

    /**
     * @dev Removes the allowed changeable parameter for a given function selector.
     * @param funcSelector The function selector for which the allowed changeable parameter should be removed.
     * Requirements:
     * - Only the contract owner can call this function.
     */
    function removeAllowedChangeableParameter(string memory funcSelector) public override onlyOwner {
        super.removeAllowedChangeableParameter(funcSelector);
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
}
