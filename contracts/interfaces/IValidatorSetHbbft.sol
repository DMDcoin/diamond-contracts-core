pragma solidity ^0.5.16;


interface IValidatorSetHbbft {

    enum KeyGenMode { NotAPendingValidator, WritePart, WaitForOtherParts, WriteAck, WaitForOtherAcks, AllKeysDone }

    function initialize(
        address,
        address,
        address,
        address,
        address[] calldata,
        address[] calldata
    ) external;
    function finalizeChange() external;
    function newValidatorSet() external;
    function removeMaliciousValidators(address[] calldata) external;
    function setStakingAddress(address, address) external;
    function areDelegatorsBanned(address) external view returns(bool);
    function blockRewardContract() external view returns(address);
    function getPendingValidators() external view returns(address[] memory);
    function getPreviousValidators() external view returns(address[] memory);
    function getValidators() external view returns(address[] memory);
    function isReportValidatorValid(address) external view returns(bool);
    function isValidator(address) external view returns(bool);
    function isValidatorBanned(address) external view returns(bool);
    function isValidatorOrPending(address) external view returns(bool);
    function isPendingValidator(address) external view returns(bool);
    function getPendingValidatorKeyGenerationMode(address) external view returns(KeyGenMode);
    function MAX_VALIDATORS() external view returns(uint256); // solhint-disable-line func-name-mixedcase
    function miningByStakingAddress(address) external view returns(address);
    function randomContract() external view returns(address);
    function reportMaliciousCallable(address, address, uint256) external view returns(bool, bool);
    function stakingByMiningAddress(address) external view returns(address);
    function publicKeyByStakingAddress(address) external view returns(bytes memory);
    function getPublicKey(address) external view returns(bytes memory);
    function stakingContract() external view returns(address);
    function getCurrentTimestamp() external view returns(uint256);
}
