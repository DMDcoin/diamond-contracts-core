pragma solidity =0.8.17;

import "../../contracts/ValidatorSetHbbft.sol";

contract ValidatorSetHbbftMock is ValidatorSetHbbft {
    address internal _systemAddress;

    // ============================================== Modifiers =======================================================

    modifier onlySystem() override {
        require(msg.sender == _getSystemAddress());
        _;
    }

    // =============================================== Setters ========================================================

    function setBannedUntil(address _miningAddress, uint256 _bannedUntil)
        public
    {
        bannedUntil[_miningAddress] = _bannedUntil;
        bannedDelegatorsUntil[_miningAddress] = _bannedUntil;
    }

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

    function setSystemAddress(address _address) public {
        _systemAddress = _address;
    }

    function setValidatorAvailableSince(address _validator, uint256 _timestamp) public {
        _writeValidatorAvailableSince(_validator, _timestamp);
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

    // =============================================== Private ========================================================

    function _getSystemAddress() internal view returns (address) {
        return _systemAddress;
    }
}
