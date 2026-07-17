import type { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";

import type { } from "../../artifacts/contracts/TxPermissionHbbft.sol/artifacts.js";
import type { } from "../../artifacts/contracts/CertifierHbbft.sol/artifacts.js";
import type { } from "../../artifacts/contracts/KeyGenHistory.sol/artifacts.js";
import type { } from "../../artifacts/contracts/RandomHbbft.sol/artifacts.js";
import type { } from "../../artifacts/contracts/BonusScoreSystem.sol/artifacts.js";
import type { } from "../../artifacts/contracts/ConnectivityTrackerHbbft.sol/artifacts.js";

import type { } from "../../artifacts/contracts/mocks/BlockRewardHbbftMock.sol/artifacts.js";
import type { } from "../../artifacts/contracts/mocks/BonusScoreSystemMock.sol/artifacts.js";
import type { } from "../../artifacts/contracts/mocks/ConnectivityTrackerHbbftMock.sol/artifacts.js";
import type { } from "../../artifacts/contracts/mocks/DaoMock.sol/artifacts.js";
import type { } from "../../artifacts/contracts/mocks/StakingHbbftMock.sol/artifacts.js";
import type { } from "../../artifacts/contracts/mocks/ValidatorSetHbbftMock.sol/artifacts.js";
import type { } from "../../artifacts/contracts/mocks/ReentrancyAttacker.sol/artifacts.js";
import type { } from "../../artifacts/contracts/mocks/StakingHbbftMock.sol/artifacts.js";
import type { } from "../../artifacts/contracts/mocks/ValidatorSetHbbftMock.sol/artifacts.js";
import type { } from "../../artifacts/contracts/mocks/ValueGuardsMock.sol/artifacts.js";

export type TxPermissionHbbft = ContractReturnType<"TxPermissionHbbft">;
export type CertifierHbbft = ContractReturnType<"CertifierHbbft">;
export type KeyGenHistory = ContractReturnType<"KeyGenHistory">;
export type RandomHbbft = ContractReturnType<"RandomHbbft">;
export type BonusScoreSystem = ContractReturnType<"BonusScoreSystem">;
export type ConnectivityTrackerHbbft = ContractReturnType<"ConnectivityTrackerHbbft">;


export type StakingHbbftMock = ContractReturnType<"StakingHbbftMock">;
export type BlockRewardHbbftMock = ContractReturnType<"BlockRewardHbbftMock">;
export type ValidatorSetHbbftMock = ContractReturnType<"ValidatorSetHbbftMock">;
export type ConnectivityTrackerHbbftMock = ContractReturnType<"ConnectivityTrackerHbbftMock">;
export type BonusScoreSystemMock = ContractReturnType<"BonusScoreSystemMock">;
export type DaoMock = ContractReturnType<"DaoMock">;
export type ValueGuardsMock = ContractReturnType<"ValueGuardsMock">;

export enum KeyGenMode {
    NotAPendingValidator,
    WritePart,
    WaitForOtherParts,
    WriteAck,
    WaitForOtherAcks,
    AllKeysDone,
}

export enum AllowedTxTypeMask {
    None = 0x00,
    Basic = 0x01,
    Call = 0x02,
    Create = 0x04,
    Private = 0x08,
    All = 0xffffffff,
}
