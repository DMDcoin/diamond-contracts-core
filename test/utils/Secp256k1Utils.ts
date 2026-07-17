import assert from "node:assert/strict";
import { describe, it } from "node:test";
import hre from "hardhat";

import { keccak256, toBytes, zeroHash, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const { viem: hhViem, networkHelpers: helpers } = await hre.network.getOrCreate();

const P = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F";
const Bytes32Zero = zeroHash.slice(2);
const Bytes32NonZero = keccak256(toBytes("test")).slice(2);

describe("Secp256k1Utils library", function () {
    // Ethereum public keys are prefixed with 0x04
    function unprefixed(publicKey: string): Hex {
        return `0x${publicKey.slice(4)}`;
    }

    async function deployContracts() {
        const secp256k1 = await hhViem.deployContract("Secp256k1UtilsMock");

        return { secp256k1 };
    }

    describe("computeAddress", async function () {
        it("should compute Ethereum address from public key", async function () {
            const { secp256k1 } = await helpers.loadFixture(deployContracts);

            const wallet = privateKeyToAccount(generatePrivateKey());

            assert.equal(
                await secp256k1.read.computeAddress([unprefixed(wallet.publicKey)]),
                wallet.address,
            );
        });

        it("should not compute Ethereum address not from original public key", async function () {
            const { secp256k1 } = await helpers.loadFixture(deployContracts);

            // keep 0x04 prefix
            const wallet = privateKeyToAccount(generatePrivateKey());

            assert.notEqual(
                await secp256k1.read.computeAddress([wallet.publicKey]),
                wallet.address,
            );
        });
    });

    describe("isValidPublicKey", async function () {
        const InvalidLengthCases: Array<{ name: string; publicKey: Hex }> = [
            {
                name: "== 0 bytes",
                publicKey: "0x",
            },
            {
                name: "< 64 bytes",
                publicKey: keccak256(toBytes("< 64 bytes")),
            },
            {
                name: "> 64 bytes",
                publicKey: privateKeyToAccount(generatePrivateKey()).publicKey,
            },
        ];

        // it's not necessary to cover all possible combinations due to short-circuit evaluation
        // in function: (x == 0 || x >= P || y == 0 || y >= P)
        const InvalidPointsCases: Array<{ name: string; publicKey: Hex }> = [
            {
                name: "x == 0",
                publicKey: `0x${Bytes32Zero}${Bytes32NonZero}`,
            },
            {
                name: "y == 0",
                publicKey: `0x${Bytes32NonZero}${Bytes32Zero}`,
            },
            {
                name: "x >= P",
                publicKey: `0x${P}${Bytes32NonZero}`,
            },
            {
                name: "y >= P",
                publicKey: `0x${Bytes32NonZero}${P}`,
            },
        ];

        it("should return true for valid public key", async function () {
            const { secp256k1 } = await helpers.loadFixture(deployContracts);

            const wallet = privateKeyToAccount(generatePrivateKey());

            assert.equal(
                await secp256k1.read.isValidPublicKey([unprefixed(wallet.publicKey)]),
                true,
            );
        });

        InvalidLengthCases.forEach((args) => {
            it(`should revert for public key length ${args.name}`, async function () {
                const { secp256k1 } = await helpers.loadFixture(deployContracts);

                await hhViem.assertions.revertWithCustomError(
                    secp256k1.read.isValidPublicKey([args.publicKey]),
                    secp256k1,
                    "InvalidPublicKeyLength",
                );
            });
        });

        InvalidPointsCases.forEach((args) => {
            it(`should revert for invalid point value: ${args.name}`, async function () {
                const { secp256k1 } = await helpers.loadFixture(deployContracts);

                await hhViem.assertions.revertWithCustomError(
                    secp256k1.read.isValidPublicKey([args.publicKey]),
                    secp256k1,
                    "InvalidPointsValue",
                );
            });
        });
    });
});
