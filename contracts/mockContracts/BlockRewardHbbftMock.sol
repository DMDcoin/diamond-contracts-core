pragma solidity =0.8.17;

import "../BlockRewardHbbft.sol";

contract BlockRewardHbbftMock is BlockRewardHbbft {
    // =============================================== Setters ========================================================

    function sendCoins() public payable {}

    function setGovernanceAddress(address _address) public {
        governancePotAddress = payable(_address);
    }

    function setValidatorMinRewardPercent(
        uint256 _stakingEpoch,
        uint256 _percent
    ) public {
        validatorMinRewardPercent[_stakingEpoch] = _percent;
    }

    function getPotsShares(uint256 numValidators) external view returns(PotsShares memory) {
        return _getPotsShares(numValidators);
    }
}
