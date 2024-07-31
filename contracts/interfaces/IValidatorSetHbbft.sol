// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

interface IValidatorSetHbbft {
    struct ValidatorSetParams {
        address blockRewardContract;
        address randomContract;
        address stakingContract;
        address keyGenHistoryContract;
        address bonusScoreContract;
        uint256 validatorInactivityThreshold;
    }

    // Key Generation states of validator.
    enum KeyGenMode {
        NotAPendingValidator,
        WritePart,
        WaitForOtherParts,
        WriteAck,
        WaitForOtherAcks,
        AllKeysDone
    }

    function announceAvailability(uint256, bytes32) external;

    function finalizeChange() external;

    function newValidatorSet() external;

    function removeMaliciousValidators(address[] calldata) external;

    function setStakingAddress(address, address) external;

    function handleFailedKeyGeneration() external;

    function isFullHealth() external view returns (bool);

    function areDelegatorsBanned(address) external view returns (bool);

    function blockRewardContract() external view returns (address);

    function canCallAnnounceAvailability(address _miningAddress)
        external
        view
        returns (bool);

    function getPendingValidators() external view returns (address[] memory);

    function getPreviousValidators() external view returns (address[] memory);

    function getValidators() external view returns (address[] memory);

    function isReportValidatorValid(address) external view returns (bool);

    function isValidator(address) external view returns (bool);

    function isValidatorBanned(address) external view returns (bool);

    function isValidatorOrPending(address) external view returns (bool);

    function isPendingValidator(address) external view returns (bool);

    function getPendingValidatorKeyGenerationMode(address)
        external
        view
        returns (KeyGenMode);

    function maxValidators() external view returns (uint256);

    function miningByStakingAddress(address) external view returns (address);

    function randomContract() external view returns (address);

    function notifyUnavailability(address) external;

    function reportMaliciousCallable(
        address,
        address,
        uint256
    ) external view returns (bool, bool);

    function stakingByMiningAddress(address) external view returns (address);

    function publicKeyByStakingAddress(address)
        external
        view
        returns (bytes memory);

    function getPublicKey(address) external view returns (bytes memory);

    function getStakingContract() external view returns (address);

    function validatorAvailableSince(address) external view returns (uint256);

    function isValidatorAbandoned(address) external view returns (bool);

    function getValidatorCountSweetSpot(uint256)
        external
        view
        returns (uint256);

    function getCurrentValidatorsCount() external view returns (uint256);
}
