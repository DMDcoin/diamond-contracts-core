// SPDX-License-Identifier: Apache 2.0
pragma solidity =0.8.25;

library Secp256k1Utils {
    uint256 internal constant P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F;
    uint256 internal constant KEY_LENGTH = 64;

    error InvalidPublicKeyLength();
    error InvalidPointsValue();

    function computeAddress(bytes memory publicKey) internal pure returns (address) {
        bytes32 digest = keccak256(publicKey);

        return address(uint160(uint256(digest)));
    }

    function isValidPublicKey(bytes memory publicKey) internal pure returns (bool result) {
        if (publicKey.length != KEY_LENGTH) {
            revert InvalidPublicKeyLength();
        }

        (bytes32 _pubKeyX, bytes32 _pubKeyY) = _extractPoints(publicKey);

        uint256 x = uint256(_pubKeyX);
        uint256 y = uint256(_pubKeyY);
        if (x == 0 || x >= P || y == 0 || y >= P) {
            revert InvalidPointsValue();
        }

        // Check if the point is on the curve: y^2 = x^3 + 7 (mod p)
        uint256 lhs = mulmod(y, y, P);
        uint256 rhs = addmod(mulmod(mulmod(x, x, P), x, P), 7, P);

        return lhs == rhs;
    }

    function _extractPoints(bytes memory publicKey) private pure returns (bytes32 x, bytes32 y) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            x := mload(add(publicKey, 0x20))
            y := mload(add(publicKey, 0x40))
        }
    }
}
