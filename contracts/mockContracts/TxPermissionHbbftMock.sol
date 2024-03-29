pragma solidity =0.8.17;

import "../../contracts/interfaces/IValidatorSetHbbft.sol";
import "../../contracts/TxPermissionHbbft.sol";

contract MockStaking {
    uint256 public stakingEpoch;

    function setStakingEpoch(uint256 _stakingEpoch) external {
        stakingEpoch = _stakingEpoch;
    }
}

contract MockValidatorSet {
    IValidatorSetHbbft.KeyGenMode public keyGenMode;
    address public stakingContract;

    function setKeyGenMode(IValidatorSetHbbft.KeyGenMode _mode) external {
        keyGenMode = _mode;
    }

    function setStakingContract(address _address) external {
        stakingContract = _address;
    }

    function getPendingValidatorKeyGenerationMode(address) external view returns (IValidatorSetHbbft.KeyGenMode) {
        return keyGenMode;
    }

    function getStakingContract() external view returns (address) {
        return stakingContract;
    }
}

contract TxPermissionHbbftMock is TxPermissionHbbft {
    function setValidatorSetContract(address _address) external {
        validatorSetContract = IValidatorSetHbbft(_address);
    }
}
