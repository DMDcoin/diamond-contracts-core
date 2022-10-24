pragma solidity =0.8.17;

interface IValidatorSetHbbft {
    // Key Generation states of validator.
    enum KeyGenMode {
        NotAPendingValidator,
        WritePart,
        WaitForOtherParts,
        WriteAck,
        WaitForOtherAcks,
        AllKeysDone
    }

    function initialize(
        address,
        address,
        address,
        address,
        address[] calldata,
        address[] calldata
    ) external;

    function announceAvailability(uint256, bytes32) external;

    function finalizeChange() external;

    function newValidatorSet() external;

    function removeMaliciousValidators(address[] calldata) external;

    function setStakingAddress(address, address) external;

    function handleFailedKeyGeneration() external;

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

    function getCurrentTimestamp() external view returns (uint256);

    function validatorAvailableSince(address) external view returns (uint256);
}
