import { ethers, network, upgrades } from "hardhat";


export const GovernanceAddress = '0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0';

/// deploys the DAO Mock on the predefined address `GovernanceAddress`.  
export async function deployDao() {

    // we fake the deployment of a governance contract here.
    const DaoMockFactory = await ethers.getContractFactory("DaoMock");
    let deployedDaoMock = await (await DaoMockFactory.deploy()).waitForDeployment();
    let daoMockBytecode = await deployedDaoMock.getDeployedCode();

    await network.provider.send("hardhat_setCode", [
        GovernanceAddress,
        daoMockBytecode!,
    ]);
}