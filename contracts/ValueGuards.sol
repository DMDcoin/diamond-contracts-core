// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract ValueGuards is OwnableUpgradeable {
    // ============================================== Events ==========================================================

    /**
     * @dev Event emitted when changeable parameters are set.
     * @param setter The address of the setter.
     * @param getter The address of the getter.
     * @param params An array of uint256 values representing the parameters.
     */
    event SetChangeAbleParameter(string setter, string getter, uint256[] params);

    /**
     * @dev Emitted when changeable parameters are removed.
     * @param funcSelector The function selector of the removed changeable parameters.
     */
    event RemoveChangeAbleParameter(string funcSelector);

    // =============================================== Events ========================================================
    error GetterCallFailed();

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

    /**
     * @dev A mapping that stores the allowed parameter ranges for each function signature.
     */
    mapping(bytes4 => ParameterRange) public allowedParameterRange;

    // ============================================== Errors ==========================================================
    error NewValueOutOfRange(uint256 _newVal);

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

    // =============================================== Getters ========================================================

    /**
     * @dev Checks if the given `newVal` is within the allowed range for the specified function selector.
     * @param funcSelector The function selector.
     * @param newVal The new value to be checked.
     * @return A boolean indicating whether the `newVal` is within the allowed range.
     */
    function isWithinAllowedRange(bytes4 funcSelector, uint256 newVal) public view returns (bool) {
        ParameterRange memory allowedRange = allowedParameterRange[funcSelector];
        if (allowedRange.range.length == 0) return false;
        uint256[] memory range = allowedRange.range;
        uint256 currVal = _getValueWithSelector(allowedRange.getter);
        bool currValFound = false;

        for (uint256 i = 0; i < range.length; i++) {
            if (range[i] == currVal) {
                currValFound = true;
                uint256 leftVal = (i > 0) ? range[i - 1] : range[0];
                uint256 rightVal = (i < range.length - 1) ? range[i + 1] : range[range.length - 1];
                if (newVal != leftVal && newVal != rightVal) return false;
                break;
            }
        }
        return currValFound;
    }

    function getAllowedParamsRange(string memory _selector) external view returns (ParameterRange memory) {
        return allowedParameterRange[bytes4(keccak256(bytes(_selector)))];
    }

    // =============================================== Setters ========================================================

    /**
     * @dev Sets the allowed changeable parameter for a specific setter function.
     * @param setter The name of the setter function.
     * @param getter The name of the getter function.
     * @param params The array of allowed parameter values.
     */
    function setAllowedChangeableParameter(
        string memory setter,
        string memory getter,
        uint256[] memory params
    ) public virtual onlyOwner {
        allowedParameterRange[bytes4(keccak256(bytes(setter)))] = ParameterRange(
            bytes4(keccak256(bytes(getter))),
            params
        );
        emit SetChangeAbleParameter(setter, getter, params);
    }

    /**
     * @dev Removes the allowed changeable parameter for a given function selector.
     * @param funcSelector The function selector for which the allowed changeable parameter should be removed.
     */
    function removeAllowedChangeableParameter(string memory funcSelector) public virtual onlyOwner {
        delete allowedParameterRange[bytes4(keccak256(bytes(funcSelector)))];
        emit RemoveChangeAbleParameter(funcSelector);
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
