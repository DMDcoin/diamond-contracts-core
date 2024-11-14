import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { ValueGuardsV2Mock } from "../src/types";

const EmptyBytes4 = ethers.hexlify(ethers.getBytes(ethers.ZeroHash).slice(0, 4));

describe('ValueGuardsV2 contract', () => {
    let accounts: HardhatEthersSigner[];
    let owner: HardhatEthersSigner;

    const AllowedRangeValueA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const AllowedRangeValueB = [10, 15, 20, 25, 30, 35, 40, 45, 50];
    const InitialValueA = 0;
    const InitialValueB = 30;

    async function deployContract() {
        const ValueGuardsV2Factory = await ethers.getContractFactory("ValueGuardsV2Mock");
        const ValueGuardsV2 = await upgrades.deployProxy(
            ValueGuardsV2Factory,
            [InitialValueA, InitialValueB, AllowedRangeValueA, AllowedRangeValueB],
            { initializer: 'initialize' }
        ) as unknown as ValueGuardsV2Mock;

        await ValueGuardsV2.waitForDeployment();

        return { ValueGuardsV2 };
    }

    before(async function () {
        [owner, ...accounts] = await ethers.getSigners();
    });

    describe('Initializer', async () => {
        it("should set allowed value ranges on initialization", async () => {
            const ValueGuardsV2Factory = await ethers.getContractFactory("ValueGuardsV2Mock");

            const setterA = ValueGuardsV2Factory.interface.getFunction("setValueA")!.selector;
            const setterB = ValueGuardsV2Factory.interface.getFunction("setValueB")!.selector;

            const getterA = ValueGuardsV2Factory.interface.getFunction("valueA")!.selector;
            const getterB = ValueGuardsV2Factory.interface.getFunction("getValueB")!.selector;

            const ValueGuardsV2 = await upgrades.deployProxy(
                ValueGuardsV2Factory,
                { initializer: false },
            ) as unknown as ValueGuardsV2Mock;

            await ValueGuardsV2.waitForDeployment();

            await expect(ValueGuardsV2.initialize(
                InitialValueA,
                InitialValueB,
                AllowedRangeValueA,
                AllowedRangeValueB,
            ))
                .to.emit(ValueGuardsV2, "SetChangeableParameter").withArgs(setterA, getterA, AllowedRangeValueA)
                .to.emit(ValueGuardsV2, "SetChangeableParameter").withArgs(setterB, getterB, AllowedRangeValueB);
        });

        it("should not allow value range initialization outside of initializer", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const setter = ValueGuardsV2.interface.getFunction("setValueA").selector;
            const getter = ValueGuardsV2.interface.getFunction("valueA").selector;

            await expect(ValueGuardsV2.initAllowedChangableParam(setter, getter, AllowedRangeValueA))
                .to.be.revertedWithCustomError(ValueGuardsV2, "NotInitializing");
        });
    });

    describe('setAllowedChangeableParameter', async () => {
        it("should be callable only by contract owner", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const caller = accounts[5];

            const setter = ValueGuardsV2.interface.getFunction("setValueA").selector;
            const getter = ValueGuardsV2.interface.getFunction("valueA").selector;

            await expect(ValueGuardsV2.connect(caller).setAllowedChangeableParameter(setter, getter, []))
                .to.be.revertedWithCustomError(ValueGuardsV2, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it("should set allowed changeable parameter and emit event", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const setter = ethers.hexlify(ethers.getBytes(ethers.id("setSomeVal(uint256)")).slice(0, 4));
            const getter = ethers.hexlify(ethers.getBytes(ethers.id("getSomeVal()")).slice(0, 4));
            const allowedRange = [1, 100];

            await expect(ValueGuardsV2.connect(owner).setAllowedChangeableParameter(setter, getter, allowedRange))
                .to.emit(ValueGuardsV2, "SetChangeableParameter")
                .withArgs(setter, getter, allowedRange);

            const actualValues = await ValueGuardsV2.getAllowedParamsRangeWithSelector(setter);

            expect(actualValues.getter).to.eq(getter);
            expect(actualValues.range).to.deep.eq(allowedRange);
        });
    });

    describe('removeAllowedChangeableParameter', async () => {
        it("should be callable only by contract owner", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const caller = accounts[5];
            const setter = ValueGuardsV2.interface.getFunction("setValueA").selector;

            await expect(ValueGuardsV2.connect(caller).removeAllowedChangeableParameter(setter))
                .to.be.revertedWithCustomError(ValueGuardsV2, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it("should remove allowed changeable parameter and emit event", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const setter = ethers.hexlify(ethers.getBytes(ethers.id("setSomeVal(uint256)")).slice(0, 4));
            const getter = ethers.hexlify(ethers.getBytes(ethers.id("getSomeVal()")).slice(0, 4));
            const allowedRange = [1, 100];

            expect(await ValueGuardsV2.connect(owner).setAllowedChangeableParameter(setter, getter, allowedRange));

            let actualValues = await ValueGuardsV2.getAllowedParamsRangeWithSelector(setter);
            expect(actualValues.getter).to.eq(getter);
            expect(actualValues.range).to.deep.eq(allowedRange);

            await expect(ValueGuardsV2.removeAllowedChangeableParameter(setter))
                .to.emit(ValueGuardsV2, "RemoveChangeableParameter")
                .withArgs(setter);

            actualValues = await ValueGuardsV2.getAllowedParamsRangeWithSelector(setter);
            expect(actualValues.getter).to.eq(EmptyBytes4);
            expect(actualValues.range).to.be.empty;
        });
    });

    describe('getAllowedParamsRange', async () => {
        it("should get by function sighash", async() => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const sighash = ValueGuardsV2.interface.getFunction("setValueA").format("sighash");
            const getter = ValueGuardsV2.interface.getFunction("valueA").selector;

            const result = await ValueGuardsV2.getAllowedParamsRange(sighash);

            expect(result.getter).to.eq(getter);
            expect(result.range).to.deep.eq(AllowedRangeValueA);
        });

        it("should get by function selector", async() => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const selector = ValueGuardsV2.interface.getFunction("setValueA").selector;
            const getter = ValueGuardsV2.interface.getFunction("valueA").selector;

            const result = await ValueGuardsV2.getAllowedParamsRangeWithSelector(selector);

            expect(result.getter).to.eq(getter);
            expect(result.range).to.deep.eq(AllowedRangeValueA);
        });
    });

    describe('isWithinAllowedRange', async () => {
        const TestCases = [
            {
                initialValue: 2,
                allowedRange: [1, 2, 3],
                expectedResult: [true, false, true],
            },
            {
                initialValue: 1,
                allowedRange: [1, 2, 3],
                expectedResult: [true, true, false],
            },
            {
                initialValue: 3,
                allowedRange: [1, 2, 3],
                expectedResult: [false, true, true],
            },
            {
                initialValue: 0,
                allowedRange: [1, 2, 3],
                expectedResult: [false, false, false],
            },
            {
                initialValue: 10,
                allowedRange: [1, 2, 3],
                expectedResult: [false, false, false],
            },
            {
                initialValue: 10,
                allowedRange: [0, 1, 5, 10, 11, 15],
                expectedResult: [false, false, true, false, true, false],
            },
            {
                initialValue: 0,
                allowedRange: [0, 1, 5, 10, 11, 15],
                expectedResult: [true, true, false, false, false, false],
            },
        ]

        it("should return false for unknown selector", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const setter = ethers.hexlify(ethers.getBytes(ethers.id("setSomeVal(uint256)")).slice(0, 4));

            expect(await ValueGuardsV2.isWithinAllowedRange(setter, 0)).to.be.false;
        });

        it("should revert if getter function not exist", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const setter = ethers.hexlify(ethers.getBytes(ethers.id("setSomeVal(uint256)")).slice(0, 4));
            const getter = EmptyBytes4;
            const allowedRange = [1, 100];

            expect(await ValueGuardsV2.connect(owner).setAllowedChangeableParameter(setter, getter, allowedRange));

            await expect(ValueGuardsV2.isWithinAllowedRange(setter, 1))
                .to.be.revertedWithCustomError(ValueGuardsV2, "GetterCallFailed");
        });

        TestCases.forEach((testCase, index) => {
            it(`should get is allowed, test #${index + 1}`, async function () {
                const { ValueGuardsV2 } = await loadFixture(deployContract);

                const setter = ValueGuardsV2.interface.getFunction("setUnprotectedValueC").selector;
                const getter = ValueGuardsV2.interface.getFunction("valueC").selector;

                expect(await ValueGuardsV2.connect(owner).setUnprotectedValueC(testCase.initialValue));
                expect(await ValueGuardsV2.connect(owner).setAllowedChangeableParameter(setter, getter, testCase.allowedRange));

                for (let i = 0; i < testCase.allowedRange.length; ++i) {
                    expect(
                        await ValueGuardsV2.isWithinAllowedRange(setter, testCase.allowedRange[i])
                    ).to.eq(testCase.expectedResult[i])
                }
            });
        });
    });

    describe('withinAllowedRange modifier', async() => {
        it("should work for public storage variable getter func", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            // AllowedRangeValueA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
            // InitialValueA = 0
            const newValue = 1;

            await expect(ValueGuardsV2.setValueA(newValue))
                .to.emit(ValueGuardsV2, "SetValueA")
                .withArgs(newValue);

            expect(await ValueGuardsV2.valueA()).to.eq(newValue);
        });

        it("should work for external getter function", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            // AllowedRangeValueB = [10, 15, 20, 25, 30, 35, 40, 45, 50];
            // InitialValueB = 30
            const newValue = 25;

            await expect(ValueGuardsV2.setValueB(newValue))
                .to.emit(ValueGuardsV2, "SetValueB")
                .withArgs(newValue);

            expect(await ValueGuardsV2.getValueB()).to.eq(newValue);
        });

        it("should change value step by step", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const idx = AllowedRangeValueB.indexOf(InitialValueB);

            for (let i = idx + 1; i < AllowedRangeValueB.length; ++i) {
                const newValue = AllowedRangeValueB[i];

                await expect(ValueGuardsV2.setValueB(newValue))
                    .to.emit(ValueGuardsV2, "SetValueB")
                    .withArgs(newValue);

                expect(await ValueGuardsV2.getValueB()).to.eq(newValue);
            }
        });

        it("should not allow skipping steps", async () => {
            const { ValueGuardsV2 } = await loadFixture(deployContract);

            const idx = AllowedRangeValueB.indexOf(InitialValueB);

            // 1 step forward
            let newValue = AllowedRangeValueB[idx + 1];

            await expect(ValueGuardsV2.setValueB(newValue))
                .to.emit(ValueGuardsV2, "SetValueB")
                .withArgs(newValue);

            expect(await ValueGuardsV2.getValueB()).to.eq(newValue);

            // 2 steps back
            newValue = AllowedRangeValueB[idx - 1];

            await expect(ValueGuardsV2.setValueB(newValue))
                .to.be.revertedWithCustomError(ValueGuardsV2, "NewValueOutOfRange")
                .withArgs(newValue);
        });
    });
});
