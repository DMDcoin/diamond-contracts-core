// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

import { Secp256k1Utils } from "../utils/Secp256k1Utils.sol";

contract Secp256k1UtilsMock {
    function isValidPublicKey(bytes memory publicKey) external pure returns (bool) {
        return Secp256k1Utils.isValidPublicKey(publicKey);
    }

    function computeAddress(bytes memory publicKey) external pure returns (address) {
        return Secp256k1Utils.computeAddress(publicKey);
    }
}
