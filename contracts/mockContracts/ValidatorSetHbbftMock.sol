// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { ValidatorSetHbbft } from "../ValidatorSetHbbft.sol";
import { IKeyGenHistory } from "../interfaces/IKeyGenHistory.sol";
import { IStakingHbbft } from "../interfaces/IStakingHbbft.sol";
import { IBonusScoreSystem } from "../interfaces/IBonusScoreSystem.sol";

contract ValidatorSetHbbftMock is ValidatorSetHbbft {
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

    function setBonusScoreSystemAddress(address _address) public {
        bonusScoreSystem = IBonusScoreSystem(_address);
    }

    function setConnectivityTracker(address _address) public {
        connectivityTracker = _address;
    }

    function setValidatorAvailableSince(address _validator, uint256 _timestamp) public {
        _writeValidatorAvailableSince(_validator, _timestamp);
    }

    function forceFinalizeNewValidators() external {
        _finalizeNewValidators();
    }

    function setValidatorsNum(uint256 num) external {
        uint256 count = _currentValidators.length;

        if (count < num) {
            address validator = _currentValidators[0];
            for (uint256 i = count; i <= num; ++i) {
                _currentValidators.push(validator);
            }
        } else if (count > num) {
            for (uint256 i = count; i > num; --i) {
                _currentValidators.pop();
            }
        } else {
            return;
        }
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

    function addPendingValidator(address _mining) external {
        _pendingValidators.push(_mining);
    }

    // =============================================== Getters ========================================================

    function getRandomIndex(
        uint256[] memory _likelihood,
        uint256 _likelihoodSum,
        uint256 _randomNumber
    ) public pure returns (uint256) {
        return _getRandomIndex(_likelihood, _likelihoodSum, uint256(keccak256(abi.encode(_randomNumber))));
    }
}
