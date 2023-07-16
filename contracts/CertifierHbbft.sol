pragma solidity =0.8.17;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/ICertifier.sol";
import "./interfaces/IStakingHbbft.sol";
import "./interfaces/IValidatorSetHbbft.sol";

/// @dev Allows validators to use a zero gas price for their service transactions
/// (see https://wiki.parity.io/Permissioning.html#gas-price for more info).
contract CertifierHbbft is Initializable, OwnableUpgradeable, ICertifier {
    // =============================================== Storage ========================================================

    // WARNING: since this contract is upgradeable, do not remove
    // existing storage variables, do not change their order,
    // and do not change their types!

    mapping(address => bool) internal _certified;

    /// @dev The address of the `ValidatorSetHbbft` contract.
    IValidatorSetHbbft public validatorSetContract;

    // ================================================ Events ========================================================

    /// @dev Emitted by the `certify` function when the specified address is allowed to use a zero gas price
    /// for its transactions.
    /// @param who Specified address allowed to make zero gas price transactions.
    event Confirmed(address indexed who);

    /// @dev Emitted by the `revoke` function when the specified address is denied using a zero gas price
    /// for its transactions.
    /// @param who Specified address for which zero gas price transactions are denied.
    event Revoked(address indexed who);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // Prevents initialization of implementation contract
        _disableInitializers();
    }

    // =============================================== Setters =======================================================

    /// @dev Initializes the contract at network startup.
    /// Can only be called by the constructor of the `InitializerHbbft` contract or owner.
    /// @param _certifiedAddresses The addresses for which a zero gas price must be allowed.
    /// @param _validatorSet The address of the `ValidatorSetHbbft` contract.
    function initialize(
        address[] calldata _certifiedAddresses,
        address _validatorSet,
        address _owner
    ) external initializer {
        require(_owner != address(0), "Owner address must not be 0");
        require(_validatorSet != address(0), "Validatorset must not be 0");

        __Ownable_init();
        _transferOwnership(_owner);

        validatorSetContract = IValidatorSetHbbft(_validatorSet);

        for (uint256 i = 0; i < _certifiedAddresses.length; i++) {
            _certify(_certifiedAddresses[i]);
        }
    }

    /// @dev Allows the specified address to use a zero gas price for its transactions.
    /// Can only be called by the `owner`.
    /// @param _who The address for which zero gas price transactions must be allowed.
    function certify(address _who) external onlyOwner {
        _certify(_who);
    }

    /// @dev Denies the specified address usage of a zero gas price for its transactions.
    /// Can only be called by the `owner`.
    /// @param _who The address for which transactions with a zero gas price must be denied.
    function revoke(address _who) external onlyOwner {
        _certified[_who] = false;
        emit Revoked(_who);
    }

    // =============================================== Getters ========================================================

    /// @dev Returns a boolean flag indicating whether the specified address is allowed to use zero gas price
    /// transactions. Returns `true` if either the address is certified using the `_certify` function or if
    /// `ValidatorSet.isReportValidatorValid` returns `true` for the specified address,
    /// or the address is a pending validator who has to write it's key shares (ACK and PART).
    /// @param _who The address for which the boolean flag must be determined.
    function certified(address _who) external view returns (bool) {
        if (_certified[_who]) {
            return true;
        }

        address stakingAddress = validatorSetContract.stakingByMiningAddress(
            _who
        );
        if (stakingAddress == address(0)) {
            //if there is no staking address registered to this pool
            return false;
        }

        // we generally certify every active node,
        // since the node cache the list of certifiers
        // and the permission contracts checks anyway,
        // if the specific 0 gas transaction is allowed or not.
        // IStakingHbbft stakingContract = IStakingHbbft(
        //     validatorSetContract.getStakingContract()
        // );
        return stakingAddress != address(0);
    }

    /// @dev Returns a boolean flag indicating whether the specified address is allowed to use zero gas price
    /// transactions. Returns `true` if the address is certified using the `_certify` function.
    /// This function differs from the `certified`: it doesn't take into account the returned value of
    /// `ValidatorSetHbbft.isReportValidatorValid` function.
    /// @param _who The address for which the boolean flag must be determined.
    function certifiedExplicitly(address _who) external view returns (bool) {
        return _certified[_who];
    }

    // ============================================== Internal ========================================================

    /// @dev An internal function for the `certify` and `initialize` functions.
    /// @param _who The address for which transactions with a zero gas price must be allowed.
    function _certify(address _who) internal {
        require(_who != address(0), "certifier must not be address 0");
        _certified[_who] = true;
        emit Confirmed(_who);
    }
}
