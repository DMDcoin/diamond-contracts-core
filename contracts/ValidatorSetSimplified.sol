// Simplified Validator Set contract for testing epoch transitions with hbbft.

pragma solidity ^0.5.16;

import "./interfaces/IValidatorSetSimplified.sol";
import "./libs/SafeMath.sol";

contract ValidatorSetSimplified is IValidatorSetSimplified {
    using SafeMath for uint256;
    
    address[] internal _currentValidators;
    mapping (address => bytes) public publicKeys;

    /// @dev Initializes the network parameters. Used by the
    /// constructor of the `InitializerHbbft` contract.
    /// @param _initialMiningAddresses The array of initial validators' mining addresses.
    function initialize(
        address[] calldata _initialMiningAddresses,
        bytes32[] calldata _publicKeys
    ) external {
        require(_initialMiningAddresses.length > 0, "Must provide initial mining addresses");
        require(_initialMiningAddresses.length.mul(2) == _publicKeys.length, "Every mining address needs an associated public key");

        // Add initial validators to the `_currentValidators` array
        for (uint256 i = 0; i < _initialMiningAddresses.length; i++) {
            address miningAddress = _initialMiningAddresses[i];
            _currentValidators.push(miningAddress);
            publicKeys[miningAddress] = abi.encodePacked(_publicKeys[i*2],_publicKeys[i*2+1]);
        }
    }

    // Returns the current validator set
    function getValidators() public view returns(address[] memory) {
        return _currentValidators;
    }

    function getPublicKey(address _validatorAddress) external view returns (bytes memory){
        return publicKeys[_validatorAddress];
    }
}
