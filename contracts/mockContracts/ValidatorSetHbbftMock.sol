// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { ValidatorSetHbbft } from "../ValidatorSetHbbft.sol";
import { IKeyGenHistory } from "../interfaces/IKeyGenHistory.sol";
import { IStakingHbbft } from "../interfaces/IStakingHbbft.sol";

contract ValidatorSetHbbftMock is ValidatorSetHbbft {
    bool internal _isFullHealth;

    receive() external payable {}

    // =============================================== Setters ========================================================

    function setBlockRewardContract(address _address) public {
        blockRewardContract = _address;
    }

    function setRandomContract(address _address) public {
        randomContract = _address;
    }

    function setStakingContract(address _address) public {
        stakingContract = IStakingHbbft(_address);
    }

    function setKeyGenHistoryContract(address _address) public {
        keyGenHistoryContract = IKeyGenHistory(_address);
    }

    function setValidatorAvailableSince(address _validator, uint256 _timestamp) public {
        _writeValidatorAvailableSince(_validator, _timestamp);
    }

    function setIsFullHealth(bool _healthy) public {
        _isFullHealth = _healthy;
    }

    function forceFinalizeNewValidators() external {
        _finalizeNewValidators();
    }

    function kickValidator(address _mining) external {
        uint256 len = _currentValidators.length;

        for (uint256 i = 0; i < len; i++) {
            if (_currentValidators[i] == _mining) {
                // Remove the malicious validator from `_pendingValidators`
                _currentValidators[i] = _currentValidators[len - 1];
                _currentValidators.pop();

                return;
            }
        }
    }

    // =============================================== Getters ========================================================

    function getRandomIndex(
        uint256[] memory _likelihood,
        uint256 _likelihoodSum,
        uint256 _randomNumber
    ) public pure returns (uint256) {
        return
            _getRandomIndex(
                _likelihood,
                _likelihoodSum,
                uint256(keccak256(abi.encode(_randomNumber)))
            );
    }

    function isFullHealth() external view override returns (bool) {
        return _isFullHealth;
    }
}
