import { describe, it, before } from "node:test";
import hre from "hardhat";

import { parseEther } from "viem";

const { viem: hhViem, networkHelpers: helpers } = await hre.network.getOrCreate();

type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

describe("TransferUtils library", function () {
    let users: TestWalletClient[];

    before(async function () {
        users = await hhViem.getWalletClients();
    });

    async function deployContracts() {
        const transferUtils = await hhViem.deployContract("TransferUtilsMock");
        const mockReceiver = await hhViem.deployContract("EtherReceiverMock");

        const balance = parseEther("10");
        await helpers.setBalance(transferUtils.address, balance);

        await mockReceiver.write.toggleReceive([false]);

        return { transferUtils, mockReceiver, balance };
    }

    it("should revert transferNative with insufficient contract balance", async function () {
        const { transferUtils, balance } = await helpers.loadFixture(deployContracts);

        const transferReceiver = users[1];

        await hhViem.assertions.revertWithCustomError(
            transferUtils.write.transferNative(
                [transferReceiver.account.address, balance * 2n],
            ),
            transferUtils,
            "InsufficientBalance",
        );
    });

    it("should revert transferNative if low level call failed", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);

        await mockReceiver.write.toggleReceive([false]);

        await hhViem.assertions.revertWithCustomErrorWithArgs(
            transferUtils.write.transferNative([mockReceiver.address, balance]),
            transferUtils,
            "TransferFailed",
            [mockReceiver.address, balance],
        );
    });

    it("should transfer ether using transferNative", async function () {
        const { transferUtils, mockReceiver, balance } = await helpers.loadFixture(deployContracts);

        await mockReceiver.write.toggleReceive([true]);

        await hhViem.assertions.balancesHaveChanged(
            transferUtils.write.transferNative([mockReceiver.address, balance]),
            [
                { address: transferUtils.address, amount: -balance },
                { address: mockReceiver.address, amount: balance },
            ],
        );
    });
});
