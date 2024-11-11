import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";

import { ValueGuardsMock } from "../src/types";

const EmptyBytes4 = ethers.hexlify(ethers.getBytes(ethers.ZeroHash).slice(0, 4));

describe('ValueGuards contract', () => {
    let accounts: HardhatEthersSigner[];
    let owner: HardhatEthersSigner;

    const AllowedRangeValueA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const AllowedRangeValueB = [10, 15, 20, 25, 30, 35, 40, 45, 50];
    const InitialValueA = 0;
    const InitialValueB = 30;

    async function deployContract() {
        const valueGuardsFactory = await ethers.getContractFactory("ValueGuardsMock");
        const valueGuards = await upgrades.deployProxy(
            valueGuardsFactory,
            [InitialValueA, InitialValueB, AllowedRangeValueA, AllowedRangeValueB],
            { initializer: 'initialize' }
        ) as unknown as ValueGuardsMock;

        await valueGuards.waitForDeployment();

        return { valueGuards };
    }

    before(async function () {
        [owner, ...accounts] = await ethers.getSigners();
    });

    describe('Initializer', async () => {
        it("should set allowed value ranges on initialization", async () => {
            const valueGuardsFactory = await ethers.getContractFactory("ValueGuardsMock");

            const setterA = valueGuardsFactory.interface.getFunction("setValueA")!.selector;
            const setterB = valueGuardsFactory.interface.getFunction("setValueB")!.selector;

            const getterA = valueGuardsFactory.interface.getFunction("valueA")!.selector;
            const getterB = valueGuardsFactory.interface.getFunction("getValueB")!.selector;

            const valueGuards = await upgrades.deployProxy(
                valueGuardsFactory,
                { initializer: false },
            ) as unknown as ValueGuardsMock;

            await valueGuards.waitForDeployment();

            await expect(valueGuards.initialize(
                InitialValueA,
                InitialValueB,
                AllowedRangeValueA,
                AllowedRangeValueB,
            ))
                .to.emit(valueGuards, "SetChangeableParameter").withArgs(setterA, getterA, AllowedRangeValueA)
                .to.emit(valueGuards, "SetChangeableParameter").withArgs(setterB, getterB, AllowedRangeValueB);
        });

        it("should not allow value range initialization outside of initializer", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            const setter = valueGuards.interface.getFunction("setValueA").selector;
            const getter = valueGuards.interface.getFunction("valueA").selector;

            await expect(valueGuards.initAllowedChangableParam(setter, getter, AllowedRangeValueA))
                .to.be.revertedWithCustomError(valueGuards, "NotInitializing");
        });
    });

    describe('setAllowedChangeableParameter', async () => {
        it("should be callable only by contract owner", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            const caller = accounts[5];

            const setter = valueGuards.interface.getFunction("setValueA").selector;
            const getter = valueGuards.interface.getFunction("valueA").selector;

            await expect(valueGuards.connect(caller).setAllowedChangeableParameter(setter, getter, []))
                .to.be.revertedWithCustomError(valueGuards, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it("should set allowed changeable parameter and emit event", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            const setter = ethers.hexlify(ethers.getBytes(ethers.id("setSomeVal(uint256)")).slice(0, 4));
            const getter = ethers.hexlify(ethers.getBytes(ethers.id("getSomeVal()")).slice(0, 4));
            const allowedRange = [1, 100];

            await expect(valueGuards.connect(owner).setAllowedChangeableParameter(setter, getter, allowedRange))
                .to.emit(valueGuards, "SetChangeableParameter")
                .withArgs(setter, getter, allowedRange);

            const actualValues = await valueGuards.getAllowedParamsRangeWithSelector(setter);

            expect(actualValues.getter).to.eq(getter);
            expect(actualValues.range).to.deep.eq(allowedRange);
        });
    });

    describe('removeAllowedChangeableParameter', async () => {
        it("should be callable only by contract owner", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            const caller = accounts[5];
            const setter = valueGuards.interface.getFunction("setValueA").selector;

            await expect(valueGuards.connect(caller).removeAllowedChangeableParameter(setter))
                .to.be.revertedWithCustomError(valueGuards, "OwnableUnauthorizedAccount")
                .withArgs(caller.address);
        });

        it("should remove allowed changeable parameter and emit event", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            const setter = ethers.hexlify(ethers.getBytes(ethers.id("setSomeVal(uint256)")).slice(0, 4));
            const getter = ethers.hexlify(ethers.getBytes(ethers.id("getSomeVal()")).slice(0, 4));
            const allowedRange = [1, 100];

            expect(await valueGuards.connect(owner).setAllowedChangeableParameter(setter, getter, allowedRange));

            let actualValues = await valueGuards.getAllowedParamsRangeWithSelector(setter);
            expect(actualValues.getter).to.eq(getter);
            expect(actualValues.range).to.deep.eq(allowedRange);

            await expect(valueGuards.removeAllowedChangeableParameter(setter))
                .to.emit(valueGuards, "RemoveChangeableParameter")
                .withArgs(setter);

            actualValues = await valueGuards.getAllowedParamsRangeWithSelector(setter);
            expect(actualValues.getter).to.eq(EmptyBytes4);
            expect(actualValues.range).to.be.empty;
        });
    });

    describe('getAllowedParamsRange', async () => {
        it("should get by function sighash", async() => {
            const { valueGuards } = await loadFixture(deployContract);

            const sighash = valueGuards.interface.getFunction("setValueA").format("sighash");
            const getter = valueGuards.interface.getFunction("valueA").selector;

            const result = await valueGuards.getAllowedParamsRange(sighash);

            expect(result.getter).to.eq(getter);
            expect(result.range).to.deep.eq(AllowedRangeValueA);
        });

        it("should get by function selector", async() => {
            const { valueGuards } = await loadFixture(deployContract);

            const selector = valueGuards.interface.getFunction("setValueA").selector;
            const getter = valueGuards.interface.getFunction("valueA").selector;

            const result = await valueGuards.getAllowedParamsRangeWithSelector(selector);

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
            const { valueGuards } = await loadFixture(deployContract);

            const setter = ethers.hexlify(ethers.getBytes(ethers.id("setSomeVal(uint256)")).slice(0, 4));

            expect(await valueGuards.isWithinAllowedRange(setter, 0)).to.be.false;
        });

        it("should revert if getter function not exist", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            const setter = ethers.hexlify(ethers.getBytes(ethers.id("setSomeVal(uint256)")).slice(0, 4));
            const getter = EmptyBytes4;
            const allowedRange = [1, 100];

            expect(await valueGuards.connect(owner).setAllowedChangeableParameter(setter, getter, allowedRange));

            await expect(valueGuards.isWithinAllowedRange(setter, 1))
                .to.be.revertedWithCustomError(valueGuards, "GetterCallFailed");
        });

        TestCases.forEach((testCase, index) => {
            it(`should get is allowed, test #${index + 1}`, async function () {
                const { valueGuards } = await loadFixture(deployContract);

                const setter = valueGuards.interface.getFunction("setUnprotectedValueC").selector;
                const getter = valueGuards.interface.getFunction("valueC").selector;

                expect(await valueGuards.connect(owner).setUnprotectedValueC(testCase.initialValue));
                expect(await valueGuards.connect(owner).setAllowedChangeableParameter(setter, getter, testCase.allowedRange));

                for (let i = 0; i < testCase.allowedRange.length; ++i) {
                    expect(
                        await valueGuards.isWithinAllowedRange(setter, testCase.allowedRange[i])
                    ).to.eq(testCase.expectedResult[i])
                }
            });
        });
    });

    describe('withinAllowedRange modifier', async() => {
        it("should work for public storage variable getter func", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            // AllowedRangeValueA = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
            // InitialValueA = 0
            const newValue = 1;

            await expect(valueGuards.setValueA(newValue))
                .to.emit(valueGuards, "SetValueA")
                .withArgs(newValue);

            expect(await valueGuards.valueA()).to.eq(newValue);
        });

        it("should work for external getter function", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            // AllowedRangeValueB = [10, 15, 20, 25, 30, 35, 40, 45, 50];
            // InitialValueB = 30
            const newValue = 25;

            await expect(valueGuards.setValueB(newValue))
                .to.emit(valueGuards, "SetValueB")
                .withArgs(newValue);

            expect(await valueGuards.getValueB()).to.eq(newValue);
        });

        it("should change value step by step", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            const idx = AllowedRangeValueB.indexOf(InitialValueB);

            for (let i = idx + 1; i < AllowedRangeValueB.length; ++i) {
                const newValue = AllowedRangeValueB[i];

                await expect(valueGuards.setValueB(newValue))
                    .to.emit(valueGuards, "SetValueB")
                    .withArgs(newValue);

                expect(await valueGuards.getValueB()).to.eq(newValue);
            }
        });

        it("should not allow skipping steps", async () => {
            const { valueGuards } = await loadFixture(deployContract);

            const idx = AllowedRangeValueB.indexOf(InitialValueB);

            // 1 step forward
            let newValue = AllowedRangeValueB[idx + 1];

            await expect(valueGuards.setValueB(newValue))
                .to.emit(valueGuards, "SetValueB")
                .withArgs(newValue);

            expect(await valueGuards.getValueB()).to.eq(newValue);

            // 2 steps back
            newValue = AllowedRangeValueB[idx - 1];

            await expect(valueGuards.setValueB(newValue))
                .to.be.revertedWithCustomError(valueGuards, "NewValueOutOfRange")
                .withArgs(newValue);
        });
    });
});
