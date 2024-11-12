import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";
import { task, types } from 'hardhat/config';
import { attachProxyAdminV5 } from '@openzeppelin/hardhat-upgrades/dist/utils';
import { ContractFactory } from 'ethers';

let KnownContracts = new Map<string, string>([
    ["ValidatorSetHbbft", "0x1000000000000000000000000000000000000001"],
    ["BlockRewardHbbft", "0x2000000000000000000000000000000000000001"],
    ["RandomHbbft", "0x3000000000000000000000000000000000000001"],
    ["TxPermissionHbbft", "0x4000000000000000000000000000000000000001"],
    ["CertifierHbbft", "0x5000000000000000000000000000000000000001"],
    ["KeyGenHistory", "0x7000000000000000000000000000000000000001"],
    ["StakingHbbft", "0x1100000000000000000000000000000000000001"],
    ["ConnectivityTrackerHbbft", "0x1200000000000000000000000000000000000001"],
    ["BonusScoreSystem", "0x1300000000000000000000000000000000000001"],
]);


task("getUpgradeCalldata", "Get contract upgrade calldata to use in DAO proposal")
    .addParam("contract", "The core contract address to upgrade")
    .addOptionalParam("impl", "Address of new core contract implementation", undefined, types.string)
    .addOptionalParam("initFunc", "Initialization or reinitialization function", undefined, types.string)
    .addOptionalVariadicPositionalParam("constructorArgsParams", "Contract constructor arguments.", [])
    .setAction(async (taskArgs, hre) => {
        const { contract, impl, initFunc, constructorArgsParams } = taskArgs;

        if (!KnownContracts.has(contract)) {
            throw new Error(`${contract} is unknown`);
        }

        await hre.run(TASK_COMPILE);

        const [deployer] = await hre.ethers.getSigners();

        const proxyAddress = KnownContracts.get(contract)!;
        const contractFactory = await hre.ethers.getContractFactory(contract, deployer) as ContractFactory;

        console.log("Validating upgrade compatibility")
        await hre.upgrades.validateImplementation(contractFactory);
        await hre.upgrades.validateUpgrade(
            proxyAddress,
            contractFactory,
            {
                unsafeAllowRenames: false,
                unsafeSkipStorageCheck: false,
                kind: "transparent",
            },
        );
        console.log("done!")

        let implementationAddress: string = impl;
        if (impl == undefined) {
            const result = await hre.upgrades.deployImplementation(
                contractFactory,
                {
                    getTxResponse: false,
                    redeployImplementation: 'always',
                }
            );
            implementationAddress = result as string;
        }

        let initCalldata = hre.ethers.hexlify(new Uint8Array());
        if (initFunc != undefined) {
            const initializer = initFunc as string;

            initCalldata = contractFactory.interface.encodeFunctionData(initializer, constructorArgsParams);
        }

        const proxyAdminAddress = await hre.upgrades.erc1967.getAdminAddress(proxyAddress);
        const proxyAdmin = await attachProxyAdminV5(hre, proxyAdminAddress);

        const calldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
            proxyAddress,
            implementationAddress,
            initCalldata,
        ]);

        console.log("contract:", contract);
        console.log("calldata:", calldata);
        console.log("  target:", proxyAdminAddress);
    });
