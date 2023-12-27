// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.17;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

// Base ProxyAdmin does not provide a way to set contract owner in constructor
// - that's why this contract exists.
contract ProxyAdminOwnable is ProxyAdmin {
    constructor(address initialOwner) {
        transferOwnership(initialOwner);
    }
}
