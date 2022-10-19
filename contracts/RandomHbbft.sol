pragma solidity =0.8.17;

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
    modifier onlySystem() virtual {
        require(
            msg.sender == 0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE,
            "Must be executed by System"
        );
        _;
    }

    // =============================================== Setters ========================================================

    /// @dev The cooperative consens mechanism in HBBFT achieves to
    /// generate a seed, that cannot be predicted by the nodes,
    /// but can get used within smart contracts without having to wait for
    /// an additional block.
    /// this is one of the biggest benefits of HBBFT.
    /// When the nodes are able to decrypt the transaction,
    /// they know the seed, that can be used as random base for smart contract interactions.
    /// setCurrentSeed is always the first transaction within a block,
    /// and currentSeed is a public available value that can get used by all smart contracts.
    function setCurrentSeed(uint256 _currentSeed) external onlySystem {
        currentSeed = _currentSeed;
    }
}
