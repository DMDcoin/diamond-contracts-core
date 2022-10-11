pragma solidity ^0.5.16;

import "../../contracts/RandomHbbft.sol";

contract RandomHbbftMock is RandomHbbft {
    address internal _coinbase;
    address internal _systemAddress;

    // ============================================== Modifiers =======================================================

    modifier onlySystem() {
        require(msg.sender == _getSystemAddress());
        _;
    }

    // =============================================== Setters ========================================================

    function setCoinbase(address _base) public {
        _coinbase = _base;
    }

    function setSystemAddress(address _address) public {
        _systemAddress = _address;
    }

    // =============================================== Private ========================================================

    function _getSystemAddress() internal view returns (address) {
        return _systemAddress;
    }
}
