import hre from "hardhat";

export const GovernanceAddress = "0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0";

/// deploys the DAO Mock on the predefined address `GovernanceAddress`.
export async function deployDao() {
    const { viem: hhViem, networkHelpers: helpers } = await hre.network.getOrCreate();

    const daoMock = await hhViem.deployContract("DaoMock");

    const publicClient = await hhViem.getPublicClient();

    const bytecode = await publicClient.getCode({
        address: daoMock.address,
    });

    await helpers.setCode(GovernanceAddress, bytecode!);

    const dao = await hhViem.getContractAt("DaoMock", GovernanceAddress);

    return dao;
}
