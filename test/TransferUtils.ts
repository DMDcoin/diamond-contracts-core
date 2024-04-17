import { ethers } from "hardhat";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("Transfer utils library", function () {
    let users: SignerWithAddress[];

    before(async function () {
        users = await ethers.getSigners();
    });

    async function deployContracts() {
        const transferUtilsFactory = await ethers.getContractFactory("TransferUtilsMock");
        const transferUtils = await transferUtilsFactory.deploy();
        await transferUtils.deployed();

        const mockReceiverFactory = await ethers.getContractFactory("EtherReceiverMock");
        const mockReceiver = await mockReceiverFactory.deploy();
        await mockReceiver.deployed();

        const balance = ethers.utils.parseEther("10")

        await users[1].sendTransaction({
            to: transferUtils.address,
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
                balance.add(balance),
            )
        ).revertedWithCustomError(transferUtils, "InsufficientBalance");
    });

    it("should revert transferNative if low level call failed", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);

        expect(await mockReceiver.toggleReceive(false));

        await expect(transferUtils.transferNative(mockReceiver.address, balance))
            .revertedWithCustomError(transferUtils, "TransferFailed")
            .withArgs(mockReceiver.address, balance);
    });

    it("should transfer ether using transferNative", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);

        expect(await mockReceiver.toggleReceive(true));

        await expect(() => transferUtils.transferNative(mockReceiver.address, balance))
            .to.changeEtherBalances(
                [transferUtils, mockReceiver],
                [balance.mul(-1), balance]
            );
    });

    it("should transfer using transferNativeEnsure", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);

        expect(await mockReceiver.toggleReceive(true));

        await expect(() => transferUtils.transferNativeEnsure(mockReceiver.address, balance))
            .to.changeEtherBalances(
                [transferUtils, mockReceiver],
                [balance.mul(-1), balance]
            );
    });

    it("should ensure token transfer using Sacrifice contract", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);

        expect(await mockReceiver.toggleReceive(false));

        await expect(() => transferUtils.transferNativeEnsure(mockReceiver.address, balance))
            .to.changeEtherBalances(
                [transferUtils, mockReceiver],
                [balance.mul(-1), balance]
            );
    });
});
