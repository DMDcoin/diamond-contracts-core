import { ethers } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("Transfer utils library", function () {
    let users: HardhatEthersSigner[];

    before(async function () {
        users = await ethers.getSigners();
    });

    async function deployContracts() {
        const transferUtilsFactory = await ethers.getContractFactory("TransferUtilsMock");
        const transferUtils = await transferUtilsFactory.deploy();
        await transferUtils.waitForDeployment();

        const mockReceiverFactory = await ethers.getContractFactory("EtherReceiverMock");
        const mockReceiver = await mockReceiverFactory.deploy();
        await mockReceiver.waitForDeployment();

        const balance = ethers.parseEther("10")

        await users[1].sendTransaction({
            to: await transferUtils.getAddress(),
            value: balance,
        });

        await mockReceiver.toggleReceive(false);

        return { transferUtils, mockReceiver, balance };
    }

    it("should revert transferNative with insufficient contract balance", async function () {
        const { transferUtils, balance } = await helpers.loadFixture(deployContracts);

        const transferReceiver = users[1];

        await expect(
            transferUtils.transferNative(
                transferReceiver.address,
                balance * 2n,
            )
        ).revertedWithCustomError(transferUtils, "InsufficientBalance");
    });

    it("should revert transferNative if low level call failed", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);

        expect(await mockReceiver.toggleReceive(false));

        await expect(transferUtils.transferNative(await mockReceiver.getAddress(), balance))
            .revertedWithCustomError(transferUtils, "TransferFailed")
            .withArgs(await mockReceiver.getAddress(), balance);
    });

    it("should transfer ether using transferNative", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);
        const receiverAddress = await mockReceiver.getAddress();

        expect(await mockReceiver.toggleReceive(true));

        await expect(() => transferUtils.transferNative(receiverAddress, balance))
            .to.changeEtherBalances(
                [transferUtils, mockReceiver],
                [-balance, balance]
            );
    });

    it("should transfer using transferNativeEnsure", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);
        const receiverAddress = await mockReceiver.getAddress();

        expect(await mockReceiver.toggleReceive(true));

        await expect(() => transferUtils.transferNativeEnsure(receiverAddress, balance))
            .to.changeEtherBalances(
                [transferUtils, mockReceiver],
                [-balance, balance]
            );
    });

    it("should ensure token transfer using Sacrifice contract", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);
        const receiverAddress = await mockReceiver.getAddress();

        expect(await mockReceiver.toggleReceive(false));

        await expect(() => transferUtils.transferNativeEnsure(receiverAddress, balance))
            .to.changeEtherBalances(
                [transferUtils, mockReceiver],
                [-balance, balance]
            );
    });
});
