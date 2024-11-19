// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { StakingHbbft } from "../StakingHbbft.sol";
import { IValidatorSetHbbft } from "../interfaces/IValidatorSetHbbft.sol";
import { Unauthorized } from "../lib/Errors.sol";

contract StakingHbbftMock is StakingHbbft {
    IValidatorSetHbbft private validatorSetContractMock;

    modifier onlyValidatorSetContract() virtual override {
        if (msg.sender != address(validatorSetContract) && msg.sender != address(validatorSetContractMock)) {
            revert Unauthorized();
        }
        _;
    }
    // =============================================== Setters ========================================================

    // Some unit tests requires impersonating staking contract, therefore
    // we need a way to add balance to staking contract address not using `receive` func.
    function addBalance() public payable {
        return;
    }

    function addPoolActiveMock(address _stakingAddress) public {
        _addPoolActive(_stakingAddress, true);
    }

    function addPoolInactiveMock(address _stakingAddress) public {
        _addPoolInactive(_stakingAddress);
    }

    function clearDelegatorStakeSnapshot(address pool, address delegator, uint256 epoch) external {
        _delegatorStakeSnapshot[pool][delegator][epoch] = 0;
    }

    function setStakeAmountTotal(address _poolStakingAddress, uint256 _amount) public {
        stakeAmountTotal[_poolStakingAddress] = _amount;
    }

    function setStakingEpoch(uint256 _stakingEpoch) public {
        stakingEpoch = _stakingEpoch;
    }

    function setValidatorMockSetAddress(IValidatorSetHbbft _validatorSetAddress) public {
        validatorSetContractMock = _validatorSetAddress;
    }

    function setValidatorSetAddress(IValidatorSetHbbft _validatorSetAddress) public {
        validatorSetContract = _validatorSetAddress;
    }

    // =============================================== Getters ========================================
    function getMaxCandidates() external pure returns (uint256) {
        return _getMaxCandidates();
    }

    function getDelegatorStakeSnapshot(address pool, address delegator, uint256 epoch) external view returns (uint256) {
        return _delegatorStakeSnapshot[pool][delegator][epoch];
    }

    function getStakeSnapshotLastEpoch(address pool, address delegator) external view returns (uint256) {
        return _stakeSnapshotLastEpoch[pool][delegator];
    }

    // =============================================== Private ========================================================

    function _getMaxCandidates() internal pure virtual override returns (uint256) {
        return 100;
    }
}
