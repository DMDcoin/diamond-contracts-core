pragma solidity ^0.5.16;
pragma experimental ABIEncoderV2;

import "./interfaces/IKeyGenHistory.sol";
import "./interfaces/IValidatorSetSimplified.sol";

/// @dev Used once on network startup and then destroyed.
/// Needed for initializing upgradeable contracts since
/// upgradeable contracts can't have constructors.
contract InitializerSimplified {


    /// @param _contracts An array of the contracts:
    ///   0 is ValidatorSetSimplified,
    ///   1 is KeyGenHistory.
    /// @param _miningAddresses The array of initial validators' mining addresses.
    constructor(
        address[] memory _contracts,
        address[] memory _miningAddresses,
        bytes32[] memory _publicKeys,
        bytes[] memory _parts,
        bytes[][] memory _acks
    ) public {

IValidatorSetSimplified(_contracts[0]).initialize(
            _miningAddresses,
            _publicKeys
        );

        IKeyGenHistory(_contracts[1]).initialize(
            _contracts[0], // _validatorSetContract
            _miningAddresses,
            _parts,
            _acks
        );

        //selfdestruct(msg.sender);

        
    }

}
