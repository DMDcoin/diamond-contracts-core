
import fs from 'fs';
import hre from 'hardhat';
import { ethers, upgrades } from "hardhat";
import { InitialContractsConfiguration } from '../tasks/types';

async function deployLocally(initialContracts: InitialContractsConfiguration) {
    let replacementMap = new Map<string, string>();

    await upgrades.deployProxyAdmin();

    for (let coreContract of initialContracts.core) {
        const contractFactory = await ethers.getContractFactory(coreContract.name!);
        const contract = await upgrades.deployProxy(contractFactory, { initializer: false, usePlatformDeploy: false });
        await contract.deployed();

        const proxyAddress = contract.address;
        const implementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

        replacementMap.set(proxyAddress, coreContract.proxyAddress!);
        replacementMap.set(implementationAddress, coreContract.implementationAddress!);
    }

    return replacementMap;
}

async function generateNetworkManifest(
    networkId: string,
    initialContracts: InitialContractsConfiguration
) {
    const sourceManifest = `.openzeppelin/unknown-${hre.network.config.chainId}.json`;
    const resultingManifest = `.openzeppelin/unknown-${networkId}.json`;

    if (fs.existsSync(sourceManifest)) {
        fs.unlinkSync(sourceManifest);
    }

    let replacementMap = await deployLocally(initialContracts);

    const rawdata = fs.readFileSync(sourceManifest);
    let parsedData = JSON.parse(rawdata.toString());

    parsedData.admin.address = initialContracts.admin!.address;
    for (let i = 0; i < parsedData.proxies.length; ++i) {
        const manifestProxyAddress = parsedData.proxies[i].address;
        parsedData.proxies[i].address = replacementMap.get(manifestProxyAddress);
    }

    const implPartKeys = Object.keys(parsedData.impls);
    for (let implKey of implPartKeys) {
        const manifestImplAddress = parsedData.impls[implKey].address;
        parsedData.impls[implKey].address = replacementMap.get(manifestImplAddress);
    }

    fs.unlinkSync(sourceManifest);
    fs.writeFileSync(resultingManifest, JSON.stringify(parsedData, null, 4));
}

async function main() {
    if (!process.env.NETWORK_ID) {
        throw new Error("Please set your NETWORK_ID in a .env file");
    }

    const networkId = process.env.NETWORK_ID;
    const initialContracts = InitialContractsConfiguration.fromFile("initial-contracts.json");

    await generateNetworkManifest(networkId, initialContracts);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error)
        process.exit(1)
    });
