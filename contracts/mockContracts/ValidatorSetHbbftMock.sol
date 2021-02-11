pragma solidity ^0.5.16;

import '../../contracts/ValidatorSetHbbft.sol';


contract ValidatorSetHbbftMock is ValidatorSetHbbft {

    uint256 internal _currentTimeStamp;
    address internal _systemAddress;

    // ============================================== Modifiers =======================================================

    modifier onlySystem() {
        require(msg.sender == _getSystemAddress());
        _;
    }

    // =============================================== Setters ========================================================

    function setBannedUntil(address _miningAddress, uint256 _bannedUntil) public {
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

    function setSystemAddress(address _address) public {
        _systemAddress = _address;
    }


    function setCurrentTimestamp(uint256 _timeStamp)
    public {

        // it makes sense to only allow to travel forward in time.
        // this assumption makes tests more consistent,
        // avoiding the usual time travel paradoxons.
        require(_timeStamp > _currentTimeStamp, "setCurrentTimestamp: Can't timetravel back to the past!");
        
        _currentTimeStamp = _timeStamp;
    }


    // =============================================== Getters ========================================================

    function getRandomIndex(
        uint256[] memory _likelihood,
        uint256 _likelihoodSum,
        uint256 _randomNumber
    ) public pure returns(uint256) {
        return _getRandomIndex(
            _likelihood,
            _likelihoodSum,
            uint256(keccak256(abi.encode(_randomNumber)))
        );
    }
    
    /// @dev overrides the calculation of the current timestamp
    /// to use the internal stored "fake" timestamp for testing purposes.
    function getCurrentTimestamp() external view returns(uint256) {
        //require(_currentTimeStamp != 0, 'Timestamp is never expected to be 0');
        return _currentTimeStamp;
    }

    // =============================================== Private ========================================================

    function _getSystemAddress() internal view returns(address) {
        return _systemAddress;
    }
}
