import assert from "node:assert/strict";

import { parseEther, parseEventLogs, type Account, type Address } from "viem";
import type { NetworkConnection } from "hardhat/types/network";

import type { BlockRewardHbbftMock, StakingHbbftMock, ValidatorSetHbbftMock } from "./types.js";

export const SystemAccountAddress: Address = "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE";

export const DefaultImpersonatedBalance = parseEther("10");

export function createNetworkFixtures(connection: NetworkConnection) {
    const { viem, networkHelpers: helpers } = connection;

    async function impersonateAcc(
        address: Address,
        balance: bigint = DefaultImpersonatedBalance,
    ): Promise<Address> {
        await helpers.impersonateAccount(address);
        await helpers.setBalance(address, balance);

        return address;
    }

    /**
     * Impersonates the system account and calls `reward()` on the BlockReward contract.
     *
     * With `mintCoins` enabled, emulates native coins minting: the total reward taken
     * from the emitted `CoinsRewarded` event is sent to the BlockReward contract.
     */
    async function callReward(
        blockReward: BlockRewardHbbftMock,
        isEpochEndBlock: boolean,
        mintCoins: boolean = false,
    ): Promise<void> {
        const systemAccount = await impersonateAcc(SystemAccountAddress);

        const txHash = await blockReward.write.reward([isEpochEndBlock], { account: systemAccount });

        await helpers.stopImpersonatingAccount(SystemAccountAddress);

        if (!mintCoins || !isEpochEndBlock) {
            return;
        }

        const publicClient = await viem.getPublicClient();
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

        if (receipt.logs.length === 0) {
            return;
        }

        const events = parseEventLogs({
            abi: blockReward.abi,
            eventName: "CoinsRewarded",
            logs: receipt.logs,
        });

        assert.ok(events.length > 0, "expected CoinsRewarded event");

        const [owner] = await viem.getWalletClients();
        await blockReward.write.sendCoins({ account: owner.account, value: events[0].args.rewards });
    }

    // time travels forward to the beginning of the next transition,
    // and simulate a block mining (calling reward())
    async function timeTravelToTransition(
        blockReward: BlockRewardHbbftMock,
        staking: StakingHbbftMock,
    ): Promise<void> {
        const startTimeOfNextPhaseTransition = await staking.read.startTimeOfNextPhaseTransition();

        await helpers.time.increaseTo(startTimeOfNextPhaseTransition);
        await callReward(blockReward, false);
    }

    async function timeTravelToEndEpoch(
        blockReward: BlockRewardHbbftMock,
        staking: StakingHbbftMock,
        mintCoins: boolean = false,
    ): Promise<void> {
        const endTimeOfCurrentEpoch = await staking.read.stakingFixedEpochEndTime();

        await helpers.time.increaseTo(endTimeOfCurrentEpoch);
        await callReward(blockReward, true, mintCoins);
    }

    async function announceAvailability(
        validatorSet: ValidatorSetHbbftMock,
        account: Account | Address,
    ): Promise<void> {
        const publicClient = await viem.getPublicClient();
        const block = await publicClient.getBlock();

        await validatorSet.write.announceAvailability([block.number, block.hash], { account });
    }

    return {
        impersonateAcc,
        callReward,
        timeTravelToTransition,
        timeTravelToEndEpoch,
        announceAvailability,
    };
}
