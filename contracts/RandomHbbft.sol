pragma solidity ^0.5.16;

import "./interfaces/IRandomHbbft.sol";
import "./upgradeability/UpgradeabilityAdmin.sol";

/// @dev Stores and uppdates a random seed that is used to form a new validator set by the
/// `ValidatorSetHbbft.newValidatorSet` function.
contract RandomHbbft is UpgradeabilityAdmin, IRandomHbbft {

    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables and do not change their types!


    /// @dev The current random seed accumulated during RANDAO or another process
    /// (depending on implementation).
    uint256 public currentSeed;

    // ============================================== Modifiers =======================================================

    /// @dev Ensures the caller is the SYSTEM_ADDRESS. See https://wiki.parity.io/Validator-Set.html
    modifier onlySystem() {
        require(msg.sender == 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE, "Must be executed by System");
        _;
    }
    // =============================================== Setters ========================================================

    function setCurrentSeed(uint256 _currentSeed)
    external
    onlySystem {
        currentSeed = _currentSeed;
    }
}