import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import { getAddress, parseEventLogs, zeroAddress } from "viem";

import type { } from "../artifacts/contracts/CertifierHbbft.sol/artifacts.js";
import type { } from "../artifacts/contracts/mocks/ValidatorSetHbbftMock.sol/artifacts.js";

import { deployProxy } from "./fixtures/proxy.js";
import { Validator } from "./fixtures/types.js";
import { createRandomWallet } from "./fixtures/wallet.js";

const { viem: hhViem, networkHelpers: helpers } = await hre.network.getOrCreate();

const publicClient = await hhViem.getPublicClient();
type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

const validatorInactivityThreshold = 365n * 86400n; // 1 year

describe("CertifierHbbft contract", () => {
    let accounts: TestWalletClient[];
    let owner: TestWalletClient;

    async function deployContracts() {
        const initialValidators = new Array<Validator>();
        for (let i = 0; i < 3; ++i) {
            const validator = await Validator.create();
            initialValidators.push(validator);
        }

        const initialMiningAddresses = initialValidators.map((validator) => validator.miningAddress());
        const initialStakingAddresses = initialValidators.map((validator) => validator.stakingAddress());

        const stubAddress = createRandomWallet().address;

        const validatorSetParams = {
            blockRewardContract: stubAddress,
            randomContract: stubAddress,
            stakingContract: stubAddress,
            keyGenHistoryContract: stubAddress,
            bonusScoreContract: stubAddress,
            connectivityTrackerContract: stubAddress,
            validatorInactivityThreshold: validatorInactivityThreshold,
        };

        const validatorSetHbbft = await deployProxy(hhViem, "ValidatorSetHbbftMock", {
            initArgs: [
                owner.account.address,
                validatorSetParams,      // _params
                initialMiningAddresses,  // _initialMiningAddresses
                initialStakingAddresses, // _initialStakingAddresses
            ],
            initializer: "initialize",
        });

        const certifier = await deployProxy(hhViem, "CertifierHbbft", {
            initArgs: [[owner.account.address], validatorSetHbbft.address, owner.account.address],
            initializer: "initialize",
        });

        return { initialValidators, certifier, validatorSetHbbft };
    }

    before(async function () {
        [owner, ...accounts] = await hhViem.getWalletClients();
    });

    describe("Initializer", async () => {
        it("should revert initialization with validator contract = address(0)", async () => {
            const implementation = await hhViem.deployContract("CertifierHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "CertifierHbbft", {
                    initArgs: [[], zeroAddress, owner.account.address],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should revert initialization with owner = address(0)", async () => {
            const implementation = await hhViem.deployContract("CertifierHbbft");

            await hhViem.assertions.revertWithCustomError(
                deployProxy(hhViem, "CertifierHbbft", {
                    initArgs: [[], accounts[1].account.address, zeroAddress],
                    initializer: "initialize",
                }),
                implementation,
                "ZeroAddress",
            );
        });

        it("should not allow initialization if initialized contract", async () => {
            const contract = await deployProxy(hhViem, "CertifierHbbft", {
                initArgs: [[], accounts[1].account.address, owner.account.address],
                initializer: "initialize",
            });

            await hhViem.assertions.revertWithCustomError(
                contract.write.initialize([[], accounts[1].account.address, owner.account.address]),
                contract,
                "InvalidInitialization",
            );
        });
    });

    describe("certification", async () => {
        it("should restrict calling certify to contract owner", async function () {
            const { certifier } = await helpers.loadFixture(deployContracts);

            const caller = accounts[5];

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                certifier.write.certify([caller.account.address], { account: caller.account }),
                certifier,
                "OwnableUnauthorizedAccount",
                [getAddress(caller.account.address)],
            );
        });

        it("should restrict calling revoke to contract owner", async function () {
            const { certifier } = await helpers.loadFixture(deployContracts);

            const caller = accounts[5];

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                certifier.write.revoke([caller.account.address], { account: caller.account }),
                certifier,
                "OwnableUnauthorizedAccount",
                [getAddress(caller.account.address)],
            );
        });

        it("should certify address", async function () {
            const { certifier } = await helpers.loadFixture(deployContracts);
            const who = accounts[4].account.address;

            await hhViem.assertions.emitWithArgs(
                certifier.write.certify([who], { account: owner.account }),
                certifier,
                "Confirmed",
                [getAddress(who)],
            );

            assert.equal(await certifier.read.certifiedExplicitly([who]), true);
            assert.equal(await certifier.read.certified([who]), true);
        });

        it("should revoke cerification", async function () {
            const { certifier } = await helpers.loadFixture(deployContracts);
            const who = accounts[6].account.address;

            await hhViem.assertions.emitWithArgs(
                certifier.write.certify([who], { account: owner.account }),
                certifier,
                "Confirmed",
                [getAddress(who)],
            );

            assert.equal(await certifier.read.certifiedExplicitly([who]), true);

            await hhViem.assertions.emitWithArgs(
                certifier.write.revoke([who], { account: owner.account }),
                certifier,
                "Revoked",
                [getAddress(who)],
            );

            assert.equal(await certifier.read.certifiedExplicitly([who]), false);
            assert.equal(await certifier.read.certified([who]), false);
        });

        it("should do nothing if revoking from uncertified address", async function () {
            const { certifier } = await helpers.loadFixture(deployContracts);
            const who = accounts[9].account.address;

            assert.equal(await certifier.read.certifiedExplicitly([who]), false);
            assert.equal(await certifier.read.certified([who]), false);

            const txHash = await certifier.write.revoke([who], { account: owner.account });
            const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

            const revokedEvents = parseEventLogs({
                abi: certifier.abi,
                eventName: "Revoked",
                logs: receipt.logs,
            });

            assert.equal(revokedEvents.length, 0);

            assert.equal(await certifier.read.certifiedExplicitly([who]), false);
            assert.equal(await certifier.read.certified([who]), false);
        });

        it("validator account should be certified by default", async function () {
            const { initialValidators, certifier } = await helpers.loadFixture(deployContracts);

            const validator = initialValidators[0].miningAddress();

            assert.equal(await certifier.read.certifiedExplicitly([validator]), false);
            assert.equal(await certifier.read.certified([validator]), true);
        });
    });
});
