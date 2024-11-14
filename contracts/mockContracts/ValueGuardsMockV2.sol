// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import { OwnableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import { ValueGuardsV2 } from "../ValueGuardsV2.sol";


contract ValueGuardsV2Mock is Initializable, OwnableUpgradeable, ValueGuardsV2 {
    uint256 public valueA;
    uint256 private valueB;

    uint256 public valueC;

    event SetValueA(uint256 _val);
    event SetValueB(uint256 _val);

    function initialize(
        uint256 _initialValueA,
        uint256 _initialValueB,
        uint256[] memory allowedRangeValueA,
        uint256[] memory allowedRangeValueB
    ) external initializer {
        __Ownable_init(msg.sender);

        __initAllowedChangeableParameter(
            this.setValueA.selector,
            this.valueA.selector,
            allowedRangeValueA
        );

        __initAllowedChangeableParameter(
            this.setValueB.selector,
            this.getValueB.selector,
            allowedRangeValueB
        );

        valueA = _initialValueA;
        valueB = _initialValueB;
    }

    function setValueA(uint256 _val) external onlyOwner withinAllowedRange(_val) {
        valueA = _val;

        emit SetValueA(_val);
    }

    function setValueB(uint256 _val) external onlyOwner withinAllowedRange(_val) {
        valueB = _val;

        emit SetValueB(_val);
    }

    function setUnprotectedValueC(uint256 _val) external onlyOwner {
        valueC = _val;
    }

    function getValueB() external view returns (uint256) {
        return valueB;
    }

    function initAllowedChangableParam(bytes4 setter, bytes4 getter, uint256[] memory params) external {
        __initAllowedChangeableParameter(setter, getter, params);
    }
}
