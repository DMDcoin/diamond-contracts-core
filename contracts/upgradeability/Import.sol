// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.17;

// solhint-disable-next-line no-unused-import
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// solhint-disable-next-line no-unused-import
import { TransparentUpgradeableProxy } from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import { ProxyAdmin } from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";

// Base ProxyAdmin does not provide a way to set contract owner in constructor
// - that's why this contract exists.
contract ProxyAdminOwnable is ProxyAdmin {
    constructor(address initialOwner) {
        transferOwnership(initialOwner);
    }
}
