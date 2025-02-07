import { ethers } from "hardhat";
import { expect } from "chai";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

const P = "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F";
const Bytes32Zero = ethers.ZeroHash.slice(2);
const Bytes32NonZero = ethers.keccak256(ethers.toUtf8Bytes("test")).slice(2);

describe("Secp256k1Utils library", function () {
    function unprefixed(publicKey: string): string {
        return "0x" + publicKey.slice(4);
    }

    async function deployContracts() {
        const factory = await ethers.getContractFactory("Secp256k1UtilsMock");
        const secp256k1 = (await factory.deploy());

        return { secp256k1 };
    }

    describe("computeAddress", async function () {
        it("should compute Ethereum address from public key", async function () {
            const { secp256k1 } = await helpers.loadFixture(deployContracts);

            const wallet = ethers.Wallet.createRandom();
            
            // Ethereum public keys are prefixed with 0x04, so it should be removed
            const publicKeyUnprefixed = unprefixed(wallet.signingKey.publicKey);

            expect(await secp256k1.computeAddress(publicKeyUnprefixed)).to.eq(wallet.address);
        });

        it("should not compute Ethereum address not from original public key", async function () {
            const { secp256k1 } = await helpers.loadFixture(deployContracts);

            // keep 0x04 prefix
            const wallet = ethers.Wallet.createRandom();

            expect(await secp256k1.computeAddress(wallet.signingKey.publicKey)).to.not.eq(wallet.address);
        });
    });

    describe("isValidPublicKey", async function () {
        const InvalidLengthCases = [
            {
                name: "== 0 bytes",
                publicKey: ethers.hexlify(new Uint8Array())
            },
            {
                name: "< 64 bytes",
                publicKey: ethers.keccak256(ethers.toUtf8Bytes("< 64 bytes"))
            },
            {
                name: "> 64 bytes",
                publicKey: ethers.Wallet.createRandom().signingKey.publicKey
            },
        ];

        // it's not necessary to cover all possible combinations due to short-circuit evaluation
        // in function: (x == 0 || x >= P || y == 0 || y >= P)
        const InvalidPointsCases = [
            {
                name: "x == 0",
                publicKey: "0x".concat(Bytes32Zero, Bytes32NonZero),
            },
            {
                name: "y == 0",
                publicKey: "0x".concat(Bytes32NonZero, Bytes32Zero),
            },
            {
                name: "x >= P",
                publicKey: "0x".concat(P, Bytes32NonZero),
            },
            {
                name: "y >= P",
                publicKey: "0x".concat(Bytes32NonZero, P),
            }
        ]
        
        it("should return true for valid public key", async function() {
            const { secp256k1 } = await helpers.loadFixture(deployContracts);

            const wallet = ethers.Wallet.createRandom();
            
            // Ethereum public keys are prefixed with 0x04, so it should be removed
            const publicKeyUnprefixed = unprefixed(wallet.signingKey.publicKey);

            expect(await secp256k1.isValidPublicKey(publicKeyUnprefixed)).to.be.true;
        });

        InvalidLengthCases.forEach((args) => {
            it(`should revert for public key length ${args.name}`, async function () {
                const { secp256k1 } = await helpers.loadFixture(deployContracts);

                await expect(secp256k1.isValidPublicKey(args.publicKey))
                    .to.be.revertedWithCustomError(secp256k1, "InvalidPublicKeyLength")
            });
        });

        InvalidPointsCases.forEach((args) => {
            it(`should revert for invalid point value: ${args.name}`, async function () {
                const { secp256k1 } = await helpers.loadFixture(deployContracts);

                await expect(secp256k1.isValidPublicKey(args.publicKey))
                    .to.be.revertedWithCustomError(secp256k1, "InvalidPointsValue")
            });
        });
    });
});
