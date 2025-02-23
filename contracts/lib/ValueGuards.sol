// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract ValueGuards is OwnableUpgradeable {
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

    struct ValueGuardsStorage {
        /**
        * @dev A mapping that stores the allowed parameter ranges for each function signature.
        */
        mapping(bytes4 => ParameterRange) allowedParameterRange;
    }

    bytes32 private constant VALUEGUARDS_STORAGE_NAMESPACE = keccak256(abi.encode(uint256(keccak256("valueguards.storage")) - 1)) & ~bytes32(uint256(0xff));

    function _getValueGuardsStorage() private pure returns (ValueGuardsStorage storage $) {
        bytes32 slot = VALUEGUARDS_STORAGE_NAMESPACE;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            $.slot := slot
        }
    }

    // ============================================== Events ==========================================================

    /**
     * @dev Event emitted when changeable parameters are set.
     * @param setter Setter function signature.
     * @param getter Getter function signature.
     * @param params An array of uint256 values representing the parameters.
     */
    event SetChangeableParameter(bytes4 setter, bytes4 getter, uint256[] params);

    /**
     * @dev Emitted when changeable parameters are removed.
     * @param funcSelector The function selector of the removed changeable parameters.
     */
    event RemoveChangeableParameter(bytes4 funcSelector);

    // ============================================== Errors ==========================================================

    error NewValueOutOfRange(uint256 _newVal);

    error GetterCallFailed();

    // ============================================== Modifiers =======================================================

    /**
     * @dev Modifier to check if a new value is within the allowed range.
     * @param newVal The new value to be checked.
     * @notice This modifier is used to ensure that the new value is within the allowed range.
     * If the new value is not within the allowed range, the function using this modifier
     * will revert with an error message.
     */
    modifier withinAllowedRange(uint256 newVal) {
        if (!isWithinAllowedRange(msg.sig, newVal)) {
            revert NewValueOutOfRange(newVal);
        }
        _;
    }

    // =============================================== Initializers ====================================================

    /**
     * @dev Inits the allowed changeable parameter for a specific setter function.
     * @param setter Setter function selector.
     * @param getter Getter function selector.
     * @param params The array of allowed parameter values.
     */
    function __initAllowedChangeableParameter(
        bytes4 setter,
        bytes4 getter,
        uint256[] memory params
    ) internal onlyInitializing {
        ValueGuardsStorage storage $ = _getValueGuardsStorage();
        $.allowedParameterRange[setter] = ParameterRange({ getter: getter, range: params });

        emit SetChangeableParameter(setter, getter, params);
    }

    // =============================================== Setters ========================================================

    /**
     * @dev Sets the allowed changeable parameter for a specific setter function.
     * @param setter Setter function selector.
     * @param getter Getter function selector.
     * @param params The array of allowed parameter values.
     */
    function setAllowedChangeableParameter(bytes4 setter, bytes4 getter, uint256[] calldata params) public onlyOwner {
        ValueGuardsStorage storage $ = _getValueGuardsStorage();
        $.allowedParameterRange[setter] = ParameterRange({ getter: getter, range: params });

        emit SetChangeableParameter(setter, getter, params);
    }

    /**
     * @dev Removes the allowed changeable parameter for a given function selector.
     * @param funcSelector The function selector for which the allowed changeable parameter should be removed.
     */
    function removeAllowedChangeableParameter(bytes4 funcSelector) public onlyOwner {
        ValueGuardsStorage storage $ = _getValueGuardsStorage();
        delete $.allowedParameterRange[funcSelector];

        emit RemoveChangeableParameter(funcSelector);
    }

    // =============================================== Getters ========================================================

    /**
     * @dev Checks if the given `newVal` is within the allowed range for the specified function selector.
     * @param funcSelector The function selector.
     * @param newVal The new value to be checked.
     * @return A boolean indicating whether the `newVal` is within the allowed range.
     */
    function isWithinAllowedRange(bytes4 funcSelector, uint256 newVal) public view returns (bool) {
        ValueGuardsStorage storage $ = _getValueGuardsStorage();
        ParameterRange memory allowedRange = $.allowedParameterRange[funcSelector];

        if (allowedRange.range.length == 0) {
            return false;
        }

        uint256[] memory range = allowedRange.range;
        uint256 currVal = _getValueWithSelector(allowedRange.getter);

        for (uint256 i = 0; i < range.length; i++) {
            if (range[i] == currVal) {
                uint256 leftVal = (i > 0) ? range[i - 1] : range[0];
                uint256 rightVal = (i < range.length - 1) ? range[i + 1] : range[range.length - 1];

                return !(newVal != leftVal && newVal != rightVal);
            }
        }

        return false;
    }

    function getAllowedParamsRange(string memory _selector) external view returns (ParameterRange memory) {
        return _getValueGuardsStorage().allowedParameterRange[bytes4(keccak256(bytes(_selector)))];
    }

    function getAllowedParamsRangeWithSelector(bytes4 _selector) external view returns (ParameterRange memory) {
        return _getValueGuardsStorage().allowedParameterRange[_selector];
    }

    // =============================================== Internal ========================================================

    /**
     * @dev Internal function to get the value of a contract state variable using a getter function.
     * @param getterSelector The selector of the getter function.
     * @return The value of the contract state variable.
     */
    function _getValueWithSelector(bytes4 getterSelector) private view returns (uint256) {
        bytes memory payload = abi.encodeWithSelector(getterSelector);
        (bool success, bytes memory result) = address(this).staticcall(payload);
        if (!success) {
            revert GetterCallFailed();
        }

        return abi.decode(result, (uint256));
    }
}
