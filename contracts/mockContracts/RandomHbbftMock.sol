pragma solidity =0.8.17;

import "../../contracts/RandomHbbft.sol";

contract RandomHbbftMock is RandomHbbft {
    address internal _coinbase;
    address internal _systemAddress;

    // ============================================== Modifiers =======================================================

    modifier onlySystem() override {
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
