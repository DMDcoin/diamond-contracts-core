import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import { toFunctionSelector, type Hex } from "viem";

import { deployProxy } from "../fixtures/proxy.js";

const { viem: hhViem, networkHelpers: helpers } = await hre.network.getOrCreate();

type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

const EmptyBytes4: Hex = "0x00000000";

const SetValueASig = "setValueA(uint256)";
const ValueASig = "valueA()";
const SetValueBSig = "setValueB(uint256)";
const GetValueBSig = "getValueB()";
const SetUnprotectedValueCSig = "setUnprotectedValueC(uint256)";
const ValueCSig = "valueC()";

describe("ValueGuards contract", () => {
    let owner: TestWalletClient;
    let accounts: TestWalletClient[];

    const AllowedRangeValueA = [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n, 11n, 12n, 13n, 14n, 15n];
    const AllowedRangeValueB = [10n, 15n, 20n, 25n, 30n, 35n, 40n, 45n, 50n];
    const InitialValueA = 0n;
    const InitialValueB = 30n;

    async function deployContract() {
        const valueGuards = await deployProxy(hhViem, "ValueGuardsMock", {
            initArgs: [InitialValueA, InitialValueB, AllowedRangeValueA, AllowedRangeValueB],
            initializer: "initialize",
        });

        return { valueGuards };
    }

    before(async function () {
        [owner, ...accounts] = await hhViem.getWalletClients();
    });

    describe("Initializer", async function () {
        it("should set allowed value ranges on initialization", async function () {
            const setterA = toFunctionSelector(SetValueASig);
            const setterB = toFunctionSelector(SetValueBSig);

            const getterA = toFunctionSelector(ValueASig);
            const getterB = toFunctionSelector(GetValueBSig);

            const valueGuards = await deployProxy(hhViem, "ValueGuardsMock", {
                initializer: null,
            });

            const txHash = await valueGuards.write.initialize(
                [InitialValueA, InitialValueB, AllowedRangeValueA, AllowedRangeValueB],
            );

            await hhViem.assertions.emitWithArgs(
                txHash,
                valueGuards,
                "SetChangeableParameter",
                [setterA, getterA, AllowedRangeValueA],
            );

            await hhViem.assertions.emitWithArgs(
                txHash,
                valueGuards,
                "SetChangeableParameter",
                [setterB, getterB, AllowedRangeValueB],
            );
        });

        it("should not allow value range initialization outside of initializer", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const setter = toFunctionSelector(SetValueASig);
            const getter = toFunctionSelector(ValueASig);

            await hhViem.assertions.revertWithCustomError(
                valueGuards.write.initAllowedChangableParam([setter, getter, AllowedRangeValueA]),
                valueGuards,
                "NotInitializing",
            );
        });
    });

    describe("setAllowedChangeableParameter", async function () {
        it("should be callable only by contract owner", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const caller = accounts[5];

            const setter = toFunctionSelector(SetValueASig);
            const getter = toFunctionSelector(ValueASig);

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                valueGuards.write.setAllowedChangeableParameter(
                    [setter, getter, []],
                    { account: caller.account },
                ),
                valueGuards,
                "OwnableUnauthorizedAccount",
                [caller.account.address],
            );
        });

        it("should set allowed changeable parameter and emit event", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const setter = toFunctionSelector("setSomeVal(uint256)");
            const getter = toFunctionSelector("getSomeVal()");
            const allowedRange = [1n, 100n];

            await hhViem.assertions.emitWithArgs(
                valueGuards.write.setAllowedChangeableParameter([setter, getter, allowedRange]),
                valueGuards,
                "SetChangeableParameter",
                [setter, getter, allowedRange],
            );

            const actualValues = await valueGuards.read.getAllowedParamsRangeWithSelector([setter]);

            assert.equal(actualValues.getter, getter);
            assert.deepEqual(actualValues.range, allowedRange);
        });
    });

    describe("removeAllowedChangeableParameter", async function () {
        it("should be callable only by contract owner", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const caller = accounts[5];
            const setter = toFunctionSelector(SetValueASig);

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                valueGuards.write.removeAllowedChangeableParameter(
                    [setter],
                    { account: caller.account },
                ),
                valueGuards,
                "OwnableUnauthorizedAccount",
                [caller.account.address],
            );
        });

        it("should remove allowed changeable parameter and emit event", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const setter = toFunctionSelector("setSomeVal(uint256)");
            const getter = toFunctionSelector("getSomeVal()");
            const allowedRange = [1n, 100n];

            await valueGuards.write.setAllowedChangeableParameter([setter, getter, allowedRange]);

            let actualValues = await valueGuards.read.getAllowedParamsRangeWithSelector([setter]);
            assert.equal(actualValues.getter, getter);
            assert.deepEqual(actualValues.range, allowedRange);

            await hhViem.assertions.emitWithArgs(
                valueGuards.write.removeAllowedChangeableParameter([setter]),
                valueGuards,
                "RemoveChangeableParameter",
                [setter],
            );

            actualValues = await valueGuards.read.getAllowedParamsRangeWithSelector([setter]);
            assert.equal(actualValues.getter, EmptyBytes4);
            assert.deepEqual(actualValues.range, []);
        });
    });

    describe("getAllowedParamsRange", async function () {
        it("should get by function sighash", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const getter = toFunctionSelector(ValueASig);

            const result = await valueGuards.read.getAllowedParamsRange([SetValueASig]);

            assert.equal(result.getter, getter);
            assert.deepEqual(result.range, AllowedRangeValueA);
        });

        it("should get by function selector", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const selector = toFunctionSelector(SetValueASig);
            const getter = toFunctionSelector(ValueASig);

            const result = await valueGuards.read.getAllowedParamsRangeWithSelector([selector]);

            assert.equal(result.getter, getter);
            assert.deepEqual(result.range, AllowedRangeValueA);
        });
    });

    describe("isWithinAllowedRange", async function () {
        const TestCases = [
            {
                initialValue: 2n,
                allowedRange: [1n, 2n, 3n],
                expectedResult: [true, false, true],
            },
            {
                initialValue: 1n,
                allowedRange: [1n, 2n, 3n],
                expectedResult: [true, true, false],
            },
            {
                initialValue: 3n,
                allowedRange: [1n, 2n, 3n],
                expectedResult: [false, true, true],
            },
            {
                initialValue: 0n,
                allowedRange: [1n, 2n, 3n],
                expectedResult: [false, false, false],
            },
            {
                initialValue: 10n,
                allowedRange: [1n, 2n, 3n],
                expectedResult: [false, false, false],
            },
            {
                initialValue: 10n,
                allowedRange: [0n, 1n, 5n, 10n, 11n, 15n],
                expectedResult: [false, false, true, false, true, false],
            },
            {
                initialValue: 0n,
                allowedRange: [0n, 1n, 5n, 10n, 11n, 15n],
                expectedResult: [true, true, false, false, false, false],
            },
        ];

        it("should return false for unknown selector", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const setter = toFunctionSelector("setSomeVal(uint256)");

            assert.equal(await valueGuards.read.isWithinAllowedRange([setter, 0n]), false);
        });

        it("should revert if getter function not exist", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const setter = toFunctionSelector("setSomeVal(uint256)");
            const getter = EmptyBytes4;
            const allowedRange = [1n, 100n];

            await valueGuards.write.setAllowedChangeableParameter([setter, getter, allowedRange]);

            await hhViem.assertions.revertWithCustomError(
                valueGuards.read.isWithinAllowedRange([setter, 1n]),
                valueGuards,
                "GetterCallFailed",
            );
        });

        TestCases.forEach((testCase, index) => {
            it(`should get is allowed, test #${index + 1}`, async function () {
                const { valueGuards } = await helpers.loadFixture(deployContract);

                const setter = toFunctionSelector(SetUnprotectedValueCSig);
                const getter = toFunctionSelector(ValueCSig);

                await valueGuards.write.setUnprotectedValueC([testCase.initialValue]);
                await valueGuards.write.setAllowedChangeableParameter(
                    [setter, getter, testCase.allowedRange],
                );

                for (let i = 0; i < testCase.allowedRange.length; ++i) {
                    assert.equal(
                        await valueGuards.read.isWithinAllowedRange([setter, testCase.allowedRange[i]]),
                        testCase.expectedResult[i],
                    );
                }
            });
        });
    });

    describe("withinAllowedRange modifier", async function () {
        it("should work for public storage variable getter func", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            // AllowedRangeValueA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
            // InitialValueA = 0
            const newValue = 1n;

            await hhViem.assertions.emitWithArgs(
                valueGuards.write.setValueA([newValue]),
                valueGuards,
                "SetValueA",
                [newValue],
            );

            assert.equal(await valueGuards.read.valueA(), newValue);
        });

        it("should work for external getter function", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            // AllowedRangeValueB = [10, 15, 20, 25, 30, 35, 40, 45, 50];
            // InitialValueB = 30
            const newValue = 25n;

            await hhViem.assertions.emitWithArgs(
                valueGuards.write.setValueB([newValue]),
                valueGuards,
                "SetValueB",
                [newValue],
            );

            assert.equal(await valueGuards.read.getValueB(), newValue);
        });

        it("should change value step by step", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const idx = AllowedRangeValueB.indexOf(InitialValueB);

            for (let i = idx + 1; i < AllowedRangeValueB.length; ++i) {
                const newValue = AllowedRangeValueB[i];

                await hhViem.assertions.emitWithArgs(
                    valueGuards.write.setValueB([newValue]),
                    valueGuards,
                    "SetValueB",
                    [newValue],
                );

                assert.equal(await valueGuards.read.getValueB(), newValue);
            }
        });

        it("should not allow skipping steps", async function () {
            const { valueGuards } = await helpers.loadFixture(deployContract);

            const idx = AllowedRangeValueB.indexOf(InitialValueB);

            // 1 step forward
            let newValue = AllowedRangeValueB[idx + 1];

            await hhViem.assertions.emitWithArgs(
                valueGuards.write.setValueB([newValue]),
                valueGuards,
                "SetValueB",
                [newValue],
            );

            assert.equal(await valueGuards.read.getValueB(), newValue);

            // 2 steps back
            newValue = AllowedRangeValueB[idx - 1];

            await hhViem.assertions.revertWithCustomErrorWithArgs(
                valueGuards.write.setValueB([newValue]),
                valueGuards,
                "NewValueOutOfRange",
                [newValue],
            );
        });
    });
});
